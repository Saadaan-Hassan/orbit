import os

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from database import (
    get_groq_key_enabled,
    set_groq_key_enabled,
)
from services.groq_service import test_groq_api_key
from services.keychain_service import (
    KeychainUnavailableError,
    delete_groq_api_key,
    has_groq_api_key,
    store_groq_api_key,
)

router = APIRouter(prefix="/settings")

_WORKER_URL = os.getenv("WORKER_URL", "")
_provider_status_http_client = httpx.AsyncClient(timeout=10.0)


def _is_plausible_groq_key(key: str) -> bool:
    return key.startswith("gsk_") and len(key) > 20


class GroqKeyRequest(BaseModel):
    api_key: str = Field(max_length=512)


class GroqKeyEnabledRequest(BaseModel):
    enabled: bool


@router.get("/groq-key")
async def get_groq_key_status() -> dict:
    try:
        configured = await has_groq_api_key()
    except KeychainUnavailableError:
        # Do not report a stale SQLite credential as configured. The UI can
        # ask the user to unlock/fix Keychain before changing the key.
        configured = False
    return {
        "configured": configured,
        "enabled": await get_groq_key_enabled(),
    }


@router.post("/groq-key/test")
async def test_groq_key(body: GroqKeyRequest) -> dict:
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
async def save_groq_key(body: GroqKeyRequest) -> dict:
    key = body.api_key.strip()
    if not _is_plausible_groq_key(key):
        raise HTTPException(
            status_code=422,
            detail="Invalid Groq API key. Must start with 'gsk_' and be longer than 20 characters.",
        )
    try:
        await store_groq_api_key(key)
    except KeychainUnavailableError:
        raise HTTPException(
            status_code=503,
            detail="macOS Keychain is unavailable. Your key was not saved.",
        )
    # Saving a new key implies the intent to use it right away, even if a
    # previous key had been paused.
    await set_groq_key_enabled(True)
    return {"success": True}


@router.delete("/groq-key")
async def delete_groq_key() -> dict:
    try:
        await delete_groq_api_key()
    except KeychainUnavailableError:
        raise HTTPException(
            status_code=503,
            detail="macOS Keychain is unavailable. Your key was not removed.",
        )
    await set_groq_key_enabled(True)
    return {"success": True}


@router.post("/groq-key/enabled")
async def set_groq_key_enabled_route(body: GroqKeyEnabledRequest) -> dict:
    """Pauses or resumes Groq usage without discarding the stored key — lets
    the user temporarily fall back to Orbit's default provider (e.g. during a
    rate-limit or cost spike) without having to re-enter their key later."""
    await set_groq_key_enabled(body.enabled)
    return {"success": True, "enabled": body.enabled}


@router.get("/provider-status")
async def get_provider_status() -> dict:
    """
    Read-only status of which AI providers are currently active — reflects
    the admin kill switch set centrally on the Cloudflare Worker (see
    worker/src/index.ts's /provider-status route), not any per-user setting.
    The Privacy Panel shows this as plain status; there is no user control
    to flip these during the beta.

    Fails open (all providers reported enabled) if the Worker can't be
    reached, matching the Worker's own fail-open default — a transient
    network hiccup here should never make the UI falsely claim something is
    disabled.
    """
    try:
        response = await _provider_status_http_client.get(f"{_WORKER_URL}/provider-status")
        response.raise_for_status()
        data = response.json()
        return {
            "claude": bool(data.get("claude", True)),
            "gemini": bool(data.get("gemini", True)),
            "groq": bool(data.get("groq", True)),
        }
    except Exception:
        return {"claude": True, "gemini": True, "groq": True}
