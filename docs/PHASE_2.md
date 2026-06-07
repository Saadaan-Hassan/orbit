# Phase 2 — Waitlist & Beta Readiness
**Duration:** Week 5–8 | **Prerequisite:** Phase 1 complete and verified

---

## Goal

Make Orbit safe and polished enough for real people to use. Ship a landing page. Recruit 5 beta testers from your LinkedIn network.

**Phase 2 is done when:**
- A stranger can install Orbit and trust it with their computer activity
- Your landing page is live and collecting waitlist emails
- 5 people outside yourself are actively using it

---

## What You're Building

**In the Tauri app:**
✅ App exclude list — never capture from password managers, banking apps
✅ Pause / Resume capture toggle
✅ Memory viewer — see and delete exactly what's stored
✅ Full memory wipe (one button, no recovery)
✅ In-app feedback (👍 / 👎 + text)
✅ Auto-updater via GitHub Releases (tauri-plugin-updater)

**Landing page (new — `landing/`):**
✅ Next.js 16.2.7 — App Router, Tailwind CSS v4, TypeScript
✅ Hero section with demo video embed
✅ How it works (3 steps)
✅ Privacy section (what's stored, what isn't)
✅ Waitlist email capture → Supabase + Resend confirmation
✅ Deployed to Vercel

**Distribution:**
✅ macOS `.dmg` installer (code-signed + notarized)
✅ GitHub Actions build workflow

## What You're NOT Building
❌ Voice / orb (Phase 4)
❌ Cloud sync (Phase 5)
❌ Payments (Phase 5)
❌ Windows installer (Phase 6)

---

## Versions Locked for Phase 2

| Package | Version | Notes |
|---|---|---|
| Next.js | `16.2.7` | Latest LTS — includes May 2026 security patches |
| Tailwind CSS | `v4` | CSS-first config — no `tailwind.config.js` |
| tauri-plugin-updater | `2` | Ed25519 signed updates |
| Resend | latest | Server Actions pattern, App Router |
| React Email | latest | Email templates as React components |
| Supabase JS | `2` | For waitlist storage |

---

## Step 1 — Backend: Privacy Control Endpoints

```
Read AGENTS.md fully before starting.

We are on Phase 2, Step 1: Privacy control API endpoints in FastAPI.

Add these to backend/routes/capture.py (or create backend/routes/privacy.py
if capture.py is getting large — use your judgement). Mount in main.py.

All routes are async. All follow AGENTS.md Python conventions.
Type hints on every function. Pydantic models for all request bodies.

--- Endpoint 1: GET /privacy/excluded-apps ---
Returns the current list of excluded app names.
Excluded apps are stored in a new SQLite table:

  excluded_apps(
    id TEXT PRIMARY KEY,
    app_name TEXT NOT NULL UNIQUE,
    added_at INTEGER NOT NULL   -- unix milliseconds
  )

Create this table in database.py create_all_tables().
Return: {"excluded_apps": ["1Password", "Bitwarden", ...]}

The following apps are in the DEFAULT exclude list and must be seeded
on first run if the table is empty:
  "1Password", "Bitwarden", "Keychain Access", "LastPass",
  "Dashlane", "Safari" (banking detection handled separately),
  "System Preferences", "System Settings"

--- Endpoint 2: POST /privacy/excluded-apps ---
Request body: {"app_name": "BankApp"}
Adds the app to the excluded_apps table.
Returns: {"status": "ok", "app_name": "BankApp"}

--- Endpoint 3: DELETE /privacy/excluded-apps/{app_name} ---
Removes the app from the excluded_apps table.
Returns: {"status": "ok"}

--- Endpoint 4: POST /privacy/pause ---
Request body: {"paused_until_timestamp": 1234567890000}  -- unix ms, or null for indefinite
Stores the pause state in a new SQLite table:
  capture_state(
    id INTEGER PRIMARY KEY DEFAULT 1,
    is_paused INTEGER NOT NULL DEFAULT 0,   -- 0 or 1
    paused_until INTEGER                    -- unix ms, null = indefinite
  )
Seed this table with one row (id=1) on startup if it doesn't exist.
Returns: {"status": "paused", "paused_until": <timestamp_or_null>}

--- Endpoint 5: POST /privacy/resume ---
Sets is_paused=0 and paused_until=NULL.
Returns: {"status": "capturing"}

--- Endpoint 6: GET /privacy/capture-status ---
Returns current capture state.
Returns: {"is_paused": false, "paused_until": null}

--- Endpoint 7: DELETE /privacy/all-data ---
Deletes ALL data from: events, sessions, memory_objects, excluded_apps
(but NOT capture_state — keep the settings).
Also deletes all Qdrant points from the orbit_sessions collection.
Returns: {"status": "ok", "message": "All memory wiped"}
This is irreversible. The endpoint itself is the confirmation — no extra
confirmation step in the API (the UI handles that).

Create all tables in database.py. Mount privacy router in main.py.
Show me the new privacy route file, the updated database.py, and updated main.py.
```

