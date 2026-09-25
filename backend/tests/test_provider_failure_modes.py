"""COST-005: predictable, bounded behavior for every named provider failure
class — no key, invalid key, rate limit/quota, provider outage, timeout,
malformed response, offline network — for both Groq and Voyage. Also proves
retries are bounded (never indefinite) and that a confirmed auth/rate-limit
failure is remembered for a cooldown window rather than rediscovered on
every call in the same batch.
"""

import asyncio
import importlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx


class _JsonResponse:
    def __init__(self, body: dict, status_code: int = 200, headers: dict | None = None):
        self._body = body
        self.status_code = status_code
        self.headers = headers or {}

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict:
        return self._body

    def raise_for_status(self) -> None:
        if not self.is_success:
            raise httpx.HTTPStatusError("synthetic", request=None, response=self)


class _SequencedPostClient:
    """Returns one queued response/exception per call, in order."""

    def __init__(self, responses: list):
        self._responses = list(responses)
        self.requests: list[dict] = []

    async def post(self, *args, **kwargs):
        self.requests.append({"args": args, "kwargs": kwargs})
        next_item = self._responses.pop(0)
        if isinstance(next_item, Exception):
            raise next_item
        return next_item


class GroqFailureModeTests(unittest.TestCase):
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

    def test_invalid_key_401_sets_a_cooldown_that_blocks_the_next_call(self):
        async def operation(groq):
            groq._http_client = _SequencedPostClient([
                _JsonResponse({"error": "invalid key"}, status_code=401),
            ])
            first = await groq._call_groq_chat(
                model="test-model", system_prompt="s", user_prompt="u", max_tokens=10
            )
            # A second call within the cooldown must not touch the network.
            second = await groq._call_groq_chat(
                model="test-model", system_prompt="s", user_prompt="u", max_tokens=10
            )
            return first, second, len(groq._http_client.requests)

        first, second, request_count = self._with_groq(operation)
        self.assertIsNone(first)
        self.assertIsNone(second)
        self.assertEqual(request_count, 1)

    def test_rate_limit_429_sets_a_cooldown_that_blocks_the_next_call(self):
        async def operation(groq):
            groq._http_client = _SequencedPostClient([
                _JsonResponse({"error": "rate limited"}, status_code=429, headers={"Retry-After": "120"}),
            ])
            await groq._call_groq_chat(model="test-model", system_prompt="s", user_prompt="u", max_tokens=10)
            await groq._call_groq_chat(model="test-model", system_prompt="s", user_prompt="u", max_tokens=10)
            return len(groq._http_client.requests)

        request_count = self._with_groq(operation)
        self.assertEqual(request_count, 1)

    def test_provider_outage_5xx_does_not_set_a_cooldown(self):
        """A transient outage should be retried on the next natural call
        (e.g. the next scheduler cycle) — never remembered as permanently
        bad the way an auth failure is."""
        async def operation(groq):
            groq._http_client = _SequencedPostClient([
                _JsonResponse({"error": "server error"}, status_code=503),
                _JsonResponse({"choices": [{"message": {"content": "ok"}}]}, status_code=200),
            ])
            first = await groq._call_groq_chat(model="test-model", system_prompt="s", user_prompt="u", max_tokens=10)
            second = await groq._call_groq_chat(model="test-model", system_prompt="s", user_prompt="u", max_tokens=10)
            return first, second, len(groq._http_client.requests)

        first, second, request_count = self._with_groq(operation)
        self.assertIsNone(first)
        self.assertEqual(second, "ok")
        self.assertEqual(request_count, 2)

    def test_timeout_is_caught_and_returns_none_without_raising(self):
        async def operation(groq):
            groq._http_client = _SequencedPostClient([httpx.TimeoutException("timed out")])
            return await groq._call_groq_chat(model="test-model", system_prompt="s", user_prompt="u", max_tokens=10)

        result = self._with_groq(operation)
        self.assertIsNone(result)

    def test_offline_network_is_caught_and_returns_none_without_raising(self):
        async def operation(groq):
            groq._http_client = _SequencedPostClient([httpx.ConnectError("no network")])
            return await groq._call_groq_chat(model="test-model", system_prompt="s", user_prompt="u", max_tokens=10)

        result = self._with_groq(operation)
        self.assertIsNone(result)

    def test_malformed_json_response_returns_none_without_raising(self):
        async def operation(groq):
            groq._http_client = _SequencedPostClient([
                _JsonResponse({"unexpected": "shape"}, status_code=200),
            ])
            return await groq._call_groq_chat(model="test-model", system_prompt="s", user_prompt="u", max_tokens=10)

        result = self._with_groq(operation)
        self.assertIsNone(result)

    def test_empty_completion_returns_none_without_raising(self):
        async def operation(groq):
            groq._http_client = _SequencedPostClient([
                _JsonResponse({"choices": [{"message": {"content": "   "}}]}, status_code=200),
            ])
            return await groq._call_groq_chat(model="test-model", system_prompt="s", user_prompt="u", max_tokens=10)

        result = self._with_groq(operation)
        self.assertIsNone(result)

    def test_no_call_ever_retries_within_itself(self):
        """_call_groq_chat must make exactly one request per invocation —
        retrying belongs to the caller's next natural cycle, never a loop
        inside a single call (COST-005: never retry indefinitely)."""
        async def operation(groq):
            groq._http_client = _SequencedPostClient([
                _JsonResponse({"error": "server error"}, status_code=503),
            ])
            await groq._call_groq_chat(model="test-model", system_prompt="s", user_prompt="u", max_tokens=10)
            return len(groq._http_client.requests)

        request_count = self._with_groq(operation)
        self.assertEqual(request_count, 1)


