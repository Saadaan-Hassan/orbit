"""
Qdrant local-mode service.

All vector storage and semantic search operations go through this module.
The QdrantClient is initialised lazily on first use rather than at module
import time. This prevents a crash-on-import when the Qdrant lock file is
still held by a stale FastAPI process from a previous Tauri hot-reload cycle.
"""

import asyncio
import logging
from pathlib import Path

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from services.voyage_service import generate_text_embedding

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

COLLECTION_NAME = "orbit_sessions"

# Matches the output dimension of voyage-3-lite.
EMBEDDING_DIMENSION = 512

MINIMUM_SIMILARITY_SCORE = 0.3

# ---------------------------------------------------------------------------
# Lazy singleton client
# ---------------------------------------------------------------------------

_qdrant_storage_path = str(Path.home() / ".orbit" / "qdrant_storage")

# None until first use. Initialised by _get_client() on the first call to any
# public function. This means a module import never acquires the Qdrant file
# lock — only the first actual operation does, by which point the stale
# process from the previous run has already been killed by Rust.
_qdrant_client: QdrantClient | None = None


def _get_client() -> QdrantClient:
    """
    Returns the singleton QdrantClient, creating it on the first call.

    Separated from module-level code so that importing this module never
    acquires the Qdrant storage lock — only the first real operation does.
    """
    global _qdrant_client
    if _qdrant_client is None:
        _qdrant_client = QdrantClient(path=_qdrant_storage_path)
    return _qdrant_client


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

async def initialize_qdrant_collection() -> None:
    """
    Creates the orbit_sessions collection if it does not already exist.
    Safe to call on every startup — no-op when the collection is present.
    """
    client = _get_client()

    existing_collection_names = await asyncio.to_thread(
        lambda: [c.name for c in client.get_collections().collections]
    )

    if COLLECTION_NAME not in existing_collection_names:
        await asyncio.to_thread(
            client.create_collection,
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=EMBEDDING_DIMENSION,
                distance=Distance.COSINE,
            ),
        )


async def add_session_embedding(
    session_id: str,
    summary_text: str,
    metadata: dict,
) -> None:
    """
    Embeds summary_text with Voyage AI and upserts the resulting point into
    the orbit_sessions collection.

    Args:
        session_id:   UUID string that uniquely identifies the session.
        summary_text: Full text to embed (project + goal + summary + resources).
        metadata:     Key/value pairs stored as the point payload for retrieval.
    """
    client = _get_client()
    embedding_vector = await generate_text_embedding(summary_text)

    # Qdrant integer point IDs must be non-negative. We derive a stable ID
    # from the session UUID so the same session always maps to the same point.
    stable_point_id = abs(hash(session_id)) % (10**9)

    point = PointStruct(
        id=stable_point_id,
        vector=embedding_vector,
        payload={**metadata, "session_id": session_id},
    )

    await asyncio.to_thread(
        client.upsert,
        collection_name=COLLECTION_NAME,
        points=[point],
    )


async def search_sessions_semantic(
    query_text: str,
    result_limit: int = 10,
) -> list[dict]:
    """
    Returns session payloads whose embeddings are semantically close to
    the query text.

    Args:
        query_text:   Natural language query string from the user.
        result_limit: Maximum number of results to return.

    Returns:
        List of payload dicts for points scoring >= MINIMUM_SIMILARITY_SCORE,
        ordered best-first.
    """
    client = _get_client()
    query_embedding_vector = await generate_text_embedding(query_text)

    query_response = await asyncio.to_thread(
        client.query_points,
        collection_name=COLLECTION_NAME,
        query=query_embedding_vector,
        limit=result_limit,
        score_threshold=MINIMUM_SIMILARITY_SCORE,
        with_payload=True,
    )

    return [
        {"score": scored_point.score, **scored_point.payload}
        for scored_point in query_response.points
    ]
