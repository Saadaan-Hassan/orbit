# Orbit Architecture

This is the external-facing architecture reference — trust boundaries, data
flow, and where to look for more detail. `AGENTS.md` at the repo root is the
canonical, most-detailed reference (file-by-file responsibilities, exact
schemas, every implementation constant) and is kept current as the code
changes; this document is the higher-level map that points into it, plus the
things a security reviewer or new contributor would ask first. See
[`THREAT_MODEL.md`](THREAT_MODEL.md) for what's defended against and
[`PRIVACY_DATA_FLOW.md`](PRIVACY_DATA_FLOW.md) for exactly what data moves
where.

## What Orbit is

A macOS menu-bar app that passively captures activity (active app/window,
clipboard, browser URLs, on-screen text, file activity, system state),
turns it into local searchable memory, and answers natural-language recall
queries about it. Everything runs on the user's own Mac. Cloud AI (Groq for
summaries/recall, Voyage AI for semantic search) is entirely optional,
bring-your-own-key, and called directly from the user's machine to the
provider — **no maintainer-run server of any kind sits in between, and none
exists for this project at all.**

## Distribution model

Source-only, self-build. Anyone who wants to run Orbit clones this repo and
builds it themselves (`pnpm tauri dev` or `pnpm tauri build`) — see the root
[`README.md`](../README.md). There is no packaged release, no auto-updater,
no companion release repository, and no Chrome Web Store listing. This
matters for the threat model: a released-binary supply chain (build server
compromise, signing key theft, update-channel hijack) simply isn't a
category of risk here, because that pipeline doesn't exist. See `AGENTS.md`'s
`Distribution` section for the full reasoning, and `OPEN_SOURCE_ROADMAP.md`'s
`ADR-000` ("Accepted target architecture") and its 2026-09-26 update note
for the decision record.

## Trust boundaries

Each layer below is a distinct trust boundary — code in one layer should
never assume code in another has already validated something for it.

```mermaid
flowchart TB
    subgraph L1["① Hostile input — untrusted"]
        direction LR
        WEB["Web pages"]
        CLIP["Clipboard"]
        SCREEN["On-screen text"]
        FILES["File paths"]
    end

    subgraph L2["② Rust capture layer — full OS privilege, sanitizes before every write"]
        direction LR
        R1["clipboard.rs"]
        R2["unified_poller.rs"]
        R3["file_activity.rs"]
        R4["system_state.rs"]
        R5["screen_content.rs"]
    end

    subgraph L3["③ Chrome extension — browser sandbox, lowest privilege"]
        EXT["background.ts / content.ts"]
    end

    subgraph L4["④ Local storage — owner-only file permissions, unencrypted at the app level"]
        direction LR
        SQLITE[("SQLite + FTS5")]
        QDRANT[("Qdrant, local file")]
    end

    subgraph L5["⑤ FastAPI backend — 127.0.0.1:47821 only, bearer-token auth"]
        direction LR
        CAP["/capture"]
        REC["/recall"]
        OTHER["/privacy /settings<br/>/timeline /projects"]
    end

    UI["React UI (Tauri webview)"]

    subgraph L6["⑥ AI providers — external network, opt-in, BYOK-direct"]
        direction LR
        GROQ["Groq API<br/>chat / summaries / recall"]
        VOYAGE["Voyage AI<br/>embeddings"]
    end

    subgraph L7["⑦ Landing site — fully static, no backend, unrelated to the app at runtime"]
        LANDING["Next.js static export"]
    end

    WEB --> L2
    CLIP --> L2
    SCREEN --> L2
    FILES --> L2
    L2 -->|"sanitize, then INSERT"| SQLITE
    EXT -->|"paired, capture-only<br/>bearer token"| CAP
    CAP --> SQLITE
    UI -->|"per-session bearer token"| L5
    L5 -->|"JSON / SSE"| UI
    L5 --> SQLITE
    L5 --> QDRANT
    L5 -.->|"user's own key, direct<br/>HTTPS, fully optional"| GROQ
    L5 -.->|"user's own key, direct<br/>HTTPS, fully optional"| VOYAGE

    style L6 stroke-dasharray: 5 5
    style L7 stroke-dasharray: 5 5
```

1. **Hostile input surface** — web pages the user visits, clipboard content,
   on-screen text, file names. None of this is trusted. Sanitization happens
   here, before anything is written to disk.
