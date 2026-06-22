"""
Capture endpoints — receive activity events and write them to SQLite.

Pause and exclude filtering is enforced at two layers:
- HERE (FastAPI): gates events arriving from the Chrome extension.
- Rust (clipboard.rs, window.rs): each capture task reads capture_state and
  excluded_apps from SQLite directly, with a 30-second local cache, before
  every write. Both layers must agree for the controls to be effective.
"""

import asyncio
import json
import time
import logging
from dataclasses import dataclass, field
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from models.event import CaptureEvent
from database import get_db, _async_engine
from services.redaction_service import redact_sensitive_content

router = APIRouter()
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory filter cache
#
# Refreshed from SQLite at most once every 30 seconds. This keeps the hot
# path (every captured event) free of synchronous DB round-trips while still
# picking up pause/resume and exclude-list changes within half a minute.
# ---------------------------------------------------------------------------

_CACHE_TTL_SECONDS = 30.0

# When both native_browser capture and the Chrome extension are active, the
# same URL can be recorded within seconds of each other. We deduplicate by
# keeping the extension event (richer — may be followed by page_content) and
# dropping or replacing the native_browser one.
_URL_DEDUP_WINDOW_MS = 10_000  # 10 seconds


@dataclass
class _CaptureFilterCache:
    is_paused: bool = False
    paused_until_ms: int | None = None        # None means indefinite
    excluded_app_names: set[str] = field(default_factory=set)
    excluded_domains: set[str] = field(default_factory=set)
    last_refreshed_at: float = 0.0            # monotonic seconds


_filter_cache = _CaptureFilterCache()
_cache_refresh_lock = asyncio.Lock()


async def _refresh_cache_if_stale() -> None:
    """
    Reloads pause state and excluded apps from SQLite if the cached copy is
    older than _CACHE_TTL_SECONDS. Uses a lock so concurrent requests don't
    all hit the DB at the same time when the cache first goes stale.
    """
    now = time.monotonic()
    if now - _filter_cache.last_refreshed_at < _CACHE_TTL_SECONDS:
        return  # Cache is still fresh — skip the DB round-trip.

    async with _cache_refresh_lock:
        # Re-check after acquiring the lock — another coroutine may have
        # already refreshed while we were waiting.
        if time.monotonic() - _filter_cache.last_refreshed_at < _CACHE_TTL_SECONDS:
            return

        async with _async_engine.connect() as connection:
            pause_result = await connection.execute(
                text("SELECT is_paused, paused_until FROM capture_state WHERE id = 1")
            )
            pause_row = pause_result.fetchone()

            exclude_result = await connection.execute(
                text("SELECT app_name FROM excluded_apps")
            )
            excluded_rows = exclude_result.fetchall()

            # excluded_domains must be queried inside the same open connection.
            # Previously this ran after the `async with` block closed, causing
            # a "connection already released" error that was silently caught and
            # left excluded_domains permanently empty.
            try:
                domain_result = await connection.execute(
                    text("SELECT domain FROM excluded_domains")
                )
                domain_rows = domain_result.fetchall()
            except Exception:
                domain_rows = []

        _filter_cache.is_paused = bool(pause_row.is_paused) if pause_row else False
        _filter_cache.paused_until_ms = pause_row.paused_until if pause_row else None
        _filter_cache.excluded_app_names = {row.app_name for row in excluded_rows}
        _filter_cache.excluded_domains = {row.domain for row in domain_rows}
        _filter_cache.last_refreshed_at = time.monotonic()


def _extract_domain(url: str) -> str | None:
    """Returns the netloc (e.g. 'example.com') from a URL, or None on failure."""
    try:
        return urlparse(url).netloc or None
    except Exception:
        return None


async def _find_recent_url_event(
    db: AsyncSession,
    url: str,
    current_timestamp_ms: int,
) -> dict | None:
    """
    Returns the id and source of the most recent url-type event with the same
    URL within _URL_DEDUP_WINDOW_MS, or None if no such event exists.
    Uses the idx_events_url_timestamp index for efficiency.
    """
    result = await db.execute(
        text("""
            SELECT id, source
            FROM   events
            WHERE  type      = 'url'
              AND  url       = :url
              AND  timestamp >= :window_start
            ORDER  BY timestamp DESC
            LIMIT  1
        """),
        {
            "url":          url,
            "window_start": current_timestamp_ms - _URL_DEDUP_WINDOW_MS,
        },
    )
    row = result.fetchone()
    if row is None:
        return None
    mapping = row._mapping
    return {"id": mapping["id"], "source": mapping["source"]}


