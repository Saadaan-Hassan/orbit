"""Regression coverage for COST-004: migrating off Groq models retired on
2026-08-16 (llama-3.1-8b-instant, llama-3.3-70b-versatile) to the
openai/gpt-oss-* family, with the reasoning_effort handling that requires.
"""

import asyncio
import importlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch


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
        yield 'data: {"choices":[{"delta":{"content":"answer"}}]}'
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


class GroqModelMigrationTests(unittest.TestCase):
    def _with_groq(self, operation, *, personal_key: str | None = "gsk_test_key_0123456789"):
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

    def test_retired_model_ids_are_not_referenced_anywhere_in_the_module(self):
        import services.groq_service as groq

        self.assertNotEqual(groq.GROQ_CLASSIFY_MODEL, "llama-3.1-8b-instant")
        self.assertNotEqual(groq.GROQ_RECALL_MODEL, "llama-3.3-70b-versatile")
        self.assertEqual(groq.GROQ_CLASSIFY_MODEL, "openai/gpt-oss-20b")
        self.assertEqual(groq.GROQ_RECALL_MODEL, "openai/gpt-oss-120b")

    def test_classification_sends_the_new_model_and_low_reasoning_effort(self):
        async def operation(groq):
            groq._http_client = _CapturingPostClient(
                {"choices": [{"message": {"content": '[{"id":"e1","category":"work","project":null}]'}}]}
            )
            await groq.classify_events_batch_groq(
                [{"id": "e1", "type": "window", "raw_content": "x", "app_name": "App", "url": ""}]
            )
            return groq._http_client.requests[0]["kwargs"]["json"]

        sent_json = self._with_groq(operation)
        self.assertEqual(sent_json["model"], "openai/gpt-oss-20b")
        self.assertEqual(sent_json["reasoning_effort"], "low")

    def test_classification_token_budget_includes_reasoning_headroom(self):
        """The per-event budget alone (tuned for a non-reasoning model) would
        leave zero room for gpt-oss-20b's chain-of-thought; the headroom
        constant must actually be reflected in the outgoing max_tokens."""
        async def operation(groq):
            groq._http_client = _CapturingPostClient(
                {"choices": [{"message": {"content": "[]"}}]}
            )
            events = [
                {"id": f"e{i}", "type": "window", "raw_content": "x", "app_name": "App", "url": ""}
                for i in range(3)
            ]
            await groq.classify_events_batch_groq(events)
            return groq._http_client.requests[0]["kwargs"]["json"]["max_tokens"]

        max_tokens = self._with_groq(operation)
        # base(50) + 3*per_event(55) = 215 without headroom; the reasoning
        # headroom must push this meaningfully higher.
        self.assertGreaterEqual(max_tokens, 215 + 400)

    def test_recall_streaming_sends_the_new_model_and_reasoning_effort(self):
        async def operation(groq):
            groq._http_client = _CapturingStreamClient()
            chunks = [
                chunk
                async for chunk in groq.stream_recall_response_groq(
                    system_prompt="system", user_prompt="query"
                )
            ]
            return chunks, groq._http_client.requests[0]["kwargs"]["json"]

        chunks, sent_json = self._with_groq(operation)
        self.assertEqual(chunks, ["answer"])
        self.assertEqual(sent_json["model"], "openai/gpt-oss-120b")
        self.assertEqual(sent_json["reasoning_effort"], "low")
        self.assertTrue(sent_json["stream"])

    def test_session_summary_still_uses_gpt_oss_120b_with_low_reasoning(self):
        """Unaffected by COST-004 (already gpt-oss-120b before this task) —
        regression guard that the migration didn't disturb it."""
        async def operation(groq):
            groq._http_client = _CapturingPostClient(
                {"choices": [{"message": {"content": "{}"}}]}
            )
            await groq.generate_session_summary_groq("user prompt", "system prompt")
            return groq._http_client.requests[0]["kwargs"]["json"]

        sent_json = self._with_groq(operation)
        self.assertEqual(sent_json["model"], "openai/gpt-oss-120b")
        self.assertEqual(sent_json["reasoning_effort"], "low")


if __name__ == "__main__":
    unittest.main()
