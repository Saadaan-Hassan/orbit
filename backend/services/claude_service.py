"""
Claude API service — unreachable, not just unused (COST-002).

Calls to Claude went through this module via the Cloudflare Worker's `/chat`
route. That route was removed entirely in COST-002, not disabled — a call
from this file now gets a 404 from the Worker. Nothing in scheduler.py or
recall.py calls this module. Left in place as-is; re-adding Claude support
means re-adding the Worker route (with its own BYOK/abuse-prevention
design) first, not just calling back into this file. See AGENTS.md's
Critical Architecture Facts for the current (Groq-only, BYOK) provider
setup.
"""

import json
import logging
import os
import time
from typing import AsyncGenerator

import httpx
from dotenv import load_dotenv

from services.provider_context_sanitizer import (
    log_provider_diagnostic,
    sanitize_chat_context,
)

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Two separate models -- chosen by task, not by default.
#
# RECALL_MODEL  -- user-facing recall synthesis (streaming). Sonnet 4.6 gives
#   the best quality for answering user questions where response quality is
#   directly visible and matters most.
#
# SUMMARY_MODEL -- background session fusion (every 30 min). Haiku 4.5 handles
#   the structured extraction task (signals -> JSON) well and is 3x cheaper than
#   Sonnet. Upgrade to RECALL_MODEL here if fusion quality needs improvement.
RECALL_MODEL  = "claude-sonnet-4-6"
SUMMARY_MODEL = "claude-haiku-4-5-20251001"

# The Worker adds its own upstream timeout; we give a generous client-side
# limit so long summaries don't silently stall.
HTTP_REQUEST_TIMEOUT_SECONDS = 60.0

# ---------------------------------------------------------------------------
# Singleton HTTP client
# ---------------------------------------------------------------------------

_worker_url = os.getenv("WORKER_URL", "http://localhost:8787")

# One AsyncClient for the lifetime of the process. Connection pooling is
# handled internally; creating a new client per request would exhaust the
# OS TCP connection pool after enough calls.
_http_client = httpx.AsyncClient(timeout=HTTP_REQUEST_TIMEOUT_SECONDS)


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

async def stream_recall_response(
    system_prompt: str,
    user_prompt: str,
    conversation_history: list[dict] | None = None,
) -> AsyncGenerator[str, None]:
    """
    Sends a streaming chat request to Claude via the Cloudflare Worker and
    yields raw text delta strings as they arrive over SSE.

    The Worker pipes the Anthropic SSE stream straight through, so we parse
    the Anthropic event format: lines starting with "data: " that contain
    a JSON object with type "content_block_delta".

    Args:
        system_prompt:        Recall persona and formatting instructions.
        user_prompt:          User query + merged context from FTS5 and Qdrant.
        conversation_history: Prior turns from Zustand (max 4 turns = 8 messages).
                              Each entry is {"role": "user"|"assistant", "content": "..."}.

    Yields:
        Plain text delta strings from each content_block_delta event.
    """
    safe_system_prompt, safe_user_prompt, prior_messages = await sanitize_chat_context(
        system_prompt, user_prompt, conversation_history
    )

    request_payload = {
        "model": RECALL_MODEL,
        "max_tokens": 1024,
        "stream": True,
        "system": safe_system_prompt,
        "messages": [
            *prior_messages,
            {"role": "user", "content": safe_user_prompt},
        ],
    }

    started_at = time.monotonic()
    try:
        async with _http_client.stream(
            "POST",
            f"{_worker_url}/chat",
            json=request_payload,
        ) as streaming_response:
            streaming_response.raise_for_status()

            async for raw_line in streaming_response.aiter_lines():
                if not raw_line.startswith("data: "):
                    continue

                raw_json_payload = raw_line[len("data: "):]

                if raw_json_payload.strip() == "[DONE]":
                    break

                try:
                    event_data = json.loads(raw_json_payload)
                except json.JSONDecodeError:
                    continue

                # Anthropic SSE shape for streaming text deltas:
                # {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "..."}}
                if event_data.get("type") == "content_block_delta":
                    delta_text = event_data.get("delta", {}).get("text", "")
                    if delta_text:
                        yield delta_text
    except Exception as error:
        status = error.response.status_code if isinstance(error, httpx.HTTPStatusError) else None
        log_provider_diagnostic(
            provider="anthropic",
            model=RECALL_MODEL,
            operation="recall_stream",
            started_at=started_at,
            status=status,
            error=error,
        )
        raise


async def generate_session_summary(
    system_prompt: str,
    user_prompt: str,
    model: str = SUMMARY_MODEL,
) -> str:
    """
    Sends a non-streaming chat request to Claude via the Cloudflare Worker
    and returns the full text content of the first response message.

    Args:
        system_prompt: Instructions that shape Claude's output format/style.
        user_prompt:   The actual content Claude should reason about.
        model:         Which Claude model to use. Defaults to SUMMARY_MODEL
                       (Haiku) for simple extraction; pass RECALL_MODEL (Sonnet)
                       for reasoning-heavy tasks like signal fusion.

    Returns:
        Raw text string from Claude's first content block.

    Raises:
        httpx.HTTPStatusError: if the Worker or Anthropic returns a non-2xx
            status that is not recoverable (caller handles retries if needed).
    """
    safe_system_prompt, safe_user_prompt, _ = await sanitize_chat_context(
        system_prompt, user_prompt
    )
    request_payload = {
        "model": model,
        "max_tokens": 1024,
        "system": safe_system_prompt,
        "messages": [
            {"role": "user", "content": safe_user_prompt},
        ],
    }

    started_at = time.monotonic()
    try:
        response = await _http_client.post(
            f"{_worker_url}/chat",
            json=request_payload,
        )
        response.raise_for_status()

        response_body = response.json()

        # Anthropic Messages API response shape:
        # { "content": [{ "type": "text", "text": "..." }], ... }
        first_content_block = response_body["content"][0]
        return first_content_block["text"]
    except Exception as error:
        status = error.response.status_code if isinstance(error, httpx.HTTPStatusError) else None
        log_provider_diagnostic(
            provider="anthropic",
            model=model,
            operation="session_summary",
            started_at=started_at,
            status=status,
            error=error,
        )
        raise
