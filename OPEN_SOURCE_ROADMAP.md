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

**Status:** Proposed; accept in `MAN-000`.

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
| MAN-000 | Maintainer | TODO | Accept or replace ADR-000 target architecture | — |
| MAN-001 | Maintainer | TODO | Create private backup and external-service inventory | — |
| MAN-002 | Maintainer | TODO | Choose the source license | — |
| MAN-003 | Maintainer | TODO | Decide whether to expose or rewrite commit email/history | MAN-001 |
| MAN-004 | Maintainer | TODO | Choose public security/privacy contact | — |
| MAN-005 | Maintainer | TODO | Verify code, asset, name, and trademark ownership | — |
| REP-001 | Agent | TODO | Harden ignores and complete repository secret scan | MAN-001 |
| REP-002 | Agent | TODO | Remove generated artifacts and normalize lockfiles | REP-001 |
| SEC-001 | Agent | TODO | Document the local trust boundary and authentication protocol | MAN-000 |
| SEC-002 | Agent | TODO | Add authenticated, restrictive FastAPI middleware | SEC-001 |
| SEC-003 | Agent | TODO | Integrate Tauri token lifecycle and authenticated frontend client | SEC-002 |
| SEC-004 | Agent | TODO | Add secure extension pairing and restrictive extension CORS | SEC-003 |
| PRIV-001 | Agent | TODO | Add versioned capture consent and safe database defaults | SEC-003 |
| PRIV-002 | Agent | TODO | Gate all Rust capture monitors on consent and settings | PRIV-001 |
| PRIV-003 | Agent | TODO | Sanitize every Rust-captured field before SQLite | PRIV-002 |
| PRIV-004 | Agent | TODO | Sanitize all provider-bound context at the Python boundary | PRIV-003 |
| PRIV-005 | Agent | TODO | Normalize exclusions and protect local files/credentials | PRIV-004 |
| PRIV-006 | Agent | TODO | Add privacy, consent, and redaction regression tests | PRIV-005 |
| APPSEC-001 | Agent | TODO | Harden Tauri CSP, release devtools, capabilities, and entitlements | SEC-003 |
| COST-001 | Agent | TODO | Implement Keychain-backed BYOK UI and direct Groq calls | MAN-000, SEC-003 |
| COST-002 | Agent | TODO | Remove all shared-key Worker behavior and fail closed | COST-001 |
| COST-003 | Agent | TODO | Make FTS5 the no-embedding default and remove mandatory Voyage usage | COST-002 |
| COST-004 | Agent | TODO | Replace retired models and centralize provider/model configuration | COST-001 |
| COST-005 | Agent | TODO | Add predictable offline/rate-limit/provider failure behavior | COST-003, COST-004 |
| OBS-001 | Agent | TODO | Remove default remote telemetry or make it genuine opt-in | MAN-000, PRIV-001 |
| SITE-001 | Agent | TODO | Convert landing site to static, no-waitlist operation | MAN-000 |
| DOC-001 | Agent | TODO | Add chosen license and dependency/asset notices | MAN-002, MAN-005 |
| DOC-002 | Agent | TODO | Create the root public README and build guide | COST-005, DOC-001 |
| DOC-003 | Agent | TODO | Rewrite privacy policy and all product privacy claims | PRIV-006, OBS-001 |
| DOC-004 | Agent | TODO | Add contribution, security, support, conduct, and governance files | MAN-004, DOC-001 |
| DOC-005 | Agent | TODO | Add architecture, threat model, and exact data-flow documentation | SEC-004, PRIV-006, COST-005 |
| DOC-006 | Agent | TODO | Align versions/package metadata and clean stale internal documentation | DOC-001, COST-005 |
| CI-001 | Agent | TODO | Make all workspaces expose real local verification commands | REP-002, PRIV-006 |
| CI-002 | Agent | TODO | Add pull-request CI, dependency updates, and security scans | CI-001 |
| REL-001 | Agent | TODO | Harden the release workflow and secret permissions | CI-002, DOC-006 |
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

- [ ] Confirm BYOK + FTS5 as the baseline, or write the replacement decision in
      this file before agents start `COST-*` tasks.
- [ ] Confirm that zero **maintainer** cost is the requirement; users may incur
      provider charges only after explicit setup and disclosure.
- [ ] Confirm that no anonymous sponsor-funded AI service will remain at launch.
- [ ] Record any approved deviations in the Completion Log.

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

Maintainer actions:

- [ ] Confirm the exact SPDX identifier: `Apache-2.0` or another OSI-approved
      license.
- [ ] Confirm the copyright holder name and starting year.
- [ ] Understand that an open-source license does not prevent competitors from
      using the software according to that license.
- [ ] Record the decision for `DOC-001`.

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

- [ ] `git check-ignore` confirms all named sensitive filename classes are ignored.
- [ ] `.env.example`/`.dev.vars.example` files remain trackable.
- [ ] Full-history scan exits cleanly or every finding is documented privately and
      remediated/queued for maintainer revocation.
