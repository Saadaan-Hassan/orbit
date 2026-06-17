# Phase 2.9 — Accessibility Content Capture + Signal Fusion
**Goal:** Read the actual on-screen text of the focused app (IDE code, chat
messages, document text, ticket details) via the Accessibility API, and fuse all
capture signals so Claude can reconstruct WHAT the user was doing inside an app —
not just which app.

**Why:** This is the missing "content" layer for native apps. You already have
the Accessibility permission. It's structured text (fast, cheap, no vision model).

**Privacy is paramount here** — this reads on-screen text from apps. Secure fields
are skipped, secrets redacted, exclude list respected, and a global toggle exists.

---

## What This Adds

| Capture | Reveals |
|---|---|
| Focused-element text via AXUIElement | The actual content on screen in the focused app |
| Window/document title via AX | The document/file/ticket being worked on |
| Signal fusion in session generation | Claude reconstructs the real activity from all signals combined |

---

## Hard Privacy Rules (enforce these in code)

1. **Never read `AXSecureTextField`** — password fields. Skip entirely.
2. **Only read the FOCUSED app**, not every background window (less invasive,
   less noise, captures attention not surveillance).
3. **Redact secrets** in captured text before storage (reuse redaction_service).
4. **Respect the app exclude list** — excluded apps never read.
5. **Cap captured text** at ~1500 chars per snapshot (we need the gist, not
   everything).
6. **Global toggle** — "Read on-screen content" can be turned fully off.
7. **Dedup** — only capture when the focused content meaningfully changes.

---

## Step 1 — Backend: New Event Type + Schema

```
Read AGENTS.md fully first.

We are adding an accessibility content capture event type: screen_content.

Part A — backend/database.py
The events.type column will now also accept: screen_content.
Add one nullable column to events (base CREATE + lazy ALTER migration):
  screen_text TEXT    -- the captured on-screen text from the focused app

Update the FTS5 virtual table and triggers to ALSO index screen_text
(so on-screen content is keyword-searchable). FTS5 now mirrors:
  raw_content, app_name, url, page_text, screen_text

Part B — backend/models/event.py
Add to CaptureEvent (optional):
  screen_text: str | None = None

Part C — backend/routes/capture.py
Accept and store screen_text. Run it through redact_sensitive_content()
(from redaction_service.py) before storing — same as page_content.
Respect pause state + excluded apps.

Follow AGENTS.md conventions. Show me the schema, model, and capture changes.
```

**✅ Verify:**
```bash
rm ~/.orbit/orbit.db
cd backend && uv run uvicorn main:app --port 47821 &
sqlite3 ~/.orbit/orbit.db "PRAGMA table_info(events);"
# Should show screen_text column
```

---

## Step 2 — Rust: Accessibility Content Reader

