# Phase 2.6 — System Signals
**Goal:** Capture file activity, system state (lock/sleep), app lifecycle, and
idle/active level — all via native macOS APIs. These are lightweight,
privacy-safe, and fix the biggest remaining recall gaps without any
surveillance-grade capability.

**Explicitly NOT in this phase:** keystroke content, audio, screen recording,
network monitoring, OS log parsing. Those are never added to Orbit.

---

## What This Adds

| Signal | Event type | Fixes |
|---|---|---|
| File open / edit / save | `file_activity` | Precise "what was I working on?" |
| Lock / unlock / sleep / wake | `system_state` | Session boundary bugs, "when did I step away?" |
| App launch / quit | `app_lifecycle` | Task transition detection |
| Idle / active level | metadata flag on events | Honest session durations |

All captured natively in Rust via macOS NSWorkspace + FSEvents. No new permissions
beyond what Orbit already has (Accessibility). No content beyond file paths and
timestamps.

---

## Privacy Boundaries (read first)

- **File activity:** only watch the user's work folders (Documents, Desktop,
  Downloads, and detected project dirs). NEVER watch system files, hidden files,
  app caches, or anything outside user space. Respect excluded apps/domains.
- **Idle detection:** captures only "active" vs "idle" — an idle *timer*.
  NEVER captures keystrokes or what was typed. This distinction is absolute.
- **System state:** only timestamps of lock/unlock/sleep/wake. No content.
- **App lifecycle:** only app name + launch/quit + timestamp.

---

## Step 1 — Backend: New Event Types + Schema

```
Read AGENTS.md fully first.

We are adding four system-signal event types: file_activity, system_state,
app_lifecycle, and an is_active_session flag on events.

Part A — backend/database.py
The events table type column currently accepts: clipboard, window, url,
page_content, link_click, search_query. It will now also accept:
  file_activity, system_state, app_lifecycle.

Add two nullable columns to the events table (base CREATE + lazy ALTER migration):
  file_path     TEXT,         -- for file_activity events
  is_user_active INTEGER      -- 1 = user was active, 0 = idle, NULL = unknown

Reuse the existing metadata TEXT (JSON) column for the extra fields:
  - file_activity: metadata = {action: "created"|"modified"|"deleted", app_name}
  - system_state:  metadata = {state: "lock"|"unlock"|"sleep"|"wake"}
  - app_lifecycle: metadata = {action: "launched"|"quit"}

Part B — backend/models/event.py
Add to CaptureEvent (all optional):
  file_path: str | None = None
  is_user_active: bool | None = None

Part C — backend/routes/capture.py
Accept and store the new fields. The new event types come from Rust (source='rust'),
not the extension. Same pause-state check applies. File activity from excluded
apps is dropped.

Follow AGENTS.md conventions. Show me the schema, model, and capture changes.
```

**✅ Verify:**
```bash
rm ~/.orbit/orbit.db
cd backend && uv run uvicorn main:app --port 47821 &
sqlite3 ~/.orbit/orbit.db "PRAGMA table_info(events);"
# Should show file_path, is_user_active columns
```

---

## Step 2 — Rust: File Activity Capture (FSEvents)

