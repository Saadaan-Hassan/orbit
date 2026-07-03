from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import get_setting, set_setting

router = APIRouter(prefix="/settings")


class GroqKeyRequest(BaseModel):
    api_key: str


@router.get("/groq-key")
async def get_groq_key_status() -> dict:
    value = await get_setting("groq_api_key")
    return {"configured": bool(value)}


@router.post("/groq-key")
async def save_groq_key(body: GroqKeyRequest) -> dict:
    key = body.api_key.strip()
    if not key.startswith("gsk_") or len(key) <= 20:
        raise HTTPException(
            status_code=422,
            detail="Invalid Groq API key. Must start with 'gsk_' and be longer than 20 characters.",
        )
    await set_setting("groq_api_key", key)
    return {"success": True}


@router.delete("/groq-key")
async def delete_groq_key() -> dict:
    await set_setting("groq_api_key", "")
    return {"success": True}