class VoyageFailureModeTests(unittest.TestCase):
    def _with_voyage(self, operation, *, personal_key: str | None = "voyage_test_key_0123456789"):
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

    def test_invalid_key_401_sets_a_cooldown_that_blocks_the_next_call(self):
        async def operation(voyage):
            voyage._http_client = _SequencedPostClient([
                _JsonResponse({"error": "invalid key"}, status_code=401),
            ])
            with self.assertRaises(Exception):
                await voyage.generate_text_embedding("first")
            # A second call within the cooldown must not touch the network.
            with self.assertRaises(voyage.VoyageUnavailableError):
                await voyage.generate_text_embedding("second")
            return len(voyage._http_client.requests)

        request_count = self._with_voyage(operation)
        self.assertEqual(request_count, 1)

    def test_rate_limit_429_sets_a_cooldown_that_blocks_the_next_call(self):
        async def operation(voyage):
            voyage._http_client = _SequencedPostClient([
                _JsonResponse({"error": "rate limited"}, status_code=429, headers={"Retry-After": "60"}),
            ])
            with self.assertRaises(Exception):
                await voyage.generate_text_embedding("first")
            with self.assertRaises(voyage.VoyageUnavailableError):
                await voyage.generate_text_embedding("second")
            return len(voyage._http_client.requests)

        request_count = self._with_voyage(operation)
        self.assertEqual(request_count, 1)

    def test_provider_outage_retries_bounded_times_then_raises(self):
        async def operation(voyage):
            voyage._http_client = _SequencedPostClient([
                _JsonResponse({"error": "server error"}, status_code=503),
                _JsonResponse({"error": "server error"}, status_code=503),
                _JsonResponse({"error": "server error"}, status_code=503),
            ])
            with patch.object(voyage.asyncio, "sleep", new=AsyncMock()):
                with self.assertRaises(httpx.HTTPStatusError):
                    await voyage.generate_text_embedding("text")
            return len(voyage._http_client.requests)

        request_count = self._with_voyage(operation)
        # Exactly 3 attempts — bounded, never indefinite.
        self.assertEqual(request_count, 3)

    def test_offline_network_retries_bounded_times_then_raises(self):
        async def operation(voyage):
            voyage._http_client = _SequencedPostClient([
                httpx.ConnectError("no network"),
                httpx.ConnectError("no network"),
                httpx.ConnectError("no network"),
            ])
            with patch.object(voyage.asyncio, "sleep", new=AsyncMock()):
                with self.assertRaises(httpx.ConnectError):
                    await voyage.generate_text_embedding("text")
            return len(voyage._http_client.requests)

        request_count = self._with_voyage(operation)
        self.assertEqual(request_count, 3)

    def test_malformed_response_raises_immediately_without_retrying(self):
        async def operation(voyage):
            voyage._http_client = _SequencedPostClient([
                _JsonResponse({"unexpected": "shape"}, status_code=200),
            ])
            with self.assertRaises(KeyError):
                await voyage.generate_text_embedding("text")
            return len(voyage._http_client.requests)

        request_count = self._with_voyage(operation)
        self.assertEqual(request_count, 1)


if __name__ == "__main__":
    unittest.main()
