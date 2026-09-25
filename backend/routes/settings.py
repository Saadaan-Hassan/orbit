from collections.abc import Awaitable, Callable

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from database import (
    get_groq_key_enabled,
    get_voyage_key_enabled,
    set_groq_key_enabled,
    set_voyage_key_enabled,
)
from services.groq_service import test_groq_api_key
from services.keychain_service import (
    KeychainUnavailableError,
    delete_groq_api_key,
    delete_voyage_api_key,
    has_groq_api_key,
    has_voyage_api_key,
    store_groq_api_key,
    store_voyage_api_key,
)
from services.voyage_service import test_voyage_api_key

router = APIRouter(prefix="/settings")


class ApiKeyRequest(BaseModel):
    api_key: str = Field(max_length=512)


class ApiKeyEnabledRequest(BaseModel):
    enabled: bool


def _is_plausible_groq_key(key: str) -> bool:
    return key.startswith("gsk_") and len(key) > 20


def _is_plausible_voyage_key(key: str) -> bool:
    # Voyage keys don't document a fixed prefix the way Groq's gsk_ does —
    # only a sane, generous length bound is enforced here.
    return len(key) > 20


# ---------------------------------------------------------------------------
# Shared BYOK CRUD logic. Both Groq and Voyage keys are stored only in macOS
# Keychain (never SQLite), and a GET here returns only {configured, enabled}
# — the raw key is never returned to the webview once saved (COST-001/002).
# ---------------------------------------------------------------------------


async def _get_key_status(
    has_key: Callable[[], Awaitable[bool]],
    get_enabled: Callable[[], Awaitable[bool]],
) -> dict:
    try:
        configured = await has_key()
    except KeychainUnavailableError:
        # Do not report a stale SQLite credential as configured. The UI can
        # ask the user to unlock/fix Keychain before changing the key.
        configured = False
    return {"configured": configured, "enabled": await get_enabled()}


async def _save_key(
    api_key: str,
    is_plausible: Callable[[str], bool],
    format_error: str,
    store_key: Callable[[str], Awaitable[None]],
    set_enabled: Callable[[bool], Awaitable[None]],
) -> dict:
    key = api_key.strip()
    if not is_plausible(key):
        raise HTTPException(status_code=422, detail=format_error)
    try:
        await store_key(key)
    except KeychainUnavailableError as err:
        raise HTTPException(
            status_code=503,
            detail="macOS Keychain is unavailable. Your key was not saved.",
        ) from err
    # Saving a new key implies the intent to use it right away, even if a
    # previous key had been paused.
    await set_enabled(True)
    return {"success": True}


async def _delete_key(
    delete_key: Callable[[], Awaitable[None]],
    set_enabled: Callable[[bool], Awaitable[None]],
) -> dict:
    try:
        await delete_key()
    except KeychainUnavailableError as err:
        raise HTTPException(
            status_code=503,
            detail="macOS Keychain is unavailable. Your key was not removed.",
        ) from err
    await set_enabled(True)
    return {"success": True}


# ---------------------------------------------------------------------------
# Groq
# ---------------------------------------------------------------------------


@router.get("/groq-key")
async def get_groq_key_status() -> dict:
    return await _get_key_status(has_groq_api_key, get_groq_key_enabled)


@router.post("/groq-key/test")
async def test_groq_key(body: ApiKeyRequest) -> dict:
    """
    Validates a candidate key directly against Groq before the user commits
    to saving it. The key is used for exactly this one request and is never
    written to SQLite, Keychain, logs, or any analytics/crash event.
    """
    key = body.api_key.strip()
    if not _is_plausible_groq_key(key):
        return {"valid": False, "reason": "invalid_format"}
    valid, reason = await test_groq_api_key(key)
    return {"valid": valid, "reason": reason}


@router.post("/groq-key")
async def save_groq_key(body: ApiKeyRequest) -> dict:
    return await _save_key(
        body.api_key,
        _is_plausible_groq_key,
        "Invalid Groq API key. Must start with 'gsk_' and be longer than 20 characters.",
        store_groq_api_key,
        set_groq_key_enabled,
    )


@router.delete("/groq-key")
async def delete_groq_key() -> dict:
    return await _delete_key(delete_groq_api_key, set_groq_key_enabled)


@router.post("/groq-key/enabled")
async def set_groq_key_enabled_route(body: ApiKeyEnabledRequest) -> dict:
    """Pauses or resumes Groq usage without discarding the stored key — lets
    the user temporarily fall back to Orbit's default provider (e.g. during a
    rate-limit or cost spike) without having to re-enter their key later."""
    await set_groq_key_enabled(body.enabled)
    return {"success": True, "enabled": body.enabled}


# ---------------------------------------------------------------------------
# Voyage AI (embeddings)
# ---------------------------------------------------------------------------


@router.get("/voyage-key")
async def get_voyage_key_status() -> dict:
    return await _get_key_status(has_voyage_api_key, get_voyage_key_enabled)


@router.post("/voyage-key/test")
async def test_voyage_key(body: ApiKeyRequest) -> dict:
    """
    Validates a candidate key with a single minimal embedding request (Voyage
    has no free introspection endpoint). Never written to SQLite, Keychain,
    logs, or any analytics/crash event regardless of the outcome.
    """
    key = body.api_key.strip()
    if not _is_plausible_voyage_key(key):
        return {"valid": False, "reason": "invalid_format"}
    valid, reason = await test_voyage_api_key(key)
    return {"valid": valid, "reason": reason}


@router.post("/voyage-key")
async def save_voyage_key(body: ApiKeyRequest) -> dict:
    return await _save_key(
        body.api_key,
        _is_plausible_voyage_key,
        "Invalid Voyage API key. Must be longer than 20 characters.",
        store_voyage_api_key,
        set_voyage_key_enabled,
    )


@router.delete("/voyage-key")
async def delete_voyage_key() -> dict:
    return await _delete_key(delete_voyage_api_key, set_voyage_key_enabled)


@router.post("/voyage-key/enabled")
async def set_voyage_key_enabled_route(body: ApiKeyEnabledRequest) -> dict:
    """Pauses or resumes semantic search without discarding the stored key —
    recall and session generation already fall back to FTS5-only when no
    Voyage key is active, so this is always safe to disable."""
    await set_voyage_key_enabled(body.enabled)
    return {"success": True, "enabled": body.enabled}
