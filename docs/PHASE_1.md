# Phase 1 — v0.1: The Magic Moment
**Duration:** Week 3–4 | **Prerequisite:** Phase 0 complete and verified

---

## Goal

One screen recording. Someone watches it and says "I want this."

User types: `"what was I working on before lunch yesterday?"`
Orbit responds with a structured, accurate answer pulled from their own activity.

**Phase 1 is done when that experience feels magical.**
If it doesn't → fix recall quality. Don't move to Phase 2 until it does.

---

## What You're Building

✅ Chrome Extension → sends browser URLs + page titles to FastAPI
✅ Gemini Flash classifies every captured event (work / research / personal / system)
✅ SQLite FTS5 virtual table for keyword search
✅ Qdrant local mode for semantic search (no Docker)
✅ Embedding pipeline — session summaries → Qdrant
✅ Session generator (APScheduler, every 30 min) → Claude → session summary
✅ POST /recall — parallel FTS5 + Qdrant → Claude → structured answer
✅ Minimal React UI: timeline + search box

## What You're NOT Building

❌ Voice
❌ Orb animations
❌ Privacy controls (Phase 2)
❌ Landing page (Phase 2)
❌ Memory Objects / Tier 3 (Phase 3)
❌ Any UI polish

---

## Updated Stack for Phase 1

| What changed | Old | New | Why |
|---|---|---|---|
| Keyword search | Tantivy (Rust) | SQLite FTS5 | Already in the DB, zero deps, BM25 built-in |
| Qdrant setup | Docker server | Local file mode | `QdrantClient(path=...)` — no Docker needed |
| Gemini model | `gemini-2.0-flash` | `gemini-3.1-flash-lite` | 2.0 Flash shut down June 2026 |

---

## Step 1 — Update Backend Dependencies

```
We are starting Phase 1. Update backend dependencies using uv.

Run these commands in the backend/ directory:

uv add qdrant-client
uv add google-genai

Do NOT install apscheduler v4 — it is explicitly pre-release and unstable.
Do NOT install qdrant-client[fastembed], sentence-transformers, torch,
or onnxruntime — none of these have Intel Mac wheels on macOS 26.
Embeddings are handled by Voyage AI via httpx (already installed).
Scheduling is handled by a plain asyncio background loop — no scheduler library needed.

After adding, show me the updated pyproject.toml [dependencies] section.
Do not write any code yet — just add dependencies.
```

**Why plain `qdrant-client`:** The `[fastembed]` extra requires `onnxruntime` which has no Intel Mac wheel on macOS 26. Plain `qdrant-client` is just an HTTP/gRPC client — no ML deps. Voyage AI handles embedding via HTTP.

**Why no APScheduler:** v4 is pre-release and unstable. v3 works but is unnecessary — a plain `asyncio` background loop is simpler and has zero dependencies for one recurring task.

**Get a Voyage AI API key:** https://dash.voyageai.com → free tier, 200M tokens/month.
Add to `backend/.env`: `VOYAGE_API_KEY=your_key_here`

**✅ Verify:**
```bash
cd backend && uv sync
uv run python -c "from qdrant_client import QdrantClient; print('qdrant ok')"
uv run python -c "import google.generativeai; print('gemini ok')"
```

---

## Step 2 — SQLite FTS5 Virtual Table

```
We are on Phase 1, Step 2: Add SQLite FTS5 full-text search.

Update backend/database.py. In the create_all_tables() function, after creating
the events table, also create an FTS5 virtual table and a trigger to keep it
in sync automatically.

Add this after the events table creation:

1. FTS5 virtual table:
   CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
   USING fts5(
     raw_content,
     app_name,
     url,
     content='events',
     content_rowid='rowid',
     tokenize='porter unicode61'
   )
   
   Use porter tokenizer so "debugging" matches "debug", "worked" matches "work".

2. Triggers to keep FTS5 in sync with the events table:
   - AFTER INSERT on events: INSERT into events_fts
   - AFTER UPDATE on events: UPDATE events_fts
   - AFTER DELETE on events: DELETE from events_fts

3. Also add a function search_events_fts(query: str, limit: int = 20) that:
   - Takes a natural language query string
   - Sanitizes it for FTS5 (remove special chars that break FTS5 syntax)
   - Runs: SELECT e.* FROM events e JOIN events_fts fts ON e.rowid = fts.rowid
     WHERE events_fts MATCH ? ORDER BY rank LIMIT ?
   - Returns a list of event dicts with all columns

Do not change anything else in database.py. Follow AGENTS.md conventions.
Show me only the new/changed sections of database.py.
```

