import json
import logging
import os
import time
from typing import AsyncGenerator

import httpx

from database import get_groq_api_key

logger = logging.getLogger(__name__)

GROQ_SESSION_MODEL = "openai/gpt-oss-120b"
GROQ_RECALL_MODEL = "llama-3.3-70b-versatile"
# Fast, cheap model for high-volume event classification.
GROQ_CLASSIFY_MODEL = "llama-3.1-8b-instant"
# llama-3.1-8b-instant's fixed context window (prompt + completion combined).
# This is a permanent architectural limit of this model — separate from, and
# unaffected by, account-tier rate limits (RPM/TPM). A large backlog of
# unclassified events (e.g. after the app was closed for a while) can still
# exceed this in a single request, so classify_events_batch_groq splits by
# actual estimated size when needed. No individual event's content is ever
# truncated — only the number of events per request is adjusted.
GROQ_CLASSIFY_CONTEXT_WINDOW_TOKENS = 131_072

_WORKER_URL = os.getenv("WORKER_URL", "")

_http_client: httpx.AsyncClient | None = None

# When Groq returns 429, all batches in the same (and nearby) scheduler run
# skip Groq without making a network request. Resets once monotonic time
# passes the value stored here. Module-level so it persists across async calls.
# Tracked per-model since session-summary and classification models have
# independent rate-limit budgets on Groq.
_groq_rate_limited_until: dict[str, float] = {}


# Session generation and classification run in the background scheduler, not
# on a user-facing request path, so a generous timeout is safe. Large
# classification batches (hundreds of events after a backlog) can legitimately
# need tens of thousands of completion tokens — at ~560 tokens/sec that alone
# can take over a minute, before accounting for network latency.
_GROQ_REQUEST_TIMEOUT_SECONDS = 180.0


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=_GROQ_REQUEST_TIMEOUT_SECONDS)
    return _http_client


async def _call_groq_chat(
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    reasoning_effort: str | None = None,
) -> str | None:
    """
    Shared low-level Groq chat-completions call used by both session summary
    generation and event classification.

    reasoning_effort: only meaningful for reasoning models (openai/gpt-oss-*).
    Their internal chain-of-thought counts against the same max_tokens budget
    as the visible answer — at the default "medium" effort, reasoning can
    consume most of a modest token budget before the model even starts
    writing the JSON response, causing truncation. Pass "low" for structured-
    extraction tasks that don't need deep reasoning. Omitted for non-reasoning
    models (e.g. llama-3.1-8b-instant), which don't support this parameter.

    Groq is Orbit's centrally-funded default provider — no personal key is
    required. If the user has configured their own key (a per-user override,
    currently not exposed in the app UI), it's sent via X-Groq-Api-Key and
    takes precedence at the Worker; otherwise the Worker uses its own shared
    GROQ_API_KEY secret.

    Returns the raw text content of the model's reply, or None when:
    - This model is in a rate-limit cooldown (429 received recently).
    - The request fails for any reason (network error, non-2xx, bad shape),
      including the admin kill switch returning 503 (GROQ_PROXY_ENABLED=false).

    Never raises — callers treat None as "Groq unavailable for this call".
    """
    # Skip immediately if this model is inside a rate-limit cooldown window
    # so subsequent batches in the same scheduler run don't all hit the API.
    if time.monotonic() < _groq_rate_limited_until.get(model, 0.0):
        logger.debug("Groq rate-limit cooldown active for %s — skipping this call.", model)
        return None

    request_body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.2,
        # response_format omitted: not all Groq models support json_object mode.
        # JSON output is enforced by the system prompt instruction instead.
    }
    if reasoning_effort is not None:
        request_body["reasoning_effort"] = reasoning_effort

    request_headers = {}
    personal_api_key = await get_groq_api_key()
    if personal_api_key:
        request_headers["X-Groq-Api-Key"] = personal_api_key

    try:
        response = await _get_http_client().post(
            f"{_WORKER_URL}/chat-groq",
            json=request_body,
            headers=request_headers,
            timeout=_GROQ_REQUEST_TIMEOUT_SECONDS,
        )
    except Exception as network_error:
        logger.warning("Groq request network error (%s): %s", model, network_error)
        return None

    if response.status_code == 429:
        # Honour the Retry-After header if present; default to 90 s so we
        # clear the backoff well before the next 30-minute scheduler run.
        retry_after = int(response.headers.get("Retry-After", "90"))
        _groq_rate_limited_until[model] = time.monotonic() + retry_after
        try:
            limit_detail = response.json().get("error", {}).get("message", "no detail")
        except Exception:
            limit_detail = response.text[:200]
        logger.warning(
            "Groq rate limit reached for %s — skipping for %d seconds. Groq says: %s",
            model,
            retry_after,
            limit_detail,
        )
        return None

    if response.status_code == 413:
        # Request too large for this model's per-request token budget. This is
        # a payload-size problem, not a time-based quota — retrying later won't
        # help, only sending less content will. No cooldown is set.
        try:
            size_detail = response.json().get("error", {}).get("message", response.text[:300])
        except Exception:
            size_detail = response.text[:300]
        logger.warning("Groq request too large (%s): %s", model, size_detail)
        return None

    if not response.is_success:
        try:
            error_detail = response.json().get("error", {}).get("message", response.text[:300])
        except Exception:
            error_detail = response.text[:300]
        logger.warning("Groq request HTTP %d (%s): %s", response.status_code, model, error_detail)
        return None

    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"]
    except Exception as parse_error:
        logger.warning("Groq response parse error (%s): %s", model, parse_error)
        return None

    if not content or not content.strip():
        finish_reason = None
        try:
            finish_reason = data["choices"][0].get("finish_reason")
        except Exception:
            pass
        logger.warning(
            "Groq returned an empty completion (%s). finish_reason=%s",
            model,
            finish_reason,
        )
        return None

    return content


