# Orbit — Agent Instructions

<!-- Single source of truth for all AI coding agents. -->
<!-- CLAUDE.md must be a symlink to this file. Run: ln -s AGENTS.md CLAUDE.md -->
<!-- Supported by: Claude Code, Cursor, Copilot, Gemini CLI -->

---

## Overview

Orbit is a macOS-first AI memory companion. It runs silently in the background,
passively capturing digital activity, and lets the user recall any of it through
natural language — via text or voice.

**Core promise:** "I help you continue." — your computer's working memory.
Not a second brain. Not a productivity tool. Working memory that works automatically.

**Who uses it:** Anyone who uses a computer. Not developer-specific.
A writer, designer, student, founder, researcher, or engineer — same interface,
same experience, AI adapts to what they actually do.

**Platform:** macOS 13+ (Ventura) first. Windows later via Tauri.

**App behaviour:** No dock icon. No Cmd+Tab. Menu bar only (`LSUIElement = true`).

**Completed phases:** Phase 0 ✅ Phase 1 ✅ Phase 2 ✅ Pre-beta hardening ✅ Phase 2.5 ✅ Phase 2.6 ✅

---

## Critical Architecture Facts
**Read before writing any code. Most common points of confusion.**

| Fact | Detail |
|---|---|
| **ALL AI goes through the Cloudflare Worker** | Claude, Gemini, AND Voyage AI all route through the Worker. No direct AI API calls anywhere. This keeps all API keys off user machines. |
| **Worker routes** | `/chat` → Claude. `/classify` → Gemini Flash. `/embed` → Voyage AI. `/tts` → ElevenLabs (stub). `/stt-token` → STT (stub). |
| **No AI API keys in backend/.env** | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `VOYAGE_API_KEY` live in Cloudflare Worker secrets ONLY. `backend/.env` has no AI provider keys. |
| **google-genai SDK not installed** | Gemini is called via `httpx` → Worker `/classify`. The `google-genai` package is not a dependency. |
| **APScheduler v3.x (stable)** | Session generation uses `AsyncIOScheduler` from `apscheduler.schedulers.asyncio` — this is v3.x stable. Import path: `from apscheduler.schedulers.asyncio import AsyncIOScheduler`. Never use APScheduler v4 (`from apscheduler import AsyncScheduler`) — that is explicitly pre-release and unstable. |
| **Rust writes SQLite directly** | Clipboard + window + file_activity events → SQLite directly from Rust. Never through FastAPI. Only the Chrome Extension POSTs to FastAPI. |
| **No Docker for Qdrant** | `QdrantClient(path="~/.orbit/qdrant_storage")` local file mode. No server, no Docker. |
| **Secrets redacted at capture, content flows to AI** | Clipboard secrets become `[REDACTED:type]` in `clipboard.rs` BEFORE any DB write. After that, `raw_content` (window titles, URLs, safe clipboard text) IS sent to Gemini and Claude — they need it to write useful summaries. App names alone are meaningless. The redaction layer is what makes this safe. |
| **Recall uses query intent classification** | `classify_query_intent()` in `recall.py` returns "work", "personal", or "general". Only a "work"-intent query excludes `category = 'personal'` events from FTS5 results. "personal" queries include all events and prompt Claude to surface URLs. "general" (the default when no clear signal is present, or when both signals fire) includes everything. |
| **Recall has offline FTS5 fallback** | FTS5 keyword search always runs first (local, no network). If the Cloudflare Worker is unreachable (`httpx.ConnectError` / `TimeoutException`), Qdrant + Claude are skipped and FTS5 results are streamed as a plain offline message. |
| **Recall parses time references** | `time_parser.extract_time_range_from_query()` scans the query for phrases like "yesterday", "this morning", "last week". When matched, FTS5 is timestamp-filtered and Qdrant results are post-filtered to sessions that overlap the window. |
| **Conversation history is stateful** | Last 4 turns kept in Zustand, passed with every `/recall` request. Claude is NOT stateless per query. Max 4 turns to control token cost. |
| **Three richer browser event types** | In addition to `url`, the extension now emits `page_content` (Readability article body, author, site_name — capped at 2 000 chars), `search_query` (typed query + search engine), and `link_click` (anchor text + destination URL). All three POST to FastAPI `/capture`; background.ts also continues to emit bare `url` events on tab navigation. |
| **Python inline redaction for browser content** | `redaction_service.py` ports the Rust clipboard patterns as inline `re.sub()` — it replaces only matched substrings rather than the whole value, preserving surrounding article context. Applied to `page_text` (page_content events) and `raw_content` (search_query events) in `capture.py` before the DB write. All patterns run (not just the first match). |
| **Domain exclude list** | `excluded_domains` table in SQLite. Browser events whose URL hostname matches an excluded domain are silently dropped in `capture.py` (same 30-second in-memory cache as the app exclude list). Managed via `GET/POST/DELETE /privacy/excluded-domains`. Default seeds: `mail.google.com`, `accounts.google.com`. |
| **Sessions store topics** | Claude now returns a `topics` JSON array ("vector databases", "React hooks", …) alongside the existing session fields. Stored in `sessions.topics` (TEXT, JSON array string). Included in the Qdrant embedding text so "what was I researching about X" queries match on subject vocabulary. |
| **File activity monitor (Rust)** | `file_activity.rs` watches ~/Documents, ~/Desktop, ~/Downloads via macOS FSEvents (the `notify` crate). Events are debounced by 2 seconds (`notify-debouncer-full`). Only the file *path* is stored in `events.file_path`; `raw_content` holds the bare file name; `metadata` holds `{"action":"created|modified|removed"}`. File *contents* are never read. Hidden files/dirs, high-noise directories, and transient suffixes are filtered before any DB write. |
| **System state monitor (Rust)** | `system_state.rs` subscribes to macOS Darwin notifications for screen lock/unlock and sleep/wake via `notify_register_file_descriptor` (C API in libSystem — no new crates). Each notification gets a dedicated blocking OS thread; events bridge to tokio via `mpsc`. Writes `type='system_state'` events with `raw_content=<state>` and `metadata={"state":"lock|unlock|sleep|wake"}`. No-op on non-macOS. |
| **App lifecycle monitor (Rust)** | `app_lifecycle.rs` polls the running application list every 10 seconds via osascript (`System Events` process names), diffs against the previous snapshot, and writes `type='app_lifecycle'` events with `app_name` and `metadata={"action":"launched"|"quit"}`. Baseline snapshot is taken before the first sleep so apps already running at startup are not emitted as launches. |
| **Idle detection — timer only, never keystroke content** | `window.rs` calls `CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateHIDSystemState, kCGAnyInputEventType)` via a CoreGraphics `extern "C"` link. This returns **only** a float count of seconds since the last input event — it never captures what was typed or where the mouse moved. If seconds < 60 → `is_user_active = 1`; else `0`. Attached to each window event INSERT. macOS-only; non-macOS always writes `1`. |
| **Session boundaries split on lock/sleep** | `_split_events_at_system_boundaries()` in `scheduler.py` walks the chronologically-sorted unprocessed event list. Each `system_state` event with state `"lock"` or `"sleep"` ends the current content batch; content events after an `"unlock"`/`"wake"` start a new batch. Boundary events are immediately marked `session_id='system_boundary'` so they are never re-classified. Each content batch then goes through the full classify → group → summarise pipeline independently. |
| **active_minutes on sessions** | `sessions.active_minutes` (INTEGER) counts `window` events where `is_user_active = 1` in a session's event list, multiplied by the 30-second poll interval, divided by 60. Represents a lower-bound estimate of keyboard/mouse-active time (lower bound because the window tracker only fires on title changes, not every 30 s unconditionally). Included in the Qdrant payload metadata for "how long did I work on X?" recall. |
| **File watch settings (privacy control)** | `file_watch_settings` table in SQLite (single row, id=1): `enabled` INTEGER + `watched_folders` JSON TEXT array of absolute paths. Seeded on first run with `~/Documents`, `~/Desktop`, `~/Downloads`. `file_activity.rs` reads this table on startup and every 30 s via a `tokio::select!` refresh tick, then syncs the `notify` watcher using a `currently_watched: HashSet<String>` diff (unwatch removed paths, watch added paths). Disabling sets the desired set to empty, unwatching everything. Managed via `GET/POST /privacy/file-watching` and `POST/DELETE /privacy/watched-folders`; surfaced in PrivacyPanel under "File Activity". |

