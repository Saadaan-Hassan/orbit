"""
Voyage AI embedding service.

Generates text embeddings via the Cloudflare Worker /embed route.
The Worker holds the VOYAGE_AI_API_KEY in secrets and injects the
Authorization header before forwarding to api.voyageai.com — the key
never lives on the user's machine.

One httpx.AsyncClient is created at module level and reused for every
request — never instantiate a new client per call.
"""

import asyncio
import logging
import os
import time

import httpx
from dotenv import load_dotenv

from services.provider_context_sanitizer import (
    log_provider_diagnostic,
    sanitize_embedding_text,
)

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VOYAGE_EMBEDDING_MODEL = "voyage-3-lite"

# voyage-3-lite produces 512-dimensional vectors.
VOYAGE_EMBEDDING_DIMENSION = 512

HTTP_REQUEST_TIMEOUT_SECONDS = 30.0

# ---------------------------------------------------------------------------
# Singleton HTTP client — points at the Cloudflare Worker, not Voyage directly.
# ---------------------------------------------------------------------------

_worker_url = os.getenv("WORKER_URL", "http://localhost:8787")

_http_client = httpx.AsyncClient(
    base_url=_worker_url,
    timeout=HTTP_REQUEST_TIMEOUT_SECONDS,
)


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

async def generate_text_embedding(text_to_embed: str) -> list[float]:
    """
    Returns a 512-dimensional embedding vector for the given text string.

    Calls the Worker /embed route, which proxies to Voyage AI with the
    API key injected server-side.

    Uses voyage-3-lite with input_type "document". At this model tier,
    document and query embeddings are symmetric — the same function is safe
    to use for both storing (session summaries) and querying (recall search).

    Retries up to 2 times on transport errors or non-2xx responses, with
    exponential backoff (1 s, 2 s). A transient failure does not permanently
    exclude the session from semantic recall — only a third consecutive failure
    raises so the caller can decide how to handle it.

    Args:
        text_to_embed: Any text string to embed.

    Returns:
        List of 512 floats representing the text in embedding space.

    Raises:
        httpx.HTTPStatusError: on non-2xx response after all retries.
        httpx.TransportError: on network failure after all retries.
    """
    # This is the final privacy boundary before the embedding leaves the
    # device. It also protects sessions created before capture sanitization.
    safe_text_to_embed = await sanitize_embedding_text(text_to_embed)
    request_body = {
        "input":      [safe_text_to_embed],
        "model":      VOYAGE_EMBEDDING_MODEL,
        "input_type": "document",
    }

    for attempt_number in range(3):
        started_at = time.monotonic()
        try:
            response = await _http_client.post("/embed", json=request_body)

            if response.is_success:
                try:
                    return response.json()["data"][0]["embedding"]
                except (KeyError, IndexError, TypeError, ValueError) as error:
                    log_provider_diagnostic(
                        provider="voyage",
                        model=VOYAGE_EMBEDDING_MODEL,
                        operation="embedding",
                        started_at=started_at,
                        status=response.status_code,
                        error=error,
                    )
                    raise

            log_provider_diagnostic(
                provider="voyage",
                model=VOYAGE_EMBEDDING_MODEL,
                operation="embedding",
                started_at=started_at,
                status=response.status_code,
            )
            if attempt_number < 2:
                await asyncio.sleep(2 ** attempt_number)
            else:
                response.raise_for_status()

        except httpx.TransportError as transport_error:
            log_provider_diagnostic(
                provider="voyage",
                model=VOYAGE_EMBEDDING_MODEL,
                operation="embedding",
                started_at=started_at,
                error=transport_error,
            )
            if attempt_number < 2:
                await asyncio.sleep(2 ** attempt_number)
            else:
                raise

    # Unreachable — the loop always raises or returns on the last attempt.
    raise RuntimeError("generate_text_embedding: exhausted retries without returning")
