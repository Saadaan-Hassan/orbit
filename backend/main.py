import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import create_all_tables
from routes.capture import router as capture_router
from routes.recall import router as recall_router
from scheduler import create_session_scheduler
from services.qdrant_service import initialize_qdrant_collection

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
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