2. **Rust capture layer** (full OS access, highest privilege) —
   `clipboard.rs`, `unified_poller.rs`, `file_activity.rs`,
   `system_state.rs`, `screen_content.rs` — writes directly to SQLite. Runs
   with whatever OS permissions the user has granted (Accessibility,
   Automation). Every writer sanitizes before `INSERT` (ADR-003) and is
   gated on per-category consent (`PRIV-*`).
3. **Chrome extension** (browser sandbox, lowest privilege) — runs inside
   Chrome's extension sandbox, not the OS. Can only reach the backend via a
   paired, capture-only bearer token scoped to exactly one route
   (`/capture`) — never the app's own session token. See ADR-001 (local API
   auth) and SEC-004.
4. **Local storage** (SQLite + FTS5 + Qdrant, all on-disk, unencrypted at the
   app level — relies on FileVault for disk encryption) — `~/.orbit/`,
   owner-only file permissions (0600/0700, ADR-004). No network exposure of
   any kind — nothing outside this Mac can reach it directly.
5. **FastAPI backend** (loopback-only, authenticated) — binds
   `127.0.0.1:47821` only. Every route requires a per-session bearer token
   generated fresh by Rust at launch, validated against exact Host/Origin —
   see ADR-001, SEC-002/003.
6. **AI providers** (external network boundary, opt-in) — Groq
   (chat/summaries/recall) and Voyage AI (embeddings), called directly with
   the user's own key — BYOK, no maintainer infrastructure. Only
   already-redacted content is ever sent. With no personal key, this
   boundary is never crossed at all.
7. **Landing site** (fully static, no backend) — Next.js static export. No
   database, no email service, no waitlist, no server-side code of any kind
   (SITE-001).

## Monorepo layout

Four independent workspaces — see `AGENTS.md`'s `Monorepo Structure` for the
full file-by-file tree:

| Workspace | What it is | Trust boundary above |
|---|---|---|
| `app/` | Tauri v2 desktop app: React frontend + Rust backend (capture, IPC, sidecar management) | 1, 2, 5 |
| `backend/` | FastAPI (Python) — recall, session generation, provider calls, local API auth | 5, 6 |
| `extension/` | Chrome extension (Manifest V3), optional richer browser capture | 3 |
| `landing/` | Static Next.js marketing site | 7 |

## Application workflows

Three things happen while Orbit runs: capture (continuous), background
session generation (every 30 minutes), and recall (on demand, when the user
asks a question). Each is a fully separate pipeline — a failure or missing
key in one never blocks the others.

### 1. Capture — from the OS/browser to SQLite

```mermaid
flowchart TD
    subgraph SOURCES["Capture sources — Rust, 500 ms to 8 s polling depending on source"]
        direction LR
        S1["Clipboard"]
        S2["Active window / app<br/>lifecycle / browser tab URL"]
        S3["Watched folder<br/>file activity"]
        S4["Screen lock / unlock,<br/>sleep / wake"]
        S5["Focused on-screen text<br/>(AXUIElement)"]
    end

    S1 --> R1{"Matches a secret pattern?<br/>(API key, JWT, credit card,<br/>SSN, PEM key, crypto address)"}
    R1 -->|yes| R2["Replace with<br/>[REDACTED:type]"]
    R1 -->|no| R3["Keep as-is"]

    S5 --> P1{"AXSecureTextField —<br/>a password field?"}
    P1 -->|yes| P2["Never read, at any<br/>traversal depth"]
    P1 -->|no| P3["Read, capped at<br/>1,500 characters"]

    S3 --> F1["Store path + action only —<br/>file contents never read"]

    R2 --> DB
    R3 --> DB
    S2 --> DB
    S4 --> DB
    F1 --> DB
    P3 --> DB
    DB[("SQLite events table")]

    EXT["Chrome extension:<br/>page content, search query,<br/>link click"] --> ER1["Redact sensitive patterns —<br/>same rule set as clipboard"]
    ER1 --> ER2["POST /capture<br/>(paired, capture-only token)"]
    ER2 --> DB
```

Every source above is independently gated on per-category consent and the
global pause switch — nothing here runs before the user has explicitly
granted it (`PRIV-002`). Native capture (everything except the extension)
writes to SQLite directly from Rust; the extension is the only capture path
that goes over HTTP, and only to the one authenticated `/capture` route.

### 2. Background session generation — every 30 minutes