---

## Architecture

```
┌──────────────────────────────────────┐
│       UI / Companion Layer            │  React + Tauri window system
├──────────────────────────────────────┤
│       AI Reasoning Layer              │  All AI via Cloudflare Worker
├──────────────────────────────────────┤
│       Memory Layer                    │  Raw Events → Sessions → Memory Objects
├──────────────────────────────────────┤
│       Activity Collection Layer       │  Rust (OS-level) + Chrome Extension
├──────────────────────────────────────┤
│       Local Storage Layer             │  SQLite + FTS5 + Qdrant (local file)
└──────────────────────────────────────┘
```

### Data Flow — Capture
```
[Rust: clipboard.rs]       ──► SQLite events (direct write, no HTTP)
[Rust: window.rs]          ──► SQLite events (direct write, no HTTP)  [+ is_user_active from idle timer]
[Rust: file_activity.rs]   ──► SQLite events (direct write, no HTTP)  [watched folders read from file_watch_settings every 30 s]
[Rust: system_state.rs]    ──► SQLite events (direct write, no HTTP)
[Rust: app_lifecycle.rs]   ──► SQLite events (direct write, no HTTP)

[content.ts — @mozilla/readability]
    │  5-second visibility filter; sends on tab departure
    │  page_content  → raw_content=title, page_text (≤2 000 chars), author, site_name
    │  search_query  → raw_content=query, search_engine
    │  link_click    → raw_content=link_text, link_target
    ▼
[background.ts — service worker]
    │  url           → raw_content=page title (on every tab navigate / activate)
    │  relays content.ts messages to backend
    ▼
POST /capture ──► FastAPI
    │  domain check (excluded_domains — 30 s cache) — drop if excluded
    │  page_content page_text → redact_sensitive_content()
    │  search_query raw_content → redact_sensitive_content()
    ▼
SQLite events
```

### Data Flow — Background Processing (every 30 min, asyncio loop)
```
SQLite (events WHERE session_id IS NULL, last 60 min  +  stale >2 h)
    │
    ▼
_split_events_at_system_boundaries()
    │  system_state lock/sleep  →  end current batch; mark session_id='system_boundary'
    │  system_state unlock/wake →  recorded but no split (next content starts new batch)
    │  result: N contiguous content-only batches  (often just 1 if no lock/sleep today)
    │
    │  (per batch — repeated for each content batch:)
    ▼
httpx → Worker /classify → Gemini Flash API
    │  classifies: work / research / personal / system / communication
    │  updates events.category in SQLite
    ▼
httpx → Worker /chat → Claude Haiku 4.5
    │  generates: {project_name, goal, summary, key_resources, last_action, topics}
    │  file_activity events included in payload: "file_path, action"
    │  active_minutes = (window events with is_user_active=1) × 30 s ÷ 60
    │  INSERT INTO sessions  (includes active_minutes, topics)
    ▼
httpx → Worker /embed → Voyage AI
    │  512-dim vector of session summary text (includes topics)
    └► Qdrant local upsert  (payload includes active_minutes)
```

### Data Flow — Recall (on user query)
```
User query + conversation_history (last 4 turns from Zustand)
    │
    ▼
time_parser.extract_time_range_from_query()  →  {start_ms, end_ms, label} or None
classify_query_intent()  →  "work" | "personal" | "general"
    │
    ▼
FTS5 keyword search (SQLite, local — always runs, even offline)
    │  if intent == "work": excludes category = 'personal' events
    │  if time_range: filters by timestamp bounds
    │  returns: up to 15 events
    │
    ▼ try: Cloudflare Worker reachable?
    │
    ├── YES ──► httpx → Worker /embed → Voyage AI → Qdrant semantic search
    │               returns: up to 8 sessions
    │               if time_range: keep only sessions overlapping the window
    │               re-rank: (similarity × 0.7) + (recency × 0.3)
    │               (when time_range active: 0.9 / 0.1 to avoid double-penalising)
    │                   │
    │                   ▼
    │           httpx → Worker /chat → Claude Sonnet 4.6 (user-facing)
    │                   receives: time label + intent hint + FTS5 events
    │                             + re-ranked sessions + conversation_history
    │                   ▼
    │           SSE stream ──► React renders token by token
    │
    │
    │   if _query_asks_about_time_or_breaks():
    │       fetch system_state events (local SQLite, time-filtered if range active)
    │       append "BREAK / SYSTEM EVENTS:" section to context block
    │
    └── NO (ConnectError / TimeoutException)
            stream FTS5 results as plain offline message — no AI synthesis
```

---

## Monorepo Structure

