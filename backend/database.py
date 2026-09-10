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


async def _migrate_schema() -> None:
    """
    Idempotent schema migrations for existing databases.

    Runs before the main CREATE block so that:
    - Columns added to events via ALTER TABLE are present before any INSERT.
    - The FTS5 virtual table is dropped and recreated when its column set
      changes, because SQLite FTS5 does not support ALTER TABLE ADD COLUMN.
      The table is content-backed (content='events'), so dropping it loses no
      event data — only the search index, which is rebuilt automatically on the
      next INSERT/UPDATE via the triggers recreated here.
    """
    async with _async_engine.begin() as connection:
        # Belt-and-suspenders: add any columns that were missing from the
        # initial 7-column Rust DDL in main.rs (Phase 1–2.9 additions).
        # Each ALTER TABLE is wrapped individually so a pre-existing column
        # is a silent no-op rather than aborting the whole migration block.
        for _column_ddl in [
            "ALTER TABLE events ADD COLUMN session_id TEXT",
            "ALTER TABLE events ADD COLUMN category TEXT",
            "ALTER TABLE events ADD COLUMN page_text TEXT",
            "ALTER TABLE events ADD COLUMN link_target TEXT",
            "ALTER TABLE events ADD COLUMN metadata TEXT",
            "ALTER TABLE events ADD COLUMN file_path TEXT",
            "ALTER TABLE events ADD COLUMN is_user_active INTEGER",
            "ALTER TABLE events ADD COLUMN screen_text TEXT",
        ]:
            try:
                await connection.execute(text(_column_ddl))
            except Exception:
                pass  # Column already present — ALTER TABLE fails on duplicates.

        # Rebuild FTS5 if screen_text is not yet in the index.
        # PRAGMA table_info returns one row per column; we collect the names.
        fts_info = await connection.execute(text("PRAGMA table_info(events_fts)"))
        fts_columns = {row[1] for row in fts_info.fetchall()}
        if "screen_text" not in fts_columns:
            # Drop triggers first — they reference the FTS table structure.
            await connection.execute(
                text("DROP TRIGGER IF EXISTS events_fts_insert")
            )
            await connection.execute(
                text("DROP TRIGGER IF EXISTS events_fts_update")
            )
            await connection.execute(
                text("DROP TRIGGER IF EXISTS events_fts_delete")
            )
            await connection.execute(text("DROP TABLE IF EXISTS events_fts"))
            # The CREATE VIRTUAL TABLE and trigger statements in create_all_tables()
            # below will now recreate the FTS index with the full column set.


