"""Regression tests for the explicit capture-consent review actions."""

import asyncio
import importlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


async def _read_capture_state(database_module):
    async with database_module._async_engine.connect() as connection:
        consent_result = await connection.execute(
            database_module.text(
                """
                SELECT accepted_at, clipboard, app_window, browser, file_activity, screen_content
                FROM capture_consent WHERE id = 1
                """
            )
        )
        consent = consent_result.fetchone()
        pause_result = await connection.execute(
            database_module.text("SELECT is_paused, paused_until FROM capture_state WHERE id = 1")
        )
        pause = pause_result.fetchone()
    return consent, pause


class CaptureConsentApiTests(unittest.TestCase):
    def _with_database(self, operation):
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "orbit.db"
            with patch.dict(os.environ, {"ORBIT_DB_PATH": str(database_path)}, clear=False):
                import database
                import routes.capture as capture
                import routes.privacy as privacy

                asyncio.run(database._async_engine.dispose())
                database = importlib.reload(database)
                capture = importlib.reload(capture)
                privacy = importlib.reload(privacy)
                asyncio.run(database.create_all_tables())
                result = asyncio.run(operation(database, privacy, capture))
                asyncio.run(database._async_engine.dispose())
            return result

    def test_each_explicit_choice_is_saved_independently(self):
        async def operation(database, privacy, capture):
            await privacy.save_capture_consent(
                privacy.CaptureConsentRequest(
                    clipboard=True,
                    app_window=False,
                    browser=True,
                    file_activity=False,
                    screen_content=False,
                )
            )
            return await _read_capture_state(database)

        consent, pause = self._with_database(operation)
        self.assertIsNotNone(consent.accepted_at)
        self.assertEqual(tuple(consent[1:]), (1, 0, 1, 0, 0))
        self.assertEqual((pause.is_paused, pause.paused_until), (0, None))

    def test_skip_revokes_every_source_and_pauses_capture(self):
        async def operation(database, privacy, capture):
            await privacy.save_capture_consent(
                privacy.CaptureConsentRequest(
                    clipboard=True,
                    app_window=True,
                    browser=True,
                    file_activity=True,
                    screen_content=True,
                )
            )
            await privacy.skip_capture_consent()
            return await _read_capture_state(database)

        consent, pause = self._with_database(operation)
        self.assertIsNone(consent.accepted_at)
        self.assertEqual(tuple(consent[1:]), (0, 0, 0, 0, 0))
        self.assertEqual((pause.is_paused, pause.paused_until), (1, None))

    def test_extension_browser_events_require_browser_consent(self):
        async def operation(database, privacy, capture):
            # Accepting app/window activity must not implicitly permit the
            # paired browser extension to submit URLs or page content.
            await privacy.save_capture_consent(
                privacy.CaptureConsentRequest(
                    clipboard=False,
                    app_window=True,
                    browser=False,
                    file_activity=False,
                    screen_content=False,
                )
            )
            await capture._refresh_cache_if_stale()
            return {
                "window": capture._capture_category_is_allowed("window"),
                "browser_url": capture._capture_category_is_allowed("url"),
                "browser_page": capture._capture_category_is_allowed("page_content"),
                "unknown": capture._capture_category_is_allowed("future_event"),
            }

        allowed = self._with_database(operation)
        self.assertTrue(allowed["window"])
        self.assertFalse(allowed["browser_url"])
        self.assertFalse(allowed["browser_page"])
        self.assertFalse(allowed["unknown"])
