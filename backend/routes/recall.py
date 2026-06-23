"""
POST /recall — the core recall endpoint.

Runs FTS5 keyword search and Qdrant semantic search in parallel, merges the
results into a context block, then streams Claude's response back as SSE.
"""

import json
import logging
from datetime import datetime, timezone

import httpx

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from database import fetch_sessions_by_time_range, fetch_system_state_events, search_events_fts
from services.analytics_service import capture_analytics_event
from services.claude_service import stream_recall_response
from services.qdrant_service import search_sessions_semantic
from services.time_parser import extract_time_range_from_query

router = APIRouter()
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RECALL_SYSTEM_PROMPT = """\
You are Orbit, the user's personal AI memory. You've been quietly watching
everything they work on. You know their projects, their patterns, their
unfinished tasks. Respond like a trusted colleague who genuinely cares
about helping them pick up where they left off — warm, specific, honest.

Rules:
- Be specific. Name actual files, URLs, project names from the context.
- Be honest. If the context doesn't answer the question, say so clearly.
  Never guess or make things up.
- Connect the dots. If the question relates to a previous session, say so:
  "This looks related to what you were debugging on Tuesday."
- Keep it concise. One structured answer, not an essay.
- If they seem to be resuming a task, proactively remind them where they
  left off — even if they didn't explicitly ask.
- Never use developer-specific language. Respond in plain language anyone
  can understand, adapted to the context of what the user was actually doing.
- When the user asks about things they watched, read, or browsed for leisure,
  include the actual links (URLs) so they can revisit them.

Format: start with 📌 [time + context anchor], then the specific answer,
then supporting details only if genuinely useful. Skip any section that
has nothing real to say.\
"""

# ---------------------------------------------------------------------------
# Query intent classification
#
# Determines whether the user is asking about work, personal, or general
# activity. This drives which events are included in search results and
# what hints are sent to Claude.
#
# Currently keyword-based for simplicity. Can be upgraded to an LLM
# classifier (Gemini via Worker /classify) if keyword matching proves
# too imprecise in practice — the function signature stays the same.
# ---------------------------------------------------------------------------

_PERSONAL_INTENT_SIGNALS: frozenset[str] = frozenset({
    "watch", "watched", "watching", "video", "youtube", "netflix",
    "movie", "show", "series", "episode", "instagram", "insta",
    "reddit", "twitter", "x.com", "tiktok", "facebook", "social",
    "post", "liked", "scrolling", "browsing for fun", "music",
    "spotify", "listened", "song", "entertainment",
})

_WORK_INTENT_SIGNALS: frozenset[str] = frozenset({
    "working on", "work", "building", "coding", "debugging",
    "project", "fixing", "writing", "task", "code", "file",
    "editing", "developing",
})

# Actions that Orbit does NOT capture (it tracks pages visited, not in-app
# interactions). When detected in a personal query, a limitation note is
# added to the Claude context so it can set the user's expectations.
_UNTRACKED_ACTION_SIGNALS: frozenset[str] = frozenset({
    "liked", "saved", "favorited", "bookmarked", "shared",
    "commented", "retweeted", "reposted",
})


def classify_query_intent(query: str) -> str:
    """
    Returns "work", "personal", or "general" based on keyword matching.

    "general" is the safe default — returned when no signals match, or when
    both work and personal signals are present (ambiguous intent). In that
    case all events are included and Claude sorts out the relevance.
    """
    query_lower = query.lower()
    has_personal = any(signal in query_lower for signal in _PERSONAL_INTENT_SIGNALS)
    has_work     = any(signal in query_lower for signal in _WORK_INTENT_SIGNALS)

    if has_personal and not has_work:
        return "personal"
    if has_work and not has_personal:
        return "work"
    return "general"


def _query_asks_about_untracked_action(query: str) -> bool:
    """Returns True if the query asks about an in-app action Orbit doesn't capture."""
    query_lower = query.lower()
    return any(signal in query_lower for signal in _UNTRACKED_ACTION_SIGNALS)


