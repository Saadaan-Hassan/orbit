"""
Claude API service.

All calls to Claude go through this module via the Cloudflare Worker proxy.
One httpx.AsyncClient is created at module level and reused for every
request — never instantiate a new client per call.
"""

import json
import logging
import os
from typing import AsyncGenerator

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Two separate models — chosen by task, not by default.
#
# RECALL_MODEL  — user-facing: streams a structured answer from session
#   context. Sonnet 4.6 is near-identical to Opus in RAG/synthesis quality
#   and costs 6× less ($3/$15 vs $5/$25 per 1M tokens).
#
# SUMMARY_MODEL — background task, runs every 30 min, never seen by the
#   user directly. Haiku 4.5 is purpose-built for fast structured extraction
#   and costs 5× less than Sonnet ($1/$5 per 1M tokens). Session summarisation
#   is straightforward JSON extraction from a list of app names/titles —
#   it does not need reasoning-heavy models.
RECALL_MODEL = "claude-sonnet-4-6"
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
) -> AsyncGenerator[str, None]:
    """
    Sends a streaming chat request to Claude via the Cloudflare Worker and
    yields raw text delta strings as they arrive over SSE.

    The Worker pipes the Anthropic SSE stream straight through, so we parse
    the Anthropic event format: lines starting with "data: " that contain
    a JSON object with type "content_block_delta".

    Args:
        system_prompt: Recall persona and formatting instructions.
        user_prompt:   User query + merged context from FTS5 and Qdrant.

    Yields:
        Plain text delta strings from each content_block_delta event.
    """
    request_payload = {
        "model": RECALL_MODEL,
        "max_tokens": 1024,
        "stream": True,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_prompt},
        ],
    }

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


async def generate_session_summary(
    system_prompt: str,
    user_prompt: str,
) -> str:
    """
    Sends a non-streaming chat request to Claude via the Cloudflare Worker
    and returns the full text content of the first response message.

    Args:
        system_prompt: Instructions that shape Claude's output format/style.
        user_prompt:   The actual content Claude should reason about.

    Returns:
        Raw text string from Claude's first content block.

    Raises:
        httpx.HTTPStatusError: if the Worker or Anthropic returns a non-2xx
            status that is not recoverable (caller handles retries if needed).
    """
    request_payload = {
        "model": SUMMARY_MODEL,
        "max_tokens": 1024,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_prompt},
        ],
    }

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
