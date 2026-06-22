# Phase 2.10 — Performance: Consolidate Capture Loops

**Goal:** Reduce subprocess spawns from ~32/min to ~8/min by merging all
osascript calls into one consolidated poller, and reading lock state via
direct API instead of spawning a process.

---

## The Problem

Four modules each spawn their own osascript subprocesses:
- browser_url.rs (every 5s) — 12 spawns/min
- system_state.rs (every 5s) — 12 spawns/min
- app_lifecycle.rs (every 10s) — 6 spawns/min  
- window.rs (every 30s) — 2 spawns/min

= 32 subprocess spawns per minute, each taking 50–800ms of CPU.

## The Solution

**One consolidated loop. One subprocess per tick.**
Instead of 4 separate modules polling independently, one `unified_poller.rs`
runs every 8 seconds and collects ALL of this in a SINGLE osascript call.
Then each piece is handled separately — but only one process was spawned.

**Lock state via direct API instead of subprocess.**
`CGSessionCopyCurrentDictionary()` is a direct C API call — no subprocess,
no script compilation, ~0.1ms instead of ~200ms.

Result: ~8 spawns/min instead of 32, lock state at zero subprocess cost.

---

## Prompt 1 — Create unified_poller.rs

```
Read AGENTS.md fully first.

We are consolidating four separate osascript-spawning capture modules into
one unified polling loop. This reduces subprocess spawns from ~32/min to
~8/min, significantly lowering CPU and battery impact.

Create app/src-tauri/src/capture/unified_poller.rs

This module replaces the polling loops in:
  - window.rs (currently 30s polling via osascript)
  - browser_url.rs (currently 5s polling via osascript)
  - app_lifecycle.rs (currently 10s polling via osascript)

Keep as SEPARATE modules (not replaced):
  - clipboard.rs (uses arboard, no subprocess — keep independent)
  - file_activity.rs (event-driven FSEvents — keep independent)
  - screen_content.rs (AX API via spawn_blocking — keep independent)
  - system_state.rs (keep separate — uses CGSession direct API)

--- THE UNIFIED POLL FUNCTION ---

Poll every 8 seconds. Run ONE osascript that returns ALL of:
  - Frontmost app name
  - Active window title
  - Active browser tab URL + title (if frontmost is a browser)
  - List of recently launched/quit apps (delta from previous poll)

Single combined osascript:

osascript << 'EOF'
set output to ""

-- Active app
tell application "System Events"
    try
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        set windowTitle to ""
        try
            set windowTitle to title of front window of frontApp
        end try
        set output to output & "APP:" & appName & "|||TITLE:" & windowTitle & "\n"
    end try
end tell

-- Browser URL (if frontmost is a browser)
set browserApps to {"Google Chrome", "Safari", "Arc", "Brave Browser", "Microsoft Edge"}
tell application "System Events"
    try
        set frontAppName to name of first application process whose frontmost is true
        if frontAppName is in browserApps then
            set browserUrl to ""
            set browserTitle to ""
            if frontAppName is "Safari" then
                tell application "Safari"
                    set browserUrl to URL of current tab of front window
                    set browserTitle to name of current tab of front window
                end tell
            else
                tell application frontAppName
                    set browserUrl to URL of active tab of front window
                    set browserTitle to title of active tab of front window
                end tell
            end if
            set output to output & "BROWSER_URL:" & browserUrl & "|||BROWSER_TITLE:" & browserTitle & "\n"
        end if
    end try
end tell

-- Running apps list (for lifecycle diffing)
tell application "System Events"
    set runningApps to name of every application process
    set appList to ""
    repeat with appName in runningApps
        set appList to appList & appName & ","
    end repeat
    set output to output & "RUNNING:" & appList & "\n"
end tell

return output
EOF

Parse the output lines by prefix (APP:, BROWSER_URL:, RUNNING:).

--- WHAT EACH PARSED PIECE DOES ---

APP + TITLE → replaces window.rs logic:
  - Compare to last_window_title
  - If changed: write window event to SQLite (same as current window.rs)
  - Attach is_user_active from idle timer (see below)

BROWSER_URL → replaces browser_url.rs logic:
  - Compare to last_browser_url
  - If changed and not in INTERNAL_URL_SCHEME_PREFIXES: write url event
  - Respect excluded_domains and pause state
  - Mark source = 'native_browser'

RUNNING list → replaces app_lifecycle.rs logic:
  - Diff against previous_running_apps set
  - New apps in list: write app_lifecycle event with action='launched'
  - Apps removed from list: write app_lifecycle event with action='quit'
  - Filter: skip any app_name that is in the FILTERED_APP_NAMES list
    (the same filter added in Fix A: "missing value", "com.apple.*", 
     WebKit processes, helper processes)

--- IDLE DETECTION ---

Get seconds since last input INLINE (no subprocess) using
CGEventSourceSecondsSinceLastEventType. This returns a float — no subprocess:

  extern "C" {
      fn CGEventSourceSecondsSinceLastEventType(
          state_id: i32,
          event_type: u64,
      ) -> f64;
  }
  const kCGAnyInputEventType: u64 = u64::MAX;
  const kCGEventSourceStateCombinedSessionState: i32 = 1;
  
  let idle_seconds = unsafe {
      CGEventSourceSecondsSinceLastEventType(
          kCGEventSourceStateCombinedSessionState,
          kCGAnyInputEventType,
      )
  };
  let is_user_active = idle_seconds < 60.0;

Attach this as is_user_active to window events (as window.rs did).

--- STATE TO MAINTAIN ---

Keep these in the function scope (not global):
  last_window_title: String
  last_browser_url: String
  previous_running_apps: HashSet<String>
  filter_cache_last_refreshed: Instant
  cached_excluded_apps: HashSet<String>
  cached_native_browser_enabled: bool
  cached_is_paused: bool

Refresh cache every 30s (read from SQLite) — same pattern as current modules.

--- STARTUP BEHAVIOUR ---

On first run, initialise previous_running_apps silently (don't write launched
events for ALL currently-running apps — just start tracking from this point).
This prevents a flood of 50+ "launched" events on Orbit startup.

--- REMOVING THE OLD MODULES ---

In app/src-tauri/src/lib.rs (or main.rs):
  Remove: tokio::spawn(start_window_tracker(...))
  Remove: tokio::spawn(start_native_browser_url_monitor(...))
  Remove: tokio::spawn(start_app_lifecycle_monitor(...))
  Add:    tokio::spawn(start_unified_poller(...))

In app/src-tauri/src/capture/mod.rs:
  Keep: pub mod clipboard; pub mod screen_content; pub mod file_activity;
        pub mod system_state;
  Add:  pub mod unified_poller;
  Remove the separate declarations for window, browser_url, app_lifecycle
  (keep the files but stop declaring them — or delete them if confident)

Follow all AGENTS.md conventions. Fully descriptive variable names.
Add comments explaining WHY this is unified (performance, not architecture).
Show me the complete unified_poller.rs and the lib.rs/mod.rs changes.
```

