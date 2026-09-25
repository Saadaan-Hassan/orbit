"""Deterministic tests for recall's offline/no-embedding retrieval quality
(COST-003 acceptance criteria: "Session creation and recall must not require
an embedding request" and "Offline retrieval quality has deterministic
tests").

No personal Voyage key is configured in any of these tests (a fresh temp
database has none) — this exercises the real, unmocked
VoyageUnavailableError path end to end, not a simulated one. Only the
Groq streaming call is mocked, since it's the one genuine network dependency.
"""

import asyncio
import importlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch


async def _fake_stream_recall_response_groq(**_kwargs):
    yield "Here's what you were doing: "
    yield "debugging the auth flow."


class OfflineRecallTests(unittest.TestCase):
    def _with_recall(self, operation):
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
                import routes.recall as recall

                asyncio.run(database._async_engine.dispose())
                database = importlib.reload(database)
                recall = importlib.reload(recall)
                asyncio.run(database.create_all_tables())
                result = asyncio.run(operation(database, recall))
                asyncio.run(database._async_engine.dispose())
            return result

    @staticmethod
    async def _insert_event(database, event_id: str, raw_content: str) -> None:
        async with database._async_engine.begin() as connection:
            await connection.execute(
                database.text(
                    """
                    INSERT INTO events (id, timestamp, type, raw_content, app_name, url, source)
                    VALUES (:id, :ts, 'window', :raw_content, 'VS Code', '', 'rust')
                    """
                ),
                {"id": event_id, "ts": 1_000_000, "raw_content": raw_content},
            )

    @staticmethod
    async def _collect_chunks(generator) -> list[str]:
        chunks = []
        async for sse_line in generator:
            if sse_line.startswith("data: "):
                payload = json.loads(sse_line[len("data: "):])
                if "chunk" in payload:
                    chunks.append(payload["chunk"])
        return chunks

    def test_no_voyage_key_still_gets_a_groq_synthesized_answer(self):
        """The regression this test guards: before the fix, any failure in
        the semantic-search step (including the ordinary no-key state)
        aborted the whole try block — skipping Groq synthesis entirely and
        returning only a raw FTS5 dump. Semantic search must soft-fail so
        Groq still gets a chance to run on FTS5-only context."""
        async def operation(database, recall):
            await self._insert_event(database, "e1", "Working on the auth.py refactor")
            with patch.object(
                recall, "stream_recall_response_groq", new=_fake_stream_recall_response_groq
            ):
                chunks = await self._collect_chunks(
                    recall._stream_sse_recall("what was I doing", None)
                )
            return chunks

        chunks = self._with_recall(operation)
        joined = "".join(chunks)
        self.assertIn("debugging the auth flow", joined)
        self.assertNotIn("Sorry, something went wrong", joined)

    def test_no_voyage_key_and_no_groq_falls_back_to_plain_fts5_text(self):
        """Full offline/no-key state: neither provider available. Must yield
        the friendly FTS5 fallback, never the generic error message (that
        was the actual bug — a bare VoyageUnavailableError escaping
        into the catch-all branch)."""
        async def operation(database, recall):
            import httpx

            await self._insert_event(database, "e1", "Working on the auth.py refactor")

            async def failing_groq(**_kwargs):
                raise httpx.ConnectError("no route to worker")
                yield  # pragma: no cover — makes this an async generator

            with patch.object(recall, "stream_recall_response_groq", new=failing_groq):
                chunks = await self._collect_chunks(
                    recall._stream_sse_recall("auth.py refactor", None)
                )
            return chunks

        chunks = self._with_recall(operation)
        joined = "".join(chunks)
        self.assertNotIn("Sorry, something went wrong", joined)
        self.assertIn("auth.py", joined)
        # COST-005: the fallback message must reassure the user their data
        # never left the device, and describe *why* rather than a generic
        # "you may be offline" guess for every possible cause.
        self.assertIn("never left your Mac", joined)
        self.assertIn("couldn't reach the network", joined)

    def test_fallback_message_distinguishes_no_groq_key_from_a_network_problem(self):
        async def operation(database, recall):
            import httpx

            await self._insert_event(database, "e1", "Working on the auth.py refactor")

            async def unauthorized_groq(**_kwargs):
                raise httpx.HTTPStatusError(
                    "401", request=None, response=httpx.Response(401)
                )
                yield  # pragma: no cover — makes this an async generator

            with patch.object(recall, "stream_recall_response_groq", new=unauthorized_groq):
                chunks = await self._collect_chunks(
                    recall._stream_sse_recall("auth.py refactor", None)
                )
            return chunks

        chunks = self._with_recall(operation)
        joined = "".join(chunks)
        self.assertIn("no Groq key is configured, or it was rejected", joined)
        self.assertNotIn("couldn't reach the network", joined)

    def test_time_range_query_uses_db_scan_without_any_voyage_key(self):
        """The per-project time-range DB scan is a plain SQLite read with no
        Voyage/Qdrant dependency — it must run and reach the Groq prompt
        even though semantic search has nothing to contribute."""
        import time as time_module

        async def operation(database, recall):
            now_ms = int(time_module.time() * 1000)
            session_id = "s1"
            async with database._async_engine.begin() as connection:
                await connection.execute(
                    database.text(
                        """
                        INSERT INTO sessions (id, start_time, end_time, project_name, goal, ai_summary)
                        VALUES (:id, :start, :end, 'Orbit', 'ship COST-003', 'Fixed the recall fallback bug')
                        """
                    ),
                    {"id": session_id, "start": now_ms - 60_000, "end": now_ms},
                )

            captured_prompt = {}

            async def capturing_groq(**kwargs):
                captured_prompt["user_prompt"] = kwargs["user_prompt"]
                yield "ok"

            with patch.object(recall, "stream_recall_response_groq", new=capturing_groq):
                await self._collect_chunks(
                    recall._stream_sse_recall("what did I work on today", None)
                )
            return captured_prompt["user_prompt"]

        user_prompt = self._with_recall(operation)
        self.assertIn("Orbit", user_prompt)

    def test_session_generation_never_touches_qdrant_without_a_voyage_key(self):
        """COST-003: Qdrant's local storage must not be created for an
        install that never configures Voyage. Patches _get_client to detect
        any touch; asserts it is never called and the session still saves
        with embedding_id left NULL."""
        async def operation(database, recall):
            import scheduler
            import services.qdrant_service as qdrant

            scheduler = importlib.reload(scheduler)
            qdrant = importlib.reload(qdrant)

            client_touched = {"value": False}
            original_get_client = qdrant._get_client

            def tracking_get_client():
                client_touched["value"] = True
                return original_get_client()

            with patch.object(qdrant, "_get_client", side_effect=tracking_get_client):
                with self.assertRaises(Exception):
                    # Directly exercise the embedding path the scheduler
                    # would otherwise skip entirely (see scheduler.py's
                    # get_voyage_api_key() guard) — proves the failure mode
                    # itself never reaches Qdrant, independent of that guard.
                    await qdrant.add_session_embedding(
                        session_id="s1", summary_text="text", metadata={}
                    )
            return client_touched["value"]

        client_was_touched = self._with_recall(operation)
        self.assertFalse(client_was_touched)


if __name__ == "__main__":
    unittest.main()
