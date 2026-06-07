# Orbit — Agent Instructions

<!-- Single source of truth for all AI coding agents. -->
<!-- CLAUDE.md must be a symlink to this file. Run: ln -s AGENTS.md CLAUDE.md -->
<!-- Supported by: Claude Code, Cursor, Copilot, Gemini CLI -->

## Overview

Orbit is a macOS-first AI memory companion. It runs silently in the background, passively capturing digital activity (active apps, browser tabs, clipboard, file events), and lets the user recall any of it through natural language — via text or voice — through a floating orb companion widget.

**Core promise:** "I help you continue." — not a second brain to maintain, but a memory that works automatically.

**Platform:** macOS 13+ (Ventura) first. Windows support later — Tauri makes this viable without a rewrite.

**App behaviour:** No dock icon. No Cmd+Tab entry. Lives in the macOS menu bar only (`LSUIElement = true`).

**Completed phases:** Phase 0 (foundation) and Phase 1 (recall MVP) are done.

---

## Architecture

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
│       Local Storage Layer             │  SQLite + FTS5 + Qdrant (local file)
└──────────────────────────────────────┘
```

**Data flow:**
```
[Rust: clipboard, window]  ──► [SQLite events table]
[Chrome Extension]         ──► [FastAPI POST /capture] ──► [SQLite events table]
                                        │
                               [asyncio loop, every 30 min]
                                        │
                                        ▼
                     [Gemini Flash: classify events (work/research/personal/system)]
                                        │
                                        ▼
                     [Claude: generate Session summary (Tier 2)]
                                        │
                                        ▼
                     [Voyage AI: embed summary → Qdrant local storage]
                                        │
                              [on user recall query]
                                        │
                       ┌────────────────┴────────────────┐
                       ▼                                 ▼
             FTS5 keyword search              Qdrant semantic search
                       │                                 │
                       └────────────────┬────────────────┘
                                        ▼
                          [Claude: synthesise answer]
                                        │
                            [React: stream to chat panel]
