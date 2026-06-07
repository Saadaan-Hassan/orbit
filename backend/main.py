import asyncio
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text as sqlalchemy_text

from database import create_all_tables, _async_engine as _db_engine
from routes.capture import router as capture_router
from routes.feedback import router as feedback_router
from routes.memory import router as memory_router
from routes.privacy import router as privacy_router
from routes.recall import router as recall_router
from scheduler import create_session_scheduler
from services.qdrant_service import initialize_qdrant_collection, _get_client as get_qdrant_client
from services.analytics_service import capture_analytics_event
from services.sentry_service import initialise_sentry_error_reporting

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    sentry_dsn = os.getenv("SENTRY_DSN", "")
    if sentry_dsn:
        initialise_sentry_error_reporting(
            sentry_dsn=sentry_dsn,
            app_environment=os.getenv("APP_ENVIRONMENT", "beta"),
            app_version=os.getenv("APP_VERSION", "0.1.0"),
        )

    await create_all_tables()
    await initialize_qdrant_collection()
    capture_analytics_event("app_started")

    session_scheduler = create_session_scheduler()
    session_scheduler.start()

    yield

    # wait=False so an in-flight Claude call doesn't block server shutdown.
    session_scheduler.shutdown(wait=False)


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(capture_router)
app.include_router(recall_router)
app.include_router(privacy_router)
app.include_router(memory_router)
app.include_router(feedback_router)


@app.get("/health")
async def health_check() -> dict:
    """Lightweight liveness + readiness probe used by the Tauri startup check.

    Never raises — returns status flags so the caller can decide what to show.
    """
    db_connected = False
    qdrant_connected = False

    try:
        async with _db_engine.connect() as conn:
            await conn.execute(sqlalchemy_text("SELECT 1"))
        db_connected = True
    except Exception:
        pass

    try:
        client = get_qdrant_client()
        await asyncio.to_thread(client.get_collections)
        qdrant_connected = True
    except Exception:
        pass

    return {
        "status": "ok",
        "version": os.getenv("APP_VERSION", "0.1.0"),
        "db_connected": db_connected,
        "qdrant_connected": qdrant_connected,
    }
