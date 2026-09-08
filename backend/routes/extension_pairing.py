"""Explicit, revocable pairing for the capture-only Chrome extension."""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from database import _async_engine
from local_api_security import EXTENSION_ORIGIN_RE, PairingCodeRegistry, pairing_codes

router = APIRouter(prefix="/extension")


class PairRequest(BaseModel):
    code: str = Field(min_length=16, max_length=128)


@router.post("/pairing-code")
async def issue_pairing_code() -> dict[str, int | str]:
    # Protected by the app-session middleware. It is shown only in Orbit's UI.
    return {"code": pairing_codes.issue(), "expires_in_seconds": 300}


@router.post("/pair")
async def pair_extension(request: Request, body: PairRequest) -> dict[str, str]:
    origin = request.headers.get("origin", "")
    match = EXTENSION_ORIGIN_RE.fullmatch(origin)
    if match is None or not pairing_codes.consume(body.code):
        raise HTTPException(status_code=401, detail="Pairing code is invalid or expired.")

    extension_id = match.group(1)
    token = secrets.token_urlsafe(32)
    token_hash = PairingCodeRegistry._hash_token(token)
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    async with _async_engine.begin() as connection:
        await connection.execute(
            text("""
                INSERT INTO paired_extensions (extension_id, token_hash, created_at, revoked_at)
                VALUES (:extension_id, :token_hash, :created_at, NULL)
                ON CONFLICT(extension_id) DO UPDATE SET
                    token_hash = excluded.token_hash,
                    created_at = excluded.created_at,
                    revoked_at = NULL
            """),
            {"extension_id": extension_id, "token_hash": token_hash, "created_at": now_ms},
        )
    return {"token": token}


@router.get("/status")
async def extension_status() -> dict[str, bool]:
    async with _async_engine.connect() as connection:
        result = await connection.execute(text("SELECT 1 FROM paired_extensions WHERE revoked_at IS NULL LIMIT 1"))
    return {"paired": result.fetchone() is not None}


@router.delete("/pairing")
async def revoke_extension_pairings() -> dict[str, bool]:
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    async with _async_engine.begin() as connection:
        await connection.execute(
            text("UPDATE paired_extensions SET revoked_at = :now WHERE revoked_at IS NULL"), {"now": now_ms}
        )
    return {"revoked": True}
