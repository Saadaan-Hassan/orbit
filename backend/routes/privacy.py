"""
Privacy control endpoints.

All state changes here affect what Orbit captures and how long it keeps data.
Nothing in this module touches the AI pipeline — it is purely data management.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from database import _async_engine
from services.exclusion_policy import (
    normalize_app_name,
    normalize_domain,
    normalize_folder_path,
)
from services.qdrant_service import wipe_all_session_embeddings

router = APIRouter(prefix="/privacy")
logger = logging.getLogger(__name__)

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


class SetBrowserCaptureRequest(BaseModel):
    native_enabled: bool


class SetScreenContentRequest(BaseModel):
    enabled: bool


class CaptureConsentRequest(BaseModel):
    clipboard: bool = False
    app_window: bool = False
    browser: bool = False
    file_activity: bool = False
    screen_content: bool = False


class RedactionPatternRequest(BaseModel):
    # This is an exact local phrase, not a regular expression. The Rust
    # sanitizer applies the same limit before using a loaded row.
    pattern: str


@router.get("/consent")
async def get_capture_consent() -> dict:
    async with _async_engine.connect() as connection:
        result = await connection.execute(text("SELECT * FROM capture_consent WHERE id = 1"))
        row = result.fetchone()
    if row is None:
        # Fail closed if a corrupt/partially migrated database lacks the row.
        return {"consent_version": 1, "accepted": False, "clipboard": False, "app_window": False, "browser": False, "file_activity": False, "screen_content": False}
    return {"consent_version": row.consent_version, "accepted": row.accepted_at is not None, "clipboard": bool(row.clipboard), "app_window": bool(row.app_window), "browser": bool(row.browser), "file_activity": bool(row.file_activity), "screen_content": bool(row.screen_content)}


@router.post("/consent")
async def save_capture_consent(request: CaptureConsentRequest) -> dict:
    from datetime import datetime, timezone
    accepted_at = int(datetime.now(timezone.utc).timestamp() * 1000)
    async with _async_engine.begin() as connection:
        await connection.execute(text("""
            UPDATE capture_consent SET accepted_at = :accepted_at, clipboard = :clipboard,
                app_window = :app_window, browser = :browser, file_activity = :file_activity,
                screen_content = :screen_content WHERE id = 1
        """), {"accepted_at": accepted_at, **request.model_dump()})
        # Consent is not the same as a global pause: accepting choices allows
        # PRIV-002 to apply each category independently.
        await connection.execute(text("UPDATE capture_state SET is_paused = 0, paused_until = NULL WHERE id = 1"))
    return {"status": "ok"}


@router.post("/consent/skip")
async def skip_capture_consent() -> dict:
    """Keeps every invasive source disabled after an explicit onboarding skip."""
    async with _async_engine.begin() as connection:
        await connection.execute(text("""
            UPDATE capture_consent
            SET accepted_at = NULL, clipboard = 0, app_window = 0, browser = 0,
                file_activity = 0, screen_content = 0
            WHERE id = 1
        """))
        await connection.execute(text("""
            UPDATE capture_state
            SET is_paused = 1, paused_until = NULL
            WHERE id = 1
        """))
    return {"status": "skipped"}


# ---------------------------------------------------------------------------
# Local custom redaction phrases
# ---------------------------------------------------------------------------


@router.get("/redaction-patterns")
async def get_redaction_patterns() -> dict:
    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text("SELECT id, pattern FROM redaction_patterns ORDER BY created_at ASC, id ASC")
        )
        rows = result.fetchall()
    return {"patterns": [{"id": row.id, "pattern": row.pattern} for row in rows]}


@router.post("/redaction-patterns")
async def add_redaction_pattern(request: RedactionPatternRequest) -> dict:
    import uuid
    from datetime import datetime, timezone

    pattern = request.pattern.strip()
    if not pattern or len(pattern) > 256 or pattern == "[REDACTED:custom]":
        raise HTTPException(status_code=422, detail="Pattern is invalid.")

    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                """
                INSERT OR IGNORE INTO redaction_patterns (id, pattern, created_at)
                VALUES (:id, :pattern, :created_at)
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "pattern": pattern,
                "created_at": int(datetime.now(timezone.utc).timestamp() * 1000),
            },
        )
        result = await connection.execute(
            text("SELECT id, pattern FROM redaction_patterns WHERE pattern = :pattern"),
            {"pattern": pattern},
        )
        row = result.fetchone()

    if row is None:
        raise HTTPException(status_code=500, detail="Could not save pattern.")
    return {"id": row.id, "pattern": row.pattern}


@router.delete("/redaction-patterns/{pattern_id}")
async def remove_redaction_pattern(pattern_id: str) -> dict:
    async with _async_engine.begin() as connection:
        await connection.execute(
            text("DELETE FROM redaction_patterns WHERE id = :id"), {"id": pattern_id}
        )
    return {"status": "ok"}


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

    app_name = normalize_app_name(request.app_name)
    if not app_name:
        raise HTTPException(status_code=422, detail="Enter a valid application name.")

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
            {"id": new_id, "app_name": app_name, "added_at": added_at_ms},
        )
    return {"status": "ok", "app_name": app_name}