- [ ] No broad scanner exclusion hides application source or all test fixtures.
- [ ] Completion Log contains scanner names, versions, commands and redacted result
      counts.

### REP-002 — Remove generated artifacts and normalize lockfiles

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

- [ ] No distributable ZIP, DMG, private signing artifact, or real generated
      backend executable is tracked in source.
- [ ] Each JavaScript workspace has one authoritative lockfile.
- [ ] Setup/build instructions regenerate required artifacts.
- [ ] App, backend, extension, Worker and landing dependency installs remain
      reproducible.

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

- [ ] ADR status is `Accepted` only after implementation direction is unambiguous.
- [ ] Threats include hostile local processes, malicious websites, malicious
      extensions, token leakage, port squatting and replay.
- [ ] The ADR maps directly to `SEC-002`, `SEC-003`, and `SEC-004`.

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

- [ ] Missing, malformed and incorrect credentials return 401/403 on every
      sensitive route, including wipe, memory, settings, recall and capture.
- [ ] Unknown browser origins fail preflight/request checks.
- [ ] Valid Tauri requests pass.
- [ ] `/health` remains usable by the trusted startup sequence.
- [ ] Automated route enumeration proves no sensitive router was omitted.

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

- [ ] A production-like app session can call every intended route.
- [ ] Token is absent from source maps, bundle strings, process arguments, URLs,
      normal logs, Sentry/PostHog payloads and persisted browser storage.
- [ ] Restart/sidecar failure produces a user-safe error, not silent insecure
      fallback.
- [ ] Frontend typecheck/build and Rust tests pass.

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

- [ ] Unpaired extensions cannot write events.
- [ ] Revoked/old tokens cannot write events.
- [ ] A random webpage cannot call the capture or memory API successfully.
- [ ] Pairing codes expire and cannot be replayed.
- [ ] Manifest permission rationale is documented.
- [ ] Extension build and integration tests pass.

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

- [ ] Fresh database has all capture settings disabled.
- [ ] Pre-migration database becomes paused pending re-consent.
- [ ] Missing/corrupt consent settings fail closed.
- [ ] User can later revoke each category without wiping unrelated preferences.
- [ ] Migration tests cover fresh, existing and partially migrated databases.

### PRIV-002 — Gate every Rust capture monitor

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

- [ ] Every Rust SQLite insert path demonstrably invokes the sanitizer.
- [ ] Secrets displayed in Terminal/editor/normal text fields are redacted.
- [ ] Window title, URL, file path and screen text tests exist.
- [ ] Input caps are applied after/before sanitization as appropriate without
      leaking truncated secret fragments.
- [ ] Rust formatting, Clippy and tests pass.

### PRIV-004 — Sanitize at the provider boundary

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

- [ ] Tests inject sensitive strings directly into legacy database rows and prove
      they are absent from intercepted provider requests.
- [ ] Recall query and conversation-history tests are included.
- [ ] All provider call sites share the same boundary sanitizer.
- [ ] Provider errors do not reveal prompts, response bodies, keys or local paths.

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

- [ ] Exclusion behavior is identical across native browser and extension paths.
- [ ] Default exclusions and normalization are covered by tests.
- [ ] Local directory/files receive restrictive permissions on creation and
      existing installations are repaired safely.
- [ ] No provider key remains in SQLite, logs, exports or memory longer than needed.

### PRIV-006 — Add privacy/consent regression suite

Create a focused suite that proves:

- [ ] no pre-consent capture on new and upgraded installs;
- [ ] fail-closed behavior for missing/corrupt settings;
- [ ] every capture category respects pause, per-category toggles and exclusions;
- [ ] secure text fields are skipped;
- [ ] secrets in non-secure text are sanitized before storage;
- [ ] legacy unsafe rows are sanitized before provider calls;
- [ ] URL/path/window-title leakage cases are covered;
- [ ] extension pairing/revocation and backend authentication are covered;
- [ ] wipe behavior removes SQLite, FTS/index, Qdrant/legacy vectors, search history
      and temporary files as documented;
- [ ] tests do not contain scanner-valid credentials.

The task is complete only when the suite can run locally with one documented
command and is suitable for `CI-002`.

### APPSEC-001 — Harden the Tauri shell

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

- [ ] Production build has no user-accessible devtools.
- [ ] CSP blocks unexpected network/script sources without breaking the app.
- [ ] Capability/entitlement rationale is documented in the threat model.
- [ ] App build and relevant Tauri security tests pass.

---

## Phase 3 — Zero-maintainer-cost product operation

### COST-001 — Implement Keychain-backed BYOK and direct Groq access

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

- [ ] No provider key is stored in SQLite, Vite bundle, source, command arguments,
      logs or crash/analytics events.
- [ ] Add/test/remove/disable flows work across restart.
- [ ] AI calls use the user's key directly.
- [ ] No-key operation is useful and stable.
- [ ] `AGENTS.md` no longer says all AI keys must live in the shared Worker.

### COST-002 — Remove shared-key Worker behavior and fail closed

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

