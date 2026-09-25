"""
Qdrant local-mode service.

All vector storage and semantic search operations go through this module.
The QdrantClient is initialised lazily on first use rather than at module
import time. This prevents a crash-on-import when the Qdrant lock file is
still held by a stale FastAPI process from a previous Tauri hot-reload cycle.
"""

import asyncio
import logging
import os
import threading
from pathlib import Path

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from services.provider_context_sanitizer import sanitize_provider_metadata
from services.local_storage_security import secure_directory_tree
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

_qdrant_storage_path = os.getenv(
    "QDRANT_STORAGE_PATH", str(Path.home() / ".orbit" / "qdrant_storage")
)

# None until first use. A threading.Lock guards creation so that concurrent
# callers (e.g. from asyncio.to_thread workers) never create two clients.
_qdrant_client: QdrantClient | None = None
_qdrant_client_lock = threading.Lock()


def _get_client() -> QdrantClient:
    """
    Returns the singleton QdrantClient, creating it on the first call.

    Thread-safe: the lock ensures exactly one client is ever created even
    if multiple threads reach this function simultaneously before the client
    is set. Importing this module never acquires the Qdrant file lock — only
    the first real operation does.
    """
    global _qdrant_client
    if _qdrant_client is None:
        with _qdrant_client_lock:
            if _qdrant_client is None:  # re-check inside the lock
                secure_directory_tree(Path(_qdrant_storage_path))
                _qdrant_client = QdrantClient(path=_qdrant_storage_path)
    return _qdrant_client


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

async def wipe_all_session_embeddings() -> None:
    """
    Deletes every point in the orbit_sessions collection without dropping
    the collection itself. Called by the privacy wipe endpoint so the
    collection is immediately ready to accept new embeddings after a wipe.
    """
    client = _get_client()

    existing_collection_names = await asyncio.to_thread(
        lambda: [c.name for c in client.get_collections().collections]
    )

    if COLLECTION_NAME not in existing_collection_names:
        return  # Nothing to wipe — collection does not exist yet.

    # delete_collection + recreate is the most reliable way to clear all
    # points when you don't want to enumerate them.
    await asyncio.to_thread(client.delete_collection, collection_name=COLLECTION_NAME)
    await asyncio.to_thread(
        client.create_collection,
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(
            size=EMBEDDING_DIMENSION,
            distance=Distance.COSINE,
        ),
    )


async def initialize_qdrant_collection() -> None:
    """
    Creates the orbit_sessions collection if it does not already exist.
    Safe to call on every startup — no-op when the collection is present.

    Retries up to 5 times with a 1-second delay to handle the hot-reload
    race where a previous uvicorn worker is still shutting down and holding
    the Qdrant file lock when the new worker starts.
    """
    _MAX_STARTUP_RETRIES = 5
    _RETRY_DELAY_SECONDS = 1.0

    for attempt in range(1, _MAX_STARTUP_RETRIES + 1):
        try:
            client = _get_client()
            existing_collection_names = await asyncio.to_thread(
                lambda: [c.name for c in client.get_collections().collections]
            )
            break  # client opened successfully
        except RuntimeError as exc:
            if "already accessed" not in str(exc):
                raise
            if attempt == _MAX_STARTUP_RETRIES:
                raise RuntimeError(
                    f"Qdrant storage is still locked after {_MAX_STARTUP_RETRIES} "
                    f"attempts. Stop any other Orbit backend processes and retry."
                ) from exc
            # Reset the module-level client so the next attempt creates a fresh one.
            global _qdrant_client
            _qdrant_client = None
            logger.warning(
                "Qdrant storage locked by another process (attempt %d/%d). "
                "Retrying in %.0fs…",
                attempt,
                _MAX_STARTUP_RETRIES,
                _RETRY_DELAY_SECONDS,
            )
            await asyncio.sleep(_RETRY_DELAY_SECONDS)

    if COLLECTION_NAME not in existing_collection_names:
        await asyncio.to_thread(
            client.create_collection,
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=EMBEDDING_DIMENSION,
                distance=Distance.COSINE,
            ),
        )

    # Qdrant creates files lazily, so repair permissions once its initial
    # collection-open work completes as well as before opening it.
    secure_directory_tree(Path(_qdrant_storage_path))


async def delete_session_embedding(embedding_id: str) -> None:
    """
    Removes a single point from the Qdrant collection by its embedding_id.

    The embedding_id stored in SQLite is the string form of the integer point
    ID we derived at upsert time. We convert it back to int before calling
    Qdrant. If the point no longer exists (e.g. already wiped) this is a no-op.
    """
    client = _get_client()

    try:
        integer_point_id = int(embedding_id)
    except (ValueError, TypeError):
        # embedding_id is malformed — nothing useful we can delete.
        return

    from qdrant_client.models import PointIdsList

    await asyncio.to_thread(
        client.delete,
        collection_name=COLLECTION_NAME,
        points_selector=PointIdsList(points=[integer_point_id]),
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

    COST-003: the embedding is generated before Qdrant is touched at all —
    with no personal Voyage key configured (the common case), this raises
    immediately and Qdrant's local storage is never created or opened.
    """
    embedding_vector = await generate_text_embedding(summary_text)
    await initialize_qdrant_collection()
    client = _get_client()

    # Qdrant integer point IDs must be non-negative. We derive a stable ID
    # from the session UUID so the same session always maps to the same point.
    stable_point_id = abs(hash(session_id)) % (10**9)

    # Qdrant is local, but this payload later becomes recall context. Keep it
    # aligned with the provider boundary so legacy summary metadata cannot be
    # reintroduced into a future provider request through semantic search.
    safe_metadata = await sanitize_provider_metadata(metadata)
    point = PointStruct(
        id=stable_point_id,
        vector=embedding_vector,
        payload={**safe_metadata, "session_id": session_id},
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

    COST-003: the embedding is generated before Qdrant is touched at all —
    with no personal Voyage key configured, this raises immediately and
    Qdrant's local storage is never created or opened.
    """
    query_embedding_vector = await generate_text_embedding(query_text)
    await initialize_qdrant_collection()
    client = _get_client()

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
