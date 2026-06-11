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


class AddExcludedDomainRequest(BaseModel):
    domain: str


class PauseRequest(BaseModel):
    # Unix milliseconds. None means pause indefinitely.
    paused_until_timestamp: Optional[int] = None


class SetFileWatchingRequest(BaseModel):
    enabled: bool


class AddWatchedFolderRequest(BaseModel):
    folder: str


class RemoveWatchedFolderRequest(BaseModel):
    folder: str


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
# Excluded domains
# ---------------------------------------------------------------------------


@router.get("/excluded-domains")
async def get_excluded_domains() -> dict:
    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text("SELECT domain FROM excluded_domains ORDER BY domain ASC")
        )
        domains = [row.domain for row in result.fetchall()]
    return {"excluded_domains": domains}


@router.post("/excluded-domains")
async def add_excluded_domain(request: AddExcludedDomainRequest) -> dict:
    import uuid
    from datetime import datetime, timezone

    new_id = str(uuid.uuid4())
    added_at_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    async with _async_engine.begin() as connection:
        # INSERT OR IGNORE so a duplicate domain is a no-op, not an error.
        await connection.execute(
            text(
                """
                INSERT OR IGNORE INTO excluded_domains (id, domain, added_at)
                VALUES (:id, :domain, :added_at)
                """
            ),
            {"id": new_id, "domain": request.domain, "added_at": added_at_ms},
        )
    return {"status": "ok", "domain": request.domain}


@router.delete("/excluded-domains/{domain}")
async def remove_excluded_domain(domain: str) -> dict:
    async with _async_engine.begin() as connection:
        await connection.execute(
            text("DELETE FROM excluded_domains WHERE domain = :domain"),
            {"domain": domain},
        )
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# File activity watching
# ---------------------------------------------------------------------------


@router.get("/file-watching")
async def get_file_watching() -> dict:
    import json as _json

    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text("SELECT enabled, watched_folders FROM file_watch_settings WHERE id = 1")
        )
        row = result.fetchone()

    if row is None:
        # Table or row absent — return safe defaults without erroring.
        return {"enabled": True, "watched_folders": []}

    try:
        folders = _json.loads(row.watched_folders) if row.watched_folders else []
    except Exception:
        folders = []

    return {"enabled": bool(row.enabled), "watched_folders": folders}


@router.post("/file-watching")
async def set_file_watching(request: SetFileWatchingRequest) -> dict:
    async with _async_engine.begin() as connection:
        await connection.execute(
            text("UPDATE file_watch_settings SET enabled = :enabled WHERE id = 1"),
            {"enabled": 1 if request.enabled else 0},
        )
    return {"enabled": request.enabled}


@router.post("/watched-folders")
async def add_watched_folder(request: AddWatchedFolderRequest) -> dict:
    import json as _json

    folder = request.folder.strip()
    if not folder:
        return {"status": "ok"}

    async with _async_engine.begin() as connection:
        result = await connection.execute(
            text("SELECT watched_folders FROM file_watch_settings WHERE id = 1")
        )
        row = result.fetchone()
        try:
            folders: list[str] = _json.loads(row.watched_folders) if row and row.watched_folders else []
        except Exception:
            folders = []

        if folder not in folders:
            folders.append(folder)
            await connection.execute(
                text("UPDATE file_watch_settings SET watched_folders = :folders WHERE id = 1"),
                {"folders": _json.dumps(folders)},
            )

    return {"status": "ok", "folder": folder}


@router.delete("/watched-folders")
async def remove_watched_folder(request: RemoveWatchedFolderRequest) -> dict:
    import json as _json

    folder = request.folder.strip()

    async with _async_engine.begin() as connection:
        result = await connection.execute(
            text("SELECT watched_folders FROM file_watch_settings WHERE id = 1")
        )
        row = result.fetchone()
        try:
            folders: list[str] = _json.loads(row.watched_folders) if row and row.watched_folders else []
        except Exception:
            folders = []

        updated = [f for f in folders if f != folder]
        if len(updated) != len(folders):
            await connection.execute(
                text("UPDATE file_watch_settings SET watched_folders = :folders WHERE id = 1"),
                {"folders": _json.dumps(updated)},
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
