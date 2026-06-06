# Orbit — Agent Instructions

<!-- Single source of truth for all AI coding agents. -->
<!-- CLAUDE.md must be a symlink to this file. Run: ln -s AGENTS.md CLAUDE.md -->
<!-- Supported by: Claude Code, Cursor, Copilot, Gemini CLI -->

## Overview

Orbit is a macOS-first AI memory companion. It runs silently in the background, passively capturing digital activity (active apps, browser tabs, clipboard, file events), and lets the user recall any of it through natural language — via text or voice — through a floating orb companion widget.

**Core promise:** "I help you continue." — not a second brain to maintain, but a memory that works automatically.

**Platform:** macOS 13+ (Ventura) first. Windows support later — Tauri makes this viable without a rewrite.

**App behaviour:** No dock icon. No Cmd+Tab entry. Lives in the macOS menu bar only (`LSUIElement = true`).

---

## Architecture

Five layers. Each has a clear owner.

```
┌──────────────────────────────────────┐
│       UI / Companion Layer            │  React + Tauri window system
├──────────────────────────────────────┤
│       AI Reasoning Layer              │  Claude Sonnet 4 + Gemini Flash
├──────────────────────────────────────┤
│       Memory Layer                    │  Raw Events → Sessions → Memory Objects
├──────────────────────────────────────┤
│       Activity Collection Layer       │  Rust (OS-level) + Chrome Extension
├──────────────────────────────────────┤
│       Local Storage Layer             │  SQLite + Tantivy + Qdrant
└──────────────────────────────────────┘
```

**Components and their roles:**

| Component | Location | Role |
|---|---|---|
| Desktop app | `app/` | Tauri v2: React UI + Rust native capture |
| AI backend | `backend/` | FastAPI: embeddings, session gen, recall queries |
| Browser capture | `extension/` | Chrome Extension MV3: URL, title, selected text |
| API proxy | `worker/` | Cloudflare Worker: holds all API keys, proxies Claude + ElevenLabs |
| Marketing site | `landing/` | Next.js: waitlist + demo |

**Data flow:**

```
[Rust capture layer]  ──►  [SQLite: raw events]
[Chrome Extension]    ──►  [FastAPI /capture endpoint]
                                    │
                              [every 30 min]
                                    │
                                    ▼
                     [Gemini Flash: classify + tag events]
                                    │
                                    ▼
                     [Claude: generate Session summary]
                                    │
                                    ▼
                     [Qdrant: store embedding of session]
                                    │
                           [on user query]
                                    │
                                    ▼
              [Tantivy keyword search + Qdrant semantic search]
                                    │
                                    ▼
                     [Claude: synthesise answer from results]
                                    │
                                    ▼
                          [React: render in chat panel]
                    [Optional: Kokoro TTS speaks the response]
```

---

## Monorepo Structure

```
orbit/
├── AGENTS.md                    ← you are here
├── CLAUDE.md                    ← symlink to AGENTS.md
├── app/                         ← Tauri v2 desktop app
│   ├── src/                     ← React + TypeScript frontend
│   │   ├── components/
│   │   │   ├── OrbWidget.tsx    ← floating companion orb
│   │   │   ├── ChatPanel.tsx    ← text query + response UI
│   │   │   ├── Timeline.tsx     ← scrollable activity timeline
│   │   │   └── MemoryViewer.tsx ← view + delete stored memories
│   │   ├── store/               ← Zustand global state
│   │   │   └── orbitStore.ts
│   │   ├── hooks/               ← custom React hooks
│   │   ├── types/               ← shared TypeScript types
│   │   └── main.tsx
│   └── src-tauri/               ← Rust backend
│       ├── src/
│       │   ├── main.rs          ← Tauri app entry point
│       │   ├── capture/
│       │   │   ├── mod.rs
│       │   │   ├── clipboard.rs ← clipboard monitoring (arboard)
│       │   │   ├── window.rs    ← active window tracking
│       │   │   └── screenshot.rs← periodic screenshots (xcap)
│       │   ├── hotkey.rs        ← global hotkey listener (global-hotkey)
│       │   ├── db.rs            ← SQLite connection + queries (sqlx)
│       │   └── commands.rs      ← Tauri IPC commands exposed to React
│       ├── Cargo.toml
│       ├── tauri.conf.json
│       └── Info.plist           ← LSUIElement = true lives here
├── backend/                     ← FastAPI AI processing server
│   ├── main.py                  ← app entry, scheduler setup
│   ├── routes/
│   │   ├── capture.py           ← POST /capture (from extension + Rust)
│   │   ├── recall.py            ← POST /recall (user queries)
│   │   └── session.py           ← GET /sessions, session management
│   ├── services/
│   │   ├── claude_service.py    ← Claude API via Cloudflare Worker
│   │   ├── gemini_service.py    ← Gemini Flash classification
│   │   ├── embedding_service.py ← sentence-transformers local embeddings
│   │   └── qdrant_service.py    ← Qdrant vector store operations
│   ├── models/
│   │   ├── event.py             ← Pydantic: raw event schema
│   │   ├── session.py           ← Pydantic: session schema
│   │   └── memory_object.py     ← Pydantic: long-term memory schema
│   ├── database.py              ← SQLite connection (SQLAlchemy async)
│   ├── scheduler.py             ← APScheduler: session gen every 30 min
│   └── requirements.txt
├── extension/                   ← Chrome Extension
│   ├── manifest.json            ← Manifest V3
│   ├── background.ts            ← service worker: tab events → POST /capture
│   └── content.ts               ← page content: selected text, reading time
├── worker/                      ← Cloudflare Worker API proxy
│   ├── src/
│   │   └── index.ts             ← 3 proxy routes: /chat, /tts, /stt-token
│   └── wrangler.toml
└── landing/                     ← Next.js marketing site
    └── ...
```

