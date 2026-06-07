"""
Voyage AI embedding service.

Generates text embeddings via the Cloudflare Worker /embed route.
The Worker holds the VOYAGE_AI_API_KEY in secrets and injects the
Authorization header before forwarding to api.voyageai.com — the key
never lives on the user's machine.

One httpx.AsyncClient is created at module level and reused for every
request — never instantiate a new client per call.
"""

import os

import httpx
from dotenv import load_dotenv

load_dotenv()

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

    Args:
        text_to_embed: Any text string to embed.

    Returns:
        List of 512 floats representing the text in embedding space.

    Raises:
        httpx.HTTPStatusError: on non-2xx response.
    """
    request_body = {
        "input":      [text_to_embed],
        "model":      VOYAGE_EMBEDDING_MODEL,
        "input_type": "document",
    }

    response = await _http_client.post("/embed", json=request_body)

    if not response.is_success:
        print(
            f"Voyage AI embedding request failed: "
            f"HTTP {response.status_code} — {response.text}"
        )
        response.raise_for_status()

    response_body = response.json()
    return response_body["data"][0]["embedding"]
