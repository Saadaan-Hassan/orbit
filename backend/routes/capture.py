from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from models.event import CaptureEvent
from database import get_db

router = APIRouter()


@router.post("/capture")
async def capture_event(
    event: CaptureEvent,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await db.execute(
        text("""
            INSERT INTO events (id, timestamp, type, raw_content, app_name, url, source)
            VALUES (:id, :timestamp, :type, :raw_content, :app_name, :url, :source)
        """),
        {
            "id": event.id,
            "timestamp": event.timestamp,
            "type": event.type,
            "raw_content": event.raw_content,
            "app_name": event.app_name,
            "url": event.url,
            "source": event.source,
        },
    )
    await db.commit()
    return {"status": "ok", "event_id": event.id}
