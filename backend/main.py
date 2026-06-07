import asyncio
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import create_all_tables
from routes.capture import router as capture_router
from routes.feedback import router as feedback_router
from routes.memory import router as memory_router
from routes.privacy import router as privacy_router
from routes.recall import router as recall_router
from scheduler import create_session_scheduler
from services.qdrant_service import initialize_qdrant_collection
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
