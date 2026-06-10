"""
Time reference parser for recall queries.

Extracts a concrete time range (start_ms, end_ms) from natural language
phrases like "yesterday", "this morning", "last week". Used by the recall
pipeline to narrow FTS5 and Qdrant results before sending context to Claude.

No third-party dependencies — standard library only.
"""

import re
from datetime import datetime, timedelta
from typing import Callable


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _start_of_day(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _end_of_day(dt: datetime) -> datetime:
    return dt.replace(hour=23, minute=59, second=59, microsecond=0)


def _to_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


# ---------------------------------------------------------------------------
# Pattern table
#
# Each entry is a 3-tuple:
#   (regex_pattern, human_label, compute_fn)
#
# compute_fn receives the current local datetime and returns
# (start_datetime, end_datetime).
#
# ORDERING MATTERS — patterns are checked top-to-bottom and the first match
# wins. Multi-word, more-specific patterns must come before their shorter
# substrings (e.g. "yesterday morning" before "yesterday", "a few hours ago"
# before any single-word match).
# ---------------------------------------------------------------------------

_TimeCompute = Callable[[datetime], tuple[datetime, datetime]]

_TIME_PATTERNS: list[tuple[str, str, _TimeCompute]] = [
    # --- Yesterday sub-ranges (more specific than plain "yesterday") ---
    (
        r"yesterday\s+morning",
        "yesterday morning",
        lambda now: (
            _start_of_day(now - timedelta(days=1)).replace(hour=5),
            _start_of_day(now - timedelta(days=1)).replace(hour=12),
        ),
    ),
    # --- Today sub-ranges ---
    (
        r"this\s+morning",
        "this morning",
        lambda now: (
            _start_of_day(now).replace(hour=5),
            _start_of_day(now).replace(hour=12),
        ),
    ),
    (
        r"this\s+afternoon",
        "this afternoon",
        lambda now: (
            _start_of_day(now).replace(hour=12),
            _start_of_day(now).replace(hour=17),
        ),
    ),
    (
        r"this\s+evening|tonight",
        "this evening",
        lambda now: (
            _start_of_day(now).replace(hour=17),
            _end_of_day(now),
        ),
    ),
    # --- Relative hour ranges (more specific than day-level) ---
    (
        r"a\s+few\s+hours?\s+ago",
        "a few hours ago",
        lambda now: (now - timedelta(hours=4), now),
    ),
    (
        r"an?\s+hour\s+ago|past\s+hour",
        "the past hour",
        lambda now: (now - timedelta(hours=1), now),
    ),
    # --- Week ranges ---
    (
        r"last\s+week",
        "last week",
        lambda now: (
            # Monday of the previous week
            _start_of_day(now - timedelta(days=now.weekday() + 7)),
            # Sunday of the previous week (day before this week's Monday)
            _end_of_day(now - timedelta(days=now.weekday() + 1)),
        ),
    ),
    (
        r"this\s+week",
        "this week",
        lambda now: (
            _start_of_day(now - timedelta(days=now.weekday())),
            now,
        ),
    ),
    # --- Month range ---
    (
        r"this\s+month",
        "this month",
        lambda now: (
            _start_of_day(now.replace(day=1)),
            now,
        ),
    ),
    # --- Single-word day references (least specific — checked last) ---
    (
        r"yesterday",
        "yesterday",
        lambda now: (
            _start_of_day(now - timedelta(days=1)),
            _end_of_day(now - timedelta(days=1)),
        ),
    ),
    (
        r"today",
        "today",
        lambda now: (
            _start_of_day(now),
            now,
        ),
    ),
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_time_range_from_query(query: str, now_ms: int) -> dict | None:
    """
    Scans the query (case-insensitive) for time reference phrases and returns
    the corresponding time range as Unix millisecond boundaries.

    Patterns are checked most-specific-first so "yesterday morning" always
    wins over "yesterday" when both would match.

    Args:
        query:  The user's natural language recall query.
        now_ms: Current time as a Unix millisecond timestamp. Because the
                backend runs locally on the user's machine, converting this
                via datetime.fromtimestamp() yields the user's local wall-clock
                time — no explicit timezone handling is needed.

    Returns:
        {"start_ms": int, "end_ms": int, "label": str} if a known time
        phrase is found, or None if the query contains no time reference.
    """
    now_local = datetime.fromtimestamp(now_ms / 1000)
    normalised_query = query.lower()

    for pattern, label, compute in _TIME_PATTERNS:
        if re.search(pattern, normalised_query):
            start_dt, end_dt = compute(now_local)
            return {
                "start_ms": _to_ms(start_dt),
                "end_ms":   _to_ms(end_dt),
                "label":    label,
            }

    return None