```

---

## Monorepo Structure

```
orbit/
├── AGENTS.md                          ← you are here (source of truth)
├── CLAUDE.md                          ← symlink to AGENTS.md
├── docs/
│   ├── Orbit_Complete_Build_Plan.md
│   ├── PHASE_0.md                     ← ✅ complete
│   └── PHASE_1.md                     ← ✅ complete
├── app/                               ← Tauri v2 desktop app
│   ├── src/                           ← React + TypeScript frontend
│   │   ├── components/
│   │   │   ├── OrbWidget.tsx          ← floating companion orb (Phase 4)
│   │   │   ├── ChatPanel.tsx          ← recall search + streaming response
│   │   │   ├── Timeline.tsx           ← scrollable activity log
│   │   │   └── MemoryViewer.tsx       ← view + delete stored memories (Phase 2)
│   │   ├── store/
│   │   │   └── orbitStore.ts          ← Zustand global state
│   │   ├── hooks/                     ← all Tauri invoke() calls wrapped here
│   │   ├── types/                     ← shared TypeScript types
│   │   └── main.tsx
│   └── src-tauri/
│       ├── src/
│       │   ├── main.rs                ← Tauri entry, system tray, spawns FastAPI, starts capture tasks
│       │   ├── capture/
│       │   │   ├── mod.rs
│       │   │   ├── clipboard.rs       ← polls clipboard every 500ms, redacts sensitive content
│       │   │   └── window.rs          ← polls active window every 30s via osascript
│       │   ├── hotkey.rs              ← global hotkey listener (global-hotkey crate)
│       │   ├── db.rs                  ← SQLite pool (sqlx), never create new connections per call
│       │   └── commands.rs            ← all #[tauri::command] functions, thin wrappers only
│       ├── Cargo.toml
│       ├── tauri.conf.json            ← two windows: main panel + overlay
│       └── Info.plist                 ← LSUIElement = true (no dock icon, ever)
├── backend/                           ← FastAPI AI processing server
│   ├── main.py                        ← app entry, lifespan, mounts routers, starts asyncio loop
│   ├── database.py                    ← SQLAlchemy async SQLite engine + FTS5 setup
│   ├── scheduler.py                   ← asyncio loop: session generation every 30 min
│   ├── routes/
│   │   ├── capture.py                 ← POST /capture, GET /events
│   │   └── recall.py                  ← POST /recall (SSE streaming)
│   ├── services/
│   │   ├── claude_service.py          ← Claude via Cloudflare Worker, singleton httpx client
│   │   ├── gemini_service.py          ← Gemini Flash classification, singleton genai.Client
│   │   ├── voyage_service.py          ← Voyage AI embeddings via httpx, no ML deps
│   │   └── qdrant_service.py          ← Qdrant local file mode, singleton client
│   ├── models/
│   │   ├── event.py                   ← Pydantic: CaptureEvent
│   │   └── session.py                 ← Pydantic: Session
│   ├── pyproject.toml                 ← uv-managed dependencies
│   ├── uv.lock                        ← committed to git, never manually edited
│   └── .env                           ← secrets (gitignored)
├── extension/                         ← Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── src/
│   │   ├── background.ts              ← service worker: tab events → POST /capture
│   │   └── content.ts                 ← stub (selected text capture in Phase 2)
│   └── vite.config.ts
├── worker/                            ← Cloudflare Worker API proxy
│   ├── src/index.ts                   ← /chat (Claude), /tts (stub), /stt-token (stub)
│   └── wrangler.toml
└── landing/                           ← Next.js marketing site (Phase 2)
```

---

## Tech Stack

### Desktop App
| Layer | Tool |
|---|---|
| Framework | Tauri v2 |
| Frontend | React + TypeScript |
| Styling | Tailwind + ShadCN |
| Animation | Framer Motion (Phase 4) |
| State | Zustand |
| Auto-updates | tauri-plugin-updater → GitHub Releases |

### Rust Crates (src-tauri/Cargo.toml)
| Crate | Purpose |
|---|---|
| `arboard` | Clipboard monitoring |
| `sqlx` (sqlite + runtime-tokio) | SQLite connection pool |
| `global-hotkey` | System-wide push-to-talk hotkey |
| `xcap` | Screenshots (Phase 3) |
| `reqwest` | HTTP client singleton — **never create per request** |
| `uuid` | Event ID generation |
| `chrono` | Timestamps |
| `regex` | Sensitive pattern detection in clipboard redaction |
| `serde` + `serde_json` | Serialisation |
| `tokio` (full) | Async runtime |

### Python Dependencies (managed with uv — never pip)
| Package | Purpose |
|---|---|
| `fastapi` | API framework |
| `uvicorn[standard]` | ASGI server |
| `sqlalchemy` + `aiosqlite` | Async SQLite ORM |
| `pydantic` | Request/response schemas |
| `python-dotenv` | Env var loading |
| `httpx` | HTTP client singleton for Claude + Voyage AI |
| `google-genai` | Gemini Flash (NOT google-generativeai — that is deprecated) |
| `qdrant-client` | Vector store (local file mode, no Docker) |

**Never install:** `sentence-transformers`, `torch`, `onnxruntime`, `apscheduler`, `google-generativeai` — all either deprecated or Intel Mac incompatible.

### AI Models
| Task | Model | Package |
|---|---|---|
| Recall, conversation, session summaries | Claude Sonnet 4 via Cloudflare Worker | `httpx` |
| Event classification (work/research/personal/system) | `gemini-3.1-flash-lite` | `httpx` via Cloudflare Worker `/classify` |
| Embeddings | Voyage AI `voyage-3-lite` (512 dims) via httpx | `httpx` |
| Voice STT (Phase 4) | Whisper.cpp local → Apple Speech fallback | — |
| Voice TTS (Phase 4) | Kokoro TTS local (free) → ElevenLabs Pro | — |

### Storage
| Layer | Tool | Notes |
|---|---|---|
| Structured events | SQLite (`~/.orbit/orbit.db`) | All raw events, sessions, memory objects |
| Keyword search | SQLite FTS5 (built-in) | BM25 ranking, porter tokenizer, zero extra deps |
| Semantic search | Qdrant local file mode (`~/.orbit/qdrant_storage/`) | No Docker, no server, `QdrantClient(path=...)` |

### Landing Page (landing/)
| Layer | Tool | Notes |
|---|---|---|
| Framework | Next.js 16.2.7 | Latest LTS — App Router only, no Pages Router |
| Styling | Tailwind CSS v4 | CSS-first config: `@import "tailwindcss"` in globals.css. No `tailwind.config.js` |
| Email sending | Resend | Server Actions pattern — `'use server'` directive |
| Email templates | React Email | React components compiled to HTML email |
| Waitlist storage | Supabase Postgres | Service role key server-side only, never exposed to client |
| Validation | Zod | All Server Action inputs validated before DB write |
| Deployment | Vercel | Root directory set to `landing/` |

**Next.js 16 rules:**
- App Router only — never use Pages Router
- Server Components by default — add `'use client'` only when needed (event handlers, hooks)
- Server Actions with `'use server'` for form submissions — no API routes for simple mutations
- Fetch in Server Components directly — no useEffect for server data
- `params` and `searchParams` are now async in Next.js 16 — always `await params`
| Tool | Purpose |
|---|---|
| Cloudflare Worker | API key proxy — Claude, ElevenLabs, STT. Keys **never** in app binary |
| Supabase | Cloud sync (opt-in, Phase 5+) |
| PostHog | Privacy-safe analytics |
| Sentry | Crash reporting |
| Lemon Squeezy | Payments |
| GitHub Releases | Distribution + update server |

---

## Key Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/main.rs` | Entry point. Sets `LSUIElement`, system tray, spawns FastAPI subprocess, creates SQLite pool, starts clipboard + window capture tasks as tokio background tasks. |
| `app/src-tauri/src/capture/clipboard.rs` | Polls clipboard every 500ms with `arboard`. Runs content through sensitive pattern detection before writing. Stores `[REDACTED:<type>]` for matched patterns. Never stores passwords, API keys, JWTs, private keys, credit cards raw. |
| `app/src-tauri/src/capture/window.rs` | Polls active window title + app name via osascript every 30s. Only writes to DB when title changes. Fails silently on permission errors. |
| `app/src-tauri/src/db.rs` | SQLite pool via sqlx. Single pool shared across all Rust code. **Never open new connections per request.** |
| `app/src-tauri/src/commands.rs` | All `#[tauri::command]` functions. These are thin wrappers — logic lives in other modules. |
| `app/src-tauri/Info.plist` | `LSUIElement = true`. Do not remove. Orbit must never appear in the dock. |
| `app/src-tauri/tauri.conf.json` | Two windows: `main` (panel) and `overlay` (Phase 4 orb). Overlay: transparent, alwaysOnTop, focus:false, set_ignore_cursor_events(true). |
| `backend/main.py` | FastAPI app. Uses `@asynccontextmanager` lifespan (not deprecated startup/shutdown). Starts the session generation asyncio loop via `asyncio.create_task()`. |
| `backend/database.py` | SQLAlchemy async engine. Creates all tables + FTS5 virtual table + sync triggers on startup. |
| `backend/scheduler.py` | `start_session_generation_loop()` — `while True: await asyncio.sleep(1800)` loop. `generate_sessions_from_recent_events()` — fetches unprocessed events, classifies with Gemini, summarises with Claude, stores session, embeds with Voyage AI → Qdrant. |
| `backend/routes/capture.py` | `POST /capture` — receives events from Chrome extension (not Rust — Rust writes SQLite directly). Checks pause state + excluded apps before writing. `GET /events` — returns latest N events for timeline UI. |
| `backend/routes/recall.py` | `POST /recall` — parallel FTS5 + Qdrant search, merged results sent to Claude, streamed back as SSE. **FTS5 query never includes clipboard raw_content that was redacted.** |
| `backend/services/claude_service.py` | Claude API via Cloudflare Worker. Singleton `httpx.AsyncClient`. Handles SSE streaming. |
| `backend/services/gemini_service.py` | Gemini classification. Uses `google-genai` (`from google import genai`). Singleton `genai.Client`. Wraps sync `generate_content` in `asyncio.to_thread`. **Only sends app_name + event type to Gemini — never clipboard raw_content.** |
| `backend/services/voyage_service.py` | Voyage AI embeddings. POST to `api.voyageai.com/v1/embeddings`, model `voyage-3-lite`. Uses singleton httpx client. Returns 512-dim float list. |
| `backend/services/qdrant_service.py` | Qdrant local file mode. Singleton `QdrantClient(path=~/.orbit/qdrant_storage)`. Collection `orbit_sessions`, 512 dims, cosine distance. `add_session_embedding()` + `search_sessions_semantic()`. |
| `extension/src/background.ts` | MV3 service worker. Uses `chrome.storage.session` for state (never global vars — service workers terminate when idle). Fails silently if Orbit backend not running. |
| `backend/routes/privacy.py` | Privacy control endpoints: excluded apps CRUD, pause/resume, capture status, full memory wipe. |
| `backend/routes/feedback.py` | `POST /feedback` — stores user rating + comment in SQLite. |
| `app/src/components/PrivacyPanel.tsx` | Privacy settings UI: capture toggle, excluded apps list, wipe button with AlertDialog confirmation. |
| `app/src/components/MemoryViewer.tsx` | Two-tab UI: Events (paginated, filterable, deletable) + Sessions (expandable summaries, deletable). Feedback bar at bottom. |
| `app/src/hooks/usePrivacySettings.ts` | Hook wrapping all privacy API calls. No fetch() in components — always via hooks. |
| `app/src/hooks/useMemoryData.ts` | Hook for memory viewer data: events, sessions, pagination, delete operations. |
| `landing/src/lib/waitlist-actions.ts` | `'use server'` Server Action. Validates with Zod, inserts to Supabase, sends Resend confirmation. Never exposes DB errors to client. |
| `landing/src/emails/WaitlistConfirmation.tsx` | React Email confirmation template. |
| `releases/latest.json` | Tauri updater manifest. Updated by GitHub Actions on each release. |
| `.github/workflows/release.yml` | Builds + signs macOS .dmg on `v*` tag push. Uses tauri-apps/tauri-action. |

