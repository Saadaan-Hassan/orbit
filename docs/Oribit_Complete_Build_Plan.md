# 🪐 Orbit — Complete Build Plan
### "I help you continue." — AI companion for context recovery.
**Platform:** macOS first → Windows later | **Framework:** Tauri v2 | **Build:** In public

> **Historical planning doc — written 2026-09-06, before the open-source
> hardening pass.** Provider choices (e.g. Claude via the Worker), telemetry,
> and the waitlist described below no longer match the current architecture
> — see root `AGENTS.md` for what's actually built. Kept for design-history
> context, not as a current reference.

---

## 🎯 North Star
> People don't struggle with doing work. They struggle with *restarting* it.
> Orbit solves context recovery — silently, automatically, without any setup.

**Ship order:** Prove the magic (recall) → build the audience → earn the companion layer.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────┐
│              USER'S MACHINE                      │
│                                                  │
│  ┌──────────────────┐   ┌────────────────────┐  │
│  │   Tauri App      │   │  Chrome Extension  │  │
│  │  (Rust + React)  │   │   (MV3 + TS)       │  │
│  │                  │   │                    │  │
│  │  🪐 Orb Widget   │   │  URLs, titles,     │  │
│  │  💬 Chat Panel   │   │  selected text,    │  │
│  │  📅 Timeline     │   │  YouTube, reading  │  │
│  └────────┬─────────┘   └────────┬───────────┘  │
│           └──────────┬───────────┘               │
│                      ▼                           │
│          ┌───────────────────────┐               │
│          │   FastAPI (local)     │               │
│          │   AI Processing       │               │
│          │                       │               │
│          │  Embeddings, memory   │               │
│          │  Session generation   │               │
│          │  Recall queries       │               │
│          └──────┬────────────────┘               │
│                 │                                │
│    ┌────────────┼──────────────┐                 │
│    ▼            ▼              ▼                 │
│  SQLite       Qdrant       Local FS              │
│ (events)    (vectors)   (screenshots)            │
└─────────────────────────────────────────────────┘
         │ API calls go via
         ▼
  ┌──────────────────┐
  │ Cloudflare Worker│  ← API keys live HERE only
  │  /chat  → Claude │     never in app binary
  │  /tts   → ElevenLabs
  │  /stt   → Deepgram (Phase 4)
  └──────────────────┘
```

---

## 🛠️ Final Tech Stack

### Desktop Shell
| Layer | Tool | Notes |
|---|---|---|
| Framework | **Tauri v2** | Rust backend, ~8MB binary, native macOS feel |
| Frontend | **React + TypeScript** | Fast iteration, great AI IDE support |
| Styling | **Tailwind + ShadCN** | Beautiful UI fast |
| Animation | **Framer Motion** | Orb widget animations, state transitions |
| Auto-updates | **tauri-plugin-updater** | GitHub Releases as update server (Sparkle-compatible on macOS) |

### Tauri Window Configuration (Clicky-derived)
Two windows required — learned directly from Clicky:

**1. Main Panel** (chat + timeline, dropdown from menu bar):
```json
{
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "focus": false
}
```

**2. Overlay Window** (companion orb, always visible):
```rust
// Rust side — set after window creation
window.set_ignore_cursor_events(true); // fully click-through
window.set_always_on_top(true);        // stays above everything
// React side renders the orb at absolute position
```

**App behavior:**
```xml
<!-- src-tauri/Info.plist -->
<key>LSUIElement</key>
<true/>
<!-- No dock icon. No Cmd+Tab. Menu bar only. -->
```

### Native Capture Layer (Rust — inside Tauri)
| What | Rust Crate | Notes |
|---|---|---|
| Global hotkey (push-to-talk) | `global-hotkey` | Reliable modifier-key detection at session level — same reason Clicky uses CGEvent tap over AppKit |
| Active window title | `active-win-pos-rs` | macOS: uses Accessibility API |
| Clipboard monitor | `arboard` | Cross-platform, fires on change |
| File system events | `notify` | macOS FSEvents under the hood |
| Screenshots | `xcap` | Multi-monitor aware |

**⚠️ Connection pool rule (from Clicky):**
Never create/destroy HTTP clients per request. Always reuse a single `reqwest::Client` instance in Rust. Creating new clients per session corrupts the OS TCP pool — causes silent connection failures after a few calls.

### Browser Extension
- Chrome Extension, **Manifest V3**, TypeScript
- Captures: URL, page title, selected text, YouTube video title + timestamp, reading time
- Posts to `http://localhost:PORT/capture` (Orbit's local FastAPI)
- All processing stays local — extension is just a pipe

