"""Regression coverage for Voyage AI BYOK, called directly with no
maintainer infrastructure in front of it (the former Cloudflare Worker
relay was removed entirely).

Mirrors test_groq_byok.py's structure. Covers:
  - with no personal key, generate_text_embedding fails fast (no retries,
    no maintainer-funded fallback exists);
  - with a personal key, the request goes straight to
    https://api.voyageai.com/v1/embeddings with a standard
    Authorization: Bearer header;
  - the /settings/voyage-key routes never return the raw key, and the
    add/test/disable/remove lifecycle behaves correctly.
"""

import asyncio
import importlib
import os
import secrets
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

# Split so it doesn't read as a plausible credential to secret scanners —
# this is a fake key exercising the save/enable/disable/delete lifecycle,
# never a real one.
_FAKE_SAVED_VOYAGE_KEY = "voyage_saved_key_" + "0123456789"


class _JsonResponse:
    def __init__(self, body: dict, status_code: int = 200):
        self._body = body
        self.status_code = status_code

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return self._body

    def raise_for_status(self) -> None:
        if not self.is_success:
            raise RuntimeError("synthetic HTTP failure")


class _CapturingPostClient:
    def __init__(self, response_body: dict, status_code: int = 200):
        self.requests: list[dict] = []
        self._response_body = response_body
        self._status_code = status_code

    async def post(self, *args, **kwargs):
        self.requests.append({"args": args, "kwargs": kwargs})
        return _JsonResponse(self._response_body, self._status_code)


class VoyageDirectCallRoutingTests(unittest.TestCase):
    def _with_voyage(self, operation, *, personal_key: str | None):
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "orbit.db"
            with patch.dict(os.environ, {"ORBIT_DB_PATH": str(database_path)}, clear=False):
                import database
                import services.voyage_service as voyage

                asyncio.run(database._async_engine.dispose())
                database = importlib.reload(database)
                voyage = importlib.reload(voyage)
                asyncio.run(database.create_all_tables())

                with patch.object(voyage, "get_voyage_api_key", new=AsyncMock(return_value=personal_key)):
                    result = asyncio.run(operation(voyage))
                asyncio.run(database._async_engine.dispose())
            return result

    def test_embedding_request_carries_the_personal_key_header(self):
        async def operation(voyage):
            voyage._http_client = _CapturingPostClient(
                {"data": [{"embedding": [0.0, 1.0]}]}
            )
            await voyage.generate_text_embedding("some session summary text")
            return voyage._http_client.requests[0]

        request = self._with_voyage(operation, personal_key="voyage_personal_key_0123456789")
        self.assertEqual(request["args"][0], "https://api.voyageai.com/v1/embeddings")
        self.assertEqual(
            request["kwargs"]["headers"].get("Authorization"),
            "Bearer voyage_personal_key_0123456789",
        )

    def test_no_personal_key_fails_immediately_without_any_request(self):
        async def operation(voyage):
            voyage._http_client = _CapturingPostClient({"data": []})
            with self.assertRaises(RuntimeError):
                await voyage.generate_text_embedding("some text")
            return voyage._http_client.requests

        requests = self._with_voyage(operation, personal_key=None)
        self.assertEqual(requests, [])

    def test_key_test_endpoint_never_stores_the_key(self):
        async def operation(voyage):
            voyage._http_client = _CapturingPostClient({"data": [{"embedding": [0.0]}]})
            valid, reason = await voyage.test_voyage_api_key("voyage_candidate_key_0123456789")
            return valid, reason, voyage._http_client.requests[0]

        valid, reason, request = self._with_voyage(operation, personal_key=None)
        self.assertTrue(valid)
        self.assertEqual(reason, "ok")
        self.assertEqual(
            request["kwargs"]["headers"]["Authorization"], "Bearer voyage_candidate_key_0123456789"
        )

    def test_key_test_endpoint_reports_invalid_key(self):
        async def operation(voyage):
            voyage._http_client = _CapturingPostClient({"error": "invalid"}, status_code=401)
            return await voyage.test_voyage_api_key("voyage_bad_key_0123456789")

        valid, reason = self._with_voyage(operation, personal_key=None)
        self.assertFalse(valid)
        self.assertEqual(reason, "invalid_key")