---

## Key Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/main.rs` | Tauri app entry. Sets up system tray, window config, starts FastAPI backend subprocess, registers Tauri commands. No dock icon — sets `activation_policy` to `Accessory`. |
| `app/src-tauri/src/capture/clipboard.rs` | Monitors clipboard using `arboard`. Fires on every clipboard change. Posts event to SQLite and notifies FastAPI. |
| `app/src-tauri/src/capture/window.rs` | Polls active window title + app name every 30 seconds using macOS Accessibility API. Posts to SQLite. |
| `app/src-tauri/src/capture/screenshot.rs` | Takes a compressed screenshot every 3 minutes using `xcap`. Saves to `~/.orbit/screenshots/`. Posts metadata event to SQLite. |
| `app/src-tauri/src/hotkey.rs` | Registers global push-to-talk hotkey using `global-hotkey` crate. Modifier-key shortcuts require this over AppKit monitors. On press, signals React to begin voice input. |
| `app/src-tauri/src/db.rs` | SQLite connection pool via `sqlx`. All DB reads/writes go through here. Never create new connections per request — reuse the pool. |
| `app/src-tauri/src/commands.rs` | All `#[tauri::command]` functions exposed to React via `invoke()`. Keep commands thin — they delegate to the relevant Rust module. |
| `app/src-tauri/Info.plist` | `LSUIElement = true` lives here. Also app permissions declarations (Microphone, Accessibility). Do not remove `LSUIElement`. |
| `app/src-tauri/tauri.conf.json` | Window configurations. Overlay window must be: `transparent: true`, `decorations: false`, `alwaysOnTop: true`, `skipTaskbar: true`, `focus: false`. |
| `app/src/components/OrbWidget.tsx` | The floating companion orb. Renders in the always-on-top overlay window. Has idle / listening / thinking / speaking animation states via Framer Motion. Parses `[POINT:x,y:label]` tags from Claude responses and moves the orb to that screen position via a bezier arc animation. |
| `app/src/components/ChatPanel.tsx` | Chat interface. Sends queries to `POST /recall` on FastAPI. Renders streamed Claude response. Handles both text input and transcribed voice input. |
| `app/src/components/Timeline.tsx` | Scrollable chronological activity log. Reads from SQLite via Tauri command. Groups events by session. |
| `app/src/components/MemoryViewer.tsx` | Shows all stored data. Lets user delete individual events, sessions, or all memory. Privacy-critical component. |
| `app/src/store/orbitStore.ts` | Zustand global state: capture status, active session, orb state, voice state, chat history. |
| `backend/main.py` | FastAPI app entry. Mounts all routers. Starts APScheduler for session generation. Initialises SQLite and Qdrant connections on startup. |
| `backend/routes/capture.py` | `POST /capture` — receives events from Chrome Extension and Rust layer. Validates with Pydantic, writes to SQLite, queues for embedding. |
| `backend/routes/recall.py` | `POST /recall` — handles user queries. Runs parallel Tantivy keyword search + Qdrant semantic search, merges results, sends to Claude via Cloudflare Worker, streams response back. |
| `backend/services/claude_service.py` | All Claude API calls go through here. Uses `httpx.AsyncClient` as a singleton — never instantiate per request. Calls Cloudflare Worker `/chat` route. Handles SSE streaming. |
| `backend/services/gemini_service.py` | Gemini Flash calls for cheap classification tasks: event type tagging, project detection, goal inference. Never use Claude for tasks Gemini Flash can do — cost matters. |
| `backend/services/embedding_service.py` | Generates embeddings using `sentence-transformers` locally. Model: `all-MiniLM-L6-v2` for MVP. No external API calls. |
| `backend/services/qdrant_service.py` | Qdrant client singleton. Stores and queries session/memory embeddings. Never instantiate per request. |
| `backend/scheduler.py` | APScheduler job runs every 30 minutes. Fetches unprocessed raw events from SQLite, sends to Gemini Flash for tagging, then Claude for session summary generation, stores result as Tier 2 session. |
| `backend/database.py` | SQLAlchemy async engine + session factory for SQLite. Single connection pool shared across the app. |
| `extension/background.ts` | Service worker. Listens for tab URL changes, page title updates. POSTs to `http://localhost:PORT/capture`. Handles cases where Orbit backend is not running. |
| `worker/src/index.ts` | Cloudflare Worker. Three proxy routes. API keys exist only as Cloudflare Worker secrets — never in app code, never in git. |