def _strip_code_fences(text_value: str) -> str:
    cleaned = text_value.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        cleaned = cleaned.rsplit("```", 1)[0].strip()
    return cleaned


async def generate_session_summary_groq(
    user_prompt: str,
    system_prompt: str,
) -> dict | None:
    """
    Try to generate a session summary via the user's own Groq API key.

    Returns a parsed dict on success, or None on any failure (no key, rate
    limit, network error, unparsable response). Never raises.
    """
    # Append a Groq-specific safety rule to the base system prompt.
    # LLMs sometimes write literal JSON syntax (braces, quotes) inside string
    # values when describing code changes — that produces invalid JSON.
    # The 'evidence' field is the biggest offender since it summarises diffs.
    # Keeping it ≤15 words of plain prose eliminates the failure mode.
    groq_system_prompt = (
        system_prompt
        + "\n\nCRITICAL JSON SAFETY RULE: Every string value in your JSON response"
        " must be plain text with no JSON syntax, curly braces, square brackets,"
        " or unescaped quote characters inside it. The 'evidence' field must be"
        " a single plain-English sentence of ≤15 words — no code, no JSON, no file paths."
    )

    raw_text = await _call_groq_chat(
        model=GROQ_SESSION_MODEL,
        system_prompt=groq_system_prompt,
        user_prompt=user_prompt,
        max_tokens=3000,
        # openai/gpt-oss-120b is a reasoning model — its internal chain-of-
        # thought counts against max_tokens before it writes the visible
        # answer. At the default "medium" effort this was consuming most of
        # the budget on invisible reasoning, cutting off the JSON response
        # mid-field. This task is structured extraction from a single fused-
        # signal block, not multi-step reasoning, so "low" is sufficient and
        # leaves the budget for the actual 10-field JSON answer.
        reasoning_effort="low",
    )
    if raw_text is None:
        return None

    cleaned = _strip_code_fences(raw_text)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Second attempt: extract the outermost {...} block and try again.
        # Handles cases where the model appended trailing prose after the JSON
        # or included a stray character outside the object.
        brace_start = cleaned.find("{")
        brace_end = cleaned.rfind("}")
        if brace_start != -1 and brace_end > brace_start:
            try:
                return json.loads(cleaned[brace_start : brace_end + 1])
            except json.JSONDecodeError:
                pass

        logger.warning(
            "Groq session summary JSON parse failure. Raw (first 300): %.300s",
            raw_text,
        )
        return None


CLASSIFICATION_SYSTEM_PROMPT = """You are classifying user activity events from a desktop app.
Classify each event into exactly one category:
work, research, personal, system, communication

Return ONLY a JSON array. No explanation. No markdown. No preamble.
Every string value must be plain text with no JSON syntax, curly braces, or
unescaped quote characters inside it.
Each item: {"id": "<event_id>", "category": "<category>", "project": "<project_name_or_null>"}"""

