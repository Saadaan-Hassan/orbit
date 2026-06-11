"""
APScheduler background job runner.

AsyncIOScheduler runs generate_sessions_from_recent_events() every 30 minutes
on the FastAPI event loop. The scheduler is started and shut down from
main.py's lifespan context manager.
"""

import json
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv
from sqlalchemy import text

from database import _async_engine
from services.analytics_service import capture_analytics_event
from services.claude_service import generate_session_summary
from services.gemini_service import classify_events_batch
from services.qdrant_service import add_session_embedding, initialize_qdrant_collection

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# How far back the main query looks for unprocessed events each run.
EVENT_LOOKBACK_SECONDS = 60 * 60  # 60 minutes

# Events older than this with a null session_id are force-processed so they
# never get permanently stuck (e.g. if the app was closed mid-session or a
# previous scheduler run failed).
STALE_EVENT_FORCE_PROCESS_SECONDS = 2 * 60 * 60  # 2 hours

# Minimum events in a project group to justify generating a session summary.
MINIMUM_EVENTS_FOR_SESSION = 5

SESSION_SUMMARY_SYSTEM_PROMPT = (
    "You are summarizing a user's work session from their captured activity. "
    "Be concise and specific. Output valid JSON only. No markdown, no preamble."
)

SESSION_SUMMARY_USER_PROMPT_TEMPLATE = """\
Here are the user's captured activities for the last 30-60 minutes:
{events_json}

Event types and their fields:
- "window" / "clipboard" / "url": raw_content, app_name, url
- "page_content": title (page headline), page_text (article body), author, site_name, url
- "search_query": query (what they typed into the search box), search_engine
- "link_click": link_text (visible anchor text), link_target (destination URL)
- "file_activity": file_path (full path of the file), action (created/modified/removed)
- "app_lifecycle": app_name, action (launched/quit)

File edits (file_activity events) are the strongest signal of what the user was building or changing — name specific files in your summary and weight them as primary evidence over window titles.
Use page_text to understand what was read. Use query to understand what was being looked up.
Write summaries like "read an article by Jane Doe about vector databases" — not "visited a website."

Respond with this exact JSON structure:
{{
  "project_name": "detected project name or null",
  "goal": "one sentence: what the user was trying to accomplish",
  "summary": "2-3 sentences describing what happened — name specific articles, searches, or resources",
  "key_resources": ["important URLs or file paths"],
  "last_action": "the most recent meaningful thing the user did",
  "topics": ["subjects the user engaged with, e.g. 'vector databases', 'React hooks', 'tax filing'"]
}}"""

# ---------------------------------------------------------------------------
# Schema migration helper
# ---------------------------------------------------------------------------

async def _ensure_events_schema_columns_exist() -> None:
    """
    Adds session_id and category columns to the events table when absent.

    SQLite does not support IF NOT EXISTS on ALTER TABLE, so we inspect
    PRAGMA table_info first and only ALTER for missing columns.
    """
    async with _async_engine.begin() as connection:
        pragma_rows = await connection.execute(text("PRAGMA table_info(events)"))
        existing_column_names = {row[1] for row in pragma_rows.fetchall()}

        if "session_id" not in existing_column_names:
            await connection.execute(
                text("ALTER TABLE events ADD COLUMN session_id TEXT")
            )
            logger.info("Added session_id column to events table.")

        if "category" not in existing_column_names:
            await connection.execute(
                text("ALTER TABLE events ADD COLUMN category TEXT")
            )
            logger.info("Added category column to events table.")

        if "page_text" not in existing_column_names:
            await connection.execute(
                text("ALTER TABLE events ADD COLUMN page_text TEXT")
            )
            logger.info("Added page_text column to events table.")

        if "link_target" not in existing_column_names:
            await connection.execute(
                text("ALTER TABLE events ADD COLUMN link_target TEXT")
            )
            logger.info("Added link_target column to events table.")

        if "metadata" not in existing_column_names:
            await connection.execute(
                text("ALTER TABLE events ADD COLUMN metadata TEXT")
            )
            logger.info("Added metadata column to events table.")

        if "file_path" not in existing_column_names:
            await connection.execute(
                text("ALTER TABLE events ADD COLUMN file_path TEXT")
            )
            logger.info("Added file_path column to events table.")

        if "is_user_active" not in existing_column_names:
            await connection.execute(
                text("ALTER TABLE events ADD COLUMN is_user_active INTEGER")
            )
            logger.info("Added is_user_active column to events table.")


