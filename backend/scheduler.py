"""
APScheduler background job runner.

AsyncIOScheduler runs generate_sessions_from_recent_events() every 30 minutes
on the FastAPI event loop. The scheduler is started and shut down from
main.py's lifespan context manager.
"""

import json
import logging
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv
from sqlalchemy import text

from database import _async_engine
from services.analytics_service import capture_analytics_event
# Claude (services.claude_service) and Gemini (services.gemini_service) are
# unused here — Groq is the sole provider for session generation and
# classification. As of COST-002 the Worker no longer has a /chat or
# /classify route at all (removed, not kill-switched) and holds no
# maintainer-funded key for either provider — restoring them means designing
# a Worker route (auth/BYOK) before this file becomes relevant again, not
# just re-importing SUMMARY_MODEL / generate_session_summary /
# classify_events_batch.
from services.groq_service import classify_events_batch_groq, generate_session_summary_groq
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

# Batch-size ceilings for the Claude fusion call. Batches that exceed either
# limit are split in half chronologically before being sent to Claude.
# These prevent oversized prompts that cause JSON parse failures (the root
# cause of the 149 parse_failed events observed in initial real-world use).
MAX_EVENTS_PER_BATCH = 60
MAX_SIGNAL_CHARS_PER_BATCH = 8_000

FUSION_SESSION_SYSTEM_PROMPT = """\
You reconstruct what a person was doing on their computer during a short work
session, using multiple overlapping signals captured from their machine.

You are like a detective, not a camera. No single signal tells you the whole
story. Each is a partial clue:
- active app + window title = which app and document/file
- on-screen text (screen_content) = what was actually visible/being worked on
- file activity = which files were created or edited
- clipboard = what they copied (often an error, a snippet, a value)
- browser URLs + page content = what they were reading or researching
- search queries = what they were trying to find out
- idle/active = whether they were truly working or the app was just open
- system lock/sleep = when they stepped away

Your job: TRIANGULATE these into a specific, confident description of what the
person was DOING — not a list of apps. Cross-reference signals. The clipboard
snippet often reveals the purpose of the file edit. The open browser tab reveals
what the code change was for. The on-screen text reveals the actual task.

Rules:
- Be specific and concrete. Name the real file, the real topic, the real ticket,
  the real document, the real conversation subject — pulled from the signals.
- Infer the activity from overlapping evidence, but DO NOT invent details that
  no signal supports. If signals conflict or are thin, say what you can support
  and mark uncertainty.
- Distinguish primary activity from incidental noise (a quick Slack check during
  deep coding is not the session's purpose).
- Focus on CONTINUATION: where they were in the work, what the natural next step
  is, and anything they appeared stuck on. This is the most valuable output.
- Ignore anything that looks like a password, secret, or [REDACTED:...] value.
- Use plain language. No technical jargon about how you were given this data.

CRITICAL DISTINCTION — Author vs. Reviewer:
When the user visits external URLs, GitHub repos, or apps they did not build
themselves, they are likely REVIEWING or RESEARCHING, not working on that
project. Signals that indicate REVIEWING:
- link_click events to URLs containing other people's usernames (e.g. github.com/someone_else/)
- page_content from apps with unfamiliar branding or names
- Multiple short visits to different external apps in quick succession
- A "review", "submission", "judging", or "evaluate" pattern in any URL or title

Signals that indicate PRIMARY WORK (what the user is building):
- file_activity events — file edits always mean primary work on their own project
- localhost:XXXX URLs — a local dev server is always their own project
- clipboard content matching file names or code snippets from file_activity events
- screen_content from their IDE or terminal

When both patterns exist in one batch, the PRIMARY WORK signals (file_activity,
localhost) define the main project and set the project_name. The reviewing
activity is secondary context — describe it as "while also reviewing [X]"
not as a separate work stream or the primary focus.

Return ONLY valid JSON. No markdown, no preamble, no explanation outside the JSON.\
"""

