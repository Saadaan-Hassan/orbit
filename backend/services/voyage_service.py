"""
Voyage AI embedding service.

Generates text embeddings by calling Voyage AI directly — no maintainer
infrastructure of any kind sits between this backend and Voyage (the former
Cloudflare Worker BYOK relay was removed entirely; there is nothing left to
proxy through). `database.get_voyage_api_key()` reads the user's own key
from macOS Keychain immediately before use and attaches it as a standard
`Authorization: Bearer` header; with no personal key configured, embeddings
are simply unavailable (session generation and recall already degrade
gracefully without them — semantic search is a supplement to FTS5, never a
requirement).

One httpx.AsyncClient is created at module level and reused for every
request — never instantiate a new client per call.
"""

import asyncio
import logging
import random
import time

import httpx

from database import get_voyage_api_key
from services.provider_context_sanitizer import (
    log_provider_diagnostic,
    sanitize_embedding_text,
)

logger = logging.getLogger(__name__)


class VoyageUnavailableError(RuntimeError):
    """Embeddings aren't available right now, for a BYOK-shaped reason rather
    than a transport failure: no personal key is configured (the expected,
    common state — COST-002/003), or a recent 401/403/429 put Voyage in a
    cooldown (COST-005). Callers that want the same graceful "provider
    unavailable" handling they already give httpx errors should catch this
    alongside them."""

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VOYAGE_EMBEDDING_MODEL = "voyage-3-lite"

# voyage-3-lite produces 512-dimensional vectors.
VOYAGE_EMBEDDING_DIMENSION = 512

HTTP_REQUEST_TIMEOUT_SECONDS = 30.0

# BYOK target — called directly with the user's own key, the same pattern
# groq_service.py already uses. No maintainer infrastructure sits in front
# of this at all.
VOYAGE_DIRECT_API_URL = "https://api.voyageai.com/v1/embeddings"

# COST-005: a bad key (401/403) or a rate limit (429) won't resolve itself
# between one session's embedding and the next in the same batch — this
# cooldown stops every session in a backlog from independently rediscovering
# the same failure. Not per-model like Groq's cooldown (only one embedding
# model exists), so a plain module-level timestamp is enough. Auth failures
# get a longer cooldown than rate limits since a revoked/invalid key is very
# unlikely to fix itself quickly, unlike a rate-limit window.
_voyage_rate_limited_until: float = 0.0
_VOYAGE_AUTH_FAILURE_COOLDOWN_SECONDS = 300.0
_VOYAGE_DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 90.0

# ---------------------------------------------------------------------------
# Singleton HTTP client — no base_url, since every call already goes
# directly to VOYAGE_DIRECT_API_URL.
# ---------------------------------------------------------------------------

_http_client = httpx.AsyncClient(timeout=HTTP_REQUEST_TIMEOUT_SECONDS)


def _set_voyage_cooldown(seconds: float) -> None:
    global _voyage_rate_limited_until
    _voyage_rate_limited_until = time.monotonic() + seconds


def _backoff_delay_seconds(attempt_number: int) -> float:
    """Bounded exponential backoff with jitter (COST-005) — a small random
    component avoids every session in a batch retrying in perfect lockstep
    if several embed calls hit a transient failure at the same moment."""
    return (2 ** attempt_number) + random.uniform(0, 0.5)


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