```mermaid
flowchart TD
    START(["Scheduler wakes<br/>every 30 minutes"]) --> FETCH["Fetch unread events<br/>(last 60 min, plus anything<br/>stale over 2 hours)"]
    FETCH --> SPLIT["Split into batches at<br/>system lock/sleep boundaries"]
    SPLIT --> LOOP["For each content batch"]

    LOOP --> CLASSIFY{"Groq key<br/>configured?"}
    CLASSIFY -->|yes| C1["Classify events — gpt-oss-20b:<br/>work / research / personal /<br/>system / communication"]
    CLASSIFY -->|no| C2["Default category: work"]
    C1 --> FUSE
    C2 --> FUSE

    FUSE["Fuse signals into labelled,<br/>chronological text lines"] --> SUMMARY{"Groq key<br/>configured?"}
    SUMMARY -->|no| FAIL["Mark batch 'parse_failed' —<br/>retried later, ≤20 events/cycle.<br/>No session exists yet."]
    SUMMARY -->|yes| GEN["Generate session summary —<br/>gpt-oss-120b: goal, activity,<br/>next_step, blockers, topics"]

    GEN --> SAVE[("INSERT INTO sessions")]
    SAVE --> EMBED{"Voyage key<br/>configured?"}
    EMBED -->|no| SKIP["embedding_id = NULL —<br/>semantic search has nothing to<br/>search yet. Not an error."]
    EMBED -->|yes| VEC["Embed session —<br/>voyage-3-lite, 512 dimensions"]
    VEC --> QDRANT[("Qdrant upsert")]
```

Without a Groq key, raw events still accumulate and are still fully
searchable via FTS5 keyword search — but no session summaries, Timeline
entries, or Project Cards are ever produced, since all three read from the
`sessions` table, not raw events. This is the one place a missing key
changes what the app can show, not just how it answers a question.

### 3. Recall — answering a user's question

```mermaid
flowchart TD
    Q(["User asks a question"]) --> TIME["Parse time reference —<br/>'yesterday', 'this morning', etc."]
    TIME --> INTENT["Classify intent:<br/>work / personal / general"]
    INTENT --> FTS["SQLite FTS5 keyword search —<br/>always runs, fully offline,<br/>up to 15 events"]

    FTS --> RANGECHECK{"Time range<br/>detected?"}
    RANGECHECK -->|yes| DBSCAN["Best session per project<br/>within that window (DB scan)"]
    RANGECHECK -->|no| VOYAGECHECK{"Voyage key configured<br/>and reachable?"}
    VOYAGECHECK -->|yes| SEMANTIC["Qdrant semantic search,<br/>re-ranked by similarity + recency"]
    VOYAGECHECK -->|no| EMPTYSESS["No sessions retrieved —<br/>a soft-fail, not an error"]

    DBSCAN --> FILL["Fill remaining slots, up to 12,<br/>with Qdrant results if any"]
    SEMANTIC --> CONTEXT
    EMPTYSESS --> CONTEXT
    FILL --> CONTEXT

    CONTEXT["Build context block:<br/>FTS5 events + sessions +<br/>last 4 conversation turns"] --> GROQCHECK{"Groq key configured<br/>and reachable?"}
    GROQCHECK -->|yes| SYNTH["Groq (gpt-oss-120b) streams a<br/>synthesized answer over SSE"]
    GROQCHECK -->|no| OFFLINE["Stream the FTS5 results as a<br/>plain offline message —<br/>no AI synthesis"]

    SYNTH --> UI(["Answer rendered<br/>token by token in the UI"])
    OFFLINE --> UI
```

Two independent fallback tiers, by design (`ADR-006`): a missing or
unreachable Voyage key only removes semantic search — Groq still
synthesizes an answer from FTS5 and any DB-scanned sessions. Only a
Groq-side failure (no key, network down, rate-limited) drops all the way to
the plain-text offline message, since that's the only step that actually
requires the network. A `work`-intent query additionally excludes
`category = 'personal'` events from the FTS5 results; `personal` and
`general` queries see everything.

## Further reading

- [`THREAT_MODEL.md`](THREAT_MODEL.md) — what's defended against, and what
  isn't
- [`PRIVACY_DATA_FLOW.md`](PRIVACY_DATA_FLOW.md) — every captured field,
  where it's sanitized, what (if anything) leaves the device
- `docs/adr/` — one ADR per material architecture decision (local API auth,
  versioned consent, Rust sanitization, canonical exclusions/Keychain
  storage, Tauri shell hardening, lazy semantic search, telemetry removal)
- Root `AGENTS.md` — the canonical, exhaustive reference this document
  summarizes; read it before making any architectural change
- `OPEN_SOURCE_ROADMAP.md` — the audit trail for how this project reached
  its current security/privacy posture, including decisions that
  superseded earlier ones (e.g., the 2026-09-26 pivot to source-only
  distribution)