---

## How Core Systems Work

### Activity Capture Pipeline

Three capture sources run in parallel:

**1. Rust layer (OS-level):**
- Clipboard: `arboard` crate fires on every clipboard change
- Active window: polling loop every 30s via macOS Accessibility API
- Screenshots: `xcap` crate every 3 minutes, JPEG compressed, saved locally
- All events posted to SQLite directly from Rust, then a notification sent to FastAPI via HTTP

**2. Chrome Extension:**
- Fires on tab URL change, captures: URL, page title, selected text, reading time
- POSTs to FastAPI `POST /capture` on localhost
- Fails silently if Orbit is not running (no user-facing errors)

**3. FastAPI `/capture` endpoint:**
- Receives events from extension and Rust
- Validates schema, writes to SQLite `events` table
- Adds to an in-memory queue for embedding generation

### Memory Generation Pipeline (runs every 30 min via APScheduler)

```
1. Fetch all raw events from last 30 min (SQLite)
2. Send to Gemini Flash → classify each event (work/research/personal/system)
                        → detect project name
                        → infer likely goal
3. Send classified batch to Claude → generate Session summary (Tier 2)
4. Store session in SQLite `sessions` table
5. Generate embedding of session summary (sentence-transformers)
6. Store embedding in Qdrant with metadata
7. Periodically (every 24h): extract Memory Objects (Tier 3) from sessions
```

### Recall Pipeline (on user query)

```
User types/speaks: "what was I working on before lunch yesterday?"
                              │
                    [FastAPI POST /recall]
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
    Tantivy keyword search          Qdrant semantic search
    (exact terms, fast)             (meaning-based, slower)
              │                                │
              └───────────────┬────────────────┘
                              ▼
                   Merge + deduplicate results
                              │
                              ▼
              Claude (via Cloudflare Worker /chat):
              "Here are relevant memory chunks.
               Answer the user's question naturally."
                              │
                              ▼
                 Stream response back to React ChatPanel
                              │
                    [Optional: Kokoro TTS speaks it]
                    [Optional: Orb moves to [POINT:x,y]]
```

### The `[POINT:x,y:label]` System (Companion Layer — Phase 4)

When Orbit's companion references something visible on screen, Claude is instructed to embed a coordinate tag. `OrbWidget.tsx` parses these and animates the orb to that position.

**System prompt addition (Phase 4 only):**
```
When referencing something currently visible on the user's screen,
embed a pointer tag in your response:
  [POINT:x,y:label]
Where x,y are screen coordinates with (0,0) at top-left.
Example: [POINT:245,380:Save button]
Only embed POINT tags when you are certain of the element's location.
```

**OrbWidget parsing:**
```typescript
// After receiving Claude response text:
const pointTagRegex = /\[POINT:(\d+),(\d+):([^\]]+)\]/g;
// Extract x, y, label — animate orb along bezier arc to (x, y)
// Strip tags from displayed response text
```

---

## Three-Tier Memory Architecture

**Do not store raw events forever.** Process them into three tiers. Each tier is more compressed and more valuable.