# Headroom per event for the response array entry — deliberately TIGHT, not
# generous. A real entry ({"id": "<36-char uuid>", "category": "communication",
# "project": "some_project"}) needs roughly 35-50 tokens. The budget here is
# a cost-control lever, not just an anti-truncation buffer: this model has an
# observed tendency to occasionally enter a repetition loop and keep emitting
# array entries well past the number of events sent (seen producing 20,000-
# 57,000 output tokens for what should have been a few thousand at most). A
# generous max_tokens doesn't prevent that loop — it just lets it run longer
# and cost more before hitting the ceiling. Keeping this tight means a bad
# roll gets cut off quickly and cheaply; legitimate responses still fit
# comfortably underneath it.
GROQ_CLASSIFY_BASE_TOKENS = 50
GROQ_CLASSIFY_TOKENS_PER_EVENT = 55

# Target at most this fraction of the model's context window for the prompt,
# leaving the rest for the completion (which also scales with event count).
# This alone would allow groups of many hundreds of events — but empirically,
# asking this 8B model for a long list of classifications in one shot can
# trigger a repetition loop (observed producing 2-3x the expected number of
# array entries). This has been observed at group sizes from under 20 up to
# ~680 — it is not a hard size threshold, it's a probabilistic quirk of this
# model on long structured-output generation. A smaller group size doesn't
# eliminate the risk, but it shrinks the blast radius: fewer events need to
# be re-defaulted when a group does fail, and (combined with the tight
# max_tokens above) any single bad roll is cheap to hit and discard.
GROQ_CLASSIFY_MAX_PROMPT_TOKENS = int(GROQ_CLASSIFY_CONTEXT_WINDOW_TOKENS * 0.5)
GROQ_CLASSIFY_MAX_EVENTS_PER_GROUP = 30


def _strip_events_for_classification(events: list[dict]) -> list[dict]:
    """No truncation — every field is sent in full, matching Gemini exactly."""
    return [
        {
            "id":          event.get("id", ""),
            "type":        event.get("type", ""),
            "raw_content": event.get("raw_content") or "",
            "app_name":    event.get("app_name") or "",
            "url":         event.get("url") or "",
        }
        for event in events
    ]