**✅ Verify:**
```bash
cd backend && uv run uvicorn main:app --port 8000
sqlite3 ~/.orbit/orbit.db ".tables"
# Should now include: events  events_fts  memory_objects  sessions

# Test FTS5 with existing data:
sqlite3 ~/.orbit/orbit.db \
  "SELECT raw_content FROM events_fts WHERE events_fts MATCH 'code' LIMIT 5;"
```

---

## Step 3 — Qdrant Local Mode Setup

```
We are on Phase 1, Step 3: Qdrant local mode + Voyage AI embeddings.

Create two files:

--- FILE 1: backend/services/voyage_service.py ---

Use the existing singleton httpx.AsyncClient (import get_http_client from
claude_service.py or create one here following the same singleton pattern).
Read VOYAGE_API_KEY from env via python-dotenv.

Create one async function:

generate_text_embedding(text_to_embed: str) -> list[float]
  POST to https://api.voyageai.com/v1/embeddings
  Headers: Authorization: Bearer {VOYAGE_API_KEY}
  Body: {"input": [text_to_embed], "model": "voyage-3-lite", "input_type": "document"}
  Returns: response["data"][0]["embedding"]  — a list of 512 floats
  On HTTP error: log with print(), raise the error

--- FILE 2: backend/services/qdrant_service.py ---

Use Qdrant local file mode — no Docker, no fastembed, no onnxruntime.
Initialize ONE QdrantClient at module level (singleton):
  QdrantClient(path=str(Path.home() / ".orbit" / "qdrant_storage"))

Collection name: "orbit_sessions"
Vector size: 512 (voyage-3-lite output dimension)
Distance: Cosine

Create these async functions (wrap all sync QdrantClient calls in asyncio.to_thread):

1. initialize_qdrant_collection()
   If "orbit_sessions" collection does not exist, create it:
     VectorParams(size=512, distance=Distance.COSINE)

2. add_session_embedding(session_id: str, summary_text: str, metadata: dict)
   Call generate_text_embedding(summary_text) to get the 512-dim vector.
   Convert session_id to a stable integer point ID: abs(hash(session_id)) % (10**9)
   Upsert to Qdrant:
     PointStruct(id=point_id, vector=embedding_vector, payload={**metadata, "session_id": session_id})

3. search_sessions_semantic(query_text: str, result_limit: int = 10) -> list[dict]
   Call generate_text_embedding(query_text) to get the query vector.
   Search the collection with that vector, limit=result_limit, score_threshold=0.3.
   Return list of hit.payload dicts for results above the threshold.

Follow all AGENTS.md conventions. Descriptive variable names throughout.
Show me both complete files.
```

**✅ Verify:**
```bash
uv run python -c "
from services.qdrant_service import initialize_qdrant_collection
import asyncio
asyncio.run(initialize_qdrant_collection())
print('Qdrant collection created at ~/.orbit/qdrant_storage')
"
ls ~/.orbit/qdrant_storage/
# Should show collection files
```

---

## Step 4 — Gemini Flash Event Classifier