### Tier 1 — Raw Events (SQLite `events` table)
Everything as captured. Retained for 90 days then archived.
```sql
events(
  id          TEXT PRIMARY KEY,
  timestamp   INTEGER NOT NULL,
  type        TEXT NOT NULL,    -- 'clipboard' | 'window' | 'url' | 'file' | 'screenshot'
  raw_content TEXT,
  app_name    TEXT,
  url         TEXT,
  source      TEXT NOT NULL     -- 'rust' | 'extension'
)
```

### Tier 2 — Sessions (SQLite `sessions` table + Qdrant)
Generated every 30 min from raw events by the scheduler.
```sql
sessions(
  id           TEXT PRIMARY KEY,
  start_time   INTEGER NOT NULL,
  end_time     INTEGER NOT NULL,
  project_name TEXT,            -- detected by Gemini Flash
  goal         TEXT,            -- inferred by Gemini Flash
  ai_summary   TEXT NOT NULL,   -- generated by Claude
  embedding_id TEXT             -- Qdrant point ID
)
```

### Tier 3 — Memory Objects (SQLite `memory_objects` table)
Long-term condensed knowledge. Generated daily from sessions by Claude.
```sql
memory_objects(
  id          TEXT PRIMARY KEY,
  session_id  TEXT REFERENCES sessions(id),
  project     TEXT,
  topic       TEXT,
  summary     TEXT NOT NULL,    -- what was learned / what happened
  status      TEXT,             -- 'resolved' | 'unresolved' | 'ongoing'
  key_files   TEXT,             -- JSON array of file paths
  embedding_id TEXT
)
```

---

## Cloudflare Worker

API keys never exist in the app binary or codebase. All external AI API calls go through the Cloudflare Worker.

**Routes:**

| Route | Upstream | Purpose |
|---|---|---|
| `POST /chat` | `api.anthropic.com/v1/messages` | Claude Sonnet 4 — streaming (SSE) + non-streaming |
| `POST /tts` | `api.elevenlabs.io/v1/text-to-speech/{voiceId}` | ElevenLabs TTS (Phase 4 only) |
| `POST /stt-token` | Deepgram / AssemblyAI | Short-lived STT token (Phase 4 only) |

**Secrets (set via Wrangler, never in code):**
- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY` (Phase 4)
- `STT_API_KEY` (Phase 4)

**Setup:**
```bash
cd worker
npm install
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy

# Local dev — create worker/.dev.vars with keys
npx wrangler dev
```

---

## Build & Run

### Prerequisites
- macOS 13+ (Ventura)
- Xcode Command Line Tools: `xcode-select --install`
- Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Node.js 20+ and pnpm: `npm i -g pnpm`
- Python 3.11+: via pyenv recommended
- Docker (for Qdrant): `brew install --cask docker`

### Tauri Desktop App
```bash
cd app
pnpm install
pnpm tauri dev        # development (hot reload React + Rust)
pnpm tauri build      # production build → .dmg in src-tauri/target/release/bundle/
```

### FastAPI Backend
```bash
# Install uv (once, globally)
curl -LsSf https://astral.sh/uv/install.sh | sh

cd backend
uv sync                          # installs all deps from uv.lock

# Start Qdrant (required before backend)
docker run -p 6333:6333 qdrant/qdrant