@router.delete("/excluded-apps/{app_name}")
async def remove_excluded_app(app_name: str) -> dict:
    normalized_app_name = normalize_app_name(app_name)
    if not normalized_app_name:
        raise HTTPException(status_code=422, detail="Enter a valid application name.")
    async with _async_engine.begin() as connection:
        await connection.execute(
            text("DELETE FROM excluded_apps WHERE app_name = :app_name"),
            {"app_name": normalized_app_name},
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

    domain = normalize_domain(request.domain)
    if domain is None:
        raise HTTPException(status_code=422, detail="Enter a valid domain or URL.")

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
            {"id": new_id, "domain": domain, "added_at": added_at_ms},
        )
    return {"status": "ok", "domain": domain}


@router.delete("/excluded-domains/{domain}")
async def remove_excluded_domain(domain: str) -> dict:
    normalized_domain = normalize_domain(domain)
    if normalized_domain is None:
        raise HTTPException(status_code=422, detail="Enter a valid domain or URL.")
    async with _async_engine.begin() as connection:
        await connection.execute(
            text("DELETE FROM excluded_domains WHERE domain = :domain"),
            {"domain": normalized_domain},
        )
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Native browser capture (osascript — no extension required)
# ---------------------------------------------------------------------------

# These are the exact application names Rust's browser_url.rs polls via
# osascript. Returned to the frontend so the UI can list them statically.
_SUPPORTED_NATIVE_BROWSERS: list[str] = [
    "Google Chrome",
    "Safari",
    "Arc",
    "Brave Browser",
    "Microsoft Edge",
]


@router.get("/browser-capture")
async def get_browser_capture() -> dict:
    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text("SELECT native_enabled FROM browser_capture_settings WHERE id = 1")
        )
        row = result.fetchone()

    return {
        "native_enabled": bool(row.native_enabled) if row else True,
        "browsers": _SUPPORTED_NATIVE_BROWSERS,
    }


@router.post("/browser-capture")
async def set_browser_capture(request: SetBrowserCaptureRequest) -> dict:
    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                "UPDATE browser_capture_settings SET native_enabled = :enabled WHERE id = 1"
            ),
            {"enabled": 1 if request.native_enabled else 0},
        )
        await connection.execute(text("UPDATE capture_consent SET browser = :enabled WHERE id = 1"), {"enabled": int(request.native_enabled)})
    return {"native_enabled": request.native_enabled}


# ---------------------------------------------------------------------------
# On-screen content capture (AXUIElement — macOS Accessibility API)
# ---------------------------------------------------------------------------


@router.get("/screen-content")
async def get_screen_content() -> dict:
    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text("SELECT enabled FROM screen_content_settings WHERE id = 1")
        )
        row = result.fetchone()
    return {"enabled": bool(row.enabled) if row else True}


@router.post("/screen-content")
async def set_screen_content(request: SetScreenContentRequest) -> dict:
    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                "UPDATE screen_content_settings SET enabled = :enabled WHERE id = 1"
            ),
            {"enabled": 1 if request.enabled else 0},
        )
        await connection.execute(text("UPDATE capture_consent SET screen_content = :enabled WHERE id = 1"), {"enabled": int(request.enabled)})
    return {"enabled": request.enabled}


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
        return {"enabled": False, "watched_folders": []}

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
        await connection.execute(text("UPDATE capture_consent SET file_activity = :enabled WHERE id = 1"), {"enabled": int(request.enabled)})
    return {"enabled": request.enabled}


@router.post("/watched-folders")
async def add_watched_folder(request: AddWatchedFolderRequest) -> dict:
    import json as _json

    folder = normalize_folder_path(request.folder)
    if folder is None:
        raise HTTPException(status_code=422, detail="Enter an absolute folder path.")

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

    folder = normalize_folder_path(request.folder)
    if folder is None:
        raise HTTPException(status_code=422, detail="Enter an absolute folder path.")

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
    and clears all Qdrant embeddings.

    What is NOT wiped:
    - capture_state — pause preference survives the wipe.
    - excluded_apps and excluded_domains — these are privacy *settings*, not
      captured *data*. Wiping them would mean 1Password, Bitwarden, and the
      user's personal websites could be inadvertently captured immediately
      after a wipe, before the user notices and re-adds them.
    """
    from database import _seed_default_excluded_apps, _seed_default_excluded_domains

    async with _async_engine.begin() as connection:
        # Delete child tables before parents to satisfy foreign key ordering,
        # even though SQLite doesn't enforce FK constraints by default.
        await connection.execute(text("DELETE FROM memory_objects"))
        await connection.execute(text("DELETE FROM events_fts"))
        await connection.execute(text("DELETE FROM events"))
        await connection.execute(text("DELETE FROM sessions"))
        # Pairing credentials authorize access to captured data, so a full wipe
        # revokes them too. The extension must be explicitly paired again.
        await connection.execute(text("DELETE FROM paired_extensions"))

    # Remove all vector embeddings from the local Qdrant collection.
    await wipe_all_session_embeddings()

    # Re-seed default excluded apps and domains in case the user had emptied
    # those lists before the wipe. Both functions are no-ops when rows are
    # already present — they only insert when the table is completely empty.
    await _seed_default_excluded_apps()
    await _seed_default_excluded_domains()

    logger.warning("Full memory wipe completed — all user data deleted.")
    return {"status": "ok", "message": "All memory wiped"}
