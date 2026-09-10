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

**Completed phases:** Phase 0 ✅ Phase 1 ✅ Phase 2 ✅ Pre-beta hardening ✅ Phase 2.5 ✅ Phase 2.6 ✅ Phase 2.7 ✅ Phase 2.9 ✅ Phase 3 Pre-Beta UI ✅

---

## Critical Architecture Facts
**Read before writing any code. Most common points of confusion.**

| Fact | Detail |
|---|---|
| **ALL AI goes through the Cloudflare Worker** | Claude, Gemini, Groq, AND Voyage AI all route through the Worker. No direct AI API calls anywhere except the Worker itself. This keeps all API keys off user machines. |
| **Worker routes** | `/chat` → Claude. `/classify` → Gemini Flash. `/chat-groq` → Groq (OpenAI-compatible). `/embed` → Voyage AI. `/provider-status` → admin kill switch status (GET, no auth). `/tts` → ElevenLabs (stub). `/stt-token` → STT (stub). |
| **No AI API keys in backend/.env** | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `VOYAGE_API_KEY`, `GROQ_API_KEY` live in Cloudflare Worker secrets ONLY. `backend/.env` has no AI provider keys. |
| **Groq is Orbit's default AI provider (beta)** | Session generation, event classification, AND recall (user-facing chat) all run on Groq — `services/groq_service.py` on the backend. Centrally funded via the Worker's own `GROQ_API_KEY` secret, **not BYOK**: the backend never requires a per-user key. The still-functional but UI-less override (`database.get_groq_api_key()` / `POST /settings/groq-key`) is stored in the macOS Keychain (`com.heyorbit.orbit` / `groq-api-key`), not SQLite; it is read only immediately before the backend sends `X-Groq-Api-Key`. Otherwise the Worker falls back to its own shared secret. Models: `openai/gpt-oss-120b` (session summaries, `reasoning_effort: "low"` — it's a reasoning model whose chain-of-thought otherwise eats the max_tokens budget before writing the answer), `llama-3.1-8b-instant` (classification — cheap/fast, but has an observed repetition-loop tendency on long single-shot lists; classification groups are capped at 30 events for this reason, a quality ceiling not a rate limit), `llama-3.3-70b-versatile` (recall, OpenAI-compatible streaming — different SSE wire format from Claude's `content_block_delta`, needs its own parser: `stream_recall_response_groq()`). |
| **Admin kill switch (Claude / Gemini / Groq)** | Three independent Cloudflare Worker secrets — `CLAUDE_ENABLED`, `GEMINI_ENABLED`, `GROQ_PROXY_ENABLED` — each gate their route server-side, returning HTTP 503 when set to the literal string `"false"` (absent/unset = enabled, fail-open). Flip with `npx wrangler secret put CLAUDE_ENABLED` from `worker/` — takes effect on the next request, no redeploy. Every backend AI call already treats a non-2xx response as "provider unavailable" and degrades gracefully (session-gen skips the batch via the `parse_failed` circuit breaker, classification defaults events to `work`, recall falls back to the offline FTS5 message) — **no backend code change is ever needed to use the kill switch**, only the Worker secret. Read-only status is exposed to the app via `GET /settings/provider-status` (backend proxy of the Worker's `/provider-status`) and rendered in PrivacyPanel's "AI Provider" section — 3 status rows, no user controls. Currently live: Claude and Gemini disabled, Groq enabled (beta cost control — Claude/Gemini are Orbit-funded per-token; Groq's shared key is dramatically cheaper, see Tech Stack). |
| **google-genai SDK not installed** | Gemini is called via `httpx` → Worker `/classify`. The `google-genai` package is not a dependency. |
| **APScheduler v3.x (stable)** | Session generation uses `AsyncIOScheduler` from `apscheduler.schedulers.asyncio` — this is v3.x stable. Import path: `from apscheduler.schedulers.asyncio import AsyncIOScheduler`. Never use APScheduler v4 (`from apscheduler import AsyncScheduler`) — that is explicitly pre-release and unstable. |
| **Rust writes SQLite directly** | Clipboard + window + file_activity + browser_url events → SQLite directly from Rust. Never through FastAPI. Only the Chrome Extension POSTs to FastAPI. `unified_poller.rs` writes `type='url', source='native_browser'` events. |
| **No Docker for Qdrant** | `QdrantClient(path="~/.orbit/qdrant_storage")` local file mode. No server, no Docker. |
| **Secrets redacted at capture, content flows to AI** | Clipboard secrets become `[REDACTED:type]` in `clipboard.rs` BEFORE any DB write. After that, `raw_content` (window titles, URLs, safe clipboard text) IS sent to Gemini and Claude — they need it to write useful summaries. App names alone are meaningless. The redaction layer is what makes this safe. |
| **Native browser URL capture (Rust)** | `unified_poller.rs` polls the active browser tab every 8 s (combined with window + app lifecycle in a single osascript call). Supports Chrome, Safari, Arc, Brave Browser, Microsoft Edge (not Firefox). Requires macOS Automation permission. Sets `pub static BROWSER_AUTOMATION_DENIED: AtomicBool` when error -1743 fires; clears on next success. Writes `type='url', source='native_browser'` directly to SQLite. |
| **Two-layer browser capture** | Native (default, no install) captures URL + page title via osascript. Extension (optional, richer) captures `page_content`, `search_query`, `link_click` plus article body. Both can be active simultaneously. Native toggled via `browser_capture_settings.native_enabled`; extension is independent. |
| **Browser event dedup (10-second window)** | When a `url` event arrives at FastAPI `/capture`, `_find_recent_url_event()` queries `events(url, timestamp)` using `idx_events_url_timestamp`. Extension beats native_browser: new native dropped if extension exists within 10 s; new extension DELETEs existing native. Safety-net dedup also in `scheduler.py` + `recall.py` (page_text-present wins; else first occurrence). |
| **`browser_capture_settings` table** | Single row (id=1): `native_enabled INTEGER NOT NULL DEFAULT 1`. Seeded by FastAPI on startup. `unified_poller.rs` reads this every 30 s — fallback to `true` if absent. Managed via `GET/POST /privacy/browser-capture`. |
| **Automation permission for native browser capture** | macOS Automation permission must be granted for osascript to read browser tab URLs. Requested at onboarding Step 2 of 5 (always skippable). Three Tauri commands in `lib.rs`: `check_browser_automation_permission`, `trigger_browser_automation_prompt`, `open_automation_system_settings`. |
| **Recall uses query intent classification** | `classify_query_intent()` in `recall.py` returns "work", "personal", or "general". Only a "work"-intent query excludes `category = 'personal'` events from FTS5 results. "personal" queries include all events and prompt Claude to surface URLs. "general" (the default when no clear signal is present, or when both signals fire) includes everything. |
| **Recall has offline FTS5 fallback** | FTS5 keyword search always runs first (local, no network). If the Cloudflare Worker is unreachable (`httpx.ConnectError` / `TimeoutException`), Qdrant + Claude are skipped and FTS5 results are streamed as a plain offline message. |
| **Recall parses time references** | `time_parser.extract_time_range_from_query()` scans the query for phrases like "yesterday", "this morning", "last week". When matched, FTS5 is timestamp-filtered; for Qdrant, a DB-first strategy is used instead of pure semantic search (see below). |
| **Time-range recall uses DB-first session lookup** | For queries with a time reference ("yesterday", "today", etc.) Qdrant semantic similarity is the wrong ranking signal — every project worked on is equally relevant. `recall.py` calls `fetch_sessions_by_time_range()` in `database.py` as the primary source: it returns the best session per distinct `project_name` within the window (ordered by active_minutes DESC then duration DESC). Qdrant results fill remaining slots (up to 12 total) for any projects the DB scan missed. This prevents one noisy project (e.g. hundreds of Xcode build sessions) from crowding out every other project the user touched that day. |
| **Conversation history is stateful** | Last 4 turns kept in Zustand, passed with every `/recall` request. Claude is NOT stateless per query. Max 4 turns to control token cost. |
| **Three richer browser event types** | In addition to `url`, the extension now emits `page_content` (Readability article body, author, site_name — capped at 2 000 chars), `search_query` (typed query + search engine), and `link_click` (anchor text + destination URL). All three POST to FastAPI `/capture`; background.ts also continues to emit bare `url` events on tab navigation. |
| **Python inline redaction for browser content** | `redaction_service.py` ports the Rust clipboard patterns as inline `re.sub()` — it replaces only matched substrings rather than the whole value, preserving surrounding article context. Applied to `page_text` (page_content events) and `raw_content` (search_query events) in `capture.py` before the DB write. All patterns run (not just the first match). |
| **Canonical capture exclusions** | `services/exclusion_policy.py` is the one default-list source and SQLite is the runtime source used by Rust and FastAPI. App names are Unicode-normalized, whitespace-collapsed, and lowercased. Domains normalize scheme/path/port, one leading `www.`, trailing dot, case, and IDNA; an excluded domain includes its DNS subdomains but never a suffix lookalike. Watched paths are lexical absolute boundaries. |
| **Sessions store topics** | Claude now returns a `topics` JSON array ("vector databases", "React hooks", …) alongside the existing session fields. Stored in `sessions.topics` (TEXT, JSON array string). Included in the Qdrant embedding text so "what was I researching about X" queries match on subject vocabulary. |
| **File activity monitor (Rust)** | `file_activity.rs` watches ~/Documents, ~/Desktop, ~/Downloads via macOS FSEvents (the `notify` crate). Events are debounced by 2 seconds (`notify-debouncer-full`). Only the file *path* is stored in `events.file_path`; `raw_content` holds the bare file name; `metadata` holds `{"action":"created|modified|removed"}`. File *contents* are never read. Hidden files/dirs, high-noise directories, and transient suffixes are filtered before any DB write. |
| **System state monitor (Rust)** | `system_state.rs` subscribes to macOS Darwin notifications for screen lock/unlock and sleep/wake via `notify_register_file_descriptor` (C API in libSystem — no new crates). Each notification gets a dedicated blocking OS thread; events bridge to tokio via `mpsc`. Writes `type='system_state'` events with `raw_content=<state>` and `metadata={"state":"lock|unlock|sleep|wake"}`. No-op on non-macOS. |
| **Unified osascript poller (Rust)** | `unified_poller.rs` consolidates window tracking (was 30 s), browser URL capture (was 5 s), and app lifecycle (was 10 s) into a single 8 s combined osascript call. Reduces subprocess spawns from ~20/min to ~7.5/min. Combined script returns structured output lines (`APP:`, `RUNNING:`, `BROWSER_URL:`, `BROWSER_ERROR:`) parsed by `parse_poll_output()`. `UnifiedPollCache` refreshed every 30 s: is_paused, excluded_app_names, excluded_domains, native_browser_enabled. `is_noise_app_name()` filters empty, "missing value", and system helper names. Initial running app snapshot taken BEFORE first sleep to prevent launch flood on startup. `pub static BROWSER_AUTOMATION_DENIED: AtomicBool` lives here (moved from the former browser_url.rs). |
| **App lifecycle monitor (Rust)** | Now part of `unified_poller.rs`. Diffs `RUNNING:` output lines against the previous snapshot every 8 s and writes `type='app_lifecycle'` events with `app_name` and `metadata={"action":"launched"\|"quit"}`. Baseline snapshot taken before the first sleep so apps running at startup are not emitted as launches. |
| **Idle detection — timer only, never keystroke content** | `unified_poller.rs` calls `CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateHIDSystemState, kCGAnyInputEventType)` inline via a CoreGraphics `extern "C"` link. Returns **only** a float count of seconds since the last input event — never what was typed or where the mouse moved. If seconds < 60 → `is_user_active = 1`; else `0`. Attached to each window event INSERT. macOS-only; non-macOS always writes `1`. |
| **Session boundaries split on lock/sleep** | `_split_events_at_system_boundaries()` in `scheduler.py` walks the chronologically-sorted unprocessed event list. Each `system_state` event with state `"lock"` or `"sleep"` ends the current content batch; content events after an `"unlock"`/`"wake"` start a new batch. Boundary events are immediately marked `session_id='system_boundary'` so they are never re-classified. Each content batch then goes through the full classify → group → summarise pipeline independently. |
| **active_minutes on sessions** | `sessions.active_minutes` (INTEGER) counts `window` events where `is_user_active = 1` in a session's event list, multiplied by the 30-second poll interval, divided by 60. Represents a lower-bound estimate of keyboard/mouse-active time (lower bound because the window tracker only fires on title changes, not every 30 s unconditionally). Included in the Qdrant payload metadata for "how long did I work on X?" recall. |
| **File watch settings (privacy control)** | `file_watch_settings` table in SQLite (single row, id=1): `enabled` INTEGER + `watched_folders` JSON TEXT array of canonical absolute paths. Seeded on first run with `~/Documents`, `~/Desktop`, `~/Downloads`. `file_activity.rs` reads this table on startup and every 5 s via a `tokio::select!` refresh tick, syncs the `notify` watcher using a `currently_watched: HashSet<String>` diff, and verifies every event remains within a configured root before writing. Disabling sets the desired set to empty, unwatching everything. Managed via `GET/POST /privacy/file-watching` and `POST/DELETE /privacy/watched-folders`; surfaced in PrivacyPanel under "File Activity". |
| **On-screen content capture (Rust)** | `screen_content.rs` polls the focused UI element every 8 s via the macOS AXUIElement API. Uses raw `extern "C"` bindings to ApplicationServices + CoreFoundation — **not** a third-party accessibility crate. All AX calls run in `spawn_blocking` to avoid stalling the async runtime. `ScreenContentCaptureCache` reads `screen_content_settings.enabled`, pause state, and excluded apps every 30 s. **`AXSecureTextField` is skipped unconditionally at every traversal depth** — password fields are never read. Traversal cap: max depth 3, max 30 elements, text truncated to 1 500 chars, deduped by text equality before INSERT. `AXErrorAPIDisabled` is logged once via `AtomicBool` then silently suppressed. Writes `type='screen_content'` events with `raw_content=window_title`, `screen_text=accessible_text`. Requires Accessibility permission (same grant as the window tracking in `unified_poller.rs`). |
| **`screen_content_settings` table** | Single row (id=1): `enabled INTEGER NOT NULL DEFAULT 1`. Seeded by FastAPI on startup. `screen_content.rs` reads this every 30 s — fallback to `true` if absent. Managed via `GET/POST /privacy/screen-content`. The On-Screen Content toggle is placed **FIRST** in PrivacyPanel (most powerful capture gets most prominent control). |
| **Signal fusion session prompt** | Phase 2.9 replaces the flat per-event JSON prompt with a labelled text-line format. `_build_fused_signals()` serialises each event chronologically as one readable line: `[14:30] APP focus: VS Code — window: "billing.service.ts"`, `[14:31] SCREEN text: "..."`, `[14:31] FILE modified: /path/to/file`, etc. `FUSION_SESSION_SYSTEM_PROMPT` instructs the model to act as a detective: triangulate overlapping signals, name real files/topics/tickets, produce a concrete `next_step`. Session generation runs on **Groq** (`generate_session_summary_groq()`, `openai/gpt-oss-120b`) during the beta — see "Groq is Orbit's default AI provider" above; `SUMMARY_MODEL`/`generate_session_summary()` (Claude Haiku, `claude_service.py`) still exist and are unused, not deleted, for whenever Claude is re-enabled. New session columns: `activity` (what specifically they did), `next_step` (concrete continuation), `blockers` (what they seemed stuck on). |
| **FTS5 indexes screen_text** | `events_fts` virtual table now indexes 5 columns: `raw_content, app_name, url, page_text, screen_text`. Keyword recall queries that match on-screen text snippets return `screen_content` events. `_migrate_schema()` in `database.py` drops and rebuilds the FTS5 table + triggers when `screen_text` is absent from an existing index. |
| **`next_step` column — user-facing label only** | The DB column `sessions.next_step` and all API field names are unchanged. Only user-visible labels changed: session cards show **"Where you left off"** (MemoryViewer, TimelineView) instead of "Next step". The `RECALL_SYSTEM_PROMPT` instructs Claude to *describe where the user was* rather than prescribe what to do next. The context block sent to Claude labels the field `Where they left off:` instead of `Next step:`. Never rename the DB column or API field. |
| **Activity Timeline tab** | New "Timeline" tab in the app (fourth option in the header selector; calendar icon in the collapsed pill). `TimelineView.tsx` fetches `GET /timeline/day?date=YYYY-MM-DD` and `GET /timeline/dates` via `useTimeline.ts`. Shows a proportional horizontal strip with coloured session blocks, date pill navigation (last 10 days), 3 stat cards, and a threaded session list. "Ask Orbit about this" on a session card sets `pendingQuery` in Zustand and switches the active panel to "chat". |
| **Activity Timeline backend routes** | `backend/routes/timeline.py` — `GET /timeline/day?date=YYYY-MM-DD` returns sessions + stats for one calendar day; `GET /timeline/dates` returns all dates that have sessions (newest-first). Both convert the local YYYY-MM-DD date to UTC ms using `datetime().astimezone()` — correct because the backend runs on the user's machine. Registered with prefix `/timeline` in `main.py`. |
| **Project Cards dashboard** | `RecallSearch.tsx` renders `<ProjectCards>` in the scrollable area when `conversationHistory.length === 0 && !isStreaming`. When `inputValue.length > 0` the cards fade to `opacity: 0` (CSS 0.2 s ease-out) with `pointer-events: none` — they reappear when the input is cleared. Cards never render if no projects exist (clean empty state on first install). |
| **`GET /projects` backend route** | `backend/routes/projects.py` — aggregates sessions into one card per project. Groups by `LOWER(TRIM(project_name))` so "Orbit" and "orbit" collapse into a single card (case-insensitive dedup). Display name comes from the most recent session. Returns `project_name`, `last_active_ms`, `activity`, `ai_summary`, `weekly_active_minutes`, `session_count`, plus `today_active_minutes` for the header badge. Module-level 5-min cache in `useProjects.ts`; force-refreshes on `document.visibilitychange`. |
| **Project color palette** | 8 warm colours: `["#E8A87C","#85C1E9","#82E0AA","#F1948A","#BB8FCE","#F8C471","#76D7C4","#AEB6BF"]`. Assigned deterministically: polynomial hash of `project_name` chars, `Math.abs(hash) % 8`. Same logic in both `TimelineView.tsx` and `ProjectCards.tsx` so a project always gets the same colour across both views. Never use random colours for projects. |
| **`pendingQuery` Zustand bridge** | `orbitStore.ts` has `pendingQuery: string \| null`, `setPendingQuery`, `clearPendingQuery`. Used by Timeline's "Ask Orbit about this" to pass a query to `RecallSearch` after switching tabs. `RecallSearch` watches `pendingQuery` in a `useEffect` and auto-submits when it is set (clears it immediately to prevent double-fire). |

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
[Rust: clipboard.rs]        ──► SQLite events (direct write, no HTTP)
[Rust: unified_poller.rs]  ──► SQLite events (direct write, no HTTP)  [8 s combined poll; handles window title + app lifecycle + browser URL in one osascript; is_user_active from inline idle timer; reads browser_capture_settings + excluded lists every 30 s; BROWSER_AUTOMATION_DENIED AtomicBool on error -1743]
[Rust: file_activity.rs]   ──► SQLite events (direct write, no HTTP)  [watched folders read from file_watch_settings every 30 s]
[Rust: system_state.rs]    ──► SQLite events (direct write, no HTTP)
[Rust: screen_content.rs]  ──► SQLite events (direct write, no HTTP)  [8 s poll; AXUIElement focused-element traversal; reads screen_content_settings every 30 s; skips AXSecureTextField at every depth; max depth 3 / 30 elements / 1 500 chars; dedup by text equality]

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
    │  url event dedup: _find_recent_url_event() — extension beats native_browser within 10 s window
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
_build_fused_signals() → labelled text lines per event
    │  [HH:MM] APP focus: <app> — window: "<title>"
    │  [HH:MM] SCREEN text: "<accessible text snippet>"
    │  [HH:MM] FILE modified: /path/to/file
    │  [HH:MM] CLIPBOARD: "<redacted-safe text>"
    │  [HH:MM] BROWSER: <url> — "<page title>"  etc.
    ▼
httpx → Worker /chat-groq → openai/gpt-oss-120b  (structured extraction, runs every 30 min)
    │  Beta default is Groq (generate_session_summary_groq, reasoning_effort="low");
    │  Claude Haiku 4.5 (SUMMARY_MODEL) still exists in claude_service.py, unused —
    │  swap back in scheduler.py if Claude is re-enabled via the admin kill switch.
    │  FUSION_SESSION_SYSTEM_PROMPT: detective triangulation across overlapping signals
    │  generates: {project_name, goal, activity, summary, last_action, next_step, blockers, key_resources, topics, evidence}
    │  active_minutes = (window events with is_user_active=1) × 30 s ÷ 60
    │  INSERT INTO sessions  (includes activity, next_step, blockers, active_minutes, topics)
    ▼
httpx → Worker /embed → Voyage AI
    │  512-dim vector: project_name | goal | activity | next_step | summary | topics
    └► Qdrant local upsert  (payload includes activity, next_step, blockers, active_minutes)
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
    ├── YES ──► if time_range active:
    │               fetch_sessions_by_time_range() → best session per project_name
    │               Qdrant (up to 8) fills slots for projects not in DB results
    │               total capped at 12; one entry per distinct project_name
    │           else (no time range):
    │               httpx → Worker /embed → Voyage AI → Qdrant semantic search
    │               returns: up to 8 sessions
    │               re-rank: (similarity × 0.7) + (recency × 0.3)
    │                   │
    │                   ▼
    │           httpx → Worker /chat-groq → llama-3.3-70b-versatile (user-facing, beta default)
    │                   stream_recall_response_groq() in groq_service.py — OpenAI-compatible SSE,
    │                   a different wire format from Claude's content_block_delta events.
    │                   Claude Sonnet 4.6 (stream_recall_response, claude_service.py) still exists,
    │                   unused while Claude is disabled via the admin kill switch.
    │                   receives: time label + intent hint + FTS5 events (incl. screen_content)
    │                             + re-ranked sessions (incl. activity / next_step / blockers)
    │                             + conversation_history
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
│   │   │   ├── OnboardingFlow.tsx          ← 5-step first-launch: Welcome→Accessibility→BrowserAutomation→Extension(optional)→Tips
│   │   │   ├── ErrorBoundary.tsx           ← global error boundary → Sentry → restart button
│   │   │   ├── RecallSearch.tsx            ← recall UI + ProjectCards dashboard; fades cards when user starts typing
│   │   │   ├── ActivityTimeline.tsx        ← scrollable raw-event feed (rendered as children of RecallSearch)
│   │   │   ├── ProjectCards.tsx            ← project cards dashboard; 2-col grid; shown when conversation is empty
│   │   │   ├── Timeline/
│   │   │   │   └── TimelineView.tsx        ← Timeline tab: date nav pills, stat cards, proportional strip, session list
│   │   │   ├── MemoryViewer.tsx            ← view + delete events/sessions (two-tab UI)
│   │   │   ├── PrivacyPanel.tsx            ← capture toggle, excluded apps, excluded websites, browser tracking toggle (BrowserTrackingSection), file activity watching, wipe button; ScreenContentSection rendered FIRST; AiProviderSection (read-only Claude/Gemini/Groq status rows, no user controls — admin kill switch only)
│   │   │   └── OrbWidget.tsx               ← floating companion orb (Phase 4)
│   │   ├── store/
│   │   │   └── orbitStore.ts               ← Zustand: conversationHistory: Message[] + pendingQuery (Timeline→Chat bridge)
│   │   ├── hooks/
│   │   │   ├── useRecall.ts                ← POST /recall, appends to conversationHistory
│   │   │   ├── useTimeline.ts              ← fetches /timeline/day + /timeline/dates; Map cache; setSelectedDate()
│   │   │   ├── useProjects.ts              ← fetches /projects; module-level 5-min cache; visibility-change refresh
│   │   │   ├── useAnalytics.ts             ← PostHog wrapper — never call posthog directly
│   │   │   ├── useOnboarding.ts            ← onboarding state, polls accessibility + browser automation every 3s; requestBrowserAutomation()
│   │   │   ├── usePrivacySettings.ts       ← privacy API calls; excluded domains + normalizeDomain(); nativeBrowserEnabled + setNativeBrowserEnabled; file watching CRUD; screenContentEnabled + setScreenContentEnabled
│   │   │   ├── useProviderStatus.ts        ← fetches /settings/provider-status on mount; read-only {claudeEnabled, geminiEnabled, groqEnabled}; fails open (all true) if unreachable — no setters, admin-only control
│   │   │   └── useMemoryData.ts            ← memory viewer: events, sessions, pagination
│   │   └── types/                          ← all TypeScript types
│   └── src-tauri/
│       ├── src/
│       │   ├── main.rs                     ← entry, tray, spawns FastAPI, starts capture tasks
│       │   ├── capture/
│       │   │   ├── mod.rs
│       │   │   ├── clipboard.rs            ← 500ms poll, redacts secrets before SQLite write
│       │   │   ├── unified_poller.rs       ← 8s combined osascript poll: window title + app lifecycle + browser URL; idle timer (inline CGEventSource); BROWSER_AUTOMATION_DENIED AtomicBool
│       │   │   ├── file_activity.rs        ← FSEvents via notify + 2 s debounce; reads file_watch_settings every 30 s; stores path only, never content
│       │   │   ├── system_state.rs         ← Darwin notify API; lock/unlock/sleep/wake → SQLite; macOS only
│       │   │   └── screen_content.rs       ← 8s AXUIElement poll; skips AXSecureTextField; max depth 3/30 elements/1 500 chars; reads screen_content_settings every 30 s
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
│   │   ├── recall.py                       ← POST /recall: FTS5 + Qdrant → Groq SSE (beta default; Claude code path intact, unused)
│   │   ├── privacy.py                      ← excluded apps CRUD, pause/resume, wipe
│   │   ├── settings.py                     ← GET/POST/DELETE /settings/groq-key (per-user override, no UI currently); GET /settings/provider-status (proxies Worker kill switch, powers PrivacyPanel)
│   │   ├── feedback.py                     ← POST /feedback
│   │   ├── timeline.py                     ← GET /timeline/day, GET /timeline/dates
│   │   └── projects.py                     ← GET /projects (aggregated cards, case-insensitive dedup)
│   ├── services/
│   │   ├── claude_service.py               ← httpx singleton → Worker /chat — unused during beta (Claude disabled via kill switch)
│   │   ├── gemini_service.py               ← httpx singleton → Worker /classify — unused during beta (Gemini disabled via kill switch)
│   │   ├── groq_service.py                 ← httpx singleton → Worker /chat-groq — beta default for session summaries, classification, AND recall streaming
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
│   │   │   ├── layout.tsx                      ← root layout, metadata (metadataBase, OG, Twitter cards)
│   │   │   ├── opengraph-image.tsx             ← auto-wired OG/Twitter image (1200×630, edge runtime, ImageResponse)
│   │   │   ├── globals.css                     ← @import "tailwindcss" (Tailwind v4)
│   │   │   ├── favicon.ico
│   │   │   ├── not-found.tsx                   ← 404 page
│   │   │   ├── privacy/
│   │   │   │   └── page.tsx                    ← privacy policy (Server Component)
│   │   │   └── beta/
│   │   │       └── page.tsx                    ← early access holding page (robots: noindex); shared only with invitees
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
│   └── latest.json                         ← committed placeholder only — CI generates the real one at release time; not what the updater actually fetches
└── .github/workflows/
    └── release.yml                         ← builds + signs .dmg on v* tag push; publishes to Saadaan-Hassan/orbit-releases (see Release & Distribution)
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
| `accessibility` + `accessibility-sys` | macOS AXUIElement bindings (macOS-only) — on-screen text capture via Accessibility API |
| `core-foundation` | CF pointer RAII wrappers (`CFOwned`) for safe use of AX/CF objects |

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

**Beta default — Groq, centrally funded (not BYOK), Claude and Gemini disabled via the admin kill switch:**

| Task | Model | Route |
|---|---|---|
| User recall + conversation | `llama-3.3-70b-versatile` (`GROQ_RECALL_MODEL`, `groq_service.py`) | Worker `/chat-groq` |
| Background session summaries (signal fusion) | `openai/gpt-oss-120b` (`GROQ_SESSION_MODEL`), `reasoning_effort: "low"` | Worker `/chat-groq` — every 30 min |
| Event classification | `llama-3.1-8b-instant` (`GROQ_CLASSIFY_MODEL`) | Worker `/chat-groq` — groups capped at 30 events (quality ceiling, see Critical Architecture Facts) |
| Session embeddings | Voyage AI `voyage-3-lite` (512 dims) | Worker `/embed` — unaffected by the kill switch |
| Voice STT (Phase 4) | Whisper.cpp → Apple Speech fallback | local only |
| Voice TTS (Phase 4) | Kokoro TTS → ElevenLabs Pro | local / Worker `/tts` |

**Disabled during the beta (`CLAUDE_ENABLED=false`, `GEMINI_ENABLED=false` — Worker secrets, `npx wrangler secret put <NAME>` to flip), code paths intact for re-enabling:**

| Task | Model | Route |
|---|---|---|
| User recall + conversation | Claude Sonnet 4.6 (`RECALL_MODEL`, `claude_service.py`) | Worker `/chat` |
| Background session summaries (signal fusion) | Claude Haiku 4.5 (`SUMMARY_MODEL`, `claude_service.py`) | Worker `/chat` |
| Event classification | `gemini-3.1-flash-lite` (`gemini_service.py`) | Worker `/classify` |

### Storage
| Layer | Tool | Notes |
|---|---|---|
| Structured events | SQLite `~/.orbit/orbit.db` | All events, sessions, memory objects |
| Keyword search | SQLite FTS5 (built-in) | BM25, porter tokenizer. Indexes 5 columns: `raw_content, app_name, url, page_text, screen_text` — article body and on-screen text are searchable. |
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
| `app/src/components/OnboardingFlow.tsx` | 5-step first-launch: Welcome → Accessibility (polls every 3s, auto-advances) → Browser Automation (Step 2 of 5 — polls `check_browser_automation_permission` every 3s, always skippable via `hasAdvanced` ref guard) → Chrome Extension (optional) → What to Expect. Blocks main UI until complete. |
| `app/src/components/ErrorBoundary.tsx` | Class component. Catches render errors → Sentry.captureException → friendly message → restart button. |
| `app/src/components/RecallSearch.tsx` | Recall UI. Renders `<ProjectCards>` in the scrollable area when `conversationHistory.length === 0 && !isStreaming`; passes `isVisible={inputValue.length === 0}` so cards fade on typing. Watches `pendingQuery` in Zustand and auto-submits queries from Timeline's "Ask Orbit" button. |
| `app/src/hooks/useRecall.ts` | POST /recall. Sends `conversation_history`. Appends each turn to Zustand store. Max 4 turns enforced here. |
| `app/src/hooks/useAnalytics.ts` | Wraps `usePostHog()`. All components call this — never import posthog-js directly. Strips forbidden property keys before capture. |
| `app/src/hooks/useOnboarding.ts` | Checks accessibility + browser automation permission on mount. Polls every 3s while onboarding is open. `requestBrowserAutomation()` calls `trigger_browser_automation_prompt` then polls `check_browser_automation_permission` every 3s until granted or unmount. `shouldPollBrowserAutomation = useRef(false)` controls the loop without re-renders. Persists completion state. |
| `app/src/hooks/usePrivacySettings.ts` | Loads privacy settings in parallel on mount (capture status, excluded apps, excluded domains, browser-capture settings, file-watch settings, screen-content settings). Exposes `screenContentEnabled` + `setScreenContentEnabled` (POSTs to `/privacy/screen-content`) alongside `nativeBrowserEnabled`, `setFileWatchEnabled`, `addWatchedFolder`, `removeWatchedFolder`, app/domain CRUD. `normalizeDomain()` strips URL to bare hostname. |
| `app/src/store/orbitStore.ts` | Zustand global state. `conversationHistory: ConversationMessage[]` — reset on new topic, preserved within session. `pendingQuery: string \| null` — Timeline→Chat bridge: set by `TimelineView` "Ask Orbit" button, auto-submitted and cleared by `RecallSearch`. |
| `app/src-tauri/src/main.rs` | Entry point. Sets LSUIElement, system tray, spawns FastAPI subprocess, creates SQLite pool, starts clipboard + unified_poller + screen_content + file_activity + system_state as tokio tasks. Health-checks FastAPI on startup (10 retries, 1s each). |
| `app/src-tauri/src/capture/clipboard.rs` | 500ms poll. Runs `detect_sensitive_content_type()` before writing. Stores `[REDACTED:type]` for matches. Deduplicates same content within 5 minutes. |
| `app/src-tauri/src/capture/unified_poller.rs` | Single 8 s combined osascript loop replacing the former window.rs (30 s), browser_url.rs (5 s), and app_lifecycle.rs (10 s). Structured output lines parsed by `parse_poll_output()`: `APP:name\|\|\|TITLE:title`, `RUNNING:app1,app2,...`, `BROWSER_URL:url\|\|\|BROWSER_TITLE:title`, `BROWSER_ERROR:automation_denied`. `UnifiedPollCache` refreshed every 30 s: is_paused, excluded_app_names, excluded_domains, native_browser_enabled. Idle detection via inline `CGEventSourceSecondsSinceLastEventType` (IDLE TIMER ONLY — never keystroke content); sets `is_user_active`. `is_noise_app_name()` filters system helpers. `KNOWN_BROWSER_APP_NAMES` and `pub static BROWSER_AUTOMATION_DENIED: AtomicBool` live here. |
| `app/src-tauri/src/capture/file_activity.rs` | FSEvents file activity monitor using `notify` + `notify-debouncer-full`. 2-second debounce. Reads `file_watch_settings` from SQLite on startup and every 30 s via `tokio::select!`; syncs the watcher using a `currently_watched: HashSet<String>` diff. Skips hidden files/dirs, blocked high-noise directories, and transient file suffixes (.tmp, .swp, .lock, .log). `BLOCKED_DIRECTORY_NAMES`: `node_modules, .git, target, __pycache__, .next, dist, build, Library, .cache, venv, .venv, DerivedData, Pods, xcuserdata, xcshareddata, capacitor-cordova-ios-plugins, capacitor-cordova-android-plugins, .gradle, .android`. The iOS/Xcode/Capacitor entries were added to prevent a single `npx cap sync` + Xcode build from flooding hundreds of file_activity events and creating dozens of near-identical sessions. Writes `file_activity` events with `file_path` and `metadata={"action":"created|modified|removed"}`. NEVER reads file contents. |
| `app/src-tauri/src/capture/system_state.rs` | macOS system state monitor. Uses `notify_register_file_descriptor` (Darwin C API in libSystem — no new crates). Registers 4 Darwin notifications: `com.apple.screenIsLocked` → "lock", `com.apple.screenIsUnlocked` → "unlock", `com.apple.system.willsleep` → "sleep", `com.apple.system.didwake` → "wake". Each fd gets a dedicated blocking OS thread; events bridge to tokio via `mpsc::unbounded_channel`. Writes `type='system_state'` events with `raw_content=<state>` and `metadata={"state":"..."}`. No-op on non-macOS. |
| `app/src-tauri/src/capture/screen_content.rs` | On-screen text capture via macOS AXUIElement. 8 s poll. All AX calls via raw `extern "C"` bindings (ApplicationServices + CoreFoundation) in `spawn_blocking`. `ScreenContentCaptureCache` reads `screen_content_settings.enabled`, pause state, excluded apps every 30 s. `CFOwned` RAII struct ensures CF pointer lifecycle. `capture_screen_content_sync()` returns `CaptureOutcome::Success` or `CaptureOutcome::ApiDisabled`. `collect_text()` traverses focused UI element — **skips `AXSecureTextField` at every depth unconditionally**, max depth 3, max 30 elements. Text truncated to 1 500 chars, deduped by equality. `AXErrorAPIDisabled` logged once via `AtomicBool`, then silently suppressed. Writes `type='screen_content'`, `raw_content=window_title`, `screen_text=accessible_text`. No-op branch on non-macOS (`#[cfg(not(target_os = "macos"))]`). |
| `app/src-tauri/src/db.rs` | sqlx SQLite pool. **Single pool shared everywhere. Never open new connections.** |
| `app/src-tauri/src/lib.rs` | Tauri app setup + all `#[tauri::command]` functions via `generate_handler!`. Phase 2.7 additions: `check_browser_automation_permission` (probes each known browser via osascript), `trigger_browser_automation_prompt` (surfaces the macOS Automation dialog), `open_automation_system_settings` (deep-links to `Privacy_Automation` pane). `BROWSER_NAMES_FOR_AUTOMATION_PROBE` constant matches `KNOWN_BROWSER_APP_NAMES` in `unified_poller.rs`. |
| `app/src-tauri/Info.plist` | `LSUIElement = true`. Never remove. Orbit never appears in the dock. |
| `app/src-tauri/tauri.conf.json` | Two windows: `main` (panel, skipTaskbar, transparent, decorations:false) and `overlay` (Phase 4: fullscreen, alwaysOnTop, focus:false, transparent). |
| `backend/main.py` | FastAPI with `@asynccontextmanager` lifespan. Inits Sentry, starts `asyncio.create_task(start_session_generation_loop())`. No APScheduler. GET /health endpoint. |
| `backend/database.py` | SQLAlchemy async engine. Creates all tables + FTS5 virtual table + auto-sync triggers on startup. Events schema includes `page_text`, `link_target`, `metadata`, `file_path`, `is_user_active`, `screen_text` (Phase 2.9). FTS5 indexes 5 columns: `raw_content, app_name, url, page_text, screen_text`. `_migrate_schema()` drops + rebuilds FTS5 table + triggers when `screen_text` absent. `idx_events_url_timestamp` index on `events(url, timestamp)`. Sessions schema includes `last_action`, `key_resources`, `topics`, `active_minutes`, `activity`, `next_step`, `blockers` (Phase 2.9). `screen_content_settings` table (single row, id=1) seeded with `enabled=1`. `file_watch_settings` table seeded with default folders. `browser_capture_settings` table seeded with `native_enabled=1`. `search_events_fts()` SELECT now includes `file_path` and `screen_text`. `fetch_sessions_by_time_range(start_ms, end_ms, max_per_project=1)` returns the best session per distinct `project_name` within a time window — used by `recall.py` for time-range queries as the primary session source. |
| `backend/scheduler.py` | `AsyncIOScheduler` (APScheduler v3.x stable). `create_session_scheduler()` returns a configured scheduler with 30-min interval and `next_run_time=now`. `generate_sessions_from_recent_events()`: fetch → `_split_events_at_system_boundaries()` → per batch: `_dedup_events_by_url_for_prompt()` → classify (`_classify_events_with_configured_provider()` → **Groq**, `classify_events_batch_groq`) → `_build_fused_signals()` (labelled text lines: `[HH:MM] APP focus / SCREEN text / FILE / CLIPBOARD / BROWSER / …`) → `FUSION_SESSION_SYSTEM_PROMPT` (detective triangulation) → **Groq** (`generate_session_summary_groq`, `openai/gpt-oss-120b`) → embed (Voyage) → mark processed. Claude/Gemini imports intentionally removed during the beta (see comment at top of file) — reintroduce them to restore a fallback path. On Groq failure, batch is stamped `session_id='parse_failed'` (circuit breaker — prevents the same backlog being reclassified every 30-min cycle forever, a real incident observed in production before this existed) and picked up later by the bounded `_retry_parse_failed_events()` recovery lane (≤20 events/cycle). New session fields extracted: `activity`, `next_step`, `blockers`. `_ensure_sessions_schema_columns_exist()` adds `topics`, `active_minutes`, `activity`, `next_step`, `blockers`. SQL SELECTs include `screen_text, file_path, is_user_active, category`. |
| `backend/routes/recall.py` | FTS5-first sequential pipeline. (1) Classify intent. (2) Parse time reference. (3) Optionally fetch system_state events. (4) FTS5 keyword search (returns `file_path` + `screen_text` columns now). (5) URL dedup. (6) Session lookup → AI SSE (**Groq** during the beta — `stream_recall_response_groq()`, `groq_service.py`; Claude's `stream_recall_response()` still exists in `claude_service.py`, unused). **Session lookup strategy differs by query type:** for queries WITHOUT a time range, uses Qdrant semantic search (up to 8 sessions, re-ranked by similarity × 0.7 + recency × 0.3); for queries WITH a time range ("yesterday", "today", etc.), uses `fetch_sessions_by_time_range()` as primary source (one session per distinct project_name, ordered by active_minutes then duration), then fills remaining slots up to 12 with Qdrant results for projects not already covered. This ensures "what did I work on yesterday?" returns all projects rather than only the semantically closest one. Context block: `screen_content` events formatted as `[time] In <app>: "<screen_text snippet>"`. Session block shows fused fields: `What you were doing: <activity>` (falls back to `Summary` for pre-Phase-2.9 sessions), `Goal`, `Where they left off: <next_step>`, `Left off: <last_action>`, `Blocked on: <blockers>`, `Topics`, `Resources`, `Active time`. The context label was renamed from `Next step:` to `Where they left off:` as part of the context-restoration UX philosophy change. The offline FTS5 fallback (`_format_fts5_fallback`, on `httpx.ConnectError`/`TimeoutException`/`HTTPStatusError`) now also fires automatically when the admin kill switch disables Groq — no special-casing needed, the 503 from the Worker raises the same exception types. |
| `backend/routes/capture.py` | POST /capture (extension only — Rust writes direct). Checks pause state, excluded app names, and excluded domains (all cached 30s). Domain extracted via `urlparse().netloc` before every browser event. URL dedup: `_find_recent_url_event()` queries `events(url, timestamp)` with `_URL_DEDUP_WINDOW_MS = 10_000`; extension beats native_browser (drop native); if native in DB and extension arrives, DELETE native INSERT extension. `page_text` for `page_content` events and `raw_content` for `search_query` events are passed through `redact_sensitive_content()` before INSERT. GET /events for timeline. |
| `backend/routes/privacy.py` | Excluded apps CRUD, pause/resume, capture status, full data wipe (SQLite + Qdrant). Wipe uses SQLite secure-delete, WAL truncation, and `VACUUM`; it deletes FTS rows, sessions, memory objects, and extension pairings before clearing Qdrant vectors. `GET/POST/DELETE /privacy/excluded-domains` — domain exclusion CRUD. `GET/POST /privacy/browser-capture` — native browser URL capture toggle; returns `{native_enabled, browsers: [...]}`. `GET/POST /privacy/screen-content` — on-screen content capture toggle; `SetScreenContentRequest(enabled: bool)` UPDATEs `screen_content_settings`. `GET/POST /privacy/file-watching` — enable/disable file activity capture. `POST/DELETE /privacy/watched-folders` — add/remove watched folder paths (JSON body). |
| `backend/routes/feedback.py` | POST /feedback — stores rating + comment in SQLite. |
| `backend/routes/timeline.py` | `GET /timeline/day?date=YYYY-MM-DD` — returns sessions + stats (total_active_minutes, total_duration_minutes, project_count) for one calendar day. `GET /timeline/dates` — returns all unique YYYY-MM-DD dates with sessions, newest-first. Both convert local date strings to UTC ms via `datetime().astimezone()`. Registered with `prefix="/timeline"` in main.py. |
| `backend/routes/projects.py` | `GET /projects` — aggregates sessions into project cards. Groups by `LOWER(TRIM(project_name))` so case/spacing variants ("Orbit", "orbit") collapse into one card; display name comes from the most recent session. Returns per-project `last_active_ms`, `activity`, `ai_summary`, `weekly_active_minutes`, `session_count`, plus `today_active_minutes` for the header badge. Limit 20 projects. |
| `app/src/hooks/useTimeline.ts` | Fetches `GET /timeline/day` on mount and on `setSelectedDate()`. Fetches `GET /timeline/dates` once on mount. Caches per-date results in an in-memory `Map<string, TimelineDayData>` ref — navigating back to a date is instant. `setSelectedDate()` updates state AND triggers a fetch in one call (not via useEffect). |
| `app/src/hooks/useProjects.ts` | Fetches `GET /projects` on mount. Module-level `moduleCache` (not a ref) holds data + `fetchedAt` timestamp — shared across re-renders, skipped if younger than 5 minutes. Force-refreshes on `document.visibilitychange`. Fails silently — returns empty `projects` array on error. |
| `app/src/components/Timeline/TimelineView.tsx` | Full Timeline tab UI. Three sub-components: `TimelineStrip` (proportional horizontal bar — session blocks sized by `widthPercent`, positioned by `leftPercent`, colored by `getProjectColor`; 2-hour tick marks in local time; hover tooltip); `SessionCard` (color dot, time range, activity summary, topics, blockers, resources, "Where you left off" label for `next_step`, "Ask Orbit" button); `TimelineView` (date pill selector for last 10 days, stat cards, strip, threaded session list). Uses `onAskOrbit` prop which calls `setPendingQuery` + `setActivePanel("chat")` in App.tsx. |
| `app/src/components/ProjectCards.tsx` | Project cards dashboard. Shown inside `RecallSearch` when `conversationHistory` is empty. Receives `isVisible` prop — when `false`, sets `opacity: 0` and `pointer-events: none` (0.2 s ease-out CSS transition). Card body click calls `onPrefill(query)` (sets input value + focus, does NOT submit). `→` arrow calls `onSubmit(query)` (submits immediately). Shows loading shimmer while `isLoading`. Returns `null` if `projects.length === 0` after load (clean empty state on first install). |
| `backend/services/claude_service.py` | Singleton `httpx.AsyncClient`. POST to `WORKER_URL/chat`. Handles SSE streaming. `RECALL_MODEL = "claude-sonnet-4-6"`, `SUMMARY_MODEL = "claude-haiku-4-5-20251001"`. **Currently unused during the beta** — Claude is disabled via the Worker's `CLAUDE_ENABLED` kill switch and Groq (`groq_service.py`) handles both recall and session summaries instead. Code is intact, not deleted — re-wire `scheduler.py`/`recall.py` to call back into this file to restore Claude. |
| `backend/services/gemini_service.py` | Singleton `httpx.AsyncClient`. POST to `WORKER_URL/classify`. Builds Gemini REST API body. Extracts text from `candidates[0].content.parts[0].text`. Sends `id, type, app_name, url, raw_content` — raw_content is already redacted at capture, so it's safe and needed for accurate classification. Falls back to `category='work'` if JSON parse fails. **Currently unused during the beta** — Gemini is disabled via `GEMINI_ENABLED`; `groq_service.py` handles classification instead. |
| `backend/services/groq_service.py` | Singleton `httpx.AsyncClient` (180 s timeout — classification of a large backlog can legitimately need minutes; recall uses a separate 30 s timeout, `_GROQ_RECALL_TIMEOUT_SECONDS`, since it's a live user-facing request). Three provider-facing functions: `generate_session_summary_groq()` (session fusion, `reasoning_effort="low"` — critical, see Critical Architecture Facts), `classify_events_batch_groq()` (event classification, content-aware group splitting via `_split_events_by_estimated_size()`, hard-capped at 30 events/group, sanity-checks response size against a 1.5× threshold to reject repetition-loop garbage), `stream_recall_response_groq()` (user-facing streaming, OpenAI-compatible SSE parser — NOT the same wire format as Claude's). All three send `X-Groq-Api-Key` only if a personal key exists (`database.get_groq_api_key()`); otherwise the header is omitted and the Worker falls back to its own shared `GROQ_API_KEY` secret. `_call_groq_chat()` is the shared low-level POST helper — 429 sets a per-model cooldown (`_groq_rate_limited_until` dict), 413 logs and returns None (payload-size problem, not time-based — no cooldown), empty completions are logged with `finish_reason` for diagnosis. |
| `backend/routes/settings.py` | `GET/POST/DELETE /settings/groq-key` — per-user Groq key override, functional but **not exposed anywhere in the current app UI**. Its credential is stored only in macOS Keychain; its enabled flag is non-secret SQLite state. `POST /settings/groq-key/enabled` — same status, unused UI-side. `GET /settings/provider-status` — the one still actually wired to the UI: proxies the Worker's `/provider-status`, fails open (`{claude: true, gemini: true, groq: true}`) if the Worker is unreachable. Powers PrivacyPanel's read-only "AI Provider" status rows via `useProviderStatus.ts`. |
| `backend/services/voyage_service.py` | Singleton `httpx.AsyncClient`. POST to `WORKER_URL/embed`. Body: `{"input": [text], "model": "voyage-3-lite", "input_type": "document"}`. Returns 512-dim float list. |
| `backend/services/time_parser.py` | Standard-library time reference parser (no third-party deps). `extract_time_range_from_query(query, now_ms)` checks 11 patterns most-specific-first (e.g. "yesterday morning" before "yesterday") and returns `{"start_ms": int, "end_ms": int, "label": str}` or `None`. Used by `recall.py` to filter both FTS5 and Qdrant results to a concrete time window. |
| `backend/services/redaction_service.py` | Inline sensitive-content redaction for browser-captured text. Ports Rust clipboard patterns as `re.sub()` — replaces only matched substrings (preserves article context). All 7 pattern steps run on every call. JWT uses `eyJ` anchor to avoid false positives in long text. API key pattern uses negative lookbehind + 8-char minimum body. Called by `capture.py` for `page_text` and search `raw_content` before DB write. |
| `backend/services/qdrant_service.py` | `QdrantClient(path=QDRANT_STORAGE_PATH)` singleton (default `~/.orbit/qdrant_storage`). Collection `orbit_sessions`, 512 dims, cosine. Raw vector upsert (no fastembed). Storage is repaired to owner-only permissions at startup. |
| `backend/services/analytics_service.py` | PostHog Python singleton. Device ID in `~/.orbit/device_id`, repaired to owner-only permissions. Strips forbidden property keys. try/except on every call — never crashes the app. |
| `backend/services/sentry_service.py` | `sentry_sdk.init()` with `enable_logs=True`, `send_default_pii=False`. Only runs if `SENTRY_DSN` is set in env. |
| `extension/src/background.ts` | MV3 service worker. All state in `chrome.storage.session` (never global vars). Emits bare `url` events on tab navigation (deduped by `lastSentUrl`). Handles three content-script message types: `page_content`, `search_query`, `link_click` — relays them to POST /capture. `onMessage` callback is synchronous (fire-and-forget) to keep the MV3 message channel intact. Fails silently when backend unreachable. |
| `extension/src/content.ts` | Runs in every page context. 5-second visibility filter — pages the user bounced off are discarded. On threshold: detects search queries first (Google, YouTube, Bing, DuckDuckGo); otherwise runs `@mozilla/readability` on a DOM clone to extract article body (≤2 000 chars), author, site_name, excerpt. Sends `page_content` or `search_query` to the background worker on tab departure (`visibilitychange` + `pagehide`). Left-click listener captures `link_click` events with 500 ms debounce. |
| `extension/package.json` | Runtime dep: `@mozilla/readability@^0.6.0` — ships own `index.d.ts`; do **NOT** install `@types/mozilla-readability` (conflicts). DevDeps: `@crxjs/vite-plugin`, `@types/chrome`, `typescript`, `vite`. |
| `worker/src/index.ts` | Routes: `/chat` → Claude, `/classify` → Gemini REST, `/chat-groq` → Groq (OpenAI-compatible; prefers caller's `X-Groq-Api-Key` header, falls back to `env.GROQ_API_KEY`; response body piped through unbuffered so streaming works), `/provider-status` (GET, no auth — reads the kill switch flags), `/embed` → Voyage AI, `/tts` → stub, `/stt-token` → stub. `isEnabled(flag)` / `providerDisabledResponse()` implement the admin kill switch — `CLAUDE_ENABLED`/`GEMINI_ENABLED`/`GROQ_PROXY_ENABLED` Worker secrets, `"false"` disables, anything else (including absent) is enabled. All secrets in Cloudflare env. CORS headers (`GET, POST, OPTIONS`) on every response. |
| `landing/src/app/page.tsx` | Landing page — Server Component. Hero, "How it works" 3-card section, privacy callout strip. Uses header, footer, background-orbit, waitlist-form. |
| `landing/src/app/layout.tsx` | Root layout. Sets `metadataBase`, explicit `openGraph` and `twitter` metadata. Canonical URL resolves via `NEXT_PUBLIC_APP_URL` env var. |
| `landing/src/app/opengraph-image.tsx` | Edge runtime `ImageResponse` — auto-wired by Next.js to og:image and twitter:image metadata. 1200×630 px dark PNG with orbit ring decoration, headline, and "Early Access" badge. No explicit metadata entry needed. |
| `landing/src/app/privacy/page.tsx` | Privacy policy — Server Component. Covers all capture types (Phase 2.5–2.9), what gets sent to cloud AI, and all user controls. |
| `landing/src/app/beta/page.tsx` | Early access holding page at `/beta`. `robots: { index: false }` — not indexed. Shared directly with invitees. Lists macOS requirements and what to expect; no download link until .dmg is ready. |
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
                                    --   | 'screen_content'
  raw_content  TEXT,                -- secrets replaced with [REDACTED:type] at capture;
                                    --  safe redacted content IS forwarded to Gemini + Claude.
                                    --  for page_content: page title. for search_query: query text.
                                    --  for link_click: visible anchor text.
  app_name     TEXT,
  url          TEXT,
  source       TEXT NOT NULL,       -- 'rust' | 'extension' | 'native_browser'
  session_id   TEXT,                -- null until processed by scheduler
  category     TEXT,                -- Gemini output: work/research/personal/system/communication
  page_text    TEXT,                -- readable article body (page_content events);
                                    --  capped at 2 000 chars; redacted by redaction_service before storage
  link_target  TEXT,                -- destination URL (link_click events)
  file_path    TEXT,                -- absolute path (file_activity events only; contents never read)
  is_user_active INTEGER,           -- 1 = user input within last 60 s at capture time (window events);
                                    --   0 = idle; NULL for all other event types
  screen_text  TEXT,                -- on-screen accessible text (screen_content events);
                                    --  captured via AXUIElement; max 1 500 chars;
                                    --  AXSecureTextField never read; FTS5-indexed
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

```sql
browser_capture_settings(
  id             INTEGER PRIMARY KEY DEFAULT 1,  -- always 1
  native_enabled INTEGER NOT NULL DEFAULT 1       -- 0 = stop all osascript browser polling
)
```

`unified_poller.rs` reads `native_enabled` every 30 s; fallback to `true` if row absent.
Managed via `GET/POST /privacy/browser-capture`. Shown in PrivacyPanel "Browser Tracking" section.

```sql
screen_content_settings(
  id      INTEGER PRIMARY KEY DEFAULT 1,  -- always 1
  enabled INTEGER NOT NULL DEFAULT 1       -- 0 = stop all AXUIElement screen-text polling
)
```

`screen_content.rs` reads `enabled` every 30 s; fallback to `true` if absent.
Managed via `GET/POST /privacy/screen-content`. Toggle shown FIRST in PrivacyPanel.

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
  activity      TEXT,            -- specific description of what the user was doing (from signal fusion)
  next_step     TEXT,            -- most likely concrete action to continue this work
  blockers      TEXT,            -- what they seemed stuck on, or null
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
- If they seem to be resuming a task, describe where they were — what they
  were mid-way through, what was left open, what state things were in when
  they stopped. Do NOT prescribe what they should do next. Describe where
  they were, even if they didn't explicitly ask.
- Never use developer-specific language. Respond in plain language anyone
  can understand, adapted to the context of what the user was actually doing.
- When the user asks about things they watched, read, or browsed for leisure,
  include the actual links (URLs) so they can revisit them.

Format: start with 📌 [time + context anchor], then the specific answer,
then supporting details only if genuinely useful. Skip any section that
has nothing real to say.\
"""
```

Signal fusion prompt (background, Claude Haiku 4.5 — runs every 30 min):

See `FUSION_SESSION_SYSTEM_PROMPT` in `backend/scheduler.py`. Key principles:
- Detective framing: triangulate overlapping signals, don't enumerate apps.
- Signal priority: `file_activity > screen_text > page_text > search_query > url > window title`.
- `_build_fused_signals()` serialises events as labelled text lines (`[HH:MM] APP focus / SCREEN text / FILE / CLIPBOARD / BROWSER / SEARCHED / CLICKED / SYSTEM…`) so Claude sees chronological overlap at a glance.
- Required JSON output fields: `project_name`, `activity`, `evidence`, `goal`, `summary`, `last_action`, `next_step`, `blockers`, `key_resources`, `topics`.
- `next_step` must be a concrete action, not generic ("fix the null-check in auth.py", not "continue working").
- `evidence` is internal-only for quality debugging — never shown in the UI.

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
| `next_step` field in session cards | **"Where you left off"** (MemoryViewer, TimelineView) or **"Mid-way through"** — never "Next step". The DB column `sessions.next_step` and all API response fields are unchanged; only the displayed label differs. |
| "Next step:" in recall context | **"Where they left off:"** — the context block label sent to Claude was renamed accordingly. Claude is instructed to *describe where the user was*, not prescribe what to do next. |

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
only content that has already passed through redaction. This principle is
identical regardless of which provider is currently active — Groq (beta
default) receives exactly the same redacted fields Claude/Gemini would.

- **Classification** (Groq `llama-3.1-8b-instant` during the beta; Gemini
  `gemini-3.1-flash-lite` when re-enabled) receives: `id, type, app_name, url,
  raw_content` (raw_content is already redacted — `[REDACTED:type]` for any
  secret). Needs the content to classify accurately ("is this work or
  personal?").
- **Session summaries** (Groq `openai/gpt-oss-120b` during the beta; Claude
  Haiku when re-enabled) receives: classified events with `app_name`, `url`,
  `window title`, and `raw_content` — all already redacted. Needs this to
  write a summary that actually describes what the user did.
- **Recall** (Groq `llama-3.3-70b-versatile` during the beta; Claude Sonnet
  when re-enabled) receives: session summaries + matching events (window
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

### On-Screen Content Capture (AXUIElement)

`screen_content.rs` reads the focused UI element's accessible text via the macOS Accessibility API. Security constraints:

- **`AXSecureTextField` is NEVER read** — this check fires at every traversal level, before descending into children. Password fields of any depth are unconditionally skipped.
- Only the **focused application** is queried — `AXUIElementCreateSystemWide()` → focused app → focused window → focused UI element. No cross-app scanning.
- **Depth cap**: max 3 levels of element traversal; max 30 elements total.
- **Size cap**: text truncated to 1 500 chars before any DB write.
- **Dedup**: identical consecutive captures are dropped (text equality check before INSERT).
- `AXErrorAPIDisabled` (Accessibility permission revoked) is logged once, then the loop runs silently — no repeated error spam.
- `screen_content_settings.enabled = 0` stops all AX polling; `excluded_app_names` also respected.
- `screen_text` IS sent to Claude for session fusion — it is the strongest signal for what the user was actively working on. Never contains secrets (they appear as `[REDACTED:type]` in clipboard; AX text of secure fields is never read).

### App Exclude List

Default: `Orbit, 1Password, Bitwarden, Keychain Access, LastPass, Dashlane, System Preferences, System Settings`

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
| `POST /chat` | `api.anthropic.com/v1/messages` | ✅ Live, disabled via `CLAUDE_ENABLED=false` (beta) |
| `POST /classify` | Gemini Flash REST API | ✅ Live, disabled via `GEMINI_ENABLED=false` (beta) |
| `POST /chat-groq` | `api.groq.com/openai/v1/chat/completions` | ✅ Live — Orbit's default provider during the beta. Uses caller's `X-Groq-Api-Key` header if present, else the Worker's own `GROQ_API_KEY` secret. Pipes the response body straight through (not buffered) so streaming (recall) works. |
| `GET /provider-status` | — (reads Worker secrets directly) | ✅ Live — no auth, returns `{"claude": bool, "gemini": bool, "groq": bool}`. Powers the read-only status rows in PrivacyPanel. |
| `POST /embed` | `api.voyageai.com/v1/embeddings` | ✅ Live |
| `POST /tts` | ElevenLabs | 🔲 Stub (Phase 4) |
| `POST /stt-token` | STT provider | 🔲 Stub (Phase 4) |

### Admin kill switch

`CLAUDE_ENABLED` / `GEMINI_ENABLED` / `GROQ_PROXY_ENABLED` — plain Worker secrets (not tied to any provider's own credential), each gate their route independently. Set the literal string `"false"` to disable; absent/unset/any other value = enabled (fail-open by design — a misconfigured or missing secret must never silently take the app down).

```bash
cd worker
npx wrangler secret put CLAUDE_ENABLED       # type: false (or true to re-enable)
npx wrangler secret put GEMINI_ENABLED       # type: false
npx wrangler secret put GROQ_PROXY_ENABLED   # type: false — pauses Groq app-wide if ever needed
```

Takes effect on the next request — no redeploy. Every backend caller already treats the resulting HTTP 503 as "provider unavailable" and degrades gracefully through existing error handling (no backend code changes needed to use this).

**Wrangler secrets:** `ANTHROPIC_API_KEY` `GEMINI_API_KEY` `VOYAGE_API_KEY` `GROQ_API_KEY` `CLAUDE_ENABLED` `GEMINI_ENABLED` `GROQ_PROXY_ENABLED` `ELEVENLABS_API_KEY` (Phase 4)

```bash
cd worker
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put VOYAGE_API_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler deploy
```

**worker/.dev.vars (gitignored):**
```
ANTHROPIC_API_KEY=your_key
GEMINI_API_KEY=your_key
VOYAGE_API_KEY=your_key
GROQ_API_KEY=your_key
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

**Reset onboarding + permissions for testing (dev):**
Use this to re-run the first-launch onboarding flow (Welcome → Accessibility →
Browser Automation → Chrome Extension → What to Expect) and the macOS
permission prompts, without touching captured memory data.

```bash
# Onboarding-completed flag only (plain file, safe to delete directly —
# does NOT touch orbit.db, orbit.db-shm/-wal, qdrant/, or qdrant_storage/)
rm ~/.orbit/onboarding_done

# Accessibility permission (window tracking, AXIsProcessTrusted check)
tccutil reset Accessibility com.saadaan.orbit

# Automation permission (osascript control of System Events + browsers for
# native browser URL capture) — resets every "Orbit wants to control X"
# grant for this bundle ID in one call, regardless of target app
tccutil reset AppleEvents com.saadaan.orbit
```

Quit Orbit via the tray icon's "Quit" item (not Cmd+Q — there's no app menu)
before running these, then relaunch to see onboarding and the permission
prompts again from a clean state.

---

## Release & Distribution

**The source repo (`Saadaan-Hassan/orbit`) is private.** GitHub does not support public release assets on a private repo — a beta tester without collaborator access gets a 404 on any download link. Releases are published to a **separate public repo, `Saadaan-Hassan/orbit-releases`**, that holds nothing but built `.dmg` downloads — no source code. This is configured via `owner`/`repo`/`releaseCommitish` inputs on the `tauri-action` step in `.github/workflows/release.yml`, and the in-app updater endpoint in `app/src-tauri/tauri.conf.json` points there too.

**Required secret:** `RELEASES_REPO_TOKEN` — a GitHub PAT (fine-grained, scoped to just `orbit-releases`, Contents: Read/write) added to the **private** repo's Actions secrets. The default `secrets.GITHUB_TOKEN` only has access to the repo running the workflow, so it can't publish to `orbit-releases`.

**Cut a release:**
```bash
git tag v0.2.0 && git push origin v0.2.0
```
Triggers `.github/workflows/release.yml`, which builds a sequential two-leg matrix — `macos-latest` (Apple Silicon, `aarch64`) and `macos-15-intel` (Intel, `x86_64`; `macos-13` was retired by GitHub in Dec 2025) — then a `merge-latest-json` job combines both legs' single-platform `latest.json` into one file with both platform keys and republishes it. This merge step exists because both matrix legs upload a same-named `latest.json` release asset — without the merge, the second leg to finish silently overwrites the first leg's platform entry and the updater only ever offers updates to whichever architecture built last. **This entire matrix + merge flow has not been verified by a real CI run** (as of when it was written) — check the Actions run after pushing a tag before relying on it, especially the Intel leg and the final merged `latest.json`'s `platforms` object having both `darwin-aarch64` and `darwin-x86_64` keys.

Each matrix leg also publishes a **version-agnostic copy** of its `.dmg` (`Orbit-latest-aarch64.dmg` / `Orbit-latest-x86_64.dmg`, `--clobber`-uploaded fresh on every release). The `/beta` landing page links directly to these via `github.com/Saadaan-Hassan/orbit-releases/releases/latest/download/<filename>` — that URL pattern always resolves to whatever release is currently "Latest", so **the landing page never needs updating after a new release**. Only the versioned filenames (e.g. `Orbit_0.2.0_aarch64.dmg`, which tauri-action uploads itself) change per release; the fixed-name copies exist purely so the beta page has something stable to link to.

**Not yet done:** Apple code-signing / notarization. `signingIdentity: null` in `tauri.conf.json`, no `APPLE_ID`/`APPLE_TEAM_ID`/`APPLE_CERTIFICATE` step in the workflow despite those being documented as expected secrets. Beta testers will see a Gatekeeper "Apple could not verify this app is free of malware" warning until this is set up — needs an Apple Developer Program membership. The `/beta` page's "What to expect" list warns testers about this and gives the right-click-Open workaround in the meantime.

**Sharing with beta testers:** the `/beta` landing page link is the entire flow now — it's not indexed and only shared with invitees, but it hosts real download buttons (Apple Silicon / Intel) directly, no per-user emailed link needed. Nothing to do per-tester; nothing to re-share per-release.

### Chrome extension distribution

**Do not distribute the extension as a zip for "Load Unpacked" beyond an initial/temporary stopgap.** Chrome does not auto-update developer-mode (unpacked) extensions, and as of Chrome 149 (2026) actively disables sideloaded/unpacked extensions periodically as a trust measure — every future code change would need manual re-sharing, and some testers' copies will silently stop working over time regardless. `extension/orbit-extension-v0.1.0.zip` is exactly this kind of stopgap artifact, not a real distribution channel.

**The real fix is the Chrome Web Store (Unlisted visibility)** — Chrome auto-updates Web Store extensions in the background (checks roughly every 5-6 hours), with zero action from beta testers. `.github/workflows/publish-extension.yml` automates every update *after* a one-time manual setup (full instructions in the workflow's header comment):
1. Register as a Chrome Web Store developer (one-time $5 fee).
2. Submit the extension **once manually** through the Web Store Developer Dashboard as Unlisted — first submissions always need human review, there's no API for the very first listing.
3. Create Google Cloud OAuth credentials (Desktop app type) and a refresh token for the Chrome Web Store API.
4. Add `CHROME_EXTENSION_ID`, `CHROME_OAUTH_CLIENT_ID`, `CHROME_OAUTH_CLIENT_SECRET`, `CHROME_OAUTH_REFRESH_TOKEN` as secrets on the private repo.

After that, ship an update with its own tag (separate from the app's `v*` tags):
```bash
# bump "version" in extension/manifest.json first — Web Store rejects a
# re-upload at the same version number
git tag ext-v0.1.1 && git push origin ext-v0.1.1
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
| Automation | Reading active browser tab URL and title via osascript | Phase 2.7 — requested during onboarding Step 2 of 5; always skippable. One macOS prompt per supported browser (Chrome, Safari, Arc, Brave, Edge). |
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
- Call Gemini, Voyage AI, Claude, or Groq directly — all go through Cloudflare Worker.
- Create new `httpx.AsyncClient`, `QdrantClient`, or `reqwest::Client` per request.
- Put `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `VOYAGE_API_KEY`, or `GROQ_API_KEY` in any `.env` file — Worker secrets only.
- Give `max_tokens` a generous, "just to be safe" budget on any Groq call. This model family has an observed repetition-loop failure mode on long single-shot outputs — a generous budget doesn't prevent it, it just lets a bad roll burn far more tokens (and cost) before hitting the ceiling. Size `max_tokens` tightly to what a legitimate response needs.
- Re-add a Claude/Gemini fallback inside `scheduler.py`'s Groq call sites without first checking whether the admin kill switch is still meant to be on — the branches were deliberately removed (not commented out), see `services.claude_service`/`services.gemini_service` import comment at the top of `scheduler.py`.
- Assume the auto-updater endpoint or release download links point at the source repo (`Saadaan-Hassan/orbit`) — they point at the public `Saadaan-Hassan/orbit-releases` repo. The source repo is private and its release assets are not publicly downloadable.
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
- Read `AXSecureTextField` elements at any traversal depth via the Accessibility API — password fields must be skipped before descending. This check is in `collect_text()` at every recursive call.
- Query any application other than the frontmost focused app via AXUIElement — `screen_content.rs` only reads from the focused app.
- Traverse AX element trees deeper than 3 levels or past 30 total elements — these caps prevent runaway traversal on complex UIs.

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