FUSION_SESSION_USER_PROMPT_TEMPLATE = """\
Here are the captured signals from one work session, in chronological order.
Each line is one signal. Fields may be empty when a signal type doesn't apply.

{fused_signals}

Reconstruct what this person was doing and return EXACTLY this JSON structure:

{{
  "project_name": "REQUIRED — never null or empty. One short noun phrase that names what this session was about. Rules by activity type: (1) Code / design work → the project or repo name (e.g. 'orbit', 'lain-dain', 'bits-pakistan'). (2) Research / learning → the topic (e.g. 'Arabic Learning', 'System Design Research', 'Arcflow Tutorial'). (3) Communication / outreach → the context (e.g. 'LinkedIn Outreach', 'Haseeb Account Setup', 'Ehtisham Intro Message'). (4) Job search → 'Job Applications'. (5) General browsing → name the primary topic visited. When signals are thin, pick the most specific label the evidence supports rather than returning null.",
  "activity": "WHAT they were primarily doing — building, researching, communicating, or learning — inferred from file edits, localhost activity, IDE/terminal signals, browser content, and screen text. Name real files, topics, contacts, or URLs. If they were also reviewing external content (other people's repos, submitted apps), note it as secondary: 'while also reviewing [X]'. Never describe reviewed-but-not-built projects as the primary work.",
  "evidence": "one short sentence: which signals support this conclusion (e.g. 'file edits to billing.ts + clipboard showing constructEvent + open Stripe webhooks docs')",
  "goal": "one sentence: what they appeared to be trying to accomplish",
  "summary": "2-3 sentences describing how the session unfolded",
  "last_action": "the most recent meaningful thing they did before the session ended — be specific, this is what helps them remember where they stopped",
  "next_step": "the most likely next action to continue this work, inferred from where they left off. If genuinely unclear, null.",
  "blockers": "anything they appeared stuck on or an unresolved problem, or null",
  "key_resources": ["specific files, URLs, docs, or tickets that mattered this session"],
  "topics": ["the actual subjects/topics engaged with"]
}}\
"""

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

        if "screen_text" not in existing_column_names:
            await connection.execute(
                text("ALTER TABLE events ADD COLUMN screen_text TEXT")
            )
            logger.info("Added screen_text column to events table.")


async def _ensure_sessions_schema_columns_exist() -> None:
    """Adds missing columns to sessions for existing databases."""
    async with _async_engine.begin() as connection:
        pragma_rows = await connection.execute(text("PRAGMA table_info(sessions)"))
        existing_column_names = {row[1] for row in pragma_rows.fetchall()}

        for col, col_type in [
            ("topics",        "TEXT"),
            ("active_minutes","INTEGER"),
            # Fusion columns — what the user was doing, where they're headed, what blocked them.
            ("activity",      "TEXT"),
            ("next_step",     "TEXT"),
            ("blockers",      "TEXT"),
            # Dominant Gemini category for the session's event batch.
            # Used to filter personal sessions from work-intent recall queries.
            ("category",      "TEXT"),
        ]:
            if col not in existing_column_names:
                await connection.execute(
                    text(f"ALTER TABLE sessions ADD COLUMN {col} {col_type}")
                )
                logger.info("Added %s column to sessions table.", col)


# ---------------------------------------------------------------------------
# Session generation helper — runs once per project group
# ---------------------------------------------------------------------------

def _dedup_events_by_url_for_prompt(events: list[dict]) -> list[dict]:
    """
    Returns a deduplicated copy of `events` for building the Claude prompt
    payload. When the same URL appears more than once (both native_browser and
    extension captured it), only the richest entry is included in the prompt.
    page_text present wins; among equal entries the first occurrence is kept.

    The original list is not modified — every event's session_id is still
    marked correctly because session marking uses the original `project_events`.
    """
    best_by_url: dict[str, dict] = {}
    for event in events:
        url = (event.get("url") or "").strip()
        if not url:
            continue
        if url not in best_by_url:
            best_by_url[url] = event
        elif event.get("page_text") and not best_by_url[url].get("page_text"):
            best_by_url[url] = event

    seen_urls: set[str] = set()
    result: list[dict] = []
    for event in events:
        url = (event.get("url") or "").strip()
        if not url:
            result.append(event)
        elif url not in seen_urls:
            result.append(best_by_url[url])
            seen_urls.add(url)
    return result


