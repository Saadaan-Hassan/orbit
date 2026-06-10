"""
Gemini event classification service.

Calls the Gemini generateContent API through the Cloudflare Worker proxy
(/classify route) so the GEMINI_API_KEY never lives on the user's machine.

One httpx.AsyncClient is created at module level and reused for every
request — never instantiate a new client per call.
"""

import asyncio
import json
import logging
import os

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GEMINI_MODEL_NAME = "gemini-3.1-flash-lite"

MAXIMUM_RETRY_ATTEMPTS = 3
INITIAL_RETRY_BACKOFF_SECONDS = 2.0

VALID_EVENT_CATEGORIES = {"work", "research", "personal", "system", "communication"}
DEFAULT_CATEGORY_ON_PARSE_FAILURE = "work"

HTTP_REQUEST_TIMEOUT_SECONDS = 60.0

CLASSIFICATION_SYSTEM_PROMPT = """You are classifying user activity events from a desktop app.
Classify each event into exactly one category:
work, research, personal, system, communication

Return ONLY a JSON array. No explanation. No markdown. No preamble.
Each item: {"id": "<event_id>", "category": "<category>", "project": "<project_name_or_null>"}"""

# ---------------------------------------------------------------------------
# Singleton HTTP client — points at the Cloudflare Worker, not Gemini directly.
# The Worker injects the GEMINI_API_KEY before forwarding to Google.
# ---------------------------------------------------------------------------

_worker_url = os.getenv("WORKER_URL", "http://localhost:8787")

_http_client = httpx.AsyncClient(timeout=HTTP_REQUEST_TIMEOUT_SECONDS)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_classification_prompt(events: list[dict]) -> str:
    """
    Builds the JSON prompt payload for Gemini classification.

    Fields sent per event: id, type, app_name, url, raw_content.

    raw_content is safe to send — Rust's capture layer redacts all secrets
    (API keys, JWTs, private keys, credit cards, SSNs, etc.) before any
    SQLite write, so by the time events reach this function raw_content is
    either innocuous plaintext or a [REDACTED:<type>] placeholder.
    Gemini needs the actual content — app names alone are not enough to
    classify accurately (e.g. distinguishing a work YouTube tab from a
    personal one requires the page title or URL).
    """
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


def _build_gemini_request_body(user_prompt: str) -> dict:
    """
    Builds the Gemini generateContent REST request body.

    This matches the shape the Gemini REST API (v1beta) expects:
      system_instruction, contents, generationConfig
    The Worker adds the ?key= query param before forwarding to Google.
    """
    return {
        "system_instruction": {
            "parts": [{"text": CLASSIFICATION_SYSTEM_PROMPT}],
        },
        "contents": [
            {"role": "user", "parts": [{"text": user_prompt}]},
        ],
        "generationConfig": {
            # Force JSON output — no markdown fences, no preamble.
            "responseMimeType": "application/json",
            # Low temperature: classification is deterministic, not creative.
            "temperature": 0.1,
        },
    }


def _extract_text_from_gemini_response(response_body: dict) -> str:
    """
    Extracts the generated text from a Gemini generateContent REST response.

    Gemini REST shape:
      { "candidates": [{ "content": { "parts": [{ "text": "..." }] } }] }
    """
    try:
        return response_body["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as extraction_error:
        raise ValueError(
            f"Unexpected Gemini response shape: {extraction_error}"
        ) from extraction_error


def _parse_classification_response(
    response_text: str,
    original_events: list[dict],
) -> list[dict]:
    """
    Parses Gemini's JSON array response and merges results back into events.

    Falls back to DEFAULT_CATEGORY_ON_PARSE_FAILURE for all events if the
    response cannot be parsed — keeps the pipeline resilient to bad outputs.
    """
    try:
        parsed_classifications = json.loads(response_text.strip())

        if not isinstance(parsed_classifications, list):
            raise ValueError("Expected a JSON array at the top level")

        classification_by_event_id: dict[str, dict] = {
            item["id"]: item
            for item in parsed_classifications
            if isinstance(item, dict) and "id" in item
        }

        annotated_events = []
        for original_event in original_events:
            event_copy = dict(original_event)
            classification = classification_by_event_id.get(
                event_copy.get("id", ""), {}
            )

            raw_category = classification.get(
                "category", DEFAULT_CATEGORY_ON_PARSE_FAILURE
            )
            event_copy["category"] = (
                raw_category
                if raw_category in VALID_EVENT_CATEGORIES
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
    Classifies a batch of raw activity events via the Worker /classify route.

    Each event in the returned list gains two new fields:
      - "category": one of work / research / personal / system / communication
      - "project":  detected project name string, or None

    On rate-limit errors (HTTP 429) the call is retried with exponential
    backoff up to MAXIMUM_RETRY_ATTEMPTS times before giving up and
    defaulting all events to DEFAULT_CATEGORY_ON_PARSE_FAILURE.

    Args:
        events: List of raw event dicts as fetched from SQLite.

    Returns:
        The same events with "category" and "project" fields added.
    """
    if not events:
        return []

    user_prompt = _build_classification_prompt(events)
    request_body = _build_gemini_request_body(user_prompt)

    last_raised_exception: Exception | None = None

    for attempt_number in range(MAXIMUM_RETRY_ATTEMPTS):
        try:
            response = await _http_client.post(
                f"{_worker_url}/classify",
                params={"model": GEMINI_MODEL_NAME},
                json=request_body,
            )
            response.raise_for_status()

            response_body = response.json()
            generated_text = _extract_text_from_gemini_response(response_body)
            return _parse_classification_response(generated_text, events)

        except Exception as api_error:
            error_message = str(api_error).lower()
            is_rate_limit = "429" in error_message or "quota" in error_message

            if is_rate_limit and attempt_number < MAXIMUM_RETRY_ATTEMPTS - 1:
                backoff = INITIAL_RETRY_BACKOFF_SECONDS * (2 ** attempt_number)
                logger.warning(
                    "Gemini rate limit (attempt %d/%d). Retrying in %.1fs.",
                    attempt_number + 1,
                    MAXIMUM_RETRY_ATTEMPTS,
                    backoff,
                )
                await asyncio.sleep(backoff)
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
        "Defaulting all events to '%s'.",
        MAXIMUM_RETRY_ATTEMPTS,
        last_raised_exception,
        DEFAULT_CATEGORY_ON_PARSE_FAILURE,
    )
    return [
        {**event, "category": DEFAULT_CATEGORY_ON_PARSE_FAILURE, "project": None}
        for event in events
    ]
