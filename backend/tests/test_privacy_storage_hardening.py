"""Regression tests for canonical exclusions and local credential/storage safety."""

import asyncio
import importlib
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from services.exclusion_policy import (
    domain_is_excluded,
    normalize_app_name,
    normalize_domain,
    normalize_folder_path,
    path_is_within_watched_folder,
)
from services.local_storage_security import repair_orbit_storage


class ExclusionPolicyTests(unittest.TestCase):
    def test_domain_normalization_includes_subdomains_not_lookalikes(self) -> None:
        self.assertEqual(
            normalize_domain("HTTPS://WWW.BÜCHER.Example.:443/account"),
            "xn--bcher-kva.example",
        )
        exclusions = {"example.com"}
        self.assertTrue(domain_is_excluded("https://www.example.com/login", exclusions))
        self.assertTrue(domain_is_excluded("team.example.com", exclusions))
        self.assertFalse(domain_is_excluded("notexample.com", exclusions))

    def test_app_and_folder_normalization_preserve_boundaries(self) -> None:
        self.assertEqual(normalize_app_name("  KEYCHAIN   Access "), "keychain access")
        watched = (normalize_folder_path("/Users/test/Documents"),)
        self.assertTrue(
            path_is_within_watched_folder("/Users/test/Documents/note.txt", watched)
        )
        self.assertFalse(
            path_is_within_watched_folder("/Users/test/Documents-old/note.txt", watched)
        )


class LocalStoragePermissionTests(unittest.TestCase):
    def test_database_sidecars_and_qdrant_tree_are_owner_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "orbit.db"
            qdrant_file = root / "qdrant_storage" / "nested" / "state.bin"
            for path in (database, database.with_name("orbit.db-wal"), database.with_name("orbit.db-shm"), qdrant_file):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()

            repair_orbit_storage(str(database), str(root / "qdrant_storage"))

            for path in (root, database, database.with_name("orbit.db-wal"), database.with_name("orbit.db-shm"), qdrant_file):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700 if path.is_dir() else 0o600)


class PythonCaptureExclusionTests(unittest.TestCase):
    def test_capture_route_enforces_normalized_domains_and_folder_boundaries(self) -> None:
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
                import routes.capture as capture
                import routes.privacy as privacy
                from models.event import CaptureEvent

                asyncio.run(database._async_engine.dispose())
                database = importlib.reload(database)
                capture = importlib.reload(capture)
                privacy = importlib.reload(privacy)
                asyncio.run(database.create_all_tables())

                async def operation():
                    await privacy.save_capture_consent(
                        privacy.CaptureConsentRequest(browser=True, file_activity=True)
                    )
                    await privacy.add_excluded_domain(
                        privacy.AddExcludedDomainRequest(
                            domain="HTTPS://WWW.Example.COM.:443/login"
                        )
                    )
                    await privacy.add_watched_folder(
                        privacy.AddWatchedFolderRequest(folder="/Users/test/Documents")
                    )
                    capture._filter_cache.last_refreshed_at = 0
                    await capture._refresh_cache_if_stale()

                    async with database._async_session_factory() as session:
                        domain_result = await capture.capture_event(
                            CaptureEvent(
                                id="excluded-domain",
                                timestamp=1,
                                type="url",
                                source="extension",
                                url="https://team.example.com/path",
                            ),
                            session,
                        )
                        folder_result = await capture.capture_event(
                            CaptureEvent(
                                id="outside-folder",
                                timestamp=2,
                                type="file_activity",
                                source="extension",
                                file_path="/Users/test/Documents-private/note.txt",
                            ),
                            session,
                        )
                    return domain_result, folder_result

                domain_result, folder_result = asyncio.run(operation())
                asyncio.run(database._async_engine.dispose())

            self.assertEqual(domain_result, {"status": "excluded"})
            self.assertEqual(folder_result, {"status": "excluded"})


class KeychainMigrationTests(unittest.TestCase):
    def _with_database(self, operation):
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

                asyncio.run(database._async_engine.dispose())
                database = importlib.reload(database)
                asyncio.run(database.create_all_tables())
                result = asyncio.run(operation(database))
                asyncio.run(database._async_engine.dispose())
            return result

    def test_legacy_key_is_removed_only_after_keychain_store_succeeds(self) -> None:
        async def operation(database):
            await database.set_setting("groq_api_key", "legacy-test-value")
            with patch(
                "services.keychain_service.has_groq_api_key", new=AsyncMock(return_value=False)
            ), patch(
                "services.keychain_service.store_groq_api_key", new=AsyncMock()
            ) as store_key:
                migrated = await database.migrate_legacy_groq_api_key_to_keychain()
            return migrated, await database.get_setting("groq_api_key"), store_key.await_count

        migrated, remaining_value, store_count = self._with_database(operation)
        self.assertTrue(migrated)
        self.assertIsNone(remaining_value)
        self.assertEqual(store_count, 1)

    def test_legacy_key_is_preserved_when_keychain_is_unavailable(self) -> None:
        async def operation(database):
            from services.keychain_service import KeychainUnavailableError

            await database.set_setting("groq_api_key", "legacy-test-value")
            with patch(
                "services.keychain_service.has_groq_api_key",
                new=AsyncMock(side_effect=KeychainUnavailableError("unavailable")),
            ):
                migrated = await database.migrate_legacy_groq_api_key_to_keychain()
            return migrated, await database.get_setting("groq_api_key")

        migrated, remaining_value = self._with_database(operation)
        self.assertFalse(migrated)
        self.assertEqual(remaining_value, "legacy-test-value")

    def test_keychain_secret_is_passed_through_stdin_not_process_arguments(self) -> None:
        import services.keychain_service as keychain

        completed = subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")
        with patch("services.keychain_service.sys.platform", "darwin"), patch(
            "services.keychain_service.subprocess.run", return_value=completed
        ) as run:
            keychain._store_groq_api_key_sync("synthetic-test-key")

        command = run.call_args.args[0]
        self.assertEqual(command[-1], "-w")
        self.assertNotIn("synthetic-test-key", command)
        self.assertEqual(run.call_args.kwargs["input"], "synthetic-test-key\n")
