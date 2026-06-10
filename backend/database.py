import os
import re
import uuid
from datetime import datetime, timezone
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
                source      TEXT NOT NULL,
                session_id  TEXT,
                category    TEXT
            )
        """))
        # FTS5 virtual table mirrors the three text columns users are most
        # likely to search. content='events' tells FTS5 to read from the
        # events table for snippet/highlight queries rather than duplicating
        # the data; content_rowid links it back to the events primary key.
        # porter tokenizer enables stemming so "debugging" matches "debug".
        await connection.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
            USING fts5(
                raw_content,
                app_name,
                url,
                content='events',
                content_rowid='rowid',
                tokenize='porter unicode61'
            )
        """))

        # Keep the FTS index in sync with events automatically so callers
        # never need to manage the index manually.
        await connection.execute(text("""
            CREATE TRIGGER IF NOT EXISTS events_fts_insert
            AFTER INSERT ON events BEGIN
                INSERT INTO events_fts(rowid, raw_content, app_name, url)
                VALUES (new.rowid, new.raw_content, new.app_name, new.url);
            END
        """))
        await connection.execute(text("""
            CREATE TRIGGER IF NOT EXISTS events_fts_update
            AFTER UPDATE ON events BEGIN
                UPDATE events_fts
                SET raw_content = new.raw_content,
                    app_name    = new.app_name,
                    url         = new.url
                WHERE rowid = old.rowid;
            END
        """))
        await connection.execute(text("""
            CREATE TRIGGER IF NOT EXISTS events_fts_delete
            AFTER DELETE ON events BEGIN
                DELETE FROM events_fts WHERE rowid = old.rowid;
            END
        """))

        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS sessions (
                id            TEXT PRIMARY KEY,
                start_time    INTEGER NOT NULL,
                end_time      INTEGER NOT NULL,
                project_name  TEXT,
                goal          TEXT,
                ai_summary    TEXT,
                last_action   TEXT,
                key_resources TEXT,
                embedding_id  TEXT
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

        # Stores thumbs-up / thumbs-down ratings submitted via the UI after
        # a recall response. Used to surface quality signals over time.
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS feedback (
                id        TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL,
                rating    TEXT NOT NULL,
                comment   TEXT,
                context   TEXT
            )
        """))

        # Apps whose window events are silently dropped at capture time.
        # Seeded with a default list of password managers and system
        # credential stores on first run (when the table is empty).
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS excluded_apps (
                id        TEXT PRIMARY KEY,
                app_name  TEXT NOT NULL UNIQUE,
                added_at  INTEGER NOT NULL
            )
        """))

        # Single-row table (id=1 always) that tracks whether the user has
        # temporarily paused all activity capture.
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS capture_state (
                id            INTEGER PRIMARY KEY DEFAULT 1,
                is_paused     INTEGER NOT NULL DEFAULT 0,
                paused_until  INTEGER
            )
        """))

        # Ensure the single capture_state row exists so UPDATE queries
        # in the privacy routes never silently affect zero rows.
        await connection.execute(text("""
            INSERT OR IGNORE INTO capture_state (id, is_paused, paused_until)
            VALUES (1, 0, NULL)
        """))

    # Seed the default excluded apps outside the schema transaction so the
    # INSERT OR IGNORE check works against a fully committed table state.
    await _seed_default_excluded_apps()


_DEFAULT_EXCLUDED_APPS: list[str] = [
    "1Password",
    "Bitwarden",
    "Keychain Access",
    "LastPass",
    "Dashlane",
    "Safari",
    "System Preferences",
    "System Settings",
]


async def _seed_default_excluded_apps() -> None:
    # Only seeds when the table is completely empty — i.e. first run.
    # On subsequent starts the user's own exclusion list is left untouched.
    async with _async_engine.begin() as connection:
        result = await connection.execute(
            text("SELECT COUNT(*) AS total FROM excluded_apps")
        )
        row = result.fetchone()
        if row is not None and row.total > 0:
            return  # Already seeded — nothing to do.

        added_at_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        for app_name in _DEFAULT_EXCLUDED_APPS:
            await connection.execute(
                text(
                    """
                    INSERT OR IGNORE INTO excluded_apps (id, app_name, added_at)
                    VALUES (:id, :app_name, :added_at)
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "app_name": app_name,
                    "added_at": added_at_ms,
                },
            )


def _sanitize_fts5_query(raw_query: str) -> str:
    # FTS5 treats these characters as syntax operators. Stripping them prevents
    # user input from accidentally forming broken or malicious FTS5 expressions.
    # We keep alphanumerics, spaces, hyphens, and apostrophes (needed for
    # contractions like "don't") and discard everything else.
    sanitized = re.sub(r'[^\w\s\-\']', ' ', raw_query)
    # Collapse runs of whitespace so the FTS5 parser sees clean token gaps.
    return re.sub(r'\s+', ' ', sanitized).strip()


async def search_events_fts(
    query: str,
    limit: int = 20,
    start_ms: int | None = None,
    end_ms: int | None = None,
) -> list[dict]:
    sanitized_query = _sanitize_fts5_query(query)
    if not sanitized_query:
        return []

    # Build optional timestamp bounds. These are appended as plain AND clauses
    # rather than using SQLAlchemy helpers because the FTS5 MATCH expression
    # must remain in the same WHERE clause — splitting it breaks the query.
    # The clause strings are constructed from internal values only, not user
    # input, so there is no injection risk.
    time_clauses = ""
    time_params: dict = {}
    if start_ms is not None:
        time_clauses += " AND e.timestamp >= :start_ms"
        time_params["start_ms"] = start_ms
    if end_ms is not None:
        time_clauses += " AND e.timestamp <= :end_ms"
        time_params["end_ms"] = end_ms

    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text(
                f"""
                SELECT e.id,
                       e.timestamp,
                       e.type,
                       e.raw_content,
                       e.app_name,
                       e.url,
                       e.source
                FROM   events e
                JOIN   events_fts fts ON e.rowid = fts.rowid
                WHERE  events_fts MATCH :query
                {time_clauses}
                ORDER  BY rank
                LIMIT  :limit
                """
            ),
            {"query": sanitized_query, "limit": limit, **time_params},
        )
        rows = result.fetchall()

    return [dict(row._mapping) for row in rows]


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with _async_session_factory() as session:
        yield session