async def _ensure_sessions_schema_columns_exist() -> None:
    """Adds topics column to sessions when absent (existing databases)."""
    async with _async_engine.begin() as connection:
        pragma_rows = await connection.execute(text("PRAGMA table_info(sessions)"))
        existing_column_names = {row[1] for row in pragma_rows.fetchall()}

        if "topics" not in existing_column_names:
            await connection.execute(
                text("ALTER TABLE sessions ADD COLUMN topics TEXT")
            )
            logger.info("Added topics column to sessions table.")

        if "active_minutes" not in existing_column_names:
            await connection.execute(
                text("ALTER TABLE sessions ADD COLUMN active_minutes INTEGER")
            )
            logger.info("Added active_minutes column to sessions table.")


# ---------------------------------------------------------------------------
# Session generation helper — runs once per project group
# ---------------------------------------------------------------------------

async def _generate_session_for_events(project_events: list[dict]) -> None:
    """
    Summarises one project's classified events with Claude, persists the
    Session row, embeds it in Qdrant, and marks all events as processed.

    Called once per distinct project group detected by Gemini.
    project_events must be sorted by timestamp ASC (guaranteed by the parent
    function's SQL ORDER BY).

    raw_content is included in the Claude prompt for all event types. All
    secrets are already redacted by Rust's capture layer before any SQLite
    write — what reaches this function is either safe plaintext or a
    [REDACTED:<type>] placeholder. Claude needs the actual content to write
    useful summaries; app names alone are not enough.
    """
    # ------------------------------------------------------------------
    # Build Claude prompt — type-aware payload so Claude sees the richest
    # available representation for each event type.
    # raw_content is already safe at this point (redacted at capture).
    # ------------------------------------------------------------------
    events_payload_for_prompt = []
    for event in project_events:
        event_type = event.get("type", "")

        # Parse the metadata JSON blob once per event — it carries author,
        # site_name, search_engine etc. depending on the event type.
        metadata_raw = event.get("metadata")
        metadata: dict = {}
        if metadata_raw:
            try:
                metadata = (
                    json.loads(metadata_raw)
                    if isinstance(metadata_raw, str)
                    else metadata_raw
                )
            except Exception:
                pass

        shared_fields = {
            "id":       event.get("id"),
            "type":     event_type,
            "app_name": event.get("app_name") or "",
            "url":      event.get("url") or "",
            "category": event.get("category") or "",
        }

        if event_type == "page_content":
            page_text = (event.get("page_text") or "").strip()
            events_payload_for_prompt.append({
                **shared_fields,
                "title":     event.get("raw_content") or "",
                "page_text": page_text[:500],
                "author":    metadata.get("author"),
                "site_name": metadata.get("site_name"),
            })
        elif event_type == "search_query":
            events_payload_for_prompt.append({
                **shared_fields,
                "query":         event.get("raw_content") or "",
                "search_engine": metadata.get("search_engine"),
            })
        elif event_type == "link_click":
            events_payload_for_prompt.append({
                **shared_fields,
                "link_text":   event.get("raw_content") or "",
                "link_target": event.get("link_target") or "",
            })
        elif event_type == "file_activity":
            events_payload_for_prompt.append({
                **shared_fields,
                "file_path": event.get("file_path") or event.get("raw_content") or "",
                "action":    metadata.get("action", "modified"),
            })
        else:
            # window, clipboard, url, app_lifecycle
            events_payload_for_prompt.append({
                **shared_fields,
                "raw_content": event.get("raw_content") or "",
            })

    user_prompt = SESSION_SUMMARY_USER_PROMPT_TEMPLATE.format(
        events_json=json.dumps(events_payload_for_prompt, ensure_ascii=False, indent=2)
    )

    logger.info("Session generator: requesting Claude summary for %d event(s).", len(project_events))

    try:
        raw_claude_response = await generate_session_summary(
            system_prompt=SESSION_SUMMARY_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        )
    except Exception as claude_error:
        logger.error(
            "Session generator: Claude request failed: %s. Skipping this group.",
            claude_error,
        )
        return

    # ------------------------------------------------------------------
    # Parse Claude's JSON response
    # ------------------------------------------------------------------
    cleaned_response = raw_claude_response.strip()
    if cleaned_response.startswith("```"):
        cleaned_response = cleaned_response.split("\n", 1)[-1]
        cleaned_response = cleaned_response.rsplit("```", 1)[0].strip()

    try:
        session_data = json.loads(cleaned_response)
    except json.JSONDecodeError as json_parse_error:
        logger.error(
            "Session generator: failed to parse Claude JSON: %s. Raw: %.200s",
            json_parse_error,
            raw_claude_response,
        )
        return

    # ------------------------------------------------------------------
    # Persist the Session row
    # ------------------------------------------------------------------
    new_session_id          = str(uuid.uuid4())
    session_start_timestamp = project_events[0]["timestamp"]
    session_end_timestamp   = project_events[-1]["timestamp"]

    project_name  = session_data.get("project_name")
    goal          = session_data.get("goal")
    ai_summary    = session_data.get("summary", "")
    last_action   = session_data.get("last_action")
    key_resources = json.dumps(session_data.get("key_resources", []))
    topics        = json.dumps(session_data.get("topics", []))

    # Each window poll covers a 30-second interval; counting polls where the
    # user was active gives a lower-bound estimate of actual work time.
    # is_user_active is set by the idle timer in window.rs — it never captures
    # keystrokes, only the elapsed-seconds-since-last-input value.
    active_window_poll_count = sum(
        1 for event in project_events
        if event.get("type") == "window" and event.get("is_user_active") == 1
    )
    active_minutes = active_window_poll_count * 30 // 60

    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                """
                INSERT INTO sessions
                    (id, start_time, end_time, project_name, goal, ai_summary,
                     last_action, key_resources, topics, active_minutes)
                VALUES
                    (:id, :start_time, :end_time, :project_name, :goal, :ai_summary,
                     :last_action, :key_resources, :topics, :active_minutes)
                """
            ),
            {
                "id":             new_session_id,
                "start_time":     session_start_timestamp,
                "end_time":       session_end_timestamp,
                "project_name":   project_name,
                "goal":           goal,
                "ai_summary":     ai_summary,
                "last_action":    last_action,
                "key_resources":  key_resources,
                "topics":         topics,
                "active_minutes": active_minutes,
            },
        )

    logger.info(
        "Session generator: created session %s — project=%s goal=%s",
        new_session_id, project_name, goal,
    )

    # ------------------------------------------------------------------
    # Embed the session summary in Qdrant
    # ------------------------------------------------------------------
    topics_list = session_data.get("topics", [])

    embedding_text = " | ".join(
        filter(None, [
            project_name,
            goal,
            ai_summary,
            session_data.get("last_action"),
            " ".join(session_data.get("key_resources", [])),
            # Topics give the vector the subject vocabulary the user engaged with —
            # critical for "what was I researching about X" queries.
            " ".join(topics_list),
        ])
    )

    embedding_metadata = {
        "session_id":     new_session_id,
        "project_name":   project_name,
        "goal":           goal,
        "ai_summary":     ai_summary,
        "last_action":    session_data.get("last_action"),
        "key_resources":  session_data.get("key_resources", []),
        "topics":         topics_list,
        "start_time":     session_start_timestamp,
        "end_time":       session_end_timestamp,
        "active_minutes": active_minutes,
    }

    try:
        await add_session_embedding(
            session_id=new_session_id,
            summary_text=embedding_text,
            metadata=embedding_metadata,
        )
        async with _async_engine.begin() as connection:
            await connection.execute(
                text("UPDATE sessions SET embedding_id = :eid WHERE id = :sid"),
                {"eid": new_session_id, "sid": new_session_id},
            )
    except Exception as embedding_error:
        logger.warning(
            "Session generator: Qdrant upsert failed for session %s: %s. "
            "Session is saved in SQLite; semantic search will not include it.",
            new_session_id, embedding_error,
        )

    # ------------------------------------------------------------------
    # Mark all events in this group as processed
    # ------------------------------------------------------------------
    event_ids = [event["id"] for event in project_events]
    id_placeholders = ", ".join(f":id_{i}" for i in range(len(event_ids)))
    id_bindings     = {f"id_{i}": eid for i, eid in enumerate(event_ids)}

    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                f"UPDATE events SET session_id = :session_id "
                f"WHERE id IN ({id_placeholders})"
            ),
            {"session_id": new_session_id, **id_bindings},
        )

    capture_analytics_event("session_generated", {
        "event_count":       len(project_events),
        "project_detected":  bool(project_name),
    })

    logger.info(
        "Session generator: marked %d event(s) with session_id %s.",
        len(event_ids), new_session_id,
    )