---

## Memory Architecture (Three Tiers)

### Tier 1 — Raw Events (SQLite `events` table)
Everything captured, as-is. Retained 90 days then archived.
```sql
events(
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,        -- unix milliseconds
  type TEXT NOT NULL,                -- 'clipboard' | 'window' | 'url' | 'screenshot'
  raw_content TEXT,                  -- [REDACTED:<type>] for sensitive clipboard content
  app_name TEXT,
  url TEXT,
  source TEXT NOT NULL,              -- 'rust' | 'extension'
  session_id TEXT,                   -- populated after session generation
  category TEXT                      -- populated by Gemini: work/research/personal/system
)
```

### Tier 2 — Sessions (SQLite `sessions` table + Qdrant)
Auto-generated every 30 min. Claude-authored summaries.
```sql
sessions(
  id TEXT PRIMARY KEY,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  project_name TEXT,
  goal TEXT,
  ai_summary TEXT NOT NULL,          -- JSON: {project_name, goal, summary, key_resources, last_action}
  embedding_id TEXT                  -- Qdrant point ID
)
```

### Tier 3 — Memory Objects (Phase 3)
Long-term condensed knowledge extracted from sessions.

---

## Security & Privacy Rules

These rules are non-negotiable. Every feature must pass through them.

### Clipboard Redaction (Rust — before any DB write)
`capture/clipboard.rs` must detect and redact these patterns before writing:

| Pattern | Stored as |
|---|---|
| PEM private keys (`BEGIN PRIVATE KEY`, `BEGIN RSA PRIVATE KEY`, etc.) | `[REDACTED:private_key]` |
| API keys: `sk-`, `AIza`, `AKIA`, `xoxb-`, `ghp_`, `pk_live_`, `sk_live_`, `pa-` | `[REDACTED:api_key]` |
| JWTs: three base64 segments separated by dots, each >10 chars | `[REDACTED:jwt_token]` |
| Credit cards: 13–19 digit sequences (with optional spaces/dashes) | `[REDACTED:credit_card]` |
| SSNs: `\d{3}-\d{2}-\d{4}` pattern | `[REDACTED:ssn]` |
| Crypto addresses: Bitcoin (`1[a-zA-Z0-9]{25,34}` or `bc1...`), Ethereum (`0x[a-fA-F0-9]{40}`) | `[REDACTED:crypto_address]` |

The event is still written — Orbit knows *you copied something from which app* — just not the sensitive value.

### AI Context Sanitisation (Python — in scheduler.py and recall.py)
**Clipboard `raw_content` is NEVER sent to Gemini or Claude.**
- Gemini receives: `id`, `type`, `app_name`, `timestamp` only — enough to classify, not to leak secrets
- Claude receives: session summaries (Tier 2), window titles, URLs — never raw clipboard text
- Clipboard content is local-only: used exclusively for FTS5 keyword search on device