```
Read AGENTS.md fully first.

We are adding file activity capture via macOS FSEvents using the `notify` crate.

Part A — Add the notify crate to app/src-tauri/Cargo.toml:
  notify = "6"
  notify-debouncer-full = "0.3"   -- debounces rapid file events

Part B — Create app/src-tauri/src/capture/file_activity.rs

Public async function start_file_activity_monitor(sqlx_connection_pool, db_path):

1. Watch these user directories (resolve from the home directory at runtime):
   - ~/Documents
   - ~/Desktop
   - ~/Downloads
   Use a recursive watcher with debouncing (notify-debouncer-full, ~2s debounce
   so saving a file rapidly doesn't create 50 events).

2. For each debounced file event, determine the action:
   created / modified / removed (map notify event kinds to these).

3. FILTER OUT (never capture):
   - Hidden files and directories (any path component starting with ".")
   - Files inside node_modules, .git, target, __pycache__, .next, dist, build,
     Library, .cache, venv, .venv
   - System/temp files: .DS_Store, *.tmp, *.swp, *.lock, *.log
   - Files larger than a reasonable threshold are fine (we store the path, not
     the content) — no size filter needed since we never read file contents
   - Any file whose path is inside an Orbit-excluded app's data — skip if hard

4. For each captured file event, write an event to SQLite:
   type='file_activity', file_path=<path>, app_name=NULL (we don't always know
   which app), raw_content=<filename only, for FTS5 search>,
   metadata=JSON {action}, source='rust'

   IMPORTANT: store the file PATH, never read or store the file CONTENTS.

5. Never panic. Log errors with eprintln!, keep watching.

Part C — app/src-tauri/src/capture/mod.rs
Add: pub mod file_activity;

Part D — app/src-tauri/src/lib.rs (or main.rs)
Spawn start_file_activity_monitor as a tokio task alongside clipboard and window
monitors, passing the shared SQLite pool.

Follow AGENTS.md conventions. Fully descriptive names. Show me file_activity.rs,
the mod.rs change, and the spawn in lib.rs.
```

**✅ Verify:**
```bash
cd app && pnpm tauri dev
# Create/edit a file in ~/Documents
echo "test" > ~/Documents/orbit_test.txt
sqlite3 ~/.orbit/orbit.db "SELECT type, file_path, metadata FROM events WHERE type='file_activity' ORDER BY timestamp DESC LIMIT 5;"
# Should show the file event. Then verify filtering:
mkdir -p ~/Documents/node_modules && echo "x" > ~/Documents/node_modules/test.js
# This should NOT appear in events (filtered)
```

---

## Step 3 — Rust: System State (Lock / Unlock / Sleep / Wake)

```
Read AGENTS.md fully first.

We are capturing system lock/unlock/sleep/wake via macOS NSWorkspace
notifications. These are natural session boundaries.

Create app/src-tauri/src/capture/system_state.rs

Public function start_system_state_monitor(sqlx_connection_pool):

On macOS, subscribe to NSWorkspace and NSDistributedNotificationCenter
notifications:
  - "com.apple.screenIsLocked"   → state: "lock"
  - "com.apple.screenIsUnlocked" → state: "unlock"
  - NSWorkspaceWillSleepNotification   → state: "sleep"
  - NSWorkspaceDidWakeNotification     → state: "wake"

Use the objc2 / cocoa crate bindings already available, or the `objc` crate.
If direct NSWorkspace subscription in Rust is complex, an acceptable simpler
approach: poll the lock state via a lightweight check, OR use a small bridge.
Prefer the notification approach if feasible; fall back to polling lock state
every 5 seconds if notifications are hard to wire.

For each state change, write an event:
  type='system_state', metadata=JSON {state}, source='rust',
  raw_content=<the state string, for readability>

Never panic. Log and continue.

Add to mod.rs: pub mod system_state;
Spawn start_system_state_monitor as a tokio task in lib.rs.

Follow AGENTS.md conventions. Show me system_state.rs, mod.rs, lib.rs changes.
```

**✅ Verify:**
```bash
# Lock your screen (Cmd+Ctrl+Q), unlock it, then:
sqlite3 ~/.orbit/orbit.db "SELECT type, raw_content, datetime(timestamp/1000,'unixepoch','localtime') FROM events WHERE type='system_state' ORDER BY timestamp DESC LIMIT 5;"
# Should show lock then unlock events
```

---

## Step 4 — Rust: App Lifecycle + Idle Detection

