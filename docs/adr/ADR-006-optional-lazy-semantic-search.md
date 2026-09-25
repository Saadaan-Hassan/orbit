# ADR-006: Qdrant retained, fully optional and lazy — FTS5 is the real default

## Status

Accepted

## Context

`COST-003` asks Orbit to decide whether local Qdrant (its vector store for
semantic search) is removed entirely or kept behind an explicit,
optional embedding feature, and requires that session creation and recall
never require an embedding request.

By the time this task started, `COST-002` had already made Voyage AI
BYOK-only — no maintainer-funded fallback exists, and `generate_text_embedding()`
already raised immediately (no network call) when no personal key was
configured. But two structural problems remained:

1. **Qdrant was touched unconditionally.** `main.py`'s startup and every
   `scheduler.py` session-generation cycle called
   `initialize_qdrant_collection()` regardless of whether the user had ever
   configured a Voyage key — creating `~/.orbit/qdrant_storage/` and its file
   lock on every install, even one that will never use semantic search.
   `add_session_embedding()`/`search_sessions_semantic()` also called
   `_get_client()` (which lazily creates that same storage) *before*
   attempting the embedding, so the "no key" fast-path still touched Qdrant
   first.
2. **A missing Voyage key broke recall's AI synthesis entirely**, not just
   semantic search. `routes/recall.py` ran the Qdrant semantic-search call
   and the Groq synthesis call inside one `try` block. `generate_text_embedding()`
   raising with no personal key configured — the common, expected state,
   not a transport error — propagated straight past the `except` clause
   (which only caught `httpx.*` exceptions) into a catch-all handler that
   replied with a generic "Sorry, something went wrong" message instead of
   ever calling Groq. A user with a perfectly good Groq key but no Voyage
   key would have lost AI-synthesized recall answers entirely, not just
   semantic search's contribution to them.

## Decision

**Qdrant is retained**, not removed — it adds no cost or privacy exposure
of its own (fully local, no heavyweight ML dependency bundled: no
`fastembed`, `sentence-transformers`, `torch`, or `onnxruntime`; see
`AGENTS.md`'s "Never install" list). The problem was never Qdrant itself,
only the *automatic remote* Voyage call that used to fund and feed it.

It is now **fully lazy**: `add_session_embedding()` and
`search_sessions_semantic()` call `generate_text_embedding()` first and only
reach `initialize_qdrant_collection()`/`_get_client()` after that succeeds.
An install that never configures a personal Voyage key never creates
`~/.orbit/qdrant_storage/` at all. `main.py`'s startup and
`scheduler.py`'s per-cycle run no longer initialise the collection
unconditionally; `scheduler.py` checks `get_voyage_api_key()` before even
attempting an embedding, so a no-key install logs a quiet `debug` line
instead of a `warning` on every 30-minute cycle forever.

**Semantic search and AI synthesis are decoupled in `recall.py`.** Semantic
search now has its own `try`/`except` that soft-fails to an empty list on
`VoyageKeyNotConfiguredError` or any `httpx` transport/status error. The
time-range DB scan (`fetch_sessions_by_time_range()`, pure SQLite, no
Voyage/Qdrant dependency) always runs regardless. Groq synthesis then runs
unconditionally on whatever context resulted — FTS5 keyword matches plus
DB-scan/semantic sessions, however many of those exist, down to zero. Only a
failure in the Groq call itself (no Groq key, Worker down, rate-limited)
falls back to the plain-text FTS5 summary; a missing Voyage key alone no
longer touches that fallback path at all.

No SQLite schema changed, so there is no data migration. The existing
`services.qdrant_service.wipe_all_session_embeddings()` — already wired into
the privacy "Wipe All Memory" route — remains the cleanup path for stored
vectors; no separate route was added, since a user who was never able to
generate embeddings without a Voyage key has nothing stray to clean up.

```text
add_session_embedding() / search_sessions_semantic()
    generate_text_embedding()  ──raises, no Qdrant touch──►  no personal key
        │
        ▼ succeeds (personal key present)
    initialize_qdrant_collection() → _get_client() → upsert/query

recall.py
    search_sessions_semantic()  ──soft-fail──►  semantic_matched_sessions = []
        │                                              │
        ▼ succeeds                                     ▼
    (either path) ──► fetch_sessions_by_time_range() (if time_range, always runs)
        │
        ▼
    stream_recall_response_groq()  ──only this can trigger the plain-FTS5 fallback──►
```

## Consequences

### Positive

- A no-key install never creates Qdrant's local storage — no wasted disk
  I/O, no file lock, nothing to clean up if the user never opts into BYOK.
- Recall's AI-synthesized answers no longer silently degrade to a raw FTS5
  dump just because Voyage isn't configured — only Groq's own availability
  gates that.
- No packaging size change: `qdrant-client` was already a bundled dependency
  and remains one; this task only changed *when* it's touched, not whether
  it ships. Startup is measurably lighter for the common no-key case (one
  fewer disk-touching operation at both app launch and every scheduler
  cycle), though no formal benchmark was run to quantify it.
- Deterministic test coverage now exists for this: `tests/test_offline_recall.py`
  proves Groq still synthesizes an answer with no Voyage key, that full
  offline (`no Groq either`) still yields the friendly fallback and not the
  generic error, that the time-range DB scan runs independent of Voyage, and
  that `add_session_embedding()` never calls `_get_client()` without a key.

### Negative

- Two related but distinct exception-handling paths now exist in
  `recall.py` (semantic search's soft-fail, Groq's hard-fail) rather than
  one unified block — slightly more code to reason about, in exchange for
  materially better degraded-mode behavior.
- A future new Qdrant-touching call site must remember to order the
  embedding attempt before any client access, or it will reintroduce
  unconditional local storage creation for no-key installs.

### Neutral

- `COST-004` (replacing retired models) and any future embedding-quality
  work are unaffected — this task changed control flow and laziness, not
  the embedding model or its dimensions.