```
orbit/
├── AGENTS.md                               ← you are here
├── CLAUDE.md                               ← symlink: ln -sf AGENTS.md CLAUDE.md
├── docs/
│   ├── Orbit_Complete_Build_Plan.md
│   ├── PHASE_0.md                          ← ✅ complete
│   ├── PHASE_1.md                          ← ✅ complete
│   ├── PHASE_2.md                          ← ✅ complete
│   └── design/
│       └── orb-reference.png               ← orb animation reference (Phase 4)
├── app/                                    ← Tauri v2 desktop app
│   ├── src/
│   │   ├── instrument.ts                   ← Sentry init — FIRST import in main.tsx
│   │   ├── main.tsx                        ← PostHogProvider wrapper, imports instrument first
│   │   ├── components/
│   │   │   ├── OnboardingFlow.tsx          ← first-launch: Welcome→Permissions→Extension→Tips
│   │   │   ├── ErrorBoundary.tsx           ← global error boundary → Sentry → restart button
│   │   │   ├── ChatPanel.tsx               ← recall UI, reads conversationHistory from Zustand
│   │   │   ├── Timeline.tsx                ← scrollable activity log
│   │   │   ├── MemoryViewer.tsx            ← view + delete events/sessions (two-tab UI)
│   │   │   ├── PrivacyPanel.tsx            ← capture toggle, excluded apps, excluded websites, file activity watching, wipe button
│   │   │   └── OrbWidget.tsx               ← floating companion orb (Phase 4)
│   │   ├── store/
│   │   │   └── orbitStore.ts               ← Zustand: includes conversationHistory: Message[]
│   │   ├── hooks/
│   │   │   ├── useRecall.ts                ← POST /recall, appends to conversationHistory
│   │   │   ├── useAnalytics.ts             ← PostHog wrapper — never call posthog directly
│   │   │   ├── useOnboarding.ts            ← onboarding state, polls accessibility every 3s
│   │   │   ├── usePrivacySettings.ts       ← privacy API calls; excluded domains + normalizeDomain(); file watching CRUD
│   │   │   └── useMemoryData.ts            ← memory viewer: events, sessions, pagination
│   │   └── types/                          ← all TypeScript types
│   └── src-tauri/
│       ├── src/
│       │   ├── main.rs                     ← entry, tray, spawns FastAPI, starts capture tasks
│       │   ├── capture/
│       │   │   ├── mod.rs
│       │   │   ├── clipboard.rs            ← 500ms poll, redacts secrets before SQLite write
│       │   │   ├── file_activity.rs        ← FSEvents via notify + 2 s debounce; reads file_watch_settings every 30 s; stores path only, never content
│       │   │   ├── system_state.rs         ← Darwin notify API; lock/unlock/sleep/wake → SQLite; macOS only
│       │   │   ├── app_lifecycle.rs        ← 10s osascript diff; launched/quit → SQLite
│       │   │   └── window.rs               ← 30s poll via osascript; idle timer writes is_user_active on each event
│       │   ├── hotkey.rs                   ← global hotkey (global-hotkey crate)
│       │   ├── db.rs                       ← SQLite pool (sqlx) — single pool, never recreate
│       │   └── commands.rs                 ← all #[tauri::command] — thin wrappers only
│       ├── Cargo.toml
│       ├── tauri.conf.json                 ← two windows: main (panel) + overlay (orb)
│       └── Info.plist                      ← LSUIElement = true — never remove
├── backend/
│   ├── main.py                             ← FastAPI entry, lifespan, asyncio loop start
│   ├── database.py                         ← async SQLite engine, FTS5 table + triggers
│   ├── scheduler.py                        ← while True: asyncio.sleep(1800) loop
│   ├── routes/
│   │   ├── capture.py                      ← POST /capture (extension only), GET /events
│   │   ├── recall.py                       ← POST /recall: FTS5 + Qdrant → Claude SSE
│   │   ├── privacy.py                      ← excluded apps CRUD, pause/resume, wipe
│   │   └── feedback.py                     ← POST /feedback
│   ├── services/
│   │   ├── claude_service.py               ← httpx singleton → Worker /chat
│   │   ├── gemini_service.py               ← httpx singleton → Worker /classify
│   │   ├── voyage_service.py               ← httpx singleton → Worker /embed
│   │   ├── qdrant_service.py               ← QdrantClient local file singleton
│   │   ├── time_parser.py                  ← extracts time ranges from natural language queries
│   │   ├── redaction_service.py            ← inline redaction for browser-captured text (page_text, search queries)
│   │   ├── analytics_service.py            ← PostHog Python singleton, fails silently
│   │   └── sentry_service.py               ← sentry_sdk.init(), only if DSN is set
│   ├── models/
│   │   ├── event.py                        ← Pydantic: CaptureEvent
│   │   └── session.py                      ← Pydantic: Session
│   ├── pyproject.toml
│   ├── uv.lock                             ← committed to git, never manually edited
│   └── .env                                ← gitignored (no AI provider keys here)
├── extension/
│   ├── manifest.json                       ← Manifest V3
│   ├── src/
│   │   ├── background.ts                   ← service worker, chrome.storage.session state; relays content.ts messages + url events
│   │   └── content.ts                      ← Readability extraction, search detection, link click capture
│   └── vite.config.ts
├── worker/
│   ├── src/index.ts                        ← /chat /classify /embed /tts /stt-token
│   └── wrangler.toml
├── landing/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx                        ← landing page (Server Component)
│   │   │   ├── layout.tsx                      ← root layout, metadata
│   │   │   ├── globals.css                     ← @import "tailwindcss" (Tailwind v4)
│   │   │   ├── favicon.ico
│   │   │   ├── not-found.tsx                   ← 404 page
│   │   │   └── privacy/
│   │   │       └── page.tsx                    ← privacy policy (Server Component)
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   │   ├── button.tsx                  ← ShadCN button
│   │   │   │   └── input.tsx                   ← ShadCN input
│   │   │   ├── background-orbit.tsx            ← animated background decoration
│   │   │   ├── header.tsx                      ← site header / nav
│   │   │   ├── footer.tsx                      ← site footer with links
│   │   │   └── waitlist-form.tsx               ← 'use client' waitlist form component
│   │   ├── emails/
│   │   │   └── waitlist-confirmation.tsx       ← React Email confirmation template
│   │   └── lib/
│   │       ├── supabase.ts                     ← singleton Supabase client (server-side)
│   │       ├── utils.ts                        ← shared utilities (cn, etc.)
│   │       └── waitlist-actions.ts             ← 'use server' Server Action: Zod → Supabase → Resend
│   └── [config files, package.json, etc.]
├── releases/
│   └── latest.json                         ← tauri-plugin-updater manifest
└── .github/workflows/
    └── release.yml                         ← build + sign .dmg on v* tag push
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
| State | Zustand — includes `conversationHistory: Message[]` |
| Crash reporting | `@sentry/react` + `@sentry/vite-plugin` |
| Analytics | `posthog-js` + `@posthog/react` (PostHogProvider in main.tsx) |
| Auto-updates | `tauri-plugin-updater` + `tauri-plugin-dialog` + `tauri-plugin-process` |

### Rust Crates
| Crate | Purpose |
|---|---|
| `arboard` | Clipboard polling |
| `sqlx` (sqlite + runtime-tokio) | SQLite connection pool — single pool, never recreate |
| `global-hotkey` | System-wide hotkey for push-to-talk (Phase 4) |
| `xcap` | Screenshots (Phase 3) |
| `reqwest` | HTTP client singleton — never create per request |
| `notify` + `notify-debouncer-full` | FSEvents file activity watcher — 2 s debounce, watches ~/Documents ~/Desktop ~/Downloads recursively |
| `uuid` | Event ID generation |
| `chrono` | Timestamps |
| `regex` | Sensitive pattern detection before SQLite write |
| `serde` + `serde_json` | Serialisation |
| `tokio` (full) | Async runtime |
| `tauri-plugin-updater` | Auto-updates via GitHub Releases |
| `tauri-plugin-dialog` | Native dialogs |
| `tauri-plugin-process` | App restart |

### Python Dependencies (uv only — never pip)
| Package | Purpose |
|---|---|
| `fastapi` | API framework |
| `uvicorn[standard]` | ASGI server |
| `sqlalchemy` + `aiosqlite` | Async SQLite |
| `pydantic` | Request/response schemas |
| `python-dotenv` | Env var loading |
| `httpx` | HTTP singleton → all Worker calls (Claude, Gemini, Voyage AI) |
| `qdrant-client` | Vector store, local file mode — no fastembed, no Docker |
| `apscheduler>=3.10,<4.0` | Session generation scheduler — `AsyncIOScheduler` from v3.x stable only |
| `posthog` | Backend analytics singleton |
| `sentry-sdk[fastapi]` | Crash reporting |

**Never install:**
`google-genai` `google-generativeai` `sentence-transformers` `torch`
`onnxruntime` `qdrant-client[fastembed]`

**APScheduler:** Use `apscheduler>=3.10,<4.0` (v3.x stable). Never install bare
`apscheduler` without a version pin — pip/uv may resolve to v4 pre-release.
Import path for v3.x: `from apscheduler.schedulers.asyncio import AsyncIOScheduler`.

### AI Models
| Task | Model | Route |
|---|---|---|
| User recall + conversation | Claude Sonnet 4 | Worker `/chat` |
| Background session summaries | Claude Haiku 4.5 | Worker `/chat` (cheaper) |
| Event classification | `gemini-3.1-flash-lite` | Worker `/classify` |
| Session embeddings | Voyage AI `voyage-3-lite` (512 dims) | Worker `/embed` |
| Voice STT (Phase 4) | Whisper.cpp → Apple Speech fallback | local only |
| Voice TTS (Phase 4) | Kokoro TTS → ElevenLabs Pro | local / Worker `/tts` |

### Storage
| Layer | Tool | Notes |
|---|---|---|
| Structured events | SQLite `~/.orbit/orbit.db` | All events, sessions, memory objects |
| Keyword search | SQLite FTS5 (built-in) | BM25, porter tokenizer. Indexes `raw_content, app_name, url, page_text` — article body is searchable. |
| Semantic search | Qdrant `~/.orbit/qdrant_storage/` | `QdrantClient(path=...)`, no Docker |

### Landing Page
| Layer | Tool | Notes |
|---|---|---|
| Framework | Next.js 16.2.7 | App Router ONLY — no Pages Router |
| Styling | Tailwind CSS v4 | `@import "tailwindcss"` in globals.css — no config file |
| Email | Resend + React Email | `'use server'` Server Actions pattern |
| Waitlist DB | Supabase Postgres | Service role key server-side only |
| Validation | Zod | All Server Action inputs validated before DB write |
| Deploy | Vercel | Root directory: `landing/` |

**Next.js 16 rules:**
- Server Components by default. `'use client'` only for event handlers/hooks.
- `'use server'` for mutations — no API routes for simple form actions.
- `await params` always — params are async in Next.js 16.

### Infrastructure
| Tool | Purpose |
|---|---|
| Cloudflare Worker | Proxy for ALL AI APIs. Keys never in app binary or on user machines. |
| Supabase | Waitlist DB (landing) + cloud sync opt-in (Phase 5) |
| PostHog | Privacy-safe analytics (anonymous device ID, no PII) |
| Sentry | Crash reporting (backend + frontend, two separate projects/DSNs) |
| Lemon Squeezy | Payments (Phase 5) |
| GitHub Releases | App distribution + auto-update server |

---

## Key Files

| File | Purpose |
|---|---|
| `app/src/instrument.ts` | Sentry init. **Must be the first import in main.tsx.** Only initialises if `VITE_SENTRY_DSN` is set. |
| `app/src/main.tsx` | First import: `./instrument`. Wraps app in `PostHogProvider` with `defaults: '2026-01-30'`, `autocapture: false`, `persistence: 'memory'`. |
| `app/src/components/OnboardingFlow.tsx` | 4-step first-launch: Welcome → Accessibility (polls every 3s until granted, auto-advances) → Chrome Extension → What to Expect. Blocks main UI until complete. |
| `app/src/components/ErrorBoundary.tsx` | Class component. Catches render errors → Sentry.captureException → friendly message → restart button. |
| `app/src/components/ChatPanel.tsx` | Recall UI. Reads `conversationHistory` from Zustand. Shows specific friendly error per failure type. Shows "still learning" message when no sessions exist. |
| `app/src/hooks/useRecall.ts` | POST /recall. Sends `conversation_history`. Appends each turn to Zustand store. Max 4 turns enforced here. |
| `app/src/hooks/useAnalytics.ts` | Wraps `usePostHog()`. All components call this — never import posthog-js directly. Strips forbidden property keys before capture. |
| `app/src/hooks/useOnboarding.ts` | Checks accessibility permission on mount. Polls every 3s while onboarding screen is open. Persists completion state. |
| `app/src/hooks/usePrivacySettings.ts` | Loads privacy settings in parallel on mount (capture status, excluded apps, excluded domains, file-watch settings). Exposes `setFileWatchEnabled`, `addWatchedFolder`, `removeWatchedFolder` alongside existing app/domain CRUD. `normalizeDomain()` strips URL to bare hostname before any API call. |
| `app/src/store/orbitStore.ts` | Zustand global state. Key: `conversationHistory: ConversationMessage[]` — reset on new topic, preserved within session. |
| `app/src-tauri/src/main.rs` | Entry point. Sets LSUIElement, system tray, spawns FastAPI subprocess, creates SQLite pool, starts clipboard + window capture as tokio tasks. Health-checks FastAPI on startup (10 retries, 1s each). |
| `app/src-tauri/src/capture/clipboard.rs` | 500ms poll. Runs `detect_sensitive_content_type()` before writing. Stores `[REDACTED:type]` for matches. Deduplicates same content within 5 minutes. |
| `app/src-tauri/src/capture/window.rs` | 30s poll via osascript. Only writes when title changes. On each poll calls `CGEventSourceSecondsSinceLastEventType` (macOS CoreGraphics — IDLE TIMER ONLY, never keystroke content) to set `is_user_active` (1 = input within last 60 s, 0 = idle). Fails silently on permission errors. |
| `app/src-tauri/src/capture/file_activity.rs` | FSEvents file activity monitor using `notify` + `notify-debouncer-full`. 2-second debounce. Reads `file_watch_settings` from SQLite on startup and every 30 s via `tokio::select!`; syncs the watcher using a `currently_watched: HashSet<String>` diff. Skips hidden files/dirs, blocked high-noise directories (node_modules, target, build, etc.), and transient file suffixes (.tmp, .swp, .lock, .log). Writes `file_activity` events with `file_path` and `metadata={"action":"created|modified|removed"}`. NEVER reads file contents. |
| `app/src-tauri/src/capture/system_state.rs` | macOS system state monitor. Uses `notify_register_file_descriptor` (Darwin C API in libSystem — no new crates). Registers 4 Darwin notifications: `com.apple.screenIsLocked` → "lock", `com.apple.screenIsUnlocked` → "unlock", `com.apple.system.willsleep` → "sleep", `com.apple.system.didwake` → "wake". Each fd gets a dedicated blocking OS thread; events bridge to tokio via `mpsc::unbounded_channel`. Writes `type='system_state'` events with `raw_content=<state>` and `metadata={"state":"..."}`. No-op on non-macOS. |
| `app/src-tauri/src/capture/app_lifecycle.rs` | App launch/quit monitor. Polls running process names every 10 s via `osascript` (`System Events`), diffs against the previous snapshot. Writes `type='app_lifecycle'` events with `app_name` and `metadata={"action":"launched"|"quit"}`. Initial snapshot taken before the first sleep so apps already running at startup are not emitted as launches. |
| `app/src-tauri/src/db.rs` | sqlx SQLite pool. **Single pool shared everywhere. Never open new connections.** |
| `app/src-tauri/src/commands.rs` | All `#[tauri::command]` functions — thin wrappers only. Logic lives in modules. |
| `app/src-tauri/Info.plist` | `LSUIElement = true`. Never remove. Orbit never appears in the dock. |
| `app/src-tauri/tauri.conf.json` | Two windows: `main` (panel, skipTaskbar, transparent, decorations:false) and `overlay` (Phase 4: fullscreen, alwaysOnTop, focus:false, transparent). |
| `backend/main.py` | FastAPI with `@asynccontextmanager` lifespan. Inits Sentry, starts `asyncio.create_task(start_session_generation_loop())`. No APScheduler. GET /health endpoint. |
| `backend/database.py` | SQLAlchemy async engine. Creates all tables + FTS5 virtual table + auto-sync triggers on startup. Events schema includes `page_text`, `link_target`, `metadata`, `file_path`, `is_user_active` (Phase 2.6). FTS5 indexes 4 columns: `raw_content, app_name, url, page_text`. Sessions schema includes `last_action`, `key_resources`, `topics`, `active_minutes`. `file_watch_settings` table (single row) seeded with enabled=true and default folders. `excluded_domains` seeded with `mail.google.com`, `accounts.google.com`. `fetch_system_state_events()` for break/duration recall queries. `search_events_fts()` accepts `start_ms`, `end_ms`, `exclude_personal`. |
| `backend/scheduler.py` | `AsyncIOScheduler` (APScheduler v3.x stable). `create_session_scheduler()` returns a configured scheduler with 30-min interval and `next_run_time=now` so first run is immediate. `generate_sessions_from_recent_events()`: fetch → `_split_events_at_system_boundaries()` (splits on lock/sleep, marks boundary events `session_id='system_boundary'`) → per batch: classify (Gemini) → summarise (Claude Haiku) → embed (Voyage) → mark processed. Event payload to Claude is type-aware; `file_activity` sends `file_path, action`. `active_minutes` computed from `is_user_active` window events. SQL SELECTs include `file_path, is_user_active`. `_ensure_sessions_schema_columns_exist()` adds `topics`, `active_minutes` columns to existing databases on startup. |
| `backend/routes/recall.py` | FTS5-first sequential pipeline. (1) Classify intent → "work"/"personal"/"general". (2) Parse time reference via `time_parser`. (3) `_query_asks_about_time_or_breaks()` — if true, fetches `system_state` events from DB and adds BREAK/SYSTEM section to context. (4) FTS5 keyword search always runs (offline-safe). (5) Try Worker: Qdrant semantic search → time-window filter → re-rank → Claude SSE stream. Context block formats events by type: `file_activity` → `Worked on file: <name> (<action>) — <path>`; `system_state` → human-readable break label; `active_minutes` shown in session block. Session block also shows `Topics:`, `Active time:`. |
| `backend/routes/capture.py` | POST /capture (extension only — Rust writes direct). Checks pause state, excluded app names, and excluded domains (all cached 30s). Domain extracted via `urlparse().netloc` before every browser event. `page_text` for `page_content` events and `raw_content` for `search_query` events are passed through `redact_sensitive_content()` before INSERT. GET /events for timeline. |
| `backend/routes/privacy.py` | Excluded apps CRUD, pause/resume, capture status, full data wipe (SQLite + Qdrant). `GET/POST/DELETE /privacy/excluded-domains` — domain exclusion CRUD. `GET/POST /privacy/file-watching` — enable/disable file activity capture. `POST/DELETE /privacy/watched-folders` — add/remove watched folder paths (JSON body). |
| `backend/routes/feedback.py` | POST /feedback — stores rating + comment in SQLite. |
| `backend/services/claude_service.py` | Singleton `httpx.AsyncClient`. POST to `WORKER_URL/chat`. Handles SSE streaming. Uses Claude Haiku for session gen, Claude Sonnet for recall. Accepts `conversation_history` param. |
| `backend/services/gemini_service.py` | Singleton `httpx.AsyncClient`. POST to `WORKER_URL/classify`. Builds Gemini REST API body. Extracts text from `candidates[0].content.parts[0].text`. Sends `id, type, app_name, url, raw_content` — raw_content is already redacted at capture, so it's safe and needed for accurate classification. Falls back to `category='work'` if JSON parse fails. |
| `backend/services/voyage_service.py` | Singleton `httpx.AsyncClient`. POST to `WORKER_URL/embed`. Body: `{"input": [text], "model": "voyage-3-lite", "input_type": "document"}`. Returns 512-dim float list. |
| `backend/services/time_parser.py` | Standard-library time reference parser (no third-party deps). `extract_time_range_from_query(query, now_ms)` checks 11 patterns most-specific-first (e.g. "yesterday morning" before "yesterday") and returns `{"start_ms": int, "end_ms": int, "label": str}` or `None`. Used by `recall.py` to filter both FTS5 and Qdrant results to a concrete time window. |
| `backend/services/redaction_service.py` | Inline sensitive-content redaction for browser-captured text. Ports Rust clipboard patterns as `re.sub()` — replaces only matched substrings (preserves article context). All 7 pattern steps run on every call. JWT uses `eyJ` anchor to avoid false positives in long text. API key pattern uses negative lookbehind + 8-char minimum body. Called by `capture.py` for `page_text` and search `raw_content` before DB write. |
| `backend/services/qdrant_service.py` | `QdrantClient(path=~/.orbit/qdrant_storage)` singleton. Collection `orbit_sessions`, 512 dims, cosine. Raw vector upsert (no fastembed). `add_session_embedding()` + `search_sessions_semantic()`. |
| `backend/services/analytics_service.py` | PostHog Python singleton. Device ID in `~/.orbit/device_id`. Strips forbidden property keys. try/except on every call — never crashes the app. |
| `backend/services/sentry_service.py` | `sentry_sdk.init()` with `enable_logs=True`, `send_default_pii=False`. Only runs if `SENTRY_DSN` is set in env. |
| `extension/src/background.ts` | MV3 service worker. All state in `chrome.storage.session` (never global vars). Emits bare `url` events on tab navigation (deduped by `lastSentUrl`). Handles three content-script message types: `page_content`, `search_query`, `link_click` — relays them to POST /capture. `onMessage` callback is synchronous (fire-and-forget) to keep the MV3 message channel intact. Fails silently when backend unreachable. |
| `extension/src/content.ts` | Runs in every page context. 5-second visibility filter — pages the user bounced off are discarded. On threshold: detects search queries first (Google, YouTube, Bing, DuckDuckGo); otherwise runs `@mozilla/readability` on a DOM clone to extract article body (≤2 000 chars), author, site_name, excerpt. Sends `page_content` or `search_query` to the background worker on tab departure (`visibilitychange` + `pagehide`). Left-click listener captures `link_click` events with 500 ms debounce. |
| `extension/package.json` | Runtime dep: `@mozilla/readability@^0.6.0` — ships own `index.d.ts`; do **NOT** install `@types/mozilla-readability` (conflicts). DevDeps: `@crxjs/vite-plugin`, `@types/chrome`, `typescript`, `vite`. |
| `worker/src/index.ts` | Five routes: `/chat` → Claude, `/classify` → Gemini REST, `/embed` → Voyage AI, `/tts` → stub, `/stt-token` → stub. All secrets in Cloudflare env. CORS headers on every response. |
| `landing/src/app/page.tsx` | Landing page — Server Component. Uses header, footer, background-orbit, waitlist-form. |
| `landing/src/app/privacy/page.tsx` | Privacy policy — Server Component. What's captured, what's sent to cloud, user controls. |
| `landing/src/components/waitlist-form.tsx` | `'use client'` — handles form state, calls `joinWaitlist` Server Action, shows success/error state. |
| `landing/src/components/background-orbit.tsx` | Animated background decoration. |
| `landing/src/components/header.tsx` | Site header / navigation. |
| `landing/src/components/footer.tsx` | Footer with links to privacy, social, GitHub. |
| `landing/src/lib/supabase.ts` | Singleton Supabase client (service role, server-side only — never exposed to client). |
| `landing/src/lib/waitlist-actions.ts` | `'use server'`. Zod validation → Supabase insert → Resend confirmation. Never exposes DB errors to client. |
| `landing/src/lib/utils.ts` | Shared utilities — `cn()` for Tailwind class merging, etc. |
| `landing/src/emails/waitlist-confirmation.tsx` | React Email confirmation template sent via Resend. |

