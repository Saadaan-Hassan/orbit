"""End-to-end regression coverage for Orbit's public-release privacy gates."""

import asyncio
import importlib
import os
import secrets
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

_CAPTURE_CATEGORY = {
    "clipboard": "clipboard",
    "window": "app_window",
    "app_lifecycle": "app_window",
    "system_state": "app_window",
    "url": "browser",
    "page_content": "browser",
    "search_query": "browser",
    "link_click": "browser",
    "file_activity": "file_activity",
    "screen_content": "screen_content",
}


class PrivacyRegressionSuite(unittest.TestCase):
    def _with_database(self, operation, prepare_database=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database_path = root / "orbit.db"
            if prepare_database is not None:
                prepare_database(database_path)

            with patch.dict(
                os.environ,
                {
                    "ORBIT_DB_PATH": str(database_path),
                    "QDRANT_STORAGE_PATH": str(root / "qdrant_storage"),
                },
                clear=False,
            ):
                import database
                import routes.capture as capture
                import routes.extension_pairing as extension_pairing
                import routes.privacy as privacy

                asyncio.run(database._async_engine.dispose())
                database = importlib.reload(database)
                capture = importlib.reload(capture)
                extension_pairing = importlib.reload(extension_pairing)
                privacy = importlib.reload(privacy)
                asyncio.run(database.create_all_tables())
                try:
                    result = asyncio.run(
                        operation(database, capture, privacy, extension_pairing)
                    )
                finally:
                    asyncio.run(database._async_engine.dispose())
            return result

    @staticmethod
    def _event(event_type: str, suffix: str):
        from models.event import CaptureEvent

        fields: dict[str, object] = {
            "id": f"privacy-{suffix}-{event_type}",
            "timestamp": 1_000_000 + len(suffix),
            "type": event_type,
            "source": "extension",
            "app_name": "Text Editor",
            "raw_content": "ordinary visible text",
        }
        if event_type in {"url", "page_content", "search_query", "link_click"}:
            fields["url"] = f"https://allowed-{suffix}.example.test/{event_type}"
        if event_type == "page_content":
            fields["page_text"] = "article text"
        if event_type == "file_activity":
            fields["file_path"] = f"/Users/privacy-test/Documents/{suffix}.txt"
        if event_type == "screen_content":
            fields["screen_text"] = "ordinary visible text"
        # model_validate (not CaptureEvent(**fields)) is the correct Pydantic
        # pattern for constructing from a loosely-typed dict — **fields makes
        # mypy try to match dict[str, object] against each specific field
        # type, which it can't do statically even though the values are fine.
        return CaptureEvent.model_validate(fields)

    @staticmethod
    def _reset_capture_cache(capture) -> None:
        capture._filter_cache = capture._CaptureFilterCache()

    def test_fresh_and_upgraded_installations_reject_capture_before_consent(self) -> None:
        async def assert_pre_consent(database, capture, privacy, extension_pairing):
            self._reset_capture_cache(capture)
            async with database._async_session_factory() as session:
                return await capture.capture_event(self._event("window", "pre-consent"), session)

        self.assertEqual(
            self._with_database(assert_pre_consent), {"status": "paused"}
        )

        def old_install(path: Path) -> None:
            # Simulate the pre-consent schema from an existing installation
            # that was capturing before capture_consent was introduced.
            connection = sqlite3.connect(path)
            try:
                connection.execute(
                    "CREATE TABLE capture_state (id INTEGER PRIMARY KEY, is_paused INTEGER, paused_until INTEGER)"
                )
                connection.execute("INSERT INTO capture_state VALUES (1, 0, NULL)")
                connection.commit()
            finally:
                connection.close()

        self.assertEqual(
            self._with_database(assert_pre_consent, old_install),
            {"status": "paused"},
        )

    def test_every_capture_category_obeys_consent_pause_and_exclusions(self) -> None:
        async def operation(database, capture, privacy, extension_pairing):
            await privacy.add_watched_folder(
                privacy.AddWatchedFolderRequest(folder="/Users/privacy-test/Documents")
            )
            results: dict[str, dict[str, str]] = {}

            for selected_choice in set(_CAPTURE_CATEGORY.values()):
                choices = {
                    "clipboard": False,
                    "app_window": False,
                    "browser": False,
                    "file_activity": False,
                    "screen_content": False,
                }
                choices[selected_choice] = True
                await privacy.save_capture_consent(
                    privacy.CaptureConsentRequest(**choices)
                )
                self._reset_capture_cache(capture)

                async with database._async_session_factory() as session:
                    for event_type, required_choice in _CAPTURE_CATEGORY.items():
                        response = await capture.capture_event(
                            self._event(event_type, selected_choice), session
                        )
                        results[f"{selected_choice}:{event_type}"] = response
                        expected_status = (
                            "ok" if required_choice == selected_choice else "consent_required"
                        )
                        if response["status"] != expected_status:
                            raise AssertionError(
                                f"{event_type} with {selected_choice}: "
                                f"expected {expected_status}, got {response}"
                            )

            await privacy.pause_capture(privacy.PauseRequest())
            self._reset_capture_cache(capture)
            async with database._async_session_factory() as session:
                paused = await capture.capture_event(self._event("screen_content", "paused"), session)

            await privacy.resume_capture()
            await privacy.save_capture_consent(
                privacy.CaptureConsentRequest(app_window=True, browser=True, file_activity=True)
            )
            await privacy.add_excluded_domain(
                privacy.AddExcludedDomainRequest(domain="private.example.test")
            )
            self._reset_capture_cache(capture)
            async with database._async_session_factory() as session:
                excluded_app = await capture.capture_event(
                    self._event("window", "excluded-app").model_copy(
                        update={"app_name": "Keychain Access"}
                    ),
                    session,
                )
                excluded_domain = await capture.capture_event(
                    self._event("url", "excluded-domain").model_copy(
                        update={"url": "https://team.private.example.test/"}
                    ),
                    session,
                )
                excluded_folder = await capture.capture_event(
                    self._event("file_activity", "excluded-folder").model_copy(
                        update={"file_path": "/Users/privacy-test/Documents-private/note.txt"}
                    ),
                    session,
                )
            return results, paused, excluded_app, excluded_domain, excluded_folder

        _, paused, excluded_app, excluded_domain, excluded_folder = self._with_database(operation)
        self.assertEqual(paused, {"status": "paused"})
        self.assertEqual(excluded_app, {"status": "excluded"})
        self.assertEqual(excluded_domain, {"status": "excluded"})
        self.assertEqual(excluded_folder, {"status": "excluded"})

    def test_missing_or_corrupt_capture_settings_fail_closed(self) -> None:
        async def missing_settings(database, capture, privacy, extension_pairing):
            async with database._async_engine.begin() as connection:
                await connection.execute(database.text("DELETE FROM capture_state"))
                await connection.execute(database.text("DELETE FROM capture_consent"))
            self._reset_capture_cache(capture)
            async with database._async_session_factory() as session:
                return await capture.capture_event(self._event("window", "missing"), session)

        self.assertEqual(
            self._with_database(missing_settings), {"status": "paused"}
        )

        async def corrupt_settings(database, capture, privacy, extension_pairing):
            await privacy.save_capture_consent(
                privacy.CaptureConsentRequest(file_activity=True)
            )
            async with database._async_engine.begin() as connection:
                await connection.execute(
                    database.text(
                        "UPDATE file_watch_settings SET watched_folders = 'not-json' WHERE id = 1"
                    )
                )
            self._reset_capture_cache(capture)
            async with database._async_session_factory() as session:
                return await capture.capture_event(self._event("file_activity", "corrupt"), session)

        with self.assertLogs("routes.capture", level="WARNING"):
            self.assertEqual(
                self._with_database(corrupt_settings), {"status": "paused"}
            )

    def test_wipe_removes_sqlite_fts_pairings_and_qdrant_vectors(self) -> None:
        async def operation(database, capture, privacy, extension_pairing):
            async with database._async_engine.begin() as connection:
                await connection.execute(
                    database.text(
                        """
                        INSERT INTO events (id, timestamp, type, raw_content, source)
                        VALUES ('wipe-event', 1, 'window', 'searchable private activity', 'test')
                        """
                    )
                )
                await connection.execute(
                    database.text(
                        "INSERT INTO sessions (id, start_time, end_time) VALUES ('wipe-session', 1, 2)"
                    )
                )
                await connection.execute(
                    database.text(
                        "INSERT INTO memory_objects (id, summary) VALUES ('wipe-memory', 'private summary')"
                    )
                )
                await connection.execute(
                    database.text(
                        """
                        INSERT INTO paired_extensions (extension_id, token_hash, created_at, revoked_at)
                        VALUES (:id, 'non-secret-test-hash', 1, NULL)
                        """
                    ),
                    {"id": "a" * 32},
                )

            self.assertTrue(await database.search_events_fts("searchable"))
            with patch(
                "routes.privacy.wipe_all_session_embeddings", new=AsyncMock()
            ) as wipe_vectors:
                result = await privacy.wipe_all_data()
            wipe_vectors.assert_awaited_once()

            async with database._async_engine.connect() as connection:
                counts = await connection.execute(
                    database.text(
                        """
                        SELECT
                            (SELECT COUNT(*) FROM events),
                            (SELECT COUNT(*) FROM events_fts),
                            (SELECT COUNT(*) FROM sessions),
                            (SELECT COUNT(*) FROM memory_objects),
                            (SELECT COUNT(*) FROM paired_extensions)
                        """
                    )
                )
                secure_delete = await connection.execute(database.text("PRAGMA secure_delete"))
            return (
                result,
                counts.fetchone(),
                secure_delete.fetchone()[0],
                await database.search_events_fts("searchable"),
            )

        result, counts, secure_delete, search_results = self._with_database(operation)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(tuple(counts), (0, 0, 0, 0, 0))
        self.assertEqual(secure_delete, 1)
        self.assertEqual(search_results, [])

    def test_extension_pairing_is_capture_only_and_revocable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database_path = root / "orbit.db"
            with patch.dict(
                os.environ,
                {
                    "ORBIT_DB_PATH": str(database_path),
                    "QDRANT_STORAGE_PATH": str(root / "qdrant_storage"),
                },
                clear=False,
            ):
                import database
                import local_api_security
                import routes.capture as capture
                import routes.extension_pairing as extension_pairing

                asyncio.run(database._async_engine.dispose())
                database = importlib.reload(database)
                local_api_security = importlib.reload(local_api_security)
                capture = importlib.reload(capture)
                extension_pairing = importlib.reload(extension_pairing)
                asyncio.run(database.create_all_tables())

                desktop_token = secrets.token_urlsafe(32)
                extension_origin = f"chrome-extension://{'a' * 32}"
                app = FastAPI()
                app.add_middleware(
                    local_api_security.LocalApiSecurityMiddleware,
                    config=local_api_security.LocalApiSecurityConfig(session_token=desktop_token),
                )
                app.include_router(extension_pairing.router)
                app.include_router(capture.router)

                @app.get("/sensitive")
                async def sensitive_route() -> dict[str, bool]:
                    return {"ok": True}

                with TestClient(app, base_url="http://127.0.0.1:47821") as client:
                    desktop_headers = {"Authorization": f"Bearer {desktop_token}"}
                    code_response = client.post("/extension/pairing-code", headers=desktop_headers)
                    self.assertEqual(code_response.status_code, 200)
                    pair_response = client.post(
                        "/extension/pair",
                        headers={"Origin": extension_origin},
                        json={"code": code_response.json()["code"]},
                    )
                    self.assertEqual(pair_response.status_code, 200)
                    extension_headers = {
                        "Authorization": f"Bearer {pair_response.json()['token']}",
                        "Origin": extension_origin,
                    }
                    capture_response = client.post(
                        "/capture",
                        headers=extension_headers,
                        json={
                            "id": "paired-capture",
                            "timestamp": 1,
                            "type": "url",
                            "source": "extension",
                            "url": "https://allowed.example.test/",
                        },
                    )
                    self.assertEqual(capture_response.status_code, 200)
                    self.assertEqual(capture_response.json()["status"], "paused")
                    self.assertEqual(
                        client.get("/sensitive", headers=extension_headers).status_code,
                        401,
                    )
                    self.assertEqual(
                        client.delete("/extension/pairing", headers=desktop_headers).status_code,
                        200,
                    )
                    self.assertEqual(
                        client.post(
                            "/capture",
                            headers=extension_headers,
                            json={
                                "id": "revoked-capture",
                                "timestamp": 2,
                                "type": "url",
                                "source": "extension",
                                "url": "https://allowed.example.test/",
                            },
                        ).status_code,
                        403,
                    )
                asyncio.run(database._async_engine.dispose())
