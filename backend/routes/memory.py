"""
Memory viewer endpoints — read and selectively delete stored activity data.

These routes power the MemoryViewer UI. All reads are paginated so the
frontend never needs to load the full history into memory at once.
"""

import logging

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

from database import _async_engine
from services.qdrant_service import delete_session_embedding

router = APIRouter(prefix="/memory")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------


_VALID_EVENT_TYPES = {
    "all", "clipboard", "window", "url", "page_content",
    "search_query", "link_click", "file_activity", "system_state",
    "app_lifecycle", "screen_content",
}


@router.get("/events")
async def get_events_paginated(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    type: str | None = Query(default="all"),
) -> dict:
    if type not in _VALID_EVENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid event type: {type!r}")
    async with _async_engine.connect() as connection:
        # Build the optional WHERE clause once so both the data query and
        # the count query stay consistent with each other.
        type_filter_sql = "" if type == "all" else "WHERE type = :event_type"
        bind_params: dict = {"limit": limit, "offset": offset}
        if type != "all":
            bind_params["event_type"] = type

        data_result = await connection.execute(
            text(
                f"""
                SELECT id, timestamp, type, raw_content, app_name, url, source
                FROM   events
                {type_filter_sql}
                ORDER  BY timestamp DESC
                LIMIT  :limit OFFSET :offset
                """
            ),
            bind_params,
        )
        events = [dict(row._mapping) for row in data_result.fetchall()]

        count_result = await connection.execute(
            text(f"SELECT COUNT(*) AS total FROM events {type_filter_sql}"),
            {k: v for k, v in bind_params.items() if k not in ("limit", "offset")},
        )
        count_row = count_result.fetchone()
        assert count_row is not None  # COUNT(*) always returns exactly one row
        total = count_row.total

    return {"events": events, "total": total, "limit": limit, "offset": offset}


@router.delete("/events/{event_id}")
async def delete_event(event_id: str) -> dict:
    async with _async_engine.begin() as connection:
        await connection.execute(
            text("DELETE FROM events WHERE id = :event_id"),
            {"event_id": event_id},
        )
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


@router.get("/sessions")
async def get_sessions_paginated(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict:
    async with _async_engine.connect() as connection:
        data_result = await connection.execute(
            text(
                """
                SELECT s.id,
                       s.start_time,
                       s.end_time,
                       s.project_name,
                       s.goal,
                       s.ai_summary,
                       s.activity,
                       s.next_step,
                       s.blockers,
                       s.last_action,
                       s.key_resources,
                       s.topics,
                       s.active_minutes,
                       s.embedding_id,
                       COUNT(e.id) AS event_count
                FROM   sessions s
                LEFT JOIN events e ON e.session_id = s.id
                GROUP  BY s.id
                ORDER  BY s.start_time DESC
                LIMIT  :limit OFFSET :offset
                """
            ),
            {"limit": limit, "offset": offset},
        )
        sessions = [dict(row._mapping) for row in data_result.fetchall()]

        count_result = await connection.execute(
            text("SELECT COUNT(*) AS total FROM sessions")
        )
        count_row = count_result.fetchone()
        assert count_row is not None  # COUNT(*) always returns exactly one row
        total = count_row.total

    return {"sessions": sessions, "total": total}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str) -> dict:
    async with _async_engine.begin() as connection:
        # Fetch the embedding_id before deleting so we can remove the
        # corresponding Qdrant point. We do this inside the transaction
        # so the row can't disappear between the SELECT and DELETE.
        id_result = await connection.execute(
            text("SELECT embedding_id FROM sessions WHERE id = :session_id"),
            {"session_id": session_id},
        )
        session_row = id_result.fetchone()

        # Detach events that belonged to this session rather than deleting
        # them — the raw activity log stays intact, only the summary is gone.
        await connection.execute(
            text(
                "UPDATE events SET session_id = NULL WHERE session_id = :session_id"
            ),
            {"session_id": session_id},
        )

        await connection.execute(
            text("DELETE FROM sessions WHERE id = :session_id"),
            {"session_id": session_id},
        )

    # Remove the vector embedding outside the DB transaction — Qdrant is a
    # separate store and its failure must not roll back the SQLite delete.
    if session_row and session_row.embedding_id:
        await delete_session_embedding(session_row.embedding_id)

    return {"status": "ok"}