### App Exclude List
Password managers (1Password, Bitwarden, etc.) and banking apps must be in the default exclude list. Window events from excluded apps are dropped at capture time in `window.rs`.

### Other Rules
- All data local by default. Cloud sync (Supabase) is opt-in and encrypted — Phase 5 only.
- API keys exist only in Cloudflare Worker secrets and `backend/.env` (gitignored). Never in source code.
- One-click full memory wipe in UI (Phase 2).

---

## Recall System Prompt

The system prompt used in `backend/routes/recall.py`:

```python
RECALL_SYSTEM_PROMPT = """\
You are Orbit, an AI memory companion.
You have access to summaries of the user's recent computer activity.
Answer their question directly and specifically, like a colleague who \
was watching their screen.

Format your response as:
📌 [Time period] — [App or context]

[What they were doing, specifically]

You had open:
→ [resource 1]
→ [resource 2]

Last action: [most recent relevant thing]

Be specific. Use exact file names, URLs, and project names from the context.
If the context doesn't answer the question, say so honestly.\
"""
```

**No profession-specific language** ("for a developer", "for a designer", etc.). Orbit is universal. Personalisation by profession is an onboarding feature in a later phase.

---

## Cloudflare Worker

All external AI API calls go through the Cloudflare Worker. Keys never in app binary or git.

| Route | Upstream | Status |
|---|---|---|
| `POST /chat` | `api.anthropic.com/v1/messages` | ✅ Live |
| `POST /tts` | ElevenLabs | 🔲 Stub (Phase 4) |
| `POST /stt-token` | Deepgram/AssemblyAI | 🔲 Stub (Phase 4) |

**Secrets (Wrangler only):** `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY` (Phase 4)

```bash
cd worker
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

---

## Build & Run

### Prerequisites
- macOS 13+ (Ventura)
- Xcode Command Line Tools: `xcode-select --install`
- Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Node.js 20+ and pnpm: `npm i -g pnpm`
- Python 3.11+ (via pyenv)
- uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Wrangler: `pnpm add -g wrangler`

### Tauri Desktop App
```bash
cd app
pnpm install
pnpm tauri dev        # development
pnpm tauri build      # production .dmg
```

### FastAPI Backend
```bash
cd backend
uv sync               # install from uv.lock — never pip install
uv run uvicorn main:app --reload --port 8000

