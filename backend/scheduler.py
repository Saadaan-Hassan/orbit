"""
APScheduler background job runner.

One job runs every 30 minutes: generate_sessions_from_recent_events().
It consumes raw events from SQLite, classifies them with Gemini, summarises
them with Claude, and persists the result as a Session row + Qdrant embedding.

The scheduler is started and stopped from main.py's lifespan context manager.
"""

import json
import logging
import os
import uuid
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv
from sqlalchemy import text

from database import _async_engine
from services.claude_service import generate_session_summary
from services.gemini_service import classify_events_batch
from services.qdrant_service import upsert_session_embedding

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# How far back to look for unprocessed events on each scheduler run.
EVENT_LOOKBACK_SECONDS = 60 * 60  # 60 minutes

# Minimum number of events required to generate a meaningful session summary.
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

async def _ensure_session_id_column_exists() -> None:
    """
    Adds the session_id column to the events table if it is not already
    present. SQLite does not support IF NOT EXISTS on ALTER TABLE, so we
    check the schema first and skip the ALTER when the column already exists.
    """
    async with _async_engine.begin() as connection:
        pragma_rows = await connection.execute(text("PRAGMA table_info(events)"))
        existing_column_names = {row[1] for row in pragma_rows.fetchall()}

        if "session_id" not in existing_column_names:
            await connection.execute(
                text("ALTER TABLE events ADD COLUMN session_id TEXT")
            )
            logger.info("Added session_id column to events table.")


# ---------------------------------------------------------------------------
# Core job
# ---------------------------------------------------------------------------