**✅ Verify:**
```bash
uv run uvicorn main:app --port 8000
curl http://localhost:8000/privacy/excluded-apps
# Should return the default list including 1Password etc.
curl -X POST http://localhost:8000/privacy/excluded-apps \
  -H "Content-Type: application/json" -d '{"app_name": "TestBank"}'
curl http://localhost:8000/privacy/capture-status
```

---

## Step 2 — Backend: Respect Pause + Exclude List at Capture Time

```
Read AGENTS.md fully before starting.

We need the capture system to actually RESPECT the pause state and exclude list.

Task 1: Update backend/routes/capture.py

In the POST /capture endpoint, before writing the event to SQLite:

1. Check capture_state table — if is_paused=1 and (paused_until is NULL or
   paused_until > current timestamp): return {"status": "paused"} with HTTP 200.
   Do not write the event.

2. If the event has an app_name: check if that app_name exists in excluded_apps table.
   If it does: return {"status": "excluded"} with HTTP 200.
   Do not write the event.

3. Only if both checks pass: write the event as normal.

Cache the pause state and exclude list in memory (module-level variables) and
refresh them every 30 seconds — not on every request (that would be a DB hit
per capture event, which is too frequent).

Task 2: Update app/src-tauri/src/capture/window.rs

In the active window polling loop, before calling the FastAPI /capture endpoint,
check a shared atomic bool (is_capture_paused) that the Tauri app sets.

Actually — simpler approach for Rust:
The Rust clipboard and window trackers already POST to FastAPI /capture.
FastAPI now rejects events when paused. So Rust capture keeps running —
it just gets a "paused" response and doesn't panic. No Rust changes needed.

Only change: in capture/clipboard.rs and capture/window.rs, handle a non-error
HTTP response with status "paused" or "excluded" gracefully (already should be
fine if you're not treating 200 responses as errors, but verify this).

Show me only the changed parts of routes/capture.py.
```

---

## Step 3 — Backend: Memory Viewer + Feedback Endpoints

```
Read AGENTS.md fully before starting.

Task 1: Update backend/routes/capture.py — add memory viewer endpoints.

GET /memory/events?limit=100&offset=0&type=all
  Returns paginated events from the events table.
  type filter: "all" | "clipboard" | "window" | "url"
  Returns: {"events": [...], "total": 245, "limit": 100, "offset": 0}

GET /memory/sessions?limit=20&offset=0
  Returns paginated sessions with their summaries.
  Returns: {"sessions": [...], "total": 12}

DELETE /memory/events/{event_id}
  Deletes a single event by ID.
  Returns: {"status": "ok"}

DELETE /memory/sessions/{session_id}
  Deletes a session and all its associated events (set session_id=NULL
  on events that belong to it, then delete the session row).
  Also deletes the Qdrant point for this session.
  Returns: {"status": "ok"}

Task 2: Create backend/routes/feedback.py

POST /feedback
  Request body:
    {"rating": "positive" | "negative", "comment": str | None, "context": str | None}
  Stores in a new SQLite table:
    feedback(
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      rating TEXT NOT NULL,
      comment TEXT,
      context TEXT
    )
  Create this table in database.py.
  Returns: {"status": "ok"}

Mount the feedback router in main.py.
Show me all new/changed files.
```

