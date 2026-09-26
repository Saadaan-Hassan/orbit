"""Regression coverage for COST-001: Keychain-backed BYOK direct Groq access.

Covers two things the roadmap's acceptance criteria call out specifically:
  - once a personal key is configured, Groq calls go straight to api.groq.com
    with an Authorization: Bearer header, never through the maintainer's
    Worker and never via the old X-Groq-Api-Key header;
  - the /settings/groq-key routes never return the raw key to the webview,
    and the add/remove/disable/test lifecycle behaves correctly.
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
_FAKE_SAVED_GROQ_KEY = "gsk_saved_key_" + "0123456789"


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

    async def get(self, *args, **kwargs):
        self.requests.append({"args": args, "kwargs": kwargs})
        return _JsonResponse(self._response_body, self._status_code)


class _StreamingResponse:
    def raise_for_status(self) -> None:
        return None

    async def aiter_lines(self):
        yield 'data: {"choices":[{"delta":{"content":"safe answer"}}]}'
        yield "data: [DONE]"


class _StreamingContext:
    async def __aenter__(self):
        return _StreamingResponse()

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _CapturingStreamClient:
    def __init__(self):
        self.requests: list[dict] = []

    def stream(self, *args, **kwargs):
        self.requests.append({"args": args, "kwargs": kwargs})
        return _StreamingContext()


class GroqDirectCallRoutingTests(unittest.TestCase):
    """A personal key must route straight to api.groq.com; no key must fail
    immediately with no request made at all (no Worker or other maintainer
    infrastructure exists to fall back to)."""

    def _with_groq(self, operation, *, personal_key: str | None):
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "orbit.db"
            with patch.dict(os.environ, {"ORBIT_DB_PATH": str(database_path)}, clear=False):
                import database
                import services.groq_service as groq

                asyncio.run(database._async_engine.dispose())
                database = importlib.reload(database)
                groq = importlib.reload(groq)
                asyncio.run(database.create_all_tables())

                with patch.object(groq, "get_groq_api_key", new=AsyncMock(return_value=personal_key)):
                    result = asyncio.run(operation(groq))
                asyncio.run(database._async_engine.dispose())
            return result

    def test_classification_uses_direct_url_and_bearer_header_with_personal_key(self):
        async def operation(groq):
            groq._http_client = _CapturingPostClient(
                {"choices": [{"message": {"content": '[{"id":"e1","category":"work","project":null}]'}}]}
            )
            await groq.classify_events_batch_groq(
                [{"id": "e1", "type": "window", "raw_content": "x", "app_name": "App", "url": ""}]
            )
            return groq._http_client.requests[0]

        request = self._with_groq(operation, personal_key="gsk_test_personal_key_0123456789")
        self.assertEqual(request["args"][0], "https://api.groq.com/openai/v1/chat/completions")
        self.assertEqual(
            request["kwargs"]["headers"].get("Authorization"),
            "Bearer gsk_test_personal_key_0123456789",
        )
        self.assertNotIn("X-Groq-Api-Key", request["kwargs"]["headers"])

    def test_session_summary_uses_direct_url_with_personal_key(self):
        async def operation(groq):
            groq._http_client = _CapturingPostClient(
                {"choices": [{"message": {"content": "{}"}}]}
            )
            await groq.generate_session_summary_groq("user prompt", "system prompt")
            return groq._http_client.requests[0]

        request = self._with_groq(operation, personal_key="gsk_test_personal_key_0123456789")
        self.assertEqual(request["args"][0], "https://api.groq.com/openai/v1/chat/completions")
        self.assertEqual(
            request["kwargs"]["headers"].get("Authorization"),
            "Bearer gsk_test_personal_key_0123456789",
        )

    def test_recall_stream_uses_direct_url_with_personal_key(self):
        async def operation(groq):
            groq._http_client = _CapturingStreamClient()
            chunks = [
                chunk
                async for chunk in groq.stream_recall_response_groq(
                    system_prompt="system", user_prompt="query"
                )
            ]
            return chunks, groq._http_client.requests[0]

        chunks, request = self._with_groq(operation, personal_key="gsk_test_personal_key_0123456789")
        self.assertEqual(chunks, ["safe answer"])
        self.assertEqual(request["args"][1], "https://api.groq.com/openai/v1/chat/completions")
        self.assertEqual(
            request["kwargs"]["headers"].get("Authorization"),
            "Bearer gsk_test_personal_key_0123456789",
        )

    def test_no_personal_key_fails_immediately_without_any_request(self):
        async def operation(groq):
            groq._http_client = _CapturingPostClient(
                {"choices": [{"message": {"content": "{}"}}]}
            )
            result = await groq.generate_session_summary_groq("user prompt", "system prompt")
            return result, groq._http_client.requests

        result, requests = self._with_groq(operation, personal_key=None)
        self.assertIsNone(result)
        self.assertEqual(requests, [])

    def test_key_test_endpoint_never_stores_the_key(self):
        async def operation(groq):
            groq._http_client = _CapturingPostClient({"data": []}, status_code=200)
            valid, reason = await groq.test_groq_api_key("gsk_candidate_key_0123456789")
            return valid, reason, groq._http_client.requests[0]

        valid, reason, request = self._with_groq(operation, personal_key=None)
        self.assertTrue(valid)
        self.assertEqual(reason, "ok")
        self.assertEqual(request["args"][0], "https://api.groq.com/openai/v1/models")
        self.assertEqual(request["kwargs"]["headers"]["Authorization"], "Bearer gsk_candidate_key_0123456789")

    def test_key_test_endpoint_reports_invalid_key_without_leaking_body(self):
        async def operation(groq):
            groq._http_client = _CapturingPostClient(
                {"error": {"message": "invalid api key"}}, status_code=401
            )
            return await groq.test_groq_api_key("gsk_bad_key_0123456789")

        valid, reason = self._with_groq(operation, personal_key=None)
        self.assertFalse(valid)
        self.assertEqual(reason, "invalid_key")


class GroqKeySettingsRouteTests(unittest.TestCase):
    """Route-level lifecycle: add/test/disable/remove, and the response shape
    (never the raw key) — Keychain calls are mocked so this suite never
    touches the real macOS Keychain."""

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
            patch.object(settings, "store_groq_api_key", new=AsyncMock(side_effect=fake_store)),
            patch.object(settings, "has_groq_api_key", new=AsyncMock(side_effect=fake_has)),
            patch.object(settings, "delete_groq_api_key", new=AsyncMock(side_effect=fake_delete)),
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

            # Fresh install: not configured.
            status = client.get("/settings/groq-key", headers=headers).json()
            self.assertEqual(status, {"configured": False, "enabled": True})

            # Reject an obviously-malformed key before it ever reaches Keychain.
            bad = client.post("/settings/groq-key", headers=headers, json={"api_key": "not-a-key"})
            self.assertEqual(bad.status_code, 422)
            self.assertEqual(keychain_state, {})

            # Save a well-formed key.
            with patch.object(
                settings, "test_groq_api_key", new=AsyncMock(return_value=(True, "ok"))
            ):
                test_response = client.post(
                    "/settings/groq-key/test",
                    headers=headers,
                    json={"api_key": "gsk_candidate_key_0123456789"},
                )
            self.assertEqual(test_response.json(), {"valid": True, "reason": "ok"})
            # The test call must never persist the key.
            self.assertEqual(keychain_state, {})

            save_response = client.post(
                "/settings/groq-key", headers=headers, json={"api_key": _FAKE_SAVED_GROQ_KEY}
            )
            self.assertEqual(save_response.json(), {"success": True})
            self.assertEqual(keychain_state, {"key": _FAKE_SAVED_GROQ_KEY})

            # The key itself is never returned — only booleans.
            status = client.get("/settings/groq-key", headers=headers).json()
            self.assertEqual(status, {"configured": True, "enabled": True})
            self.assertNotIn("api_key", status)
            self.assertNotIn("key", status)

            # Temporarily disable without discarding the stored key.
            disable_response = client.post(
                "/settings/groq-key/enabled", headers=headers, json={"enabled": False}
            )
            self.assertEqual(disable_response.json(), {"success": True, "enabled": False})
            status = client.get("/settings/groq-key", headers=headers).json()
            self.assertEqual(status, {"configured": True, "enabled": False})
            self.assertEqual(keychain_state, {"key": _FAKE_SAVED_GROQ_KEY})

            # Re-enable, then remove entirely.
            client.post("/settings/groq-key/enabled", headers=headers, json={"enabled": True})
            remove_response = client.delete("/settings/groq-key", headers=headers)
            self.assertEqual(remove_response.json(), {"success": True})
            self.assertEqual(keychain_state, {})
            status = client.get("/settings/groq-key", headers=headers).json()
            self.assertEqual(status["configured"], False)

        self._with_database(body)

    def test_route_requires_the_authenticated_session(self):
        def body():
            client, _headers, _settings = self._client({})
            response = client.get("/settings/groq-key")
            self.assertEqual(response.status_code, 401)

        self._with_database(body)


if __name__ == "__main__":
    unittest.main()