---

## Memory Architecture

### Tier 1 — Raw Events

```sql
events(
  id           TEXT PRIMARY KEY,
  timestamp    INTEGER NOT NULL,    -- unix milliseconds
  type         TEXT NOT NULL,       -- 'clipboard' | 'window' | 'url'
                                    --   | 'page_content' | 'search_query' | 'link_click'
                                    --   | 'file_activity' | 'system_state' | 'app_lifecycle'
  raw_content  TEXT,                -- secrets replaced with [REDACTED:type] at capture;
                                    --  safe redacted content IS forwarded to Gemini + Claude.
                                    --  for page_content: page title. for search_query: query text.
                                    --  for link_click: visible anchor text.
  app_name     TEXT,
  url          TEXT,
  source       TEXT NOT NULL,       -- 'rust' | 'extension'
  session_id   TEXT,                -- null until processed by scheduler
  category     TEXT,                -- Gemini output: work/research/personal/system/communication
  page_text    TEXT,                -- readable article body (page_content events);
                                    --  capped at 2 000 chars; redacted by redaction_service before storage
  link_target  TEXT,                -- destination URL (link_click events)
  file_path    TEXT,                -- absolute path (file_activity events only; contents never read)
  is_user_active INTEGER,           -- 1 = user input within last 60 s at capture time (window events);
                                    --   0 = idle; NULL for all other event types
  metadata     TEXT                 -- JSON: {author, site_name, excerpt, time_on_page} for page_content;
                                    --       {search_engine, time_on_page} for search_query;
                                    --       {link_text} for link_click;
                                    --       {action: 'created'|'modified'|'removed'} for file_activity;
                                    --       {state: 'lock'|'unlock'|'sleep'|'wake'} for system_state;
                                    --       {action: 'launched'|'quit'} for app_lifecycle
)
```