---

## Step 4 — Tauri/React: Privacy Controls UI

```
Read AGENTS.md fully before starting.

Create app/src/components/PrivacyPanel.tsx

This is a React component for the in-app privacy settings panel.
Use Tailwind CSS for styling. Use ShadCN components where appropriate
(Button, Switch, Input, Badge, AlertDialog for the wipe confirmation).
All API calls go through custom hooks in app/src/hooks/ — never fetch() directly in components.

First create app/src/hooks/usePrivacySettings.ts:
  - usePrivacySettings() hook that:
    - Fetches GET /privacy/excluded-apps and GET /privacy/capture-status on mount
    - Returns: { isCapturing, excludedApps, addExcludedApp, removeExcludedApp,
                 pauseCapture, resumeCapture, wipeAllMemory, isWiping }
    - pauseCapture(durationMinutes: number | null) calls POST /privacy/pause
    - resumeCapture() calls POST /privacy/resume
    - wipeAllMemory() calls DELETE /privacy/all-data

PrivacyPanel.tsx renders:

Section 1 — Capture Status
  Large toggle: "Capturing" / "Paused"
  When pausing: show options (15 min / 1 hour / Until I resume)
  Green dot when capturing, orange dot when paused

Section 2 — Excluded Apps
  List of currently excluded apps with ✕ remove button on each
  Text input + "Add App" button to add a new app name
  Subtext: "Events from these apps are never captured or stored"

Section 3 — Danger Zone (red border)
  "Wipe All Memory" button — destructive, red
  Before wiping: show an AlertDialog confirmation:
    "This will permanently delete all captured events, sessions, and memories.
     This cannot be undone."
    Confirm / Cancel buttons
  After wipe: show "Memory wiped" success state

Follow all AGENTS.md React conventions. No business logic in the component — hooks only.
Show me usePrivacySettings.ts and PrivacyPanel.tsx.
```

---

## Step 5 — Tauri/React: Memory Viewer UI

```
Read AGENTS.md fully before starting.

Create app/src/hooks/useMemoryData.ts:
  - Fetches GET /memory/events and GET /memory/sessions
  - Returns: { events, sessions, totalEvents, totalSessions,
               deleteEvent, deleteSession, isLoading }
  - deleteEvent(eventId) calls DELETE /memory/events/{id}
  - deleteSession(sessionId) calls DELETE /memory/sessions/{id}
  - Supports pagination (page state inside the hook)

Update app/src/components/MemoryViewer.tsx (already scaffolded, now implement it):

The component has two tabs: "Events" and "Sessions"

Events tab:
  - Filter buttons: All / Clipboard / Window / Browser
  - Scrollable list of events, grouped by date
  - Each event shows: type icon + app name + truncated content + timestamp
  - Trash icon on each event → calls deleteEvent() → removes from list
  - Pagination: "Load more" button at bottom

Sessions tab:
  - List of generated sessions (most recent first)
  - Each session: project name (bold) + goal + date/time range + duration
  - Expand arrow → shows full ai_summary JSON formatted nicely
  - Trash icon → calls deleteSession() with confirmation
  - "X events" badge showing how many raw events belong to this session

Add a small "👍 / 👎 Feedback" bar at the bottom of the memory viewer.
On click: opens a small inline form with the rating pre-selected + optional comment.
Submits to POST /feedback via the hook.

Wire PrivacyPanel and MemoryViewer into the main app UI.
For Phase 2, render them in separate panels accessible from the system tray menu:
  - "Orbit" (opens main chat panel — existing)
  - "Memory" (opens MemoryViewer)
  - "Privacy" (opens PrivacyPanel)
  - "Quit"

Show me useMemoryData.ts, the updated MemoryViewer.tsx, and the updated tray menu in main.rs.
```