_BREAK_TIME_INTENT_SIGNALS: frozenset[str] = frozenset({
    "break", "breaks", "stepped away", "step away",
    "lunch", "nap", "rest",
    "how long", "how much time", "time spent", "spent on",
    "active for", "worked for", "duration", "minutes", "hours",
    "when did i stop", "when did i start", "did i take a break",
    "did i step away", "away from",
})


def _query_asks_about_time_or_breaks(query: str) -> bool:
    """Returns True if the query is about duration, time spent, or break times."""
    query_lower = query.lower()
    return any(signal in query_lower for signal in _BREAK_TIME_INTENT_SIGNALS)


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------

class RecallRequest(BaseModel):
    query: str
    conversation_history: list[dict] | None = None


# ---------------------------------------------------------------------------
# Context formatting helpers
# ---------------------------------------------------------------------------

def _format_timestamp_as_human_readable(timestamp_milliseconds: int) -> str:
    """Converts a Unix millisecond timestamp to a readable local time string."""
    event_datetime = datetime.fromtimestamp(
        timestamp_milliseconds / 1000, tz=timezone.utc
    ).astimezone()
    return event_datetime.strftime("%b %d %I:%M %p")


def _format_time_range_label(time_range: dict) -> str:
    """Returns a human-readable string like 'this morning (Jun 10, 5 AM–12 PM)'."""
    start_dt = datetime.fromtimestamp(time_range["start_ms"] / 1000)
    end_dt   = datetime.fromtimestamp(time_range["end_ms"] / 1000)

    def _fmt_hour(dt: datetime) -> str:
        # strftime("%I %p") produces "05 PM" — strip the leading zero.
        return dt.strftime("%I %p").lstrip("0").strip()

    # strftime("%b %d") gives "Jun 01"; replace " 0" → " " gives "Jun 1".
    date_part = start_dt.strftime("%b %d").replace(" 0", " ")
    return f"{time_range['label']} ({date_part}, {_fmt_hour(start_dt)}–{_fmt_hour(end_dt)})"


def calculate_recency_score(session_end_time_ms: int, now_ms: int) -> float:
    """
    Returns a 0–1 recency score based on how recently the session ended.

    Recency matters for a memory tool because the user is almost always asking
    about recent work. A semantically similar session from this morning should
    outrank one from three weeks ago — the older one may be less relevant even
    if the vocabulary matches better. This decay schedule reflects how quickly
    work context fades in practice: today's work is fully relevant, last week's
    work is half as likely to be what the user means, last month's is a distant
    reference.

    Decay schedule:
      < 24 h    → 1.0            (today — maximum weight)
      1–7 days  → 1.0 → 0.5     (linear decay through the work week)
      7–30 days → 0.5 → 0.2     (older, still potentially relevant)
      > 30 days → 0.1            (floor — never fully discarded in case it's relevant)
    """
    age_ms = max(0, now_ms - session_end_time_ms)

    one_day_ms    = 24 * 60 * 60 * 1_000
    seven_days_ms = 7  * 24 * 60 * 60 * 1_000
    thirty_days_ms = 30 * 24 * 60 * 60 * 1_000

    if age_ms < one_day_ms:
        return 1.0
    elif age_ms < seven_days_ms:
        # Linear: 1.0 at 1 day → 0.5 at 7 days
        progress = (age_ms - one_day_ms) / (seven_days_ms - one_day_ms)
        return 1.0 - (progress * 0.5)
    elif age_ms < thirty_days_ms:
        # Linear: 0.5 at 7 days → 0.2 at 30 days
        progress = (age_ms - seven_days_ms) / (thirty_days_ms - seven_days_ms)
        return 0.5 - (progress * 0.3)
    else:
        return 0.1