def _build_fused_signals(events: list[dict]) -> str:
    """
    Serialises a list of events into compact, signal-labelled text lines.

    Each line starts with a local wall-clock time and a signal-type label so
    Claude can scan the stream and spot overlapping evidence at a glance —
    e.g. "FILE modified billing.ts" followed immediately by "CLIPBOARD:
    constructEvent" followed by "BROWSER: stripe.com/docs/webhooks" tells the
    detective story far more clearly than three separate JSON objects would.

    Format matches the canonical example in the spec:
      [14:30] APP focus: VS Code — window: "billing.service.ts — myapp"
      [14:31] FILE modified: /Users/sa/myapp/src/billing.service.ts
      [14:31] CLIPBOARD: "stripe.webhooks.constructEvent"
    """
    lines: list[str] = []
    for event in events:
        ts_ms = event.get("timestamp", 0)
        time_label = (
            datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
            .astimezone()
            .strftime("%H:%M")
            if ts_ms else "??:??"
        )
        event_type = event.get("type", "")
        app = event.get("app_name") or ""

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

        if event_type == "window":
            raw = event.get("raw_content") or ""
            lines.append(f'[{time_label}] APP focus: {app} — window: "{raw}"')
        elif event_type == "screen_content":
            screen_text = (event.get("screen_text") or "")[:400]
            lines.append(f'[{time_label}] SCREEN text: "{screen_text}"')
        elif event_type == "file_activity":
            action = metadata.get("action", "")
            file_path = event.get("file_path") or ""
            lines.append(f'[{time_label}] FILE {action}: {file_path}')
        elif event_type == "clipboard":
            raw = (event.get("raw_content") or "")[:200]
            lines.append(f'[{time_label}] CLIPBOARD: "{raw}"')
        elif event_type == "url":
            url = event.get("url") or ""
            raw = event.get("raw_content") or ""
            lines.append(f'[{time_label}] BROWSER: {url} — "{raw}"')
        elif event_type == "page_content":
            page_text = (event.get("page_text") or "")[:300]
            lines.append(f'[{time_label}] PAGE content: "{page_text}"')
        elif event_type == "search_query":
            raw = event.get("raw_content") or ""
            lines.append(f'[{time_label}] SEARCHED: "{raw}"')
        elif event_type == "link_click":
            raw = event.get("raw_content") or ""
            link_target = event.get("link_target") or ""
            lines.append(f'[{time_label}] CLICKED: "{raw}" -> {link_target}')
        elif event_type == "app_lifecycle":
            action = metadata.get("action", "")
            lines.append(f'[{time_label}] APP {action}: {app}')
        elif event_type == "system_state":
            state = metadata.get("state", "")
            lines.append(f'[{time_label}] SYSTEM: {state}')

        # Append idle flag inline so Claude sees the pause in context.
        if event.get("is_user_active") == 0:
            lines.append(f'[{time_label}] (user idle)')

    return "\n".join(lines)


def estimate_fused_signal_char_count(events: list[dict]) -> int:
    """
    Rough char count of what _build_fused_signals() will produce for a batch.
    Used to decide whether to split before sending to Claude. Mirrors the per-
    field truncation limits in _build_fused_signals() so the estimate is tight.
    """
    return sum(
        len(str(e.get("raw_content") or "")) +
        len(str(e.get("screen_text") or "")[:400]) +
        len(str(e.get("page_text") or "")[:300]) +
        len(str(e.get("file_path") or "")) +
        50  # overhead per event line (label, timestamp, whitespace)
        for e in events
    )


