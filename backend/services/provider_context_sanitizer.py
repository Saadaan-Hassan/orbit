"""Last-line privacy controls for text leaving Orbit for an AI provider.

Capture-time sanitization protects newly captured data, but old databases,
extension-originated data, user recall queries, and conversation history can
still reach a provider. This module is the single, fail-safe boundary used by
every Python AI/embedding service immediately before its HTTP request.

It is intentionally separate from capture sanitization: this boundary is
defence in depth, not permission to relax the earlier local protections.
"""

import json
import logging
import re
import time
from collections.abc import Mapping, Sequence
from typing import Any

import httpx
from sqlalchemy import text

from database import _async_engine
from services.redaction_service import redact_sensitive_content

logger = logging.getLogger(__name__)

# Limits are character counts (not tokens) so they remain deterministic before
# a provider-specific tokenizer is available. They cap the data that can leave
# the device even when a legacy row contains unexpectedly large text.
MAX_SYSTEM_PROMPT_CHARS = 8_000
MAX_USER_PROMPT_CHARS = 16_000
MAX_CHAT_REQUEST_CHARS = 32_000
MAX_HISTORY_MESSAGES = 8
MAX_HISTORY_MESSAGE_CHARS = 2_000
MAX_EMBEDDING_TEXT_CHARS = 12_000
MAX_CLASSIFICATION_EVENTS = 30
MAX_CLASSIFICATION_FIELD_CHARS = 1_000
MAX_CLASSIFICATION_REQUEST_CHARS = 24_000
MAX_METADATA_FIELD_CHARS = 1_000
MAX_METADATA_CHARS = 8_000

_TRUNCATION_MARKER = "\n[TRUNCATED_FOR_PROVIDER_PRIVACY]"

# These patterns deliberately cover forms that might not have been present in
# the Rust capture layer when an older database was created. They are applied
# after the common capture-side patterns imported above.
_AUTHORIZATION_PATTERN = re.compile(
    r"(?i)\bauthorization\s*:\s*(?:bearer|basic)\s+[^\s,;]+"
)
_SECRET_ASSIGNMENT_PATTERN = re.compile(
    r"(?i)\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|"
    r"password|passwd|secret|client[_-]?secret|private[_-]?key)\s*"
    r"(?:=|:)\s*(?:bearer\s+)?[^\s,;]{4,}"
)
_CONNECTION_STRING_PATTERN = re.compile(
    r"(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://"
    r"[^\s\"']+"
)
_URL_CREDENTIALS_PATTERN = re.compile(
    r"(?i)\b([a-z][a-z0-9+.-]*://)[^\s/@:]+:[^\s/@]+@"
)
_SENSITIVE_QUERY_VALUE_PATTERN = re.compile(
    r"(?i)([?&](?:api[_-]?key|access[_-]?token|auth(?:orization)?|"
    r"password|secret|signature|sig|token)=)[^&#\s]+"
)
_EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE_PATTERN = re.compile(
    r"(?<!\w)(?:\+?\d[\d().\-\s]{7,}\d)(?!\w)"
)
_LOCAL_PATH_PATTERN = re.compile(
    r"(?<!\w)(?:~|/(?:Users|home)/[^/\s]+)(?:/[^\s\"']+)+"
)