def _rerank_sessions_by_combined_score(
    sessions: list[dict],
    now_ms: int,
    time_range_active: bool,
) -> list[dict]:
    """
    Sorts sessions by a combined semantic + recency score, descending.

    When a time range filter is already active (e.g. the user asked about
    "yesterday"), the sessions are already bounded to a narrow window. Recency
    differences within that window are small and should not override semantic
    relevance — reducing the recency weight avoids penalising sessions twice
    (once by the time filter, again by the recency decay) for being "old" when
    the user explicitly asked about that period.

    Without time filter: combined = (similarity × 0.7) + (recency × 0.3)
    With time filter:    combined = (similarity × 0.9) + (recency × 0.1)
    """
    if time_range_active:
        similarity_weight = 0.9
        recency_weight    = 0.1
    else:
        similarity_weight = 0.7
        recency_weight    = 0.3

    def _combined(session: dict) -> float:
        semantic = session.get("score", 0.0)
        recency  = calculate_recency_score(session.get("end_time", 0), now_ms)
        return (semantic * similarity_weight) + (recency * recency_weight)

    return sorted(sessions, key=_combined, reverse=True)


def _dedup_events_by_url(events: list[dict]) -> list[dict]:
    """
    Safety-net dedup for FTS5 results: if the same URL appears more than once
    (e.g. from both native_browser and extension sources), keep the richest
    entry. page_text present wins; among equal entries, the first occurrence
    (highest BM25 rank) is kept. Events without a URL are never touched.
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


def _build_context_block(
    keyword_matched_events: list[dict],
    semantic_matched_sessions: list[dict],
    time_range: dict | None = None,
    intent: str = "general",
    show_action_limitation_note: bool = False,
    system_state_events: list[dict] | None = None,
) -> str:
    """
    Formats the parallel search results into a single context string that
    Claude can reason about. Keeps formatting dense but readable so we
    don't waste tokens on whitespace.
    """
    # raw_content is safe to forward to Claude here. Secrets were redacted
    # by the Rust capture layer before any DB write, so raw_content is
    # either innocuous plaintext or a [REDACTED:<type>] placeholder.
    # Sending the actual clipboard content is essential for meaningful recall
    # — without it Claude cannot tell the user what they copied or worked with.

    # Safety-net dedup: if the same URL slipped through as both a
    # native_browser and an extension event, keep the richer one.
    keyword_matched_events = _dedup_events_by_url(keyword_matched_events)

    context_lines: list[str] = []

    # --- Time range context (when the query contained a time reference) ---
    if time_range:
        context_lines.append(
            f"User is asking about: {_format_time_range_label(time_range)}"
        )
        context_lines.append("")

    # --- Intent hint — tells Claude what kind of answer to produce ---
    if intent == "personal":
        context_lines.append(
            "Query intent: personal — the user is asking about leisure/browsing "
            "activity. Include relevant links (URLs) in your answer."
        )
        if show_action_limitation_note:
            context_lines.append(
                "Note: Orbit captures pages you visited, not actions like 'liked' "
                "or 'saved' inside apps. If you can't determine the specific action, "
                "tell the user what they were browsing around that time and offer "
                "the links you do have."
            )
        context_lines.append("")
    elif intent == "work":
        context_lines.append(
            "Query intent: work — focus on work activity, ignore leisure browsing."
        )
        context_lines.append("")

    # --- FTS5 keyword matches ---
    context_lines.append("RECENT ACTIVITY (keyword matches):")
    if keyword_matched_events:
        for event in keyword_matched_events:
            readable_timestamp = _format_timestamp_as_human_readable(
                event.get("timestamp", 0)
            )
            event_type  = event.get("type", "")
            app_name    = event.get("app_name") or "unknown"
            raw_content = (event.get("raw_content") or "").strip()
            url         = (event.get("url") or "").strip()
            page_text   = (event.get("page_text") or "").strip()
            link_target = (event.get("link_target") or "").strip()

            # Parse the metadata JSON blob — carries author, site_name,
            # search_engine etc. Falls back to an empty dict on any error.
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

            if event_type == "screen_content":
                screen_text = (event.get("screen_text") or "").strip()
                snippet_source = screen_text or raw_content
                snippet = snippet_source[:200]
                ellipsis = "…" if len(snippet_source) > 200 else ""
                context_lines.append(
                    f"  [{readable_timestamp}] In {app_name}: \"{snippet}{ellipsis}\""
                )
            elif event_type == "page_content":
                author    = metadata.get("author") or ""
                site_name = metadata.get("site_name") or ""
                author_part   = f" by {author}" if author else ""
                site_part     = f" ({site_name})" if site_name else ""
                excerpt_part  = f" — {page_text[:200]}" if page_text else ""
                context_lines.append(
                    f"  [{readable_timestamp}] Read: \"{raw_content}\"{author_part}{site_part}{excerpt_part}"
                )
            elif event_type == "search_query":
                engine = metadata.get("search_engine") or "Search"
                context_lines.append(
                    f"  [{readable_timestamp}] Searched: \"{raw_content}\" on {engine}"
                )
            elif event_type == "link_click":
                link_display = raw_content[:80] if raw_content else "link"
                context_lines.append(
                    f"  [{readable_timestamp}] Clicked: \"{link_display}\" → {link_target}"
                )
            elif event_type == "file_activity":
                file_path = (event.get("file_path") or "").strip()
                action = metadata.get("action") or "modified"
                filename = file_path.split("/")[-1] if file_path else raw_content
                path_suffix = f" — {file_path}" if file_path else ""
                context_lines.append(
                    f"  [{readable_timestamp}] Worked on file: {filename} ({action}){path_suffix}"
                )
            elif event_type == "system_state":
                state = metadata.get("state") or raw_content
                state_labels = {
                    "lock":   "stepped away (screen locked)",
                    "unlock": "returned (screen unlocked)",
                    "sleep":  "computer went to sleep",
                    "wake":   "computer woke up",
                }
                state_display = state_labels.get(state, state)
                context_lines.append(
                    f"  [{readable_timestamp}] {state_display}"
                )
            elif intent == "personal" and event_type == "url" and url:
                # For personal queries, surface the actual URL so Claude can
                # include clickable links in its answer.
                context_lines.append(
                    f"  [{readable_timestamp}] {app_name} — \"{raw_content}\" — {url}"
                )
            else:
                context_lines.append(
                    f"  [{readable_timestamp}] {app_name}: {raw_content}"
                )
    else:
        context_lines.append("  (no keyword matches found)")

    context_lines.append("")

    # --- Qdrant semantic matches ---
    context_lines.append("SESSION SUMMARIES (semantic matches):")
    if semantic_matched_sessions:
        for session in semantic_matched_sessions:
            start_time_ms = session.get("start_time", 0)
            readable_timestamp = _format_timestamp_as_human_readable(start_time_ms)
            project     = session.get("project_name") or "unknown project"
            goal        = session.get("goal") or ""
            summary     = session.get("ai_summary") or ""
            last_action = session.get("last_action") or ""

            raw_resources = session.get("key_resources") or []
            if isinstance(raw_resources, str):
                # Stored as a JSON array string in SQLite; Qdrant payload may
                # deserialise it as a list already — handle both forms.
                try:
                    raw_resources = json.loads(raw_resources)
                except Exception:
                    raw_resources = []
            resources_text = ", ".join(raw_resources) if raw_resources else ""

            raw_topics = session.get("topics") or []
            if isinstance(raw_topics, str):
                try:
                    raw_topics = json.loads(raw_topics)
                except Exception:
                    raw_topics = []
            topics_text = ", ".join(raw_topics) if raw_topics else ""

            activity    = session.get("activity") or ""
            next_step   = session.get("next_step") or ""
            blockers    = session.get("blockers") or ""
            active_minutes = session.get("active_minutes")

            context_lines.append(f"  [{readable_timestamp}] Project: {project}")
            # activity from fused session prompt; fall back to ai_summary for
            # older sessions that pre-date the fusion upgrade.
            if activity:
                context_lines.append(f"    What you were doing: {activity}")
            elif summary:
                context_lines.append(f"    Summary: {summary}")
            if goal:
                context_lines.append(f"    Goal: {goal}")
            if next_step:
                context_lines.append(f"    Next step: {next_step}")
            if last_action:
                context_lines.append(f"    Left off: {last_action}")
            if blockers:
                context_lines.append(f"    Blocked on: {blockers}")
            if topics_text:
                context_lines.append(f"    Topics: {topics_text}")
            if resources_text:
                context_lines.append(f"    Resources: {resources_text}")
            if active_minutes is not None and active_minutes > 0:
                context_lines.append(f"    Active time: {active_minutes} min")
    else:
        context_lines.append("  (no semantic matches found)")

    # --- Break / system events (lock, unlock, sleep, wake) ---
    # Only added when the query asks about breaks or time, so this section
    # does not appear in routine recall and does not bloat the context.
    if system_state_events:
        context_lines.append("")
        context_lines.append("BREAK / SYSTEM EVENTS:")
        for sys_event in system_state_events:
            readable_timestamp = _format_timestamp_as_human_readable(
                sys_event.get("timestamp", 0)
            )
            sys_metadata_raw = sys_event.get("metadata")
            sys_metadata: dict = {}
            if sys_metadata_raw:
                try:
                    sys_metadata = (
                        json.loads(sys_metadata_raw)
                        if isinstance(sys_metadata_raw, str)
                        else sys_metadata_raw
                    )
                except Exception:
                    pass
            state = sys_metadata.get("state") or (sys_event.get("raw_content") or "")
            state_labels = {
                "lock":   "stepped away (screen locked)",
                "unlock": "returned (screen unlocked)",
                "sleep":  "computer went to sleep",
                "wake":   "computer woke up",
            }
            context_lines.append(
                f"  [{readable_timestamp}] {state_labels.get(state, state)}"
            )

    return "\n".join(context_lines)


def _format_fts5_fallback(events: list[dict]) -> str:
    """
    Formats local FTS5 results as a plain readable message for the offline
    fallback path. Used when the Cloudflare Worker is unreachable so the user
    always gets something from their local data instead of a blank error.
    """
    if not events:
        return (
            "I can't reach my AI right now — you may be offline. "
            "I also couldn't find any matching activity in your recent history."
        )

    lines = [
        "I can't reach my AI right now (you may be offline), but here's what "
        "I found in your recent activity:",
    ]
    for event in events:
        readable_timestamp = _format_timestamp_as_human_readable(
            event.get("timestamp", 0)
        )
        event_type  = event.get("type", "")
        app_name    = event.get("app_name") or "System"
        raw_content = (event.get("raw_content") or "").strip()
        link_target = (event.get("link_target") or "").strip()

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

        if event_type == "page_content":
            title_display = raw_content[:80] + ("…" if len(raw_content) > 80 else "")
            lines.append(f"• [{readable_timestamp}] Read: \"{title_display}\"")
        elif event_type == "search_query":
            engine = metadata.get("search_engine") or "Search"
            lines.append(f"• [{readable_timestamp}] Searched: \"{raw_content}\" on {engine}")
        elif event_type == "link_click":
            link_display = raw_content[:60] + ("…" if len(raw_content) > 60 else "")
            lines.append(f"• [{readable_timestamp}] Clicked: \"{link_display}\" → {link_target}")
        elif raw_content:
            display_content = raw_content[:80] + ("…" if len(raw_content) > 80 else "")
            lines.append(f"• [{readable_timestamp}] {app_name} — {display_content}")
        else:
            lines.append(f"• [{readable_timestamp}] {app_name}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# SSE generator
# ---------------------------------------------------------------------------

async def _stream_sse_recall(
    query: str,
    conversation_history: list[dict] | None,
) -> AsyncGenerator[str, None]:
    """
    Runs the full recall pipeline and yields SSE-formatted strings.

    1. FTS5 + Qdrant searched in parallel via asyncio.gather.
    2. Results merged into a context block.
    3. Claude streamed via the Cloudflare Worker with prior conversation turns.
    4. Each text delta yielded as:  data: {"chunk": "..."}\n\n
    5. Final sentinel yielded as:   data: {"done": true}\n\n
    """
    logger.info("Recall: running search for query: %.80s", query)

    now_ms     = int(datetime.now().timestamp() * 1000)
    time_range = extract_time_range_from_query(query, now_ms)

    if time_range:
        logger.info(
            "Recall: time reference detected — %s (start=%d end=%d).",
            time_range["label"], time_range["start_ms"], time_range["end_ms"],
        )

    # Classify the query's intent so we can control filtering and give Claude
    # the right framing. "work" excludes personal events; "personal" includes
    # everything and surfaces URLs; "general" includes everything.
    intent           = classify_query_intent(query)
    exclude_personal = intent == "work"
    asks_about_untracked_action = (
        intent == "personal" and _query_asks_about_untracked_action(query)
    )
    asks_about_time_or_breaks = _query_asks_about_time_or_breaks(query)

    # Fix B: FTS5 runs first — it is purely local and always works offline.
    keyword_matched_events = await search_events_fts(
        query,
        limit=15,
        start_ms=time_range["start_ms"] if time_range else None,
        end_ms=time_range["end_ms"] if time_range else None,
        exclude_personal=exclude_personal,
    )

    logger.info("Recall: FTS5 returned %d event(s).", len(keyword_matched_events))

    # Fetch system_state events when the query is about breaks or time spent.
    # These are local DB reads — no Worker required, so we can do this even
    # before we know whether the Worker is reachable.
    system_state_events: list[dict] = []
    if asks_about_time_or_breaks:
        system_state_events = await fetch_system_state_events(
            limit=20,
            start_ms=time_range["start_ms"] if time_range else None,
            end_ms=time_range["end_ms"] if time_range else None,
        )
        if system_state_events:
            logger.info(
                "Recall: fetched %d system_state event(s) for break/duration query.",
                len(system_state_events),
            )

    # The remaining steps (Qdrant semantic search + Claude synthesis) require
    # the Cloudflare Worker. If the Worker is unreachable we fall back to the
    # local FTS5 results so the user always gets something useful.
    try:
        semantic_matched_sessions = await search_sessions_semantic(
            query_text=query, result_limit=8
        )

        # Keep only sessions that overlap the detected time range.
        if time_range:
            semantic_matched_sessions = [
                session for session in semantic_matched_sessions
                if (
                    session.get("start_time", 0) <= time_range["end_ms"]
                    and session.get("end_time", 0) >= time_range["start_ms"]
                )
            ]

        # Exclude personal sessions from work-intent queries. Semantic
        # similarity can surface leisure-browsing sessions alongside work
        # sessions (e.g. a Netflix search embedding near a coding search).
        # The category stored in the Qdrant payload matches the dominant
        # Gemini category written by the scheduler at session-generation time.
        if intent == "work":
            semantic_matched_sessions = [
                s for s in semantic_matched_sessions
                if s.get("category") != "personal"
            ]

        # Re-rank by combined semantic + recency score.
        semantic_matched_sessions = _rerank_sessions_by_combined_score(
            semantic_matched_sessions,
            now_ms=now_ms,
            time_range_active=time_range is not None,
        )

        # For time-range queries ("yesterday", "today", etc.), Qdrant semantic
        # similarity is the wrong tool — it returns sessions similar to the query
        # text, not all sessions from the day. A "what did I work on yesterday?"
        # query will over-represent whichever project matches semantically (e.g.
        # Orbit for an Orbit developer) and silently omit every other project.
        #
        # Fix: use the DB scan as the PRIMARY source for time-range queries —
        # it returns the best session per distinct project_name within the window,
        # guaranteeing comprehensive coverage. Qdrant results are merged in
        # only if their project is not already covered.
        if time_range:
            db_sessions = await fetch_sessions_by_time_range(
                start_ms=time_range["start_ms"],
                end_ms=time_range["end_ms"],
            )
            # Build the final list: one session per project, DB-first so every
            # project in the window is represented. Qdrant sessions fill any
            # remaining slots (up to 12) for projects the DB scan missed.
            seen_projects: set[str] = set()
            merged: list[dict] = []

            for db_session in db_sessions:
                if len(merged) >= 12:
                    break
                project = (db_session.get("project_name") or "").strip().lower()
                if project and project in seen_projects:
                    continue
                if project:
                    seen_projects.add(project)
                merged.append(db_session)

            for session in semantic_matched_sessions:
                if len(merged) >= 12:
                    break
                project = (session.get("project_name") or "").strip().lower()
                if project and project in seen_projects:
                    continue
                if project:
                    seen_projects.add(project)
                merged.append(session)

            semantic_matched_sessions = merged

        logger.info(
            "Recall: Qdrant returned %d session(s) after filtering and re-ranking.",
            len(semantic_matched_sessions),
        )

        capture_analytics_event("recall_query_made", {
            "had_results":  bool(keyword_matched_events or semantic_matched_sessions),
            "result_count": len(keyword_matched_events) + len(semantic_matched_sessions),
            "time_filtered": bool(time_range),
            "intent":        intent,
        })

        context_block = _build_context_block(
            keyword_matched_events,
            semantic_matched_sessions,
            time_range=time_range,
            intent=intent,
            show_action_limitation_note=asks_about_untracked_action,
            system_state_events=system_state_events,
        )

        user_prompt = (
            f"User question: {query}\n\n"
            f"Context from their activity:\n{context_block}"
        )

        async for text_delta in stream_recall_response(
            system_prompt=RECALL_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            conversation_history=conversation_history,
        ):
            yield f"data: {json.dumps({'chunk': text_delta})}\n\n"

    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as offline_error:
        # Worker unreachable or returned 5xx (deploy, rate-limit, Anthropic outage).
        # Stream the local FTS5 results as plain text so the user always gets
        # something useful — a 503 from the Worker is treated the same as no
        # network connection from the user's perspective.
        logger.warning(
            "Recall: Worker unavailable (%s). Falling back to local FTS5 results.",
            type(offline_error).__name__,
        )
        capture_analytics_event("recall_offline_fallback", {
            "fts5_result_count": len(keyword_matched_events),
        })
        yield f"data: {json.dumps({'chunk': _format_fts5_fallback(keyword_matched_events)})}\n\n"

    except Exception as unexpected_error:
        logger.error("Recall: unexpected error during synthesis: %s", unexpected_error)
        yield f"data: {json.dumps({'chunk': 'Sorry, something went wrong retrieving your memory.'})}\n\n"

    yield f"data: {json.dumps({'done': True})}\n\n"


# Make the generator type available for the annotation below without
# importing AsyncGenerator from typing twice.
from typing import AsyncGenerator  # noqa: E402  (placed after helper defs for readability)


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.post("/recall")
async def recall(request: RecallRequest) -> StreamingResponse:
    # Enforce the 4-turn (8-message) max server-side regardless of client behaviour.
    # The frontend also caps at 4 turns, but a buggy or modified client must not
    # be able to send unbounded history and inflate token costs.
    conversation_history = (request.conversation_history or [])[-8:]
    return StreamingResponse(
        _stream_sse_recall(request.query, conversation_history),
        media_type="text/event-stream",
        headers={
            # Prevent any proxy or browser from buffering the SSE stream.
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