def _estimate_tokens(text_value: str) -> int:
    """Coarse chars/4 estimate — good enough for a pre-flight size check."""
    return max(1, len(text_value) // 4)


def _split_events_by_estimated_size(events: list[dict]) -> list[list[dict]]:
    """
    Greedily groups events into the fewest full-fidelity sub-batches, closing
    a group once either the estimated prompt size reaches
    GROQ_CLASSIFY_MAX_PROMPT_TOKENS or the event count reaches
    GROQ_CLASSIFY_MAX_EVENTS_PER_GROUP — whichever comes first.

    No event's content is ever shortened — a single oversized event simply
    becomes its own one-event group rather than being cut down to fit.
    """
    groups: list[list[dict]] = []
    current_group: list[dict] = []
    current_tokens = 0

    for event in events:
        event_json = json.dumps(_strip_events_for_classification([event])[0], ensure_ascii=False)
        event_tokens = _estimate_tokens(event_json)

        would_exceed_tokens = current_tokens + event_tokens > GROQ_CLASSIFY_MAX_PROMPT_TOKENS
        would_exceed_count = len(current_group) >= GROQ_CLASSIFY_MAX_EVENTS_PER_GROUP
        if current_group and (would_exceed_tokens or would_exceed_count):
            groups.append(current_group)
            current_group = []
            current_tokens = 0

        current_group.append(event)
        current_tokens += event_tokens

    if current_group:
        groups.append(current_group)

    return groups


def _recover_truncated_json_array(text_value: str) -> list | None:
    """
    Salvages whatever complete objects exist in a JSON array that got cut off
    mid-stream (e.g. the completion hit max_tokens before finishing). Trims
    back to the last complete "}," or "}" and closes the array there.

    Returns the partial list on success, or None if nothing usable is found.
    This turns "one truncated response discards every classification in the
    group" into "we keep every classification the model actually finished."
    """
    last_complete = text_value.rfind("},")
    if last_complete == -1:
        last_complete = text_value.rfind("}")
        if last_complete == -1:
            return None
        candidate = text_value[: last_complete + 1] + "]"
    else:
        candidate = text_value[: last_complete + 1] + "]"

    try:
        parsed = json.loads(candidate)
        return parsed if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        return None


async def _classify_events_group_groq(events: list[dict]) -> list[dict] | None:
    """Classifies one already-safely-sized group in a single Groq call."""
    stripped_events = _strip_events_for_classification(events)
    user_prompt = json.dumps(stripped_events, ensure_ascii=False)

    # Never request more completion tokens than fit alongside this prompt in
    # the model's fixed context window — llama-3.1-8b-instant would reject
    # (or truncate) an over-budget request either way.
    estimated_prompt_tokens = _estimate_tokens(user_prompt) + _estimate_tokens(CLASSIFICATION_SYSTEM_PROMPT)
    desired_max_tokens = GROQ_CLASSIFY_BASE_TOKENS + len(events) * GROQ_CLASSIFY_TOKENS_PER_EVENT
    available_completion_budget = GROQ_CLASSIFY_CONTEXT_WINDOW_TOKENS - estimated_prompt_tokens
    max_tokens = max(1, min(desired_max_tokens, available_completion_budget))

    raw_text = await _call_groq_chat(
        model=GROQ_CLASSIFY_MODEL,
        system_prompt=CLASSIFICATION_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=max_tokens,
    )
    if raw_text is None:
        return None

    cleaned = _strip_code_fences(raw_text)

    try:
        parsed_classifications = json.loads(cleaned)
        if not isinstance(parsed_classifications, list):
            raise ValueError("Expected a JSON array at the top level")
    except Exception as parse_error:
        # Second attempt: extract the outermost [...] block and try again.
        # Handles cases where the model appended trailing prose after the JSON.
        bracket_start = cleaned.find("[")
        bracket_end = cleaned.rfind("]")
        recovered = None
        if bracket_start != -1 and bracket_end > bracket_start:
            try:
                recovered = json.loads(cleaned[bracket_start : bracket_end + 1])
                if not isinstance(recovered, list):
                    recovered = None
            except Exception:
                recovered = None

        if recovered is None and bracket_start != -1:
            # Third attempt: the array itself was cut off mid-object (hit
            # max_tokens). Salvage every complete classification instead of
            # discarding the whole group.
            recovered = _recover_truncated_json_array(cleaned[bracket_start:])
            if recovered is not None:
                logger.warning(
                    "Groq classification response was truncated — recovered "
                    "%d of %d classification(s) from the partial response.",
                    len(recovered),
                    len(events),
                )

        if recovered is None:
            logger.warning(
                "Groq classification JSON parse failure: %s. Raw (first 300): %.300s",
                parse_error,
                raw_text,
            )
            return None

        parsed_classifications = recovered

    # Sanity check against repetition-loop degeneration: a small model asked
    # for a very long structured list can occasionally start repeating itself
    # instead of stopping, producing far more array entries than events sent.
    # That output is unreliable — better to report failure (caller defaults
    # the group to 'work') than to silently key off of it.
    if len(parsed_classifications) > len(events) * 1.5:
        logger.warning(
            "Groq classification returned %d entries for a %d-event group — "
            "likely a repetition-loop artifact. Discarding as unreliable.",
            len(parsed_classifications),
            len(events),
        )
        return None

    valid_categories = {"work", "research", "personal", "system", "communication"}
    classification_by_event_id = {
        item["id"]: item
        for item in parsed_classifications
        if isinstance(item, dict) and "id" in item
    }

    annotated_events = []
    for original_event in events:
        event_copy = dict(original_event)
        classification = classification_by_event_id.get(event_copy.get("id", ""), {})

        raw_category = classification.get("category", "work")
        event_copy["category"] = raw_category if raw_category in valid_categories else "work"
        raw_project = classification.get("project")
        event_copy["project"] = (
            raw_project
            if isinstance(raw_project, str) and raw_project.strip().lower() != "null"
            else None
        )

        annotated_events.append(event_copy)

    return annotated_events


async def classify_events_batch_groq(events: list[dict]) -> list[dict] | None:
    """
    Classify a batch of raw activity events via the user's own Groq API key.

    Mirrors gemini_service.classify_events_batch's input/output shape and
    input fidelity exactly (same fields, no truncation) so the two providers
    are directly comparable and Groq never gives a worse answer purely from
    missing context: each event gains "category" and "project" fields.

    Typical batches (tens of events) are sent in a single request, identical
    to how Gemini handles them. Only when the estimated prompt size would
    exceed llama-3.1-8b-instant's fixed context window (e.g. a large backlog
    after the app was closed for a while) is the batch split into multiple
    full-fidelity groups — no event's content is ever shortened, only the
    number of events per request is adjusted to fit the model's hard limit.

    Returns None only if every group fails outright (e.g. no Groq key
    configured). If some groups succeed and others fail, the failed groups'
    events default to category 'work' rather than discarding classifications
    the rest of the batch already got right. Never raises.
    """
    if not events:
        return []

    groups = _split_events_by_estimated_size(events)

    if len(groups) > 1:
        logger.info(
            "Groq classification: %d events exceed a single request's safe "
            "context-window budget — splitting into %d full-fidelity group(s).",
            len(events),
            len(groups),
        )

    annotated_events: list[dict] = []
    any_group_succeeded = False

    for group in groups:
        group_result = await _classify_events_group_groq(group)
        if group_result is not None:
            any_group_succeeded = True
            annotated_events.extend(group_result)
        else:
            logger.warning(
                "Groq classification failed for a %d-event group — "
                "defaulting those events to category 'work'.",
                len(group),
            )
            annotated_events.extend(
                {**event, "category": "work", "project": None} for event in group
            )

    return annotated_events if any_group_succeeded else None


# ---------------------------------------------------------------------------
# Recall streaming
# ---------------------------------------------------------------------------

# User-facing chat, unlike classification/session-summary — a shorter
# timeout matches the user's expectation of a live, responsive answer rather
# than a background job that can afford to wait.
_GROQ_RECALL_TIMEOUT_SECONDS = 30.0


async def stream_recall_response_groq(
    system_prompt: str,
    user_prompt: str,
    conversation_history: list[dict] | None = None,
) -> AsyncGenerator[str, None]:
    """
    Streams a recall answer from Groq via the Cloudflare Worker and yields
    raw text delta strings as they arrive.

    Mirrors claude_service.stream_recall_response's signature and yield
    shape exactly, so recall.py's caller doesn't need to know which provider
    is behind it. Groq's Chat Completions API is OpenAI-compatible: the
    system prompt is a "system"-role message (not a separate top-level field
    like Anthropic's), and streaming chunks arrive as
    `data: {"choices":[{"delta":{"content":"..."}}]}` lines, terminated by
    `data: [DONE]` — a different wire format from Anthropic's
    content_block_delta events, so this cannot reuse Claude's parser.

    Raises httpx.HTTPStatusError / ConnectError / TimeoutException on
    failure — recall.py's existing exception handling around the Claude
    call already catches exactly these and falls back to the offline FTS5
    message, so no new error handling is needed there.
    """
    prior_messages = [
        {"role": msg["role"], "content": msg["content"]}
        for msg in (conversation_history or [])
        if msg.get("role") in ("user", "assistant") and msg.get("content")
    ]

    request_body = {
        "model": GROQ_RECALL_MODEL,
        "stream": True,
        "temperature": 0.3,
        "messages": [
            {"role": "system", "content": system_prompt},
            *prior_messages,
            {"role": "user", "content": user_prompt},
        ],
    }

    request_headers = {}
    personal_api_key = await get_groq_api_key()
    if personal_api_key:
        request_headers["X-Groq-Api-Key"] = personal_api_key

    async with _get_http_client().stream(
        "POST",
        f"{_WORKER_URL}/chat-groq",
        json=request_body,
        headers=request_headers,
        timeout=_GROQ_RECALL_TIMEOUT_SECONDS,
    ) as streaming_response:
        streaming_response.raise_for_status()

        async for raw_line in streaming_response.aiter_lines():
            if not raw_line.startswith("data: "):
                continue

            raw_json_payload = raw_line[len("data: "):]

            if raw_json_payload.strip() == "[DONE]":
                break

            try:
                event_data = json.loads(raw_json_payload)
            except json.JSONDecodeError:
                continue

            try:
                delta_text = event_data["choices"][0]["delta"].get("content")
            except (KeyError, IndexError, TypeError):
                continue

            if delta_text:
                yield delta_text
