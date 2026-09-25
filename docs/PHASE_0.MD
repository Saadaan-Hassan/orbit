# Phase 0 — Foundation
**Duration:** Week 1–2 | **Status:** 🔴 Not started *(stale — see disclaimer below)*

> **Historical planning doc — written 2026-09-06, before the open-source
> hardening pass.** Phase 0 is complete — the "Not started" status above is
> stale, left as originally written. See `AGENTS.md`'s "Completed phases"
> line and its architecture reference for the current implementation. Kept
> for design-history context, not as a current reference.

---

## Goal

Get every piece of infrastructure connected and running. No features. No UI polish. No search. No AI recall yet. Just the skeleton that everything else builds on.

**Phase 0 is done when:**
You use your computer for 10 minutes, open a SQLite viewer, and see your own clipboard history + active window log written automatically.

---

## What You Are Building

✅ Monorepo scaffold (Tauri + FastAPI + Cloudflare Worker)
✅ Tauri app with no dock icon, menu bar only
✅ FastAPI backend starts alongside Tauri
✅ SQLite database with the `events` table
✅ Clipboard capture → SQLite (Rust)
✅ Active window polling → SQLite (Rust)
✅ Cloudflare Worker deployed and reachable
✅ Claude API call works end-to-end via Worker
✅ Qdrant running locally

## What You Are NOT Building Yet

❌ Chrome Extension
❌ Session generation
❌ AI recall / search
❌ Embeddings or Qdrant population
❌ Any UI beyond a bare Tauri window
❌ Voice
❌ The orb widget

---

## Prerequisites

Run these once before anything else:

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup update stable

# Node + pnpm
# Install Node 20+ first (use nvm or brew)
npm install -g pnpm

# uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Tauri CLI
cargo install tauri-cli --version "^2.0"

# Wrangler (Cloudflare Worker CLI)
pnpm add -g wrangler

# Docker (for Qdrant)
brew install --cask docker
# Then open Docker Desktop and let it start

# Verify everything works
rustc --version
node --version
pnpm --version
uv --version
wrangler --version
docker --version
```

---

## Step 1 — Monorepo Scaffold

Run from wherever you keep your projects:

```bash
mkdir orbit && cd orbit
git init

# Desktop app (Tauri + React + TypeScript)
pnpm create tauri-app@latest app -- --template react-ts --manager pnpm
cd app && pnpm install && cd ..

# FastAPI backend
mkdir backend && cd backend
uv init .
uv add fastapi "uvicorn[standard]" sqlalchemy aiosqlite pydantic python-dotenv httpx
cd ..

# Cloudflare Worker
mkdir -p worker/src
cd worker && npm init -y && npm install wrangler --save-dev && cd ..

# Chrome Extension (scaffold only, built in Phase 1)
mkdir -p extension/src

# Root files
touch AGENTS.md CLAUDE.md .gitignore README.md
ln -sf AGENTS.md CLAUDE.md   # CLAUDE.md is always a symlink

echo "node_modules/\n.env\n*.env\n__pycache__/\n.venv/\ntarget/\n*.db\n~/.orbit/" > .gitignore
```

**Verify:** `ls` should show `app/`, `backend/`, `worker/`, `extension/`, `AGENTS.md`, `CLAUDE.md`.

---

## Step 2 — Tauri: macOS Menu Bar Only

### 2a. Remove dock icon

**Claude Code prompt:**
```
In app/src-tauri/Info.plist, add LSUIElement = true so Orbit never
appears in the dock or Cmd+Tab switcher. If the file doesn't exist,
create it at that path. Follow the conventions in AGENTS.md.
```

The key to add:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
```

### 2b. Configure windows in tauri.conf.json