### Security — Cloudflare Worker (Clicky's model, adopted for Orbit)
API keys never touch the app binary. A Cloudflare Worker acts as a secure proxy:

```typescript
// worker/src/index.ts
// Routes:
//   POST /chat          → api.anthropic.com/v1/messages
//   POST /tts           → ElevenLabs (Phase 4)
//   POST /stt-token     → Deepgram temp token (Phase 4)
// Secrets live in Cloudflare environment variables only
```

Deploy once, forget. Free tier handles Orbit's volume easily at MVP stage.

### Local Database — SQLite

```sql
events(id, timestamp, type, raw_content, app_name, url, source)
sessions(id, start_time, end_time, project_name, ai_summary, goal)
memory_objects(id, session_id, topic, summary, embedding_id)
urls(id, event_id, url, title, domain, visit_duration)
clipboard(id, event_id, content, content_type, app_name)
```

### Search — Two Layers
| Layer | Tool | For |
|---|---|---|
| Keyword | **Tantivy** (Rust) | Exact terms — "that Tailwind article", file names |
| Semantic | **Qdrant** (local) | Meaning-based — "what was I debugging Tuesday?" |

Run both in parallel on every query. Merge results, re-rank with Claude.

### Embeddings
| Phase | Tool |
|---|---|
| MVP | `sentence-transformers` (local, free, private) |
| Later | Voyage AI (better retrieval quality, upgrade when needed) |

### AI Models — Split by Task
| Task | Model | Why |
|---|---|---|
| Recall, summaries, conversation | **Claude Sonnet 4** (via Worker) | Best context reasoning |
| Event classification, tagging | **Gemini Flash** | Cheap, fast — don't waste Claude on "is this work or personal?" |
| Privacy mode (future) | **Qwen / Llama** local | Full offline operation |

### Voice — Phase 4 Only
Fallback chain (Clicky-derived pattern):

```
Whisper.cpp (local, primary)
    → Apple Speech (on-device fallback)
```

Why not AssemblyAI/Deepgram for MVP voice? Orbit's core promise is local-first. Sending voice to a cloud STT provider contradicts that. Whisper.cpp runs on-device, is fast on Apple Silicon, and is free.

TTS: **Kokoro TTS** (local, free) for standard tier → **ElevenLabs** (via Worker) as a Pro feature.

### Infrastructure
| Tool | Purpose |
|---|---|
| **Cloudflare Worker** | API key proxy (Claude, ElevenLabs, STT) |
| **Supabase** | Auth + cloud sync (opt-in, encrypted, Phase 5+) |
| **PostHog** | Privacy-safe analytics |
| **Sentry** | Crash reporting |
| **Lemon Squeezy** | Payments |
| **GitHub Releases** | Distribution + update server for tauri-plugin-updater |

---

## 🧠 Memory Architecture — Three Tiers

### Tier 1: Raw Events
Everything captured, as-is.
```
14:23 — opened VS Code (window: template-editor.tsx)
14:31 — clipboard: "@media (max-width: 768px)"
14:35 — browser tab: tailwindcss.com/docs/responsive-design
14:52 — browser tab: github.com/shadcn-ui/issues/1423
```

### Tier 2: Sessions (auto-generated every 30 min by Gemini Flash)
```
Session: Tuesday 2:00–4:14 PM
Project detected: Resume Builder
Goal inferred: Fixing mobile responsiveness
Resources used:
  → tailwindcss.com (responsive breakpoints section)
  → ShadCN GitHub issue #1423
  → Figma (3 opens)
Last action: copied media query, left template-editor.tsx open
Duration: 2h 14min
```