```
Read AGENTS.md fully first.

Two additions to the existing window monitor (or a new module).

Part A — App launch/quit via NSWorkspace
In app/src-tauri/src/capture/app_lifecycle.rs:
Subscribe to NSWorkspace notifications:
  - NSWorkspaceDidLaunchApplicationNotification → action: "launched"
  - NSWorkspaceDidTerminateApplicationNotification → action: "quit"
Extract the app name from the notification's userInfo.
Write event: type='app_lifecycle', app_name=<name>, metadata=JSON {action},
source='rust'.
(If notification subscription is complex, fall back to diffing the running
app list every 10 seconds: compare current running apps to the previous set,
emit launched/quit for the differences.)

Part B — Idle detection (idle TIMER only, never keystrokes)
In app/src-tauri/src/capture/window.rs (the existing 30s window poller):
On each poll, also compute whether the user is active using macOS:
  CGEventSourceSecondsSinceLastEventType with kCGAnyInputEventType
  → seconds since the last input event (keyboard OR mouse).
This returns ONLY a number of seconds — never what was typed or clicked.

If seconds_since_last_input < 60 → user is active (is_user_active = 1)
Else → user is idle (is_user_active = 0)

Attach is_user_active to the window event being written on that poll.

CRITICAL: This captures ONLY the idle duration. It must NEVER capture, log,
or store any keystroke content, key codes, mouse coordinates, or click targets.
It is an idle timer, nothing more. Add a comment making this explicit.

Add to mod.rs: pub mod app_lifecycle;
Spawn start_app_lifecycle_monitor as a tokio task in lib.rs.

Follow AGENTS.md conventions. Show me app_lifecycle.rs, the window.rs idle
addition, and the lib.rs spawn.
```

**✅ Verify:**
```bash
# Launch and quit an app (e.g. open Calculator, close it), then:
sqlite3 ~/.orbit/orbit.db "SELECT type, app_name, metadata FROM events WHERE type='app_lifecycle' ORDER BY timestamp DESC LIMIT 5;"
# Walk away for 90 seconds, come back, then check window events:
sqlite3 ~/.orbit/orbit.db "SELECT app_name, is_user_active FROM events WHERE type='window' ORDER BY timestamp DESC LIMIT 5;"
# Some should show is_user_active=0 (idle) if you were away
```

---

## Step 5 — Use System Signals in Sessions + Recall

```
Read AGENTS.md fully first.

Now wire the new signals into session generation and recall so they actually
improve answers.

Part A — backend/scheduler.py — session boundaries on system state
When fetching events for a session, use system_state events as natural
session boundaries:
  - A "lock" or "sleep" event ends the current session
  - The next "unlock" or "wake" starts a potential new session
This fixes sessions that currently span breaks. When building session batches,
split the event list at any lock/sleep boundary, generating separate sessions
for activity before and after the break.

Part B — backend/scheduler.py — honest durations using idle
When computing a session's effective work time, use is_user_active:
Count active time vs idle time. Include in the session summary an "active_minutes"
figure so "how long did I spend?" answers reflect actual work, not just elapsed
time with the app open in the background.
Add active_minutes to the session record (new column, integer).

Part C — backend/scheduler.py — file activity in summaries
Include file_activity events in the Claude session payload. These are strong
signals of what was actually worked on. Format them clearly:
  "Edited file: /Users/.../template-editor.tsx (modified)"
Update the summary prompt so Claude uses file activity as primary evidence of
what the user was doing — file edits are more reliable than window titles.

Part D — backend/routes/recall.py — surface file + session timing
In the recall context block, include:
  - file_activity events: "Worked on file: <filename> (<action>) at <time>"
  - When a query asks about time spent, use active_minutes from sessions
  - System state for "when did I step away?": surface lock/unlock times

Update the recall to handle "when did I take breaks?" / "how long did I work
on X?" using system_state and active_minutes.

Follow AGENTS.md conventions. Show me the scheduler boundary logic, the
active_minutes column + computation, the file activity in the prompt, and the
recall context additions.
```