```
Read AGENTS.md fully first.

We are adding Accessibility API content capture — reading the focused app's
on-screen text via AXUIElement. This is the macOS Accessibility framework
(same permission Orbit already uses for window titles).

Add the accessibility-sys / objc2 bindings needed to app/src-tauri/Cargo.toml.
Use the accessibility crate ecosystem:
  accessibility = "0.1"
  accessibility-sys = "0.1"
  core-foundation = "0.9"
(Or objc2 + objc2-app-kit if the accessibility crate is insufficient — use
whatever reliably calls AXUIElementCreateSystemWide and reads attributes.)

Create app/src-tauri/src/capture/screen_content.rs

Public async function start_screen_content_monitor(
    sqlx_connection_pool: sqlx::SqlitePool
):

Poll every 8 seconds (content changes slower than we need sub-second precision;
8s keeps it light). On each poll:

1. Check the global "read on-screen content" toggle in SQLite (refresh every
   30s). If disabled, skip.

2. Get the system-wide accessibility element:
   AXUIElementCreateSystemWide()

3. Get the focused application:
   AXUIElementCopyAttributeValue(systemWide, kAXFocusedApplicationAttribute)

4. Get the app name. Check it against the excluded apps list (cached, refresh
   30s). If excluded, skip this poll.

5. Get the focused UI element:
   AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute)

6. CRITICAL SECURITY: Read the element's role/subrole. If it is a
   secure/password field (kAXRoleAttribute is "AXTextField" with subrole
   "AXSecureTextField", or role is "AXSecureTextField"), SKIP entirely —
   never read password fields.

7. Read meaningful text from the focused element and its immediate context:
   - The focused element's kAXValueAttribute (text content)
   - If the focused element is small (e.g. a single input), also read the
     focused WINDOW's visible static text by traversing children shallowly
     (max depth ~3, max ~30 elements) and collecting kAXValueAttribute and
     kAXTitleAttribute from AXStaticText / AXTextArea / AXTextField roles.
   - Concatenate into a single readable string.

8. Truncate the combined text to 1500 characters.

9. Dedup: keep last_captured_screen_text in memory. Only write if the new text
   differs meaningfully from the last (e.g. not a substring/near-identical).
   Avoid writing the same screen repeatedly while the user reads.

10. If text is non-empty after all filters, write an event:
    type='screen_content', app_name=<focused app>, screen_text=<text>,
    raw_content=<window/doc title for context>, source='rust',
    timestamp=now_ms

11. Handle the case where Accessibility permission is not granted (AXError
    kAXErrorAPIDisabled / cannot read) — set a flag, log once, keep polling
    silently. Never panic.

Performance: AXUIElement calls can block. Run the polling loop on a dedicated
thread (std::thread or tokio blocking task) so it never stalls the async runtime.

Part B — app/src-tauri/src/capture/mod.rs
Add: pub mod screen_content;

Part C — app/src-tauri/src/lib.rs
Spawn start_screen_content_monitor alongside the other capture monitors.

Follow AGENTS.md conventions. Fully descriptive names. Add clear comments on
the security-critical parts (secure field skipping, depth limits).
Show me screen_content.rs, mod.rs, and the lib.rs spawn.
```

**✅ Verify:**
```bash
cd app && pnpm tauri dev
# Focus VS Code with some code open, wait 10s, then:
sqlite3 ~/.orbit/orbit.db "SELECT app_name, substr(screen_text,1,120) FROM events WHERE type='screen_content' ORDER BY timestamp DESC LIMIT 5;"
# Should show actual on-screen text from the focused app
# CRITICAL TEST: focus a password field (e.g. a login form), wait 10s
# → NOTHING should be captured from the password field
```

---

## Step 3 — Privacy Panel: On-Screen Content Toggle

```
Read AGENTS.md fully first.

Users must control on-screen content reading — it's the most sensitive capture.

Part A — backend/routes/privacy.py
Add:
  GET  /privacy/screen-content   → {enabled: bool}
  POST /privacy/screen-content   → {enabled: bool}
Store in settings (reuse capture_state or a settings table). Default enabled=true,
but this should be PROMINENTLY surfaced in onboarding (see Part C).

Part B — Rust screen_content.rs
Read the enabled flag from SQLite on startup, refresh every 30s. If disabled,
stop reading content entirely.

Part C — Frontend PrivacyPanel.tsx
Add a clearly-explained "On-Screen Content" section AT THE TOP of privacy
(it's the most powerful capture, so it gets the most prominent control):
  - Toggle: "Let Orbit read on-screen text"
  - Plain-language explanation: "This lets Orbit understand what you're actually
    working on — the document you're writing, the code you're editing, the
    conversation you're having — not just which app is open. Orbit never reads
    password fields, and you can exclude any app."
  - Show what's excluded (links to app exclude list)
Wire through usePrivacySettings.ts.

Follow AGENTS.md conventions. Show me the endpoints, the Rust refresh, and the
PrivacyPanel section.
```

---

## Step 4 — The Fusion: Combine All Signals in Session Generation

