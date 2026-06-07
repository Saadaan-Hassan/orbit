from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from models.event import CaptureEvent
from database import get_db, _async_engine

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


@router.get("/events")
async def get_recent_events(
    limit: int = Query(default=50, ge=1, le=500),
) -> list[dict]:
    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text(
                """
                SELECT id, timestamp, type, raw_content, app_name, url, source
                FROM   events
                ORDER  BY timestamp DESC
                LIMIT  :limit
                """
            ),
            {"limit": limit},
        )
        return [dict(row._mapping) for row in result.fetchall()]