def _truncate(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    if limit <= len(_TRUNCATION_MARKER):
        return _TRUNCATION_MARKER[:limit]
    return value[: limit - len(_TRUNCATION_MARKER)] + _TRUNCATION_MARKER


def _sanitize_text(value: Any, custom_patterns: Sequence[str], limit: int) -> str:
    """Redacts one string and caps it without ever raising on malformed data."""
    if value is None:
        return ""
    if isinstance(value, bytes):
        input_text = value.decode("utf-8", errors="replace")
    else:
        input_text = value if isinstance(value, str) else str(value)

    # Longest phrases first prevents a shorter custom phrase from exposing part
    # of a longer one. Exact replacement means users cannot install regexes.
    for pattern in sorted(custom_patterns, key=len, reverse=True):
        if pattern:
            input_text = input_text.replace(pattern, "[REDACTED:user_pattern]")

    sanitized = redact_sensitive_content(input_text)
    sanitized = _AUTHORIZATION_PATTERN.sub("[REDACTED:authorization]", sanitized)
    sanitized = _SECRET_ASSIGNMENT_PATTERN.sub("[REDACTED:secret]", sanitized)
    sanitized = _CONNECTION_STRING_PATTERN.sub("[REDACTED:connection_string]", sanitized)
    sanitized = _URL_CREDENTIALS_PATTERN.sub(r"\1[REDACTED:credentials]@", sanitized)
    sanitized = _SENSITIVE_QUERY_VALUE_PATTERN.sub(r"\1[REDACTED]", sanitized)
    sanitized = _EMAIL_PATTERN.sub("[REDACTED:email]", sanitized)
    sanitized = _PHONE_PATTERN.sub("[REDACTED:phone]", sanitized)
    sanitized = _LOCAL_PATH_PATTERN.sub("[REDACTED:local_path]", sanitized)
    return _truncate(sanitized, limit)


async def _load_custom_patterns() -> tuple[str, ...]:
    """Reads local exact-match phrases; missing/corrupt settings fail safely."""
    try:
        async with _async_engine.connect() as connection:
            result = await connection.execute(
                text("SELECT pattern FROM redaction_patterns ORDER BY length(pattern) DESC, id ASC")
            )
            rows = result.fetchall()
    except Exception:
        # Do not log database details here: provider sanitization must work
        # while a new/partially migrated database is being repaired.
        return ()

    return tuple(
        row.pattern
        for row in rows
        if isinstance(row.pattern, str) and row.pattern
    )


async def sanitize_chat_context(
    system_prompt: str,
    user_prompt: str,
    conversation_history: Sequence[Mapping[str, Any]] | None = None,
) -> tuple[str, str, list[dict[str, str]]]:
    """Returns bounded, redacted chat fields ready to place in an HTTP body."""
    custom_patterns = await _load_custom_patterns()
    safe_system = _sanitize_text(system_prompt, custom_patterns, MAX_SYSTEM_PROMPT_CHARS)
    safe_user = _sanitize_text(user_prompt, custom_patterns, MAX_USER_PROMPT_CHARS)

    safe_history: list[dict[str, str]] = []
    remaining_history_chars = max(
        0, MAX_CHAT_REQUEST_CHARS - len(safe_system) - len(safe_user)
    )
    for message in (conversation_history or [])[-MAX_HISTORY_MESSAGES:]:
        if not isinstance(message, Mapping):
            continue
        role = message.get("role")
        content = message.get("content")
        if role not in {"user", "assistant"} or not content:
            continue
        safe_content = _sanitize_text(
            content, custom_patterns, min(MAX_HISTORY_MESSAGE_CHARS, remaining_history_chars)
        )
        if not safe_content:
            break
        safe_history.append({"role": str(role), "content": safe_content})
        remaining_history_chars -= len(safe_content)

    return safe_system, safe_user, safe_history


async def sanitize_embedding_text(text_to_embed: str) -> str:
    """Returns a redacted, bounded embedding input immediately before send."""
    return _sanitize_text(
        text_to_embed, await _load_custom_patterns(), MAX_EMBEDDING_TEXT_CHARS
    )


async def sanitize_classification_events(
    events: Sequence[Mapping[str, Any]],
) -> list[dict[str, str]]:
    """Builds a redacted, bounded classification batch from possibly legacy rows."""
    custom_patterns = await _load_custom_patterns()
    safe_events: list[dict[str, str]] = []

    for event in events[:MAX_CLASSIFICATION_EVENTS]:
        if not isinstance(event, Mapping):
            continue
        safe_event = {
            "id": _sanitize_text(event.get("id", ""), custom_patterns, 128),
            "type": _sanitize_text(event.get("type", ""), custom_patterns, 128),
            "raw_content": _sanitize_text(
                event.get("raw_content", ""), custom_patterns, MAX_CLASSIFICATION_FIELD_CHARS
            ),
            "app_name": _sanitize_text(
                event.get("app_name", ""), custom_patterns, MAX_CLASSIFICATION_FIELD_CHARS
            ),
            "url": _sanitize_text(
                event.get("url", ""), custom_patterns, MAX_CLASSIFICATION_FIELD_CHARS
            ),
        }
        candidate = [*safe_events, safe_event]
        if len(json.dumps(candidate, ensure_ascii=False)) > MAX_CLASSIFICATION_REQUEST_CHARS:
            break
        safe_events.append(safe_event)

    return safe_events


async def sanitize_provider_metadata(metadata: Mapping[str, Any] | None) -> dict[str, Any]:
    """Redacts metadata retained alongside an embedding in local vector storage."""
    custom_patterns = await _load_custom_patterns()

    def sanitize_value(value: Any) -> Any:
        if isinstance(value, Mapping):
            return {str(key): sanitize_value(item) for key, item in value.items()}
        if isinstance(value, list):
            return [sanitize_value(item) for item in value[:MAX_HISTORY_MESSAGES]]
        if isinstance(value, (str, bytes)):
            return _sanitize_text(value, custom_patterns, MAX_METADATA_FIELD_CHARS)
        return value

    safe_metadata = sanitize_value(metadata or {})
    if not isinstance(safe_metadata, dict):
        return {}
    serialized = json.dumps(safe_metadata, ensure_ascii=False, default=str)
    if len(serialized) <= MAX_METADATA_CHARS:
        return safe_metadata
    return {"sanitization": "[TRUNCATED_FOR_PROVIDER_PRIVACY]"}


def provider_error_kind(error: BaseException) -> str:
    """Classifies failures without returning exception text or response content."""
    if isinstance(error, httpx.TimeoutException):
        return "timeout"
    if isinstance(error, httpx.HTTPStatusError):
        return "http_status"
    if isinstance(error, httpx.TransportError):
        return "transport"
    if isinstance(error, (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError)):
        return "invalid_response"
    return "unexpected"


def log_provider_diagnostic(
    *,
    provider: str,
    model: str,
    operation: str,
    started_at: float,
    status: int | None = None,
    error: BaseException | None = None,
) -> None:
    """Logs only structured, non-content provider diagnostics."""
    duration_ms = max(0, round((time.monotonic() - started_at) * 1000))
    logger.warning(
        "provider_request_failed provider=%s model=%s operation=%s status=%s duration_ms=%d error_kind=%s",
        provider,
        model,
        operation,
        status if status is not None else "none",
        duration_ms,
        provider_error_kind(error) if error is not None else "http_status",
    )