```
Read AGENTS.md fully first.

This is the most important step. We now capture many signals per moment:
window, app lifecycle, files, clipboard, browser URLs, page content, screen
content, idle, system state. The magic is FUSING them so Claude reconstructs
WHAT the user was doing — not listing raw events.

Part A — backend/scheduler.py
When building the events payload for the Claude session summary, group the
events into a richer, fused structure rather than a flat list. For the time
window, build a payload that includes, per event, the most informative fields:
  - type, app_name, timestamp
  - raw_content (titles), url, page_text (truncated ~300 chars),
    screen_text (truncated ~400 chars), file_path, link_target, search query,
    category, is_user_active
Order chronologically. Include file_activity and screen_content prominently —
they're the strongest "what" signals.

Part B — Use the new FUSION session prompt (see the fusion prompt artifact).
Replace the current session summary system+user prompt with the fusion prompt.
It instructs Claude to triangulate the activity from overlapping signals and
produce a continuation-focused summary.

Part C — Add fields to the session JSON + storage
The fusion prompt asks Claude to return additional fields:
  "activity": "specific description of WHAT they were doing"
  "evidence": "which signals support this (brief)"
  "next_step": "the likely next action to continue"
  "blockers": "anything they seemed stuck on, or null"
Store activity, next_step, blockers as columns on sessions (add them, base +
lazy ALTER). Keep storing project_name, goal, summary, last_action, key_resources.

Follow AGENTS.md conventions. Show me the fused payload builder, the prompt
swap, the new session columns, and the storage changes.
```

---

## Step 5 — Use Fused Data in Recall

```
Read AGENTS.md fully first.

Surface the richer fused session data in recall so answers describe what the
user was actually doing and how to continue.

backend/routes/recall.py
- Include screen_content and file_activity events in the FTS5/context results
  (screen_text is now indexed, so keyword recall already improves).
- In the context block, format sessions to include the new fields:
    [time] Project: X
      What you were doing: <activity>
      Goal: <goal>
      Next step: <next_step>
      Left off: <last_action>
      Blocked on: <blockers if any>
      Resources: <key_resources>
- For screen_content events in keyword results, format as:
    [time] In <app>: "<screen_text snippet>"

This gives Claude the reconstructed activity + continuation point, which is the
whole point — "help you continue."

Follow AGENTS.md conventions. Show me the recall context changes.
```

**✅ Verify (the real test):**
```bash
# Do real focused work for 30+ min: code in an IDE, chat in Slack, read docs.
cd backend && uv run python -c "from scheduler import generate_sessions_from_recent_events; import asyncio; asyncio.run(generate_sessions_from_recent_events())"
sqlite3 ~/.orbit/orbit.db "SELECT activity, next_step, blockers FROM sessions ORDER BY start_time DESC LIMIT 3;"
# activity should describe WHAT you did inside apps, not just app names

curl -X POST http://localhost:47821/recall -H "Content-Type: application/json" \
  -d '{"query":"what was I actually working on?"}' --no-buffer
# Should describe the actual content/activity, not just "you used VS Code"
```

---

## Step 6 — Update AGENTS.md

```
Read all files changed in Phase 2.9.

Update AGENTS.md:
- New event type: screen_content (Accessibility API focused-element text)
- New columns: events.screen_text; sessions.activity, next_step, blockers
- FTS5 now indexes screen_text
- New Rust module: capture/screen_content.rs (AXUIElement reading)
- Security: never read AXSecureTextField; focused-app only; depth/char caps
- New privacy toggle: on-screen content reading (prominent in PrivacyPanel)
- The fusion session prompt (reference it)
- Update data flow diagrams + Critical Architecture Facts
- Add to DO NOT: never read password/secure fields via Accessibility
- Mark Phase 2.9 complete

Show me what you changed.
```

---

## Phase 2.9 Done Checklist

- [ ] Screen content captured from focused text apps (IDE, chat, docs)
- [ ] Password/secure fields NEVER read (test explicitly)
- [ ] Excluded apps not read
- [ ] Screen text redacted before storage
- [ ] On-screen content toggle works (off = nothing read)
- [ ] Content deduped (not re-capturing same screen repeatedly)
- [ ] Sessions now have activity / next_step / blockers
- [ ] Fusion prompt produces specific "what you were doing" descriptions
- [ ] Recall describes actual in-app activity, not just app names
- [ ] "What was I actually working on?" gives a real, specific answer