### Tier 3: Memory Objects (long-term, extracted by Claude)
```
Project: Resume Builder
Topic: Mobile Responsiveness
What was tried: Custom @media override on ShadCN card
Status: Unresolved — left mid-debug
Key files: template-editor.tsx, mobile-preview.tsx
Last seen: Tuesday 4:14 PM
```

**This three-tier system is the moat.** Not just what happened — but what matters.

---

## 🗺️ Build Phases

---

### ⚙️ PHASE 0 — Foundation (Week 1–2)
**Goal:** Everything connected. First event in DB.

- [ ] Tauri v2 + React + TypeScript scaffolded
- [ ] `LSUIElement = true` in Info.plist — no dock icon from day one
- [ ] FastAPI running locally, auto-starts with Tauri
- [ ] SQLite schema created — `events` table first
- [ ] Clipboard listener (`arboard`) → event written to DB
- [ ] Active window tracker (`active-win-pos-rs`) → events written to DB
- [ ] Cloudflare Worker deployed — Claude API call works end-to-end
- [ ] Qdrant running locally (Docker)

**Done when:** You open a terminal, use your computer for 10 minutes, and see your own clipboard + window history in SQLite.

---

### 🔍 PHASE 1 — v0.1: The Magic Moment (Week 3–4)
**Goal:** One screen recording that makes people say "I want this."

- [ ] Chrome Extension sending URLs + page titles to FastAPI
- [ ] Gemini Flash classifying every event (work / research / personal / system)
- [ ] Session generator: every 30 min, batch events → Claude → human-readable summary stored
- [ ] Tantivy index built from events
- [ ] Qdrant populated with sentence-transformer embeddings
- [ ] **One search box** — natural language → parallel Tantivy + Qdrant → Claude synthesises → structured answer
- [ ] Minimal UI: scrollable timeline + search input. No design polish. No animations.

**The test:**
User types: `"what was I working on before lunch yesterday?"`

Expected response:
```
📌 Yesterday, 12:45 PM — VS Code

Project: Resume Builder
File: template-editor.tsx
Task: Debugging mobile responsiveness

You had open:
  → Tailwind docs (responsive breakpoints)
  → ShadCN issue #1423
  → Figma (opened 3 times)

Last copied:
  "@media (max-width: 768px) { ... }"
```

**If this feels magical → you have a product. Move on.**
**If it doesn't → fix recall quality. Nothing else matters yet.**

---

### 🌐 PHASE 2 — Waitlist (Week 5–8)
**Goal:** Landing page live. 5 real beta testers.

- [ ] Landing page (Next.js): hero + 45-sec demo video + email capture
- [ ] Privacy controls: app exclude list, pause button, full memory wipe
- [ ] Memory viewer: user sees exactly what's stored, deletes anything
- [ ] In-app feedback (👍 / 👎 + text field)
- [ ] macOS `.dmg` installer (notarised via Apple Notary Service)
- [ ] tauri-plugin-updater wired to GitHub Releases
- [ ] 5 beta testers from LinkedIn (the people who commented are warm leads)

---

### 🧠 PHASE 3 — Session Intelligence (Week 9–12)
**Goal:** App feels smart. 20 beta users. Tier 2 + 3 memory working.

- [ ] Tier 2 auto-sessions with project detection + goal inference
- [ ] Tier 3 memory objects — long-term knowledge extracted by Claude
- [ ] "Continue" button — one click reopens files/tabs from last session
- [ ] Daily digest — optional morning summary pushed via macOS notification
- [ ] Proper macOS permissions onboarding (Accessibility, Screen Recording, Microphone)
- [ ] 20 beta users in a feedback group (Slack or WhatsApp)

**macOS permissions required by this phase:**
```
Accessibility      → active window tracking via Accessibility API
Screen Recording   → screenshots (when added)
Microphone         → voice input (Phase 4)
```

---