# Adding packages:
uv add <package>      # never pip install
uv remove <package>
```

### Chrome Extension
```bash
cd extension
pnpm install && pnpm build
# Load extension/dist/ as unpacked in chrome://extensions
```

### Cloudflare Worker
```bash
cd worker
npx wrangler dev      # local (needs worker/.dev.vars with keys)
npx wrangler deploy   # production
```

---

## Tauri Patterns

### IPC: React → Rust
```typescript
// React (TypeScript) — always via a wrapper hook, never invoke() directly in components
import { invoke } from '@tauri-apps/api/core';
const events = await invoke<CaptureEvent[]>('get_recent_events', { limitCount: 50 });
```
```rust
// Rust — thin wrapper, logic in modules
#[tauri::command]
async fn get_recent_events(limit_count: u32, db_pool: State<'_, DatabasePool>) -> Result<Vec<CaptureEvent>, String> {
    db_pool.fetch_recent_events(limit_count).await.map_err(|e| e.to_string())
}
```

### IPC: Rust → React
```rust
app_handle.emit("capture-event", &payload).unwrap();
```
```typescript
await listen('capture-event', (event) => { /* update Zustand store */ });
```

### Overlay Window (Phase 4)
```rust
let overlay_window = app.get_webview_window("overlay").unwrap();
overlay_window.set_ignore_cursor_events(true).unwrap(); // never blocks user interaction
overlay_window.set_always_on_top(true).unwrap();
// Never steal focus — focus: false in tauri.conf.json
```

---

## macOS Permissions

| Permission | Why | When |
|---|---|---|
| Accessibility | Active window tracking via Accessibility API | Phase 0 — required at launch |
| Screen Recording | Periodic screenshots | Phase 3 |
| Microphone | Voice input | Phase 4 |

Grant Accessibility first (System Settings → Privacy & Security → Accessibility). Open the dialog directly — don't make users find it themselves.

---

## Code Style & Conventions

### Universal (all languages)
- **Clarity over concision.** Names must be self-explanatory to someone with zero codebase context.
- Long descriptive names always. No single-character variables. No unexplained abbreviations.
- Comments explain **why**, not what. If the name explains what, the comment explains why.
- **Never add features, refactors, or improvements beyond the exact scope asked.**
- Never add docstrings or comments to code you didn't change.

### Rust
- `async/await` throughout — no blocking calls on the async executor.
- **Never create a new `reqwest::Client` per request** — reuse the singleton in `State<>`.
- **Never open new SQLite connections** — use the pool from `db.rs`.
- All Tauri commands in `commands.rs` are thin wrappers — logic in relevant modules.
- Return `Result<T, String>` from commands. `.map_err(|e| e.to_string())`.

### TypeScript / React
- Functional components + hooks only.
- No `any` types — define everything in `types/`.
- All Tauri `invoke()` calls in `hooks/` — never directly in components.
- Global state in Zustand (`store/orbitStore.ts`) only. No prop drilling beyond 2 levels.
- Tailwind utility classes only — no inline styles.

### Python / FastAPI
- Type hints on every function signature.
- All Pydantic models in `models/`.
- All routes `async def` — no sync handlers.
- **Never instantiate `httpx.AsyncClient` per request** — singleton in services.
- **Never instantiate `QdrantClient` per request** — singleton in `qdrant_service.py`.
- **Never instantiate `genai.Client` per request** — singleton in `gemini_service.py`.
- Routes call services. Routes contain zero business logic.
- `uv add` for packages — never `pip install`.

### Chrome Extension
- TypeScript only.
- **Never use global variables for state** — service workers terminate when idle. Use `chrome.storage.session`.
- Fail silently when Orbit backend is not running — no user-visible errors.

---

## DO NOT

- Add features, refactors, or improvements beyond exact scope.
- Create new `httpx.AsyncClient`, `QdrantClient`, `genai.Client`, or `reqwest::Client` per request — singletons always.
- Use `pip install` — always `uv add`.
- Install `sentence-transformers`, `torch`, `onnxruntime`, `apscheduler`, or `google-generativeai`.
- Use `APScheduler` v4 — it is explicitly pre-release and unstable.
- Import `google.generativeai` — the correct import is `from google import genai`.
- Put API keys in source code, committed `.env` files, or app binaries.
- Remove `LSUIElement = true` from Info.plist.
- Set `focus: true` on the overlay window.
- Send clipboard `raw_content` to Gemini, Claude, or any external API.
- Use global variables in the Chrome Extension service worker.
- Write synchronous FastAPI route handlers.
- Use `any` in TypeScript.
- Run `xcodebuild` from the terminal (invalidates TCC permissions).

---

## Environment Variables

### backend/.env (gitignored)
```
WORKER_URL=https://your-worker.workers.dev
GEMINI_API_KEY=your_gemini_key
VOYAGE_API_KEY=your_voyage_key
ORBIT_DB_PATH=~/.orbit/orbit.db
QDRANT_STORAGE_PATH=~/.orbit/qdrant_storage
PORT=8000
```

### worker/.dev.vars (gitignored — local dev only)
```
ANTHROPIC_API_KEY=your_key
```

---

## Git Workflow
- Branches: `feature/short-description` or `fix/short-description`
- Commits: imperative mood, explain the *why*. `"Add clipboard redaction to prevent API key leaks"` not `"fix bug"`
- Never force-push to `main`

---

## Self-Update Instructions

Update this file when changes affect architecture, conventions, or build setup:
1. **New files** → add to monorepo structure and key files table
2. **Deleted files** → remove from both
3. **New packages** → add to tech stack table
4. **New conventions** → add to code style section
5. **Architecture changes** → update the data flow diagram
6. **New env vars** → add to environment variables section

Do NOT update for bug fixes or minor changes that don't affect documented architecture.