Retained 90 days. Same clipboard content within 5 min is deduplicated.
Force-processed after 2h if still null session_id.

### Tier 2 — Sessions

```sql
sessions(
  id            TEXT PRIMARY KEY,
  start_time    INTEGER NOT NULL,
  end_time      INTEGER NOT NULL,
  project_name  TEXT,
  goal          TEXT,
  ai_summary    TEXT,            -- Claude's plain-text 2-3 sentence session summary
  last_action   TEXT,            -- most recent meaningful thing the user did
  key_resources TEXT,            -- JSON array of important URLs / file paths
  topics        TEXT,            -- JSON array of subject areas ("vector databases", "tax filing" …)
                                 --  included in Qdrant embedding text for subject-based recall
  active_minutes INTEGER,        -- lower-bound estimate: count of is_user_active=1 window events × 30 s ÷ 60
                                 --  lower-bound because window tracker only fires on title change
  embedding_id  TEXT             -- Qdrant point ID
)
```

Session boundaries break on: (a) `system_state` lock/sleep events (primary — scheduler splits here first), (b) 30-min time window, or (c) project change detected mid-batch by Gemini. System_state boundary events are marked `session_id='system_boundary'` immediately so they are never re-classified on the next scheduler run.

### Tier 3 — Memory Objects (Phase 3)

