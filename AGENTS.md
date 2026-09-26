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

**Distribution model:** Fully open source, self-build, BYOK. No maintainer-run
infrastructure of any kind exists — no built releases, no auto-updater, no AI
relay/proxy, no hosted backend. See "Distribution" further down.

**Completed phases:** Phase 0 ✅ Phase 1 ✅ Phase 2 ✅ Pre-beta hardening ✅ Phase 2.5 ✅ Phase 2.6 ✅ Phase 2.7 ✅ Phase 2.9 ✅ Phase 3 Pre-Beta UI ✅

---

## Critical Architecture Facts
**Read before writing any code. Most common points of confusion.**

| Fact | Detail |
|---|---|
| **AI is BYOK-direct end to end — no maintainer infrastructure of any kind exists (COST-002 → the Cloudflare Worker removal)** | Groq (chat, session summaries, recall) and Voyage AI (embeddings) are both called **directly** from the backend with the user's own key as a standard `Authorization: Bearer` header — there is no Cloudflare Worker, no relay, no maintainer-run server of any kind between this app and any AI provider. With no personal key configured, the relevant feature is simply unavailable (fails immediately, no network call attempted) — there is nothing to fall back to. Claude and Gemini support has been **removed entirely**: not routed anywhere, not disabled behind a flag, the service files themselves are deleted (`claude_service.py`/`gemini_service.py` no longer exist). |
| **No AI API keys anywhere the app controls** | A user's own Groq/Voyage key lives only in their local macOS Keychain (BYOK) and is attached per-request as a header directly to the provider's own API — never in `backend/.env`, SQLite, or anywhere else. |
| **Groq is Orbit's only chat/session-summary provider — BYOK-direct** | Session generation, event classification, AND recall (user-facing chat) all run on Groq — `services/groq_service.py` on the backend. There is no maintainer-funded fallback of any kind: `database.get_groq_api_key()` reads a user-configured key (Settings → Your Own Groq Key, `POST /settings/groq-key`) from the macOS Keychain (`com.heyorbit.orbit` / `groq-api-key`), not SQLite, immediately before use. With a key, `groq_service.py` sends requests **directly to `https://api.groq.com/openai/v1/chat/completions`** with `Authorization: Bearer <key>`. With no key, the call fails immediately (returns `None` / raises, depending on the function) with no network request attempted — there's no relay left to even try. Models (all three are `openai/gpt-oss-*` reasoning models as of **COST-004**, 2026-09 — Groq retired `llama-3.1-8b-instant`/`llama-3.3-70b-versatile` for free/developer tier on 2026-08-16; see `console.groq.com/docs/deprecations`): `openai/gpt-oss-120b` for both session summaries and recall (`reasoning_effort: "low"` on both — a reasoning model's chain-of-thought otherwise eats the max_tokens budget on classification/summaries, or adds latency on live-streamed recall), `openai/gpt-oss-20b` for classification (same `reasoning_effort: "low"`, plus a `GROQ_CLASSIFY_REASONING_TOKEN_HEADROOM` added to its tight per-event token budget — that budget was originally tuned against a repetition-loop failure mode *observed on the now-retired Llama model*; whether gpt-oss-20b shares it is unverified, no live Groq account was available to test against, so the conservative 30-event group cap was kept as a safe default. Recall's SSE wire format is unchanged — still OpenAI-compatible, different from Claude's `content_block_delta`, parsed by `stream_recall_response_groq()`). |
| **No admin kill switch, and never will be — there's nothing left to switch** | The former `CLAUDE_ENABLED`/`GEMINI_ENABLED`/`GROQ_PROXY_ENABLED` Worker secrets, the `GET /provider-status` route, and the Worker itself are all gone. Groq and Voyage are pure BYOK (a missing key simply means that feature is unavailable, not "disabled by admin"), and Claude/Gemini support was removed outright — their service files are deleted, not kept behind a switch. |
| **google-genai SDK was never installed, and Gemini support is fully deleted** | `gemini_service.py` no longer exists in this codebase at all (previously kept as unreachable dead code pointing at a Worker route that no longer existed; deleted outright once the Worker itself was removed). The `google-genai` package was never a dependency. |
| **APScheduler v3.x (stable)** | Session generation uses `AsyncIOScheduler` from `apscheduler.schedulers.asyncio` — this is v3.x stable. Import path: `from apscheduler.schedulers.asyncio import AsyncIOScheduler`. Never use APScheduler v4 (`from apscheduler import AsyncScheduler`) — that is explicitly pre-release and unstable. |
| **Rust writes SQLite directly** | Clipboard + window + file_activity + browser_url events → SQLite directly from Rust. Never through FastAPI. Only the Chrome Extension POSTs to FastAPI. `unified_poller.rs` writes `type='url', source='native_browser'` events. |
| **No Docker for Qdrant, and it's fully lazy (COST-003)** | `QdrantClient(path="~/.orbit/qdrant_storage")` local file mode. No server, no Docker. Its storage is never created or opened until the first successful Voyage embedding — an install that never configures a personal Voyage key never touches Qdrant at all. `add_session_embedding()`/`search_sessions_semantic()` generate the embedding first and only reach `_get_client()`/`initialize_qdrant_collection()` after that succeeds; neither `main.py`'s startup nor `scheduler.py`'s per-cycle run initialise it unconditionally anymore. |
| **Secrets redacted at capture, content flows to AI** | Clipboard secrets become `[REDACTED:type]` in `clipboard.rs` BEFORE any DB write. After that, `raw_content` (window titles, URLs, safe clipboard text) IS sent to Gemini and Claude — they need it to write useful summaries. App names alone are meaningless. The redaction layer is what makes this safe. |
| **Native browser URL capture (Rust)** | `unified_poller.rs` polls the active browser tab every 8 s (combined with window + app lifecycle in a single osascript call). Supports Chrome, Safari, Arc, Brave Browser, Microsoft Edge (not Firefox). Requires macOS Automation permission. Sets `pub static BROWSER_AUTOMATION_DENIED: AtomicBool` when error -1743 fires; clears on next success. Writes `type='url', source='native_browser'` directly to SQLite. |
| **Two-layer browser capture** | Native (default, no install) captures URL + page title via osascript. Extension (optional, richer) captures `page_content`, `search_query`, `link_click` plus article body. Both can be active simultaneously. Native toggled via `browser_capture_settings.native_enabled`; extension is independent. |
| **Browser event dedup (10-second window)** | When a `url` event arrives at FastAPI `/capture`, `_find_recent_url_event()` queries `events(url, timestamp)` using `idx_events_url_timestamp`. Extension beats native_browser: new native dropped if extension exists within 10 s; new extension DELETEs existing native. Safety-net dedup also in `scheduler.py` + `recall.py` (page_text-present wins; else first occurrence). |
| **`browser_capture_settings` table** | Single row (id=1): `native_enabled INTEGER NOT NULL DEFAULT 1`. Seeded by FastAPI on startup. `unified_poller.rs` reads this every 30 s — fallback to `true` if absent. Managed via `GET/POST /privacy/browser-capture`. |
| **Automation permission for native browser capture** | macOS Automation permission must be granted for osascript to read browser tab URLs. Requested at onboarding Step 2 of 5 (always skippable). Three Tauri commands in `lib.rs`: `check_browser_automation_permission`, `trigger_browser_automation_prompt`, `open_automation_system_settings`. |
| **Recall uses query intent classification** | `classify_query_intent()` in `recall.py` returns "work", "personal", or "general". Only a "work"-intent query excludes `category = 'personal'` events from FTS5 results. "personal" queries include all events and prompt Claude to surface URLs. "general" (the default when no clear signal is present, or when both signals fire) includes everything. |
| **Recall has offline FTS5 fallback** | FTS5 keyword search always runs first (local, no network). If Groq is unreachable (no key configured, or `httpx.ConnectError` / `TimeoutException`), AI synthesis is skipped and FTS5 results are streamed as a plain offline message. |
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
| **Signal fusion session prompt** | Phase 2.9 replaces the flat per-event JSON prompt with a labelled text-line format. `_build_fused_signals()` serialises each event chronologically as one readable line: `[14:30] APP focus: VS Code — window: "billing.service.ts"`, `[14:31] SCREEN text: "..."`, `[14:31] FILE modified: /path/to/file`, etc. `FUSION_SESSION_SYSTEM_PROMPT` instructs the model to act as a detective: triangulate overlapping signals, name real files/topics/tickets, produce a concrete `next_step`. Session generation runs on **Groq** (`generate_session_summary_groq()`, `openai/gpt-oss-120b`) — see "Groq is Orbit's only chat/session-summary provider" above; the former Claude-based path (`claude_service.py`) no longer exists in this codebase at all. New session columns: `activity` (what specifically they did), `next_step` (concrete continuation), `blockers` (what they seemed stuck on). |
| **FTS5 indexes screen_text** | `events_fts` virtual table now indexes 5 columns: `raw_content, app_name, url, page_text, screen_text`. Keyword recall queries that match on-screen text snippets return `screen_content` events. `_migrate_schema()` in `database.py` drops and rebuilds the FTS5 table + triggers when `screen_text` is absent from an existing index. |
| **`next_step` column — user-facing label only** | The DB column `sessions.next_step` and all API field names are unchanged. Only user-visible labels changed: session cards show **"Where you left off"** (MemoryViewer, TimelineView) instead of "Next step". The `RECALL_SYSTEM_PROMPT` instructs Claude to *describe where the user was* rather than prescribe what to do next. The context block sent to Claude labels the field `Where they left off:` instead of `Next step:`. Never rename the DB column or API field. |
| **Activity Timeline tab** | New "Timeline" tab in the app (fourth option in the header selector; calendar icon in the collapsed pill). `TimelineView.tsx` fetches `GET /timeline/day?date=YYYY-MM-DD` and `GET /timeline/dates` via `useTimeline.ts`. Shows a proportional horizontal strip with coloured session blocks, date pill navigation (last 10 days), 3 stat cards, and a threaded session list. "Ask Orbit about this" on a session card sets `pendingQuery` in Zustand and switches the active panel to "chat". |
| **Activity Timeline backend routes** | `backend/routes/timeline.py` — `GET /timeline/day?date=YYYY-MM-DD` returns sessions + stats for one calendar day; `GET /timeline/dates` returns all dates that have sessions (newest-first). Both convert the local YYYY-MM-DD date to UTC ms using `datetime().astimezone()` — correct because the backend runs on the user's machine. Registered with prefix `/timeline` in `main.py`. |
| **Project Cards dashboard** | `RecallSearch.tsx` renders `<ProjectCards>` in the scrollable area when `conversationHistory.length === 0 && !isStreaming`. When `inputValue.length > 0` the cards fade to `opacity: 0` (CSS 0.2 s ease-out) with `pointer-events: none` — they reappear when the input is cleared. Cards never render if no projects exist (clean empty state on first install). |
| **`GET /projects` backend route** | `backend/routes/projects.py` — aggregates sessions into one card per project. Groups by `LOWER(TRIM(project_name))` so "Orbit" and "orbit" collapse into a single card (case-insensitive dedup). Display name comes from the most recent session. Returns `project_name`, `last_active_ms`, `activity`, `ai_summary`, `weekly_active_minutes`, `session_count`, plus `today_active_minutes` for the header badge. Module-level 5-min cache in `useProjects.ts`; force-refreshes on `document.visibilitychange`. |
| **Project color palette** | 8 warm colours: `["#E8A87C","#85C1E9","#82E0AA","#F1948A","#BB8FCE","#F8C471","#76D7C4","#AEB6BF"]`. Assigned deterministically: polynomial hash of `project_name` chars, `Math.abs(hash) % 8`. Lives in one place, `app/src/lib/project-color.ts` (`getProjectColor()`), imported by both `TimelineView.tsx` and `ProjectCards.tsx` — previously duplicated verbatim in both files (a real drift risk, fixed under `CI-001`), now a single source of truth so a project always gets the same colour across both views. Never use random colours for projects, and never reintroduce a second copy of this function. |
| **`pendingQuery` Zustand bridge** | `orbitStore.ts` has `pendingQuery: string \| null`, `setPendingQuery`, `clearPendingQuery`. Used by Timeline's "Ask Orbit about this" to pass a query to `RecallSearch` after switching tabs. `RecallSearch` watches `pendingQuery` in a `useEffect` and auto-submits when it is set (clears it immediately to prevent double-fire). |

---

## Architecture

```
┌──────────────────────────────────────┐
│       UI / Companion Layer            │  React + Tauri window system
├──────────────────────────────────────┤
│       AI Reasoning Layer              │  BYOK-direct — no maintainer infra
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
httpx → api.groq.com direct (BYOK) — no key configured, no request attempted
    │  → openai/gpt-oss-20b (classify_events_batch_groq, COST-004)
    │  classifies: work / research / personal / system / communication
    │  updates events.category in SQLite
    │  (Claude/Gemini classification no longer exists in any form — the
    │   service files themselves were deleted, not just made unreachable)
    ▼
_build_fused_signals() → labelled text lines per event
    │  [HH:MM] APP focus: <app> — window: "<title>"
    │  [HH:MM] SCREEN text: "<accessible text snippet>"
    │  [HH:MM] FILE modified: /path/to/file
    │  [HH:MM] CLIPBOARD: "<redacted-safe text>"
    │  [HH:MM] BROWSER: <url> — "<page title>"  etc.
    ▼
httpx → api.groq.com direct (BYOK) → openai/gpt-oss-120b
    │  (structured extraction, runs every 30 min; generate_session_summary_groq, reasoning_effort="low")
    │  FUSION_SESSION_SYSTEM_PROMPT: detective triangulation across overlapping signals
    │  generates: {project_name, goal, activity, summary, last_action, next_step, blockers, key_resources, topics, evidence}
    │  active_minutes = (window events with is_user_active=1) × 30 s ÷ 60
    │  INSERT INTO sessions  (includes activity, next_step, blockers, active_minutes, topics)
    ▼
httpx → api.voyageai.com direct (BYOK) — no maintainer relay of any kind
    │  no personal Voyage key configured → raises immediately, no request sent;
    │  caught by scheduler.py, session saved with embedding_id=NULL (graceful — see below)
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
    ▼ try: Groq reachable? (personal key configured, network up)
    │
    ├── YES ──► if time_range active:
    │               fetch_sessions_by_time_range() → best session per project_name
    │               Qdrant (up to 8) fills slots for projects not in DB results
    │               total capped at 12; one entry per distinct project_name
    │           else (no time range):
    │               httpx → api.voyageai.com direct (BYOK) → Qdrant semantic search
    │               no personal Voyage key → skipped, falls through to FTS5-only results
    │               returns: up to 8 sessions
    │               re-rank: (similarity × 0.7) + (recency × 0.3)
    │                   │
    │                   ▼
    │           httpx → api.groq.com direct (BYOK) → openai/gpt-oss-120b (user-facing, COST-004)
    │                   stream_recall_response_groq() in groq_service.py — OpenAI-compatible SSE.
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
    └── NO (no personal Groq key, or ConnectError / TimeoutException)
            stream FTS5 results as plain offline message — no AI synthesis
```

---

## Monorepo Structure

```
orbit/
├── AGENTS.md                               ← you are here
├── CLAUDE.md                               ← symlink: ln -sf AGENTS.md CLAUDE.md
├── docs/
│   ├── ARCHITECTURE.md                     ← external-facing trust-boundary map; read this before AGENTS.md if you're new
│   ├── THREAT_MODEL.md                     ← what's defended against, mitigations, explicit non-goals
│   ├── PRIVACY_DATA_FLOW.md                ← field-by-field: every captured type, sanitization point, what's sent to AI
│   ├── adr/                                ← one ADR per material architecture decision (local API auth, consent, sanitization, Keychain storage, Tauri hardening, lazy semantic search, telemetry removal)
│   └── screenshots/                        ← app screenshots used in root README.md
├── app/                                    ← Tauri v2 desktop app
│   ├── src/
│   │   ├── main.tsx                        ← app entry point, renders <App /> (no telemetry wrapper — OBS-001)
│   │   ├── components/
│   │   │   ├── OnboardingFlow.tsx          ← 5-step first-launch: Welcome→Accessibility→BrowserAutomation→Extension(optional)→Tips
│   │   │   ├── ErrorBoundary.tsx           ← global error boundary → console.error only (no remote reporting, OBS-001) → friendly message → restart button
│   │   │   ├── RecallSearch.tsx            ← recall UI + ProjectCards dashboard; fades cards when user starts typing
│   │   │   ├── ActivityTimeline.tsx        ← scrollable raw-event feed (rendered as children of RecallSearch)
│   │   │   ├── ProjectCards.tsx            ← project cards dashboard; 2-col grid; shown when conversation is empty
│   │   │   ├── Timeline/
│   │   │   │   └── TimelineView.tsx        ← Timeline tab: date nav pills, stat cards, proportional strip, session list
│   │   │   ├── MemoryViewer.tsx            ← view + delete events/sessions (two-tab UI)
│   │   │   ├── PrivacyPanel.tsx            ← capture toggle, excluded apps, excluded websites, browser tracking toggle (BrowserTrackingSection), file activity watching, wipe button; ScreenContentSection rendered FIRST; two `ApiKeySection` instances (Groq, Voyage — add/replace/test/remove/disable BYOK, COST-001/002)
│   │   │   └── OrbWidget.tsx               ← floating companion orb (Phase 4)
│   │   ├── store/
│   │   │   └── orbitStore.ts               ← Zustand: conversationHistory: Message[] + pendingQuery (Timeline→Chat bridge)
│   │   ├── hooks/
│   │   │   ├── useRecall.ts                ← POST /recall, appends to conversationHistory
│   │   │   ├── useTimeline.ts              ← fetches /timeline/day + /timeline/dates; Map cache; setSelectedDate()
│   │   │   ├── useProjects.ts              ← fetches /projects; module-level 5-min cache; visibility-change refresh
│   │   │   ├── useOnboarding.ts            ← onboarding state, polls accessibility + browser automation every 3s; requestBrowserAutomation()
│   │   │   ├── usePrivacySettings.ts       ← privacy API calls; excluded domains + normalizeDomain(); nativeBrowserEnabled + setNativeBrowserEnabled; file watching CRUD; screenContentEnabled + setScreenContentEnabled
│   │   │   ├── useApiKeySettings.ts        ← generic BYOK hook (COST-001/002), parameterized by providerPath ("groq-key" | "voyage-key"): GET/POST/DELETE /settings/<provider>-key + POST .../test + .../enabled; exposes {configured, enabled}, never the raw key
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
│   │   ├── recall.py                       ← POST /recall: FTS5 + Qdrant → Groq SSE (BYOK-direct)
│   │   ├── privacy.py                      ← excluded apps CRUD, pause/resume, wipe
│   │   ├── settings.py                     ← BYOK CRUD for GET/POST/DELETE /settings/groq-key and /settings/voyage-key + .../test + .../enabled
│   │   ├── feedback.py                     ← POST /feedback
│   │   ├── timeline.py                     ← GET /timeline/day, GET /timeline/dates
│   │   └── projects.py                     ← GET /projects (aggregated cards, case-insensitive dedup)
│   ├── services/
│   │   ├── groq_service.py                 ← httpx singleton → direct api.groq.com (BYOK) — session summaries, classification, AND recall streaming; no key = fails immediately, no request attempted
│   │   ├── voyage_service.py               ← httpx singleton → direct api.voyageai.com (BYOK) — no maintainer relay of any kind
│   │   ├── qdrant_service.py               ← QdrantClient local file singleton
│   │   ├── time_parser.py                  ← extracts time ranges from natural language queries
│   │   └── redaction_service.py            ← inline redaction for browser-captured text (page_text, search queries)
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
├── landing/                                 ← fully static (SITE-001) — no server, no DB, no email, no waitlist
│   ├── next.config.ts                       ← output: "export"; pnpm build writes out/, deployable to any static host
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx                        ← landing page (Server Component). Hero + "View on GitHub" CTA + clone instructions + "what you'll need to build" disclosure — no downloads, no waitlist form
│   │   │   ├── layout.tsx                      ← root layout, metadata (metadataBase, OG, Twitter cards)
│   │   │   ├── opengraph-image.tsx             ← auto-wired OG/Twitter image (1200×630, ImageResponse). `dynamic = "force-static"`, no `runtime = "edge"` — required for static export; generated once at build time
│   │   │   ├── globals.css                     ← @import "tailwindcss" (Tailwind v4)
│   │   │   ├── favicon.ico
│   │   │   ├── not-found.tsx                   ← 404 page
│   │   │   └── privacy/
│   │   │       └── page.tsx                    ← privacy policy (Server Component) — states plainly Orbit sends no telemetry (OBS-001)
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   │   ├── button.tsx                  ← ShadCN button
│   │   │   │   └── input.tsx                   ← ShadCN input
│   │   │   ├── background-orbit.tsx            ← animated background decoration
│   │   │   ├── header.tsx                      ← site header / nav
│   │   │   └── footer.tsx                      ← site footer with links
│   │   └── lib/
│   │       └── utils.ts                        ← shared utilities (cn, etc.)
│   └── [config files, package.json, etc.]
├── scripts/
│   └── check-versions.sh                   ← DOC-006 version-consistency check; run after bumping app/backend/extension versions, see Build & Run
└── .github/
    ├── dependabot.yml                       ← github-actions, cargo, uv, and per-workspace npm coverage
    └── workflows/
        ├── ci.yml                           ← PR checks — one job per workspace, plus gitleaks + dependency-review
        └── codeql.yml                       ← CodeQL for javascript-typescript + python (Rust not yet added, see roadmap)
```

No release automation exists — no `release.yml`, no `publish-extension.yml`, no `releases/` directory, no auto-updater. This is a self-build, BYOK project by design: clone it, build it yourself (see Build & Run below). See "Distribution" further down for the full reasoning.

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
| Crash reporting / analytics | None — removed entirely (OBS-001). No remote telemetry of any kind. |
| Auto-updates | None, deliberately — this is a self-build project with no release feed to check. `tauri-plugin-dialog` (folder picker) and `tauri-plugin-process` (app restart) remain for unrelated features. |

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
| `tauri-plugin-dialog` | Native dialogs (folder picker) |
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
| `httpx` | HTTP singleton → Groq/Voyage AI, always direct with the user's own key (BYOK) — no maintainer relay of any kind |
| `qdrant-client` | Vector store, local file mode — no fastembed, no Docker |
| `apscheduler>=3.10,<4.0` | Session generation scheduler — `AsyncIOScheduler` from v3.x stable only |

**Never install:**
`google-genai` `google-generativeai` `sentence-transformers` `torch`
`onnxruntime` `qdrant-client[fastembed]` `posthog` `sentry-sdk` — no remote
telemetry of any kind (OBS-001).

**APScheduler:** Use `apscheduler>=3.10,<4.0` (v3.x stable). Never install bare
`apscheduler` without a version pin — pip/uv may resolve to v4 pre-release.
Import path for v3.x: `from apscheduler.schedulers.asyncio import AsyncIOScheduler`.

### AI Models

**BYOK-direct — no maintainer-funded fallback and no maintainer infrastructure exists for any provider:**

| Task | Model | Route |
|---|---|---|
| User recall + conversation | `openai/gpt-oss-120b` (`GROQ_RECALL_MODEL`, `groq_service.py`), `reasoning_effort: "low"` — **COST-004**, replaces the Llama model Groq retired 2026-08-16 | Direct `api.groq.com` if a personal Groq key is configured; otherwise unavailable immediately, no request attempted (falls back to the offline FTS5 message) |
| Background session summaries (signal fusion) | `openai/gpt-oss-120b` (`GROQ_SESSION_MODEL`), `reasoning_effort: "low"` | Same rule as above — every 30 min |
| Event classification | `openai/gpt-oss-20b` (`GROQ_CLASSIFY_MODEL`), `reasoning_effort: "low"` — **COST-004**, replaces the Llama model Groq retired 2026-08-16 | Same rule — groups capped at 30 events (quality ceiling, see Critical Architecture Facts; whether it still applies to this model is unverified) |
| Session embeddings | Voyage AI `voyage-3-lite` (512 dims) | Direct `api.voyageai.com` if a personal Voyage key is configured; otherwise skipped — sessions save with `embedding_id=NULL`, semantic search just has nothing to search |
| Voice STT (Phase 4) | Whisper.cpp → Apple Speech fallback | local only |
| Voice TTS (Phase 4) | Kokoro TTS → ElevenLabs Pro | local / not yet built (no relay of any kind exists for this — a future implementation would need its own direct-to-provider or fully local design) |

**Removed entirely, not just disabled — the service files themselves are deleted, no route, no BYOK path, no maintainer-funded key remains for either:**

| Task | Model | Status |
|---|---|---|
| User recall + conversation | Claude Sonnet 4.6 (`RECALL_MODEL`) | `claude_service.py` deleted |
| Background session summaries (signal fusion) | Claude Haiku 4.5 (`SUMMARY_MODEL`) | `claude_service.py` deleted |
| Event classification | `gemini-3.1-flash-lite` | `gemini_service.py` deleted |

Neither was in active use during the beta (both were already kill-switched off
before the Worker that gated them was removed entirely), and neither has ever
had a BYOK path built for it in this codebase — restoring either means
designing and building that from scratch, not just restoring a deleted file.

### Storage
| Layer | Tool | Notes |
|---|---|---|
| Structured events | SQLite `~/.orbit/orbit.db` | All events, sessions, memory objects |
| Keyword search | SQLite FTS5 (built-in) | BM25, porter tokenizer. Indexes 5 columns: `raw_content, app_name, url, page_text, screen_text` — article body and on-screen text are searchable. |
| Semantic search | Qdrant `~/.orbit/qdrant_storage/` | `QdrantClient(path=...)`, no Docker |

### Landing Page
| Layer | Tool | Notes |
|---|---|---|
| Framework | Next.js 16.2.7 | App Router ONLY — no Pages Router. `output: "export"` (SITE-001) — fully static, no server |
| Styling | Tailwind CSS v4 | `@import "tailwindcss"` in globals.css — no config file |
| Deploy | Any static host | GitHub Pages, Cloudflare Pages, or Vercel's static hosting — `pnpm build` writes `out/`. No email service, no waitlist DB, no Server Actions (removed, SITE-001) |

**Next.js 16 rules:**
- Server Components by default. `'use client'` only for event handlers/hooks.
- `await params` always — params are async in Next.js 16.
- No Server Actions — unsupported under `output: "export"`. No API routes for the same reason.
- `next/image` usages need the `unoptimized` prop — default Image Optimization requires a server, unsupported under static export.
- `opengraph-image.tsx`/any metadata image route needs `export const dynamic = "force-static"` and must NOT set `runtime = "edge"` (the two are incompatible) for static export to include it.

### Infrastructure
| Tool | Purpose |
|---|---|
| Lemon Squeezy | Payments (Phase 5) |

No maintainer-run infrastructure of any kind exists for this project — no
Cloudflare Worker (removed entirely; every AI call is BYOK-direct), no
release/distribution server, no auto-update feed, no waitlist DB or email
service (the landing site is fully static with no backend of any kind,
SITE-001). A future cloud sync opt-in (Phase 5) would need to pick its own
infrastructure when built; nothing is provisioned for it today.

No crash reporting or analytics infrastructure exists — removed entirely,
not just disabled (OBS-001).

---

## Key Files

| File | Purpose |
|---|---|
| `app/src/main.tsx` | App entry point. Renders `<App />` directly — no telemetry provider wrapper (OBS-001). |
| `app/src/components/OnboardingFlow.tsx` | 5-step first-launch: Welcome → Accessibility (polls every 3s, auto-advances) → Browser Automation (Step 2 of 5 — polls `check_browser_automation_permission` every 3s, always skippable via `hasAdvanced` ref guard) → Chrome Extension (optional) → What to Expect. Blocks main UI until complete. |
| `app/src/components/ErrorBoundary.tsx` | Class component. Catches render errors → `console.error` only, no remote reporting (OBS-001) → friendly message → restart button. |
| `app/src/components/RecallSearch.tsx` | Recall UI. Renders `<ProjectCards>` in the scrollable area when `conversationHistory.length === 0 && !isStreaming`; passes `isVisible={inputValue.length === 0}` so cards fade on typing. Watches `pendingQuery` in Zustand and auto-submits queries from Timeline's "Ask Orbit" button. |
| `app/src/hooks/useRecall.ts` | POST /recall. Sends `conversation_history`. Appends each turn to Zustand store. Max 4 turns enforced here. |
| `app/src/hooks/useOnboarding.ts` | Checks accessibility + browser automation permission on mount. Polls every 3s while onboarding is open. `requestBrowserAutomation()` calls `trigger_browser_automation_prompt` then polls `check_browser_automation_permission` every 3s until granted or unmount. `shouldPollBrowserAutomation = useRef(false)` controls the loop without re-renders. Persists completion state. |
| `app/src/hooks/usePrivacySettings.ts` | Loads privacy settings in parallel on mount (capture status, excluded apps, excluded domains, browser-capture settings, file-watch settings, screen-content settings). Exposes `screenContentEnabled` + `setScreenContentEnabled` (POSTs to `/privacy/screen-content`) alongside `nativeBrowserEnabled`, `setFileWatchEnabled`, `addWatchedFolder`, `removeWatchedFolder`, app/domain CRUD. `normalizeDomain()` strips URL to bare hostname. |
| `app/src/store/orbitStore.ts` | Zustand global state. `conversationHistory: ConversationMessage[]` — reset on new topic, preserved within session. `pendingQuery: string \| null` — Timeline→Chat bridge: set by `TimelineView` "Ask Orbit" button, auto-submitted and cleared by `RecallSearch`. |
| `app/src-tauri/src/main.rs` | Entry point. Sets LSUIElement, system tray, spawns FastAPI subprocess, creates SQLite pool, starts clipboard + unified_poller + screen_content + file_activity + system_state as tokio tasks. Dev-mode-only: spawns `uv run uvicorn` directly (see `spawn_fastapi_backend()`); release builds spawn the sidecar from `lib.rs` instead. |
| `app/src-tauri/src/capture/clipboard.rs` | 500ms poll. Runs `detect_sensitive_content_type()` before writing. Stores `[REDACTED:type]` for matches. Deduplicates same content within 5 minutes. |
| `app/src-tauri/src/capture/unified_poller.rs` | Single 8 s combined osascript loop replacing the former window.rs (30 s), browser_url.rs (5 s), and app_lifecycle.rs (10 s). Structured output lines parsed by `parse_poll_output()`: `APP:name\|\|\|TITLE:title`, `RUNNING:app1,app2,...`, `BROWSER_URL:url\|\|\|BROWSER_TITLE:title`, `BROWSER_ERROR:automation_denied`. `UnifiedPollCache` refreshed every 30 s: is_paused, excluded_app_names, excluded_domains, native_browser_enabled. Idle detection via inline `CGEventSourceSecondsSinceLastEventType` (IDLE TIMER ONLY — never keystroke content); sets `is_user_active`. `is_noise_app_name()` filters system helpers. `KNOWN_BROWSER_APP_NAMES` and `pub static BROWSER_AUTOMATION_DENIED: AtomicBool` live here. |
| `app/src-tauri/src/capture/file_activity.rs` | FSEvents file activity monitor using `notify` + `notify-debouncer-full`. 2-second debounce. Reads `file_watch_settings` from SQLite on startup and every 30 s via `tokio::select!`; syncs the watcher using a `currently_watched: HashSet<String>` diff. Skips hidden files/dirs, blocked high-noise directories, and transient file suffixes (.tmp, .swp, .lock, .log). `BLOCKED_DIRECTORY_NAMES`: `node_modules, .git, target, __pycache__, .next, dist, build, Library, .cache, venv, .venv, DerivedData, Pods, xcuserdata, xcshareddata, capacitor-cordova-ios-plugins, capacitor-cordova-android-plugins, .gradle, .android`. The iOS/Xcode/Capacitor entries were added to prevent a single `npx cap sync` + Xcode build from flooding hundreds of file_activity events and creating dozens of near-identical sessions. Writes `file_activity` events with `file_path` and `metadata={"action":"created|modified|removed"}`. NEVER reads file contents. |
| `app/src-tauri/src/capture/system_state.rs` | macOS system state monitor. Uses `notify_register_file_descriptor` (Darwin C API in libSystem — no new crates). Registers 4 Darwin notifications: `com.apple.screenIsLocked` → "lock", `com.apple.screenIsUnlocked` → "unlock", `com.apple.system.willsleep` → "sleep", `com.apple.system.didwake` → "wake". Each fd gets a dedicated blocking OS thread; events bridge to tokio via `mpsc::unbounded_channel`. Writes `type='system_state'` events with `raw_content=<state>` and `metadata={"state":"..."}`. No-op on non-macOS. |
| `app/src-tauri/src/capture/screen_content.rs` | On-screen text capture via macOS AXUIElement. 8 s poll. All AX calls via raw `extern "C"` bindings (ApplicationServices + CoreFoundation) in `spawn_blocking`. `ScreenContentCaptureCache` reads `screen_content_settings.enabled`, pause state, excluded apps every 30 s. `CFOwned` RAII struct ensures CF pointer lifecycle. `capture_screen_content_sync()` returns `CaptureOutcome::Success` or `CaptureOutcome::ApiDisabled`. `collect_text()` traverses focused UI element — **skips `AXSecureTextField` at every depth unconditionally**, max depth 3, max 30 elements. Text truncated to 1 500 chars, deduped by equality. `AXErrorAPIDisabled` logged once via `AtomicBool`, then silently suppressed. Writes `type='screen_content'`, `raw_content=window_title`, `screen_text=accessible_text`. No-op branch on non-macOS (`#[cfg(not(target_os = "macos"))]`). |
| `app/src-tauri/src/db.rs` | sqlx SQLite pool. **Single pool shared everywhere. Never open new connections.** |
| `app/src-tauri/src/lib.rs` | Tauri app setup + all `#[tauri::command]` functions via `generate_handler!`. Phase 2.7 additions: `check_browser_automation_permission` (probes each known browser via osascript), `trigger_browser_automation_prompt` (surfaces the macOS Automation dialog), `open_automation_system_settings` (deep-links to `Privacy_Automation` pane). `BROWSER_NAMES_FOR_AUTOMATION_PROBE` constant matches `KNOWN_BROWSER_APP_NAMES` in `unified_poller.rs`. Also spawns the release-mode sidecar and runs the post-startup `GET /health` readiness probe (`HEALTH_CHECK_MAX_ATTEMPTS = 120`, 1 s apart — generous on purpose, since a self-build user's first launch may need `uv` to install the entire Python dependency set from scratch before the backend can even start); emits `backend-ready`/`backend-unavailable`, which `App.tsx`'s own independent 125 s failsafe timer must stay >= to avoid pre-empting a check that's still running. |
| `app/src-tauri/Info.plist` | `LSUIElement = true`. Never remove. Orbit never appears in the dock. |
| `app/src-tauri/tauri.conf.json` | Two windows: `main` (panel, skipTaskbar, transparent, decorations:false) and `overlay` (Phase 4: fullscreen, alwaysOnTop, focus:false, transparent). |
| `backend/main.py` | FastAPI with `@asynccontextmanager` lifespan. No telemetry init of any kind (OBS-001). Starts the `AsyncIOScheduler` session-generation job via `create_session_scheduler()`. GET /health endpoint. |
| `backend/database.py` | SQLAlchemy async engine. Creates all tables + FTS5 virtual table + auto-sync triggers on startup. Events schema includes `page_text`, `link_target`, `metadata`, `file_path`, `is_user_active`, `screen_text` (Phase 2.9). FTS5 indexes 5 columns: `raw_content, app_name, url, page_text, screen_text`. `_migrate_schema()` drops + rebuilds FTS5 table + triggers when `screen_text` absent. `idx_events_url_timestamp` index on `events(url, timestamp)`. Sessions schema includes `last_action`, `key_resources`, `topics`, `active_minutes`, `activity`, `next_step`, `blockers` (Phase 2.9). `screen_content_settings` table (single row, id=1) seeded with `enabled=1`. `file_watch_settings` table seeded with default folders. `browser_capture_settings` table seeded with `native_enabled=1`. `search_events_fts()` SELECT now includes `file_path` and `screen_text`. `fetch_sessions_by_time_range(start_ms, end_ms, max_per_project=1)` returns the best session per distinct `project_name` within a time window — used by `recall.py` for time-range queries as the primary session source. |
| `backend/scheduler.py` | `AsyncIOScheduler` (APScheduler v3.x stable). `create_session_scheduler()` returns a configured scheduler with 30-min interval and `next_run_time=now`. `generate_sessions_from_recent_events()`: fetch → `_split_events_at_system_boundaries()` → per batch: `_dedup_events_by_url_for_prompt()` → classify (`_classify_events_with_configured_provider()` → **Groq**, `classify_events_batch_groq`) → `_build_fused_signals()` (labelled text lines: `[HH:MM] APP focus / SCREEN text / FILE / CLIPBOARD / BROWSER / …`) → `FUSION_SESSION_SYSTEM_PROMPT` (detective triangulation) → **Groq** (`generate_session_summary_groq`, `openai/gpt-oss-120b`) → embed (Voyage) → mark processed. Claude/Gemini are not referenced anywhere in this file — their service files are deleted entirely; restoring either means designing and building a new BYOK integration from scratch. On Groq failure, batch is stamped `session_id='parse_failed'` (circuit breaker — prevents the same backlog being reclassified every 30-min cycle forever, a real incident observed in production before this existed) and picked up later by the bounded `_retry_parse_failed_events()` recovery lane (≤20 events/cycle). New session fields extracted: `activity`, `next_step`, `blockers`. `_ensure_sessions_schema_columns_exist()` adds `topics`, `active_minutes`, `activity`, `next_step`, `blockers`. SQL SELECTs include `screen_text, file_path, is_user_active, category`. |
| `backend/routes/recall.py` | FTS5-first sequential pipeline. (1) Classify intent. (2) Parse time reference. (3) Optionally fetch system_state events. (4) FTS5 keyword search (returns `file_path` + `screen_text` columns now). (5) URL dedup. (6) Session lookup → AI SSE (**Groq**, BYOK-direct — `stream_recall_response_groq()`, `groq_service.py`). **Session lookup strategy differs by query type:** for queries WITHOUT a time range, uses Qdrant semantic search (up to 8 sessions, re-ranked by similarity × 0.7 + recency × 0.3); for queries WITH a time range ("yesterday", "today", etc.), uses `fetch_sessions_by_time_range()` as primary source (one session per distinct project_name, ordered by active_minutes then duration), then fills remaining slots up to 12 with Qdrant results for projects not already covered. This ensures "what did I work on yesterday?" returns all projects rather than only the semantically closest one. Context block: `screen_content` events formatted as `[time] In <app>: "<screen_text snippet>"`. Session block shows fused fields: `What you were doing: <activity>` (falls back to `Summary` for pre-Phase-2.9 sessions), `Goal`, `Where they left off: <next_step>`, `Left off: <last_action>`, `Blocked on: <blockers>`, `Topics`, `Resources`, `Active time`. The context label was renamed from `Next step:` to `Where they left off:` as part of the context-restoration UX philosophy change. **Two independent fallback tiers (COST-003, ADR-006):** semantic search (Qdrant/Voyage) soft-fails to an empty list on `VoyageUnavailableError` or any `httpx` transport/status error — Groq synthesis still runs on FTS5-only (+ DB-scan, for time-range queries) context either way, so a Groq-keyed user with no Voyage key still gets a real AI-composed answer, not a raw dump. Only a *Groq*-side failure (no personal key configured, so nothing is even attempted; network down; rate-limited) triggers the plain-text offline fallback (`_format_fts5_fallback`, on `httpx.ConnectError`/`TimeoutException`/`HTTPStatusError`) — genuinely nothing AI-generated is available at that point. **COST-005:** the fallback message names the actual cause (`_describe_groq_unavailable_reason()` — no/bad key, rate-limited, network problem, or outage) instead of always guessing "you may be offline," and always states the search itself never left the device. |
| `backend/routes/capture.py` | POST /capture (extension only — Rust writes direct). Checks pause state, excluded app names, and excluded domains (all cached 30s). Domain extracted via `urlparse().netloc` before every browser event. URL dedup: `_find_recent_url_event()` queries `events(url, timestamp)` with `_URL_DEDUP_WINDOW_MS = 10_000`; extension beats native_browser (drop native); if native in DB and extension arrives, DELETE native INSERT extension. `page_text` for `page_content` events and `raw_content` for `search_query` events are passed through `redact_sensitive_content()` before INSERT. GET /events for timeline. |
| `backend/routes/privacy.py` | Excluded apps CRUD, pause/resume, capture status, full data wipe (SQLite + Qdrant). Wipe uses SQLite secure-delete, WAL truncation, and `VACUUM`; it deletes FTS rows, sessions, memory objects, and extension pairings before clearing Qdrant vectors. `GET/POST/DELETE /privacy/excluded-domains` — domain exclusion CRUD. `GET/POST /privacy/browser-capture` — native browser URL capture toggle; returns `{native_enabled, browsers: [...]}`. `GET/POST /privacy/screen-content` — on-screen content capture toggle; `SetScreenContentRequest(enabled: bool)` UPDATEs `screen_content_settings`. `GET/POST /privacy/file-watching` — enable/disable file activity capture. `POST/DELETE /privacy/watched-folders` — add/remove watched folder paths (JSON body). |
| `backend/routes/feedback.py` | POST /feedback — stores rating + comment in SQLite. |
| `backend/routes/timeline.py` | `GET /timeline/day?date=YYYY-MM-DD` — returns sessions + stats (total_active_minutes, total_duration_minutes, project_count) for one calendar day. `GET /timeline/dates` — returns all unique YYYY-MM-DD dates with sessions, newest-first. Both convert local date strings to UTC ms via `datetime().astimezone()`. Registered with `prefix="/timeline"` in main.py. |
| `backend/routes/projects.py` | `GET /projects` — aggregates sessions into project cards. Groups by `LOWER(TRIM(project_name))` so case/spacing variants ("Orbit", "orbit") collapse into one card; display name comes from the most recent session. Returns per-project `last_active_ms`, `activity`, `ai_summary`, `weekly_active_minutes`, `session_count`, plus `today_active_minutes` for the header badge. Limit 20 projects. |
| `app/src/hooks/useTimeline.ts` | Fetches `GET /timeline/day` on mount and on `setSelectedDate()`. Fetches `GET /timeline/dates` once on mount. Caches per-date results in an in-memory `Map<string, TimelineDayData>` ref — navigating back to a date is instant. `setSelectedDate()` updates state AND triggers a fetch in one call (not via useEffect). |
| `app/src/hooks/useProjects.ts` | Fetches `GET /projects` on mount. Module-level `moduleCache` (not a ref) holds data + `fetchedAt` timestamp — shared across re-renders, skipped if younger than 5 minutes. Force-refreshes on `document.visibilitychange`. Fails silently — returns empty `projects` array on error. |
| `app/src/components/Timeline/TimelineView.tsx` | Full Timeline tab UI. Three sub-components: `TimelineStrip` (proportional horizontal bar — session blocks sized by `widthPercent`, positioned by `leftPercent`, colored by `getProjectColor`; 2-hour tick marks in local time; hover tooltip); `SessionCard` (color dot, time range, activity summary, topics, blockers, resources, "Where you left off" label for `next_step`, "Ask Orbit" button); `TimelineView` (date pill selector for last 10 days, stat cards, strip, threaded session list). Uses `onAskOrbit` prop which calls `setPendingQuery` + `setActivePanel("chat")` in App.tsx. |
| `app/src/components/ProjectCards.tsx` | Project cards dashboard. Shown inside `RecallSearch` when `conversationHistory` is empty. Receives `isVisible` prop — when `false`, sets `opacity: 0` and `pointer-events: none` (0.2 s ease-out CSS transition). Card body click calls `onPrefill(query)` (sets input value + focus, does NOT submit). `→` arrow calls `onSubmit(query)` (submits immediately). Shows loading shimmer while `isLoading`. Returns `null` if `projects.length === 0` after load (clean empty state on first install). |
| `backend/services/groq_service.py` | Singleton `httpx.AsyncClient` (180 s timeout — classification of a large backlog can legitimately need minutes; recall uses a separate 30 s timeout, `_GROQ_RECALL_TIMEOUT_SECONDS`, since it's a live user-facing request). Three provider-facing functions: `generate_session_summary_groq()` (session fusion, `reasoning_effort="low"` — critical, see Critical Architecture Facts), `classify_events_batch_groq()` (event classification, content-aware group splitting via `_split_events_by_estimated_size()`, hard-capped at 30 events/group, sanity-checks response size against a 1.5× threshold to reject repetition-loop garbage), `stream_recall_response_groq()` (user-facing streaming, OpenAI-compatible SSE parser). All three call `database.get_groq_api_key()`: if a personal key exists, the request goes straight to `GROQ_DIRECT_API_URL` (`https://api.groq.com/openai/v1/chat/completions`) with `Authorization: Bearer <key>`; otherwise the call fails immediately (returns `None` or raises, depending on the function) with no request attempted at all — no maintainer infrastructure exists to fall back to. `test_groq_api_key()` validates a candidate key with a free `GET /models` call directly against `api.groq.com` — never persisted, used for exactly one request. `_call_groq_chat()` is the shared low-level POST helper, and never retries within a single call (COST-005 — bounded by construction, not a loop): 429 **or** 401/403 sets a per-model cooldown (`_groq_rate_limited_until` dict — 429 honours `Retry-After`/defaults to 90s, 401/403 uses `_GROQ_AUTH_FAILURE_COOLDOWN_SECONDS` = 300s) so the rest of a scheduler cycle's batches skip straight past a known-bad key/rate limit instead of each rediscovering it; 413 logs and returns None (payload-size problem, not time-based — no cooldown), empty completions are logged with `finish_reason` for diagnosis. No branch ever logs headers, request bodies, or response bodies — only `log_provider_diagnostic()`'s coarse provider/model/status/duration/error-kind fields. |
| `backend/routes/settings.py` | The BYOK settings surface for both `groq-key` and `voyage-key`: `GET/POST/DELETE /settings/<provider>-key` + `POST .../test` + `POST .../enabled`, wired to PrivacyPanel's two `ApiKeySection` instances via `useApiKeySettings.ts`. Shared CRUD logic (`_get_key_status`/`_save_key`/`_delete_key`) is provider-agnostic; each provider supplies its own key-format validator (`_is_plausible_groq_key`/`_is_plausible_voyage_key`) and test function (`groq_service.test_groq_api_key`/`voyage_service.test_voyage_api_key`). `GET` returns only `{configured, enabled}` — the raw key is never returned to the webview after saving. `POST` validates the format, stores to Keychain, and force-enables. `POST .../test` validates a candidate key directly against the provider without ever storing it. `DELETE` removes the Keychain entry. `POST .../enabled` pauses/resumes use of the stored key without discarding it. No admin kill switch exists — there was never anything to proxy from the maintainer's side. |
| `backend/services/voyage_service.py` | Singleton `httpx.AsyncClient`. POST directly to `VOYAGE_DIRECT_API_URL` (`https://api.voyageai.com/v1/embeddings`) with `Authorization: Bearer <key>` — no maintainer relay of any kind. Body: `{"input": [text], "model": "voyage-3-lite", "input_type": "document"}`. Returns 512-dim float list. **BYOK-only**: `database.get_voyage_api_key()` is read immediately before every call; with no personal key, raises `VoyageUnavailableError` immediately with no request sent — callers (`qdrant_service.py`, `routes/recall.py`) already treat any embedding failure as non-fatal. **COST-005:** a 401/403 or 429 also raises `VoyageUnavailableError` immediately (no retry) and starts a module-level cooldown (`_voyage_rate_limited_until` — 300s for auth failures, `Retry-After`/90s default for rate limits) so the rest of a backlog batch doesn't independently rediscover the same failure; any other non-2xx or transport error retries up to 3 times total (1s, 2s backoff) before raising — bounded, never indefinite. `test_voyage_api_key()` validates a candidate key with one minimal real embed call — Voyage has no free introspection endpoint the way Groq's `/models` does. |
| `backend/services/time_parser.py` | Standard-library time reference parser (no third-party deps). `extract_time_range_from_query(query, now_ms)` checks 11 patterns most-specific-first (e.g. "yesterday morning" before "yesterday") and returns `{"start_ms": int, "end_ms": int, "label": str}` or `None`. Used by `recall.py` to filter both FTS5 and Qdrant results to a concrete time window. |
| `backend/services/redaction_service.py` | Inline sensitive-content redaction for browser-captured text. Ports Rust clipboard patterns as `re.sub()` — replaces only matched substrings (preserves article context). All 7 pattern steps run on every call. JWT uses `eyJ` anchor to avoid false positives in long text. API key pattern uses negative lookbehind + 8-char minimum body. Called by `capture.py` for `page_text` and search `raw_content` before DB write. |
| `backend/services/qdrant_service.py` | `QdrantClient(path=QDRANT_STORAGE_PATH)` singleton (default `~/.orbit/qdrant_storage`). Collection `orbit_sessions`, 512 dims, cosine. Raw vector upsert (no fastembed). Storage is repaired to owner-only permissions the first time it's created. **Lazy end to end (COST-003, ADR-006):** `add_session_embedding()`/`search_sessions_semantic()` call `generate_text_embedding()` *before* touching the client — with no personal Voyage key that raises `VoyageUnavailableError` immediately and Qdrant is never opened; only on a successful embedding do they call `initialize_qdrant_collection()` then `_get_client()`. |
| `extension/src/background.ts` | MV3 service worker. All state in `chrome.storage.session` (never global vars). Emits bare `url` events on tab navigation (deduped by `lastSentUrl`). Handles three content-script message types: `page_content`, `search_query`, `link_click` — relays them to POST /capture. `onMessage` callback is synchronous (fire-and-forget) to keep the MV3 message channel intact. Fails silently when backend unreachable. |
| `extension/src/content.ts` | Runs in every page context. 5-second visibility filter — pages the user bounced off are discarded. On threshold: detects search queries first (Google, YouTube, Bing, DuckDuckGo); otherwise runs `@mozilla/readability` on a DOM clone to extract article body (≤2 000 chars), author, site_name, excerpt. Sends `page_content` or `search_query` to the background worker on tab departure (`visibilitychange` + `pagehide`). Left-click listener captures `link_click` events with 500 ms debounce. |
| `extension/package.json` | Runtime dep: `@mozilla/readability@^0.6.0` — ships own `index.d.ts`; do **NOT** install `@types/mozilla-readability` (conflicts). DevDeps: `@crxjs/vite-plugin`, `@types/chrome`, `typescript`, `vite`. |
| `landing/next.config.ts` | `output: "export"` (SITE-001) — the whole site builds to static HTML/CSS/JS in `out/`, no Node.js server needed at runtime. |
| `landing/src/app/page.tsx` | Landing page — Server Component. Hero with a "View on GitHub" CTA + `git clone` snippet + "what you'll need to build" disclosure, "How it works" 3-card section, privacy callout strip. No downloads, no waitlist form — this is a self-build project (see "Distribution" further down). |
| `landing/src/app/layout.tsx` | Root layout. Sets `metadataBase`, explicit `openGraph` and `twitter` metadata. Canonical URL resolves via `NEXT_PUBLIC_APP_URL` env var. |
| `landing/src/app/opengraph-image.tsx` | `ImageResponse` — auto-wired by Next.js to og:image and twitter:image metadata. 1200×630 px dark PNG with orbit ring decoration, headline, "Available now for macOS" badge. `export const dynamic = "force-static"`, no `runtime = "edge"` — required for `output: "export"` to prerender it at build time. |
| `landing/src/app/privacy/page.tsx` | Privacy policy — Server Component. Covers all capture types (Phase 2.5–2.9), what gets sent to cloud AI (always BYOK-direct to the provider, no maintainer relay), all user controls, and states plainly that Orbit sends no telemetry of any kind (OBS-001). |
| `landing/src/components/background-orbit.tsx` | Animated background decoration. |
| `landing/src/components/header.tsx` | Site header / navigation. |
| `landing/src/components/footer.tsx` | Footer with links to privacy, social, GitHub. |
| `landing/src/lib/utils.ts` | Shared utilities — `cn()` for Tailwind class merging, etc. |

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
only content that has already passed through redaction. This applies equally
to whichever provider is being called (Groq — Claude/Gemini no longer exist,
COST-002).

- **Classification** (`openai/gpt-oss-20b`) receives: `id, type, app_name,
  url, raw_content` (raw_content is already redacted — `[REDACTED:type]` for
  any secret). Needs the content to classify accurately ("is this work or
  personal?").
- **Session summaries** (`openai/gpt-oss-120b`) receives: classified events
  with `app_name`, `url`, `window title`, and `raw_content` — all already
  redacted. Needs this to write a summary that actually describes what the
  user did.
- **Recall** (`openai/gpt-oss-120b`) receives: session summaries +
  matching events (window titles, URLs, redacted clipboard content).

**What makes this safe:**
- Secrets never reach the database — redaction happens in `clipboard.rs` before
  any write. By the time AI sees content, `sk-abc123` is already `[REDACTED:api_key]`.
- Password manager and banking app events never captured (exclude list).
- `category = 'personal'` events excluded from work recall context.
- All AI calls go directly from this Mac to the provider's own API
  (`api.groq.com` / `api.voyageai.com`) over encrypted HTTPS, using the
  user's own key — no maintainer-run server sits in between.
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
- No maintainer-owned AI provider keys exist anywhere in this system —
  there is no maintainer-run infrastructure of any kind. A user's own
  Groq/Voyage key (optional, BYOK) lives only in their local macOS
  Keychain, never in SQLite or the app binary.
- One-click full memory wipe (PrivacyPanel).
- User can view/delete any stored item (MemoryViewer).

---

## No Cloudflare Worker (and never re-add one without a real reason)

Orbit used to route AI calls through a stateless Cloudflare Worker BYOK
relay (`worker/`). That Worker, and the whole `worker/` workspace, has been
**removed from this repository entirely** — not just its secrets (that was
COST-002), the relay itself. Both Groq and Voyage AI calls go directly from
the backend to the provider's own API with the user's key; there was
nothing left for the Worker to do once both providers were BYOK-direct.

If you're tempted to re-add a relay of any kind (for Claude, Gemini, a new
provider, or "just to hide the API shape"): don't, unless there's a
concrete reason a direct call can't work (e.g. a provider that requires
server-side request signing an end user can't safely perform in a
distributed desktop app). A relay is exactly the kind of maintainer-run
infrastructure this project is deliberately built to have none of — it
reintroduces an operating cost and a thing that can go down, for a project
with no maintainer committed to running one.

---

## Environment Variables

**Rule:** No AI provider key lives in an env file anywhere, maintainer- or
user-owned. There is no maintainer infrastructure of any kind left to hold
one. A user's own Groq/Voyage key (BYOK) lives only in the local macOS
Keychain, never in `backend/.env` or any other config file.

### backend/.env (gitignored)
```
ORBIT_DB_PATH=~/.orbit/orbit.db
QDRANT_STORAGE_PATH=~/.orbit/qdrant_storage
APP_ENVIRONMENT=beta
APP_VERSION=0.1.0
PORT=8000
```

### app/.env (gitignored — VITE_* vars bundled into binary)
```
VITE_APP_ENVIRONMENT=beta
VITE_APP_VERSION=0.1.0
```

No GitHub Actions secrets exist for this project — there's no CI-driven
release/signing pipeline (see "Distribution" below). Anyone building the
app themselves uses their own Apple Developer account if they want to
sign/notarize their own build; nothing here does that for them.

No PostHog/Sentry secrets exist anywhere either — neither ships in the app
at all (OBS-001).

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

# Landing page
cd landing && pnpm install && pnpm dev

# Production .dmg
cd app && pnpm tauri build
```

**After bumping the app version** (`app/src-tauri/tauri.conf.json`) or the
extension version (`extension/manifest.json`), run the version-consistency
check (`DOC-006`) — it fails loudly on any drift instead of letting
`app/package.json`/`Cargo.toml`/`backend/pyproject.toml`/`extension/package.json`
silently fall out of sync with their source of truth again:
```bash
sh scripts/check-versions.sh
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

## Distribution

**There is no built-release distribution of any kind — clone it, build it
yourself.** This is a deliberate choice, not a gap: Orbit is a fully open,
BYOK self-hosted tool with no maintainer committing to run any ongoing
infrastructure — no signed `.dmg` releases, no `orbit-releases` companion
repo, no in-app auto-updater, no Chrome Web Store listing. Historically
(before this decision) the project did publish signed builds via a
separate public `orbit-releases` repo and a Chrome Web Store listing with
their own GitHub Actions workflows (`release.yml`, `publish-extension.yml`)
and an in-app `tauri-plugin-updater` — all of that has been removed
entirely, not paused. If you're picking this project back up and want to
reintroduce packaged releases, that prior setup is still visible in git
history, but treat it as a reference for the mechanics, not something to
blindly restore — re-review the signing/token/environment setup from
scratch rather than assuming old secrets or a companion repo still exist.

**To run Orbit yourself:** see the README's "Building from source" section
— `pnpm tauri build` produces a local, unsigned `.app`/`.dmg` you run on
your own Mac. Gatekeeper's "unidentified developer" warning only applies to
files downloaded from the internet (the quarantine flag comes from the
browser/curl that fetched them); a `.app` you build locally on your own
machine doesn't carry that flag, so there's no Gatekeeper friction for a
self-built copy the way there was for a downloaded one. Code-signing /
notarization is only relevant if you intend to distribute a build you made
to *other people* — that remains entirely up to whoever does that, using
their own Apple Developer account; nothing in this repo does it for them.

**Chrome extension:** same principle — build it yourself
(`cd extension && pnpm install && pnpm build`, then "Load Unpacked" in
`chrome://extensions`). No Web Store listing exists or is planned by the
maintainer.

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
- Call Claude or Gemini at all — both were removed entirely, service files
  deleted. Call Groq/Voyage directly, always with the user's own personal
  key; with no personal key, the call must fail immediately with no network
  request attempted — there is no relay or fallback of any kind to attempt
  instead.
- Create new `httpx.AsyncClient`, `QdrantClient`, or `reqwest::Client` per request.
- Put any AI provider key — maintainer- or user-owned, for any provider — in
  any `.env` file. There are no maintainer-owned keys anywhere in this
  system, and no maintainer-run infrastructure of any kind to put one in;
  user keys go in macOS Keychain only.
- Give `max_tokens` a generous, "just to be safe" budget on any Groq call. This model family has an observed repetition-loop failure mode on long single-shot outputs — a generous budget doesn't prevent it, it just lets a bad roll burn far more tokens (and cost) before hitting the ceiling. Size `max_tokens` tightly to what a legitimate response needs.
- Re-add a Cloudflare Worker, any other relay, or a maintainer-funded key
  for any provider (including Claude or Gemini) without a real plan for who
  operates and pays for it — this project deliberately has zero
  maintainer-run infrastructure. If you're building for yourself and want a
  relay, that's your own infrastructure to run, not something to add here
  as if a maintainer will operate it.
- Assume any auto-update mechanism or release download links exist — they
  don't. There is no `orbit-releases` companion repo, no in-app updater, no
  Chrome Web Store listing. See "Distribution."
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
- Add any remote telemetry (crash reporting, analytics) back — removed
  entirely and deliberately (OBS-001). If this ever changes, it needs a
  genuine opt-in/revoke design, not just re-adding the old SDKs.
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
4. New AI provider → AI Models tables
5. Architecture changes → data flow diagrams + Critical Architecture Facts
6. New env vars → environment variables section
7. New DO NOT rules → DO NOT section

Do NOT update for bug fixes or minor changes with no architectural impact.