async def _classify_events_with_configured_provider(events: list[dict]) -> list[dict]:
    """
    Classifies a batch of events using Groq — Orbit's centrally-funded
    default provider during the beta (no per-user key required; the Worker
    supplies its own shared GROQ_API_KEY when the user hasn't configured a
    personal one).

    On failure (rate limit, bad request, network error, or the admin kill
    switch disabling the Groq proxy) events are defaulted to category 'work'
    rather than falling back to Gemini — Gemini is also disabled centrally
    for cost control during the beta, so a fallback call would just fail the
    same way while wasting a request.
    """
    classified = await classify_events_batch_groq(events)
    if classified is not None:
        return classified

    logger.warning(
        "Session generator: Groq classification failed "
        "— defaulting %d event(s) to category 'work'.",
        len(events),
    )
    return [{**event, "category": "work", "project": None} for event in events]


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
    # Batch-size guard: if the event list is too large, split it in half
    # chronologically and recurse rather than sending an oversized prompt
    # to Claude. Oversized batches produce JSON parse failures (the root
    # cause of the 149 parse_failed events in initial real-world testing).
    # Two specific 1-hour sessions are always better than one vague 2-hour one.
    # ------------------------------------------------------------------
    signal_char_count = estimate_fused_signal_char_count(project_events)
    if len(project_events) > MAX_EVENTS_PER_BATCH or signal_char_count > MAX_SIGNAL_CHARS_PER_BATCH:
        midpoint = len(project_events) // 2
        first_half = project_events[:midpoint]
        second_half = project_events[midpoint:]
        logger.info(
            "Session generator: batch of %d event(s) / ~%d signal chars exceeds "
            "limit (%d events / %d chars) — splitting into halves of %d + %d.",
            len(project_events), signal_char_count,
            MAX_EVENTS_PER_BATCH, MAX_SIGNAL_CHARS_PER_BATCH,
            len(first_half), len(second_half),
        )
        if len(first_half) >= MINIMUM_EVENTS_FOR_SESSION:
            await _generate_session_for_events(first_half)
        if len(second_half) >= MINIMUM_EVENTS_FOR_SESSION:
            await _generate_session_for_events(second_half)
        return

    # ------------------------------------------------------------------
    # Build fused signal block for Claude.
    #
    # Each event becomes one labelled text line so Claude can scan the
    # chronological stream and spot overlapping evidence — e.g. FILE + CLIPBOARD
    # + BROWSER on the same timestamp triangulates far better than separate
    # JSON objects would.
    #
    # Deduplicate by URL so the same page isn't described twice when both
    # native_browser and the extension captured it. project_events is
    # untouched — session marking still uses the full original list.
    # raw_content is already safe (redacted at Rust capture time).
    # ------------------------------------------------------------------
    fused_signal_lines = _build_fused_signals(
        _dedup_events_by_url_for_prompt(project_events)
    )

    user_prompt = FUSION_SESSION_USER_PROMPT_TEMPLATE.format(
        fused_signals=fused_signal_lines
    )

    logger.info("Session generator: requesting AI summary for %d event(s).", len(project_events))

    # ------------------------------------------------------------------
    # AI provider selection for session generation.
    #
    # Groq is the sole provider during the beta — Claude is disabled
    # centrally via the Worker's admin kill switch for cost control, so a
    # fallback call here would just fail the same way while wasting a
    # request. To restore Claude as a fallback later, re-add the branch that
    # used to sit here (git history has it) or flip CLAUDE_ENABLED back on
    # and reintroduce the `else` path.
    #
    # Groq receives the exact same user_prompt Claude used to — no
    # truncation — so output quality doesn't regress purely from missing
    # context.
    #
    # Note: recall.py (user-facing chat) now also runs on Groq — see
    # services/groq_service.py's stream_recall_response_groq.
    # ------------------------------------------------------------------
    session_data = await generate_session_summary_groq(
        user_prompt=user_prompt,
        system_prompt=FUSION_SESSION_SYSTEM_PROMPT,
    )

    if session_data is None:
        # Circuit breaker: stamp the batch with the same 'parse_failed'
        # sentinel used for JSON-parse failures elsewhere. Without this,
        # these events keep matching the main "unprocessed events" query
        # every 30-minute cycle forever — observed in production as the
        # same ~60,000-token backlog being reclassified and resubmitted to
        # Groq dozens of times over 7+ hours, burning real tokens without
        # ever producing a session. The existing parse_failed recovery lane
        # (_retry_parse_failed_events, ≤20 events/cycle) already retries
        # these on future runs — much cheaper than reprocessing the whole
        # growing backlog every time.
        logger.warning(
            "Session generator: Groq request failed "
            "— marking %d event(s) as 'parse_failed' for bounded retry via the "
            "recovery lane.",
            len(project_events),
        )
        event_ids       = [event["id"] for event in project_events]
        id_placeholders = ", ".join(f":id_{i}" for i in range(len(event_ids)))
        id_bindings     = {f"id_{i}": eid for i, eid in enumerate(event_ids)}
        async with _async_engine.begin() as connection:
            await connection.execute(
                text(
                    f"UPDATE events SET session_id = 'parse_failed' "
                    f"WHERE id IN ({id_placeholders})"
                ),
                id_bindings,
            )
        return

    logger.info(
        "Session generator: Groq used for session summary (%d events).",
        len(project_events),
    )

    # ------------------------------------------------------------------
    # Persist the Session row
    # ------------------------------------------------------------------
    new_session_id          = str(uuid.uuid4())
    session_start_timestamp = project_events[0]["timestamp"]
    session_end_timestamp   = project_events[-1]["timestamp"]

    project_name  = session_data.get("project_name") or None
    # Fallback: if Claude returned null despite the prompt instruction, derive
    # a label from goal (truncated) so no session ever lands without a name.
    if not project_name:
        goal_text = session_data.get("goal") or ""
        first_topic = (session_data.get("topics") or [None])[0]
        project_name = (
            first_topic
            or (goal_text.rstrip(".").split(".")[0].strip()[:50] if goal_text else None)
        )
    goal          = session_data.get("goal")
    ai_summary    = session_data.get("summary", "")
    activity      = session_data.get("activity")      # what they were specifically doing
    next_step     = session_data.get("next_step")     # concrete continuation action
    blockers      = session_data.get("blockers")      # what they seemed stuck on, or null
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

    # Dominant Gemini-classified category for this event batch. Used by the
    # recall pipeline to filter personal sessions out of work-intent queries.
    # Counter ignores events with no category (not yet classified).
    dominant_category_counter = Counter(
        e.get("category") for e in project_events if e.get("category")
    )
    dominant_category: str = (
        dominant_category_counter.most_common(1)[0][0]
        if dominant_category_counter
        else "work"
    )

    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                """
                INSERT INTO sessions
                    (id, start_time, end_time, project_name, goal, ai_summary,
                     activity, next_step, blockers,
                     last_action, key_resources, topics, active_minutes, category)
                VALUES
                    (:id, :start_time, :end_time, :project_name, :goal, :ai_summary,
                     :activity, :next_step, :blockers,
                     :last_action, :key_resources, :topics, :active_minutes, :category)
                """
            ),
            {
                "id":              new_session_id,
                "start_time":      session_start_timestamp,
                "end_time":        session_end_timestamp,
                "project_name":    project_name,
                "goal":            goal,
                "ai_summary":      ai_summary,
                "activity":        activity,
                "next_step":       next_step,
                "blockers":        blockers,
                "last_action":     last_action,
                "key_resources":   key_resources,
                "topics":          topics,
                "active_minutes":  active_minutes,
                "category":        dominant_category,
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
            # activity and next_step are the sharpest "what" signals — include
            # them in the vector so recall queries like "what was I working on in
            # auth.py" match on the specific activity description.
            activity,
            next_step,
            ai_summary,
            session_data.get("last_action"),
            " ".join(session_data.get("key_resources", [])),
            " ".join(topics_list),
        ])
    )

    embedding_metadata = {
        "session_id":     new_session_id,
        "project_name":   project_name,
        "goal":           goal,
        "activity":       activity,
        "next_step":      next_step,
        "blockers":       blockers,
        "ai_summary":     ai_summary,
        "last_action":    session_data.get("last_action"),
        "key_resources":  session_data.get("key_resources", []),
        "topics":         topics_list,
        "start_time":     session_start_timestamp,
        "end_time":       session_end_timestamp,
        "active_minutes": active_minutes,
        # Stored in the Qdrant payload so recall.py can filter personal
        # sessions out of work-intent queries after semantic search.
        "category":       dominant_category,
    }

    try:
        await add_session_embedding(
            session_id=new_session_id,
            summary_text=embedding_text,
            metadata=embedding_metadata,
        )
        # add_session_embedding() derives the Qdrant integer point ID as
        # abs(hash(session_id)) % 10**9. We store that same integer (as a
        # string) so delete_session_embedding() can convert it back with
        # int(embedding_id) and address the right Qdrant point.
        stable_point_id = abs(hash(new_session_id)) % (10**9)
        async with _async_engine.begin() as connection:
            await connection.execute(
                text("UPDATE sessions SET embedding_id = :eid WHERE id = :sid"),
                {"eid": str(stable_point_id), "sid": new_session_id},
            )
    except Exception as embedding_error:
        logger.warning(
            "Session generator: Qdrant upsert failed for session %s "
            "(error_kind=%s). "
            "Session is saved in SQLite; semantic search will not include it.",
            new_session_id, type(embedding_error).__name__,
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
                       page_text, screen_text, link_target, metadata, file_path,
                       is_user_active, category
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
                       page_text, screen_text, link_target, metadata, file_path,
                       is_user_active, category
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
            "Session generator: classifying batch %d/%d (%d event(s)).",
            batch_index + 1, len(content_batches), len(batch_events),
        )

        classified_batch = await _classify_events_with_configured_provider(batch_events)

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

    # ------------------------------------------------------------------
    # Step 5 — Recovery: retry any parse_failed events from prior runs
    # ------------------------------------------------------------------
    await _retry_parse_failed_events()


