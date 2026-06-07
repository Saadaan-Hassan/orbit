"""
Voyage AI embedding service.

Generates text embeddings via the Voyage AI HTTP API.
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

VOYAGE_API_BASE_URL = "https://api.voyageai.com/v1"
VOYAGE_EMBEDDING_MODEL = "voyage-3-lite"

# voyage-3-lite produces 512-dimensional vectors.
VOYAGE_EMBEDDING_DIMENSION = 512

HTTP_REQUEST_TIMEOUT_SECONDS = 30.0

# ---------------------------------------------------------------------------
# Singleton HTTP client
# ---------------------------------------------------------------------------

_voyage_api_key = os.getenv("VOYAGE_API_KEY", "")

# One AsyncClient for the lifetime of the process — reused across all calls.
_http_client = httpx.AsyncClient(
    base_url=VOYAGE_API_BASE_URL,
    headers={"Authorization": f"Bearer {_voyage_api_key}"},
    timeout=HTTP_REQUEST_TIMEOUT_SECONDS,
)


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

async def generate_text_embedding(text_to_embed: str) -> list[float]:
    """
    Returns a 512-dimensional embedding vector for the given text string.

    Uses the voyage-3-lite model. Input type is "document" — use this for
    content being stored. For queries at search time the same function works
    because voyage-3-lite treats document and query symmetrically at this tier.

    Args:
        text_to_embed: Any text string to embed (session summary, query, etc.)

    Returns:
        List of 512 floats representing the text in embedding space.

    Raises:
        httpx.HTTPStatusError: on non-2xx response from Voyage AI.
    """
    request_body = {
        "input":      [text_to_embed],
        "model":      VOYAGE_EMBEDDING_MODEL,
        "input_type": "document",
    }

    response = await _http_client.post("/embeddings", json=request_body)

    if not response.is_success:
        print(
            f"Voyage AI embedding request failed: "
            f"HTTP {response.status_code} — {response.text}"
        )
        response.raise_for_status()

    response_body = response.json()
    return response_body["data"][0]["embedding"]