async def create_all_tables() -> None:
    # Apply any pending schema migrations before the main CREATE block so that
    # existing databases are brought up to date before new tables are created.
    await _migrate_schema()

    async with _async_engine.begin() as connection:
        # WAL mode allows concurrent readers during writes and eliminates the
        # exclusive-lock contention between the 7 Rust capture tasks and FastAPI.
        # synchronous=NORMAL is safe under WAL (fsync on checkpoint, not every
        # write). cache_size and temp_store reduce disk I/O on long sessions.
        await connection.execute(text("PRAGMA journal_mode = WAL"))
        await connection.execute(text("PRAGMA synchronous = NORMAL"))
        await connection.execute(text("PRAGMA cache_size = -64000"))
        await connection.execute(text("PRAGMA temp_store = MEMORY"))

        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS events (
                id             TEXT PRIMARY KEY,
                timestamp      INTEGER NOT NULL,
                type           TEXT NOT NULL,
                raw_content    TEXT,
                app_name       TEXT,
                url            TEXT,
                source         TEXT NOT NULL,
                session_id     TEXT,
                category       TEXT,
                page_text      TEXT,
                link_target    TEXT,
                metadata       TEXT,
                file_path      TEXT,
                is_user_active INTEGER,
                screen_text    TEXT
            )
        """))
        # FTS5 virtual table mirrors the key text columns. page_text and
        # screen_text are included so browser article body and on-screen
        # accessibility text are keyword-searchable alongside titles and URLs.
        # content='events' avoids duplicating data; the porter tokenizer enables
        # stemming so "debugging" matches "debug".
        await connection.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
            USING fts5(
                raw_content,
                app_name,
                url,
                page_text,
                screen_text,
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
                INSERT INTO events_fts(rowid, raw_content, app_name, url, page_text, screen_text)
                VALUES (new.rowid, new.raw_content, new.app_name, new.url, new.page_text, new.screen_text);
            END
        """))
        await connection.execute(text("""
            CREATE TRIGGER IF NOT EXISTS events_fts_update
            AFTER UPDATE ON events BEGIN
                UPDATE events_fts
                SET raw_content = new.raw_content,
                    app_name    = new.app_name,
                    url         = new.url,
                    page_text   = new.page_text,
                    screen_text = new.screen_text
                WHERE rowid = old.rowid;
            END
        """))
        await connection.execute(text("""
            CREATE TRIGGER IF NOT EXISTS events_fts_delete
            AFTER DELETE ON events BEGIN
                DELETE FROM events_fts WHERE rowid = old.rowid;
            END
        """))

        # Supports the capture-time URL dedup check (url + 10-second window
        # query) and URL-filtered recall queries.
        await connection.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_events_url_timestamp
            ON events(url, timestamp)
        """))

        # The scheduler's primary query filters on timestamp and session_id;
        # recall filters on type. Without these, every 30-minute scheduler run
        # and every recall query performs a full table scan.
        await connection.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_events_timestamp
            ON events(timestamp)
        """))
        await connection.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_events_session_id
            ON events(session_id)
        """))
        await connection.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_events_type_timestamp
            ON events(type, timestamp)
        """))

        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS sessions (
                id            TEXT PRIMARY KEY,
                start_time    INTEGER NOT NULL,
                end_time      INTEGER NOT NULL,
                project_name  TEXT,
                goal          TEXT,
                ai_summary    TEXT,
                activity      TEXT,
                next_step     TEXT,
                blockers      TEXT,
                last_action   TEXT,
                key_resources  TEXT,
                topics         TEXT,
                active_minutes INTEGER,
                category       TEXT,
                embedding_id   TEXT
            )
        """))

        # GET /memory/sessions and the scheduler's session-lookup queries both
        # ORDER BY start_time DESC. Without this index SQLite sorts the full table.
        await connection.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_sessions_start_time
            ON sessions(start_time)
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

        # Browser domains whose page_content / link_click / url events are
        # silently dropped at capture time. Checked by the extension capture
        # path in routes/capture.py via a 30-second in-memory cache.
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS excluded_domains (
                id       TEXT PRIMARY KEY,
                domain   TEXT NOT NULL UNIQUE,
                added_at INTEGER NOT NULL
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

        # Consent is versioned so a future material expansion of capture can
        # require an explicit review. All categories are opt-in by default.
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS capture_consent (
                id               INTEGER PRIMARY KEY CHECK (id = 1),
                consent_version  INTEGER NOT NULL,
                accepted_at      INTEGER,
                clipboard        INTEGER NOT NULL DEFAULT 0,
                app_window       INTEGER NOT NULL DEFAULT 0,
                browser          INTEGER NOT NULL DEFAULT 0,
                file_activity    INTEGER NOT NULL DEFAULT 0,
                screen_content   INTEGER NOT NULL DEFAULT 0
            )
        """))

        # Exact-match phrases the user wants redacted from every Rust-captured
        # field. They are deliberately not arbitrary regular expressions: that
        # keeps matching predictable and prevents user configuration from
        # adding an expensive pattern to capture's hot path.
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS redaction_patterns (
                id         TEXT PRIMARY KEY,
                pattern    TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL
            )
        """))

        # Browser-extension credentials are stored only as SHA-256 hashes. A
        # row is scoped to one Chrome extension ID and may be revoked locally.
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS paired_extensions (
                extension_id TEXT PRIMARY KEY,
                token_hash   TEXT NOT NULL,
                created_at   INTEGER NOT NULL,
                revoked_at   INTEGER
            )
        """))

        # Ensure the single capture_state row exists so UPDATE queries
        # in the privacy routes never silently affect zero rows.
        await connection.execute(text("""
            INSERT OR IGNORE INTO capture_state (id, is_paused, paused_until)
            VALUES (1, 1, NULL)
        """))

        # Existing installations have no consent row. Insert one with all
        # sources disabled and pause capture pending a deliberate review.
        await connection.execute(text("""
            INSERT OR IGNORE INTO capture_consent
                (id, consent_version, accepted_at, clipboard, app_window, browser, file_activity, screen_content)
            VALUES (1, 1, NULL, 0, 0, 0, 0, 0)
        """))
        consent_result = await connection.execute(
            text("SELECT accepted_at FROM capture_consent WHERE id = 1")
        )
        if consent_result.fetchone().accepted_at is None:
            await connection.execute(text("UPDATE capture_state SET is_paused = 1, paused_until = NULL WHERE id = 1"))

        # Single-row table (id=1 always) that controls whether file activity
        # is captured and which folders are watched. watched_folders stores a
        # JSON array of absolute folder paths.
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS file_watch_settings (
                id              INTEGER PRIMARY KEY DEFAULT 1,
            enabled         INTEGER NOT NULL DEFAULT 0,
                watched_folders TEXT    NOT NULL DEFAULT '[]'
            )
        """))

        # Ensure the single file_watch_settings row exists.
        await connection.execute(text("""
            INSERT OR IGNORE INTO file_watch_settings (id, enabled, watched_folders)
            VALUES (1, 1, '[]')
        """))

        # Single-row table (id=1 always) that controls whether native browser
        # URL capture (via osascript — no extension required) is active.
        # Users can turn this off independently from the Chrome extension.
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS browser_capture_settings (
                id             INTEGER PRIMARY KEY DEFAULT 1,
            native_enabled INTEGER NOT NULL DEFAULT 0
            )
        """))

        # Ensure the single browser_capture_settings row exists.
        await connection.execute(text("""
            INSERT OR IGNORE INTO browser_capture_settings (id, native_enabled)
            VALUES (1, 1)
        """))

        # Single-row table (id=1 always) that controls whether on-screen text
        # is captured via the macOS Accessibility API (AXUIElement).
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS screen_content_settings (
                id      INTEGER PRIMARY KEY DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 0
            )
        """))

        # Ensure the single screen_content_settings row exists.
        await connection.execute(text("""
            INSERT OR IGNORE INTO screen_content_settings (id, enabled)
            VALUES (1, 1)
        """))

        # Generic key/value store for user-configurable settings (e.g. BYOK keys).
        await connection.execute(text("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            )
        """))

        # Pre-create known setting rows so reads never need to INSERT.
        await connection.execute(text("""
            INSERT OR IGNORE INTO app_settings (key, value)
            VALUES ('groq_api_key', '')
        """))

    # Seed default lists outside the schema transaction so INSERT OR IGNORE
    # checks work against a fully committed table state.
    await _seed_default_excluded_apps()
    await _seed_default_excluded_domains()
    await _seed_default_file_watch_settings()


