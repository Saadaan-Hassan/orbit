"""
Feedback endpoint — stores thumbs-up / thumbs-down ratings on recall responses.

Used to surface quality signals for future model or prompt improvements.
"""

import uuid
import logging
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import text

from database import _async_engine

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------


class FeedbackRequest(BaseModel):
    rating: Literal["positive", "negative"]
    comment: Optional[str] = Field(default=None, max_length=4_000)
    # Caller may attach the recall query or a snippet of the response so the
    # feedback row has enough context to be actionable without a separate join.
    context: Optional[str] = Field(default=None, max_length=10_000)


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post("/feedback")
async def submit_feedback(request: FeedbackRequest) -> dict:
    feedback_id = str(uuid.uuid4())
    timestamp_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                """
                INSERT INTO feedback (id, timestamp, rating, comment, context)
                VALUES (:id, :timestamp, :rating, :comment, :context)
                """
            ),
            {
                "id": feedback_id,
                "timestamp": timestamp_ms,
                "rating": request.rating,
                "comment": request.comment,
                "context": request.context,
            },
        )

    logger.info("Feedback recorded: %s (id=%s)", request.rating, feedback_id)
    return {"status": "ok"}
