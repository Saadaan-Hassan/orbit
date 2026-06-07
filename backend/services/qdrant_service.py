"""
Qdrant local-mode service.

All vector storage and semantic search operations go through this module.
Embedding generation is intentionally NOT done here — it belongs in
embedding_service.py. Functions that need embeddings accept a pre-computed
vector so the two concerns stay separate.

One QdrantClient instance is created at module level and reused everywhere.
Never instantiate a new client per request.
"""

import asyncio
from pathlib import Path

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    PointStruct,
    VectorParams,
)
from qdrant_client.models import ScoredPoint

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

COLLECTION_NAME = "orbit_sessions"

# Dimension produced by sentence-transformers/all-MiniLM-L6-v2.
EMBEDDING_DIMENSION = 384

# Minimum cosine similarity score for a result to be returned.
MINIMUM_SIMILARITY_SCORE = 0.3

# ---------------------------------------------------------------------------
# Singleton client
# ---------------------------------------------------------------------------

# Local file-mode storage is persisted at ~/.orbit/qdrant_storage/.
# No Docker, no server process — the client writes directly to disk.
_qdrant_storage_path = str(Path.home() / ".orbit" / "qdrant_storage")

_qdrant_client = QdrantClient(path=_qdrant_storage_path)


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

async def initialize_qdrant_collection() -> None:
    """
    Creates the orbit_sessions collection if it does not already exist.

    Safe to call on every startup — it is a no-op when the collection is
    already present. Must be awaited before any upsert or search calls.
    """
    existing_collection_names = await asyncio.to_thread(
        lambda: [c.name for c in _qdrant_client.get_collections().collections]
    )

    if COLLECTION_NAME not in existing_collection_names:
        await asyncio.to_thread(
            _qdrant_client.create_collection,
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=EMBEDDING_DIMENSION,
                distance=Distance.COSINE,
            ),
        )


async def upsert_session_embedding(
    session_id: str,
    embedding_vector: list[float],
    metadata: dict,
) -> None:
    """
    Stores or updates a session embedding in the orbit_sessions collection.

    Args:
        session_id:       UUID string that uniquely identifies the session.
                          Used as the Qdrant point ID.
        embedding_vector: Pre-computed 384-dimensional float vector produced
                          by embedding_service.py.
        metadata:         Arbitrary key/value pairs stored as the point
                          payload (e.g. project_name, goal, ai_summary).
    """
    # Qdrant point IDs must be non-negative integers or UUID strings.
    # session_id is already a UUID, so we use it directly.
    point = PointStruct(
        id=session_id,
        vector=embedding_vector,
        payload=metadata,
    )

    await asyncio.to_thread(
        _qdrant_client.upsert,
        collection_name=COLLECTION_NAME,
        points=[point],
    )


async def search_sessions_semantic(
    query_vector: list[float],
    limit: int = 10,
) -> list[dict]:
    """
    Returns sessions whose embeddings are semantically close to the query.

    Args:
        query_vector: Pre-computed 384-dimensional query embedding produced
                      by embedding_service.py.
        limit:        Maximum number of results to return.

    Returns:
        List of metadata dicts for points whose cosine similarity with the
        query vector is >= MINIMUM_SIMILARITY_SCORE, ordered best-first.
    """
    # query_points is the unified search API in qdrant-client 1.x —
    # the older client.search() method was removed in this version.
    query_response = await asyncio.to_thread(
        _qdrant_client.query_points,
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=limit,
        score_threshold=MINIMUM_SIMILARITY_SCORE,
        with_payload=True,
    )

    return [
        {"score": scored_point.score, **scored_point.payload}
        for scored_point in query_response.points
    ]