```
We are on Phase 1, Step 4: Gemini event classification service.

Create backend/services/gemini_service.py.

Use google-generativeai with model "gemini-3.1-flash-lite".
Read the API key from env var GEMINI_API_KEY (loaded via python-dotenv).

Initialize ONE genai client at module level (singleton). Never instantiate per call.

Create one async function:

classify_events_batch(events: list[dict]) -> list[dict]

  Takes a list of raw event dicts (from SQLite).
  Sends them ALL in a single Gemini API call (not one call per event — too expensive).

  System prompt:
    "You are classifying user activity events from a desktop app.
     Classify each event into exactly one category:
     work, research, personal, system, communication
     
     Return ONLY a JSON array. No explanation. No markdown. No preamble.
     Each item: {"id": "<event_id>", "category": "<category>", "project": "<project_name_or_null>"}"

  User prompt: JSON dump of the events list (id, type, raw_content, app_name, url only)

  Parse the JSON response. If parsing fails, default all events to category "work".
  Return the original events list with "category" and "project" fields added.

  Handle rate limit errors with exponential backoff (max 3 retries).

Add GEMINI_API_KEY to the backend/.env template comment.
Follow AGENTS.md conventions. Descriptive variable names throughout.
```

**✅ Verify:**
```bash
# Add your Gemini API key to backend/.env:
# GEMINI_API_KEY=your_key_here

uv run python -c "
from services.gemini_service import classify_events_batch
import asyncio
test_events = [
    {'id': 'test-1', 'type': 'url', 'raw_content': 'FastAPI docs', 'app_name': 'Chrome', 'url': 'fastapi.tiangolo.com'},
    {'id': 'test-2', 'type': 'clipboard', 'raw_content': 'def main(): pass', 'app_name': 'VS Code', 'url': None},
]
result = asyncio.run(classify_events_batch(test_events))
print(result)
# Should show events with category + project added
"
```

---

## Step 5 — Session Generator (APScheduler)

```
We are on Phase 1, Step 5: Automatic session generation every 30 minutes.

Create backend/scheduler.py using APScheduler v3.

The scheduler runs one job every 30 minutes: generate_sessions_from_recent_events()

This function does the following in order:

1. Fetch all events from the last 60 minutes that have NOT been assigned to a session
   (add a "session_id" column to events table if it doesn't exist — use ALTER TABLE IF NOT EXISTS pattern)

2. If fewer than 5 events: skip this run (not enough data for a useful session)

3. Send events to classify_events_batch() from gemini_service.py
   Update each event's category in SQLite.

4. Build a prompt for Claude (sent via the Cloudflare Worker):
   
   System: "You are summarizing a user's work session from their captured activity.
   Be concise and specific. Output valid JSON only. No markdown, no preamble."
   
   User: "Here are the user's captured activities for the last 30-60 minutes:
   <events_json>
   
   Respond with this exact JSON structure:
   {
     'project_name': 'detected project name or null',
     'goal': 'one sentence: what the user was trying to accomplish',
     'summary': '2-3 sentences describing what happened',
     'key_resources': ['list of important URLs or files mentioned'],
     'last_action': 'the most recent meaningful thing the user did'
   }"

5. Parse Claude's JSON response. Store as a new row in the sessions table:
   id=uuid, start_time=earliest_event_timestamp, end_time=latest_event_timestamp,
   project_name, goal, ai_summary=summary

6. Call add_session_embedding() with the session_id and the full summary text

7. Mark all processed events as belonging to this session (update session_id column)

In backend/main.py, start the scheduler in the lifespan context manager
(not startup/shutdown events — those are deprecated).
Use the modern FastAPI lifespan pattern with @asynccontextmanager.

Use WORKER_URL from env for Claude calls. POST to {WORKER_URL}/chat.
Use the singleton httpx client from claude_service.py (create that service if it doesn't exist).
Follow all AGENTS.md conventions.
```

**✅ Verify:**
```bash
uv run uvicorn main:app --port 8000
# Wait 2 minutes, copy some text, switch apps, browse a URL
# Then force a run:
uv run python -c "
from scheduler import generate_sessions_from_recent_events
import asyncio
asyncio.run(generate_sessions_from_recent_events())
"
sqlite3 ~/.orbit/orbit.db \
  "SELECT project_name, goal, substr(ai_summary,1,100) FROM sessions ORDER BY start_time DESC LIMIT 3;"
# Should show a generated session with project + summary
```

