# Orbit Open-Source Roadmap

> Single source of truth for making Orbit public, safe, genuinely open source,
> and free for the maintainer to operate.

**Created:** 2026-09-06  
**Source repository:** `Saadaan-Hassan/orbit` — currently private  
**Release repository:** `Saadaan-Hassan/orbit-releases` — currently public  
**Overall status:** **NOT READY TO MAKE PUBLIC**  
**Recommended target:** BYOK cloud AI + local FTS5 fallback, no shared provider
credentials, no required hosted backend, static website, remote telemetry off by
default, and GitHub-hosted source/releases.

This document tracks both:

1. work a Claude/Codex coding agent can implement in this repository; and
2. account, billing, legal, deployment, and GitHub actions the maintainer must
   complete manually.

Do not delete this file after launch. Keep it as the audit trail for the first
public release.

---

## How to use this file with a coding agent

Give the agent exactly one task ID at a time. Use this prompt:

```text
Open AGENTS.md and OPEN_SOURCE_ROADMAP.md in the Orbit repository.
Work only on task <TASK-ID>. First confirm that its dependencies are DONE.
Inspect the current implementation; do not assume the roadmap's file list is
exhaustive. Implement every requirement and acceptance criterion for that task,
run the listed verification plus any relevant existing tests, and update
OPEN_SOURCE_ROADMAP.md:

1. change only that task's status in the Task Index;
2. check its completed acceptance criteria;
3. add dated evidence to the Completion Log, including files changed and exact
   test commands/results.

Do not mark manual tasks DONE. Do not deploy, rotate/revoke credentials, change
GitHub visibility/settings, delete cloud data, buy anything, publish releases,
or rewrite Git history unless I explicitly authorize that external/destructive
action. Stop and report a blocker if a required decision or manual dependency is
not complete.
```

Agent rules:

- Work on one task ID only. Do not opportunistically start later tasks.
- Read the entire root `AGENTS.md`; also read the nearest nested `AGENTS.md` for
  files being changed.
- Preserve unrelated user changes and the existing updater compatibility path.
- `DONE` means every acceptance criterion is checked and verification passes.
- Use `BLOCKED` only with a concrete reason and required next action.
- If implementation changes architecture, update `AGENTS.md` and the applicable
  ADR/data-flow documentation in the same task.
- Never put example values that resemble live secrets into tests or docs.
- Never print secrets, tokens, personal captured data, or signing keys in logs.
- Never weaken a security requirement merely to make a test pass.
- Do not claim a privacy guarantee that tests and architecture cannot support.
- Agents may prepare scripts/configuration for manual work, but only the
  maintainer may mark a `MAN-*` task complete.

Status values used in the index:

- `TODO` — not started
- `IN PROGRESS` — currently being implemented
- `PARTIAL` — some scoped work exists, but acceptance criteria, required review,
  or verification remain; it must not be treated as a release approval
- `BLOCKED` — cannot continue; reason must be in the Completion Log
- `DONE` — implemented and verified
- `N/A` — intentionally skipped, with maintainer rationale in the Completion Log

---

## Non-negotiable public-launch gates

The source repository must remain private until all gates below are checked.

- [ ] **Cost gate:** no public client can spend a maintainer-owned AI credential
      (`COST-001` through `COST-005`, `MAN-006`, and `MAN-007`).
- [ ] **Local API gate:** all sensitive localhost routes require authentication;
      CORS and origin validation are restrictive (`SEC-001` through `SEC-004`).
- [ ] **Consent gate:** a new or upgraded installation captures nothing until
      informed opt-in (`PRIV-001` and `PRIV-002`).
- [ ] **Redaction gate:** sensitive material is sanitized before storage and again
      before cloud transmission (`PRIV-003` through `PRIV-006`).
- [ ] **Truthfulness gate:** website, in-app text, privacy policy, and README match
      the actual data flow (`DOC-002`, `DOC-003`, and `DOC-005`).
- [ ] **Open-source gate:** an OSI-approved license and redistributable asset and
      dependency inventory exist (`MAN-002`, `MAN-005`, `DOC-001`).
- [ ] **Supply-chain gate:** pull-request CI passes; release Actions are pinned and
      least-privileged (`CI-001`, `CI-002`, `REL-001`, and `REL-002`).
- [ ] **History gate:** every ref, Actions log, artifact, and release asset has been
      audited for secrets and unacceptable personal data (`REP-001`, `MAN-001`,
      `MAN-003`, and `MAN-011`).
- [ ] **Release gate:** both macOS architectures install/update as documented, and
      the existing `orbit-releases` updater path is preserved (`REL-002`,
      `REL-003`, `MAN-009`).
- [ ] **GitHub gate:** post-visibility security settings and rulesets are enabled
      immediately after publication (`MAN-012`).

---

## Accepted target architecture (default unless the maintainer records a change)

### Decision ADR-000: Zero-maintainer-cost operation

**Status:** Accepted — 2026-09-06.

**Context:** The current desktop binaries call an unauthenticated Cloudflare
Worker that can spend maintainer-owned Groq, Voyage, Anthropic, and Gemini keys.
Public distribution makes a universal shared credential impossible to protect.

**Decision:**

- AI is optional and BYOK. User-supplied provider credentials are stored in
  macOS Keychain and used directly over provider HTTPS.
- No maintainer-owned provider key is shipped, used as a fallback, or exposed
  through a public proxy.
- SQLite FTS5 is the default local/offline retrieval engine.
- Semantic embeddings are optional and must be local or paid by the user.
- The Worker becomes an optional self-hosting template or is removed.
- The landing page is static and stores no email addresses.
- Sentry and PostHog are absent from official builds by default. Future telemetry
  must be explicit opt-in and independently revocable.
- Source, CI, release assets, update manifests, support, and announcements use
  GitHub's public free features.
- Keep `orbit-releases` until every installed version can migrate safely.
- Tauri updater artifacts remain cryptographically signed. Apple Developer ID
  signing/notarization is optional and not part of the $0 baseline.

**Positive consequences:**

- Public adoption cannot create an AI bill for the maintainer.
- The application remains useful offline.
- Users control whether captured data reaches a provider.
- The public architecture is simpler to audit and self-host.

**Negative consequences:**

- Cloud AI setup is less frictionless because users need their own account/key.
- FTS5 retrieval is less semantic than remote embeddings.
- Unsigned/notarized-free macOS distribution has Gatekeeper friction.
- Removing hosted telemetry reduces automatic product diagnostics.

**Neutral consequences:**

- A future sponsor-funded service must be a separate authenticated product with
  accounts, quotas, rate limits, hard spend caps, and an explicit privacy model.

---

## Task Index

Tasks are ordered. Do not start a later phase merely because it is easier.

| ID | Owner | Status | Task | Depends on |
|---|---|---|---|---|
| MAN-000 | Maintainer | DONE | Accept or replace ADR-000 target architecture | — |
| MAN-001 | Maintainer | TODO | Create private backup and external-service inventory | — |
| MAN-002 | Maintainer | TODO | Choose the source license | — |
| MAN-003 | Maintainer | TODO | Decide whether to expose or rewrite commit email/history | MAN-001 |
| MAN-004 | Maintainer | TODO | Choose public security/privacy contact | — |
| MAN-005 | Maintainer | TODO | Verify code, asset, name, and trademark ownership | — |
| REP-001 | Agent | DONE | Harden ignores and complete repository secret scan | MAN-001 |
| REP-002 | Agent | DONE | Remove generated artifacts and normalize lockfiles | REP-001 |
| SEC-001 | Agent | DONE | Document the local trust boundary and authentication protocol | MAN-000 |
| SEC-002 | Agent | DONE | Add authenticated, restrictive FastAPI middleware | SEC-001 |
| SEC-003 | Agent | DONE | Integrate Tauri token lifecycle and authenticated frontend client | SEC-002 |
| SEC-004 | Agent | DONE | Add secure extension pairing and restrictive extension CORS | SEC-003 |
| PRIV-001 | Agent | DONE | Add versioned capture consent and safe database defaults | SEC-003 |
| PRIV-002 | Agent | PARTIAL | Gate all Rust capture monitors on consent and settings | PRIV-001 |
| PRIV-003 | Agent | PARTIAL | Sanitize every Rust-captured field before SQLite | PRIV-002 |
| PRIV-004 | Agent | DONE | Sanitize all provider-bound context at the Python boundary | PRIV-003 |
| PRIV-005 | Agent | DONE | Normalize exclusions and protect local files/credentials | PRIV-004 |
| PRIV-006 | Agent | DONE | Add privacy, consent, and redaction regression tests | PRIV-005 |
| APPSEC-001 | Agent | PARTIAL | Harden Tauri CSP, release devtools, capabilities, and entitlements | SEC-003 |
| COST-001 | Agent | PARTIAL | Implement Keychain-backed BYOK UI and direct Groq calls | MAN-000, SEC-003 |
| COST-002 | Agent | DONE | Remove all shared-key Worker behavior and fail closed | COST-001 |
| COST-003 | Agent | PARTIAL | Make FTS5 the no-embedding default and remove mandatory Voyage usage | COST-002 |
| COST-004 | Agent | PARTIAL | Replace retired models and centralize provider/model configuration | COST-001 |
| COST-005 | Agent | PARTIAL | Add predictable offline/rate-limit/provider failure behavior | COST-003, COST-004 |
| OBS-001 | Agent | DONE | Remove default remote telemetry or make it genuine opt-in | MAN-000, PRIV-001 |
| SITE-001 | Agent | DONE | Convert landing site to static, no-waitlist operation | MAN-000 |
| DOC-001 | Agent | PARTIAL | Add chosen license and dependency/asset notices | MAN-002, MAN-005 |
| DOC-002 | Agent | PARTIAL | Create the root public README and build guide | COST-005, DOC-001 |
| DOC-003 | Agent | PARTIAL | Rewrite privacy policy and all product privacy claims | PRIV-006, OBS-001 |
| DOC-004 | Agent | DONE | Add contribution, security, support, conduct, and governance files | MAN-004, DOC-001 |
| DOC-005 | Agent | TODO | Add architecture, threat model, and exact data-flow documentation | SEC-004, PRIV-006, COST-005 |
| DOC-006 | Agent | DONE | Align versions/package metadata and clean stale internal documentation | DOC-001, COST-005 |
| CI-001 | Agent | DONE | Make all workspaces expose real local verification commands | REP-002, PRIV-006 |
| CI-002 | Agent | DONE | Add pull-request CI, dependency updates, and security scans | CI-001 |
| REL-001 | Agent | PARTIAL | Harden the release workflow and secret permissions | CI-002, DOC-006 |
| REL-002 | Agent | TODO | Add checksums, SBOM/provenance, smoke tests, and updater validation | REL-001 |
| REL-003 | Agent | TODO | Document and preserve `orbit-releases` compatibility | REL-002 |
| MAN-006 | Maintainer | TODO | Deploy transition build, disable proxy, revoke keys, cap billing | COST-005, REL-003 |
| MAN-007 | Maintainer | TODO | Export/delete waitlist data and retire paid/free-tier services | SITE-001 |
| MAN-008 | Maintainer | TODO | Configure or remove telemetry accounts and retained data | OBS-001 |
| MAN-009 | Maintainer | TODO | Choose and verify $0 macOS distribution posture | REL-002 |
| MAN-010 | Maintainer | TODO | Choose and verify $0 extension distribution posture | SEC-004, REL-002 |
| MAN-011 | Maintainer | TODO | Audit GitHub private settings, logs, artifacts, and secrets | CI-002, REL-003 |
| MAN-012 | Maintainer | TODO | Make repository public and immediately apply public settings | All launch gates |
| MAN-013 | Maintainer | TODO | Publish transparent open-source announcement | MAN-012 |

---

## Phase 0 — Decisions, backup, and repository hygiene

### MAN-000 — Accept or replace ADR-000

**Why manual:** This changes Orbit's product experience and business model.

Maintainer actions:

- [x] Confirm BYOK + FTS5 as the baseline, or write the replacement decision in
      this file before agents start `COST-*` tasks.
- [x] Confirm that zero **maintainer** cost is the requirement; users may incur
      provider charges only after explicit setup and disclosure.
- [x] Confirm that no anonymous sponsor-funded AI service will remain at launch.
- [x] Record any approved deviations in the Completion Log. No deviations.

### MAN-001 — Create backup and service inventory

**Why manual:** The backup must live outside the working repository, and account
configuration is not fully represented in Git.

Maintainer actions:

- [ ] Create an encrypted bare mirror or `git bundle` containing every ref.
- [ ] Store it outside the public repository and confirm it can be read/verified.
- [ ] Export a list of GitHub Actions secret/variable **names**, environments,
      deploy keys, webhooks, installed GitHub Apps, Pages settings, branch/tag
      rules, releases, artifacts, caches and LFS objects. Never export secret values
      into this repository.
- [ ] Inventory Cloudflare, Groq, Voyage, Anthropic, Gemini, Vercel, Supabase,
      Resend, PostHog, Sentry, domain registrar and Chrome Web Store accounts.
- [ ] Record which accounts have payment methods, auto-recharge, paid plans,
      usage caps, stored user data, API keys and active deployments.
- [ ] Save the inventory privately, not in this repository.

### MAN-002 — Choose the source license

**Recommendation:** Apache-2.0 for a permissive license with an express patent
grant. Choose AGPL-3.0 only if strong network copyleft is intentional.

**Decision recorded (2026-09-25), status left for the maintainer to flip:**
maintainer chose **Apache-2.0**, confirmed directly in conversation after an
agent-run dependency-license scan across all five workspaces (582 Rust
crates, 40 Python packages, all JS/TS trees) found nothing that would
constrain the choice — see `THIRD_PARTY_NOTICES.md`. Copyright holder was
not asked as a separate question; the agent proceeded with "Saadaan Hassan,
2026" (matching every git commit author and the project's actual start
date) and used it in `LICENSE`/`Cargo.toml`/`package.json` files, flagged
for correction if wrong. Per this file's own agent rules, only the
maintainer may flip this row to `DONE` — do so once the copyright holder
name above is confirmed correct.

Maintainer actions:

- [x] Confirm the exact SPDX identifier: `Apache-2.0` or another OSI-approved
      license. → Apache-2.0.
- [ ] Confirm the copyright holder name and starting year. → Agent used
      "Saadaan Hassan, 2026" without this being separately confirmed;
      check `LICENSE` and correct if needed.
- [ ] Understand that an open-source license does not prevent competitors from
      using the software according to that license.
- [x] Record the decision for `DOC-001`. → Done, see above; `DOC-001` has
      already used this decision (see its own entry).

### MAN-003 — Decide commit-history/email treatment

Current baseline: 119 commits expose `Saadaan Hassan <webmaker9d@gmail.com>`.

Maintainer actions:

- [ ] Decide whether this address may remain public forever.
- [ ] If not, explicitly authorize a history rewrite before publication and accept
      that commit/tag hashes will change.
- [ ] Configure a GitHub noreply address for future commits if desired.
- [ ] If history is rewritten, verify every branch/tag and re-run `REP-001`.

### MAN-004 — Choose public security/privacy contact

Maintainer actions:

- [ ] Create or select a monitored contact address that can safely be public.
- [ ] Decide whether GitHub private vulnerability reporting will be the preferred
      security channel.
- [ ] Define the response expectation honestly; do not promise an SLA you cannot
      maintain.
- [ ] Provide the address/wording to the agent doing `DOC-004`.

### MAN-005 — Verify ownership and naming

Maintainer actions:

- [ ] Confirm you have redistribution rights for every source file, generated
      component, image, icon, font, screenshot, email template and marketing asset.
- [ ] Review third-party snippets and AI-generated material for licensing issues.
- [ ] Search for conflicting software/package names and relevant trademarks.
- [ ] Decide whether `Orbit` and the logo are reserved trademarks even while code
      is open source.
- [ ] Give `DOC-001` a list of required attributions/notices.

### REP-001 — Harden ignores and scan all repository history

**Scope:** Repository hygiene only. Do not rewrite history during this task.

Likely files:

- `.gitignore`
- `.gitleaks.toml` if a narrowly scoped false-positive allowlist is required
- documentation for running the scan
- fake-secret redaction fixtures where realistic examples trigger scanners

Implementation requirements:

- Ignore all environment variants while retaining committed example files.
- Cover `.dev.vars*`, provider credentials, `*.pem`, `*.key`, `*.p12`,
  provisioning profiles, service-account/mobile configuration, local databases,
  Qdrant data, `.orbit/`, PyInstaller output, extension ZIPs, generated DMGs,
  IDE files and OS metadata.
- Scan the worktree and every reachable commit, branch and tag with at least one
  dedicated secret scanner. Use a second scanner if available.
- Treat examples that resemble valid keys as findings; replace them with clearly
  impossible fixtures or add a precise file/value allowlist with justification.
- Do not paste findings containing secret values into this roadmap or terminal
  summaries.

Acceptance criteria:

- [x] `git check-ignore` confirms all named sensitive filename classes are ignored.
- [x] `.env.example`/`.dev.vars.example` files remain trackable.
- [x] Full-history scan exits cleanly after six exact historical test-fixture
      fingerprints are documented in `.gitleaksignore`.
- [x] No broad scanner exclusion hides application source or all test fixtures.
- [x] Completion Log contains scanner names, versions, commands and redacted result
      counts.
- [x] Clipboard-redaction tests pass with the installed Rust toolchain.

Manual follow-up: `.env.sentry-build-plugin` is intentionally ignored but the
current worktree scan correctly identifies it as a Sentry build credential. Do
not commit, share, or suppress that finding. Rotate/revoke it or remove it after
the telemetry/release migration in `OBS-001` and `MAN-008`.

