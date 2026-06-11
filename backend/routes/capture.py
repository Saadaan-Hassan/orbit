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

        _filter_cache.is_paused = bool(pause_row.is_paused) if pause_row else False
        _filter_cache.paused_until_ms = pause_row.paused_until if pause_row else None
        _filter_cache.excluded_app_names = {row.app_name for row in excluded_rows}

        # excluded_domains table is created in Step 4. Load it if it exists;
        # fall back to an empty set so this code path doesn't break before then.
        try:
            domain_result = await connection.execute(
                text("SELECT domain FROM excluded_domains")
            )
            _filter_cache.excluded_domains = {row.domain for row in domain_result.fetchall()}
        except Exception:
            _filter_cache.excluded_domains = set()

        _filter_cache.last_refreshed_at = time.monotonic()


def _extract_domain(url: str) -> str | None:
    """Returns the netloc (e.g. 'example.com') from a URL, or None on failure."""
    try:
        return urlparse(url).netloc or None
    except Exception:
        return None


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

    if event.url:
        domain = _extract_domain(event.url)
        if domain and domain in _filter_cache.excluded_domains:
            return {"status": "excluded"}

    await db.execute(
        text("""
            INSERT INTO events
                (id, timestamp, type, raw_content, app_name, url, source,
                 page_text, link_target, metadata)
            VALUES
                (:id, :timestamp, :type, :raw_content, :app_name, :url, :source,
                 :page_text, :link_target, :metadata)
        """),
        {
            "id":          event.id,
            "timestamp":   event.timestamp,
            "type":        event.type,
            "raw_content": event.raw_content,
            "app_name":    event.app_name,
            "url":         event.url,
            "source":      event.source,
            "page_text":   event.page_text,
            "link_target": event.link_target,
            "metadata":    json.dumps(event.metadata) if event.metadata is not None else None,
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