Long-term condensed knowledge. Adjacent same-project sessions within 4h merged into
coherent narratives. Stored in `memory_objects` table.

---

## Recall System Prompt

```python
RECALL_SYSTEM_PROMPT = """\
You are Orbit, the user's personal AI memory. You've been quietly watching
everything they work on. You know their projects, their patterns, their
unfinished tasks. Respond like a trusted colleague who genuinely cares
about helping them pick up where they left off — warm, specific, honest.

Rules:
- Be specific. Name actual files, URLs, project names from the context.
- Be honest. If the context doesn't answer the question, say so clearly.
  Never guess or make things up.
- Connect the dots. If the question relates to a previous session, say so:
  "This looks related to what you were debugging on Tuesday."
- Keep it concise. One structured answer, not an essay.
- If they seem to be resuming a task, proactively remind them where they
  left off — even if they didn't explicitly ask.
- Never use developer-specific language. Respond in plain language anyone
  can understand, adapted to the context of what the user was actually doing.
- When the user asks about things they watched, read, or browsed for leisure,
  include the actual links (URLs) so they can revisit them.

Format: start with 📌 [time + context anchor], then the specific answer,
then supporting details only if genuinely useful. Skip any section that
has nothing real to say.\
"""
```

Session summary prompt (background, Claude Haiku 4.5):

```python
SESSION_SYSTEM_PROMPT = """\
You are summarizing a user's computer activity session.
Be concise and specific. Return valid JSON only. No markdown, no preamble.
Use plain language — avoid technical jargon. The summary should make sense
to anyone, not just technical users.\
"""
```