# ---------------------------------------------------------------------------
# System-state boundary helpers
# ---------------------------------------------------------------------------

def _parse_system_state_from_event(event: dict) -> str:
    """Extracts the state string from a system_state event's metadata JSON."""
    metadata_raw = event.get("metadata")
    if not metadata_raw:
        return event.get("raw_content") or ""
    try:
        metadata = (
            json.loads(metadata_raw) if isinstance(metadata_raw, str) else metadata_raw
        )
        return metadata.get("state") or event.get("raw_content") or ""
    except Exception:
        return event.get("raw_content") or ""


def _split_events_at_system_boundaries(
    all_events: list[dict],
) -> tuple[list[list[dict]], list[str]]:
    """
    Walks the chronologically-sorted event list and splits content events at
    lock/sleep system_state boundaries. Each lock/sleep ends the current batch;
    content events that follow accumulate into the next batch automatically.

    Returns:
        content_batches        — one list[dict] per continuous work segment,
                                 with all system_state events excluded.
        system_state_event_ids — IDs of all system_state events so the caller
                                 can mark them with session_id='system_boundary'.
    """
    content_batches: list[list[dict]] = []
    system_state_event_ids: list[str] = []
    current_batch: list[dict] = []

    for event in all_events:
        if event.get("type") == "system_state":
            system_state_event_ids.append(event["id"])
            state = _parse_system_state_from_event(event)
            if state in ("lock", "sleep"):
                # End the current work segment here.
                if current_batch:
                    content_batches.append(current_batch)
                    current_batch = []
            # unlock/wake: no split — content events that follow naturally
            # accumulate into the next batch.
        else:
            current_batch.append(event)

    # Flush the final (or only) content batch.
    if current_batch:
        content_batches.append(current_batch)

    return content_batches, system_state_event_ids