---

## Step 6 — Recall Endpoint

```
We are on Phase 1, Step 6: The recall endpoint — the core of the product.

Create backend/routes/recall.py.

POST /recall accepts:
  {"query": "what was I working on before lunch yesterday?"}

Returns a streaming response (Server-Sent Events).

The function does this in parallel using asyncio.gather():

  Task A: FTS5 keyword search
    Call search_events_fts(query, limit=15) from database.py
    Returns: list of raw event dicts

  Task B: Qdrant semantic search
    Call search_sessions_semantic(query, limit=8) from qdrant_service.py
    Returns: list of session payloads with similarity scores

After both complete:

  Merge and format results into a context block:

  "RECENT ACTIVITY (keyword matches):
   <format each event as: [timestamp] app_name: raw_content>

   SESSION SUMMARIES (semantic matches):
   <format each session as: [date/time] Project: X | Goal: Y | Summary: Z>"

  Send to Claude via Cloudflare Worker with this system prompt:
  
  "You are Orbit, an AI memory companion.
   You have access to summaries of the user's recent computer activity.
   Answer their question directly and specifically, like a colleague who
   was watching their screen.
   
   Format your response as:
   📌 [Time period] — [App or context]
   
   [What they were doing, specifically]
   
   You had open:
   → [resource 1]
   → [resource 2]
   
   Last action: [most recent relevant thing]
   
   Be specific. Use exact file names, URLs, and project names from the context.
   If the context doesn't answer the question, say so honestly."

Stream Claude's response back as SSE chunks.
Each chunk: data: {"chunk": "<text>"}\n\n
Final chunk: data: {"done": true}\n\n

Mount the recall router in main.py.
Follow all AGENTS.md conventions.
```

**✅ Verify:**
```bash
# Use your computer for 30+ minutes first, then trigger a session generation
# Then test recall:
curl -X POST http://localhost:8000/recall \
  -H "Content-Type: application/json" \
  -d '{"query": "what was I just working on?"}' \
  --no-buffer
# Should stream back a structured response about your actual activity
```

---

## Step 7 — Chrome Extension

```
We are on Phase 1, Step 7: Chrome Extension for browser activity capture.

Create the Chrome Extension in extension/ using TypeScript + Vite.

First, set up the build:
  cd extension
  npm init -y
  npm install -D typescript vite @crxjs/vite-plugin @types/chrome

Create these files:

extension/manifest.json:
{
  "manifest_version": 3,
  "name": "Orbit",
  "version": "0.1.0",
  "description": "Orbit browser activity capture",
  "permissions": ["tabs", "activeTab", "storage"],
  "background": {
    "service_worker": "src/background.ts",
    "type": "module"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["src/content.ts"]
  }]
}

extension/src/background.ts — the service worker:

CRITICAL MV3 RULE: Service workers terminate when idle. Never store state
in global variables. Use chrome.storage.session for all state.

The service worker listens for:

1. chrome.tabs.onActivated — fires when the user switches tabs
2. chrome.tabs.onUpdated — fires when a tab URL changes (filter: status === 'complete')

On each event:
  - Get the tab's URL and title
  - Read lastSentUrl from chrome.storage.session
  - If URL is the same as lastSentUrl: skip (no duplicate sends)
  - If URL starts with chrome://, about:, or is empty: skip
  - POST to http://localhost:8000/capture with body:
    {
      "id": crypto.randomUUID(),
      "timestamp": Date.now(),
      "type": "url",
      "raw_content": tab.title,
      "app_name": "Chrome",
      "url": tab.url,
      "source": "extension"
    }
  - On success: save URL to chrome.storage.session as lastSentUrl
  - On failure (Orbit not running): fail silently, no error shown to user

extension/src/content.ts — minimal stub for now:
  // Phase 2: selected text capture will go here
  export {}

extension/vite.config.ts — configure @crxjs/vite-plugin to build the extension.

Add build script to package.json: "build": "vite build"

Show me all files. Follow AGENTS.md conventions.
```