---

## User-Facing Language Rules

Orbit is for everyone. Never use technical terms in any user-facing copy.

| Instead of | Say |
|---|---|
| "Session generated" | "I've summarised your morning" |
| "Event captured" | "I noticed this" / "I saw this" |
| "Semantic search" | (never mention) |
| "Embedding model" | (never mention) |
| "FTS5 keyword search" | (never mention) |
| "Accessibility permission" | "Allow Orbit to see which app you're using" |
| "Active window tracking" | "Watching what you work on" |
| "Vector database" | (never mention) |
| Error: no sessions yet | "I'm still learning your patterns — give me a couple of hours and ask again." |

---

## Security & Privacy Rules

Non-negotiable. Every feature passes through these.

### Clipboard Redaction (Rust — before any DB write)

| Pattern | Stored as |
|---|---|
| PEM private keys | `[REDACTED:private_key]` |
| API key prefixes: `sk-` `AIza` `AKIA` `xoxb-` `ghp_` `pk_live_` `sk_live_` `pa-` | `[REDACTED:api_key]` |
| JWTs (3 base64 segments, each >10 chars, no spaces) | `[REDACTED:jwt_token]` |
| Credit cards (13–19 digits, optional spaces/dashes) | `[REDACTED:credit_card]` |
| SSNs (`\d{3}-\d{2}-\d{4}`) | `[REDACTED:ssn]` |
| Crypto addresses (Bitcoin, Ethereum) | `[REDACTED:crypto_address]` |

Event is still written — Orbit knows you copied something from which app, not what.

### AI Context Rules

**The principle:** Secrets are redacted at capture time (Rust). Everything that
reaches the database is already safe. AI services need real content to write
useful summaries — app names alone are meaningless. So we DO send content, but
only content that has already passed through redaction.

- **Gemini (classification)** receives: `id, type, app_name, url, raw_content`
  (raw_content is already redacted — `[REDACTED:type]` for any secret). Gemini
  needs the content to classify accurately ("is this work or personal?").
- **Claude (session summaries)** receives: classified events with `app_name`,
  `url`, `window title`, and `raw_content` — all already redacted. Claude needs
  this to write a summary that actually describes what the user did.
- **Claude (recall)** receives: session summaries + matching events (window
  titles, URLs, redacted clipboard content).

**What makes this safe:**
- Secrets never reach the database — redaction happens in `clipboard.rs` before
  any write. By the time AI sees content, `sk-abc123` is already `[REDACTED:api_key]`.
- Password manager and banking app events never captured (exclude list).
- `category = 'personal'` events excluded from work recall context.
- All AI calls go through the Cloudflare Worker over encrypted HTTPS.
- Nothing is stored on the AI providers' side (no training, stateless calls).

