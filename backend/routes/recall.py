"""
POST /recall — the core recall endpoint.

Runs FTS5 keyword search and Qdrant semantic search in parallel, merges the
results into a context block, then streams Claude's response back as SSE.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from database import search_events_fts
from services.analytics_service import capture_analytics_event
from services.claude_service import stream_recall_response
from services.qdrant_service import search_sessions_semantic

router = APIRouter()
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RECALL_SYSTEM_PROMPT = """\
You are Orbit, an AI memory companion.
You have access to summaries of the user's recent computer activity.
Answer their question directly and specifically, like a colleague who \
was watching their screen.

Format your response as:
📌 [Time period] — [App or context]

[What they were doing, specifically]

You had open:
→ [resource 1]
→ [resource 2]

Last action: [most recent relevant thing]

Be specific. Use exact file names, URLs, and project names from the context.
If the context doesn't answer the question, say so honestly.\
"""

# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------

class RecallRequest(BaseModel):
    query: str


# ---------------------------------------------------------------------------
# Context formatting helpers
# ---------------------------------------------------------------------------

def _format_timestamp_as_human_readable(timestamp_milliseconds: int) -> str:
    """Converts a Unix millisecond timestamp to a readable local time string."""
    event_datetime = datetime.fromtimestamp(
        timestamp_milliseconds / 1000, tz=timezone.utc
    ).astimezone()
    return event_datetime.strftime("%b %d %I:%M %p")


def _build_context_block(
    keyword_matched_events: list[dict],
    semantic_matched_sessions: list[dict],
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
    context_lines: list[str] = []

    # --- FTS5 keyword matches ---
    context_lines.append("RECENT ACTIVITY (keyword matches):")
    if keyword_matched_events:
        for event in keyword_matched_events:
            readable_timestamp = _format_timestamp_as_human_readable(
                event.get("timestamp", 0)
            )
            app_name = event.get("app_name") or "unknown"
            raw_content = (event.get("raw_content") or "").strip()
            context_lines.append(f"  [{readable_timestamp}] {app_name}: {raw_content}")
    else:
        context_lines.append("  (no keyword matches found)")

    context_lines.append("")

    # --- Qdrant semantic matches ---
    context_lines.append("SESSION SUMMARIES (semantic matches):")
    if semantic_matched_sessions:
        for session in semantic_matched_sessions:
            start_time_ms = session.get("start_time", 0)
            readable_timestamp = _format_timestamp_as_human_readable(start_time_ms)
            project = session.get("project_name") or "unknown project"
            goal    = session.get("goal") or ""
            summary = session.get("ai_summary") or ""
            context_lines.append(
                f"  [{readable_timestamp}] Project: {project} | "
                f"Goal: {goal} | Summary: {summary}"
            )
    else:
        context_lines.append("  (no semantic matches found)")

    return "\n".join(context_lines)


# ---------------------------------------------------------------------------
# SSE generator
# ---------------------------------------------------------------------------

async def _stream_sse_recall(query: str) -> AsyncGenerator[str, None]:
    """
    Runs the full recall pipeline and yields SSE-formatted strings.

    1. FTS5 + Qdrant searched in parallel via asyncio.gather.
    2. Results merged into a context block.
    3. Claude streamed via the Cloudflare Worker.
    4. Each text delta yielded as:  data: {"chunk": "..."}\n\n
    5. Final sentinel yielded as:   data: {"done": true}\n\n
    """
    logger.info("Recall: running parallel search for query: %.80s", query)

    keyword_matched_events, semantic_matched_sessions = await asyncio.gather(
        search_events_fts(query, limit=15),
        search_sessions_semantic(query_text=query, result_limit=8),
    )

    logger.info(
        "Recall: FTS5 returned %d event(s), Qdrant returned %d session(s).",
        len(keyword_matched_events),
        len(semantic_matched_sessions),
    )

    capture_analytics_event("recall_query_made", {
        "had_results": bool(keyword_matched_events or semantic_matched_sessions),
        "result_count": len(keyword_matched_events) + len(semantic_matched_sessions),
    })

    context_block = _build_context_block(
        keyword_matched_events,
        semantic_matched_sessions,
    )

    user_prompt = (
        f"User question: {query}\n\n"
        f"Context from their activity:\n{context_block}"
    )

    try:
        async for text_delta in stream_recall_response(
            system_prompt=RECALL_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        ):
            yield f"data: {json.dumps({'chunk': text_delta})}\n\n"
    except Exception as streaming_error:
        logger.error("Recall: streaming error: %s", streaming_error)
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
    return StreamingResponse(
        _stream_sse_recall(request.query),
        media_type="text/event-stream",
        headers={
            # Prevent any proxy or browser from buffering the SSE stream.
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
