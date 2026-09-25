import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Response

from database import create_all_tables, migrate_legacy_groq_api_key_to_keychain
from local_api_security import LocalApiSecurityConfig, LocalApiSecurityMiddleware
from routes.capture import router as capture_router
from routes.extension_pairing import router as extension_pairing_router
from routes.feedback import router as feedback_router
from routes.memory import router as memory_router
from routes.privacy import router as privacy_router
from routes.projects import router as projects_router
from routes.recall import router as recall_router
from routes.settings import router as settings_router
from routes.timeline import router as timeline_router
from scheduler import create_session_scheduler

load_dotenv()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # In production, this raises before any database or scheduler startup
    # when the Tauri parent has not supplied a valid session token.
    app.state.local_api_security = LocalApiSecurityConfig.from_environment()

    await create_all_tables()
    migration_succeeded = await migrate_legacy_groq_api_key_to_keychain()
    if not migration_succeeded:
        logger.warning(
            "A legacy local provider credential could not be moved to macOS Keychain; "
            "the existing value was left untouched."
        )
    # Qdrant is initialised lazily, only on the first successful embedding
    # (COST-003) — most installs never configure a Voyage key, and should
    # never touch Qdrant's local storage at all in that case.

    session_scheduler = create_session_scheduler()
    session_scheduler.start()

    yield

    # wait=False so an in-flight Claude call doesn't block server shutdown.
    session_scheduler.shutdown(wait=False)


app = FastAPI(
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# Installed before all routers so a future router cannot accidentally become
# public. The config is read without logging it.
app.add_middleware(
    LocalApiSecurityMiddleware,
    config=LocalApiSecurityConfig.from_environment(),
)

app.include_router(capture_router)
app.include_router(extension_pairing_router)
app.include_router(recall_router)
app.include_router(privacy_router)
app.include_router(memory_router)
app.include_router(feedback_router)
app.include_router(projects_router)
app.include_router(settings_router)
app.include_router(timeline_router)


@app.get("/health", status_code=204)
async def health_check() -> Response:
    """Authenticated, minimal sidecar readiness probe for the Tauri parent."""
    return Response(status_code=204)