**Claude Code prompt:**
```
Update app/src-tauri/tauri.conf.json to configure two windows:
1. "main" window: decorations false, transparent true, skipTaskbar true,
   width 380, height 600, visible false, alwaysOnTop false.
2. "overlay" window: decorations false, transparent true, alwaysOnTop true,
   skipTaskbar true, focus false, fullscreen true, visible false.
Also set the app identifier to "com.saadaan.orbit".
Follow conventions in AGENTS.md.
```

### 2c. System tray icon

**Claude Code prompt:**
```
In app/src-tauri/src/main.rs, set up a basic system tray icon using
Tauri v2's SystemTray API. The tray icon should show a simple menu with:
- "Open Orbit" (shows the main window)
- "Quit" (exits the app)
No dock icon because LSUIElement is true. Follow AGENTS.md conventions.
```

**Verify Step 2:** Run `cd app && pnpm tauri dev`
- No dock icon appears
- A tray icon appears in the macOS menu bar
- Clicking it shows the menu

---

## Step 3 — FastAPI Backend Skeleton

### 3a. Project structure

```bash
cd backend
mkdir -p routes services models
touch main.py database.py routes/__init__.py routes/capture.py
touch services/__init__.py models/__init__.py models/event.py
touch .env
```

### 3b. Environment file

```bash
# backend/.env
echo 'WORKER_URL=http://localhost:8787
ORBIT_DB_PATH=orbit.db
QDRANT_URL=http://localhost:6333
PORT=8000' > .env
```

### 3c. Core files

**Claude Code prompt:**
```
Create the following files in the backend/ directory. Use uv for dependencies.
All files must follow the Python conventions in AGENTS.md (type hints everywhere,
async routes, singleton HTTP clients, Pydantic models).

1. models/event.py — Pydantic model for a captured event:
   fields: id (str), timestamp (int, unix ms), type (str), raw_content (str|None),
   app_name (str|None), url (str|None), source (str)

2. database.py — SQLAlchemy async SQLite engine + session factory.
   DB path from env var ORBIT_DB_PATH. Single connection pool.
   Function: create_all_tables() that creates the events table on startup.

3. routes/capture.py — POST /capture endpoint. Accepts an event (Pydantic model),
   writes to SQLite. Returns {"status": "ok", "event_id": id}.

4. main.py — FastAPI app entry. Mounts routes/capture router.
   On startup: calls create_all_tables(). Loads .env with python-dotenv.
   CORS enabled for localhost (Tauri webview needs this).
```

**Verify Step 3:**
```bash
cd backend
uv run uvicorn main:app --reload --port 8000
# Open http://localhost:8000/docs
# You should see the POST /capture endpoint in Swagger UI
```

---

## Step 4 — SQLite Schema

**Claude Code prompt:**
```
In backend/database.py, expand the table definitions to create all Phase 0
tables in SQLite on startup. Use raw SQL via SQLAlchemy's text() for clarity.

Tables to create (if not exists):

events:
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  raw_content TEXT,
  app_name TEXT,
  url TEXT,
  source TEXT NOT NULL

sessions:
  id TEXT PRIMARY KEY,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  project_name TEXT,
  goal TEXT,
  ai_summary TEXT,
  embedding_id TEXT

memory_objects:
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  project TEXT,
  topic TEXT,
  summary TEXT NOT NULL,
  status TEXT,
  key_files TEXT,
  embedding_id TEXT

Follow AGENTS.md conventions.
```

**Verify Step 4:**
```bash
cd backend && uv run uvicorn main:app --port 8000
# Then: sqlite3 orbit.db ".tables"
# Should show: events  sessions  memory_objects
```

---

## Step 5 — Clipboard Capture (Rust)

### 5a. Add dependency

```bash
cd app
# Add to src-tauri/Cargo.toml under [dependencies]:
```

**Claude Code prompt:**
```
In app/src-tauri/Cargo.toml, add these dependencies:
- arboard = "3"
- tokio = { version = "1", features = ["full"] }
- sqlx = { version = "0.7", features = ["runtime-tokio", "sqlite"] }
- reqwest = { version = "0.11", features = ["json"] }
- serde = { version = "1", features = ["derive"] }
- serde_json = "1"
- uuid = { version = "1", features = ["v4"] }
- chrono = "0.4"
```

