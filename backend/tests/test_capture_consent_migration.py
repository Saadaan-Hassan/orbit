"""Database-level regression tests for the versioned, fail-closed consent model."""

import asyncio
import importlib
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


async def _read_consent(database_module):
    async with database_module._async_engine.connect() as connection:
        result = await connection.execute(
            database_module.text(
                "SELECT accepted_at, clipboard, app_window, browser, file_activity, "
                "screen_content FROM capture_consent WHERE id = 1"
            )
        )
        consent = result.fetchone()
        result = await connection.execute(database_module.text("SELECT is_paused FROM capture_state WHERE id = 1"))
        pause = result.fetchone()
        result = await connection.execute(database_module.text("SELECT COUNT(*) FROM redaction_patterns"))
        redaction_pattern_count = result.fetchone()[0]
    return consent, pause, redaction_pattern_count


class CaptureConsentMigrationTests(unittest.TestCase):
    def _with_database(self, prepare=None):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "orbit.db"
            if prepare:
                prepare(path)
            with patch.dict(os.environ, {"ORBIT_DB_PATH": str(path)}, clear=False):
                import database
                asyncio.run(database._async_engine.dispose())
                database = importlib.reload(database)
                asyncio.run(database.create_all_tables())
                consent, pause, redaction_pattern_count = asyncio.run(_read_consent(database))
                asyncio.run(database._async_engine.dispose())
            return consent, pause, redaction_pattern_count

    def test_fresh_database_is_unaccepted_and_paused(self):
        consent, pause, redaction_pattern_count = self._with_database()
        self.assertIsNone(consent.accepted_at)
        self.assertEqual(tuple(consent[1:]), (0, 0, 0, 0, 0))
        self.assertEqual(pause.is_paused, 1)
        self.assertEqual(redaction_pattern_count, 0)

    def test_existing_database_is_paused_pending_reconsent(self):
        def prepare(path: Path) -> None:
            connection = sqlite3.connect(path)
            try:
                connection.execute(
                    "CREATE TABLE capture_state "
                    "(id INTEGER PRIMARY KEY, is_paused INTEGER, paused_until INTEGER)"
                )
                connection.execute("INSERT INTO capture_state VALUES (1, 0, NULL)")
                connection.commit()
            finally:
                connection.close()

        consent, pause, redaction_pattern_count = self._with_database(prepare)
        self.assertIsNone(consent.accepted_at)
        self.assertEqual(tuple(consent[1:]), (0, 0, 0, 0, 0))
        self.assertEqual(pause.is_paused, 1)
        self.assertEqual(redaction_pattern_count, 0)