**Build and load the extension:**
```bash
cd extension && npm run build
# Open Chrome → chrome://extensions → Developer mode ON
# Click "Load unpacked" → select extension/dist/
```

**✅ Verify:**
```bash
# Browse to 3-4 different websites
sqlite3 ~/.orbit/orbit.db \
  "SELECT url, raw_content, datetime(timestamp/1000,'unixepoch','localtime') FROM events WHERE type='url' ORDER BY timestamp DESC LIMIT 10;"
# Your browser history appears as rows
```

---

## Step 8 — Minimal React UI

```
We are on Phase 1, Step 8: Minimal React UI — timeline + search box.

This is the only UI for Phase 1. No design polish. No animations. 
Functional only. We just need to see that recall works.

Update app/src/App.tsx to render two sections:

1. ActivityTimeline component:
   - On mount, fetches GET http://localhost:8000/events?limit=50
     (add this endpoint to backend/routes/capture.py — returns latest 50 events)
   - Renders a scrollable list of events
   - Each event: timestamp (formatted as "Today 2:34 PM"), app_name, 
     type icon (📋 clipboard, 🌐 url, 🪟 window), truncated raw_content
   - Refreshes every 60 seconds
   - Plain div list, Tailwind for basic spacing only

2. RecallSearch component:
   - A text input and "Ask Orbit" button
   - On submit: POST to http://localhost:8000/recall with the query
   - Reads the SSE stream and appends chunks to a response string as they arrive
   - Displays the streaming response below the input
   - Shows "Thinking..." while waiting for the first chunk
   - Clears previous response when a new query is submitted

No ShadCN yet. No Framer Motion. No Zustand. 
Plain React state (useState, useEffect) only for this step.
Tailwind only for minimal spacing and font sizes.

Add GET /events endpoint to backend/routes/capture.py that returns the
latest N events ordered by timestamp DESC.

Show me App.tsx, ActivityTimeline.tsx, RecallSearch.tsx, and the updated capture.py.
```

**✅ The Magic Moment Test:**
```bash
cd app && pnpm tauri dev
# Use your computer for 30-60 minutes normally
# Come back to Orbit and type: "what was I just working on?"
# If the response is accurate and specific → you have a product
# Record a screen capture of this moment → this is your first LinkedIn post
```

---

## Phase 1 Done Checklist

- [ ] Chrome Extension installed and sending URLs to FastAPI
- [ ] Events being classified (category field populated in SQLite)
- [ ] Sessions generating every 30 min (check sessions table)
- [ ] Session embeddings stored in Qdrant (`~/.orbit/qdrant_storage/` exists and has files)
- [ ] FTS5 virtual table exists (`events_fts` in `.tables`)
- [ ] POST /recall returns a structured, accurate response
- [ ] React UI shows the activity timeline
- [ ] React UI streams a real recall response
- [ ] **THE TEST:** Ask "what was I working on before lunch?" and the answer is genuinely useful

---

## Commit Checkpoint

```bash
git add .
git commit -m "Phase 1 complete: browser capture, session gen, FTS5 + Qdrant recall, minimal UI"
```

---

## What's Next — Phase 2 Preview

Phase 2 adds the things that make Orbit ready for real beta users:

**🔒 Security (must ship before any beta user touches the app):**
- Clipboard redaction in Rust — sensitive patterns replaced with `[REDACTED:<type>]` before DB write
- AI context sanitisation — clipboard `raw_content` stripped from Gemini/Claude payloads
- App exclude list UI (password managers, banking apps)
- Pause capture button
- Full memory wipe

**🌐 Beta readiness:**
- Memory viewer (see and delete exactly what's stored)
- Landing page with waitlist
- macOS `.dmg` installer
- 5 beta testers from your LinkedIn network

Phase 2 does NOT add voice or the orb. That's Phase 4 — still earned.

---
*Phase 1 of 6 — Orbit by Saadaan Hassan 🪐*