### 5b. Create capture module

**Claude Code prompt:**
```
In app/src-tauri/src/, create a capture/ module with these files:

capture/mod.rs — declares pub mod clipboard; pub mod window;

capture/clipboard.rs — async function start_clipboard_monitor(db_path: String)
that polls the clipboard every 500ms using arboard.
When the clipboard text content changes from the previous value:
  - generate a UUID for the event id
  - get current unix timestamp in milliseconds
  - write a new row to the SQLite events table:
    id, timestamp, type='clipboard', raw_content=clipboard_text,
    app_name=None, url=None, source='rust'
  - use sqlx with a connection pool (not a new connection each time)
Ignore empty clipboard content. Ignore non-text content (images etc).
Follow AGENTS.md Rust conventions. Variable names must be fully descriptive.
```

**Verify Step 5:**
```bash
cd app && pnpm tauri dev
# Copy some text to clipboard
# Then: sqlite3 ../backend/orbit.db "SELECT * FROM events WHERE type='clipboard';"
# You should see rows appearing
```

---

## Step 6 — Active Window Tracking (Rust)

**Claude Code prompt:**
```
In app/src-tauri/src/capture/window.rs, create an async function
start_window_tracker(db_path: String) that polls the active window
every 30 seconds on macOS.

To get the active app name and window title on macOS, use std::process::Command
to run this AppleScript:
  osascript -e 'tell application "System Events" to get name of first application
  process whose frontmost is true'

And for window title:
  osascript -e 'tell application "System Events" to get title of front window
  of (first application process whose frontmost is true)'

When the active window title changes from the previous value:
  - write a new event to SQLite events table:
    type='window', raw_content=window_title, app_name=app_name,
    url=None, source='rust'
  - reuse the same sqlx connection pool as clipboard.rs

If the osascript command fails (window has no title, permission denied),
log the error and continue polling without crashing.
Follow AGENTS.md conventions.
```

**Verify Step 6:**
```bash
# Switch between apps (VS Code, Browser, Terminal)
# sqlite3 ../backend/orbit.db "SELECT app_name, raw_content, timestamp FROM events WHERE type='window' ORDER BY timestamp DESC LIMIT 10;"
# You should see your app switches logged
```

---

## Step 7 — Cloudflare Worker (API Proxy)

### 7a. Worker code

**Claude Code prompt:**
```
Create worker/src/index.ts — a Cloudflare Worker with three routes:

POST /chat
  Forwards the request body to https://api.anthropic.com/v1/messages
  Adds headers: x-api-key: ANTHROPIC_API_KEY (from env secret),
  anthropic-version: "2023-06-01", content-type: application/json
  Supports SSE streaming — pipe the response stream directly back.
  Returns the upstream response with CORS headers for localhost.

POST /tts (stub for now)
  Returns 501 Not Implemented with JSON {"error": "TTS not yet enabled"}

POST /stt-token (stub for now)
  Returns 501 Not Implemented with JSON {"error": "STT not yet enabled"}

All routes: add CORS headers to allow requests from any origin (Tauri webview
does not have a standard browser origin).

Secrets available in env: ANTHROPIC_API_KEY
Use TypeScript. Follow AGENTS.md conventions.
```

### 7b. Wrangler config

```bash
# worker/wrangler.toml
cat > worker/wrangler.toml << 'EOF'
name = "orbit-api-proxy"
main = "src/index.ts"
compatibility_date = "2024-01-01"
EOF
```

### 7c. Deploy

