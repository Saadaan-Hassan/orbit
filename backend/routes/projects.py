"""
GET /projects — aggregated project cards for the RecallSearch dashboard.

Returns one card per distinct project_name (from sessions), including the
most recent activity description, total session count, weekly active minutes,
and the timestamp of the most recent session.  Also returns today's total
active minutes for the header badge.

All time boundaries are computed in the machine's local timezone (same
approach as timeline.py — the backend runs on the user's machine).
"""

import logging
from datetime import datetime

from fastapi import APIRouter
from sqlalchemy import text

from database import _async_engine

router = APIRouter(prefix="/projects")
logger = logging.getLogger(__name__)


def _today_start_ms() -> int:
    """UTC ms for local-timezone midnight of today."""
    now = datetime.now()
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(midnight.astimezone().timestamp() * 1000)


def _seven_days_ago_ms() -> int:
    """UTC ms for local-timezone midnight seven days ago."""
    from datetime import timedelta
    seven_ago = datetime.now() - timedelta(days=7)
    midnight = seven_ago.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(midnight.astimezone().timestamp() * 1000)


@router.get("")
async def get_projects() -> dict:
    """
    Returns aggregated project cards sorted by most-recently-active first.

    Each card contains:
      project_name         — the project name string
      last_active_ms       — end_time of the most recent session (UTC ms)
      activity             — activity field from the most recent session
      ai_summary           — ai_summary from the most recent session (fallback)
      weekly_active_minutes — sum of active_minutes for sessions in the last 7 days
      session_count        — total number of sessions ever for this project

    Also returns:
      today_active_minutes — sum of active_minutes for ALL sessions today
    """
    today_ms = _today_start_ms()
    week_ms = _seven_days_ago_ms()

    async with _async_engine.connect() as connection:
        # project_key = LOWER(TRIM(project_name)) is used as the grouping key
        # so that "Orbit", "orbit", and "  orbit  " all collapse into one card.
        # The display name comes from the most recent session (rn = 1) so the
        # user sees whatever Claude last called the project.
        projects_result = await connection.execute(
            text("""
                WITH ranked AS (
                    SELECT
                        LOWER(TRIM(project_name)) AS project_key,
                        project_name,
                        end_time,
                        activity,
                        ai_summary,
                        active_minutes,
                        start_time,
                        ROW_NUMBER() OVER (
                            PARTITION BY LOWER(TRIM(project_name)) ORDER BY end_time DESC
                        ) AS rn
                    FROM sessions
                    WHERE project_name IS NOT NULL AND TRIM(project_name) != ''
                ),
                latest AS (
                    SELECT project_key, project_name, end_time AS last_active_ms, activity, ai_summary
                    FROM ranked WHERE rn = 1
                ),
                totals AS (
                    SELECT LOWER(TRIM(project_name)) AS project_key, COUNT(*) AS session_count
                    FROM sessions
                    WHERE project_name IS NOT NULL AND TRIM(project_name) != ''
                    GROUP BY project_key
                ),
                weekly AS (
                    SELECT
                        LOWER(TRIM(project_name)) AS project_key,
                        COALESCE(SUM(active_minutes), 0) AS weekly_active_minutes
                    FROM sessions
                    WHERE
                        project_name IS NOT NULL
                        AND TRIM(project_name) != ''
                        AND start_time >= :week_ms
                    GROUP BY project_key
                )
                SELECT
                    l.project_name,
                    l.last_active_ms,
                    l.activity,
                    l.ai_summary,
                    t.session_count,
                    COALESCE(w.weekly_active_minutes, 0) AS weekly_active_minutes
                FROM latest l
                JOIN totals t ON t.project_key = l.project_key
                LEFT JOIN weekly w ON w.project_key = l.project_key
                ORDER BY l.last_active_ms DESC
                LIMIT 20
            """),
            {"week_ms": week_ms},
        )
        projects = [dict(row._mapping) for row in projects_result.fetchall()]

        today_result = await connection.execute(
            text("""
                SELECT COALESCE(SUM(active_minutes), 0) AS today_active_minutes
                FROM sessions
                WHERE start_time >= :today_ms
            """),
            {"today_ms": today_ms},
        )
        today_row = today_result.fetchone()
        today_active_minutes = int(today_row.today_active_minutes) if today_row else 0

    return {
        "projects": projects,
        "today_active_minutes": today_active_minutes,
    }
