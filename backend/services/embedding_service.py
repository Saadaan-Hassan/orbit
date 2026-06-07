"""
Embedding service.

Generates 384-dimensional text embeddings using the Gemini embedding model.
This is the single place in the backend that produces embedding vectors —
qdrant_service.py and scheduler.py both call embed_text() and treat the
returned list[float] as an opaque vector.

One genai.Client is reused from gemini_service.py so we never hold two
client instances for the same API key.

Why Gemini embeddings instead of sentence-transformers?
sentence-transformers requires PyTorch, which dropped Intel Mac wheels in
recent releases and has no wheel for macOS 26. The Gemini embedding-2 model
with output_dimensionality=384 uses Matryoshka Representation Learning, which
preserves embedding quality when truncated — so 384 dimensions from a
3072-dimensional model is a deliberate, supported choice, not a workaround.
"""

import logging

from google.genai import types as genai_types

from services.gemini_service import _genai_client

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EMBEDDING_MODEL_NAME = "gemini-embedding-2"

# Must match the vector size configured in qdrant_service.EMBEDDING_DIMENSION.
# gemini-embedding-2 is a Matryoshka model — truncating to 384 is a
# first-class supported operation that preserves semantic quality.
EMBEDDING_OUTPUT_DIMENSIONS = 384

# Gemini embedding task types that improve retrieval quality by telling
# the model how the vector will be used.
TASK_TYPE_DOCUMENT = "RETRIEVAL_DOCUMENT"   # for texts being stored
TASK_TYPE_QUERY    = "RETRIEVAL_QUERY"       # for search queries

# ---------------------------------------------------------------------------
# Singleton config objects (built once, reused every call)
# ---------------------------------------------------------------------------

_document_embed_config = genai_types.EmbedContentConfig(
    output_dimensionality=EMBEDDING_OUTPUT_DIMENSIONS,
    task_type=TASK_TYPE_DOCUMENT,
)

_query_embed_config = genai_types.EmbedContentConfig(
    output_dimensionality=EMBEDDING_OUTPUT_DIMENSIONS,
    task_type=TASK_TYPE_QUERY,
)

# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

async def embed_text(text_to_embed: str) -> list[float]:
    """
    Embeds a document string for storage in Qdrant.

    Use this when indexing session summaries, memory objects, or any text
    that will be stored and later searched against.

    Args:
        text_to_embed: The text content to embed. Should be the full,
                       rich summary string — not truncated.

    Returns:
        A 384-dimensional float vector.
    """
    return await _embed(text_to_embed, _document_embed_config)


async def embed_query(query_text: str) -> list[float]:
    """
    Embeds a user search query for comparison against stored document vectors.

    Using a separate task type for queries vs documents improves retrieval
    quality — the model is explicitly told the asymmetric retrieval intent.

    Args:
        query_text: The natural language query from the user.

    Returns:
        A 384-dimensional float vector.
    """
    return await _embed(query_text, _query_embed_config)


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

async def _embed(
    text: str,
    config: genai_types.EmbedContentConfig,
) -> list[float]:
    if not text or not text.strip():
        # Return a zero vector for empty input rather than raising — callers
        # should filter empty strings upstream, but a zero vector is a safe
        # fallback that won't crash the pipeline.
        logger.warning("embed called with empty text; returning zero vector.")
        return [0.0] * EMBEDDING_OUTPUT_DIMENSIONS

    response = await _genai_client.aio.models.embed_content(
        model=EMBEDDING_MODEL_NAME,
        contents=text,
        config=config,
    )

    return list(response.embeddings[0].values)