# ---------------------------------------------------------------------------
# Core job
# ---------------------------------------------------------------------------

async def generate_sessions_from_recent_events() -> None:
    """
    Fetches unprocessed events, classifies them with Gemini, groups by
    project, and generates one session per project group via Claude + Qdrant.

    Two event sets are fetched and merged each run:
      1. Recent events from the last 60 minutes (normal cadence).
      2. Stale events older than 2 hours that still have no session_id
         (force-process guard — prevents events getting permanently stuck).
    """
    logger.info("Session generator: starting run.")

    await _ensure_events_schema_columns_exist()
    await _ensure_sessions_schema_columns_exist()
    await initialize_qdrant_collection()

    # ------------------------------------------------------------------
    # Step 1 — Fetch unprocessed events: recent + stale force-process
    # ------------------------------------------------------------------
    current_utc_ms          = int(datetime.now(timezone.utc).timestamp() * 1000)
    recent_cutoff_ms        = current_utc_ms - EVENT_LOOKBACK_SECONDS * 1000
    stale_force_cutoff_ms   = current_utc_ms - STALE_EVENT_FORCE_PROCESS_SECONDS * 1000

    async with _async_engine.connect() as connection:
        # Recent events (last 60 min, unprocessed)
        recent_rows = await connection.execute(
            text(
                """
                SELECT id, timestamp, type, raw_content, app_name, url, source,
                       page_text, link_target, metadata, file_path, is_user_active
                FROM   events
                WHERE  timestamp >= :cutoff
                AND    (session_id IS NULL OR session_id = '')
                ORDER  BY timestamp ASC
                """
            ),
            {"cutoff": recent_cutoff_ms},
        )
        recent_events = [dict(row._mapping) for row in recent_rows.fetchall()]

        # Stale events (older than 2 h, still unprocessed)
        stale_rows = await connection.execute(
            text(
                """
                SELECT id, timestamp, type, raw_content, app_name, url, source,
                       page_text, link_target, metadata, file_path, is_user_active
                FROM   events
                WHERE  timestamp < :stale_cutoff
                AND    (session_id IS NULL OR session_id = '')
                ORDER  BY timestamp ASC
                """
            ),
            {"stale_cutoff": stale_force_cutoff_ms},
        )
        stale_events = [dict(row._mapping) for row in stale_rows.fetchall()]

    # Merge, dedup by id (1–2 h window can appear in both queries), re-sort.
    seen_ids = {e["id"] for e in recent_events}
    for event in stale_events:
        if event["id"] not in seen_ids:
            recent_events.append(event)
            seen_ids.add(event["id"])

    unprocessed_events = sorted(recent_events, key=lambda e: e["timestamp"])

    if stale_events:
        logger.info(
            "Session generator: force-processing %d stale event(s) (>2 h old, unprocessed).",
            len(stale_events),
        )

    # ------------------------------------------------------------------
    # Step 2 — Guard: skip if too few events for a useful session
    # ------------------------------------------------------------------
    if len(unprocessed_events) < MINIMUM_EVENTS_FOR_SESSION:
        logger.info(
            "Session generator: only %d event(s) found (minimum %d). Skipping.",
            len(unprocessed_events),
            MINIMUM_EVENTS_FOR_SESSION,
        )
        return

    # ------------------------------------------------------------------
    # Step 3 — Split at system_state boundaries; mark boundary events done
    # ------------------------------------------------------------------
    content_batches, system_state_event_ids = _split_events_at_system_boundaries(
        unprocessed_events
    )

    # Mark system_state events as processed immediately so they don't
    # re-accumulate in the unprocessed queue on the next scheduler run.
    if system_state_event_ids:
        async with _async_engine.begin() as connection:
            ss_placeholders = ", ".join(
                f":ssid_{i}" for i in range(len(system_state_event_ids))
            )
            ss_bindings = {
                f"ssid_{i}": eid for i, eid in enumerate(system_state_event_ids)
            }
            await connection.execute(
                text(
                    f"UPDATE events SET session_id = 'system_boundary' "
                    f"WHERE id IN ({ss_placeholders})"
                ),
                ss_bindings,
            )
        logger.info(
            "Session generator: marked %d system_state event(s) as boundaries.",
            len(system_state_event_ids),
        )

    if len(content_batches) > 1:
        logger.info(
            "Session generator: %d lock/sleep boundary/ies split %d content event(s) "
            "into %d independent batch(es).",
            len(system_state_event_ids),
            sum(len(b) for b in content_batches),
            len(content_batches),
        )

    total_content_events = sum(len(batch) for batch in content_batches)
    if total_content_events < MINIMUM_EVENTS_FOR_SESSION:
        logger.info(
            "Session generator: only %d content event(s) after boundary extraction "
            "(minimum %d). Skipping.",
            total_content_events,
            MINIMUM_EVENTS_FOR_SESSION,
        )
        return

    # ------------------------------------------------------------------
    # Step 4 — For each time-bounded batch: classify → group → summarise
    # ------------------------------------------------------------------
    sessions_generated = 0

    for batch_index, batch_events in enumerate(content_batches):
        if len(batch_events) < MINIMUM_EVENTS_FOR_SESSION:
            logger.info(
                "Session generator: batch %d/%d has only %d event(s) — skipping.",
                batch_index + 1, len(content_batches), len(batch_events),
            )
            continue

        logger.info(
            "Session generator: classifying batch %d/%d (%d event(s)) with Gemini.",
            batch_index + 1, len(content_batches), len(batch_events),
        )

        classified_batch = await classify_events_batch(batch_events)

        async with _async_engine.begin() as connection:
            for event in classified_batch:
                await connection.execute(
                    text("UPDATE events SET category = :category WHERE id = :id"),
                    {"category": event.get("category"), "id": event["id"]},
                )

        # Gemini returns a "project" key on each classified event (may be None).
        project_groups: dict[str | None, list[dict]] = defaultdict(list)
        for event in classified_batch:
            project_groups[event.get("project") or None].append(event)

        if len(project_groups) > 1:
            logger.info(
                "Session generator: batch %d/%d — %d distinct project(s) detected.",
                batch_index + 1, len(content_batches), len(project_groups),
            )

        for project_key, group_events in project_groups.items():
            if len(group_events) < MINIMUM_EVENTS_FOR_SESSION:
                logger.info(
                    "Session generator: skipping project '%s' in batch %d/%d — "
                    "only %d event(s) (minimum %d).",
                    project_key, batch_index + 1, len(content_batches),
                    len(group_events), MINIMUM_EVENTS_FOR_SESSION,
                )
                continue

            await _generate_session_for_events(group_events)
            sessions_generated += 1

    if sessions_generated == 0:
        logger.info("Session generator: no project group reached the event minimum. Run complete.")
    else:
        logger.info(
            "Session generator: generated %d session(s) this run. Complete.",
            sessions_generated,
        )


# ---------------------------------------------------------------------------
# Scheduler factory
# ---------------------------------------------------------------------------

def create_session_scheduler() -> AsyncIOScheduler:
    """
    Builds and returns a configured AsyncIOScheduler.

    The caller (main.py lifespan) is responsible for .start() and .shutdown().
    next_run_time is set to now so the first run happens immediately on startup
    rather than after a 30-minute wait.
    """
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        generate_sessions_from_recent_events,
        trigger="interval",
        minutes=30,
        id="generate_sessions",
        name="Generate sessions from recent activity events",
        next_run_time=datetime.now(timezone.utc),
    )
    return scheduler