async def generate_text_embedding(text_to_embed: str) -> list[float]:
    """
    Returns a 512-dimensional embedding vector for the given text string.

    Calls the Worker /embed route, which proxies to Voyage AI with the
    API key injected server-side.

    Uses voyage-3-lite with input_type "document". At this model tier,
    document and query embeddings are symmetric — the same function is safe
    to use for both storing (session summaries) and querying (recall search).

    Retries up to 2 times on transport errors or non-2xx responses, with
    exponential backoff (1 s, 2 s). A transient failure does not permanently
    exclude the session from semantic recall — only a third consecutive failure
    raises so the caller can decide how to handle it.

    Args:
        text_to_embed: Any text string to embed.

    Returns:
        List of 512 floats representing the text in embedding space.

    Raises:
        httpx.HTTPStatusError: on non-2xx response after all retries.
        httpx.TransportError: on network failure after all retries.
    """
    # This is the final privacy boundary before the embedding leaves the
    # device. It also protects sessions created before capture sanitization.
    safe_text_to_embed = await sanitize_embedding_text(text_to_embed)
    request_body = {
        "input":      [safe_text_to_embed],
        "model":      VOYAGE_EMBEDDING_MODEL,
        "input_type": "document",
    }

    personal_api_key = await get_voyage_api_key()
    if not personal_api_key:
        # No maintainer-funded fallback exists, and no Worker to even
        # attempt a request against — there's nothing left to call at all
        # without a personal key. Fail immediately.
        log_provider_diagnostic(
            provider="voyage",
            model=VOYAGE_EMBEDDING_MODEL,
            operation="embedding",
            started_at=time.monotonic(),
            status=None,
            error=RuntimeError("no personal Voyage key configured"),
        )
        raise VoyageUnavailableError("No Voyage API key configured")

    if time.monotonic() < _voyage_rate_limited_until:
        # COST-005: a prior call in this same batch already confirmed the
        # key is bad or the account is rate-limited — don't spend a request
        # re-confirming that for every remaining session.
        logger.debug("Voyage cooldown active — skipping this embedding call.")
        raise VoyageUnavailableError("Voyage is in a cooldown after a recent auth/rate-limit failure")

    request_headers = {"Authorization": f"Bearer {personal_api_key}"}

    for attempt_number in range(3):
        started_at = time.monotonic()
        try:
            response = await _http_client.post(
                VOYAGE_DIRECT_API_URL, json=request_body, headers=request_headers
            )

            if response.is_success:
                try:
                    return response.json()["data"][0]["embedding"]
                except (KeyError, IndexError, TypeError, ValueError) as error:
                    log_provider_diagnostic(
                        provider="voyage",
                        model=VOYAGE_EMBEDDING_MODEL,
                        operation="embedding",
                        started_at=started_at,
                        status=response.status_code,
                        error=error,
                    )
                    raise

            log_provider_diagnostic(
                provider="voyage",
                model=VOYAGE_EMBEDDING_MODEL,
                operation="embedding",
                started_at=started_at,
                status=response.status_code,
            )
            if response.status_code in (401, 403):
                # An invalid/revoked key won't become valid on retry — fail
                # now, and start a cooldown so the rest of this batch (a
                # backlog can mean many sessions in one scheduler cycle)
                # doesn't each independently rediscover the same failure.
                _set_voyage_cooldown(_VOYAGE_AUTH_FAILURE_COOLDOWN_SECONDS)
                response.raise_for_status()
            elif response.status_code == 429:
                # Same reasoning as Groq's rate-limit cooldown: honour
                # Retry-After if present, and stop the rest of this batch
                # from hammering a rate-limited account.
                retry_after = float(response.headers.get("Retry-After", _VOYAGE_DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS))
                _set_voyage_cooldown(retry_after)
                response.raise_for_status()
            elif attempt_number < 2:
                await asyncio.sleep(_backoff_delay_seconds(attempt_number))
            else:
                response.raise_for_status()

        except httpx.TransportError as transport_error:
            log_provider_diagnostic(
                provider="voyage",
                model=VOYAGE_EMBEDDING_MODEL,
                operation="embedding",
                started_at=started_at,
                error=transport_error,
            )
            if attempt_number < 2:
                await asyncio.sleep(_backoff_delay_seconds(attempt_number))
            else:
                raise

    # Unreachable — the loop always raises or returns on the last attempt.
    raise RuntimeError("generate_text_embedding: exhausted retries without returning")


async def test_voyage_api_key(api_key: str) -> tuple[bool, str]:
    """
    Validates a candidate key with a single minimal embedding request — Voyage
    has no free introspection endpoint, so this costs a few tokens on the
    cheapest model, unlike Groq's free /models check. The key is used for
    exactly this one request and is never logged or persisted.
    """
    try:
        response = await _http_client.post(
            VOYAGE_DIRECT_API_URL,
            json={"input": ["test"], "model": VOYAGE_EMBEDDING_MODEL, "input_type": "document"},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10.0,
        )
    except httpx.TimeoutException:
        return False, "timeout"
    except httpx.TransportError:
        return False, "network_error"

    if response.status_code == 200:
        return True, "ok"
    if response.status_code in (401, 403):
        return False, "invalid_key"
    if response.status_code == 429:
        return False, "rate_limited"
    return False, "provider_error"
