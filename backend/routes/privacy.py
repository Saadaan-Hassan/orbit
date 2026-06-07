"""
Privacy control endpoints.

All state changes here affect what Orbit captures and how long it keeps data.
Nothing in this module touches the AI pipeline — it is purely data management.
"""

import logging
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from database import _async_engine
from services.qdrant_service import wipe_all_session_embeddings

router = APIRouter(prefix="/privacy")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default apps excluded from window tracking at first run.
# Password managers and system credential stores must always be in this list.
# ---------------------------------------------------------------------------

DEFAULT_EXCLUDED_APPS: list[str] = [
    "1Password",
    "Bitwarden",
    "Keychain Access",
    "LastPass",
    "Dashlane",
    "Safari",
    "System Preferences",
    "System Settings",
]

# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class AddExcludedAppRequest(BaseModel):
    app_name: str


class PauseRequest(BaseModel):
    # Unix milliseconds. None means pause indefinitely.
    paused_until_timestamp: Optional[int] = None


# ---------------------------------------------------------------------------
# Excluded apps
# ---------------------------------------------------------------------------


@router.get("/excluded-apps")
async def get_excluded_apps() -> dict:
    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text("SELECT app_name FROM excluded_apps ORDER BY app_name ASC")
        )
        app_names = [row.app_name for row in result.fetchall()]
    return {"excluded_apps": app_names}


@router.post("/excluded-apps")
async def add_excluded_app(request: AddExcludedAppRequest) -> dict:
    import uuid
    from datetime import datetime, timezone

    new_id = str(uuid.uuid4())
    added_at_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    async with _async_engine.begin() as connection:
        # INSERT OR IGNORE so a duplicate app_name is a no-op, not an error.
        await connection.execute(
            text(
                """
                INSERT OR IGNORE INTO excluded_apps (id, app_name, added_at)
                VALUES (:id, :app_name, :added_at)
                """
            ),
            {"id": new_id, "app_name": request.app_name, "added_at": added_at_ms},
        )
    return {"status": "ok", "app_name": request.app_name}


@router.delete("/excluded-apps/{app_name}")
async def remove_excluded_app(app_name: str) -> dict:
    async with _async_engine.begin() as connection:
        await connection.execute(
            text("DELETE FROM excluded_apps WHERE app_name = :app_name"),
            {"app_name": app_name},
        )
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Capture pause / resume
# ---------------------------------------------------------------------------


@router.post("/pause")
async def pause_capture(request: PauseRequest) -> dict:
    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                """
                UPDATE capture_state
                SET    is_paused     = 1,
                       paused_until  = :paused_until
                WHERE  id = 1
                """
            ),
            {"paused_until": request.paused_until_timestamp},
        )
    return {"status": "paused", "paused_until": request.paused_until_timestamp}


@router.post("/resume")
async def resume_capture() -> dict:
    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                """
                UPDATE capture_state
                SET    is_paused    = 0,
                       paused_until = NULL
                WHERE  id = 1
                """
            )
        )
    return {"status": "capturing"}


@router.get("/capture-status")
async def get_capture_status() -> dict:
    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text("SELECT is_paused, paused_until FROM capture_state WHERE id = 1")
        )
        row = result.fetchone()

    if row is None:
        # Should never happen — seeded on startup — but fail safe.
        return {"is_paused": False, "paused_until": None}

    return {
        "is_paused": bool(row.is_paused),
        "paused_until": row.paused_until,
    }


# ---------------------------------------------------------------------------
# Full memory wipe
# ---------------------------------------------------------------------------


@router.delete("/all-data")
async def wipe_all_data() -> dict:
    """
    Irreversibly deletes every captured event, session, and memory object,
    and clears all Qdrant embeddings. capture_state is preserved so the
    user's pause preference survives the wipe.
    """
    async with _async_engine.begin() as connection:
        # Delete child tables before parents to satisfy foreign key ordering,
        # even though SQLite doesn't enforce FK constraints by default.
        await connection.execute(text("DELETE FROM memory_objects"))
        await connection.execute(text("DELETE FROM events_fts"))
        await connection.execute(text("DELETE FROM events"))
        await connection.execute(text("DELETE FROM sessions"))
        await connection.execute(text("DELETE FROM excluded_apps"))

    # Remove all vector embeddings from the local Qdrant collection.
    await wipe_all_session_embeddings()

    logger.warning("Full memory wipe completed — all user data deleted.")
    return {"status": "ok", "message": "All memory wiped"}