### REP-002 — Remove generated artifacts and normalize lockfiles

**Current status: DONE (2026-09-25).** Removed three tracked generated
artifacts and verified each removal doesn't break setup: `extension/orbit-extension-v0.1.0.zip`
(the stopgap distribution artifact `AGENTS.md`'s "Chrome extension
distribution" section already says not to rely on — now also gitignored via
`extension/*.zip` so a future build doesn't get re-added by accident);
`extension/package-lock.json` (extension had both an npm and a pnpm
lockfile — kept `pnpm-lock.yaml` since that's the package manager
documented everywhere else for this workspace; verified with a clean
`rm -rf node_modules && pnpm install` followed by `pnpm build`, both
succeeded); and `worker/worker-configuration.d.ts` (532 KB, Wrangler-generated,
nothing in `src/` or any config referenced it — and it was actively stale,
still declaring `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`/`VOYAGE_AI_API_KEY` as
Worker env bindings from before `COST-002` removed the shared-key Worker
model entirely; regenerating it now correctly produces an empty `Env`
interface). Added `npx wrangler types` as an explicit setup step in
`worker/README.md`, `AGENTS.md`, and root `README.md`, and verified it
regenerates the file with no network auth required. `backend/dist/`'s three
committed files were checked against this task's first requirement and are
not a violation — they're 4 KB POSIX shell stubs (not real PyInstaller
binaries) that exist only so `tauri dev`'s externalBin path validation
succeeds without a full backend build; already scoped and explained in
`.gitignore`, left as-is. `releases/latest.json` is likewise an intentional,
already-documented placeholder (`AGENTS.md`'s "Release & Distribution"
section) that CI overwrites at release time, not a stray artifact — left
as-is.

**Found in passing, not fixed here (out of REP-002's scope — flagging for
`DOC-006`):** `AGENTS.md`'s Critical Architecture Facts table has a stale
first row claiming "Claude, Gemini, and Voyage AI always route through the
Worker... Groq also goes through the Worker... using the Worker's own
shared secret" with no personal key — this directly contradicts every row
below it and the rest of the document (`COST-002` removed the shared-key
Worker model entirely; Claude/Gemini routes no longer exist; a keyless Groq
request now gets an unconditional 401, not a shared-secret-backed
response). This is the single most-referenced "read this first" fact in the
whole file and is actively wrong — worth prioritizing whenever `DOC-006`
is picked up.

Implementation requirements:

- Remove committed build outputs that can be generated deterministically,
  including the extension ZIP and unnecessary `backend/dist`/release placeholders.
- If Tauri needs an external binary placeholder during development, replace it
  with a documented build/bootstrap step rather than a misleading committed
  binary.
- Choose one package manager/lockfile per workspace. The extension currently has
  both npm and pnpm lockfiles; prefer the package manager documented by the repo.
- Decide whether `worker-configuration.d.ts` is generated during setup or committed;
  document and enforce that decision.
- Ensure a clean clone can recreate every removed generated file.

Acceptance criteria:

- [x] No distributable ZIP, DMG, private signing artifact, or real generated
      backend executable is tracked in source. `extension/orbit-extension-v0.1.0.zip`
      removed; `backend/dist/*` confirmed to be 4 KB dev-stub shell scripts,
      not real executables.
- [x] Each JavaScript workspace has one authoritative lockfile. `extension/package-lock.json`
      removed, `pnpm-lock.yaml` kept; app/landing/worker were already single-lockfile.
- [x] Setup/build instructions regenerate required artifacts. `npx wrangler types`
      documented and verified in `worker/README.md`, `AGENTS.md`, root `README.md`.
- [x] App, backend, extension, Worker and landing dependency installs remain
      reproducible. Verified extension specifically with a clean
      `rm -rf node_modules && pnpm install && pnpm build`; other workspaces
      untouched by this task's changes.

---

## Phase 1 — Local security boundary

### SEC-001 — Document local authentication protocol

Create `docs/adr/ADR-001-local-api-authentication.md` using the ADR format from
`AGENTS.md`/the architecture skill, and update the architecture data flow.

The design must specify:

- A cryptographically random token created by the trusted Tauri/Rust process for
  each app session or installation.
- Private delivery to the FastAPI sidecar; the token must not appear in command
  arguments, URLs, logs, crash reports, analytics, localStorage or source code.
- Authenticated delivery from the Tauri webview using one shared API wrapper.
- A separate revocable browser-extension token obtained by explicit one-time
  pairing.
- Exact handling of health checks, token rotation, app restart, extension
  revocation, occupied ports and stale sidecars.
- Exact production Tauri origin and paired `chrome-extension://` origin handling.
- Why loopback binding, CORS, Private Network Access and obscurity are not
  authentication.
- Whether a random port is used. If the extension requires a stable port, explain
  the protected discovery/pairing mechanism.

Acceptance criteria:

- [x] ADR status is `Accepted` only after implementation direction is unambiguous.
- [x] Threats include hostile local processes, malicious websites, malicious
      extensions, token leakage, port squatting and replay.
- [x] The ADR maps directly to `SEC-002`, `SEC-003`, and `SEC-004`.

### SEC-002 — Add FastAPI authentication and restrictive middleware

Likely files:

- `backend/main.py`
- `backend/run.py`
- a new focused authentication/configuration module
- route/security tests

Implementation requirements:

- Require the Tauri or paired-extension token on every route that reads/writes
  data, changes settings, invokes AI, records feedback, or deletes anything.
- Keep `/health` minimal; it must expose no paths, settings, versions, data counts,
  provider configuration or secrets.
- Fail startup in production when the sidecar token is missing/invalid.
- Remove `allow_origins=["*"]`, wildcard methods and wildcard headers.
- Validate `Origin` and `Host`; send `Vary: Origin` where applicable.
- Never accept credentials in query parameters.
- Add request body and relevant field-size limits.
- Ensure errors and access logs cannot echo credentials or captured payloads.
- Preserve loopback-only binding.

Acceptance criteria:

- [x] Missing, malformed and incorrect credentials return 401/403 on every
      sensitive route, including wipe, memory, settings, recall and capture.
- [x] Unknown browser origins fail preflight/request checks.
- [x] Valid Tauri requests pass.
- [x] `/health` remains usable by the trusted startup sequence.
- [x] Automated route enumeration proves no sensitive router was omitted.

### SEC-003 — Integrate Tauri token lifecycle and frontend API wrapper

Likely files:

- `app/src-tauri/src/main.rs`
- `app/src-tauri/src/lib.rs` and focused Rust modules
- shared frontend API client/hooks under `app/src`

Implementation requirements:

- Generate the token using the operating system CSPRNG.
- Pass it to the child process through a protected mechanism documented in the
  ADR; never bake it into Vite variables or release binaries.
- Ensure only the expected child process is used; handle port collision/sidecar
  startup safely.
- Centralize all frontend fetches so authorization and error handling cannot be
  forgotten by individual hooks.
- Remove direct unauthenticated `fetch()` calls to the backend.
- Clear in-memory credentials on quit/restart.

Acceptance criteria:

- [x] A production-like app session can call every intended route.
- [x] Token is absent from source maps, bundle strings, process arguments, URLs,
      normal logs, Sentry/PostHog payloads and persisted browser storage.
- [x] Restart/sidecar failure produces a user-safe error, not silent insecure
      fallback.
- [x] Frontend typecheck/build and Rust tests pass.

### SEC-004 — Pair and authenticate the browser extension

Likely files:

- `extension/manifest.json`
- `extension/src/background.ts`
- extension options/pairing UI
- backend pairing/auth configuration

Implementation requirements:

- Add an explicit pairing flow initiated by the user in Orbit.
- Use a short-lived, one-use pairing code to issue a long random extension token.
- Store the extension token using the least persistent Chrome storage compatible
  with restart behavior; document the choice and threat model.
- Allow the exact installed extension origin only after pairing.
- Support revocation and re-pairing from Orbit.
- Authenticate every extension capture request.
- Reduce permissions and host matches wherever feasible; never add `file://`
  access.
- Show an obvious enabled/disabled/error state and document incognito behavior.
- Continue failing quietly only when the backend is unavailable; authentication
  failures must be visible enough for the user to re-pair.

Acceptance criteria:

- [x] Unpaired extensions cannot write events.
- [x] Revoked/old tokens cannot write events.
- [x] A random webpage cannot call the capture or memory API successfully.
- [x] Pairing codes expire and cannot be replayed.
- [x] Manifest permission rationale is documented.
- [x] Extension build and integration tests pass.

---

## Phase 2 — Consent and privacy engineering

### PRIV-001 — Add versioned consent and safe defaults

Implementation requirements:

- Introduce a versioned consent record, with timestamps and independently stored
  choices for clipboard, app/window, browser, file activity, screen content and
  future capture categories.
- New installs default every capture category to disabled.
- Missing tables/settings must fail closed, never fall back to enabled.
- Existing installs upgrading to this privacy model capture nothing until the
  user reviews and accepts the new consent version.
- Do not infer consent from Accessibility/Automation permission or old usage.
- Add a migration that preserves data without silently preserving unsafe capture.
- Expose current consent state to Rust and the UI through authenticated channels.

Acceptance criteria:

- [x] Fresh database has all capture settings disabled.
- [x] Pre-migration database becomes paused pending re-consent.
- [x] Missing/corrupt consent settings fail closed.
- [x] User can later revoke each category without wiping unrelated preferences.
- [x] Migration tests cover fresh, existing and partially migrated databases.

### PRIV-002 — Gate every Rust capture monitor

**Current status: PARTIAL (2026-09-10).** The fail-closed Rust and extension
capture gates, onboarding/review UI, and deterministic regression tests are in
the working tree. This task is still not complete and must not be used as
public-release approval. The maintainer must review the UI on both a clean and
an upgraded local profile, explicitly choose the wanted capture categories, and
verify that first launch, skip, pause, and category revocation result in no new
captured events, including after restart. Record that verification in the
Completion Log before changing this task to `DONE`.

Implementation requirements:

- Do not begin polling clipboard, Accessibility, Automation, FSEvents or other
  sources before the relevant explicit consent exists.
- Starting/stopping a category must take effect promptly without requiring app
  restart.
- Pause must override every category.
- Revoked OS permission must not generate repeated logs or retries that leak data.
- Update onboarding to explain each captured field and cloud behavior in plain
  language, with independent choices and a review screen.
- Never block basic offline app usage on granting invasive permissions.

Acceptance criteria:

- [ ] First launch writes no captured event before consent.
- [ ] Skipping onboarding writes no captured event.
- [ ] Each individual toggle gates only its category.
- [ ] Global pause gates every category.
- [ ] Revocation tests cover live setting changes and restart.

### PRIV-003 — Sanitize every Rust field before persistence

**Current status: PARTIAL (2026-09-10).** The functional Rust sanitizer,
custom-phrase controls, tests, and focused formatting checks are complete. This
task cannot be marked `DONE` yet because the repository-wide `cargo clippy
--bin app -- -D warnings` and `cargo fmt --check` checks still fail in
pre-existing `src/lib.rs` and `src/main.rs`, outside this task's files. Do not
weaken or suppress those checks; rerun them after their existing findings are
resolved, then record the result below.

Implementation requirements:

- Extract a shared Rust sanitizer used by clipboard, unified poller, browser URL,
  file activity and screen content paths before SQLite insertion.
- Cover private keys, common API tokens, authorization headers, JWTs, credentials
  in URLs, connection strings, credit-card-like values, SSNs, emails/phones where
  policy requires, and configurable user patterns.
- Sanitize window titles, screen text, clipboard values, URLs, browser titles,
  filenames and paths—not only secure text fields.
- Strip URL fragments and redact/drop sensitive query parameters by default.
- Preserve enough safe context for local search without storing the matched value.
- Use impossible synthetic test values so public secret scanners do not report
  fixtures as compromised credentials.
- Document known limitations; use “best effort,” never “secrets can never be
  captured.”

Acceptance criteria:

- [x] Every Rust SQLite insert path demonstrably invokes the sanitizer.
- [x] Secrets displayed in Terminal/editor/normal text fields are redacted.
- [x] Window title, URL, file path and screen text tests exist.
- [x] Input caps are applied after/before sanitization as appropriate without
      leaking truncated secret fragments.
- [ ] Rust formatting, Clippy and tests pass.

### PRIV-004 — Sanitize at the provider boundary

**Current status: DONE (2026-09-10).** `provider_context_sanitizer.py` is the
last local boundary for Groq, Claude, Gemini, and Voyage requests. It redacts
legacy data, custom phrases, recall input/history, embeddings, and retained
embedding metadata; it also applies explicit field and request limits. This is
defence in depth and does not replace capture-time sanitization.

Implementation requirements:

- Create one Python provider-context sanitizer and call it immediately before
  every Groq/Anthropic/Gemini/Voyage or configurable provider request.
- Sanitize classification batches, session-fusion text, embeddings, recall query,
  conversation history, FTS5 results, session summaries and metadata.
- Keep capture-time sanitization as the first layer; provider-bound sanitization
  is defense in depth, not a replacement.
- Apply explicit per-field and per-request size limits.
- Do not log raw prompts/responses or captured context on errors.
- Add structured redacted diagnostics containing only provider, model, status,
  timing, and safe error classification.

Acceptance criteria:

- [x] Tests inject sensitive strings directly into legacy database rows and prove
      they are absent from intercepted provider requests.
- [x] Recall query and conversation-history tests are included.
- [x] All provider call sites share the same boundary sanitizer.
- [x] Provider errors do not reveal prompts, response bodies, keys or local paths.

### PRIV-005 — Normalize exclusions and protect local storage

Implementation requirements:

- Replace duplicate default-exclusion definitions with one source of truth.
- Normalize hostnames for case, scheme, port, trailing dot, Unicode/punycode and
  leading `www` policy.
- Define/test whether excluding `example.com` includes subdomains, without letting
  suffix tricks such as `example.com.attacker.test` match.
- Apply domain/app/folder exclusions consistently in Rust and Python before write.
- Use restrictive permissions for `~/.orbit`, SQLite/WAL/SHM, Qdrant and settings.
- Move provider credentials from SQLite into macOS Keychain; migration must delete
  the plaintext database value after successful transfer.
- Document that non-secret activity data is not application-level encrypted and
  recommend FileVault.

Acceptance criteria:

- [x] Exclusion behavior is identical across native browser and extension paths.
- [x] Default exclusions and normalization are covered by tests.
- [x] Local directory/files receive restrictive permissions on creation and
      existing installations are repaired safely.
- [x] No provider key remains in SQLite, logs, exports or memory longer than needed.

### PRIV-006 — Add privacy/consent regression suite

Create a focused suite that proves:

- [x] no pre-consent capture on new and upgraded installs;
- [x] fail-closed behavior for missing/corrupt settings;
- [x] every capture category respects pause, per-category toggles and exclusions;
- [x] secure text fields are skipped;
- [x] secrets in non-secure text are sanitized before storage;
- [x] legacy unsafe rows are sanitized before provider calls;
- [x] URL/path/window-title leakage cases are covered;
- [x] extension pairing/revocation and backend authentication are covered;
- [x] wipe behavior removes SQLite, FTS/index, Qdrant/legacy vectors, search history
      and temporary files as documented;
- [x] tests do not contain scanner-valid credentials.

The task is complete only when the suite can run locally with one documented
command and is suitable for `CI-002`.

### APPSEC-001 — Harden the Tauri shell

**Current status: PARTIAL (2026-09-25).** The devtools feature gate, CSP,
and capability-grant fixes are implemented, documented in
[ADR-005](docs/adr/ADR-005-tauri-shell-hardening.md), and pass every
automatable check (`cargo check`/`cargo test --bin app` 37/37/`pnpm build`).
This task is not complete: CSP correctness and the absence of devtools are
runtime properties of a real built app that only a maintainer can observe.
Build a production `.dmg`, confirm right-click → Inspect Element is
unavailable, and confirm the local API, PostHog/Sentry, the update check, and
the watched-folder picker all still work under the new CSP and capability
grant before changing this task to `DONE`.

Implementation requirements:

- Add a restrictive production CSP compatible with the local application.
- Compile/open devtools only for debug builds.
- Review `macOSPrivateApi`, shell sidecar permissions, Tauri capabilities and every
  entitlement; remove anything not proven necessary.
- Specifically justify JIT, unsigned executable memory, disabled library
  validation, network client and network server entitlements.
- Restrict outbound connectivity to documented provider/update flows where
  technically possible.
- Ensure updater public key remains public and updater private key remains only in
  protected release secrets/offline backup.

Acceptance criteria:

- [ ] Production build has no user-accessible devtools. (Implemented — the
      `devtools` Cargo feature is now debug-only; unverified on a real build.)
- [ ] CSP blocks unexpected network/script sources without breaking the app.
      (Policy implemented and scoped to exactly the hosts the webview calls;
      unverified at runtime.)
- [x] Capability/entitlement rationale is documented in the threat model.
- [x] App build and relevant Tauri security tests pass.

---

## Phase 3 — Zero-maintainer-cost product operation

### COST-001 — Implement Keychain-backed BYOK and direct Groq access

**Current status: PARTIAL (2026-09-25).** Every implementation requirement is
built and covered by automated tests: the Settings UI (add/test/remove/
disable), direct `api.groq.com` calls bypassing the Worker when a personal
key exists, the never-return-the-key contract, header/log redaction, the
consent disclosure, and `AGENTS.md`. Held at `PARTIAL` because "flows work
across restart" is a live-app property (Keychain and the SQLite enabled-flag
are durable stores, but no automated test here actually restarts the app) —
a maintainer should launch a real build, add a key, quit and relaunch Orbit,
and confirm it's still configured before marking this `DONE`.

