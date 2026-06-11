# Phase 2.7 — Native Browser URL Capture
**Goal:** Capture active browser tab URLs natively via AppleScript — no extension
required, works across Chrome, Safari, Arc, Brave, Edge, and ALL their profiles.

**Why:** The Chrome extension is per-browser and per-profile — real install
friction. Native capture gives every user browser memory the moment they install
Orbit, with one Automation permission instead of an extension per profile.

**Result:** Two layers —
- Layer 1 (this phase): native URL+title from all browsers/profiles, zero install
- Layer 2 (existing extension): optional deep capture (page content, clicks, searches)

---

## What This Adds

A new Rust capture module that polls the frontmost browser's active tab URL +
title via osascript, for any supported browser, across all profiles.

| Browser | Native support |
|---|---|
| Safari | ✅ URL + title |
| Chrome | ✅ URL + title (all profiles) |
| Arc | ✅ URL + title (Chromium) |
| Brave | ✅ URL + title (Chromium) |
| Edge | ✅ URL + title (Chromium) |
| Firefox | ❌ No tab access — extension only |

---

## Important Design Decisions

1. **Dedup against the extension.** If the Chrome extension is installed AND
   native capture is running, the same URL could be captured twice. The native
   capture must mark its source as `'native_browser'` and the recall/session
   logic must dedup URL events that occur within a few seconds of each other
   from different sources (prefer the extension's richer event when both exist).

2. **Only capture when a browser is frontmost.** The window tracker already
   knows the active app. Only run the URL query when the frontmost app is a
   known browser — don't query browsers that aren't in focus.

3. **Automation permission.** Reading browser URLs via AppleScript needs the
   macOS Automation permission. First query triggers the system prompt. Handle
   this gracefully and add it to onboarding.

---

## Step 1 — Rust: Native Browser URL Capture Module

```
Read AGENTS.md fully first.

We are adding native browser URL capture via osascript — no extension needed.
This works for Chrome, Safari, Arc, Brave, and Edge across all profiles.

Create app/src-tauri/src/capture/browser_url.rs

Public async function start_native_browser_url_monitor(
    sqlx_connection_pool: sqlx::SqlitePool
):

1. Poll every 5 seconds (browser tab changes faster than window titles, but
   we don't need sub-second precision).

2. First determine the frontmost application name (reuse the same osascript
   approach window.rs uses, or read the most recent window event). Only proceed
   if the frontmost app is a known browser:
   "Google Chrome", "Safari", "Arc", "Brave Browser", "Microsoft Edge"

3. For the detected browser, run the matching osascript to get the active tab
   URL and title. Use these exact scripts:

   Chrome / Arc / Brave / Edge (Chromium browsers, same dictionary):
     tell application "<BrowserName>" to return (URL of active tab of front window) & "|||" & (title of active tab of front window)

   Safari:
     tell application "Safari" to return (URL of current tab of front window) & "|||" & (name of current tab of front window)

   Split the result on "|||" to get url and title separately.

   Exact app names to use in the script:
     "Google Chrome", "Safari", "Arc", "Brave Browser", "Microsoft Edge"

4. Dedup: keep a last_captured_url in memory. Only write a new event when the
   URL changes from the last captured one (same pattern as window.rs).

5. Apply the SAME checks the extension capture path uses:
   - Pause state (skip if capture is paused)
   - Excluded domains (extract domain from URL, skip if excluded)
   - Skip internal URLs: chrome://, about:, safari-resource://, arc://,
     brave://, edge://, and empty URLs

6. Write the event to SQLite:
   type='url', url=<url>, raw_content=<title>, app_name=<browser name>,
   source='native_browser', timestamp=now_ms

7. If the osascript fails because Automation permission is not granted, detect
   that specific error and set an in-memory flag browser_automation_denied=true
   (the frontend can check this via a command to prompt for permission). Do not
   spam errors — log once, keep polling silently.

8. Never panic. Log and continue.

Part B — app/src-tauri/src/capture/mod.rs
Add: pub mod browser_url;

Part C — app/src-tauri/src/lib.rs (or main.rs)
Spawn start_native_browser_url_monitor as a tokio task alongside the other
capture monitors, passing the shared SQLite pool.

Follow AGENTS.md conventions. Fully descriptive names. Show me browser_url.rs,
mod.rs, and the lib.rs spawn.
```

**✅ Verify:**
```bash
cd app && pnpm tauri dev
# macOS will prompt: "Orbit wants to control Google Chrome" — click OK
# Browse to a few different URLs in Chrome (or Safari/Arc/Brave/Edge)
sqlite3 ~/.orbit/orbit.db "SELECT url, raw_content, app_name, source FROM events WHERE source='native_browser' ORDER BY timestamp DESC LIMIT 10;"
# Should show URLs + titles with source='native_browser'
# Test with a SECOND Chrome profile — should also capture, no extra setup
```

---

## Step 2 — Automation Permission Detection + Command

```
Read AGENTS.md fully first.

Native browser capture needs the macOS Automation permission. We need to detect
whether it's granted and let onboarding prompt for it.

Part A — app/src-tauri/src/commands.rs
Add a Tauri command:

  #[tauri::command]
  async fn check_browser_automation_permission() -> bool
    Runs a minimal harmless osascript against the frontmost browser (or just
    Safari/Chrome if running). If it returns a result → granted (true).
    If it fails with the automation-not-authorized error (-1743) → false.
    If no browser is running at all → return true (can't test, assume ok,
    will prompt naturally when a browser opens).

  #[tauri::command]
  async fn trigger_browser_automation_prompt()
    Runs a benign osascript command against Chrome and Safari to deliberately
    trigger the macOS Automation permission prompt(s). This is called from
    onboarding so the user grants it up front rather than mid-use.

  #[tauri::command]
  async fn open_automation_system_settings()
    Opens System Settings to the Automation privacy pane:
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"

Register all three in the invoke_handler.

Part B — app/src/hooks/useOnboarding.ts
Add browser automation permission handling alongside the existing accessibility
permission logic:
  - browserAutomationGranted: boolean
  - checkBrowserAutomation(): calls check_browser_automation_permission
  - requestBrowserAutomation(): calls trigger_browser_automation_prompt, then
    polls check_browser_automation_permission every 3s until granted

Follow AGENTS.md conventions. Show me the three commands and the useOnboarding
additions.
```

---

## Step 3 — Add Browser Permission to Onboarding

```
Read AGENTS.md fully first.

Add a browser capture step to the onboarding flow so users grant Automation
permission up front.

Update app/src/components/OnboardingFlow.tsx.

Add a new step AFTER the Accessibility step and BEFORE the Chrome Extension
step (the extension is now optional, so it comes last and is clearly skippable):

New Step — "Let Orbit see your browser tabs":
  Icon: 🌐
  Heading: "Connect your browser"
  Body: "Orbit can see which web pages you visit so it can remember your
   research and reading. This works with Chrome, Safari, Arc, Brave, and Edge —
   across all your profiles, with no extension needed."
  Status indicator: 🔴 "Not connected" / ✅ "Connected!"
  Button (if not granted): "Allow Browser Access"
    → calls requestBrowserAutomation()
    → macOS shows the Automation prompt(s)
    → button shows "Waiting..." spinner, auto-advances when granted
  Button (if granted): "Continue →"
  Small text below: "Orbit only sees the page address and title — not your
   passwords or what you type."

Update the EXISTING Chrome Extension step (now the LAST optional step):
  Change heading to: "Want deeper memory? (optional)"
  Body: "The browser extension lets Orbit remember the actual content of
   articles you read and what you search for — not just the page address.
   It's optional. You can always add it later."
  Make "Skip" the prominent action, "Get Extension" secondary.

Follow AGENTS.md conventions. Show me the updated OnboardingFlow.tsx.
```

---

## Step 4 — Dedup Native + Extension URL Events

```
Read AGENTS.md fully first.

If both native capture AND the Chrome extension are active, the same URL gets
captured twice (once as source='native_browser', once as source='extension').
The extension event is richer (it may have page_content). We must dedup.

Part A — backend/routes/capture.py
When a url-type event arrives, before inserting, check: is there already a
url event for the SAME url within the last 10 seconds?
  - If an existing event from source='extension' exists and the new one is
    source='native_browser' → SKIP the native one (extension is richer).
  - If an existing event from source='native_browser' exists and the new one
    is source='extension' → DELETE the native one, keep the extension one
    (or update it in place with the richer data).
  - Otherwise insert normally.

Keep this efficient — a single indexed query on (url, timestamp). Add an index
on events(url, timestamp) if not present.

Part B — backend/scheduler.py + backend/routes/recall.py
When building context, if duplicate URLs slip through, dedup by URL in the
formatting step (keep the one with the most data — page_text present wins).

Follow AGENTS.md conventions. Show me the capture dedup logic and the index.
```

**✅ Verify:**
```bash
# With BOTH native capture running AND the Chrome extension installed:
# Visit a page, wait, then:
sqlite3 ~/.orbit/orbit.db "SELECT url, source, CASE WHEN page_text IS NOT NULL THEN 'has_content' ELSE 'no_content' END FROM events WHERE type='url' ORDER BY timestamp DESC LIMIT 10;"
# Each URL should appear ONCE, preferring the extension (has_content) version
```

---

## Step 5 — Privacy Panel: Browser Capture Toggle

```
Read AGENTS.md fully first.

Users should be able to control native browser capture independently.

Part A — backend/routes/privacy.py
Add to the capture settings:
  GET  /privacy/browser-capture       → {native_enabled: bool, browsers: [...]}
  POST /privacy/browser-capture       → {native_enabled: bool}
Store in a settings table (reuse capture_state or a new browser_capture_settings
single-row table). Default native_enabled=true.

Part B — Rust browser_url.rs
Read the native_enabled flag from SQLite on startup, refresh every 30s. If
disabled, stop polling browsers.

Part C — Frontend PrivacyPanel.tsx
Add a "Browser Tracking" section:
  - Toggle: "Track browser tabs (native)" on/off
  - Shows which browsers are detected/supported
  - Subtext: "Captures the page address and title from Chrome, Safari, Arc,
    Brave, and Edge — no extension needed. Add the extension for deeper memory."
  - Link to the excluded domains list (already exists from Phase 2.5)
Wire through usePrivacySettings.ts.

Follow AGENTS.md conventions. Show me the privacy endpoints, the Rust refresh,
and the PrivacyPanel addition.
```

---

## Step 6 — Update AGENTS.md

```
Read the current state of all files changed in Phase 2.7.

Update AGENTS.md to document Phase 2.7:
- New Rust module: capture/browser_url.rs — native AppleScript URL capture
- Supported browsers: Chrome, Safari, Arc, Brave, Edge (all profiles), not Firefox
- New event source: 'native_browser'
- Two-layer browser capture model: native (default, no install) + extension
  (optional, deep)
- Native/extension dedup logic in capture.py + the events(url, timestamp) index
- New macOS permission: Automation (for reading browser URLs)
- Three new commands: check_browser_automation_permission,
  trigger_browser_automation_prompt, open_automation_system_settings
- Onboarding now has a browser-access step; extension step is now optional/last
- Browser capture privacy toggle
- Update the macOS permissions table to include Automation
- Update data flow diagrams (browser capture now has two sources)
- Mark Phase 2.7 complete

Show me what you changed.
```

---

## Phase 2.7 Done Checklist

- [ ] Native URL capture works for Chrome (test multiple profiles!)
- [ ] Works for Safari
- [ ] Works for Arc / Brave / Edge (test whichever you have)
- [ ] Automation permission prompt appears and is handled in onboarding
- [ ] Native capture respects pause state + excluded domains
- [ ] Internal URLs (chrome://, about:) skipped
- [ ] Native + extension dedup works (no double URLs)
- [ ] Extension version preferred when both exist (richer)
- [ ] Browser capture can be toggled off in PrivacyPanel
- [ ] Onboarding: browser step required, extension step optional/skippable
- [ ] Works with ZERO extension installed (the whole point)

---

## The Test That Proves It Worked

Uninstall the Chrome extension entirely. Use a fresh Chrome profile you've
never set up. Browse some pages. Then:

```bash
sqlite3 ~/.orbit/orbit.db "SELECT url, raw_content, app_name FROM events WHERE source='native_browser' ORDER BY timestamp DESC LIMIT 10;"
```

If your browsing appears with NO extension installed and NO per-profile setup —
across whatever browser you used — Phase 2.7 succeeded. Every beta user now gets
browser memory the moment they install Orbit, regardless of browser or profile.