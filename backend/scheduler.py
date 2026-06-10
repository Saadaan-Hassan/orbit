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

Respond with this exact JSON structure:
{{
  "project_name": "detected project name or null",
  "goal": "one sentence: what the user was trying to accomplish",
  "summary": "2-3 sentences describing what happened",
  "key_resources": ["list of important URLs or files mentioned"],
  "last_action": "the most recent meaningful thing the user did"
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
    # Build Claude prompt — include all fields, all event types.
    # raw_content is already safe at this point (redacted at capture).
    # ------------------------------------------------------------------
    events_payload_for_prompt = [
        {
            "id":          event.get("id"),
            "type":        event.get("type"),
            "raw_content": event.get("raw_content") or "",
            "app_name":    event.get("app_name") or "",
            "url":         event.get("url") or "",
            "category":    event.get("category") or "",
        }
        for event in project_events
    ]

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

    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                """
                INSERT INTO sessions
                    (id, start_time, end_time, project_name, goal, ai_summary,
                     last_action, key_resources)
                VALUES
                    (:id, :start_time, :end_time, :project_name, :goal, :ai_summary,
                     :last_action, :key_resources)
                """
            ),
            {
                "id":            new_session_id,
                "start_time":    session_start_timestamp,
                "end_time":      session_end_timestamp,
                "project_name":  project_name,
                "goal":          goal,
                "ai_summary":    ai_summary,
                "last_action":   last_action,
                "key_resources": key_resources,
            },
        )

    logger.info(
        "Session generator: created session %s — project=%s goal=%s",
        new_session_id, project_name, goal,
    )

    # ------------------------------------------------------------------
    # Embed the session summary in Qdrant
    # ------------------------------------------------------------------
    embedding_text = " | ".join(
        filter(None, [
            project_name,
            goal,
            ai_summary,
            session_data.get("last_action"),
            " ".join(session_data.get("key_resources", [])),
        ])
    )

    embedding_metadata = {
        "session_id":    new_session_id,
        "project_name":  project_name,
        "goal":          goal,
        "ai_summary":    ai_summary,
        "last_action":   session_data.get("last_action"),
        "key_resources": session_data.get("key_resources", []),
        "start_time":    session_start_timestamp,
        "end_time":      session_end_timestamp,
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
                SELECT id, timestamp, type, raw_content, app_name, url, source
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
                SELECT id, timestamp, type, raw_content, app_name, url, source
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

    logger.info(
        "Session generator: classifying %d event(s) with Gemini.",
        len(unprocessed_events),
    )

    # ------------------------------------------------------------------
    # Step 3 — Classify events with Gemini and persist categories
    # ------------------------------------------------------------------
    classified_events = await classify_events_batch(unprocessed_events)

    async with _async_engine.begin() as connection:
        for event in classified_events:
            await connection.execute(
                text("UPDATE events SET category = :category WHERE id = :id"),
                {"category": event.get("category"), "id": event["id"]},
            )

    # ------------------------------------------------------------------
    # Step 4 — Group by project and generate one session per group
    # ------------------------------------------------------------------
    # Gemini returns a "project" key on each classified event (may be None).
    # Treating None as its own bucket lets stray events accumulate until
    # they reach MINIMUM_EVENTS_FOR_SESSION across runs.
    project_groups: dict[str | None, list[dict]] = defaultdict(list)
    for event in classified_events:
        project_groups[event.get("project") or None].append(event)

    if len(project_groups) > 1:
        logger.info(
            "Session generator: detected %d distinct project(s) — generating separate sessions.",
            len(project_groups),
        )

    sessions_generated = 0
    for project_key, group_events in project_groups.items():
        if len(group_events) < MINIMUM_EVENTS_FOR_SESSION:
            logger.info(
                "Session generator: skipping project '%s' — only %d event(s) (minimum %d).",
                project_key,
                len(group_events),
                MINIMUM_EVENTS_FOR_SESSION,
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
