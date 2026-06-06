import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text
from typing import AsyncGenerator

load_dotenv()

_database_path = os.getenv("ORBIT_DB_PATH", "orbit.db")
_database_url = f"sqlite+aiosqlite:///{_database_path}"

_async_engine = create_async_engine(_database_url, echo=False)
_async_session_factory = async_sessionmaker(_async_engine, expire_on_commit=False)


async def create_all_tables() -> None:
    async with _async_engine.begin() as connection:
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS events (
                id          TEXT PRIMARY KEY,
                timestamp   INTEGER NOT NULL,
                type        TEXT NOT NULL,
                raw_content TEXT,
                app_name    TEXT,
                url         TEXT,
                source      TEXT NOT NULL
            )
        """))
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS sessions (
                id           TEXT PRIMARY KEY,
                start_time   INTEGER NOT NULL,
                end_time     INTEGER NOT NULL,
                project_name TEXT,
                goal         TEXT,
                ai_summary   TEXT,
                embedding_id TEXT
            )
        """))
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS memory_objects (
                id           TEXT PRIMARY KEY,
                session_id   TEXT REFERENCES sessions(id),
                project      TEXT,
                topic        TEXT,
                summary      TEXT NOT NULL,
                status       TEXT,
                key_files    TEXT,
                embedding_id TEXT
            )
        """))


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with _async_session_factory() as session:
        yield session