_DEFAULT_EXCLUDED_APPS: list[str] = [
    "Orbit",              # suppress screen_content noise from Orbit's own UI
    "1Password",
    "Bitwarden",
    "Keychain Access",
    "LastPass",
    "Dashlane",
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


# Login and webmail pages are good default examples — they contain personal
# credentials / private communication and users almost never want them in memory.
# Kept minimal so users' own lists aren't drowned out at first glance.
_DEFAULT_EXCLUDED_DOMAINS: list[str] = [
    "mail.google.com",
    "accounts.google.com",
]


async def _seed_default_excluded_domains() -> None:
    # Only seeds when the table is completely empty — i.e. first run.
    async with _async_engine.begin() as connection:
        result = await connection.execute(
            text("SELECT COUNT(*) AS total FROM excluded_domains")
        )
        row = result.fetchone()
        if row is not None and row.total > 0:
            return  # Already seeded — nothing to do.

        added_at_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        for domain in _DEFAULT_EXCLUDED_DOMAINS:
            await connection.execute(
                text(
                    """
                    INSERT OR IGNORE INTO excluded_domains (id, domain, added_at)
                    VALUES (:id, :domain, :added_at)
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "domain": domain,
                    "added_at": added_at_ms,
                },
            )


async def _seed_default_file_watch_settings() -> None:
    # Only seeds when watched_folders is the empty-array placeholder left by
    # the INSERT OR IGNORE above — i.e. on first run. On subsequent starts
    # the user's own folder list is left untouched.
    import json as _json

    home = os.path.expanduser("~")
    default_folders = _json.dumps([
        f"{home}/Documents",
        f"{home}/Desktop",
        f"{home}/Downloads",
    ])
    async with _async_engine.begin() as connection:
        result = await connection.execute(
            text("SELECT watched_folders FROM file_watch_settings WHERE id = 1")
        )
        row = result.fetchone()
        if row is not None and row.watched_folders not in ("[]", "", None):
            return  # Already seeded — user's list takes precedence.
        await connection.execute(
            text(
                "UPDATE file_watch_settings SET watched_folders = :folders WHERE id = 1"
            ),
            {"folders": default_folders},
        )


def _sanitize_fts5_query(raw_query: str) -> str:
    # FTS5 treats these characters as syntax operators. Stripping them prevents
    # user input from accidentally forming broken or malicious FTS5 expressions.
    # We keep alphanumerics, spaces, hyphens, and apostrophes (needed for
    # contractions like "don't") and discard everything else.
    sanitized = re.sub(r'[^\w\s\-\']', ' ', raw_query)
    # Collapse runs of whitespace so the FTS5 parser sees clean token gaps.
    collapsed = re.sub(r'\s+', ' ', sanitized).strip()
    
    # Split by whitespace, wrap each token containing alphanumeric characters
    # in double quotes to prevent FTS5 parser operator interpretation errors (e.g. hyphens).
    tokens = collapsed.split(' ')
    quoted_tokens = []
    for token in tokens:
        if any(c.isalnum() for c in token):
            quoted_tokens.append(f'"{token}"')
            
    return ' '.join(quoted_tokens)


async def search_events_fts(
    query: str,
    limit: int = 20,
    start_ms: int | None = None,
    end_ms: int | None = None,
    exclude_personal: bool = True,
) -> list[dict]:
    sanitized_query = _sanitize_fts5_query(query)
    if not sanitized_query:
        return []

    # Build optional filter clauses. These are appended as plain AND clauses
    # rather than using SQLAlchemy helpers because the FTS5 MATCH expression
    # must remain in the same WHERE clause — splitting it breaks the query.
    # The clause strings are constructed from internal values only, not user
    # input, so there is no injection risk.
    extra_clauses = ""
    extra_params: dict = {}

    if start_ms is not None:
        extra_clauses += " AND e.timestamp >= :start_ms"
        extra_params["start_ms"] = start_ms
    if end_ms is not None:
        extra_clauses += " AND e.timestamp <= :end_ms"
        extra_params["end_ms"] = end_ms
    if exclude_personal:
        # NULL category means the event has not been classified yet — include
        # it rather than silently hiding unprocessed events from recall.
        extra_clauses += " AND (e.category IS NULL OR e.category != 'personal')"

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
                       e.source,
                       e.page_text,
                       e.link_target,
                       e.metadata,
                       e.file_path,
                       e.screen_text
                FROM   events e
                JOIN   events_fts fts ON e.rowid = fts.rowid
                WHERE  events_fts MATCH :query
                {extra_clauses}
                ORDER  BY rank
                LIMIT  :limit
                """
            ),
            {"query": sanitized_query, "limit": limit, **extra_params},
        )
        rows = result.fetchall()

    return [dict(row._mapping) for row in rows]


async def fetch_system_state_events(
    limit: int = 20,
    start_ms: int | None = None,
    end_ms: int | None = None,
) -> list[dict]:
    """
    Returns system_state events (lock/unlock/sleep/wake) sorted ascending by
    time. Used by recall to surface break times when the query asks about
    activity duration or when the user stepped away.
    """
    extra_clauses = ""
    extra_params: dict = {}
    if start_ms is not None:
        extra_clauses += " AND timestamp >= :start_ms"
        extra_params["start_ms"] = start_ms
    if end_ms is not None:
        extra_clauses += " AND timestamp <= :end_ms"
        extra_params["end_ms"] = end_ms

    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text(
                f"""
                SELECT id, timestamp, type, raw_content, metadata
                FROM   events
                WHERE  type = 'system_state'
                {extra_clauses}
                ORDER  BY timestamp ASC
                LIMIT  :limit
                """
            ),
            {"limit": limit, **extra_params},
        )
        return [dict(row._mapping) for row in result.fetchall()]