---

## Step 6 — Auto-Updater (tauri-plugin-updater)

```
Read AGENTS.md fully before starting.

Set up the Tauri v2 auto-updater using tauri-plugin-updater 2.x.
This checks GitHub Releases for updates on app startup.

Task 1: Add dependencies

In app/src-tauri/Cargo.toml, add:
  [target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
  tauri-plugin-updater = "2"
  tauri-plugin-dialog = "2"
  tauri-plugin-process = "2"

In app/, run:
  pnpm add @tauri-apps/plugin-updater @tauri-apps/plugin-dialog @tauri-apps/plugin-process

Task 2: Generate Ed25519 signing keypair

Run: pnpm tauri signer generate -w ~/.tauri/orbit-signing-key.key
  - Save the generated PUBLIC KEY — it goes in tauri.conf.json
  - Save the PRIVATE KEY path — it's used during builds
  - The password you set is TAURI_SIGNING_PRIVATE_KEY_PASSWORD in CI secrets

Task 3: Update app/src-tauri/tauri.conf.json

Add to the bundle section:
  "createUpdaterArtifacts": true

Add the updater plugin config:
  "plugins": {
    "updater": {
      "pubkey": "<YOUR_GENERATED_PUBLIC_KEY>",
      "endpoints": [
        "https://raw.githubusercontent.com/saadaanhassan/orbit/main/releases/latest.json"
      ],
      "dialog": true
    }
  }

Task 4: Register plugins in app/src-tauri/src/main.rs

Add to the Tauri builder setup:
  .plugin(tauri_plugin_updater::Builder::new().build())
  .plugin(tauri_plugin_dialog::init())
  .plugin(tauri_plugin_process::init())

Task 5: Create app/src/hooks/useUpdater.ts

  import { check } from "@tauri-apps/plugin-updater"
  import { relaunch } from "@tauri-apps/plugin-process"

  export function useUpdater() — on mount, calls check() for updates.
  If update available: shows a notification in the UI (not a blocking dialog —
  the plugin handles the dialog via the "dialog": true config).
  Call this hook once in the main app component.

Task 6: Create releases/latest.json at the project root (template file):
  {
    "version": "0.1.0",
    "notes": "Initial beta release",
    "pub_date": "2026-06-07T00:00:00Z",
    "platforms": {
      "darwin-x86_64": {
        "signature": "",
        "url": "https://github.com/saadaanhassan/orbit/releases/download/v0.1.0/orbit_0.1.0_x64.dmg.tar.gz"
      },
      "darwin-aarch64": {
        "signature": "",
        "url": "https://github.com/saadaanhassan/orbit/releases/download/v0.1.0/orbit_0.1.0_aarch64.dmg.tar.gz"
      }
    }
  }

Show me all changed/created files. Do not run any build commands.
```

---

## Step 7 — Landing Page: Next.js 16 Scaffold

```
We are scaffolding the landing page. Run these commands exactly:

cd landing
pnpm create next-app@16 . --typescript --tailwind --eslint --app \
  --src-dir --import-alias "@/*" --turbopack

# Install additional dependencies
pnpm add resend @supabase/supabase-js zod
pnpm add -D @react-email/components

This uses Next.js 16 (latest stable), App Router, Tailwind CSS v4,
TypeScript, and Turbopack for dev.

After scaffolding, create landing/.env.local with:
  RESEND_API_KEY=your_resend_key
  NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
  RESEND_FROM_EMAIL=hello@yourdomain.com

Show me the generated package.json and confirm the Next.js version.
Do not write any page content yet.
```

**✅ Verify:**
```bash
cd landing && pnpm dev
# http://localhost:3000 should show the Next.js 16 default page
```

---

## Step 8 — Landing Page: Waitlist Backend

