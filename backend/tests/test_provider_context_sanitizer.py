"""Regression tests for the last privacy boundary before provider requests."""

import asyncio
import importlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch


LEGACY_SECRET = "gsk_orbit_legacy_secret_that_must_not_leave_the_device_123456"
CUSTOM_SECRET = "orbit-private-phrase"
LEGACY_PATH = "/Users/alice/Orbit/private-notes.txt"


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


class ProviderContextSanitizerTests(unittest.TestCase):
    def _with_services(self, operation):
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "orbit.db"
            with patch.dict(os.environ, {"ORBIT_DB_PATH": str(database_path)}, clear=False):
                import database
                import services.claude_service as claude
                import services.gemini_service as gemini
                import services.groq_service as groq
                import services.provider_context_sanitizer as sanitizer
                import services.voyage_service as voyage

                asyncio.run(database._async_engine.dispose())
                database = importlib.reload(database)
                sanitizer = importlib.reload(sanitizer)
                claude = importlib.reload(claude)
                gemini = importlib.reload(gemini)
                groq = importlib.reload(groq)
                voyage = importlib.reload(voyage)
                asyncio.run(database.create_all_tables())
                result = asyncio.run(
                    operation(database, sanitizer, claude, gemini, groq, voyage)
                )
                asyncio.run(database._async_engine.dispose())
            return result

    @staticmethod
    async def _insert_legacy_values(database):
        async with database._async_engine.begin() as connection:
            await connection.execute(
                database.text(
                    """
                    INSERT INTO redaction_patterns (id, pattern, created_at)
                    VALUES ('test-pattern', :pattern, 1)
                    """
                ),
                {"pattern": CUSTOM_SECRET},
            )
            await connection.execute(
                database.text(
                    """
                    INSERT INTO events (id, timestamp, type, raw_content, app_name, url, source)
                    VALUES ('legacy-event', 1, 'clipboard', :raw_content, :app_name, :url, 'test')
                    """
                ),
                {
                    "raw_content": f"token={LEGACY_SECRET}; note={CUSTOM_SECRET}; path={LEGACY_PATH}",
                    "app_name": "Legacy Editor",
                    "url": "https://example.test/?api_key=legacy-value",
                },
            )
            result = await connection.execute(
                database.text(
                    """
                    SELECT id, type, raw_content, app_name, url
                    FROM events WHERE id = 'legacy-event'
                    """
                )
            )
            return dict(result.fetchone()._mapping)

    def test_legacy_database_row_is_redacted_before_groq_classification(self):
        async def operation(database, sanitizer, claude, gemini, groq, voyage):
            legacy_event = await self._insert_legacy_values(database)
            client = _CapturingPostClient(
                {"choices": [{"message": {"content": '[{"id":"legacy-event","category":"work","project":null}]'}}]}
            )
            groq._http_client = client
            await groq.classify_events_batch_groq([legacy_event])
            return json.dumps(client.requests[0]["kwargs"]["json"], ensure_ascii=False)

        sent_json = self._with_services(operation)
        self.assertNotIn(LEGACY_SECRET, sent_json)
        self.assertNotIn(CUSTOM_SECRET, sent_json)
        self.assertNotIn(LEGACY_PATH, sent_json)
        self.assertIn("[REDACTED", sent_json)

    def test_recall_query_and_conversation_history_are_redacted_before_streaming(self):
        async def operation(database, sanitizer, claude, gemini, groq, voyage):
            await self._insert_legacy_values(database)
            client = _CapturingStreamClient()
            groq._http_client = client
            chunks = [
                chunk
                async for chunk in groq.stream_recall_response_groq(
                    system_prompt="system prompt",
                    user_prompt=f"Find {LEGACY_SECRET} at {LEGACY_PATH}",
                    conversation_history=[
                        {"role": "user", "content": f"Earlier: {CUSTOM_SECRET}"},
                        {"role": "assistant", "content": f"I saw {LEGACY_SECRET}"},
                    ],
                )
            ]
            return chunks, json.dumps(client.requests[0]["kwargs"]["json"], ensure_ascii=False)

        chunks, sent_json = self._with_services(operation)
        self.assertEqual(chunks, ["safe answer"])
        self.assertNotIn(LEGACY_SECRET, sent_json)
        self.assertNotIn(CUSTOM_SECRET, sent_json)
        self.assertNotIn(LEGACY_PATH, sent_json)

    def test_claude_gemini_and_voyage_use_the_same_boundary(self):
        async def operation(database, sanitizer, claude, gemini, groq, voyage):
            await self._insert_legacy_values(database)
            unsafe_text = f"{LEGACY_SECRET} {CUSTOM_SECRET} {LEGACY_PATH}"

            claude_client = _CapturingPostClient(
                {"content": [{"text": "summary"}]}
            )
            claude._http_client = claude_client
            await claude.generate_session_summary("system", unsafe_text)

            gemini_client = _CapturingPostClient(
                {
                    "candidates": [
                        {"content": {"parts": [{"text": '[]'}]}}
                    ]
                }
            )
            gemini._http_client = gemini_client
            await gemini.classify_events_batch(
                [{"id": "event", "raw_content": unsafe_text, "app_name": "app", "url": ""}]
            )

            voyage_client = _CapturingPostClient(
                {"data": [{"embedding": [0.0, 1.0]}]}
            )
            voyage._http_client = voyage_client
            with patch.object(
                voyage, "get_voyage_api_key", new=AsyncMock(return_value="voyage_test_key")
            ):
                await voyage.generate_text_embedding(unsafe_text)

            return [
                json.dumps(claude_client.requests[0]["kwargs"]["json"], ensure_ascii=False),
                json.dumps(gemini_client.requests[0]["kwargs"]["json"], ensure_ascii=False),
                json.dumps(voyage_client.requests[0]["kwargs"]["json"], ensure_ascii=False),
            ]

        provider_payloads = self._with_services(operation)
        for payload in provider_payloads:
            self.assertNotIn(LEGACY_SECRET, payload)
            self.assertNotIn(CUSTOM_SECRET, payload)
            self.assertNotIn(LEGACY_PATH, payload)
            self.assertIn("[REDACTED", payload)

    def test_provider_diagnostics_exclude_response_bodies(self):
        async def operation(database, sanitizer, claude, gemini, groq, voyage):
            groq._http_client = _CapturingPostClient(
                {"error": {"message": f"echoed prompt: {LEGACY_SECRET} {LEGACY_PATH}"}},
                status_code=500,
            )
            with self.assertLogs("services.provider_context_sanitizer", level="WARNING") as logs:
                result = await groq._call_groq_chat(
                    model="test-model",
                    system_prompt="system",
                    user_prompt=LEGACY_SECRET,
                    max_tokens=1,
                )
            return result, "\n".join(logs.output)

        result, log_output = self._with_services(operation)
        self.assertIsNone(result)
        self.assertIn("provider=groq", log_output)
        self.assertIn("status=500", log_output)
        self.assertNotIn(LEGACY_SECRET, log_output)
        self.assertNotIn(LEGACY_PATH, log_output)

    def test_embedding_metadata_is_redacted_and_bounded(self):
        async def operation(database, sanitizer, claude, gemini, groq, voyage):
            await self._insert_legacy_values(database)
            return await sanitizer.sanitize_provider_metadata(
                {
                    "summary": f"{LEGACY_SECRET} {CUSTOM_SECRET}",
                    "file_path": LEGACY_PATH,
                    "resources": [LEGACY_SECRET] * 20,
                }
            )

        safe_metadata = self._with_services(operation)
        serialized_metadata = json.dumps(safe_metadata, ensure_ascii=False)
        self.assertNotIn(LEGACY_SECRET, serialized_metadata)
        self.assertNotIn(CUSTOM_SECRET, serialized_metadata)
        self.assertNotIn(LEGACY_PATH, serialized_metadata)
        self.assertLessEqual(len(serialized_metadata), 8_000)