**What is still never sent:**
- Raw secret values (they don't exist past the redaction layer).
- Personal-category events in response to work queries.

### Python Redaction (Browser Content — before any DB write)

`backend/services/redaction_service.py` applies the same pattern set as Rust's `clipboard.rs`
but uses inline `re.sub()` — replaces only the matched substring so surrounding article context
is preserved. Applied in `capture.py` before INSERT for two event types:

| Event type | Field redacted |
|---|---|
| `page_content` | `page_text` |
| `search_query` | `raw_content` (the typed query) |

All patterns run on every call (unlike Rust which returns on the first match, since it replaces
the whole clipboard value anyway). The JWT pattern uses an `eyJ` anchor to avoid false positives
in long-form text. API key pattern uses a negative lookbehind `(?<![A-Za-z0-9_])` + 8-char
minimum body to avoid mid-word false matches.

### App Exclude List

Default: `1Password, Bitwarden, Keychain Access, LastPass, Dashlane, System Settings`

### Domain Exclude List

`excluded_domains` table in SQLite. Seeded with `mail.google.com`, `accounts.google.com` on
first run. Users manage their own list via PrivacyPanel ("Excluded Websites" section) or directly
via the API. The domain check in `capture.py` uses the same 30-second in-memory cache as the
app exclude list — any browser event (`url`, `page_content`, `link_click`, `search_query`) whose
URL hostname matches a listed domain is silently dropped before any data is written.

### File Watching Privacy Controls

`file_watch_settings` table (single row, id=1) in SQLite:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | INTEGER | 1 | 0 = all file activity monitoring stopped |
| `watched_folders` | TEXT (JSON array) | `[]` → seeded to Documents/Desktop/Downloads on first run | Absolute paths watched by FSEvents |

`file_activity.rs` reads this table on startup and re-reads it every 30 seconds via `tokio::select!`. If `enabled = 0` the desired folder set is empty and all active watches are unwatched. If the folder list changes, only the delta is acted on (`unwatch` removed paths, `watch` added paths) — the debouncer is never recreated.

User controls via `PrivacyPanel.tsx → FileActivitySection`:
- Toggle switch — calls `POST /privacy/file-watching`
- Watched folder list with remove buttons — calls `DELETE /privacy/watched-folders` (JSON body)
- "Add folder" button — calls Tauri's `open({ directory: true })` plugin dialog, then `POST /privacy/watched-folders`

### Other Rules
- All data local by default. Cloud sync opt-in, Phase 5 only.
- No AI provider keys on user machines — Worker secrets only.
- One-click full memory wipe (PrivacyPanel).
- User can view/delete any stored item (MemoryViewer).

---

## Cloudflare Worker

All AI calls go through the Worker. No exceptions.

| Route | Upstream | Status |
|---|---|---|
| `POST /chat` | `api.anthropic.com/v1/messages` | ✅ Live |
| `POST /classify` | Gemini Flash REST API | ✅ Live |
| `POST /embed` | `api.voyageai.com/v1/embeddings` | ✅ Live |
| `POST /tts` | ElevenLabs | 🔲 Stub (Phase 4) |
| `POST /stt-token` | STT provider | 🔲 Stub (Phase 4) |

**Wrangler secrets:** `ANTHROPIC_API_KEY` `GEMINI_API_KEY` `VOYAGE_API_KEY` `ELEVENLABS_API_KEY` (Phase 4)

```bash
cd worker
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put VOYAGE_API_KEY
npx wrangler deploy
```

**worker/.dev.vars (gitignored):**
```
ANTHROPIC_API_KEY=your_key
GEMINI_API_KEY=your_key
VOYAGE_API_KEY=your_key
```

---

## Environment Variables

**Rule:** AI provider keys → Cloudflare Worker secrets only. Backend `.env` has no AI keys.

### backend/.env (gitignored)
```
WORKER_URL=https://your-worker.workers.dev
SENTRY_DSN=your_backend_sentry_dsn
POSTHOG_API_KEY=phc_your_key
POSTHOG_HOST=https://us.i.posthog.com
ORBIT_DB_PATH=~/.orbit/orbit.db
QDRANT_STORAGE_PATH=~/.orbit/qdrant_storage
APP_ENVIRONMENT=beta
APP_VERSION=0.1.0
PORT=8000
```

### app/.env (gitignored — VITE_* vars bundled into binary)
```
VITE_SENTRY_DSN=your_frontend_sentry_dsn
VITE_APP_ENVIRONMENT=beta
VITE_APP_VERSION=0.1.0
VITE_POSTHOG_PROJECT_KEY=phc_your_key
VITE_POSTHOG_HOST=https://us.i.posthog.com
SENTRY_ORG=your_org_slug
SENTRY_PROJECT=orbit-frontend
SENTRY_AUTH_TOKEN=your_token  ← build-time only, also add to GitHub Actions secrets
```

### GitHub Actions secrets (never in code or binary)
```
SENTRY_AUTH_TOKEN
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
APPLE_ID, APPLE_TEAM_ID, APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD
```

---

## Build & Run

```bash
# Backend
cd backend && uv sync
uv run uvicorn main:app --reload --port 8000

# Tauri desktop app
cd app && pnpm install && pnpm tauri dev

# Chrome Extension (build once, then reload in chrome://extensions)
cd extension && pnpm install && pnpm build

# Cloudflare Worker (local dev)
cd worker && npx wrangler dev

# Landing page
cd landing && pnpm install && pnpm dev

# Production .dmg
cd app && pnpm tauri build
```

**Packages:**
```bash
# Python — always uv, never pip
uv add <package>    # adds to pyproject.toml + uv.lock
uv remove <package>

# JS
pnpm add <package>

# Rust — edit Cargo.toml directly, rebuilt on next tauri dev
```

**Force session generation (dev):**
```bash
cd backend && uv run python -c "
from scheduler import generate_sessions_from_recent_events
import asyncio; asyncio.run(generate_sessions_from_recent_events())"
```

---

## Tauri Patterns

### IPC: React → Rust
```typescript
// Always via a wrapper hook — never invoke() directly in components
import { invoke } from '@tauri-apps/api/core';
const events = await invoke<CaptureEvent[]>('get_recent_events', { limitCount: 50 });
```
```rust
#[tauri::command]
async fn get_recent_events(
    limit_count: u32,
    db_pool: State<'_, DatabasePool>
) -> Result<Vec<CaptureEvent>, String> {
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
let overlay = app.get_webview_window("overlay").unwrap();
overlay.set_ignore_cursor_events(true).unwrap(); // fully click-through
overlay.set_always_on_top(true).unwrap();        // above everything
// focus: false in tauri.conf.json — never steals keyboard focus
```

---

## macOS Permissions

| Permission | Why | When |
|---|---|---|
| Accessibility | Active window tracking | Phase 0 — required at first launch |
| Screen Recording | Screenshots | Phase 3 |
| Microphone | Voice input | Phase 4 |

Open System Settings directly — never make users find it themselves.
Onboarding polls `check_accessibility_permission_granted()` every 3 seconds
and auto-advances when granted.

---

## Code Style & Conventions

### Universal
- Clarity over concision. Names self-explanatory with zero codebase context.
- Long descriptive names. No single-char variables. No unexplained abbreviations.
- Comments explain **why**, not what.
- **Never add features, refactors, or improvements beyond exact scope asked.**
- Never add docstrings or comments to code you didn't change.

### Rust
- `async/await` throughout — no blocking on async executor.
- Singleton `reqwest::Client` in `State<>` — never create per request.
- `db.rs` pool only — never open new SQLite connections.
- `commands.rs` = thin wrappers. Logic in modules.
- `Result<T, String>` from commands, `.map_err(|e| e.to_string())`.

### TypeScript / React
- Functional components + hooks. No class components (except `ErrorBoundary`).
- No `any`. All types in `types/`.
- All `invoke()` calls in `hooks/`. Never in components.
- All PostHog calls via `useAnalytics()`. Never import posthog-js in components.
- Zustand only for global state. No prop drilling beyond 2 levels.
- Tailwind utility classes. No inline styles.

### Python / FastAPI
- Type hints on every function.
- Pydantic models for all schemas in `models/`.
- All routes `async def`.
- `httpx.AsyncClient` — singleton, never per request.
- `QdrantClient` — singleton, never per request.
- Routes call services. Zero business logic in routes.
- `uv add` always. Never `pip install`.

### Chrome Extension
- TypeScript only.
- State in `chrome.storage.session` only — never global variables.
- Fail silently when backend is unreachable.

---

## DO NOT

- Add features, refactors, or improvements beyond exact scope.
- Call Gemini, Voyage AI, or Claude directly — all go through Cloudflare Worker.
- Create new `httpx.AsyncClient`, `QdrantClient`, or `reqwest::Client` per request.
- Put `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or `VOYAGE_API_KEY` in any `.env` file — Worker secrets only.
- Install `google-genai` `google-generativeai` `sentence-transformers` `torch` `onnxruntime` `qdrant-client[fastembed]`.
- Install APScheduler v4 (`from apscheduler import AsyncScheduler`) — pre-release, unstable. Use v3.x only (`from apscheduler.schedulers.asyncio import AsyncIOScheduler`).
- Use `pip install` — always `uv add`.
- Put API keys in source code, committed files, or app binary.
- Remove `LSUIElement = true` from Info.plist.
- Set `focus: true` on the overlay window.
- Send raw secret values to any AI — but redacted `raw_content` (window titles, URLs, safe clipboard text) IS sent; secrets are already stripped at capture time.
- Capture from password managers or banking apps (exclude list).
- Include `category = 'personal'` events in work recall context.
- Pass more than 4 turns in `conversation_history` — token cost.
- Use global variables in the Chrome Extension service worker.
- Write sync FastAPI route handlers.
- Use `any` in TypeScript.
- Call posthog-js directly in components — use `useAnalytics()`.
- Use developer-specific language in any user-facing copy.
- Run `xcodebuild` from the terminal — invalidates TCC permissions.
- Log, store, or transmit keystroke content, key codes, mouse coordinates, or click targets. `CGEventSourceSecondsSinceLastEventType` is an IDLE TIMER ONLY — it returns seconds since last event, never what the event was.
- Capture audio or microphone input before Phase 4. Phase 4 requires explicit user permission at the macOS prompt.
- Capture screen contents or take screenshots before Phase 3. Phase 3 requires explicit Screen Recording permission.
- Capture network connections, DNS queries, HTTP request bodies, or OS audit logs — these are never part of Orbit's data model.

---

## Git Workflow
- Branches: `feature/short-description` or `fix/short-description`
- Commits: imperative mood, explain the *why*
- Never force-push to `main`

---

## Self-Update Instructions

Update when changes affect architecture, conventions, or build:
1. New files → monorepo structure + key files table
2. Deleted files → remove from both
3. New packages → tech stack table + remove from Never Install if applicable
4. New AI routes → Cloudflare Worker table
5. Architecture changes → data flow diagrams + Critical Architecture Facts
6. New env vars → environment variables section
7. New DO NOT rules → DO NOT section

Do NOT update for bug fixes or minor changes with no architectural impact.