async def generate_sessions_from_recent_events() -> None:
    """
    Scheduled job: runs every 30 minutes.

    Fetches unprocessed events from the last 60 minutes, classifies them
    with Gemini, summarises the batch with Claude, persists the Session,
    embeds it in Qdrant, and marks the events as processed.
    """
    logger.info("Scheduler: starting session generation run.")

    await _ensure_session_id_column_exists()

    # ------------------------------------------------------------------
    # Step 1 — Fetch recent unprocessed events
    # ------------------------------------------------------------------
    current_utc_timestamp_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    lookback_cutoff_timestamp_ms = (
        current_utc_timestamp_ms - EVENT_LOOKBACK_SECONDS * 1000
    )

    async with _async_engine.connect() as connection:
        rows = await connection.execute(
            text(
                """
                SELECT id, timestamp, type, raw_content, app_name, url, source
                FROM   events
                WHERE  timestamp >= :cutoff
                AND    (session_id IS NULL OR session_id = '')
                ORDER  BY timestamp ASC
                """
            ),
            {"cutoff": lookback_cutoff_timestamp_ms},
        )
        unprocessed_events = [dict(row._mapping) for row in rows.fetchall()]

    # ------------------------------------------------------------------
    # Step 2 — Guard: skip if too few events for a useful session
    # ------------------------------------------------------------------
    if len(unprocessed_events) < MINIMUM_EVENTS_FOR_SESSION:
        logger.info(
            "Scheduler: only %d event(s) found (minimum %d). Skipping this run.",
            len(unprocessed_events),
            MINIMUM_EVENTS_FOR_SESSION,
        )
        return

    logger.info(
        "Scheduler: classifying %d event(s) with Gemini.", len(unprocessed_events)
    )

    # ------------------------------------------------------------------
    # Step 3 — Classify events with Gemini and persist categories
    # ------------------------------------------------------------------
    classified_events = await classify_events_batch(unprocessed_events)

    async with _async_engine.begin() as connection:
        for classified_event in classified_events:
            await connection.execute(
                text(
                    "UPDATE events SET category = :category WHERE id = :id"
                ),
                {
                    "category": classified_event.get("category"),
                    "id":       classified_event["id"],
                },
            )

    # ------------------------------------------------------------------
    # Step 4 — Build Claude prompt and generate session summary
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
        for event in classified_events
    ]

    user_prompt = SESSION_SUMMARY_USER_PROMPT_TEMPLATE.format(
        events_json=json.dumps(events_payload_for_prompt, ensure_ascii=False, indent=2)
    )

    logger.info("Scheduler: requesting session summary from Claude.")

    try:
        raw_claude_response = await generate_session_summary(
            system_prompt=SESSION_SUMMARY_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        )
    except Exception as claude_error:
        logger.error(
            "Scheduler: Claude summary request failed: %s. Aborting this run.",
            claude_error,
        )
        return

    # ------------------------------------------------------------------
    # Step 5 — Parse Claude's response and persist the Session row
    # ------------------------------------------------------------------
    try:
        session_data = json.loads(raw_claude_response.strip())
    except json.JSONDecodeError as json_error:
        logger.error(
            "Scheduler: failed to parse Claude JSON response: %s. "
            "Raw response: %.200s",
            json_error,
            raw_claude_response,
        )
        return

    new_session_id = str(uuid.uuid4())
    session_start_timestamp_ms = unprocessed_events[0]["timestamp"]
    session_end_timestamp_ms   = unprocessed_events[-1]["timestamp"]

    project_name = session_data.get("project_name")
    goal         = session_data.get("goal")
    ai_summary   = session_data.get("summary", "")

    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                """
                INSERT INTO sessions
                    (id, start_time, end_time, project_name, goal, ai_summary)
                VALUES
                    (:id, :start_time, :end_time, :project_name, :goal, :ai_summary)
                """
            ),
            {
                "id":           new_session_id,
                "start_time":   session_start_timestamp_ms,
                "end_time":     session_end_timestamp_ms,
                "project_name": project_name,
                "goal":         goal,
                "ai_summary":   ai_summary,
            },
        )

    logger.info(
        "Scheduler: created session %s — project=%s goal=%s",
        new_session_id,
        project_name,
        goal,
    )

    # ------------------------------------------------------------------
    # Step 6 — Embed the session summary and store in Qdrant
    # ------------------------------------------------------------------
    # Build a rich text blob so the embedding captures all the context
    # Claude produced, not just the two-line summary.
    full_text_for_embedding = " | ".join(
        filter(
            None,
            [
                project_name,
                goal,
                ai_summary,
                session_data.get("last_action"),
                " ".join(session_data.get("key_resources", [])),
            ],
        )
    )

    embedding_metadata = {
        "session_id":   new_session_id,
        "project_name": project_name,
        "goal":         goal,
        "ai_summary":   ai_summary,
        "last_action":  session_data.get("last_action"),
        "key_resources": session_data.get("key_resources", []),
        "start_time":   session_start_timestamp_ms,
        "end_time":     session_end_timestamp_ms,
    }

    try:
        await upsert_session_embedding(
            session_id=new_session_id,
            embedding_vector=await _get_embedding_vector(full_text_for_embedding),
            metadata=embedding_metadata,
        )

        # Persist the Qdrant point ID back to the sessions row so recall
        # queries can cross-reference SQLite ↔ Qdrant by session UUID.
        async with _async_engine.begin() as connection:
            await connection.execute(
                text("UPDATE sessions SET embedding_id = :eid WHERE id = :sid"),
                {"eid": new_session_id, "sid": new_session_id},
            )
    except Exception as embedding_error:
        logger.warning(
            "Scheduler: Qdrant upsert failed for session %s: %s. "
            "Session is saved in SQLite; semantic search will not include it.",
            new_session_id,
            embedding_error,
        )

    # ------------------------------------------------------------------
    # Step 7 — Mark all processed events as belonging to this session
    # ------------------------------------------------------------------
    processed_event_ids = [event["id"] for event in unprocessed_events]

    # SQLAlchemy's text() doesn't support list binding directly — build
    # the placeholder string explicitly from the known-safe UUID list.
    id_placeholders = ", ".join(f":id_{index}" for index in range(len(processed_event_ids)))
    id_bindings = {
        f"id_{index}": event_id
        for index, event_id in enumerate(processed_event_ids)
    }

    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                f"UPDATE events SET session_id = :session_id "
                f"WHERE id IN ({id_placeholders})"
            ),
            {"session_id": new_session_id, **id_bindings},
        )

    logger.info(
        "Scheduler: marked %d event(s) with session_id %s. Run complete.",
        len(processed_event_ids),
        new_session_id,
    )


async def _get_embedding_vector(text_to_embed: str) -> list[float]:
    """
    Returns a 384-dimensional embedding vector for the given text.

    Placeholder until embedding_service.py is implemented in a later step.
    Uses a deterministic zero vector so the pipeline runs end-to-end now
    and semantic search simply returns no results until real embeddings land.
    """
    # TODO(Phase 1 Step 6): replace with embedding_service.embed_text()
    return [0.0] * 384


# ---------------------------------------------------------------------------
# Scheduler factory
# ---------------------------------------------------------------------------

def create_session_scheduler() -> AsyncIOScheduler:
    """
    Builds and returns a configured AsyncIOScheduler.

    The caller (main.py lifespan) is responsible for calling .start() and
    .shutdown() at the right points in the app lifecycle.
    """
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        generate_sessions_from_recent_events,
        trigger="interval",
        minutes=30,
        id="generate_sessions",
        name="Generate sessions from recent activity events",
        # Run once immediately on startup so the first session is generated
        # without waiting 30 minutes.
        next_run_time=datetime.now(timezone.utc),
    )
    return scheduler