### 🫧 PHASE 4 — Companion Layer (Month 4–5)
**Goal:** The HeyClicky moment. Voice + orb. Now it's earned.

#### Overlay Window (Clicky architecture applied in Tauri)
- [ ] Transparent, always-on-top Tauri window — spans full screen
- [ ] `set_ignore_cursor_events(true)` — fully click-through
- [ ] React renders the orb at absolute position over everything
- [ ] Never steals focus (`focus: false` in window config)

#### The `[POINT:x,y]` Tag System (direct from Clicky)
Claude is prompted to embed coordinate tags when referencing UI elements:
```
System prompt addition:
"When referring to something visible on screen, embed a pointer tag:
[POINT:x,y:label] where x,y are screen coordinates (0,0 = top-left).
Example: [POINT:245,380:Save button]"
```
Rust parses these tags from Claude's response and moves the orb to that position via a bezier arc animation. **This is the cursor buddy effect.**

#### Voice Pipeline
```
Hold hotkey (global-hotkey crate)
  → Whisper.cpp transcribes audio (local)
  → same recall pipeline as text query
  → Kokoro TTS speaks the response
  → orb animates while speaking
  
Fallback:
  → Apple Speech (if Whisper fails)
```

#### Personality
- Orb has idle / listening / thinking / speaking states (Framer Motion)
- Responses in companion tone: "Yeah, you were deep in the ResumBuilder thing — looked like you were stuck on mobile layout."
- Remembers user's name and common projects

---

### 🚀 PHASE 5 — Public Beta (Month 6)
**Goal:** Open beta, first revenue.

- [ ] PostHog analytics wired (what users search, session frequency, recall success rate)
- [ ] Sentry crash reporting
- [ ] Lemon Squeezy payments
- [ ] Supabase cloud sync (opt-in, encrypted)
- [ ] Onboarding email sequence (3 emails: welcome → tips → feedback ask)

**Pricing:**
```
Free:      7 days memory, text search only
Pro $7/mo: Unlimited memory, voice, session detection, Tier 3 memory, cloud sync
```

---

### 🏆 PHASE 6 — Full Launch (Month 8–10)
- Product Hunt launch (prepare 4 weeks ahead)
- Show HN post
- Referral system
- Windows support (Tauri makes this largely portable)
- Press outreach

---

## 🔐 Privacy Design

1. **Local-first** — all data on device by default, always
2. **Cloudflare Worker** — API keys never in app binary, never exposed to user's machine
3. **Exclude list** — banking, password managers, anything sensitive, never captured
4. **Encrypted at rest** — SQLite + filesystem encryption
5. **One-click wipe** — full memory delete from UI, no recovery
6. **Cloud sync is opt-in** — off by default, user-controlled
7. **Whisper.cpp for voice** — audio never leaves the device

---

## ✅ First 48 Hours

```bash
# 1. Scaffold Tauri + React
npm create tauri-app@latest orbit -- --template react-ts

# 2. Set LSUIElement in src-tauri/Info.plist
<key>LSUIElement</key><true/>

# 3. FastAPI skeleton
cd backend && python -m venv venv
pip install fastapi uvicorn sqlalchemy anthropic

# 4. Deploy Cloudflare Worker
# worker/src/index.ts → proxy to Claude API
npx wrangler deploy

# 5. Add arboard to Cargo.toml
# Write clipboard listener → first event in SQLite
```

**Hour 1–4:** Tauri running, no dock icon, FastAPI connected
**Hour 5–8:** Clipboard events in SQLite via Rust
**Hour 9–12:** Claude query returning an answer via Cloudflare Worker

---

## 🔑 Core Principles
1. **Local-first always** — data never leaves without explicit user action
2. **Zero setup** — works the moment it's installed
3. **Invisible until needed** — silent capture, appears only when called
4. **Earn each layer** — prove recall before building the companion
5. **API keys never in binary** — Cloudflare Worker handles all external calls
6. **One connection pool** — never create/destroy HTTP clients per request

---
*Tauri confirmed. Clicky insights applied. macOS first, Windows-ready later.*
*Orbit — by Saadaan Hassan 🪐*