**✅ Verify:**
```bash
cd app && pnpm tauri dev

# After 30 seconds of use, check events are still being captured:
sqlite3 ~/.orbit/orbit.db \
  "SELECT type, source, COUNT(*) FROM events
   GROUP BY type, source ORDER BY COUNT(*) DESC;"
# window, url (native_browser), app_lifecycle should all appear
# from 'rust' source

# Measure subprocess spawning (before vs after):
# Before: watch how many osascript processes appear in Activity Monitor
# After: should see ~8/min instead of ~32/min
```

---

## Prompt 2 — Measure Real Resource Impact

Pass this to Claude Code AFTER implementing the unified poller:

```
Read AGENTS.md fully first.

We want to measure Orbit's actual resource impact after the unified poller
consolidation. Run these commands and report the results.

1. Check Orbit's current memory usage:
   ps aux | grep -E "orbit|uvicorn|python" | grep -v grep | \
     awk '{print $11, "RSS:", $6/1024 "MB", "VSZ:", $5/1024 "MB"}'

2. Check CPU usage over a 10-second window:
   top -l 2 -s 10 -pid $(pgrep -f "uvicorn") | tail -5
   (run separately for the Tauri process)

3. Count subprocess spawns per minute:
   # Monitor for 60 seconds and count osascript invocations:
   sudo dtrace -n 'proc:::exec-success /execname == "osascript"/ { @[execname] = count(); }' \
     -n 'tick-60s { exit(0); }' 2>/dev/null || \
   # Alternative without dtrace:
   for i in $(seq 1 12); do
     pgrep osascript | wc -l
     sleep 5
   done

4. Check SQLite performance:
   sqlite3 ~/.orbit/orbit.db \
     "SELECT COUNT(*) as events_per_hour FROM events
      WHERE timestamp > (unixepoch()-3600)*1000;"
   # Events per hour — should be 300-600 for normal use

Report: total RAM usage, approximate CPU%, subprocess spawns per minute
before and after the unified poller. Note any change in battery drain
(hard to measure precisely, but subjective impression counts).
```

---

## What Good Resource Usage Looks Like

| Metric | Current (before fix) | Target (after) |
|---|---|---|
| Total RAM | ~250–440MB | Same (RAM not the issue) |
| osascript spawns/min | ~32 | ~8 |
| CPU during idle | ~3–8% (subprocess overhead) | ~0.5–2% |
| Battery impact | Moderate | Low |
| Active work CPU | ~5–15% | ~5–10% |

The Python/FastAPI process is where the most memory lives and that won't
change much. The CPU win from consolidation is significant because it lets
the CPU enter deep idle states between polls instead of constantly waking
for subprocess management.

---

## The Lightweight Philosophy for Background Apps

Three rules that make background apps feel invisible:

1. **Prefer direct API over subprocess** — CGEventSource, AXUIElement, arboard
   are all direct API calls. osascript is a crutch; use it only when there's
   no API alternative.

2. **Event-driven over polling when possible** — FSEvents (file changes),
   NSWorkspace notifications (app launch/quit) are zero overhead between
   events. Polling is always burning something.

3. **One subprocess per tick, not one per concern** — If you must poll via
   subprocess, batch all your questions into one script. Network requests,
   subprocess spawns, and blocking reads all have a fixed setup cost that
   you should amortize over as many pieces of information as possible.

Orbit already follows rules 1 and 2 for clipboard, files, and screen content.
The unified poller applies rule 3 to the remaining osascript calls.