# ---------------------------------------------------------------------------
# Parse-failed recovery
# ---------------------------------------------------------------------------

async def _retry_parse_failed_events() -> None:
    """
    Fetches up to 20 events stamped parse_failed and retries them through
    the full classify → fuse → store pipeline in groups of ≤20.

    This recovers events from batches where Claude returned unparseable JSON
    (e.g. because the original batch was too large). The batch-size guard in
    _generate_session_for_events() now prevents this from recurring, but
    existing parse_failed rows need a one-time recovery pass.

    Each retry is a single attempt per scheduler run — if parsing fails again
    the events stay as parse_failed rather than looping. If it succeeds,
    _generate_session_for_events() overwrites parse_failed with the real
    session_id.
    """
    async with _async_engine.connect() as connection:
        rows = await connection.execute(
            text(
                """
                SELECT id, timestamp, type, raw_content, app_name, url, source,
                       page_text, screen_text, link_target, metadata, file_path,
                       is_user_active, category
                FROM   events
                WHERE  session_id = 'parse_failed'
                ORDER  BY timestamp ASC
                LIMIT  20
                """
            )
        )
        failed_events = [dict(row._mapping) for row in rows.fetchall()]

    if not failed_events:
        return

    logger.info(
        "Session generator: retrying %d parse_failed event(s).",
        len(failed_events),
    )

    # Re-classify to get fresh project groupings. The original category
    # column values may be stale or absent for some event types.
    classified = await _classify_events_with_configured_provider(failed_events)

    async with _async_engine.begin() as connection:
        for event in classified:
            await connection.execute(
                text("UPDATE events SET category = :category WHERE id = :id"),
                {"category": event.get("category"), "id": event["id"]},
            )

    project_groups: dict[str | None, list[dict]] = defaultdict(list)
    for event in classified:
        project_groups[event.get("project") or None].append(event)

    for project_key, group_events in project_groups.items():
        if len(group_events) < MINIMUM_EVENTS_FOR_SESSION:
            logger.info(
                "Session generator: parse_failed recovery — skipping project '%s', "
                "only %d event(s) (minimum %d).",
                project_key, len(group_events), MINIMUM_EVENTS_FOR_SESSION,
            )
            continue
        logger.info(
            "Session generator: parse_failed recovery — retrying %d event(s) "
            "for project '%s'.",
            len(group_events), project_key,
        )
        await _generate_session_for_events(group_events)


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
        max_instances=1,
        next_run_time=datetime.now(timezone.utc),
    )
    return scheduler