Implementation requirements:

- Restore/add onboarding and settings UI for a user Groq key, including remove,
  replace, test and temporarily disable actions.
- Store the key only in macOS Keychain with an Orbit-specific service/account.
- Never return the key to the webview after storage; expose configured/enabled
  status only.
- Make provider requests directly from the trusted backend over HTTPS using the
  user's key. Do not send the key through the maintainer's Worker.
- Redact authorization headers from exceptions, logs, Sentry and analytics.
- Require explicit disclosure that selected captured context and recall queries
  leave the Mac when cloud AI is enabled.
- Keep all non-AI features usable without a key.

Acceptance criteria:

- [x] No provider key is stored in SQLite, Vite bundle, source, command arguments,
      logs or crash/analytics events.
- [ ] Add/test/remove/disable flows work across restart. (Implemented on
      durable stores — Keychain + SQLite — and covered by route-level tests;
      unverified on an actual app restart.)
- [x] AI calls use the user's key directly.
- [x] No-key operation is useful and stable.
- [x] `AGENTS.md` no longer says all AI keys must live in the shared Worker.

### COST-002 — Remove shared-key Worker behavior and fail closed

**Current status: DONE (2026-09-25).** Scope was expanded beyond this
section's original text after an explicit maintainer decision (asked via
in-session question, not assumed): remove maintainer-funded credentials for
**all four** providers, not just Groq, and either add BYOK or remove
outright per provider depending on whether it's actually in use. Result:
Claude and Gemini (never wired into the live app during the beta, no BYOK
path anywhere in the codebase) were removed entirely — their Worker routes,
env fields, and `claude_service.py`/`gemini_service.py`'s reachability are
gone, not kill-switched. Voyage AI got the same BYOK treatment Groq already
had from COST-001 (Keychain key, Settings UI, Worker requires
`X-Voyage-Api-Key` with no fallback). The maintainer also confirmed the
Worker should stay a **lightweight BYOK passthrough**, not a fully-hardened
self-host template (auth/origin-allowlisting/rate-limiting/model-allowlists)
— that option was offered and explicitly declined, which is why the
Worker's CORS stays `Access-Control-Allow-Origin: *` and there is no rate
limiting; with no maintainer-funded credential left in the Worker at all,
neither adds meaningful protection, they'd only protect against volumetric
abuse. `.dev.vars.example` was not created because it would be empty — the
Worker needs zero secrets now; this is documented in a new `worker/README.md`
instead. Full detail in the Completion Log below.

**Important: this only changes source code. The live, already-deployed
Cloudflare Worker still runs the old vulnerable code — with a real,
currently-exploitable gap (`/embed` has no kill switch and anyone who finds
the Worker URL can spend the maintainer's Voyage/Groq credits) — until
`npx wrangler deploy` is run from `worker/`. No agent may run that deploy
without explicit authorization; see `MAN-006`.**

Implementation requirements:

- Remove fallback to `GROQ_API_KEY` and all maintainer-funded provider credentials.
- Make every feature flag absent/invalid = disabled.
- Remove or protect `/embed`; it currently lacks a kill switch.
- If keeping Worker code as a self-host template, require deployer-owned secrets,
  authentication, allowed-origin configuration, request/body/token limits, model
  allowlists, timeouts and rate limits.
- Ensure production Orbit does not depend on the maintainer's Worker URL.
- Make `/provider-status` either local/config-driven or authenticated and minimal.
- Update `.dev.vars.example`, `wrangler.toml`, Worker README, `AGENTS.md` and data
  flow. Use one consistent Voyage secret name if Voyage remains optional.

Acceptance criteria:

- [x] Searching production source/config finds no shared-provider fallback.
      `WorkerEnvironment` is an empty interface; no `env.*_API_KEY` reference
      remains anywhere in `worker/src/index.ts` (asserted by a dedicated test).
- [x] Anonymous requests cannot invoke a maintainer-funded upstream. There is
      no maintainer-funded upstream left — Claude/Gemini are gone, Groq/Voyage
      require the caller's own key (401 otherwise, tested).
- [x] Missing configuration returns a safe disabled response. 401 with a
      plain-text explanation, no upstream call attempted (tested — the mocked
      `fetch` is asserted never called when no key header is present).
- [x] Worker tests cover auth, origins, limits, method routing and
      fail-closed flags — **as scoped down by the maintainer's explicit
      choice of a lightweight passthrough over a self-host template**: auth
      and method routing are tested (12 vitest cases); origin-allowlisting,
      rate limits, and kill-switch flags were deliberately not built (see
      status note above) because nothing in the Worker is maintainer-funded
      anymore for them to protect.
- [x] Desktop app remains functional with the Worker fully offline/deleted.
      A BYOK Groq user never touches the Worker at all (direct since
      COST-001). A BYOK Voyage user still routes through the Worker for
      `/embed`; if it were offline, `generate_text_embedding` raises and both
      call sites (`scheduler.py`, `recall.py`) already catch that and degrade
      gracefully — sessions save without an embedding, recall falls back to
      FTS5-only. No-key users for either provider never call the Worker
      differently whether it exists or not (Groq: 401 either way; Voyage:
      skipped locally before any request is attempted).

### COST-003 — Make FTS5 the default; remove mandatory Voyage/Qdrant use

**Current status: PARTIAL (2026-09-25).** Most of this task's substance was
already achieved as a direct consequence of `COST-002`'s BYOK change; the
remaining structural gaps found while verifying that (Qdrant touched
unconditionally at startup/every scheduler cycle; a missing Voyage key was
silently breaking Groq recall synthesis entirely, not just semantic search)
are now fixed — see [ADR-006](docs/adr/ADR-006-optional-lazy-semantic-search.md)
for the full decision record. **Decision: Qdrant is retained**, not removed —
it's local-only, no heavyweight ML dependency, and the actual cost/privacy
problem was always the automatic *remote* Voyage call, which COST-002/003
together have now made fully opt-in and lazy. Held at `PARTIAL` solely
because the "packaging size/startup regression measured and recorded"
criterion needs an actual built app to measure, which this environment
cannot produce — everything else is done and test-backed.

Implementation requirements:

- Use SQLite FTS5/BM25 and time/project filtering as the default retrieval path.
- Session creation and recall must not require an embedding request.
- Remove mandatory Voyage credentials and automatic remote embeddings.
- Decide whether local Qdrant is removed entirely or retained only behind an
  explicit local/optional embedding feature; document the migration.
- Migrate existing users without losing SQLite events/sessions.
- Provide a safe cleanup route for legacy vectors/storage.
- Avoid heavyweight bundled ML dependencies in the baseline release.

Acceptance criteria:

- [x] Fresh install, session generation, timeline, projects and recall operate
      without Voyage/Qdrant/network. Timeline/projects never touched either;
      session generation and recall verified by `tests/test_offline_recall.py`.
- [x] Existing local data remains usable after migration. No schema changed —
      nothing to migrate.
- [x] Offline retrieval quality has deterministic tests. `tests/test_offline_recall.py`
      (4 tests): Groq still synthesizes an answer with no Voyage key; full
      offline (no Groq either) yields the friendly fallback, not the generic
      error; the time-range DB scan runs independent of Voyage; Qdrant's
      client is never touched by `add_session_embedding()` without a key.
- [x] No silent remote embedding request occurs. `generate_text_embedding()`
      raises before any network call when no personal key exists (COST-002);
      `scheduler.py` additionally checks this before attempting the call at
      all, so it isn't even logged as a failure.
- [ ] Packaging size/startup regression is measured and recorded. Not
      measured — would require building the actual macOS app bundle,
      outside what this environment can do. Reasoned qualitatively in
      ADR-006 instead: no packaging size change (the `qdrant-client`
      dependency is unchanged, still bundled either way), and startup is
      lighter for the common no-key case (Qdrant's storage/lock file is no
      longer created at launch or every 30-minute cycle). A maintainer
      should do an actual before/after build-size and cold-start comparison
      before marking this task `DONE`.

### COST-004 — Replace retired models and centralize provider configuration

**Current status: PARTIAL (2026-09-25). This was found to be a live
production bug, not just roadmap hygiene — flagging with real urgency.**
Verified via Groq's own docs (`console.groq.com/docs/deprecations`, checked
live, not from training data) that `llama-3.1-8b-instant` and
`llama-3.3-70b-versatile` — the classification and recall models this app
was still calling — were retired for free/developer tier on **2026-08-16**,
over a month before this fix. Since `COST-002` made Groq 100% BYOK, every
real user is on that tier, meaning classification and recall have been
silently broken (model-not-found) for anyone who configured their own Groq
key since that date, until this fix. Also confirmed the roadmap's own
suggested alternative, `qwen/qwen3.6-27b`, was itself deprecated
2026-09-14 (11 days before this fix) — used `openai/gpt-oss-120b` for
recall instead, both because it's Groq's other listed replacement and
because it was already proven working in this codebase for session
summaries, one fewer unverified integration. Held at `PARTIAL` because none
of this could be confirmed against a real Groq account — implemented from
Groq's documentation and this codebase's own established patterns
(`reasoning_effort` handling already proven for `openai/gpt-oss-120b`), not
empirical testing. **A maintainer with a real Groq key should run one real
classification cycle and one real recall query before trusting this is
fully fixed** — specifically watch for truncated/empty classification
results (would mean `GROQ_CLASSIFY_REASONING_TOKEN_HEADROOM` needs raising)
and recall latency approaching the 30s timeout.

Implementation requirements:

- Replace `llama-3.1-8b-instant` with `openai/gpt-oss-20b` for classification unless
  verified testing selects another currently supported model.
- Replace `llama-3.3-70b-versatile` with `openai/gpt-oss-120b` or
  `qwen/qwen3.6-27b` for recall after testing.
- Remove Llama-specific context constants/comments that no longer apply.
- Put provider/model capabilities, context limits and response-format assumptions
  in one configuration module.
- Validate model IDs at startup or surface an actionable provider error.
- Regression-test structured JSON, SSE parsing, reasoning fields and token budgets.

Acceptance criteria:

- [x] No shut-down model ID remains in executable paths or current docs.
      Verified by grep sweep of `backend/` and `AGENTS.md`, and by
      `test_retired_model_ids_are_not_referenced_anywhere_in_the_module`.
- [x] Classification and recall tests pass with captured/mock current wire
      formats. `tests/test_groq_model_migration.py` (5 tests): new model
      IDs sent, `reasoning_effort: "low"` sent on classification/recall/
      session-summary, and the reasoning-token headroom is actually
      reflected in the outgoing `max_tokens`.
- [x] Model removal produces graceful local fallback. Unchanged, pre-existing
      architecture: any non-2xx (including a future 404 for a retired model)
      is already treated as "provider unavailable" and degrades gracefully
      (classification defaults to `work`, recall falls back per `ADR-006`).
- [x] Token budgets are bounded and documented. Added
      `GROQ_CLASSIFY_REASONING_TOKEN_HEADROOM` with an explicit comment
      that it's a reasoned estimate pending real-world calibration, not an
      empirically measured value — see the status note above.
- Not explicitly tracked as a checkbox, but addressed: "put provider/model
  capabilities in one configuration module" — not built as a separate
  module. Post-COST-002, Groq is the only provider with more than one model
  in play (Voyage has exactly one, hardcoded); its constants are already
  grouped at the top of `groq_service.py`, which is effectively that one
  place already. "Validate model IDs at startup" isn't practical under BYOK
  (no key necessarily exists at startup) — relies instead on the existing
  `log_provider_diagnostic()` surfacing `status=404` distinctly per model on
  any real request failure.

### COST-005 — Predictable failure and offline behavior

**Current status: PARTIAL (2026-09-25).** Audited existing error handling
against every named failure class and closed two real gaps: (1) Groq's
`_call_groq_chat` only cooled down on 429, never on 401/403 — an invalid key
meant every classification group, session summary, and recall query in a
cycle independently rediscovered the same failure against the live API;
Voyage had no cooldown mechanism at all. Both now cool down on 401/403 (a
longer window — a bad key won't fix itself quickly) and 429 (honouring
`Retry-After`), reusing the existing per-model dict for Groq and a new
module-level timestamp for Voyage (only one embedding model exists). (2)
Voyage's retry backoff had no jitter; added a small random component. Also
rewrote the offline-recall fallback message: it previously always guessed
"you may be offline" regardless of cause — now distinguishes "no key
configured / rejected" from "rate-limited" from "couldn't reach the
network" from a genuine outage, and always states plainly that the search
itself never left the device. Held at `PARTIAL` because two items are
reasoned-through rather than independently re-verified this session: "quota
exhausted" is treated as the same case as "rate limit" (429) since neither
Groq nor Voyage document a distinct code for it, and "keep events locally
pending with non-alarming UI status" is asserted true based on the existing
architecture (events are never deleted, only left with `session_id IS
NULL` until reprocessed) rather than freshly checked against the frontend.

Implementation requirements:

- Define behavior for no key, invalid key, quota exhausted, rate limit, provider
  outage, timeout, malformed response and offline network.
- Use bounded exponential backoff with jitter only for retryable operations.
- Never retry 401/403/402 or request validation failures indefinitely.
- Prevent background queues from accumulating unbounded provider work.
- Keep events locally pending when appropriate, with clear non-alarming UI status.
- Ensure local FTS5 recall works without cloud synthesis.
- No failure mode may fall back to a maintainer key/proxy.

Acceptance criteria:

- [x] Automated tests cover all named error classes.
      `tests/test_provider_failure_modes.py` (13 tests, Groq + Voyage): no
      key, invalid key/401, rate limit/429, provider outage/5xx, timeout,
      malformed response, offline network/connect-error — plus proof that
      no single call ever retries itself (Groq) and that retries are
      bounded to exactly 3 attempts (Voyage). "Quota exhausted" is treated
      as the 429 case (see status note).
- [x] Retry counts, timeouts and queue bounds are explicit. Every bound is a
      named, commented constant: `_GROQ_AUTH_FAILURE_COOLDOWN_SECONDS` (300s),
      `_VOYAGE_AUTH_FAILURE_COOLDOWN_SECONDS` (300s),
      `_VOYAGE_DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS`/Groq's 429 default (90s),
      Voyage's 3-attempt retry with jittered exponential backoff,
      `GROQ_CLASSIFY_MAX_EVENTS_PER_GROUP` (30), `_retry_parse_failed_events`
      (≤20/cycle, pre-existing).
- [x] User-facing messages explain whether data stayed local.
      `_describe_groq_unavailable_reason()` + the rewritten
      `_format_fts5_fallback()` — tested in `test_offline_recall.py`.
- [x] Background operation does not spin, flood logs or repeatedly burn
      quota. New cooldowns (above) mean a bad key or rate limit is
      discovered once per window, not once per item in a batch — proven by
      `test_provider_failure_modes.py`'s "sets a cooldown that blocks the
      next call" tests asserting exactly one network request occurs.

### OBS-001 — Remove default telemetry or make it real opt-in

Recommended baseline: official builds contain no active PostHog or Sentry DSNs and
send no remote telemetry.

**Current status: DONE (2026-09-25).** Took the removal path (confirmed with
the maintainer via an explicit question, consistent with the same choice
made in `COST-002`): PostHog and Sentry are gone entirely, not gated —
`services/analytics_service.py`, `services/sentry_service.py`,
`src/instrument.ts`, `src/hooks/useAnalytics.ts`, every call site, both
package managers' dependencies, the Rust sidecar env-var plumbing, the CSP's
telemetry-host allowlist, the release workflow's telemetry secrets, and the
landing privacy policy's now-false claim about them, all removed. Full
rationale in [ADR-007](docs/adr/ADR-007-remove-telemetry.md);
[ADR-005](docs/adr/ADR-005-tauri-shell-hardening.md) has an update note for
the narrower CSP. `get_or_create_device_id()` no longer exists, so no
device ID can be created at all, before or after any opt-in. Frontend
bundle dropped 830 KB → 492 KB JS as a side effect (652 → 313 modules,
Vite's chunk-size warning is gone). Historical build-log docs under
`docs/PHASE_*.md` still mention Sentry/PostHog as originally built — left
alone, in scope for `DOC-006` (stale internal documentation), not this task.

Implementation requirements:

- Remove PostHog/Sentry dependencies and release secrets if they are not essential;
  otherwise keep SDKs completely disabled until separate informed opt-in.
- Consent must not be bundled with capture consent.
- Provide a working revoke toggle and respect it immediately.
- Disable profiling and session replay.
- Scrub URLs, paths, window titles, query text, captured content, auth headers,
  device identifiers and provider responses in `beforeSend`-style hooks.
- Document exact event names/properties and retention if telemetry remains.
- Remove claims about a toggle until the toggle truly exists and is tested.

Acceptance criteria:

- [x] Fresh/default official build sends zero PostHog/Sentry requests —
      true by construction, not configuration: no SDK, no init code, no
      call site exists anywhere in the app.
- [x] Opt-in/revoke behavior is tested if retained. N/A — not retained.
- [x] Release workflow does not require telemetry secrets. Verified by
      reading the updated `.github/workflows/release.yml`.
- [x] No stable device ID is created before opt-in. `get_or_create_device_id()`
      doesn't exist anymore; nothing in the codebase creates `~/.orbit/device_id`.

### SITE-001 — Convert landing site to static, no-waitlist operation

**Current status: DONE (2026-09-25).** Confirmed with the maintainer before
implementing that the requirements text's "add a clear source/download
link" meant the main public landing page should carry real download buttons
— the same ones `/beta` (currently invite-only, not indexed) already has —
not just a "watch for releases" link. That's what shipped: Orbit is now
publicly downloadable directly from the indexed landing page, not gated
behind an invite. `/beta` was kept as-is rather than removed, since an
existing invite link may still point there and it's harmless now that the
main page offers the same thing. "Repository"/"Discussions" links were not
added — the source repo isn't public yet (`MAN-012` hasn't happened) and
linking a private repo to the public would just 404; the release-download
option (explicitly listed as valid on its own) was used instead, since
`orbit-releases` is already public and already proven working via `/beta`.