```
Read AGENTS.md. We are building the waitlist backend for the landing page.
Use Next.js 16 App Router patterns. Server Actions with 'use server'.
Tailwind CSS v4 (no tailwind.config.js needed — it's CSS-first now).

Task 1: Create the Supabase waitlist table

Create landing/supabase-schema.sql (for reference — run manually in Supabase dashboard):
  CREATE TABLE waitlist (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    source TEXT DEFAULT 'landing',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX idx_waitlist_email ON waitlist(email);

Task 2: Create landing/src/lib/supabase.ts

  Singleton Supabase client using createClient from @supabase/supabase-js.
  Use the service role key (server-side only — never expose to client).
  The client is initialized once at module level.

Task 3: Create landing/src/lib/waitlist-actions.ts

  'use server'

  Async Server Action: joinWaitlist(formData: FormData)

  1. Extract email and name from formData
  2. Validate with Zod: email must be valid, name optional string max 100 chars
  3. Insert into Supabase waitlist table
     - If email already exists (unique constraint error): return success silently
       (don't tell the user the email is already registered — security practice)
  4. Send confirmation email via Resend:
     - From: process.env.RESEND_FROM_EMAIL
     - To: email
     - Subject: "You're on the Orbit waitlist 🪐"
     - React email template (see Task 4)
  5. Return: { success: true } or { error: "Something went wrong" }

  Never expose Supabase or Resend errors directly to the client response.

Task 4: Create landing/src/emails/WaitlistConfirmation.tsx

  React Email component for the confirmation email.
  Keep it simple and clean:
  - Orbit logo text (plain text "🪐 Orbit" — no image dependency)
  - "You're on the list!" heading
  - One sentence: what Orbit does
  - "We'll reach out when beta access opens."
  - Small privacy note: "Your data never leaves your machine."
  - Plain text fallback works automatically with React Email

Show me supabase.ts, waitlist-actions.ts, and WaitlistConfirmation.tsx.
```

---

## Step 9 — Landing Page: UI

```
Read AGENTS.md. Build the Orbit landing page UI.

Update landing/src/app/page.tsx and create any needed components.

Use Next.js 16 App Router (Server Components by default).
Use Tailwind CSS v4 (CSS-first — @import "tailwindcss" in globals.css).
Use ShadCN components: pnpm dlx shadcn@latest init, then add button and input.

The page has these sections in order:

--- HERO ---
Full viewport height. Dark background (#0a0a0a). Centered content.
  - Small badge: "Coming soon" with a subtle pulse animation
  - Headline (large): "Your computer remembers. You don't have to."
  - Subheadline: "Orbit silently captures your work context and lets you
    recall anything — what you were building, what you were reading,
    where you left off — just by asking."
  - Demo video: a simple placeholder div with aspect-ratio 16/9, max-width
    800px, dark border, text "Demo video coming soon" centered.
    (We'll replace with real video later)
  - Waitlist form: email input + name input + "Join waitlist" button
    Form submits via the joinWaitlist Server Action.
    Show success state: "You're on the list! We'll be in touch."
    Show error state if something fails.
  - Social proof line (small, muted): "Built in public by @saadaanhassan"

--- HOW IT WORKS ---
3-column grid (stacks on mobile). White/light background.
  1. 🔍 "Captures silently" — "Tracks what you open, browse, and copy.
     No setup, no tagging, no folders."
  2. 🧠 "Understands context" — "Every 30 minutes, Orbit generates a
     summary of what you worked on and why."
  3. 💬 "Recalls on demand" — "Ask anything in plain language.
     Get a specific, structured answer."

--- PRIVACY ---
Dark background. Centered.
  Headline: "Local-first. Always."
  Three points (horizontal on desktop, vertical on mobile):
  ✓ All data stays on your machine
  ✓ Passwords and API keys are never stored
  ✓ Cloud sync is opt-in — off by default

--- FOOTER ---
  Simple: "Orbit by Saadaan Hassan" + link to Twitter/X + GitHub
  "© 2026"

Mobile-first responsive design.
No animations for now — clean and fast loads first.

Show me page.tsx and any component files created.
```

