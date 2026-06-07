"""
Memory viewer endpoints — read and selectively delete stored activity data.

These routes power the MemoryViewer UI. All reads are paginated so the
frontend never needs to load the full history into memory at once.
"""

import logging
from typing import Literal

from fastapi import APIRouter, Query
from sqlalchemy import text

from database import _async_engine
from services.qdrant_service import delete_session_embedding

router = APIRouter(prefix="/memory")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------


@router.get("/events")
async def get_events_paginated(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    type: Literal["all", "clipboard", "window", "url"] = Query(default="all"),
) -> dict:
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
        total = count_result.fetchone().total

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
                SELECT id, start_time, end_time, project_name, goal, ai_summary, embedding_id
                FROM   sessions
                ORDER  BY start_time DESC
                LIMIT  :limit OFFSET :offset
                """
            ),
            {"limit": limit, "offset": offset},
        )
        sessions = [dict(row._mapping) for row in data_result.fetchall()]

        count_result = await connection.execute(
            text("SELECT COUNT(*) AS total FROM sessions")
        )
        total = count_result.fetchone().total

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