async def fetch_sessions_by_time_range(
    start_ms: int,
    end_ms: int,
    max_per_project: int = 1,
) -> list[dict]:
    """
    Returns the best session per distinct project_name within a time window.

    Used by recall when a time-range query ("yesterday", "today") is detected.
    Qdrant semantic search only returns sessions similar to the query text, so
    a "what did I work on yesterday?" query can miss projects that don't match
    semantically. This query supplements Qdrant with a direct DB scan, ensuring
    every project worked on during the window appears at least once.

    Sessions with no project_name are included under an empty-string key and
    limited to max_per_project entries. Sessions are ordered by active_minutes
    DESC then duration DESC so the most substantive session per project wins.
    """
    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text(
                """
                SELECT
                    id, start_time, end_time, project_name, goal, activity,
                    ai_summary, last_action, next_step, blockers, topics,
                    key_resources, active_minutes, embedding_id
                FROM sessions
                WHERE start_time >= :start_ms
                  AND end_time   <= :end_ms
                ORDER BY
                    COALESCE(project_name, '') ASC,
                    active_minutes DESC,
                    (end_time - start_time) DESC
                """
            ),
            {"start_ms": start_ms, "end_ms": end_ms},
        )
        rows = [dict(row._mapping) for row in result.fetchall()]

    # Keep up to max_per_project sessions per project_name.
    counts: dict[str, int] = {}
    selected: list[dict] = []
    for row in rows:
        key = (row.get("project_name") or "").strip().lower()
        counts[key] = counts.get(key, 0) + 1
        if counts[key] <= max_per_project:
            selected.append(row)
    return selected


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with _async_session_factory() as session:
        yield session


async def get_setting(key: str) -> str | None:
    async with _async_engine.connect() as connection:
        result = await connection.execute(
            text("SELECT value FROM app_settings WHERE key = :key"),
            {"key": key},
        )
        row = result.fetchone()
        if row is None:
            return None
        value = row[0]
        return value if value else None


async def set_setting(key: str, value: str) -> None:
    async with _async_engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT OR REPLACE INTO app_settings (key, value) "
                "VALUES (:key, :value)"
            ),
            {"key": key, "value": value},
        )


async def get_groq_key_enabled() -> bool:
    """Defaults to enabled (True) unless the user has explicitly disabled it —
    keeps existing configured keys active without requiring a migration."""
    value = await get_setting("groq_key_enabled")
    return value != "0"


async def set_groq_key_enabled(enabled: bool) -> None:
    await set_setting("groq_key_enabled", "1" if enabled else "0")


async def get_groq_api_key() -> str | None:
    """Returns None when disabled, even if a key is stored — every caller
    already treats "no key" as "fall back to the default provider", so a
    disabled key needs no extra plumbing at the call sites."""
    if not await get_groq_key_enabled():
        return None
    return await get_setting("groq_api_key")