**✅ Verify:**
```bash
cd landing && pnpm dev
# http://localhost:3000 shows the full landing page
# Submit the waitlist form with a test email
# Check Supabase table: the email should appear
# Check your inbox: confirmation email should arrive
```

---

## Step 10 — Deploy Landing Page to Vercel

No Claude Code needed. Manual steps:

```bash
cd landing

# 1. Push to GitHub first
git add . && git commit -m "Phase 2: landing page with waitlist"
git push

# 2. Go to vercel.com → New Project → Import your GitHub repo
# 3. Set root directory to "landing"
# 4. Add environment variables:
#    RESEND_API_KEY
#    NEXT_PUBLIC_SUPABASE_URL
#    SUPABASE_SERVICE_ROLE_KEY
#    RESEND_FROM_EMAIL
# 5. Deploy

# Your landing page is now live.
# Share the URL in your next LinkedIn post.
```

---

## Step 11 — macOS Installer

```
We are setting up the macOS .dmg installer build.

Task 1: Update app/src-tauri/tauri.conf.json bundle section:
  "identifier": "com.saadaan.orbit",
  "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.icns"],
  "macOS": {
    "entitlements": "entitlements.plist",
    "exceptionDomain": "localhost",
    "signingIdentity": null,
    "minimumSystemVersion": "13.0"
  }

Task 2: Create app/src-tauri/entitlements.plist:
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
  <plist version="1.0"><dict>
    <key>com.apple.security.cs.allow-jit</key><true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
    <key>com.apple.security.cs.disable-library-validation</key><true/>
    <key>com.apple.security.network.client</key><true/>
    <key>com.apple.security.network.server</key><true/>
    <key>com.apple.security.files.user-selected.read-write</key><true/>
  </dict></plist>

Task 3: Create .github/workflows/release.yml

  GitHub Actions workflow that:
  - Triggers on: push to tags matching "v*" (e.g. v0.1.0)
  - Runs on: macos-latest
  - Steps:
    1. Checkout repo
    2. Install Rust stable
    3. Install Node + pnpm
    4. Install Python + uv (for reference — backend not bundled in Phase 2)
    5. pnpm install in app/
    6. Run: pnpm tauri build
       With env vars:
         TAURI_SIGNING_PRIVATE_KEY: from GitHub secret
         TAURI_SIGNING_PRIVATE_KEY_PASSWORD: from GitHub secret
    7. Upload the built .dmg as a GitHub Release asset
    8. Update releases/latest.json with new version + signature + URL
       and commit it back to the repo

Use the official tauri-apps/tauri-action GitHub Action for steps 6-8
as it handles the latest.json generation automatically.

Show me the complete release.yml workflow.
```

---

## Phase 2 Done Checklist

**In-app:**
- [ ] GET /privacy/excluded-apps returns default list
- [ ] Adding/removing from exclude list works
- [ ] Pausing capture stops events being written
- [ ] Memory viewer shows events + sessions with delete
- [ ] Full wipe deletes everything and confirms in UI
- [ ] Feedback form submits successfully
- [ ] Auto-updater plugin registered (no update available yet — just no crash)

**Landing page:**
- [ ] Live on Vercel
- [ ] Waitlist form submits and stores in Supabase
- [ ] Confirmation email arrives in inbox
- [ ] Page loads fast, looks good on mobile

**Distribution:**
- [ ] `pnpm tauri build` produces a .dmg locally
- [ ] GitHub Actions workflow file committed
- [ ] releases/latest.json committed to repo

---

## Commit Checkpoint

```bash
git add .
git commit -m "Phase 2: privacy controls, memory viewer, landing page, waitlist, auto-updater"
```

---

## What's Next — Phase 3 Preview

Phase 3 makes Orbit feel genuinely intelligent:
- Tier 3 Memory Objects (long-term condensed knowledge)
- "Continue" button — one click reopens all files + tabs from a previous session
- Daily digest notification — morning summary of yesterday's work
- 20 beta users in a feedback group

---
*Phase 2 of 6 — Orbit by Saadaan Hassan 🪐*