# Run server (no venv activation needed)
uv run uvicorn main:app --reload --port 8000
```

**Adding new packages:**
```bash
uv add fastapi          # adds to pyproject.toml + updates uv.lock
uv remove some-package  # removes cleanly
```

**Never use `pip install` directly.** Always use `uv add`. The `uv.lock` file must stay in git — it ensures every developer and the production build use identical package versions.

The Tauri app auto-starts the FastAPI backend as a sidecar subprocess in production. In development, start it manually.

### Chrome Extension
```bash
cd extension
pnpm install
pnpm build            # outputs to extension/dist/
# Load extension/dist/ as unpacked extension in chrome://extensions
```

### Cloudflare Worker
```bash
cd worker
npm install
npx wrangler dev      # local dev
npx wrangler deploy   # production
```

### Landing Page
```bash
cd landing
pnpm install
pnpm dev
```

---

## Tauri-Specific Patterns

### IPC: React → Rust
```typescript
// React side (TypeScript)
import { invoke } from '@tauri-apps/api/core';
const result = await invoke('get_recent_events', { limitCount: 50 });
```
```rust
// Rust side
#[tauri::command]
async fn get_recent_events(limit_count: u32, db: State<'_, DbPool>) -> Result<Vec<Event>, String> {
    // ...
}
```

### IPC: Rust → React (events)
```rust
// Rust side — emit to all windows
app_handle.emit("capture-event", &event_payload).unwrap();
```
```typescript
// React side
import { listen } from '@tauri-apps/api/event';
await listen('capture-event', (event) => { /* update Zustand store */ });
```

### Window Configuration (tauri.conf.json)
```json
{
  "windows": [
    {
      "label": "main",
      "title": "Orbit",
      "decorations": false,
      "transparent": true,
      "skipTaskbar": true,
      "alwaysOnTop": false,
      "width": 380,
      "height": 600,
      "visible": false
    },
    {
      "label": "overlay",
      "decorations": false,
      "transparent": true,
      "alwaysOnTop": true,
      "skipTaskbar": true,
      "focus": false,
      "fullscreen": true,
      "visible": false
    }
  ]
}
```

### Overlay Window (Rust setup after creation)
```rust
// In main.rs — after app build, configure overlay window
let overlay = app.get_webview_window("overlay").unwrap();
overlay.set_ignore_cursor_events(true).unwrap(); // fully click-through — never blocks user
overlay.set_always_on_top(true).unwrap();
// overlay window must never steal focus or interfere with the user's active app
```

### Menu Bar (no dock icon)
```xml
<!-- src-tauri/Info.plist -->
<key>LSUIElement</key>
<true/>
<!-- This removes dock icon, Cmd+Tab entry, and main menu bar. Do not remove this. -->
```

---

## macOS Permissions

Orbit requires these permissions. Request them in order during onboarding:

| Permission | Why | How to check in Rust |
|---|---|---|
| Accessibility | Active window title tracking | `AXIsProcessTrusted()` via `accessibility` crate |
| Screen Recording | Periodic screenshots | `CGPreflightScreenCaptureAccess()` via `core-graphics` |
| Microphone | Voice input (Phase 4 only) | `AVCaptureDevice.requestAccess` via `objc` crate |

Always request Accessibility first — it is the hardest for users to grant and the most important for MVP. Open System Settings → Privacy & Security → Accessibility directly when prompting the user.

---

## Code Style & Conventions

### Universal Rules (all languages)

- **Clarity over concision.** A developer with zero context on this codebase should immediately understand what a variable or method does from its name alone.
- Use long, descriptive names. Never single-character variables. Never abbreviations that aren't universally known.
- Write more lines if it improves readability. Do not compress logic to seem clever.
- Comments explain **why**, not what. If the variable name explains what, the comment explains why it's needed or why it works that way.
- Never add features, refactors, or "improvements" beyond the exact scope of what was asked.
- Never add docstrings, comments, or type annotations to code you did not change.

### Rust (src-tauri/)

- Use `async/await` throughout. No blocking calls on the async executor.
- **Never create a new `reqwest::Client` per request.** Instantiate once, store in Tauri `State`, reuse everywhere. Creating clients per request corrupts the OS TCP connection pool and causes silent failures after several calls.
- Use `sqlx` for all SQLite operations. Use the connection pool from `db.rs`, never open raw connections.
- All Tauri commands in `commands.rs` must be thin wrappers — actual logic lives in the relevant module (`capture/`, `db.rs`, etc.).
- Return `Result<T, String>` from Tauri commands. Convert errors to strings with `.map_err(|e| e.to_string())`.
- Name Tauri commands in `snake_case`. Name React `invoke()` calls with the same string — no renaming.

```rust
// Good
#[tauri::command]
async fn get_clipboard_events_since_timestamp(
    since_timestamp: i64,
    database_pool: State<'_, DatabasePool>,
) -> Result<Vec<ClipboardEvent>, String> {
    database_pool.fetch_clipboard_events_since(since_timestamp)
        .await
        .map_err(|error| error.to_string())
}

