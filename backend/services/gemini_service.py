"""
Gemini event classification service.

All calls to the Gemini API go through this module. One genai.Client is
created at module level and reused for every request — never instantiate
a new client per call.

The classifier sends an entire batch of events in one API call and returns
them annotated with "category" and "project" fields. This keeps costs low
compared to one-call-per-event approaches.
"""

import asyncio
import json
import logging
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GEMINI_MODEL_NAME = "gemini-3.1-flash-lite"

# Retry settings for rate-limit (429) errors.
MAXIMUM_RETRY_ATTEMPTS = 3
INITIAL_RETRY_BACKOFF_SECONDS = 2.0

VALID_EVENT_CATEGORIES = {"work", "research", "personal", "system", "communication"}
DEFAULT_CATEGORY_ON_PARSE_FAILURE = "work"

CLASSIFICATION_SYSTEM_PROMPT = """You are classifying user activity events from a desktop app.
Classify each event into exactly one category:
work, research, personal, system, communication

Return ONLY a JSON array. No explanation. No markdown. No preamble.
Each item: {"id": "<event_id>", "category": "<category>", "project": "<project_name_or_null>"}"""

# ---------------------------------------------------------------------------
# Singleton client
# ---------------------------------------------------------------------------

_gemini_api_key = os.getenv("GEMINI_API_KEY")
if not _gemini_api_key:
    raise EnvironmentError(
        "GEMINI_API_KEY is not set. "
        "Add it to backend/.env before starting the server."
    )

_genai_client = genai.Client(api_key=_gemini_api_key)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_classification_prompt(events: list[dict]) -> str:
    # Send only the fields Gemini needs to classify — omitting large or
    # irrelevant fields keeps token counts low and responses focused.
    # raw_content is safe to include here: the Rust capture layer redacts
    # all secrets (API keys, private keys, JWTs, etc.) before writing to
    # SQLite, so by the time events reach this function raw_content is
    # either innocuous plaintext or a [REDACTED:<type>] placeholder.
    stripped_events = [
        {
            "id":          event.get("id", ""),
            "type":        event.get("type", ""),
            "raw_content": event.get("raw_content") or "",
            "app_name":    event.get("app_name") or "",
            "url":         event.get("url") or "",
        }
        for event in events
    ]
    return json.dumps(stripped_events, ensure_ascii=False)


def _parse_classification_response(
    response_text: str,
    original_events: list[dict],
) -> list[dict]:
    """
    Attempts to parse Gemini's JSON array response and merge the
    classification results back into the original event dicts.

    Falls back to DEFAULT_CATEGORY_ON_PARSE_FAILURE for all events if
    the response cannot be parsed or is structurally wrong — this makes
    the pipeline resilient to occasional bad Gemini outputs.
    """
    try:
        parsed_classifications = json.loads(response_text.strip())

        if not isinstance(parsed_classifications, list):
            raise ValueError("Expected a JSON array at the top level")

        # Build a lookup from event ID → classification result so we can
        # annotate events regardless of the order Gemini returns them in.
        classification_by_event_id: dict[str, dict] = {
            item["id"]: item
            for item in parsed_classifications
            if isinstance(item, dict) and "id" in item
        }

        annotated_events = []
        for original_event in original_events:
            event_copy = dict(original_event)
            classification = classification_by_event_id.get(event_copy.get("id", ""), {})

            raw_category = classification.get("category", DEFAULT_CATEGORY_ON_PARSE_FAILURE)
            # Guard against Gemini returning an out-of-spec category.
            event_copy["category"] = (
                raw_category if raw_category in VALID_EVENT_CATEGORIES
                else DEFAULT_CATEGORY_ON_PARSE_FAILURE
            )
            event_copy["project"] = classification.get("project") or None

            annotated_events.append(event_copy)

        return annotated_events

    except Exception as parse_error:
        logger.warning(
            "Failed to parse Gemini classification response: %s. "
            "Defaulting all %d events to category '%s'.",
            parse_error,
            len(original_events),
            DEFAULT_CATEGORY_ON_PARSE_FAILURE,
        )
        return [
            {**event, "category": DEFAULT_CATEGORY_ON_PARSE_FAILURE, "project": None}
            for event in original_events
        ]


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

async def classify_events_batch(events: list[dict]) -> list[dict]:
    """
    Classifies a batch of raw activity events using a single Gemini API call.

    Each event in the returned list has two new fields added:
      - "category": one of work / research / personal / system / communication
      - "project":  detected project name string, or None

    On rate-limit errors (HTTP 429) the call is retried with exponential
    backoff up to MAXIMUM_RETRY_ATTEMPTS times before giving up and
    returning the default category for all events.

    Args:
        events: List of raw event dicts as fetched from SQLite.

    Returns:
        The same events with "category" and "project" fields added.
    """
    if not events:
        return []

    user_prompt_text = _build_classification_prompt(events)
    generation_config = genai_types.GenerateContentConfig(
        system_instruction=CLASSIFICATION_SYSTEM_PROMPT,
        # Instruct Gemini to return strict JSON so no markdown fences wrap it.
        response_mime_type="application/json",
        # Low temperature — classification is deterministic, not creative.
        temperature=0.1,
    )

    last_raised_exception: Exception | None = None

    for attempt_number in range(MAXIMUM_RETRY_ATTEMPTS):
        try:
            api_response = await _genai_client.aio.models.generate_content(
                model=GEMINI_MODEL_NAME,
                contents=user_prompt_text,
                config=generation_config,
            )
            return _parse_classification_response(
                api_response.text,
                events,
            )

        except Exception as api_error:
            error_message = str(api_error).lower()
            is_rate_limit_error = "429" in error_message or "quota" in error_message

            if is_rate_limit_error and attempt_number < MAXIMUM_RETRY_ATTEMPTS - 1:
                backoff_duration_seconds = INITIAL_RETRY_BACKOFF_SECONDS * (2 ** attempt_number)
                logger.warning(
                    "Gemini rate limit hit (attempt %d/%d). "
                    "Retrying in %.1fs.",
                    attempt_number + 1,
                    MAXIMUM_RETRY_ATTEMPTS,
                    backoff_duration_seconds,
                )
                await asyncio.sleep(backoff_duration_seconds)
                last_raised_exception = api_error
            else:
                logger.error(
                    "Gemini classification failed on attempt %d: %s",
                    attempt_number + 1,
                    api_error,
                )
                last_raised_exception = api_error
                break

    logger.error(
        "All %d Gemini retry attempts exhausted (%s). "
        "Defaulting all events to category '%s'.",
        MAXIMUM_RETRY_ATTEMPTS,
        last_raised_exception,
        DEFAULT_CATEGORY_ON_PARSE_FAILURE,
    )
    return [
        {**event, "category": DEFAULT_CATEGORY_ON_PARSE_FAILURE, "project": None}
        for event in events
    ]