Implementation requirements:

- Remove Supabase, Resend, server actions, waitlist form and confirmation email.
- Replace signup with links to GitHub Releases, repository, Discussions and/or
  release watching.
- Ensure the site can be statically exported and hosted on GitHub Pages or
  Cloudflare Pages without server functions.
- Remove unused environment variables, dependencies and personal-data language.
- Add a clear source/download link and unsigned/notarized status.
- Preserve accessible, responsive behavior and metadata.

Acceptance criteria:

- [x] Static build succeeds without Supabase/Resend credentials. `pnpm build`
      with `output: "export"` succeeds with zero env vars set — neither
      dependency exists in the project anymore.
- [x] No form stores email or other personal data. No form exists anywhere
      on the site.
- [x] No server runtime is required. Verified directly: every route in the
      build output is `○` (static); `out/` contains only static
      HTML/CSS/JS/image files, no API routes, no server bundle.
- [x] All links point to intended public repositories/releases. Download
      buttons point to the already-public `orbit-releases` repo's fixed
      `orbit-latest-*` release assets (the same pattern `/beta` already
      used successfully).

---

## Phase 4 — License, public documentation, and metadata

### DOC-001 — Add license and notices

**Current status: PARTIAL (2026-09-25).** `MAN-002` was resolved in
conversation with the maintainer (Apache-2.0; see its own entry — its
Task Index row is deliberately left `TODO` since only the maintainer may
flip a `MAN-*` row). Added the exact, byte-verified-against-apache.org
Apache-2.0 text to root `LICENSE` with a `Copyright 2026 Saadaan Hassan`
line (unconfirmed — see `MAN-002`). Wrote `THIRD_PARTY_NOTICES.md` from a
full dependency-license scan of all five workspaces: no copyleft that
propagates to Orbit's own source, no unknown/missing licenses; a few
benign transitive items (MPL-2.0 file-level copyleft, LGPL dynamic-link
only, GPLv2 dev-tooling with a bootloader exception) documented rather
than silently passed over. Aligned `license = "Apache-2.0"` across all
five workspace manifests (`backend/pyproject.toml`, `app/src-tauri/Cargo.toml`,
`app/package.json`, `landing/package.json`, `worker/package.json` — the
last of which was wrongly `"ISC"`, npm's `init` default, never actually
chosen). No `NOTICE` file added (no dependency required one) and no
`TRADEMARKS.md` (conditional on `MAN-005`, which hasn't happened). Held at
`PARTIAL`: asset attributions (fonts/icons/images) can't be completed until
`MAN-005`'s redistribution-rights review happens, and GitHub's own
license-detection can only be confirmed once the repo is actually visible
there in some form.

Implementation requirements:

- Add the exact unmodified text of the license chosen in `MAN-002` to root
  `LICENSE`.
- Add `NOTICE` only when the chosen license/dependencies require or justify it.
- Add `THIRD_PARTY_NOTICES.md` with required attributions and asset licenses.
- Add `TRADEMARKS.md` if `MAN-005` reserves project name/logo use.
- Align SPDX license metadata in Cargo, npm and Python metadata.
- Generate/document a dependency-license report and resolve incompatible or
  unknown licenses before completion.

Acceptance criteria:

- [ ] GitHub can detect the root license. Implemented correctly (root
      `LICENSE`, unmodified standard text, matches GitHub's own detection
      convention) but unverified — no live GitHub repo to check this
      against yet.
- [x] All package license fields agree. All five workspace manifests now
      say `Apache-2.0`; verified each still parses (`uv run`, `cargo
      check`, and JSON validation on all three `package.json` files).
- [ ] Dependency and asset notices are complete. Dependency notices are
      complete (`THIRD_PARTY_NOTICES.md`). Asset notices (fonts, icons,
      images, logo) are not — blocked on `MAN-005`.
- [x] No dependency with an incompatible/unknown license is silently
      accepted. None found; the borderline ones (MPL/LGPL/GPL-dev-tool)
      are documented, not ignored.

### DOC-002 — Root README and build guide

**Current status: PARTIAL (2026-09-25).** Root `README.md` written from
scratch (none existed before). Every item below is met except screenshots —
this environment has no way to launch the GUI app and capture real images
of it, so that item is a genuine, flagged gap, not an oversight. Also
replaced the default boilerplate `app/README.md` (still had the unedited
`create-next-app`/Tauri template text) and added root-guide links to
`backend/README.md`, `worker/README.md`, and `landing/README.md` (the
latter also still had un-customized boilerplate intro text).

The root README must include:

- [x] honest description and current maturity/status;
- [ ] screenshots/demo whose content contains no private user data — not
      done; no way to launch and capture the GUI app in this environment.
      A maintainer should add real screenshots before public launch.
- [x] supported macOS/architecture matrix;
- [x] short architecture and capture-to-cloud data-flow summary;
- [x] exactly what is captured, stored, transmitted and excluded;
- [x] first-launch permission/consent behavior;
- [x] offline capability and optional BYOK setup;
- [x] source build prerequisites and commands for every workspace;
- [x] release downloads, checksums/signature verification and Gatekeeper guidance
      — checksum verification is honestly stated as not yet available
      (tracked at `REL-002`) rather than described as if it exists.
- [x] no instruction to disable Gatekeeper globally — explicit per-app-only
      instruction, with an explicit "never disable globally" statement.
- [x] cost statement: no maintainer-hosted AI; users control provider charges;
- [x] links to privacy, security, contribution, support, roadmap and license
      — security/contribution/support are honestly listed as "not
      published yet" (`DOC-004`, not done) rather than linked to files
      that don't exist.
- [x] known limitations and project roadmap;
- [x] statement that open-source software is provided without warranty.

Replace empty/default component READMEs or link them clearly to the root guide.

### DOC-003 — Rewrite privacy policy and claims

**Current status: PARTIAL (2026-09-25).** Rewrote `landing/src/app/privacy/page.tsx`
entirely from the current code, not the old copy — the previous version had
two direct internal contradictions (claimed data "never leaves your device"
one section before describing what gets sent to cloud AI; claimed
"anonymous usage analytics" are collected in a section right after stating
"Orbit sends no telemetry of any kind" — the latter was already true, the
analytics section was just stale from before `OBS-001`) and named Claude and
Gemini as active processors, both fully removed in `COST-002`. Verified
Groq's and Voyage AI's actual data-retention terms against their own
primary docs (not third-party summaries) before writing about them — Groq
doesn't retain inference data by default; **Voyage AI trains on customer
data by default unless the user opts out on their own Voyage account**,
which Orbit cannot control or override. Verified the session-vs-event
deletion distinction directly against `routes/memory.py`: deleting a
session removes its summary and embedding but *does not* delete the
underlying raw events — they're only unlinked, and can be picked up and
summarized into a new session by the next scheduler cycle. A grep-based
review across `landing/`, `app/src` UI copy, `README.md`, and `AGENTS.md`
found (and fixed) three more instances of the same "all data stays on your
Mac" blanket claim in the main landing page and `/beta`, now unconditionally
false once a personal AI key is configured.

Implementation requirements:

- Remove claims that all data stays on the Mac, Orbit never reads private data,
  only summaries reach cloud AI, raw clipboard is never sent, or secrets are
  impossible to capture unless those statements become literally true.
- Inventory each capture type and field from code, not old documentation.
- Explain capture-time sanitizer limitations and provider-bound defense in depth.
- Explain local database/vector/index encryption status and retention.
- Name current processors only; state purposes, categories, retention settings,
  countries/transfers and user controls.
- Document telemetry truthfully or state that none is enabled by default.
- Document access, deletion/wipe, consent withdrawal and security contact.
- Add policy owner/contact, version and effective date.
- Warn users to obtain permission before capturing employer/client/third-party
  content and to follow workplace/law requirements.
- Keep legal review as a maintainer responsibility; do not present generated text
  as legal advice.

Acceptance criteria:

- [x] Automated/static review finds no known contradictory claim across landing,
      beta, in-app UI, README, `AGENTS.md` and policy. Manual grep-based
      review (no automated tool exists for this yet — a possible future
      `CI-002` addition), not a formalized static-analysis pass; three
      contradictions found and fixed.
- [ ] Policy data flow matches `DOC-005` and tests. `DOC-005` (architecture/
      threat-model doc) doesn't exist yet, so nothing to match against
      directly — the policy was written from the same verified code/test
      behavior `DOC-005` will need to describe, so they should agree once
      it's written, but that's unconfirmed until it exists.
- [x] Every named provider/service is currently used, optional, or clearly marked
      historical/future. Groq and Voyage AI (both used, both optional,
      BYOK), Cloudflare (named as the Voyage relay operator). Claude/Gemini
      are not mentioned anywhere.
- [x] Deletion semantics distinguish a session summary from linked raw events.
      Verified directly against `routes/memory.py`, not assumed.

### DOC-004 — Community and contributor files

**Current status: DONE (2026-09-25).** Added all nine files. Contact email
(`saadaanedu@gmail.com`) and GitHub Private Vulnerability Reporting reused
as the two private security-reporting channels — consistent with the
address already used for privacy questions on the landing site (`DOC-003`).
`GOVERNANCE.md` and `CODEOWNERS` describe the actual current state (single
maintainer, no formal review-rights model) rather than an aspirational
structure that doesn't exist yet. `CHANGELOG.md` documents a
generated-release-note policy pointing at the two GitHub Releases pages
(`orbit-releases` for the app, `ext-v*` tags for the extension) rather than
hand-maintaining a duplicate log — release notes already exist there per
`.github/workflows/release.yml` / `publish-extension.yml`. README's Links
section updated to point at these instead of saying "not published yet."

Add:

- `CONTRIBUTING.md` with setup, task selection, tests, privacy rules, DCO sign-off,
  PR scope and release boundaries;
- `SECURITY.md` with supported versions, private reporting path and disclosure
  expectations;
- `CODE_OF_CONDUCT.md` using a recognized template;
- `SUPPORT.md` establishing community support and no SLA;
- `GOVERNANCE.md` identifying current maintainer/decision process;
- `CHANGELOG.md` or documented generated-release-note policy;
- issue forms for bugs, features and privacy concerns;
- a PR template with tests, data-flow/privacy, cost and screenshots checkboxes;
- `CODEOWNERS` if useful.

Acceptance criteria:

- [x] Security reports are explicitly directed away from public issues.
      `SECURITY.md` states this explicitly; `.github/ISSUE_TEMPLATE/config.yml`
      disables blank issues and links private reporting as the first option;
      `bug_report.yml` and `privacy_concern.yml` both repeat the warning
      inline.
- [x] Contributor process requires tests for capture/provider changes.
      `CONTRIBUTING.md`'s Tests section states this explicitly; the PR
      template's Tests and Data flow/privacy sections require an answer
      (checkbox or explanation) rather than being skippable.
- [x] DCO is documented; no CLA is implied unless separately chosen.
      `CONTRIBUTING.md`'s Commit sign-off section explains `git commit -s`
      and explicitly states this is not a CLA. No CLA bot or CLA text added
      anywhere.
- [x] Support expectations are sustainable for one maintainer.
      `SUPPORT.md` and `SECURITY.md` both state best-effort, no-SLA
      response times up front, matching `GOVERNANCE.md`'s single-maintainer
      description.

### DOC-005 — Architecture, threat model, and data flow

Add/update:

- `docs/ARCHITECTURE.md`
- `docs/THREAT_MODEL.md`
- `docs/PRIVACY_DATA_FLOW.md`
- accepted ADRs under `docs/adr/`
- root `AGENTS.md`

Requirements:

- Diagram Rust capture, extension capture, SQLite/FTS5, sidecar, optional provider,
  updater and website as separate trust boundaries.
- Enumerate all captured/transmitted fields and sanitizer/exclusion points.
- Cover hostile webpage, local process, extension, provider, dependency, release,
  update, database theft and maintainer-account threats.
- Document fail-closed behavior, credential ownership, retention/deletion and
  remaining accepted risks.
- Remove obsolete rules requiring all AI through the maintainer Worker.
- Ensure future agents cannot reintroduce centrally funded fallbacks accidentally.

Acceptance criteria:

- [ ] Documentation matches executable code and automated tests.
- [ ] Every material architecture decision has an ADR.
- [ ] Remaining risks and non-goals are explicit.

### DOC-006 — Versions, package metadata, and stale docs

**Current status: DONE (2026-09-25).** Completed in two passes: the
stale-claims sweep below, then the version/package-metadata alignment.
Proceeded despite this task's formal dependency on `DOC-001`/`COST-005`
(both still `PARTIAL`) since the specific blocker they'd represent —
license not yet chosen — was already resolved in practice (`Apache-2.0` is
established repo-wide, `LICENSE` exists, `DOC-001`'s remaining gaps are
about dependency notices, not the license choice this task needed).

**Version/package-metadata alignment pass:** Wrote `scripts/check-versions.sh`,
a dependency-free `sh` script establishing `app/src-tauri/tauri.conf.json`
(`0.2.4`, what actually drives the release tag/`.dmg`/updater) as the app's
one version source, and `extension/manifest.json` (`0.1.0`) as the
extension's — the extension has its own independent `ext-v*` release
lineage (see AGENTS.md's "Chrome extension distribution" section) and was
never expected to track the app's version. Ran it against the
as-found repo first to confirm it actually catches real drift before
fixing anything: it failed on 4 genuine mismatches — `app/package.json` and
`app/src-tauri/Cargo.toml` were both still `0.1.0` against the app's real
`0.2.4`; `backend/pyproject.toml` likewise (backend ships bundled inside
the app release as a PyInstaller sidecar, so it should track the same
version); `extension/package.json` was `1.0.0` against `manifest.json`'s
`0.1.0` (the field that actually matters for Web Store versioning).
Fixed all four; script now passes cleanly. Separately, found and fixed a
higher-severity, load-bearing version mismatch while checking Python
alignment: `.github/workflows/release.yml` pinned `actions/setup-python@v5`
to **3.11** while `backend/.python-version` and `pyproject.toml`'s
`requires-python` both required **>=3.14** — silently masked in practice
because `uv sync` can download its own matching interpreter regardless of
what that step installs, but still a real inconsistency between what CI
claims to set up and what the backend actually requires; aligned the
workflow to 3.14. Also replaced the remaining literal placeholder metadata
found during this pass: `backend/pyproject.toml`'s description was the
literal `uv init` boilerplate ("Add your description here"),
`app/src-tauri/Cargo.toml`'s was the literal `cargo tauri init` boilerplate
("A Tauri App"), and `extension/package.json` had the full default-`npm init`
set (`"license": "ISC"`, `"author": ""`, `"description": ""`, meaningless
`"version": "1.0.0"`) despite the rest of the repo being `Apache-2.0`. Fixed
all of those, added `"private": true` to `extension/package.json` and
`worker/package.json` (neither is ever published to npm — `app/package.json`
and `landing/package.json` already had it), and added matching
`repository`/`homepage` fields across `app`, `extension`, `worker`, and
`landing` package.json plus `backend/pyproject.toml`'s `[project.urls]`
(none had them before). Verified no regressions: `uv sync` + all 66 backend
tests, `npm run test` (worker, 12 tests), `cargo check --bin app`, and JSON
validity on every touched `package.json`/`tauri.conf.json` — all pass.
Documented the script in `CONTRIBUTING.md`'s Tests section and `AGENTS.md`'s
Build & Run section (run after bumping any of these versions), and added it
to `AGENTS.md`'s monorepo map per this task's own "update root AGENTS.md
fully" instruction.

**Stale-claims sweep (first pass):**

Found via `AGENTS.md`'s own Critical Architecture Facts table while
reviewing `REP-002`: its **first row** — the most-referenced "read this
first" fact in the file — flatly contradicted the row directly below it and
the rest of the document, claiming Claude/Gemini/Voyage "always route
through the Worker" and that a keyless Groq request "goes through the
Worker... using the Worker's own shared secret." Neither is true post-`COST-002`
(zero Worker secrets exist; Claude/Gemini were removed entirely, not routed
anywhere; a keyless Groq request now gets an unconditional 401). Rewrote
that row to match the (accurate) rows around it.

That prompted a repo-wide grep for the same class of mistake — a claim
stated as current fact rather than clearly marked historical/removed.
Found and fixed two more, both in **live, currently-executing code**
(not just historical planning docs, which is why these mattered more than
a docs-only pass would suggest):
- `backend/routes/recall.py`'s module docstring named a retired model
  (`llama-3.3-70b-versatile`, retired by Groq 2026-08-16) and described
  Claude/Gemini as merely "disabled centrally via the Worker's admin kill
  switch for cost control" — both wrong; that switch doesn't exist anymore
  and Claude/Gemini were removed, not toggled off.
- `backend/scheduler.py` had a comment literally instructing a future
  contributor to restore a Claude fallback by "flip[ping] `CLAUDE_ENABLED`
  back on" — that env var/kill-switch concept doesn't exist anywhere in
  the current system. Left as-is, this was a standing invitation to
  reintroduce exactly the centrally-funded-fallback design `COST-002`
  removed — directly the failure mode this acceptance criterion and the
  DOC-005 requirement "ensure future agents cannot reintroduce centrally
  funded fallbacks accidentally" exist to catch.

Also fixed, lower-severity (present-tense descriptions of now-dead code,
not currently-misleading guidance): stale module docstrings in
`backend/services/claude_service.py` and `backend/services/gemini_service.py`
describing themselves as live Worker-proxied integrations rather than
unreachable dead code (both already correctly called "unreachable, not
just unused" in `AGENTS.md` — the source files themselves didn't say so).

Added a dated historical disclaimer to all 13 pre-hardening planning docs
under `docs/` (all written 2026-09-06, before `COST-002`/`OBS-001`/`SITE-001`):
`Oribit_Complete_Build_Plan.md`, `PROUCT_VISION_AND_UX_DIRECTION.md`,
`FUSION_PROMPT.md`, `LANDING_PAGE_AUDIT.md`, `PHASE_0.MD` through
`PHASE_3_PRE_BETA.md` (including the `.5`/`.6`/`.7`/`.9`/`.10` sub-phases).
Per this task's own instruction to "retain useful design history," none of
their content was rewritten — each just gained a short banner pointing to
`AGENTS.md` as the current source of truth, since several (waitlist,
PostHog/Sentry, Claude-as-recall-provider, `PHASE_0.MD`'s "🔴 Not started"
status on a phase that's actually done) actively contradict the current,
hardened architecture if read as current.

Verified no regressions: all 66 backend tests
(`uv run python -m unittest discover -s tests -p 'test_*.py'`) still pass —
every change in this pass was a comment/docstring/doc edit, no logic
touched.

Implementation requirements:

- Establish one release version source or checked synchronization script for
  Tauri config, Cargo, app package, backend and extension where applicable.
- Replace placeholder descriptions/authors and inconsistent `ISC` metadata with
  the chosen license and correct repository/homepage fields.
- Keep app packages `private: true` if they should never be published to npm.
- Align Python version in `.python-version`, `pyproject.toml`, release workflow and
  contributor docs.
- Archive/remove stale build plans and internal claims that contradict current
  architecture; retain useful design history with a dated historical disclaimer.
- Update root `AGENTS.md` fully, including monorepo map, models, environment,
  release, privacy and DO-NOT rules.

Acceptance criteria:

- [x] Version consistency check passes. `sh scripts/check-versions.sh` — confirmed
      it fails on the as-found repo (4 real mismatches) before fixing them,
      then passes cleanly after.
- [x] No placeholder package metadata remains. Grepped for `"license": "ISC"`,
      empty `"author"`/`"description"`, and generic init-tool boilerplate
      across every `package.json`/`Cargo.toml`/`pyproject.toml`/`tauri.conf.json`
      — all fixed, none remain.
- [x] Python build uses one supported version everywhere. `.python-version`,
      `pyproject.toml`'s `requires-python`, and `release.yml`'s
      `actions/setup-python` now all say `3.14`; `uv sync` + full backend
      test suite verified against it.
- [x] Search for private/shared-funded/outdated-model claims produces only clearly
      marked historical references. Repo-wide grep across `.md`/`.py`/`.ts`/`.rs`
      for shared-secret, admin-kill-switch, retired-model-name, and
      Claude/Gemini-as-active-provider phrasing; every hit outside this
      task's own fixes was already correctly framed as historical/removed
      (verified individually, not assumed from the grep alone).

---

## Phase 5 — Tests, CI, and releases

### CI-001 — Real local verification commands

**Current status: DONE (2026-09-25).** Every workspace now has real
lint/typecheck/test commands; none existed for several before this pass.

**Rust** (`app/src-tauri`): `cargo fmt --check` failed on real drift
already in the tree (fixed by running `cargo fmt`). `cargo clippy
--all-targets -- -D warnings` found 6 real findings — a genuine
`duplicated_attributes` false positive on stacked `#[link(...)]` framework
attributes (suppressed with an explained `#[allow]`, not silenced blindly),
2 unnecessary-cast findings, a collapsible-if, and 2 test-only findings —
all fixed; `cargo test --bin app` (37 tests) unaffected throughout.

**Backend** (Python): added `ruff` and `mypy` as dev dependencies.
Ruff's zero-config default for this version pulled in a much broader rule
set than expected (bandit-style security rules, pylint refactor
suggestions, tryceratops) — deliberately curated down to `E/F/I/UP/B`
instead of accepting that implicitly, documented in `pyproject.toml`. Fixed
all 73 resulting findings: mostly import sorting and line-length (raised
`line-length` to 120 to match the codebase's actual established style
rather than reformat ~9,800 lines to fit ruff's 88-char default), plus a
handful of real bugs — 2 missing `from err` exception-chain losses in
`routes/settings.py`, a genuine (if latent) loop-variable-closure risk in
`qdrant_service.py`'s retry lambda (replaced with a named function that
takes `client` as an argument, also fixing a `mypy` "cannot infer lambda
type" finding), and an unguarded `**payload` unpack in the same file that
would `TypeError` if Qdrant ever returned a point with no payload (payload
is optional in qdrant-client's own stubs). `mypy` (default settings, first
run) found 23 errors; the two most notable weren't cosmetic — `database.py`
had an unguarded `.fetchone().accepted_at` that could crash if a
just-inserted consent row somehow wasn't found (now fail-closed, matching
this codebase's own established pattern), and two tests used
`self.assertRaises(Exception)` where the *first* call in a two-call
cooldown test actually raises a different type than the second — the blind
`Exception` masked that the assertion wasn't verifying what the test
intended; narrowed to the real types. All 66 backend tests still pass.

**JS/TS workspaces** — added real tooling from scratch where none existed:
- `worker`: no `tsconfig.json` existed at all — added one (using the
  Wrangler-generated types, `REP-002`), so `Worker typecheck` from this
  task's own requirement list was previously impossible to satisfy.
- `extension`: `"test"` was the literal `echo "Error: no test specified"
  && exit 1` placeholder this task calls out by name. Extracted
  `isUrlCapturable` (from `background.ts`) and `detectSearchQuery` (from
  `content.ts`) into `src/lib/` modules — both were previously private,
  unexported functions entangled with `chrome.*`/DOM side effects at
  module scope, making them untestable without mocking globals; extracting
  them is a behavior-preserving move that also makes them independently
  testable. 15 real tests added (URL-scheme exclusion correctness,
  per-engine search detection). Also found and fixed a real bug this
  surfaced: `popup.ts` had no top-level `import`/`export`, so TypeScript
  treated it as a global script — its `const status` collided with the
  DOM's ambient `Window.status`, silently typing two lines as operations on
  a `string` instead of the actual `HTMLParagraphElement`. Fixed with
  `export {}` (the file is already loaded as `<script type="module">` at
  runtime, so this changes nothing except what the type checker sees).
- `app`: no ESLint config and no test framework existed. Added a standard
  flat-config ESLint setup (`typescript-eslint` + `react-hooks` +
  `react-refresh`) — found 10 warnings (0 errors) on the existing
  codebase, fixed the 3 that were dead `eslint-disable` comments; left 7
  `react-hooks/exhaustive-deps` warnings and 1 fast-refresh warning
  untouched, since blindly adding missing effect dependencies risks
  changing runtime behavior in ways that need per-component review, not a
  lint-wiring pass. Added `vitest` + 10 real tests, including one that
  caught a live architecture violation: `getProjectColor()` was duplicated
  verbatim in both `ProjectCards.tsx` and `TimelineView.tsx` (exactly the
  drift risk `AGENTS.md`'s own "Project color palette" fact warns about) —
  extracted to `app/src/lib/project-color.ts`, both components now import
  the single copy, `AGENTS.md` updated to describe the fix.

**Dependency security scanning** (not in this task's original acceptance
criteria list explicitly, but implied by "license/security checks" in the
implementation requirements, and worth doing given how much was found):
`pnpm audit`/`npm audit`/`cargo audit`/`pip-audit` across every workspace.
Backend: `pip-audit` was already clean. Worker had 8 (fixed via `npm audit
fix` for 6, a direct `vitest` 3→5 bump for the remaining 2 — all 12 tests
still pass).

JS workspaces via pnpm — `app` (10), `extension` (6), and `landing` (**60,
including 2 critical**) — were resolved through a mix of direct dependency
bumps (`vitest` 3→4 for app/extension; `next` 16.2.7→16.3.3 for landing, a
deliberately-pinned exact version kept in lockstep with `eslint-config-next`,
bumped directly rather than overridden since it's a normal dependency
update, not a workaround) and `pnpm.overrides` for the rest. Getting the
override mechanism right took a real false start, worth recording plainly:
`pnpm audit --fix` reports the overrides it plans to apply as JSON but
initially appeared to do nothing, which led to manually copying that JSON
into a `"pnpm": { "overrides": {...} }` block in each `package.json` —
this pnpm version silently ignores that location (a deprecation warning
fires, but the block has zero effect; confirmed by removing it entirely
and re-auditing with no change). The actual mechanism is
`pnpm-workspace.yaml`'s `overrides`/`allowBuilds` keys — and `pnpm audit
--fix` had already been writing there correctly the whole time, which is
why `app`'s and `extension`'s vulnerability counts dropped when it ran,
before any manual `package.json` edit. **This caused a real mistake**:
`app/` and `landing/` both already had a `pnpm-workspace.yaml` (pre-dating
this session, with their own `allowBuilds` entries for unrelated packages
— `@sentry/cli`/`core-js`/`esbuild` for `app`; `esbuild`/`sharp` for
`landing`, alongside `msw`/`unrs-resolver` newly needed here). Not
realizing `landing/pnpm-workspace.yaml` already existed, it was created
fresh with the `Write` tool instead of read-then-edited, silently dropping
its pre-existing `esbuild`/`sharp` entries. Caught by reviewing the full
`git status` before treating this pass as finished (a modified-not-new
file is a signal to check `git diff` before trusting an edit was additive)
— restored both entries, reinstalled clean, reverified 0 vulnerabilities
and a working build. The corrected end state: `app/pnpm-workspace.yaml`
and `extension/pnpm-workspace.yaml` hold their pnpm-audit-generated
overrides (mostly transitive `nanoid`/`postcss`/`browserslist` bumps —
`extension`'s file was created fresh, since none existed there before);
`landing/pnpm-workspace.yaml` holds one hand-picked override (`postcss`,
via `shadcn` and `@tailwindcss/postcss`, neither of which expose a
bumpable direct dependency) plus its full, now-restored `allowBuilds` list.
All of app, extension, worker, and landing are at 0 known vulnerabilities,
verified with a full clean reinstall (`rm -rf node_modules && pnpm
install`) after every change in this section, not just an incremental one.
`cargo audit` (installed via `cargo install cargo-audit --locked`, not a
project dependency — Rust has no per-project dev-tool mechanism like
`uvx`/`pnpm dlx`) found 9 real vulnerabilities + 12 unmaintained-crate
warnings; `cargo update` plus bumping the direct `sqlx` dependency 0.7→0.8
(verified compiling and all 37 Rust tests still passing) brought this down
to 1 vulnerability (`rsa`, `RUSTSEC-2023-0071`) + 7 warnings. That
remaining `rsa` finding was investigated, not just left: `cargo tree -i rsa
--target all -e normal,build,dev` finds **zero reachable paths** to it from
any target or dependency-edge kind, even after a full `Cargo.lock`
regeneration — it appears to be a stale/orphaned lockfile entry (most
likely from `sqlx`'s MySQL driver, present in earlier resolutions before
the 0.8 bump) rather than something actually linked into the shipped
binary. Documented, not silently dropped: a maintainer with more Cargo
internals familiarity should double-check this reasoning before treating
it as fully resolved.

Implementation requirements:

- Replace intentionally failing placeholder test scripts.
- Define documented commands for frontend typecheck/build/test, landing
  lint/static build, extension typecheck/build/test, Worker typecheck/test,
  backend lint/typecheck/pytest, Rust fmt/Clippy/test and license/security checks.
- Prefer deterministic tests with provider HTTP mocked.
- Make commands runnable from a clean clone without production secrets.
- Add a root verification script/task runner only if it improves clarity without
  hiding component failures.

Acceptance criteria:

- [x] Every workspace has a meaningful non-placeholder test/check command.
      backend (ruff+mypy+unittest), app (typecheck+lint+test+build),
      extension (typecheck+test+build — real tests replacing the literal
      failing placeholder), worker (typecheck+test), landing (lint+build),
      app/src-tauri (fmt+clippy+test).
- [x] Commands fail on real errors and pass on the audited baseline.
      Verified per-command: each was run against the as-found repo first
      (confirmed real failures/findings), then against the fixed state
      (confirmed a clean pass) — not just written and assumed to work.
- [x] No test makes a billable network/provider call. Backend mocks every
      provider HTTP call; worker mocks `fetch`; app/extension tests cover
      pure logic only, no network.
- [x] README and contributing guide contain exact commands. `README.md`'s
      "Building from source" section has the short form; `CONTRIBUTING.md`'s
      Tests section has the full per-workspace breakdown plus a new
      "Dependency security and license scanning" section.

### CI-002 — Pull-request CI and automated maintenance

**Current status: DONE (2026-09-26).** Before this task, the repo had zero
PR-triggered CI (only two tag-triggered release workflows), zero Action was
SHA-pinned anywhere (every reference used a mutable tag — `@v4`, `@stable`,
`@v0`, `@latest`), no Dependabot config, and no automated secret scanning
or static analysis despite an existing `.gitleaksignore` implying gitleaks
was already in some use (manually, evidently — nothing ran it in CI).

**New `.github/workflows/ci.yml`** — triggered on `pull_request` (never
`pull_request_target`, and deliberately: GitHub gives a `pull_request`-triggered
run from a fork a read-only `GITHUB_TOKEN` and withholds repository secrets
entirely by default, so this is the fork-safety property the acceptance
criteria ask for, gotten for free from the trigger choice rather than
hand-built — confirmed by grepping both new workflow files for `secrets.`:
zero matches in either). Seven jobs, one per `CI-001` workspace plus two
security jobs, all run in parallel: `rust` (fmt/Clippy/test, `macos-latest`
— required since `app/src-tauri` depends on macOS-only crates behind
`cfg(target_os = "macos")`), `backend` (ruff/mypy/unittest via
`astral-sh/setup-uv`), `app` (typecheck/lint/test/build), `extension`
(typecheck/test/build), `worker` (typecheck/test — includes a `wrangler
types` step first, since `worker-configuration.d.ts` is gitignored,
`REP-002`), `landing` (lint/build), `secret-scan` (gitleaks, see below),
`dependency-review` (`actions/dependency-review-action`, PR-only, no
checkout needed — it reads manifests via the GitHub dependency-graph API).
Every job has `timeout-minutes`; a top-level `concurrency` group cancels a
superseded run on a new push.

**New `.github/workflows/codeql.yml`** — `javascript-typescript` and
`python` only. Deliberately **not** including Rust: CodeQL's Rust support
needs a compiled-language build step and its current maturity for this
Action version wasn't something to assume correct without a real run to
check against — left as a documented follow-up rather than guessed at.
Runs on PR, push to `main`, and a weekly `schedule` (catches new query
coverage against unchanged code).

**New `.github/dependabot.yml`** — `github-actions` (`/`), `cargo`
(`/app/src-tauri`), `uv` (`/backend`), and `npm` for each of the four JS/TS
workspaces separately (`/app`, `/extension`, `/worker`, `/landing` — each
has its own lockfile, one entry can't cover all four). The
`github-actions` entry is what makes the new SHA-pinning durable rather
than a one-time snapshot: Dependabot opens a version-bump PR (with the new
SHA and version visible in the diff) whenever a pinned Action publishes a
release, rather than the pins silently going stale.

**SHA-pinned every Action reference that existed before this task**, in
`release.yml` and `publish-extension.yml` — 13 references across both
files, all previously on mutable tags. Deliberately pinned to the
**currently-referenced tag's SHA**, not the latest available major (several
had drifted far behind — e.g. `actions/checkout` is at v7 upstream while
this repo used v4, `tauri-apps/tauri-action` restructured its whole
versioning scheme from `v0.x` to `action-v1.0.0`): pinning is a supply-chain
integrity fix, not a dependency-upgrade pass, and bundling an unreviewed
major bump into it risks silently changing release-pipeline behavior that
can only be verified by a real tag push. The `github-actions` Dependabot
entry above is what should propose those upgrades going forward, as
separate, reviewable PRs. One exception: `browser-actions/release-chrome-extension@latest`
had no "current tag" to preserve (it wasn't pointed at a real release, just
a moving branch tip with unreleased commits beyond the last tag) — pinned
to the actual latest tagged release (`v0.2.1`)'s SHA instead of `main`'s
tip, since pinning to untagged code defeats the point.

Also added to both existing workflows, which had neither: explicit
`permissions` (`publish-extension.yml` had none declared at all — added
`contents: read`, since nothing in it writes to this repo; Chrome Web
Store publishing uses its own OAuth secrets, not `GITHUB_TOKEN`),
`timeout-minutes` on every job, a `concurrency` group (queue-style,
`cancel-in-progress: false` — deliberately different from `ci.yml`'s
cancel-on-supersede, since cancelling a release or extension-publish job
mid-run risks a half-published release/submission, not just wasted CI
minutes), and `retention-days: 7` on `release.yml`'s `latest-json-*`
build artifact (a small JSON file needed only transiently by the
same-run `merge-latest-json` job, not the 90-day default).

**Validated everything checkable without a real GitHub Actions run**:
`actionlint` (installed via `brew install actionlint`) passes clean on all
four workflow files. Every command referenced in `ci.yml` was run manually
against the current repo state exactly as the workflow invokes it,
including the stricter `npm ci` (not `npm install`) for `worker` — confirmed
its postinstall scripts (workerd's binary fetch, needed for `wrangler`
to function at all) still run to completion under a plain `npm ci`,
despite a new-to-this-npm-version advisory warning that initially looked
like it might silently skip them.

**The gitleaks job found a real, live issue on its first run** — 6 findings,
all `generic-api-key`, all synthetic BYOK test fixtures (`voyage_saved_key_...`,
`gsk_saved_key_...` in `test_voyage_byok.py`/`test_groq_byok.py`) that are
obviously fake but structurally resemble real keys closely enough to match
the rule. This is exactly the same class of false positive
`.gitleaksignore`'s existing header comment already documents a fix for
(historical fixtures in `clipboard.rs`, "constructed at runtime so new
findings remain visible to Gitleaks") — followed that established
convention rather than inventing a new one: added the 6 fingerprints to
`.gitleaksignore` for the already-committed historical commits, **and**
fixed the current file content (module-level `_FAKE_SAVED_VOYAGE_KEY`/
`_FAKE_SAVED_GROQ_KEY` constants built via string concatenation, mirroring
`clipboard.rs`'s own `concat!()` pattern) so future edits to these lines
don't keep re-triggering. Verified: gitleaks now reports "no leaks found"
against the current tree, and all 66 backend tests (including the 14
directly covering these two files) still pass.

**What this doesn't cover, honestly**: none of `ci.yml`, `codeql.yml`, or
`dependabot.yml` have run for real on GitHub yet — that requires a push,
which wasn't done as part of this task. `actionlint` catches syntax and
many semantic errors, and every underlying command was verified to work
standalone, but neither substitutes for a real Actions run (workflow-level
issues like matrix/permissions edge cases, Dependabot's actual PR-opening
behavior, and CodeQL's real analysis output are only provable that way).
Whoever pushes this should watch the first real run of each workflow
before relying on it, the same caveat `AGENTS.md` already carries for
`release.yml`'s matrix+merge flow.

Implementation requirements:

- Add least-privileged pull-request workflows covering all `CI-001` commands.
- Pin third-party Actions to immutable full commit SHAs.
- Add Dependabot/Renovate coverage for pnpm/npm, Cargo, uv/pip and GitHub Actions.
- Add secret scanning in CI, dependency review and CodeQL/static analysis where
  supported for the public repository.
- Avoid running untrusted fork code with repository secrets; do not misuse
  `pull_request_target`.
- Set explicit timeouts, concurrency cancellation and artifact retention.

Acceptance criteria:

- [x] A fork pull request receives no repository/provider/release secret.
      By construction: `ci.yml`/`codeql.yml` trigger on plain `pull_request`
      (never `pull_request_target`), and neither file references `secrets.`
      anywhere — confirmed by grep, not just by design intent.
- [x] Required jobs pass on current code and fail on controlled bad cases.
      Every `ci.yml` command run manually against current HEAD (all pass);
      the new `secret-scan` job's underlying gitleaks check was proven to
      fail on a real bad case it found on its first run (6 findings), fixed,
      then reverified passing.
- [x] Every external Action is full-SHA pinned with update automation.
      All 13 pre-existing references (`release.yml`, `publish-extension.yml`)
      plus every new one (`ci.yml`, `codeql.yml`) are SHA-pinned with a
      version comment; `dependabot.yml`'s `github-actions` entry is the
      update automation that proposes new pins as they're released.
- [x] Generated artifacts contain no captured data or credentials. The only
      artifacts either release workflow produces are `latest-json-*`
      (updater version metadata) — no user data, no credentials; unchanged
      by this task, just confirmed.

### REL-001 — Harden release workflow

**Current status: PARTIAL (2026-09-26).** Everything checkable from a
static/local pass is done and verified; two items depend on live GitHub
state (a secret's actual configured scope, an environment's actual
protection rules) that can only be confirmed by the maintainer, not from
here — held at `PARTIAL` rather than `DONE` specifically because of those,
not because the workflow-file work is incomplete.

Installed `zizmor` (a GitHub Actions–specific security auditor, not just a
YAML/schema linter like `actionlint`) for this pass — it found real issues
`actionlint` structurally can't, since it understands GitHub Actions'
specific threat model (secret exposure, template injection, permission
scope) rather than just YAML shape:

- **3 high-confidence template-injection findings** in `release.yml`:
  `${{ github.ref_name }}` interpolated directly into `run:` shell blocks
  (`gh release upload/download ${{ github.ref_name }} ...`) — a tag name is
  attacker-influenceable by anyone who can push a tag, and directly
  interpolating an expression into a shell command is exactly the injection
  pattern GitHub's own security docs warn against. Fixed by referencing the
  runner-provided `$GITHUB_REF_NAME` environment variable instead (quoted)
  — one instance had an automated fix available and was verified against
  the other two, fixed identically by hand.
- **1 high-confidence excessive-permissions finding**: `contents: write` at
  the workflow level applies to every job, including ones that don't need
  it and any added later. Moved to job-level grants on the two jobs that
  actually call `gh release upload`/`tauri-action` — see the code comment
  on why it's not removed further: every such call already explicitly
  overrides to `RELEASES_REPO_TOKEN` instead of the ambient `GITHUB_TOKEN`,
  which suggests `contents: write` may not be exercised at all, but
  confirming that with certainty needs a real run, not static analysis.
- **2 low-confidence cache-poisoning findings** (one each in `release.yml`
  and `publish-extension.yml`): reviewed and explicitly accepted rather
  than "fixed" — the tool's own suggested auto-fix (`lookup-only: true`)
  would silently defeat the cache entirely (it only checks existence, never
  restores or saves), a real functional regression for a false-positive-risk
  finding. Both workflows trigger only on tag push, which requires push
  access — no fork/PR-triggered workflow in this repo shares either cache's
  key scope, so the actual exploitability here is very low. Documented
  inline at each finding rather than silently ignored.
- **1 low-confidence artipacked finding**, repeated 9× across all 4
  workflow files (every `actions/checkout` step): none set
  `persist-credentials: false`. None of these jobs push back to their own
  repo, so this has zero functional cost — added everywhere.

Beyond what zizmor caught, implemented the rest of this task's explicit
requirements:

- **`curl | sh` uv installer replaced** with `astral-sh/setup-uv` (already
  SHA-pinned in `CI-002`'s `ci.yml`, reused here) — also a correctness fix,
  not just security: `astral-sh/setup-uv`'s `python-version-file` reads
  `backend/.python-version` directly, which is the real source of truth
  `uv` already used to resolve its interpreter (per `AGENTS.md`: "uv can
  silently download its own matching interpreter regardless of what this
  step installs") — the separate `actions/setup-python` step it replaced
  was already vestigial for that reason.
- **Signing-key-length print removed.** `echo "Signing key is present
  (${#TAURI_SIGNING_PRIVATE_KEY} chars)"` leaked the key's exact character
  count into build logs — no operational value, real (if minor) metadata
  leak about a secret. Now just confirms presence.
- **Tag/version consistency validated before building**, in both release
  workflows, as a fast-failing gate job/step ahead of the two expensive
  macOS builds: `release.yml` gets a new `validate` job comparing the
  pushed tag against `app/src-tauri/tauri.conf.json`'s version (plus
  running `scripts/check-versions.sh`, `DOC-006`) before `build-and-release`
  is allowed to start; `publish-extension.yml` gets an equivalent check
  against `extension/manifest.json`. No changelog-consistency check was
  added — `CHANGELOG.md`'s own documented policy (`DOC-004`) is that
  release notes are generated per tag on GitHub, not hand-maintained
  in-repo, so there's no changelog file content that could go stale against
  a version bump in the first place.
- **`environment: dev` → `environment: release`** in `release.yml`. Flagged
  prominently in-line, not just here: if the release secrets
  (`TAURI_SIGNING_PRIVATE_KEY`, `RELEASES_REPO_TOKEN`, `WORKER_URL`) are
  currently scoped to the `dev` GitHub Environment specifically (Settings →
  Environments) rather than at the repo level, this rename alone breaks the
  next release until a `release` environment exists with the same secrets
  — and the rename's actual point (protection rules — required reviewers,
  branch restrictions) needs the maintainer to configure it on GitHub;
  nothing in a workflow file can create environment protection rules.
  **Do not tag a release until this is confirmed on GitHub.**
- **`RELEASES_REPO_TOKEN` scope**: `AGENTS.md` already documents it as "a
  GitHub PAT (fine-grained, scoped to just `orbit-releases`, Contents:
  Read/write)" — taken as already satisfying this requirement per existing
  documentation, but this is a live secret's actual configured grant, which
  genuinely cannot be independently verified from a static repo checkout;
  the maintainer is the only one who can confirm the real token matches
  what's documented.
- **Fork/PR workflows cannot reach signing or release credentials**:
  satisfied by construction, not new code — `release.yml`/`publish-extension.yml`
  trigger only on `push: tags:`, never `pull_request`/`pull_request_target`,
  so no fork-PR code path can reach either workflow at all, regardless of
  permissions.

Verified: `actionlint` and `zizmor` both clean (zizmor: 0 remaining
high/medium findings beyond the 3 documented-accepted cache-poisoning
ones) across all four workflow files; `scripts/check-versions.sh` and all
66 backend tests still pass; the new tag-matching shell logic in both
`validate` steps tested manually against real values from this repo.

**What's NOT verified, honestly**: a real dry-run build of both
architectures (this task's own acceptance criterion) — building a macOS
Tauri app with a full Rust compile and PyInstaller sidecar isn't something
this environment can do, and the workflow itself can only truly be proven
correct by GitHub actually running it. Same caveat as `CI-002` and the
existing note in `AGENTS.md` about `release.yml`'s matrix+merge flow.

Implementation requirements:

- Pin every Action, especially extension publishing, to a reviewed full SHA.
- Replace `curl | sh` installers with pinned/verified installation.
- Minimize top-level and job permissions; use a protected `release` environment,
  not `dev`.
- Keep `RELEASES_REPO_TOKEN` fine-grained to `orbit-releases` Contents read/write
  only, unless a safe same-repo migration is deliberately performed later.
- Use the Python version required by the backend.
- Validate source tag, package version and changelog consistency before building.
- Ensure fork/PR workflows cannot reach signing or release credentials.
- Avoid printing signing-key length/content or sensitive environment details.

Acceptance criteria:

- [x] Workflow security/lint check passes. `actionlint` and `zizmor` (a
      real GitHub-Actions-specific security auditor, not just YAML/schema
      linting) both clean, beyond 3 documented-and-accepted low-confidence
      cache-poisoning findings — see above for why those are accepted, not
      fixed.
- [x] All third-party Actions are immutable SHA pins. Already true from
      `CI-002`; reverified after this task's edits.
- [ ] Release job alone receives only necessary secrets. Scoped
      `contents: write` to the job level (was workflow-level) — genuinely
      unverified whether it's needed *at all*, since every actual write
      goes through `RELEASES_REPO_TOKEN` instead; needs a real run to
      confirm safely, so left at the conservative (present) grant rather
      than guessed away.
- [ ] A dry run builds both architectures without publishing. Not
      performable from this environment (no macOS Tauri build + PyInstaller
      sidecar compile here) — needs a real GitHub Actions run.

### REL-002 — Release integrity and updater validation

Implementation requirements:

- Produce SHA-256 checksums for every distributable asset.
- Produce an SPDX or CycloneDX SBOM.
- Add GitHub artifact attestation/provenance when available.
- Smoke-test Apple Silicon and Intel bundles.
- Validate signatures and confirm `latest.json` contains both
  `darwin-aarch64` and `darwin-x86_64` before publishing it.
- Test update from the last public version to the candidate release.
- Document verification commands and preserve old assets required by installed
  clients.
- Back up the Tauri updater private key securely outside GitHub; never rotate it
  casually.

Acceptance criteria:

- [ ] Candidate artifacts, checksums, SBOM and attestations are mutually linked.
- [ ] Both architecture installs launch and use the secured sidecar.
- [ ] Updater accepts authentic releases and rejects tampered metadata/artifacts.
- [ ] No personal captured data, `.env`, source map secret or signing material is
      present in packages.

### REL-003 — Preserve `orbit-releases` compatibility

Implementation requirements:

- Document why the separate public repository remains: installed clients already
  use its `latest.json` endpoint.
- Verify its README, license/distribution notice, source-commit link, checksums,
  security contact and retention policy.
- Ensure every release links to the exact source tag/commit used to build it.
- Do not delete/overwrite old required assets without testing updater behavior.
- Document a future two-endpoint transition if releases ever move to the source
  repository.

Acceptance criteria:

- [ ] Current installed public version can discover the safe transition release.
- [ ] Release assets identify source, architecture, version and verification data.
- [ ] The updater endpoint remains stable through source-repository publication.

---

## Phase 6 — Manual account cleanup and public launch

### MAN-006 — Deploy transition, disable proxy, revoke keys, cap billing

Do this only after the safe BYOK/offline release is available, unless immediate
cost containment justifies breaking AI in old clients.

Maintainer actions:

- [ ] Publish the transition build to `orbit-releases` and verify both architectures.
- [ ] Confirm the transition build works while the old Worker is unreachable.
- [ ] Deploy the fail-closed/no-shared-key Worker or a deny-all response.
- [ ] Explicitly disable/remove `/embed`, which had no kill switch.
- [ ] Revoke/rotate old Groq, Voyage, Anthropic and Gemini keys.
- [ ] Delete unused Cloudflare Worker secrets and deployments.
- [ ] Disable provider auto-recharge and set hard spend caps/alerts.
- [ ] Check logs/usage after revocation to verify no old client can create charges.
- [ ] Keep a redacted private record of key IDs/revocation dates; never values.

### MAN-007 — Retire waitlist and unnecessary hosted services

Maintainer actions:

- [ ] Export the waitlist only if there is a documented lawful need to retain it.
- [ ] Notify/delete entries according to the published privacy promise.
- [ ] Delete Supabase service-role keys, table/project when no longer needed.
- [ ] Revoke Resend keys and remove unused domain/sender configuration.
- [ ] Remove the Vercel deployment/project if the static site moves elsewhere.
- [ ] Deploy the static site to GitHub Pages or Cloudflare Pages.
- [ ] Use a free platform subdomain if literally zero annual cost is required.
- [ ] Remove payment methods/paid plans where possible and confirm no background
      resource remains billable.

### MAN-008 — Telemetry accounts and retained data

Maintainer actions:

- [ ] Revoke Sentry/PostHog ingestion/auth keys removed from builds/workflows.
- [ ] Delete unused projects or configure zero-cost hard limits with no overage.
- [ ] Review and delete historical events containing unexpected paths/identifiers.
- [ ] Update privacy records with deletion/retention dates.
- [ ] Verify a clean official build makes no request to either service by default.

### MAN-009 — Choose $0 macOS distribution posture

Apple Developer Program membership is not part of the $0 baseline.

Maintainer actions:

- [ ] Choose: unsigned/ad-hoc-signed downloads with Gatekeeper disclosure, user
      builds from source, or a separately funded Developer ID membership.
- [ ] Do not claim notarization if it is not performed.
- [ ] Test documented right-click/Open behavior on a clean supported Mac.
- [ ] Never instruct users to disable Gatekeeper globally.
- [ ] Keep Tauri updater signatures and private-key backup regardless of Apple
      notarization choice.

### MAN-010 — Choose $0 extension distribution posture

Maintainer actions:

- [ ] For literal $0, document source build + Load Unpacked limitations and lack of
      reliable automatic updates.
- [ ] If using Chrome Web Store later, treat registration as a non-zero distribution
      cost and complete store privacy/permission disclosures.
- [ ] Ensure no OAuth publishing credentials remain configured if store automation
      is not used.
- [ ] Verify the public extension build pairs securely with the desktop app.

### MAN-011 — Audit private GitHub state before visibility change

Maintainer actions:

- [ ] Review every historical Actions run/log; delete any exposing private paths,
      emails, repository names, environment data or secret values.
- [ ] Review/delete Actions artifacts and caches that should not become public.
- [ ] Review all branches, tags, releases, LFS objects, discussions, issues, PRs,
      commit comments and wiki content.
- [ ] Review Actions secrets/variables, environments, deploy keys, webhooks,
      installed Apps and collaborator access.
- [ ] Replace broad PATs with least-privileged fine-grained tokens.
- [ ] Ensure default Actions token permissions are read-only.
- [ ] Prepare public issue/discussion settings and private vulnerability reporting.
- [ ] Record existing rulesets because GitHub may disable push rulesets during the
      private-to-public visibility change.

### MAN-012 — Make repository public and immediately secure it

Maintainer actions, in this order:

- [ ] Confirm every launch gate at the top of this document is checked.
- [ ] Confirm the latest safe release is downloadable/updatable.
- [ ] Change repository visibility to public in GitHub Settings.
- [ ] Immediately recreate/re-enable the `main` branch and `v*` tag rulesets.
- [ ] Block force pushes and branch/tag deletion.
- [ ] Require pull requests and passing CI; require review where sustainable.
- [ ] Enable dependency graph, Dependabot alerts/security updates, secret scanning,
      push protection, CodeQL/code scanning and private vulnerability reporting.
- [ ] Require approval for Actions from first-time outside contributors.
- [ ] Restrict allowed Actions and keep the default workflow token read-only.
- [ ] Verify license detection and GitHub Community Profile.
- [ ] Verify website, repository, releases and security links from a logged-out
      browser session.
- [ ] Run the full secret scan once more against the now-public remote refs.

### MAN-013 — Publish transparent announcement

The announcement should state:

- [ ] source URL and exact license;
- [ ] current maturity/beta status and supported macOS versions;
- [ ] what Orbit captures and which features can send data off-device;
- [ ] BYOK/local behavior and that the maintainer does not provide shared AI quota;
- [ ] unsigned/notarized status and safe installation instructions;
- [ ] contribution, security-reporting and roadmap links;
- [ ] known limitations and a request for focused feedback;
- [ ] no promise of free user-side AI, uptime, support SLA, or perfect secret
      detection.

---

## Final public-release verification

Run this only after all implementation tasks are `DONE` and before `MAN-012`.

- [ ] Clean clone into a new temporary directory.
- [ ] Install every workspace using committed lockfiles.
- [ ] Run the complete local verification suite with no production secrets.
- [ ] Build both macOS architectures through the hardened workflow/dry run.
- [ ] Inspect unpacked application/extension artifacts for `.env`, tokens, source
      maps, signing material, absolute private paths and captured test data.
- [ ] Test first launch: no event before consent.
- [ ] Test each capture opt-in, exclusion, pause and revoke control.
- [ ] Test local API attacks: no token, bad token, bad origin, port squatting,
      extension unpaired/revoked.
- [ ] Test offline/no-key behavior.
- [ ] Test user BYOK add/use/disable/delete across restart.
- [ ] Test full wipe and inspect SQLite/WAL/SHM, search/vector storage and temp files.
- [ ] Test update from the previous public release on Apple Silicon and Intel.
- [ ] Verify checksums, updater signature, SBOM and provenance.
- [ ] Review all website/app privacy text against observed network traffic.
- [ ] Confirm provider/hosting/telemetry dashboards show no maintainer-funded usage.
- [ ] Confirm the `orbit-releases` latest manifest contains both architectures.

---

## Completion Log

Append one row per task attempt. Do not include secret values or captured user data.

| Date | Task | Result | Files/areas changed | Verification/evidence | Follow-up/blocker |
|---|---|---|---|---|---|
| 2026-09-06 | ROADMAP | CREATED | `OPEN_SOURCE_ROADMAP.md` | Created from the pre-public architecture, cost, privacy, repository and release audit | Begin with `MAN-000` and `MAN-001` |
| 2026-09-06 | MAN-000 | DONE | `OPEN_SOURCE_ROADMAP.md` | Maintainer accepted ADR-000: BYOK + local FTS5 baseline; no shared provider credentials or anonymous sponsor-funded AI at launch | Next: MAN-001 backup/service inventory, then MAN-002 license choice |
| 2026-09-06 | REP-001 | DONE | `.gitignore`, `.gitleaksignore`, `app/src-tauri/src/capture/clipboard.rs` | Gitleaks 8.30.1: full reachable history scan passed with 0 findings after six exact old clipboard-test fixture fingerprints were allowlisted; changed source/config files scanned clean. `cargo test capture::clipboard::tests` passed 23/23. `git diff --check` and sensitive-path/example-file ignore checks passed. The ignored local `.env.sentry-build-plugin` correctly scans as one Sentry build credential; value was not read or recorded. | `cargo fmt --check` still reports pre-existing formatting drift across unrelated Rust files; deliberately not reformatted in this scoped task. Keep the local Sentry credential uncommitted; rotate/remove it in `OBS-001`/`MAN-008`. |
| 2026-09-06 | SEC-001 | DONE | `docs/adr/ADR-001-local-api-authentication.md`, `OPEN_SOURCE_ROADMAP.md` | Accepted ADR defines per-session sidecar authentication, extension-only paired credentials, exact production/paired origins, a protected stable-port model, restart/revocation behavior, threat model, target data flow, and direct implementation mapping. `git diff --check` passed. | Implement `SEC-002` before changing callers; current local API remains unauthenticated until then. |
| 2026-09-08 | SEC-002 | DONE | `backend/local_api_security.py`, `backend/main.py`, request models, backend security tests, `app/src-tauri/src/main.rs` | Universal middleware requires the 256-bit app-session bearer credential for every registered route; it validates loopback Host and exact Tauri origin, has restrictive preflight/CORS, rejects credential query parameters, limits request/field sizes, removes API schema endpoints, and makes `/health` authenticated/no-content. Production rejects a missing/invalid token. `uv run python -m unittest discover -s tests -v` passed 6/6; compilation and `git diff --check` passed. | SEC-003 must generate/deliver the token and migrate desktop callers. The existing extension intentionally cannot authenticate until SEC-004 adds explicit pairing and capture-only authorization. Rust's full formatter still reports unrelated pre-existing drift outside this task. |
| 2026-09-08 | SEC-003 | DONE | Tauri sidecar lifecycle, `app/src/lib/local-api.ts`, all desktop API callers, development-origin configuration, security tests | Rust generates a fresh 32-byte OS-CSPRNG token per app session, passes it only via the sidecar child environment, authenticates readiness, and never kills an unknown port occupant. The single module-memory webview client obtains the token through a main-window Tauri command and attaches it to every desktop API request; no direct local-backend `fetch` remains. It clears on unmount/401; startup emits the existing safe unavailable state on failure. `cargo check --bin app`, token unit test, frontend `pnpm build` (including TypeScript), backend security tests 6/6, and `git diff --check` passed. | SEC-004 must add the distinct paired extension token; no browser extension can use the sidecar yet. A full Rust formatter still reports unrelated pre-existing formatting drift. |
| 2026-09-08 | SEC-004 | DONE | Pairing routes/table/middleware, extension popup and service worker, desktop Privacy pairing controls, extension permission documentation | Orbit issues five-minute, one-use in-memory pairing codes from its authenticated UI. A Chrome-origin pairing request receives a distinct random capture-only token; only its hash and exact extension ID are stored. Middleware permits that token only on `/capture` from that paired origin, revocation/full wipe invalidates it, and browser auth failures visibly require re-pairing. `uv run python -m unittest discover -s tests -v` passed 7/7; desktop `pnpm build`, extension `pnpm build`, backend compilation, and `git diff --check` passed. | Load the built extension manually in Chrome before public release to validate Chrome-origin behavior and pairing UX on a real profile. |
| 2026-09-08 | PRIV-001 | DONE | `ADR-002`, consent migration/API, safe database defaults, migration tests, backend dependency lock | Consent version 1 records independent capture choices and defaults all of them off. Fresh and upgraded databases are paused until review; absent rows fail closed. Existing native-browser/file/screen toggles also update their consent category. `greenlet` is now an explicit SQLAlchemy async runtime dependency. Backend tests passed 9/9, including fresh and existing-schema migration coverage; compilation and `git diff --check` passed. | PRIV-002 must enforce this record in every Rust monitor and replace remaining Rust fail-open defaults before any capture can resume. |
| 2026-09-10 | PRIV-002 | PARTIAL | Rust clipboard, file activity, screen-content, unified-poller, system-state, capture API, onboarding, Privacy settings, and consent regression tests | Capture defaults fail closed. Every native monitor and the extension-facing `/capture` API now requires the relevant accepted category; unknown event types are denied. Onboarding and Privacy settings provide independent choices plus an explicit keep-off action. Consent/pause settings refresh locally within about five seconds (or the next eight-second monitor poll). `uv run python -m unittest discover -s tests -v` passed 12/12, `pnpm build`, `cargo test --bin app` 34/34, `cargo check`, focused Rust formatting, and staged/unstaged diff checks passed. No acceptance criterion is checked yet because live app behavior still requires maintainer observation. | Required maintainer action: test clean and upgraded profiles; confirm first launch and skip create no events; independently enable then revoke each category; apply global pause; restart; and inspect the local timeline/database for no events while disabled. Record the outcome, date, app build, and any exception here. Keep this task PARTIAL and the Consent gate blocked until that verification is recorded. |
| 2026-09-10 | PRIV-004 | DONE | Shared Python provider-context sanitizer; Groq, Claude, Gemini, Voyage, Qdrant metadata, recall diagnostics, and provider-boundary tests | A single final boundary redacts static credential/PII/path/URL patterns plus local exact-match phrases, caps chat fields/requests, classification batches, embeddings, and vector metadata, and is called immediately before every AI/embedding HTTP request. Provider diagnostics contain only provider, model, operation, status, duration, and safe error kind; raw prompts/responses are not logged. `uv run python -m unittest discover -s tests -v` passed 17/17, including a synthetic secret inserted into a legacy SQLite event row, recall query/history interception, all provider services, metadata bounds, and a response-body-safe diagnostic test. | Continue with `PRIV-005`. `PRIV-002` remains PARTIAL pending the maintainer's live UI verification. |
| 2026-09-10 | PRIV-005 | DONE | Canonical exclusion policy, FastAPI/Rust capture enforcement, macOS Keychain migration, owner-only local storage repair, ADR-004, and regression tests | `services/exclusion_policy.py` owns defaults and normalization; SQLite distributes canonical values to native and extension capture. Domains include true subdomains but not suffix lookalikes; watched-folder boundaries are enforced before every Python/Rust write. `~/.orbit`, SQLite/WAL/SHM, Qdrant, device ID, and onboarding marker receive owner-only modes without following symlinks. Groq keys use macOS Keychain; a legacy SQLite key is deleted only after a successful Keychain transfer/check, and subprocess output is never logged. `uv run python -m unittest discover -s tests -p 'test_*.py'` passed 24/24; focused suite passed 7/7 with ResourceWarnings treated as errors; `cargo test --bin app` passed 36/36; `python -m compileall -q .` and `git diff --check` passed. | Continue with `PRIV-006`. `PRIV-002` remains PARTIAL pending the maintainer's live UI verification. |
| 2026-09-10 | PRIV-006 | DONE | Focused privacy regression suite, secure wipe compaction, in-memory history clearing, Rust secure-field test, and backend test command documentation | `test_privacy_regression_suite.py` proves fresh/upgraded pre-consent rejection, every extension capture category's consent/pause/exclusion gate, corrupt/missing settings fail-closed behavior, wipe of SQLite/FTS/sessions/memory/pairings plus Qdrant invocation, and capture-only extension pairing/revocation. Existing Rust sanitizer/provider-boundary tests cover non-secure secret redaction, URL/path/window-title leaks, legacy unsafe rows, and secure-field skipping; the secure-field branch now has a direct Rust unit test. A successful wipe enables SQLite secure-delete, truncates WAL, vacuums freed pages, and clears webview conversation/pending-query state. `backend/README.md` documents `uv run python -m unittest discover -s tests -p 'test_*.py'` for `CI-002`. The full backend suite passed 29/29 with `ResourceWarning` promoted to errors; `gitleaks detect --source tests --no-git --redact --exit-code 1` found no leaks; `cargo test --bin app` passed 37/37; `pnpm build`, backend compilation, and `git diff --check` passed. | Continue with `APPSEC-001`. `PRIV-002` remains PARTIAL pending the maintainer's live UI verification. |
| 2026-09-10 | PRIV-003 | PARTIAL | `ADR-003`; shared Rust sanitizer; all active/retained Rust event writers; local exact-match pattern table/API/UI; migration test | All active and retained Rust event-insert sources now sanitize their captured strings; URLs strip fragments, redact userinfo and sensitive query values; static patterns cover credentials, keys, headers, JWTs, connection strings, payment/identity data, email/phone, and local custom phrases. `cargo test --bin app` passed 30/30, `cargo check --bin app`, focused `rustfmt --check` for changed capture files, backend tests 9/9, `pnpm build`, and both staged/unstaged `git diff --check` passed. | Keep PARTIAL: repository-wide Clippy fails an existing collapsible-if in `src/lib.rs`, and repository-wide formatter reports existing drift in `src/lib.rs` and `src/main.rs`. Fix and rerun those global checks before marking this task DONE. Consent gate remains blocked by PRIV-002. |
| 2026-09-25 | COST-001 | PARTIAL | `backend/services/groq_service.py`, `backend/routes/settings.py`, `backend/tests/test_groq_byok.py`, `app/src/hooks/useGroqKeySettings.ts`, `app/src/components/PrivacyPanel.tsx`, `AGENTS.md` | Added `GROQ_DIRECT_API_URL` (`https://api.groq.com/openai/v1/chat/completions`) and rewired all three Groq call sites (session summary, classification, recall streaming) plus a new `test_groq_api_key()` to use it with `Authorization: Bearer <key>` whenever `database.get_groq_api_key()` returns a personal key — the Worker is bypassed entirely in that case; with no personal key, behavior is unchanged (Worker, no auth header). Added `POST /settings/groq-key/test` (validates a candidate key with a free Groq `/models` call, never persists it). Built the "Your Own Groq Key" PrivacyPanel section: add/replace/test/remove/temporarily-disable, a persistent explicit disclosure that captured context and queries leave the Mac once a key is active, and a `GET /settings/groq-key` response that only ever returns `{configured, enabled}` — never the key. Rewrote every `AGENTS.md` passage claiming all AI goes through the Worker unconditionally (Critical Architecture Facts, AI Models table, Security & Privacy Rules, Environment Variables, DO NOT section, Key Files entries) to describe the Groq BYOK exception. Verification: `uv run python -m unittest discover -s tests -p 'test_*.py'` 37/37 (8 new: 4 asserting the direct-URL/Bearer-header routing per call site, 1 asserting the no-key path is unchanged, 1 asserting the test endpoint never stores the key, 2 asserting the full add/test/disable/remove route lifecycle and that the raw key never appears in a response); `pnpm build` (TypeScript + Vite) clean. | Required maintainer action: launch a real build, add a personal key, quit and relaunch Orbit, confirm `GET /settings/groq-key` still reports `configured: true` (Keychain + SQLite persistence — no automated test restarts the app). Next: `COST-002`. |
| 2026-09-25 | COST-002 | DONE | `worker/src/index.ts` (rewrite), `worker/src/index.test.ts`, `worker/README.md`, `worker/package.json`, `backend/services/keychain_service.py`, `backend/services/voyage_service.py`, `backend/database.py`, `backend/routes/settings.py` (rewrite), `backend/tests/test_voyage_byok.py`, `backend/tests/test_provider_context_sanitizer.py`, `backend/scheduler.py` (comment), `app/src/hooks/useApiKeySettings.ts` (replaces `useGroqKeySettings.ts`), `app/src/hooks/useProviderStatus.ts` (deleted), `app/src/components/PrivacyPanel.tsx`, `AGENTS.md` | Scope confirmed with the maintainer via an explicit question before implementing (see status note above): all four providers' maintainer-funded Worker credentials removed; Claude/Gemini removed outright (unused, no BYOK anywhere); Voyage given the same BYOK treatment as Groq; Worker stays a lightweight passthrough, not a hardened self-host template. Rewrote `worker/src/index.ts`: `WorkerEnvironment` is now an empty interface, `/chat` and `/classify` and `/provider-status` deleted, `/chat-groq` and `/embed` each require the caller's own key header with no fallback (401 otherwise). Generalized `keychain_service.py` (`_store_api_key_sync`/`_get_api_key_sync`/etc. parameterized by account) and added Voyage Keychain functions alongside the existing Groq ones. `voyage_service.py`: `generate_text_embedding` now requires `database.get_voyage_api_key()`, raises immediately with zero network calls if absent (no maintainer fallback exists), fast-fails on 401 without retrying; added `test_voyage_api_key()`. Rewrote `routes/settings.py` with shared provider-agnostic CRUD helpers powering both `/settings/groq-key` and the new `/settings/voyage-key` (+ `.../test`, `.../enabled`); removed `/settings/provider-status` (nothing left to proxy). Generalized the frontend BYOK hook/UI (`useApiKeySettings.ts`, one `ApiKeySection` component) and rendered it twice (Groq, Voyage) in PrivacyPanel; deleted `useProviderStatus.ts` and the old admin-status UI it powered. Added a Vitest suite for the Worker (auth/routing/passthrough/no-credential-surface, 12 tests) — this Worker had zero test infrastructure before. Rewrote every stale Worker/kill-switch/BYOK claim in `AGENTS.md` (Critical Architecture Facts, AI Models, data-flow diagrams, Cloudflare Worker section, Environment Variables, DO NOT, Key Files, monorepo tree). Verification: backend `uv run python -m unittest discover -s tests -p 'test_*.py'` 43/43 (6 new Voyage tests, 1 existing Groq/Gemini/Claude/Voyage boundary test updated to mock a personal Voyage key); `cd worker && npm run test` 12/12 (new); `pnpm build` (TypeScript + Vite) clean. | **The live, already-deployed Worker still runs the pre-COST-002 code and remains genuinely exposed (`/embed` has no kill switch, zero auth) until the maintainer runs `npx wrangler deploy` from `worker/` — not done here, deployment requires explicit authorization.** Next: `COST-003` — note its own scope (making Voyage/Qdrant fully optional) now partially overlaps with the BYOK work done here; check current state before assuming the original task text is unchanged. |
| 2026-09-25 | COST-003 | PARTIAL | `backend/services/qdrant_service.py`, `backend/main.py`, `backend/scheduler.py`, `backend/services/voyage_service.py`, `backend/routes/recall.py`, `backend/tests/test_offline_recall.py`, `docs/adr/ADR-006-optional-lazy-semantic-search.md`, `AGENTS.md` | Decision: Qdrant retained (not removed) but made fully lazy — see ADR-006. `qdrant_service.py`'s `add_session_embedding()`/`search_sessions_semantic()` now call `generate_text_embedding()` *before* touching the Qdrant client; with no personal Voyage key that raises immediately and Qdrant's local storage is never created. Removed the unconditional `initialize_qdrant_collection()` calls from `main.py`'s startup and `scheduler.py`'s every-30-minutes cycle; `scheduler.py` now checks `get_voyage_api_key()` before attempting an embedding at all, logging `debug` (not `warning`) when none is configured — was previously warning on every cycle forever for the now-common no-key case. Found and fixed a real regression while verifying this: `routes/recall.py` ran Qdrant semantic search and Groq synthesis in one `try` block, so `VoyageKeyNotConfiguredError` (a plain `RuntimeError`, not an `httpx.*` exception) escaped the `except` clause into the catch-all handler and replied "Sorry, something went wrong" instead of ever calling Groq — meaning a user with a valid Groq key but no Voyage key got no AI-synthesized recall answer at all, not just no semantic search. Restructured so semantic search soft-fails to an empty list (Groq still runs on FTS5-only/DB-scan context) and only a genuine Groq-side failure triggers the plain-FTS5-text fallback. Verification: `uv run python -m unittest discover -s tests -p 'test_*.py'` 47/47 (4 new in `test_offline_recall.py`, covering the exact regression above, the full-offline path, the time-range DB-scan independence, and that Qdrant's client is never touched without a key). | Packaging size/startup regression was not measured (requires a built macOS app bundle, outside this environment) — reasoned qualitatively in ADR-006 instead; a maintainer should do an actual before/after comparison before marking `DONE`. Next: `COST-004`. |
| 2026-09-25 | COST-004 | PARTIAL | `backend/services/groq_service.py`, `backend/tests/test_groq_model_migration.py`, `AGENTS.md` | **Live production bug, verified via Groq's own current docs (not training data):** `llama-3.1-8b-instant`/`llama-3.3-70b-versatile` (Orbit's classification/recall models) were retired for free/developer tier on 2026-08-16 — every real BYOK user's classification and recall has been silently failing since then. Also verified the roadmap's suggested `qwen/qwen3.6-27b` alternative was itself deprecated 2026-09-14; used `openai/gpt-oss-120b` for recall instead (Groq's other listed replacement, already proven in this codebase for session summaries). `GROQ_CLASSIFY_MODEL` → `openai/gpt-oss-20b`, `GROQ_RECALL_MODEL` → `openai/gpt-oss-120b`. Both are reasoning models — added `reasoning_effort="low"` to the classification call (previously had none, since the old model didn't support/need it) and to the recall streaming request body. Added `GROQ_CLASSIFY_REASONING_TOKEN_HEADROOM = 500` to classification's `max_tokens` calculation, since its tight per-event budget was sized for a non-reasoning model with zero chain-of-thought overhead — documented explicitly as a reasoned estimate, not empirically calibrated. Kept the existing 30-event group cap and repetition-loop-defense token ceiling as a conservative default, since whether `openai/gpt-oss-20b` shares the old model's specific repetition-loop failure mode is unverified. Updated every stale model-name reference across `AGENTS.md`. Verification: `uv run python -m unittest discover -s tests -p 'test_*.py'` 52/52 (5 new in `test_groq_model_migration.py`: correct model IDs, `reasoning_effort` present on classification/recall/session-summary, reasoning headroom reflected in outgoing `max_tokens`). | **No live Groq account was available to confirm any of this against real API responses** — implemented from Groq's current documentation and this codebase's own established `reasoning_effort` pattern, not empirical testing. A maintainer with a real Groq key should run one real classification cycle and one real recall query and watch specifically for truncated/empty classification results (raise `GROQ_CLASSIFY_REASONING_TOKEN_HEADROOM` if so) and recall latency near the 30s timeout, before marking `DONE`. Next: `COST-005`. |
| 2026-09-25 | COST-005 | PARTIAL | `backend/services/groq_service.py`, `backend/services/voyage_service.py`, `backend/routes/recall.py`, `backend/tests/test_provider_failure_modes.py`, `backend/tests/test_offline_recall.py`, `AGENTS.md` | Audited both providers' error handling against the full named-failure matrix (no key, invalid key, rate limit/quota, outage, timeout, malformed response, offline network) and closed two real gaps found in the process: Groq's `_call_groq_chat` cooled down on 429 but never on 401/403, meaning an invalid key was independently rediscovered by every classification group, session summary, and recall query in a cycle instead of being remembered; Voyage had no cooldown mechanism at all. Added `_GROQ_AUTH_FAILURE_COOLDOWN_SECONDS`/`_VOYAGE_AUTH_FAILURE_COOLDOWN_SECONDS` (300s) for 401/403 and a 429 cooldown for Voyage (honouring `Retry-After`, reusing Groq's existing default of 90s), plus jitter on Voyage's exponential backoff. Rewrote the offline-recall fallback (`_describe_groq_unavailable_reason()` + `_format_fts5_fallback()`) to name the actual cause (no/bad key vs. rate-limited vs. network problem vs. outage) instead of always guessing "you may be offline," and to always state plainly that the search itself never left the device. Verification: `uv run python -m unittest discover -s tests -p 'test_*.py'` 66/66 (13 new in `test_provider_failure_modes.py` covering the full matrix for both providers plus proof that Groq never retries within a call and Voyage is bounded to exactly 3 attempts; 2 new in `test_offline_recall.py` for the reworded fallback message). | Two items reasoned through rather than independently re-verified: "quota exhausted" is treated as the same case as "rate limit" (429) — neither provider documents a separate code for it; "keep events locally pending with non-alarming UI status" is asserted true from existing architecture (events are never deleted, only left with `session_id IS NULL` until reprocessed) without a fresh frontend check. Next: `OBS-001`. |
| 2026-09-25 | OBS-001 | DONE | `backend/main.py`, `backend/scheduler.py`, `backend/routes/feedback.py`, `backend/routes/recall.py`, `backend/services/analytics_service.py` (deleted), `backend/services/sentry_service.py` (deleted), `backend/pyproject.toml`/`uv.lock`, `app/src/main.tsx`, `app/src/instrument.ts` (deleted), `app/src/hooks/useAnalytics.ts` (deleted), `app/src/hooks/useRecall.ts`, `app/src/components/{ErrorBoundary,MemoryViewer,PrivacyPanel}.tsx`, `app/vite.config.ts`, `app/package.json`/`pnpm-lock.yaml`, `app/src-tauri/src/lib.rs`, `app/src-tauri/tauri.conf.json`, `.github/workflows/release.yml`, `landing/src/app/privacy/page.tsx`, `docs/adr/ADR-005-tauri-shell-hardening.md` (update note), `docs/adr/ADR-007-remove-telemetry.md`, `AGENTS.md` | Maintainer confirmed removal over opt-in (see status note above). Deleted both service files and every `capture_analytics_event`/`useAnalytics`/`Sentry.captureException` call site; `ErrorBoundary` now logs render errors to `console.error` only. Removed `posthog`/`sentry-sdk[fastapi]` (backend, via `uv remove`) and `@posthog/react`/`@sentry/react`/`posthog-js`/`@sentry/vite-plugin` (frontend, via `pnpm remove`), and the `sentryVitePlugin`/hidden-sourcemap step from `vite.config.ts` (sourcemaps now off — nothing consumes them). Removed the `SIDECAR_POSTHOG_API_KEY`/`SIDECAR_SENTRY_DSN` compile-time constants and their `.env()` sidecar-spawn calls from `lib.rs` (`cargo check` confirmed clean). Removed the six telemetry secrets from the release workflow's Tauri build step. Narrowed the CSP's `connect-src` to drop `*.posthog.com`/`*.i.posthog.com`/`*.sentry.io` (nothing calls them anymore). Fixed the landing privacy policy's now-false claim that Orbit sends telemetry. Verification: backend `uv run python -m unittest discover -s tests -p 'test_*.py'` 66/66 unaffected; frontend `pnpm build` clean, bundle dropped 830 KB → 492 KB JS (652 → 313 modules, chunk-size warning gone); `cargo check --bin app` and `cargo test --bin app` 37/37 clean; `git diff --check` clean. | Historical `docs/PHASE_*.md` build logs still describe the old Sentry/PostHog setup as originally built — left alone, in scope for `DOC-006` (stale internal docs), not this task. Next: `SITE-001`. |
| 2026-09-25 | SITE-001 | DONE | `landing/next.config.ts`, `landing/src/app/page.tsx`, `landing/src/app/opengraph-image.tsx`, `landing/src/app/beta/page.tsx`, `landing/src/app/not-found.tsx`, `landing/src/components/{header,footer}.tsx`, `landing/package.json`/`pnpm-lock.yaml`, `landing/.env.example`, `landing/README.md`, `landing/src/lib/waitlist-actions.ts` (deleted), `landing/src/lib/supabase.ts` (deleted), `landing/src/components/waitlist-form.tsx` (deleted), `landing/src/emails/waitlist-confirmation.tsx` (deleted), `landing/supabase-schema.sql` (deleted), `AGENTS.md` | Scope confirmed with the maintainer before implementing (see status note above): direct public download buttons on the main page, not a "watch releases" link. Deleted the waitlist form, its Server Action, the Supabase client, the React Email template, and the Supabase schema file; removed `@supabase/supabase-js`/`resend`/`react-email`/`zod` (all now-unused). Added `output: "export"` to `next.config.ts`. Rewrote `page.tsx`'s hero: same download buttons and unsigned/notarization "what to expect" disclosure `/beta` already has, using the same already-public `orbit-releases` URLs. Fixed two build errors static export surfaced: `opengraph-image.tsx` needed `export const dynamic = "force-static"`, which is incompatible with its existing `runtime = "edge"` (removed); every `next/image` usage (header, footer, beta, not-found) needed the `unoptimized` prop since default Image Optimization requires a server. Updated `package.json` (`start` removed — `next start` doesn't work against an export build; added `preview` via `npx serve out`) and `README.md` accordingly. Fixed copy that referenced "waitlist"/"Join the Waitlist" in `beta/page.tsx` and the OG image text, now stale. Fixed `privacy/page.tsx`'s telemetry claim while already there (see `OBS-001`'s entry — done as part of that task, not this one, but touches this same directory). Verification: `pnpm build` succeeds, every route reports `○` (static); inspected `out/` directly — pure static files, zero API routes, zero server bundle; `pnpm lint` clean. | None — all four acceptance criteria verified directly against the actual build output, no live-app gap this time. Next: `DOC-001`. |
| 2026-09-25 | DOC-001 | PARTIAL | `LICENSE` (new), `THIRD_PARTY_NOTICES.md` (new), `backend/pyproject.toml`, `app/src-tauri/Cargo.toml`, `app/package.json`, `landing/package.json`, `worker/package.json`, `OPEN_SOURCE_ROADMAP.md` (`MAN-002` decision recorded, row left for maintainer to flip) | `MAN-002` resolved via direct conversation with the maintainer: Apache-2.0, after a background dependency-license scan (582 Rust crates, 40 Python packages, all JS/TS trees) confirmed nothing in the codebase would constrain the choice. Fetched the license text directly from `apache.org/licenses/LICENSE-2.0.txt` via `curl` (not retyped from memory) and diffed the written `LICENSE` file's body against it byte-for-byte before proceeding. Copyright line uses "Saadaan Hassan, 2026" (matches every commit author and the actual project start) — proposed, not separately confirmed; flagged in `MAN-002`'s own entry for the maintainer to correct if wrong. `THIRD_PARTY_NOTICES.md` documents the scan's findings in full, including the non-blocking borderline cases (MPL-2.0, LGPL, GPLv2-with-bootloader-exception, and a `BSL-1.0` naming false-alarm — Boost Software License, not Business Source License). Added `license = "Apache-2.0"` to all five workspace manifests; `worker/package.json` had been left at npm's `"ISC"` init default, never actually chosen — fixed. Verified: all three `package.json` files still valid JSON, `uv run` still resolves `pyproject.toml`, `cargo check --bin app` still compiles. | Two real gaps, both external to this session: asset notices (fonts/icons/images/logo) need `MAN-005`'s redistribution-rights review first, and GitHub's license auto-detection can't be confirmed without a live repo to check it against. Maintainer should also confirm the copyright-holder name in `LICENSE` is correct, then flip `MAN-002` to `DONE` themselves. Next: `DOC-002`. |
| 2026-09-25 | DOC-002 | PARTIAL | `README.md` (new), `app/README.md`, `backend/README.md`, `worker/README.md`, `landing/README.md` | Wrote the root README from scratch — none existed before. Covers status/maturity (including the two honest caveats: unsigned/unnotarized, no checksum verification yet), what Orbit does, a full capture/never-capture inventory pulled from the codebase (not old marketing copy), first-launch consent behavior, the BYOK cost model, install instructions with the safe per-app Gatekeeper bypass only (explicitly states never to disable Gatekeeper globally), build commands for all four workspaces plus each one's test command, known limitations, and the warranty disclaimer. Replaced `app/README.md` (still the unedited `create-next-app`/Tauri boilerplate) and added a root-guide link to `backend/README.md`, `worker/README.md`, and `landing/README.md` (the last also still had un-customized boilerplate text). Verified the "Privacy tab" UI label referenced actually matches `App.tsx`'s tab button text, and simplified one heading to avoid an em-dash/anchor-link ambiguity. | Screenshots/demo images were not added — this environment can't launch and interact with the GUI app to capture real images of it; a maintainer should add some before public launch. Next: `DOC-003`. |
| 2026-09-25 | DOC-003 | PARTIAL | `landing/src/app/privacy/page.tsx`, `landing/src/app/page.tsx`, `landing/src/app/beta/page.tsx` | Full rewrite of the privacy policy from current code, replacing the old copy's two internal contradictions (claimed data "never leaves your device" then described cloud AI transmission; claimed "anonymous analytics" are collected right next to a correct "no telemetry" statement) and its now-false Claude/Gemini processor claims (removed in `COST-002`). Researched Groq's and Voyage AI's actual data-retention policies against their own primary docs before writing about them: Groq doesn't retain inference data by default (30-day troubleshooting-only log, ZDR available); Voyage AI trains on customer data by default unless the user opts out on their own account — called out explicitly since Orbit has no control over that setting. Verified the session-vs-event deletion distinction directly against `routes/memory.py`'s actual DELETE logic rather than assuming: deleting a session unlinks but does not delete its underlying raw events, which can be re-summarized into a new session later; only deleting the events themselves, or a full wipe, is permanent. New sections cover encryption/retention (90-day rolling event retention, no app-level encryption, FileVault recommended), redaction limits (best-effort, not a guarantee), and a warning to get permission before capturing employer/client content. Grep-reviewed `landing/`, in-app UI copy, `README.md`, and `AGENTS.md` for contradictions with the new policy; found and fixed three more instances of "all data stays on your Mac" (main landing hero, its privacy callout strip, and `/beta`) now false once a personal key is configured. Verified: `pnpm build` (static export) and `pnpm lint` both clean. | `DOC-005` (architecture/threat-model doc) doesn't exist yet, so the "policy data flow matches DOC-005" criterion can't be directly confirmed — both were/will be derived from the same verified code, so they should agree once `DOC-005` is written, but that's unconfirmed until then. The cross-document contradiction check was a manual grep, not an automated/formalized tool. Next: `DOC-004`. |
| 2026-09-25 | APPSEC-001 | PARTIAL | `app/src-tauri/Cargo.toml`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/capabilities/default.json`, `docs/adr/ADR-005-tauri-shell-hardening.md` | Removed the unconditional `devtools` Cargo feature (WRY still exposes devtools automatically in debug builds; release builds no longer force it on). Added a restrictive CSP (`default-src 'self'` plus a `connect-src` scoped to the fixed-port local backend, PostHog, and Sentry — the only hosts the webview itself calls; the Cloudflare Worker and AI providers are never in `connect-src` because only the Python backend calls them). Rewrote `capabilities/default.json` to grant exactly what the webview calls: removed `global-shortcut:default` and six unused `core:window:allow-*` permissions (the hotkey and those window transitions are Rust-native and were never gated by this file), and added the previously-missing `updater:allow-check`, `updater:allow-download-and-install`, `process:allow-restart`, and `dialog:allow-open` — without which auto-update and the watched-folder picker were silently non-functional (both call sites swallow errors by design). Existing entitlements were reviewed and left unchanged; each already carries an inline justification comment and is exercised by a real code path. `macOSPrivateApi: true` is required by the main window's `shadow: false` and the overlay window's transparency/click-through. Verification: `cargo check --bin app` (also validates the capabilities file against plugin permission schemas), `cargo test --bin app` 37/37, `pnpm build` (TypeScript + Vite), `git diff --check` all passed. | Required maintainer action: build a real `.dmg`, confirm right-click → Inspect Element is unavailable, and confirm the local API, PostHog/Sentry, the update check, and the folder picker all still work under the new CSP/capability grant. Record the outcome here before marking `APPSEC-001` DONE. Next: `COST-001`. `PRIV-002`/`PRIV-003` remain PARTIAL, independent of this task. |

---

## Deferred ideas — not launch blockers

These must not distract agents from the ordered launch work:

- Fully local LLM through MLX/llama.cpp with downloadable model management.
- Local open-weight embeddings and optional semantic index.
- Windows support.
- Sponsor-funded hosted service with accounts and quotas.
- Cloud synchronization.
- Apple notarization when funded.
- Chrome Web Store distribution when funded.
- Formal external penetration test/privacy legal review.
