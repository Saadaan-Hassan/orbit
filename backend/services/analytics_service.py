"""
PostHog analytics service.

Privacy rules enforced at this layer — callers must never pass query text,
clipboard content, URLs, or file names. Only boolean/numeric metadata is
allowed. Any key containing a forbidden substring is stripped before capture.

One PostHog Client is created at module level and reused for every call —
never instantiate per request.
"""

import logging
import os
import uuid
from pathlib import Path
from typing import Optional

import posthog as posthog_sdk

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level singletons
# ---------------------------------------------------------------------------

_posthog_client: Optional[posthog_sdk.Client] = None
_analytics_device_id: Optional[str] = None

# Keys whose names suggest user content — stripped before every capture call.
_FORBIDDEN_PROPERTY_SUBSTRINGS = {"query", "text", "content", "url", "path", "file"}


# ---------------------------------------------------------------------------
# Client accessor
# ---------------------------------------------------------------------------

def get_posthog_client() -> Optional[posthog_sdk.Client]:
    """Returns the singleton PostHog client, or None if analytics is disabled."""
    global _posthog_client
    if _posthog_client is not None:
        return _posthog_client

    api_key = os.getenv("POSTHOG_API_KEY", "")
    if not api_key:
        return None

    _posthog_client = posthog_sdk.Client(
        api_key,
        host=os.getenv("POSTHOG_HOST", "https://us.i.posthog.com"),
    )
    return _posthog_client


# ---------------------------------------------------------------------------
# Device ID
# ---------------------------------------------------------------------------

def get_or_create_device_id() -> str:
    """
    Returns a stable anonymous device ID, creating one on first run.

    Stored in ~/.orbit/device_id as a plain UUID — never linked to any PII.
    Cached in memory after the first read so subsequent calls are instant.
    """
    global _analytics_device_id
    if _analytics_device_id:
        return _analytics_device_id

    device_id_file = Path.home() / ".orbit" / "device_id"
    if device_id_file.exists():
        _analytics_device_id = device_id_file.read_text().strip()
    else:
        _analytics_device_id = str(uuid.uuid4())
        device_id_file.parent.mkdir(parents=True, exist_ok=True)
        device_id_file.write_text(_analytics_device_id)

    return _analytics_device_id


# ---------------------------------------------------------------------------
# Public capture function
# ---------------------------------------------------------------------------

def capture_analytics_event(
    event_name: str,
    event_properties: dict | None = None,
) -> None:
    """
    Sends an analytics event to PostHog. Safe to call unconditionally —
    fails silently if PostHog is not configured or the call errors.

    PRIVACY RULES (enforced here, not by caller):
    - Never include query text, clipboard content, URLs, or file names.
    - Only boolean/numeric metadata is safe to pass as event_properties.
    - Any property key containing a forbidden substring is stripped.
    """
    client = get_posthog_client()
    if client is None:
        return

    try:
        device_id = get_or_create_device_id()

        raw_properties = {
            "app_version": os.getenv("APP_VERSION", "unknown"),
            "platform": "macos",
            **(event_properties or {}),
        }

        # Strip any property whose key contains a content-leaking substring.
        safe_properties = {
            key: value
            for key, value in raw_properties.items()
            if not any(
                forbidden in key.lower()
                for forbidden in _FORBIDDEN_PROPERTY_SUBSTRINGS
            )
        }

        client.capture(event_name, distinct_id=device_id, properties=safe_properties)

    except Exception as analytics_error:
        # Analytics must NEVER break the app — log and continue.
        logger.debug(
            "Analytics capture failed silently (error_kind=%s).",
            type(analytics_error).__name__,
        )