```bash
cd worker

# Local dev first (create .dev.vars — never commit this file)
echo 'ANTHROPIC_API_KEY=your_key_here' > .dev.vars
echo '.dev.vars' >> ../.gitignore

npx wrangler dev   # starts on http://localhost:8787

# Test it:
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":100,"messages":[{"role":"user","content":"Say hello in one word."}]}'

# When ready to deploy for real:
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

**Verify Step 7:** The curl command above returns a Claude response. That's your end-to-end AI pipeline working.

---

## Step 8 — Qdrant Setup

```bash
# Start Qdrant (leave this running in a separate terminal)
docker run -p 6333:6333 -p 6334:6334 \
  -v $(pwd)/qdrant_storage:/qdrant/storage \
  qdrant/qdrant

# Verify it's running:
curl http://localhost:6333/collections
# Should return: {"result":{"collections":[]},"status":"ok","time":...}
```

No Orbit code touches Qdrant yet in Phase 0. Just confirm it starts and responds. It will be populated in Phase 1 when embeddings are added.

---

## Step 9 — Wire Tauri + FastAPI Together

Tauri needs to start FastAPI automatically in development so you don't manually run two processes.

**Claude Code prompt:**
```
In app/src-tauri/src/main.rs, before the Tauri app builder runs:
1. Start the FastAPI backend as a child process using std::process::Command:
   Command: ["uv", "run", "uvicorn", "main:app", "--port", "8000"]
   Working directory: ../backend (relative to the Tauri app root)
   Stdout and stderr: inherit (so logs appear in terminal)
2. Store the child process handle so it can be killed when the app quits.
3. Wait 2 seconds after spawning before starting Tauri, to give FastAPI time to start.
4. On app exit (using tauri's on_window_event or setup hook), kill the FastAPI child process.

Also: spawn the clipboard monitor and window tracker as tokio tasks in the
Tauri setup hook, passing the SQLite DB path (same path FastAPI uses).

The DB path should be: ~/.orbit/orbit.db (create the directory if it doesn't exist).

Follow AGENTS.md conventions. All variable names must be fully descriptive.
```

**Verify Step 9:**
```bash
cd app && pnpm tauri dev
# In a separate terminal:
curl http://localhost:8000/docs
# FastAPI should be running automatically — you didn't start it manually.
# Use your computer for 5 minutes, then:
sqlite3 ~/.orbit/orbit.db "SELECT type, app_name, substr(raw_content,1,50), datetime(timestamp/1000,'unixepoch') FROM events ORDER BY timestamp DESC LIMIT 20;"
```

---

## Phase 0 Done Checklist

Before moving to Phase 1, verify every item:

- [ ] `pnpm tauri dev` starts the app with no dock icon
- [ ] Menu bar tray icon appears with Open/Quit menu
- [ ] FastAPI starts automatically at localhost:8000
- [ ] `http://localhost:8000/docs` loads the Swagger UI
- [ ] Clipboard events appear in `~/.orbit/orbit.db` when you copy text
- [ ] Window events appear in DB when you switch apps
- [ ] `curl` to Cloudflare Worker `/chat` returns a Claude response
- [ ] Qdrant responds at `http://localhost:6333/collections`
- [ ] All three SQLite tables exist: events, sessions, memory_objects
- [ ] No API keys exist anywhere in the codebase (only in `.dev.vars` and Cloudflare secrets)

---

## Commit Checkpoint

When all items above are checked:

```bash
cd orbit
git add .
git commit -m "Phase 0 complete: Tauri + FastAPI + SQLite capture + Cloudflare Worker"
```

---

## What's Next — Phase 1 Preview

Phase 1 adds:
- Chrome Extension → sends browser URLs to FastAPI
- Gemini Flash classifies every captured event
- Session generator (every 30 min) → Claude → session summary stored
- Tantivy keyword index built from events
- Qdrant populated with embeddings
- **One search box** — natural language → answer from your own activity

Phase 1 produces the demo video. Phase 0 produces nothing visible — just the invisible foundation that makes the demo possible.

---
*Phase 0 of 6 — Orbit by Saadaan Hassan 🪐*