// Bad
#[tauri::command]
async fn get_cb(ts: i64, db: State<'_, DB>) -> Result<Vec<Event>, String> { ... }
```

### TypeScript / React (app/src/)

- Functional components with hooks only. No class components.
- TypeScript strict mode is enabled. No `any` types. Define all types in `types/`.
- All global state lives in Zustand (`store/orbitStore.ts`). No prop drilling beyond 2 levels.
- Use Tailwind utility classes. No inline styles. No CSS modules.
- Use ShadCN components for UI primitives (buttons, inputs, dialogs). Do not rebuild what ShadCN provides.
- All Tauri `invoke()` calls go through a wrapper in `hooks/` — never call `invoke()` directly from a component.
- Component files named `PascalCase.tsx`. Hooks named `useCamelCase.ts`.
- Keep components focused. If a component exceeds ~150 lines, split it.

```typescript
// Good — wrapper hook
// hooks/useRecentEvents.ts
export function useRecentEvents(limitCount: number) {
  const [recentEvents, setRecentEvents] = useState<CaptureEvent[]>([]);
  useEffect(() => {
    invoke<CaptureEvent[]>('get_recent_events', { limitCount })
      .then(setRecentEvents);
  }, [limitCount]);
  return recentEvents;
}

// Bad — invoke directly in component
const events = await invoke('get_recent_events', { limit: 50 });
```

### Python / FastAPI (backend/)

- Type hints on every function signature. No untyped parameters.
- All request/response schemas defined as Pydantic models in `models/`.
- All routes are `async def`. No synchronous route handlers.
- **Never instantiate `httpx.AsyncClient` per request.** Create once in `services/` as a module-level singleton, reuse across all calls.
- **Never instantiate `QdrantClient` per request.** Singleton in `qdrant_service.py`.
- Service functions are pure async functions that return typed results. Routes call services. Routes do not contain business logic.
- Use `python-dotenv` for environment variables. No hardcoded values anywhere.

```python
# Good — singleton client
# services/claude_service.py
_http_client: httpx.AsyncClient | None = None

def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=30.0)
    return _http_client

async def send_recall_query_to_claude(
    user_query: str,
    relevant_memory_chunks: list[str],
) -> str:
    client = get_http_client()
    # ...

# Bad
async def send_query(q, chunks):
    async with httpx.AsyncClient() as client:  # new client every request!
        ...
```

### Chrome Extension (extension/)

- TypeScript only. No plain JavaScript.
- The extension is a passive pipe — it captures and forwards. No processing, no AI calls, no local storage beyond what Chrome requires for the service worker.
- Fail silently if Orbit's local backend is not running. Never show errors to the user about Orbit being unavailable.
- Use `chrome.tabs.onUpdated` and `chrome.tabs.onActivated` for tab tracking.

---

## Environment Variables

### backend/.env
```
WORKER_URL=https://your-worker.workers.dev
GEMINI_API_KEY=your_gemini_key
ORBIT_DB_PATH=~/.orbit/orbit.db
QDRANT_URL=http://localhost:6333
PORT=8000
```

### worker/.dev.vars (local dev only — never commit)
```
ANTHROPIC_API_KEY=your_key
ELEVENLABS_API_KEY=your_key
```

### app/src-tauri/.env (if needed)
```
BACKEND_PORT=8000
```

---

## DO NOT

- Do not add features, refactors, or "nice to have" improvements beyond the exact scope asked.
- Do not create new `httpx.AsyncClient`, `QdrantClient`, or `reqwest::Client` instances per request — always reuse singletons.
- Do not add `console.log`, `print()`, or `println!()` debug statements — use the logging setup already in place.
- Do not put API keys in source code, `.env` files committed to git, or app binaries. All external API keys live in Cloudflare Worker secrets only.
- Do not remove `LSUIElement = true` from Info.plist. Orbit must never appear in the dock.
- Do not set `focus: true` on the overlay window. It must never steal the user's keyboard focus.
- Do not call FastAPI from Rust (except to notify of new captures). Rust writes to SQLite directly. FastAPI reads from SQLite. They share the DB file, not HTTP calls between them.
- Do not add voice features (Whisper, TTS) before Phase 4. The recall experience must work perfectly via text first.
- Do not use `any` in TypeScript.
- Do not write synchronous FastAPI route handlers.

---

## Git Workflow

- Branch naming: `feature/short-description` or `fix/short-description`
- Commit messages: imperative mood, present tense, explain the *why* not the *what*
  - Good: `"Add clipboard deduplication to avoid storing repeated copies"`
  - Bad: `"fixed bug"` or `"updated clipboard.rs"`
- Never force-push to `main`
- PRs are not required for solo work — commit directly to feature branches, merge to `main` when stable

---

## Self-Update Instructions

When you make changes that affect the accuracy of this file, update it. Specifically:

1. **New files:** Add to the "Key Files" table with purpose description
2. **Deleted files:** Remove from the table
3. **New routes:** Add to the relevant API section
4. **Architecture changes:** Update the architecture section and data flow diagram
5. **New conventions:** Add to the appropriate code style section
6. **New environment variables:** Add to the environment variables section
7. **New permissions required:** Add to the macOS permissions table

Do NOT update this file for bug fixes, minor edits, or changes that don't affect architecture, conventions, or build setup.