def _capture_is_currently_paused() -> bool:
    """
    Returns True if capture is paused right now, taking paused_until into account.
    paused_until=None means paused indefinitely.
    """
    if not _filter_cache.is_paused:
        return False
    if _filter_cache.paused_until_ms is None:
        return True  # Paused indefinitely.
    now_ms = int(time.time() * 1000)
    return _filter_cache.paused_until_ms > now_ms


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/capture")
async def capture_event(
    event: CaptureEvent,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await _refresh_cache_if_stale()

    if _capture_is_currently_paused():
        return {"status": "paused"}

    if event.app_name and event.app_name in _filter_cache.excluded_app_names:
        return {"status": "excluded"}

    # file_activity events carry the responsible app in metadata.app_name rather
    # than (or in addition to) the top-level app_name field. Check it separately
    # so files written by excluded apps (e.g. 1Password) are not recorded.
    if event.type == "file_activity" and event.metadata:
        file_event_app = event.metadata.get("app_name")
        if file_event_app and file_event_app in _filter_cache.excluded_app_names:
            return {"status": "excluded"}

    if event.url:
        domain = _extract_domain(event.url)
        if domain and domain in _filter_cache.excluded_domains:
            return {"status": "excluded"}

    # Deduplicate url-type events: when both native_browser capture and the
    # Chrome extension fire for the same URL within 10 seconds, the extension
    # event is richer (it is followed by a page_content event with article
    # body). We keep the extension source and drop or replace the native one.
    if event.type == "url" and event.url:
        existing = await _find_recent_url_event(db, event.url, event.timestamp)
        if existing is not None:
            if existing["source"] == "extension" and event.source == "native_browser":
                # Extension event already in DB — drop the native duplicate.
                return {"status": "deduplicated"}
            elif existing["source"] == "native_browser" and event.source == "extension":
                # Extension event arrived slightly later but is richer — remove
                # the native event and let this one proceed to the INSERT below.
                await db.execute(
                    text("DELETE FROM events WHERE id = :id"),
                    {"id": existing["id"]},
                )

    # page_text carries extracted article body — redact secrets before storing.
    # raw_content for search_query events is the typed search term, which could
    # contain a pasted secret. screen_text carries accessibility-captured on-screen
    # text, also sourced outside the Rust redaction layer. All three fields are
    # redacted inline before any DB write.
    page_text_to_store = event.page_text
    if event.type == "page_content" and page_text_to_store:
        page_text_to_store = redact_sensitive_content(page_text_to_store)

    raw_content_to_store = event.raw_content
    if event.type == "search_query" and raw_content_to_store:
        raw_content_to_store = redact_sensitive_content(raw_content_to_store)

    screen_text_to_store = event.screen_text
    if event.type == "screen_content" and screen_text_to_store:
        screen_text_to_store = redact_sensitive_content(screen_text_to_store)

    await db.execute(
        text("""
            INSERT INTO events
                (id, timestamp, type, raw_content, app_name, url, source,
                 page_text, link_target, metadata, file_path, is_user_active,
                 screen_text)
            VALUES
                (:id, :timestamp, :type, :raw_content, :app_name, :url, :source,
                 :page_text, :link_target, :metadata, :file_path, :is_user_active,
                 :screen_text)
        """),
        {
            "id":             event.id,
            "timestamp":      event.timestamp,
            "type":           event.type,
            "raw_content":    raw_content_to_store,
            "app_name":       event.app_name,
            "url":            event.url,
            "source":         event.source,
            "page_text":      page_text_to_store,
            "link_target":    event.link_target,
            "metadata":       json.dumps(event.metadata) if event.metadata is not None else None,
            "file_path":      event.file_path,
            # Pydantic delivers bool | None; SQLite stores INTEGER 1/0/NULL.
            "is_user_active": int(event.is_user_active) if event.is_user_active is not None else None,
            "screen_text":    screen_text_to_store,
        },
    )
    await db.commit()
    return {"status": "ok", "event_id": event.id}


@router.get("/events")
async def get_recent_events(
    limit: int = Query(default=50, ge=1, le=500),
) -> list[dict]:
    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text(
                """
                SELECT id, timestamp, type, raw_content, app_name, url, source
                FROM   events
                ORDER  BY timestamp DESC
                LIMIT  :limit
                """
            ),
            {"limit": limit},
        )
        return [dict(row._mapping) for row in result.fetchall()]
