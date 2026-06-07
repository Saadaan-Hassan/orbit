"""
Claude API service.

All calls to Claude go through this module via the Cloudflare Worker proxy.
One httpx.AsyncClient is created at module level and reused for every
request — never instantiate a new client per call.
"""

import logging
import os

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Model used for session summarisation and recall synthesis.
# All Claude requests route through the Cloudflare Worker so the API key
# never lives in this process.
CLAUDE_MODEL_NAME = "claude-opus-4-8"

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
        "model": CLAUDE_MODEL_NAME,
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