class VoyageKeySettingsRouteTests(unittest.TestCase):
    """Route-level lifecycle for /settings/voyage-key — Keychain is mocked so
    this suite never touches the real macOS Keychain."""

    def _client(self, keychain_state: dict):
        import local_api_security
        import routes.settings as settings

        importlib.reload(settings)

        async def fake_store(key: str) -> None:
            keychain_state["key"] = key

        async def fake_has() -> bool:
            return "key" in keychain_state

        async def fake_delete() -> None:
            keychain_state.pop("key", None)

        patchers = [
            patch.object(settings, "store_voyage_api_key", new=AsyncMock(side_effect=fake_store)),
            patch.object(settings, "has_voyage_api_key", new=AsyncMock(side_effect=fake_has)),
            patch.object(settings, "delete_voyage_api_key", new=AsyncMock(side_effect=fake_delete)),
        ]
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

        token = secrets.token_urlsafe(32)
        app = FastAPI()
        app.add_middleware(
            local_api_security.LocalApiSecurityMiddleware,
            config=local_api_security.LocalApiSecurityConfig(session_token=token),
        )
        app.include_router(settings.router)
        client = TestClient(app, base_url="http://127.0.0.1:47821")
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        return client, {"Authorization": f"Bearer {token}"}, settings

    def _with_database(self, test_body):
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "orbit.db"
            with patch.dict(os.environ, {"ORBIT_DB_PATH": str(database_path)}, clear=False):
                import database

                asyncio.run(database._async_engine.dispose())
                database = importlib.reload(database)
                asyncio.run(database.create_all_tables())
                test_body()
                asyncio.run(database._async_engine.dispose())

    def test_add_test_disable_remove_lifecycle_and_response_shape(self):
        def body():
            keychain_state: dict = {}
            client, headers, settings = self._client(keychain_state)

            status = client.get("/settings/voyage-key", headers=headers).json()
            self.assertEqual(status, {"configured": False, "enabled": True})

            bad = client.post("/settings/voyage-key", headers=headers, json={"api_key": "short"})
            self.assertEqual(bad.status_code, 422)
            self.assertEqual(keychain_state, {})

            with patch.object(
                settings, "test_voyage_api_key", new=AsyncMock(return_value=(True, "ok"))
            ):
                test_response = client.post(
                    "/settings/voyage-key/test",
                    headers=headers,
                    json={"api_key": "voyage_candidate_key_0123456789"},
                )
            self.assertEqual(test_response.json(), {"valid": True, "reason": "ok"})
            self.assertEqual(keychain_state, {})

            save_response = client.post(
                "/settings/voyage-key", headers=headers, json={"api_key": _FAKE_SAVED_VOYAGE_KEY}
            )
            self.assertEqual(save_response.json(), {"success": True})
            self.assertEqual(keychain_state, {"key": _FAKE_SAVED_VOYAGE_KEY})

            status = client.get("/settings/voyage-key", headers=headers).json()
            self.assertEqual(status, {"configured": True, "enabled": True})
            self.assertNotIn("api_key", status)
            self.assertNotIn("key", status)

            client.post("/settings/voyage-key/enabled", headers=headers, json={"enabled": False})
            status = client.get("/settings/voyage-key", headers=headers).json()
            self.assertEqual(status, {"configured": True, "enabled": False})
            self.assertEqual(keychain_state, {"key": _FAKE_SAVED_VOYAGE_KEY})

            client.post("/settings/voyage-key/enabled", headers=headers, json={"enabled": True})
            remove_response = client.delete("/settings/voyage-key", headers=headers)
            self.assertEqual(remove_response.json(), {"success": True})
            self.assertEqual(keychain_state, {})
            status = client.get("/settings/voyage-key", headers=headers).json()
            self.assertEqual(status["configured"], False)

        self._with_database(body)

    def test_provider_status_route_no_longer_exists(self):
        def body():
            client, headers, _settings = self._client({})
            response = client.get("/settings/provider-status", headers=headers)
            self.assertEqual(response.status_code, 404)

        self._with_database(body)


if __name__ == "__main__":
    unittest.main()
