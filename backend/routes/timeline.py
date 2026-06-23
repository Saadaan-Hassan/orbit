"""
GET /timeline/day   — sessions that start within a given calendar day.
GET /timeline/dates — all calendar dates that have at least one session.

Both endpoints operate in the machine's local timezone, which equals the
user's timezone because the backend runs on the user's own machine.
"""

import logging
from datetime import datetime, date as date_type

from fastapi import APIRouter, Query
from sqlalchemy import text

from database import _async_engine

router = APIRouter(prefix="/timeline")
logger = logging.getLogger(__name__)


def _local_day_bounds_ms(date_string: str) -> tuple[int, int]:
    """
    Returns (start_ms, end_ms) in UTC milliseconds for the given YYYY-MM-DD
    calendar day interpreted in local machine time.

    Uses datetime.fromisoformat and .astimezone() so the local timezone is
    inferred from the OS — no TZ env var required.
    """
    parsed_date = date_type.fromisoformat(date_string)
    # Build naive local datetimes for the day boundaries.
    local_midnight = datetime(parsed_date.year, parsed_date.month, parsed_date.day, 0, 0, 0)
    local_end_of_day = datetime(parsed_date.year, parsed_date.month, parsed_date.day, 23, 59, 59, 999999)
    # Convert local naive → aware local → UTC ms.
    start_ms = int(local_midnight.astimezone().timestamp() * 1000)
    end_ms   = int(local_end_of_day.astimezone().timestamp() * 1000)
    return start_ms, end_ms


@router.get("/day")
async def get_timeline_day(
    date: str = Query(..., description="Calendar day in YYYY-MM-DD format (local time)"),
) -> dict:
    """
    Returns all sessions whose start_time falls within the given calendar day,
    plus computed summary stats for the stats-pill row in the UI.
    """
    try:
        start_ms, end_ms = _local_day_bounds_ms(date)
    except ValueError:
        logger.warning("Timeline: invalid date string %r — returning empty.", date)
        return {
            "sessions": [],
            "total_active_minutes": 0,
            "total_duration_minutes": 0,
            "project_count": 0,
        }

    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text("""
                SELECT id, start_time, end_time, project_name, goal, activity,
                       ai_summary, last_action, next_step, blockers, topics,
                       key_resources, active_minutes, embedding_id, category
                FROM sessions
                WHERE start_time >= :start_ms
                  AND start_time <= :end_ms
                ORDER BY start_time ASC
            """),
            {"start_ms": start_ms, "end_ms": end_ms},
        )
        sessions = [dict(row._mapping) for row in result.fetchall()]

    total_active_minutes = sum(
        (row.get("active_minutes") or 0) for row in sessions
    )
    total_duration_minutes = sum(
        max(0, round((row.get("end_time", 0) - row.get("start_time", 0)) / 60_000))
        for row in sessions
    )
    seen_project_names: set[str] = set()
    for row in sessions:
        project_name = (row.get("project_name") or "").strip().lower()
        if project_name:
            seen_project_names.add(project_name)
    project_count = len(seen_project_names)

    return {
        "sessions": sessions,
        "total_active_minutes": total_active_minutes,
        "total_duration_minutes": total_duration_minutes,
        "project_count": project_count,
    }


@router.get("/dates")
async def get_timeline_dates() -> dict:
    """
    Returns a list of unique calendar dates (YYYY-MM-DD, local time) for which
    at least one session exists. Used by the date-navigation bar to know which
    days are navigable. Ordered newest-first.
    """
    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text("SELECT start_time FROM sessions ORDER BY start_time DESC")
        )
        all_start_timestamps = [row[0] for row in result.fetchall()]

    seen_dates: set[str] = set()
    unique_dates: list[str] = []
    for timestamp_ms in all_start_timestamps:
        # Convert UTC ms timestamp to local calendar date string.
        local_date_string = datetime.fromtimestamp(timestamp_ms / 1000).strftime("%Y-%m-%d")
        if local_date_string not in seen_dates:
            seen_dates.add(local_date_string)
            unique_dates.append(local_date_string)

    return {"dates": unique_dates}