- [ ] Searching production source/config finds no shared-provider fallback.
- [ ] Anonymous requests cannot invoke a maintainer-funded upstream.
- [ ] Missing configuration returns a safe disabled response.
- [ ] Worker tests cover auth, origins, limits, method routing and fail-closed flags.
- [ ] Desktop app remains functional with the Worker fully offline/deleted.

### COST-003 — Make FTS5 the default; remove mandatory Voyage/Qdrant use

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

- [ ] Fresh install, session generation, timeline, projects and recall operate
      without Voyage/Qdrant/network.
- [ ] Existing local data remains usable after migration.
- [ ] Offline retrieval quality has deterministic tests.
- [ ] No silent remote embedding request occurs.
- [ ] Packaging size/startup regression is measured and recorded.

### COST-004 — Replace retired models and centralize provider configuration

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

- [ ] No shut-down model ID remains in executable paths or current docs.
- [ ] Classification and recall tests pass with captured/mock current wire formats.
- [ ] Model removal produces graceful local fallback.
- [ ] Token budgets are bounded and documented.

### COST-005 — Predictable failure and offline behavior

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

- [ ] Automated tests cover all named error classes.
- [ ] Retry counts, timeouts and queue bounds are explicit.
- [ ] User-facing messages explain whether data stayed local.
- [ ] Background operation does not spin, flood logs or repeatedly burn quota.

### OBS-001 — Remove default telemetry or make it real opt-in

Recommended baseline: official builds contain no active PostHog or Sentry DSNs and
send no remote telemetry.

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

- [ ] Fresh/default official build sends zero PostHog/Sentry requests.
- [ ] Opt-in/revoke behavior is tested if retained.
- [ ] Release workflow does not require telemetry secrets.
- [ ] No stable device ID is created before opt-in.

### SITE-001 — Convert landing site to static, no-waitlist operation

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

- [ ] Static build succeeds without Supabase/Resend credentials.
- [ ] No form stores email or other personal data.
- [ ] No server runtime is required.
- [ ] All links point to intended public repositories/releases.

---

## Phase 4 — License, public documentation, and metadata

### DOC-001 — Add license and notices

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

- [ ] GitHub can detect the root license.
- [ ] All package license fields agree.
- [ ] Dependency and asset notices are complete.
- [ ] No dependency with an incompatible/unknown license is silently accepted.

### DOC-002 — Root README and build guide

The root README must include:

- [ ] honest description and current maturity/status;
- [ ] screenshots/demo whose content contains no private user data;
- [ ] supported macOS/architecture matrix;
- [ ] short architecture and capture-to-cloud data-flow summary;
- [ ] exactly what is captured, stored, transmitted and excluded;
- [ ] first-launch permission/consent behavior;
- [ ] offline capability and optional BYOK setup;
- [ ] source build prerequisites and commands for every workspace;
- [ ] release downloads, checksums/signature verification and Gatekeeper guidance;
- [ ] no instruction to disable Gatekeeper globally;
- [ ] cost statement: no maintainer-hosted AI; users control provider charges;
- [ ] links to privacy, security, contribution, support, roadmap and license;
- [ ] known limitations and project roadmap;
- [ ] statement that open-source software is provided without warranty.

Replace empty/default component READMEs or link them clearly to the root guide.

### DOC-003 — Rewrite privacy policy and claims

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

- [ ] Automated/static review finds no known contradictory claim across landing,
      beta, in-app UI, README, `AGENTS.md` and policy.
- [ ] Policy data flow matches `DOC-005` and tests.
- [ ] Every named provider/service is currently used, optional, or clearly marked
      historical/future.
- [ ] Deletion semantics distinguish a session summary from linked raw events.

### DOC-004 — Community and contributor files

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

- [ ] Security reports are explicitly directed away from public issues.
- [ ] Contributor process requires tests for capture/provider changes.
- [ ] DCO is documented; no CLA is implied unless separately chosen.
- [ ] Support expectations are sustainable for one maintainer.

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

- [ ] Version consistency check passes.
- [ ] No placeholder package metadata remains.
- [ ] Python build uses one supported version everywhere.
- [ ] Search for private/shared-funded/outdated-model claims produces only clearly
      marked historical references.

---

## Phase 5 — Tests, CI, and releases

### CI-001 — Real local verification commands

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

- [ ] Every workspace has a meaningful non-placeholder test/check command.
- [ ] Commands fail on real errors and pass on the audited baseline.
- [ ] No test makes a billable network/provider call.
- [ ] README and contributing guide contain exact commands.

### CI-002 — Pull-request CI and automated maintenance

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

- [ ] A fork pull request receives no repository/provider/release secret.
- [ ] Required jobs pass on current code and fail on controlled bad cases.
- [ ] Every external Action is full-SHA pinned with update automation.
- [ ] Generated artifacts contain no captured data or credentials.

### REL-001 — Harden release workflow

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

- [ ] Workflow security/lint check passes.
- [ ] All third-party Actions are immutable SHA pins.
- [ ] Release job alone receives only necessary secrets.
- [ ] A dry run builds both architectures without publishing.

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