**✅ Verify:**
```bash
# Work for a while, take a screen-lock break, work again, then force a session:
cd backend && uv run python -c "from scheduler import generate_sessions_from_recent_events; import asyncio; asyncio.run(generate_sessions_from_recent_events())"
sqlite3 ~/.orbit/orbit.db "SELECT project_name, active_minutes, start_time, end_time FROM sessions ORDER BY start_time DESC LIMIT 5;"
# Sessions should be split at the lock boundary, with realistic active_minutes

# Then test the new query types:
curl -X POST http://localhost:47821/recall -H "Content-Type: application/json" \
  -d '{"query":"what files was I working on?"}' --no-buffer
curl -X POST http://localhost:47821/recall -H "Content-Type: application/json" \
  -d '{"query":"how long did I work this morning?"}' --no-buffer
```

---

## Step 6 — Privacy Panel: File Watching Controls

```
Read AGENTS.md fully first.

Users must be able to control file activity capture.

Part A — backend/routes/privacy.py
Add:
  GET  /privacy/file-watching        → returns {enabled: bool, watched_folders: [...]}
  POST /privacy/file-watching        → {enabled: bool} toggle on/off
  POST /privacy/watched-folders      → {folder: path} add a folder
  DELETE /privacy/watched-folders    → {folder: path} remove a folder

Store these settings in a new SQLite table file_watch_settings (single row,
like capture_state). Default: enabled=true, watched_folders=[Documents, Desktop, Downloads].

Part B — Rust file_activity.rs
Read the watched folders + enabled flag from SQLite on startup and refresh
every 30s (like the excluded apps refresh). If disabled, stop watching. If the
folder list changes, update the watcher.

Part C — Frontend PrivacyPanel.tsx
Add a "File Activity" section:
  - Toggle: "Track file activity" (on/off)
  - List of watched folders with remove buttons
  - "Add folder" button (uses Tauri dialog to pick a folder)
  - Subtext: "Orbit records which files you open and edit — never their contents."
Wire through usePrivacySettings.ts.

Follow AGENTS.md conventions. Show me the privacy endpoints, the Rust refresh
logic, and the PrivacyPanel addition.
```

---

## Step 7 — Update AGENTS.md

```
Read the current state of all the files changed in Phase 2.6.

Update AGENTS.md to document Phase 2.6:
- New event types: file_activity, system_state, app_lifecycle
- New columns: file_path, is_user_active, sessions.active_minutes
- New Rust capture modules: file_activity.rs, system_state.rs, app_lifecycle.rs
- Idle detection (idle timer only — add an explicit DO NOT: never log keystrokes)
- Session boundaries now split on lock/sleep
- File watching privacy controls + file_watch_settings table
- New privacy endpoints for file watching
- Update data flow diagrams + Critical Architecture Facts
- Add to DO NOT: never capture keystroke content, audio, screen (until Phase 3),
  network connections, or OS audit logs
- Mark Phase 2.6 complete

Show me what you changed.
```

---

## Phase 2.6 Done Checklist

- [ ] File activity captured for Documents/Desktop/Downloads
- [ ] node_modules/.git/hidden files correctly filtered out
- [ ] File contents NEVER read or stored (only paths)
- [ ] Lock/unlock/sleep/wake captured
- [ ] App launch/quit captured
- [ ] Idle detection works (is_user_active flag) — NO keystroke content anywhere
- [ ] Sessions split at lock/sleep boundaries
- [ ] active_minutes reflects real work time
- [ ] File activity improves "what was I working on?" answers
- [ ] "How long did I work on X?" works
- [ ] File watching can be toggled off + folders customised
- [ ] PrivacyPanel shows file watching controls

---

## The Test That Proves It Worked

Before Phase 2.6:
> "What was I working on?" → guessed from window titles, often vague

After Phase 2.6:
> "What was I working on this morning?"
> 📌 This morning (9:05–11:30, ~2h 5m active) — Orbit backend
> You were editing these files:
>   • recall.py (modified 6 times)
>   • time_parser.py (created, then modified 3 times)
>   • database.py (modified twice)
> You took a break around 10:15 (screen locked ~20 min), then came back and
> kept working on the time parser. Last file you touched was time_parser.py.

If you get file-level precision and honest timing like that, Phase 2.6 worked.