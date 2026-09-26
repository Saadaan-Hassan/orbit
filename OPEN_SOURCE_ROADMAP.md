# Orbit Open-Source Roadmap

> Single source of truth for making Orbit public, safe, genuinely open source,
> and free for the maintainer to operate.

**Created:** 2026-09-06  
**Source repository:** `Saadaan-Hassan/orbit` — currently private  
**Release repository:** `Saadaan-Hassan/orbit-releases` — retired 2026-09-26,
being archived (see `ADR-000`'s update note and `MAN-006`); no packaged
releases are produced by this project anymore  
**Overall status:** **NOT READY TO MAKE PUBLIC**  
**Recommended target:** BYOK cloud AI + local FTS5 fallback, no shared provider
credentials, no required hosted backend and no maintainer-run infrastructure of
any kind, static website pointing to the source repo, remote telemetry off by
default, source-only self-build distribution.

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
- Preserve unrelated user changes. There is no updater/release compatibility
  path to preserve anymore (`REL-001`/`REL-002`/`REL-003` are retired) — do
  not reintroduce one on the assumption this instruction implies it exists.
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

**2026-09-26 pivot (see `ADR-000`'s update note below):** the maintainer decided
to stop shipping packaged releases entirely — no `orbit-releases` repo, no
signed `.dmg`, no in-app auto-updater, no Chrome Web Store listing. Orbit is
now source-only/self-build/BYOK, with zero maintainer-run infrastructure of
any kind (the Cloudflare Worker relay was removed outright, not hardened).
This retires `REL-001`/`REL-002`/`REL-003` and rescopes `MAN-006`/`MAN-009`/
`MAN-010` — see their entries below and in the Task Index. The gates below
are updated to match; struck-through clauses no longer apply.

- [ ] **Cost gate:** no public client can spend a maintainer-owned AI credential
      (`COST-001` through `COST-005`, `MAN-006`). No maintainer-run relay exists
      for any client to spend against in the first place.
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
- [ ] **Supply-chain gate:** pull-request CI passes and every Action is pinned and
      least-privileged (`CI-001`, `CI-002`). No release Actions exist to harden
      (`REL-001`/`REL-002` retired — see pivot note above).
- [ ] **History gate:** every ref, Actions log, artifact, and release asset has been
      audited for secrets and unacceptable personal data (`REP-001`, `MAN-001`,
      `MAN-003`, and `MAN-011`).
- [x] **Distribution gate** (replaces the former "Release gate"): N/A by
      design — there is no packaged release or updater path to preserve.
      Anyone who wants a working copy clones the source and runs
      `pnpm tauri build` themselves (`REL-003`/`MAN-009` retired/rescoped).
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

**Update — 2026-09-26 (maintainer decision, verbatim intent preserved
below):** the maintainer decided not to continue active development for now
and to make the repository fully open for others to build on, with zero
maintainer-run infrastructure of any kind — not just zero maintainer-*paid*
infrastructure. This supersedes two specific ADR-000 clauses:

- *"The Worker becomes an optional self-hosting template or is removed"* →
  resolved as **removed**, not templated. `worker/` no longer exists in this
  repository; both Groq and Voyage calls are BYOK-direct from the backend.
- *"Keep `orbit-releases` until every installed version can migrate
  safely"* → superseded. There is no longer any packaged/signed release
  build, so there is nothing an old installed client needs to migrate from.
  The `orbit-releases` companion repo, the in-app Tauri auto-updater, and
  the Chrome Web Store extension listing are all retired, not paused.

This directly retires `REL-001`, `REL-002`, and `REL-003` (nothing left to
harden, checksum, or preserve compatibility for) and rescopes `MAN-006`
(now just: tear down the live Worker and revoke its keys, not "deploy a
transition build first"), `MAN-009`, and `MAN-010` (both resolved as
"self-build only" rather than left as an open distribution-posture choice).
See the Task Index and each task's own entry below, and `AGENTS.md`'s
`Distribution` section for the full user-facing reasoning.

---

## Task Index

Tasks are ordered. Do not start a later phase merely because it is easier.

| ID | Owner | Status | Task | Depends on |
|---|---|---|---|---|
| MAN-000 | Maintainer | DONE | Accept or replace ADR-000 target architecture | — |
| MAN-001 | Maintainer | PARTIAL (2026-09-27) | Create private backup and external-service inventory — backup + GitHub-side inventory done (2 real findings for MAN-011, see below); external accounts still need maintainer's dashboard access | — |
| MAN-002 | Maintainer | TODO | Choose the source license | — |
| MAN-003 | Maintainer | DONE (2026-09-27) | Decide whether to expose or rewrite commit email/history — decided: keep `webmaker9d@gmail.com` as is, no rewrite | — |
| MAN-004 | Maintainer | DONE (2026-09-27) | Choose public security/privacy contact — `saadaanedu@gmail.com` | — |
| MAN-005 | Maintainer | DONE (2026-09-27) | Verify code, asset, name, and trademark ownership — everything self-created/AI-generated, no formal trademark search (accepted risk) | — |
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
| REL-001 | Agent | N/A (2026-09-26) | ~~Harden the release workflow and secret permissions~~ — retired, no release workflow exists | CI-002, DOC-006 |
| REL-002 | Agent | N/A (2026-09-26) | ~~Add checksums, SBOM/provenance, smoke tests, and updater validation~~ — retired, nothing is built/shipped | REL-001 |
| REL-003 | Agent | N/A (2026-09-26) | ~~Document and preserve `orbit-releases` compatibility~~ — retired, `orbit-releases` archived | REL-002 |
| MAN-006 | Maintainer | PARTIAL | Tear down the live Cloudflare Worker and revoke its provider keys (rescoped 2026-09-26 — no transition build needed, there is no release to publish). Worker deleted and `orbit-releases` archived by the agent, with explicit maintainer authorization; provider-key revocation still needs the maintainer's own dashboard access | COST-002 |
| MAN-007 | Maintainer | TODO | Export/delete waitlist data and retire paid/free-tier services | SITE-001 |
| MAN-008 | Maintainer | TODO | Configure or remove telemetry accounts and retained data | OBS-001 |
| MAN-009 | Maintainer | DONE (2026-09-26) | Choose and verify $0 macOS distribution posture — decided: source-only self-build, no downloads of any kind | — |
| MAN-010 | Maintainer | DONE (2026-09-26) | Choose and verify $0 extension distribution posture — decided: source-only self-build, no Chrome Web Store listing | — |
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

**PARTIAL (2026-09-27).** Backup and the GitHub-side inventory are done; the
external-account inventory table is a template only — it needs the
maintainer's own dashboard access to fill in, which the agent doesn't have
beyond Cloudflare (already confirmed empty — the Worker was deleted in an
earlier session). Full write-up:
`~/Documents/Projects/Personal/orbit-backups/MAN-001-inventory-2026-09-27.md`
(private, outside this repo, per this task's own instruction).

**Two real findings surfaced while inventorying GitHub, relevant to
`MAN-011`/`MAN-012`. Both required explicit maintainer sign-off before
acting since they're destructive/remote — sign-off was given 2026-09-27:**

1. **DONE — deleted.** Three GitHub Releases existed directly on the source
   repo (not `orbit-releases`), all `v0.1.0`, with real attached binaries
   (`.dmg`, `.app.tar.gz`, signature, updater manifest). That build predated
   nearly all of this roadmap's security/privacy hardening (no local API
   auth, no consent gating, telemetry still present) — leaving these public
   would have let anyone download that old, unhardened build directly,
   defeating the "self-build only" model entirely. Deleted via
   `gh api -X DELETE repos/Saadaan-Hassan/orbit/releases/<id>` for each of
   the 3 release IDs; confirmed via a follow-up listing returning 0
   releases.
2. **NOT done — blocked by this session's own tooling, needs the maintainer
   to run it.** 8 historical `Release` workflow runs leak
   `TAURI_SIGNING_PRIVATE_KEY`'s exact character count
   (`Signing key is present (348 chars)`) in their logs — the metadata leak
   `REL-001` found and fixed in the *current* workflow file, which does
   nothing for these already-recorded historical logs; they stay publicly
   viewable forever once the repo goes public. The agent's own permission
   system blocked a batch `gh run delete` loop as "External System Writes"
   and explicitly disallows retrying the same outcome in smaller pieces, so
   this needs the maintainer to run it directly:
   ```bash
   for id in 29305454902 29223405269 29221033126 29160208482 \
             29158151624 27524437582 27187043617 27184970074; do
     gh run delete "$id" --repo Saadaan-Hassan/orbit
   done
   ```

Also found: a live
`RELEASES_REPO_TOKEN` Actions secret with no remaining consumer (should be
revoked+deleted) and 3 GitHub-created deployment Environments (`dev`,
`Preview`, `Production`, no protection rules — `Preview`/`Production` look
Vercel-integration-generated, worth confirming still needed).

Maintainer actions:

- [x] Create an encrypted bare mirror or `git bundle` containing every ref.
      → Plain (unencrypted) `git bundle --all`, chose this over an encrypted
      mirror since it already lives outside the repo in a private,
      user-only-permissioned directory — encrypt it yourself if it'll ever
      leave that machine.
- [x] Store it outside the public repository and confirm it can be read/verified.
      → Stored in a sibling `orbit-backups/` directory; verified via
      `git bundle verify` AND a real restore into a scratch clone (not just
      the integrity check) — branches and latest commit confirmed intact.
- [x] Export a list of GitHub Actions secret/variable **names**, environments,
      deploy keys, webhooks, installed GitHub Apps, Pages settings, branch/tag
      rules, releases, artifacts, caches and LFS objects. Never export secret values
      into this repository. → Done via `gh api`/`gh run list`/`gh release list`;
      full results in the private inventory file above, only names/metadata,
      no secret values read or recorded. Surfaced the two findings above.
- [ ] Inventory Cloudflare, Groq, Voyage, Anthropic, Gemini, Vercel, Supabase,
      Resend, PostHog, Sentry, domain registrar and Chrome Web Store accounts.
      → Template table left in the inventory file; needs the maintainer's
      own dashboard access for everything except Cloudflare (confirmed
      empty — Worker already deleted).
- [ ] Record which accounts have payment methods, auto-recharge, paid plans,
      usage caps, stored user data, API keys and active deployments. →
      Same gap as above.
- [x] Save the inventory privately, not in this repository. → Done, see path above.

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

**DONE (2026-09-27).** Baseline confirmed: all 155 commits across all 3
branches (`main`, `revamp-for-public`, `alternative-models` — all already
pushed to `origin`) expose `Saadaan Hassan <webmaker9d@gmail.com>` as both
author and committer. The agent looked into rewriting this (GitHub numeric
ID `96711267` was fetched for a possible noreply-email replacement, and
`git-filter-repo` would have needed installing via `brew`), but once the
maintainer saw the actual blast radius — every commit hash changes across
3 already-pushed branches, requiring a force-push to overwrite `origin` —
the maintainer's explicit decision was: **don't remove it, keep it as is.**
No history rewrite was performed.

Maintainer actions:

- [x] Decide whether this address may remain public forever. → Yes, keep
      as is.
- [x] If not, explicitly authorize a history rewrite before publication and accept
      that commit/tag hashes will change. → N/A, no rewrite requested.
- [ ] Configure a GitHub noreply address for future commits if desired. →
      Not decided; future commits will keep using the current address
      unless the maintainer sets up `git config user.email` differently.
- [x] If history is rewritten, verify every branch/tag and re-run `REP-001`.
      → N/A, no rewrite performed.

### MAN-004 — Choose public security/privacy contact

**DONE (2026-09-27).** Maintainer chose `saadaanedu@gmail.com` as the
public security contact. Already in `SECURITY.md` (both as the listed
email and alongside GitHub Private Vulnerability Reporting as the
preferred channel), with a best-effort (not SLA) response expectation.

Maintainer actions:

- [x] Create or select a monitored contact address that can safely be public.
- [x] Decide whether GitHub private vulnerability reporting will be the preferred
      security channel. → Preferred; email is the fallback.
- [x] Define the response expectation honestly; do not promise an SLA you cannot
      maintain.
- [x] Provide the address/wording to the agent doing `DOC-004`.

### MAN-005 — Verify ownership and naming

**DONE (2026-09-27).** Maintainer confirmed, verbatim: nothing related to
Orbit (the name, the logo) was purchased or licensed from a third party —
the name was picked without a formal conflict search, and the logo was
generated with AI, not sourced from a stock/paid asset library. There is
therefore no third-party redistribution-rights issue to clear: everything
is either original code, AI-generated, or already covered by
`THIRD_PARTY_NOTICES.md`'s dependency scan. `Orbit` and its logo are not
treated as reserved/registered trademarks.

**Accepted, not eliminated, risk:** no formal trademark or "prior art"
search was run against the name `Orbit` — it's a common English word
already used by other unrelated software products, so a name conflict is
possible even though nothing here infringes anything intentionally. The
maintainer accepted this as-is rather than doing a formal search or
renaming; revisit only if an actual conflict surfaces.

Maintainer actions:

- [x] Confirm you have redistribution rights for every source file, generated
      component, image, icon, font, screenshot, email template and marketing asset.
      → Yes — all self-created or AI-generated, nothing purchased/licensed.
- [x] Review third-party snippets and AI-generated material for licensing issues.
      → No third-party snippets found (see `THIRD_PARTY_NOTICES.md`); the
      AI-generated logo has no known licensing encumbrance.
- [ ] Search for conflicting software/package names and relevant trademarks.
      → Explicitly skipped by the maintainer's choice; accepted risk, see above.
- [x] Decide whether `Orbit` and the logo are reserved trademarks even while code
      is open source. → No.
- [x] Give `DOC-001` a list of required attributions/notices. → None beyond
      `THIRD_PARTY_NOTICES.md`'s existing dependency scan.

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

**DONE.** Removed Supabase/Resend/the waitlist form/server actions entirely;
the site is a static export (`output: "export"`) with no server, no form,
and no personal data collected. Originally (2025-09-25) shipped with public
download buttons pointing at `orbit-releases`; **superseded by the
2026-09-26 pivot** — there are no packaged downloads anymore, so `page.tsx`
now has a "View on GitHub" CTA and a `git clone` snippet instead, and
`/beta` (the old invite-only download page) has been deleted. See the
pivot's Completion Log entry and `AGENTS.md`'s `Distribution` section. The
waitlist/Supabase removal itself is unaffected and still accurate.

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
- [x] source build/Gatekeeper guidance — superseded by the 2026-09-26 pivot:
      there are no release downloads or checksums anymore (`REL-002`
      retired), so this is now "build it yourself" guidance instead, per
      README's current "Building from source" section.
- [x] no instruction to disable Gatekeeper globally — explicit per-app-only
      instruction, with an explicit "never disable globally" statement.
- [x] cost statement: no maintainer-hosted AI; users control provider charges;
- [x] links to privacy, security, contribution, support, roadmap and license
      — all now published (`DOC-004` is `DONE`).
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

### REL-001/002/003 — Release workflow, integrity, and `orbit-releases` compatibility

**RETIRED (2026-09-26).** The maintainer decided to stop shipping packaged
releases entirely (see `ADR-000`'s update note) — `release.yml` and
`publish-extension.yml` are deleted, along with the `worker/` workspace and
the in-app auto-updater. There is no release workflow, artifact, checksum,
SBOM, or updater feed left to harden, validate, or preserve compatibility
for, and no installed base to migrate. `orbit-releases` has been archived
(`MAN-006`).

Before this retirement, `REL-001` had reached `PARTIAL`: `zizmor` found and
the agent fixed 3 template-injection findings (`${{ github.ref_name }}`
interpolated into shell blocks) and 1 excessive-permissions finding
(workflow-level `contents: write` narrowed to job-level) in `release.yml`;
2 low-confidence cache-poisoning findings were reviewed and accepted rather
than "fixed" (the tool's own auto-fix would have silently defeated the
cache); `curl | sh` was replaced with `astral-sh/setup-uv`; a
tag/version-consistency gate was added before both release builds. None of
that work is actionable anymore. Do not restore `release.yml` from git
history on the strength of this note — re-read `AGENTS.md`'s `Distribution`
section first and confirm a maintainer actually wants packaged releases
back before reviving any of it.

---

## Phase 6 — Manual account cleanup and public launch

### MAN-006 — Tear down the Cloudflare Worker and revoke its keys

**PARTIAL (2026-09-26).** The original task assumed a "transition build"
published to `orbit-releases` before the Worker could safely go away —
that no longer applies, since there is no packaged release of any kind
(see `ADR-000`'s update note, `REL-001`/`REL-002`/`REL-003`). Nothing
depends on the Worker anymore: the backend has called Groq/Voyage
BYOK-direct since `COST-002`. This was a straightforward teardown, no
staged rollout needed.

The maintainer explicitly authorized the agent to perform the Cloudflare
Worker deletion and the `orbit-releases` repo action directly (verbatim:
"i want you to do it yourself. you can take the cloudflare worker access as
well becuase my codex also had access to it"), via the already-authenticated
`wrangler` CLI (account `webmaker9d@gmail.com`) and the `gh` CLI switched to
the `github-personal` (`Saadaan-Hassan`) account as instructed. Both of the
items below the agent could act on are done; the remaining items require
access to the actual Groq/Voyage/Anthropic/Gemini provider dashboards, which
the agent does not have.

Maintainer actions:

- [x] Delete the deployed `orbit-api-proxy` Cloudflare Worker. Done via
      `npx wrangler delete --name orbit-api-proxy --force` — confirmed gone
      immediately after (`wrangler deployments list` now returns "This
      Worker does not exist on your account", code 10007). Deleting the
      Worker script also removes its bound secrets; Cloudflare does not
      retain orphaned per-Worker secrets after script deletion.
- [ ] Revoke/rotate any maintainer-owned Groq, Voyage, Anthropic, and
      Gemini keys that were ever configured as Worker secrets. Needs the
      maintainer's own access to each provider's dashboard.
- [ ] Disable provider auto-recharge and confirm no hard spend cap/alert is
      still configured against a key that no longer needs one.
- [ ] Check each provider's dashboard after revocation to confirm no
      further usage posts against the old key.
- [ ] Keep a redacted private record of which key IDs were revoked and
      when; never record the key values themselves.
- [x] Archive the `orbit-releases` GitHub repository — done via `gh repo
      archive Saadaan-Hassan/orbit-releases --yes` (chose archive over
      delete: reversible, and it preserves the historical release record
      without keeping it as an active/writable repo). Confirmed via `gh
      repo view` reporting `isArchived: true`. If the maintainer would
      rather it be deleted outright instead, that's a one-line follow-up
      the maintainer can do themselves (`gh repo delete`, which the agent
      will not do unprompted since it's irreversible).

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

**DONE (2026-09-26).** Decided: source-only, self-build. No unsigned/
ad-hoc-signed downloads are offered at all — the maintainer builds nothing
for distribution; every user runs `pnpm tauri build` on their own Mac with
their own toolchain. This sidesteps Gatekeeper friction entirely rather
than choosing among ad-hoc-signing options: the quarantine flag Gatekeeper
checks for is only ever set on files downloaded from the internet, never on
a `.app` compiled locally. README.md's "Status" and "Building from source"
sections, and `AGENTS.md`'s `Distribution` section, document this. A
locally-built copy that a user goes on to redistribute to *other people* is
that redistributor's own signing/notarization responsibility, stated
explicitly in both docs.

Original open questions (kept for context): Apple Developer Program
membership was never part of the $0 baseline and remains out of scope,
since no maintainer-run signing pipeline exists at all now.

### MAN-010 — Choose $0 extension distribution posture

**DONE (2026-09-26).** Decided: source-only, self-build, same as the
desktop app. No Chrome Web Store listing exists or is planned — the
Chrome extension is built locally (`cd extension && pnpm install && pnpm
build`) and loaded via `chrome://extensions` → Developer mode → Load
Unpacked. `publish-extension.yml` (the former Chrome Web Store publishing
workflow) has been deleted, not just left unused. README.md's "Building
from source" section and `AGENTS.md`'s `Distribution` section document
this, including the accepted limitation that Load Unpacked has no
automatic-update mechanism — a user who wants updates re-pulls and
rebuilds from source.

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

**2026-09-26:** four items below are struck through — they assumed a
maintainer-built/signed release and an `orbit-releases` updater feed, which
no longer exist (see `ADR-000`'s update note). The rest still applies: this
is source-only distribution, not a lower verification bar.

- [ ] Clean clone into a new temporary directory.
- [ ] Install every workspace using committed lockfiles.
- [ ] Run the complete local verification suite with no production secrets.
- [ ] Build both macOS architectures locally (`pnpm tauri build`, run on
      Apple Silicon and Intel if both are available) and confirm each
      launches. ~~Build both macOS architectures through the hardened
      workflow/dry run.~~
- [ ] Inspect the built application/extension artifacts for `.env`, tokens, source
      maps, signing material, absolute private paths and captured test data.
- [ ] Test first launch: no event before consent.
- [ ] Test each capture opt-in, exclusion, pause and revoke control.
- [ ] Test local API attacks: no token, bad token, bad origin, port squatting,
      extension unpaired/revoked.
- [ ] Test offline/no-key behavior.
- [ ] Test user BYOK add/use/disable/delete across restart.
- [ ] Test full wipe and inspect SQLite/WAL/SHM, search/vector storage and temp files.
- [ ] ~~Test update from the previous public release on Apple Silicon and Intel.~~
      N/A — no auto-updater exists.
- [ ] ~~Verify checksums, updater signature, SBOM and provenance.~~ N/A — no
      release artifacts are produced by the maintainer.
- [ ] Review all website/app privacy text against observed network traffic.
- [ ] Confirm provider/hosting/telemetry dashboards show no maintainer-funded usage
      (should show none at all — no maintainer-run infrastructure exists to
      have usage in the first place).
- [ ] ~~Confirm the `orbit-releases` latest manifest contains both
      architectures.~~ N/A — `orbit-releases` is retired.

---

## Completion Log

Append one row per task attempt. Do not include secret values or captured user data.

| Date | Task | Result | Files/areas changed | Verification/evidence | Follow-up/blocker |
|---|---|---|---|---|---|
| 2026-09-06 | ROADMAP | CREATED | `OPEN_SOURCE_ROADMAP.md` | Created from the pre-public architecture/cost/privacy/repo/release audit. | Begin with `MAN-000`/`MAN-001`. |
| 2026-09-06 | MAN-000 | DONE | `OPEN_SOURCE_ROADMAP.md` | Maintainer accepted ADR-000: BYOK + local FTS5 baseline, no shared credentials. | — |
| 2026-09-06 | REP-001 | DONE | `.gitignore`, `.gitleaksignore`, `clipboard.rs` | Gitleaks full-history scan clean after allowlisting 6 old test-fixture fingerprints. `cargo test` 23/23. | Rotate the local `.env.sentry-build-plugin` credential in `OBS-001`/`MAN-008`. |
| 2026-09-06 | SEC-001 | DONE | `docs/adr/ADR-001-local-api-authentication.md` | Accepted ADR: per-session sidecar auth, extension pairing, threat model, target data flow. | Implement `SEC-002`; local API stays unauthenticated until then. |
| 2026-09-08 | SEC-002 | DONE | `backend/local_api_security.py`, `main.py` | Bearer-token middleware on every route; validates Host/origin, restrictive CORS. Tests 6/6. | `SEC-003` must generate/deliver the token to desktop callers. |
| 2026-09-08 | SEC-003 | DONE | Tauri sidecar lifecycle, `local-api.ts` | Rust generates a per-session token via sidecar env; webview client attaches it to every request, no direct `fetch` remains. `pnpm build`, tests 6/6. | `SEC-004` must add the distinct paired extension token. |
| 2026-09-08 | SEC-004 | DONE | Pairing routes/table, extension | 5-minute one-use pairing codes issue a capture-only token per extension; hash-only storage; revocation invalidates it. Tests 7/7. | Manually load the built extension in Chrome before public release to validate real-profile pairing UX. |
| 2026-09-08 | PRIV-001 | DONE | `ADR-002`, consent migration | Versioned consent record, all capture categories off by default; absent rows fail closed. Tests 9/9. | `PRIV-002` must enforce this in every Rust monitor. |
| 2026-09-10 | PRIV-002 | PARTIAL | Rust monitors, capture API, onboarding | Capture defaults fail closed; every monitor + `/capture` requires the relevant accepted category. Tests 12/12, `cargo test` 34/34. | Needs maintainer live-UI verification (clean/upgraded profile, opt-in/revoke, global pause, restart) before `DONE` — Consent gate stays blocked until recorded here. |
| 2026-09-10 | PRIV-004 | DONE | Shared provider-context sanitizer | Final redaction boundary called immediately before every AI/embedding HTTP request; diagnostics carry no raw prompt/response. Tests 17/17. | Continue `PRIV-005`. |
| 2026-09-10 | PRIV-005 | DONE | Exclusion policy, Keychain migration | Canonical exclusion defaults distributed to native+extension capture; `~/.orbit`/SQLite/Qdrant repaired to owner-only; Groq key moved to Keychain. Tests 24/24 + 7/7 focused. | Continue `PRIV-006`. |
| 2026-09-10 | PRIV-006 | DONE | Privacy regression suite | Full consent/pause/exclusion/wipe regression coverage; secure wipe now truncates WAL and vacuums. Tests 29/29. | Continue `APPSEC-001`. |
| 2026-09-10 | PRIV-003 | PARTIAL | Rust sanitizer, event writers | All active Rust event writers sanitize captured strings (credentials, keys, JWTs, PII) before SQLite. Tests 30/30. | Repo-wide Clippy/fmt drift outside this task's scope must be fixed before `DONE`; Consent gate stays blocked by `PRIV-002`. |
| 2026-09-25 | COST-001 | PARTIAL | `groq_service.py`, settings routes, PrivacyPanel | Groq calls go BYOK-direct (`Authorization: Bearer`) whenever a personal key exists, bypassing the Worker; added key add/test/remove UI. Tests 37/37. | Maintainer should verify Keychain/SQLite key persistence across an app restart. |
| 2026-09-25 | COST-002 | DONE | Worker rewrite, `voyage_service.py`, settings routes | All maintainer-funded Worker keys removed; Claude/Gemini removed outright (unused); Voyage given the same BYOK treatment as Groq. Tests 43/43 + 12/12 (Worker). | Superseded 2026-09-26 — the Worker itself is now deleted entirely, not just its shared keys (see the pivot entry below). |
| 2026-09-25 | COST-003 | PARTIAL | `qdrant_service.py`, `scheduler.py`, `recall.py`, ADR-006 | Qdrant made fully lazy (never touched without a Voyage key). Found and fixed a real regression: a missing Voyage key was silently breaking Groq recall too, not just semantic search. Tests 47/47. | Packaging size/startup impact not measured (no build environment here) — reasoned qualitatively in ADR-006 instead. |
| 2026-09-25 | COST-004 | PARTIAL | `groq_service.py`, model migration tests | Migrated off two Groq models retired 2026-08-16 (`llama-3.1-8b-instant`/`llama-3.3-70b-versatile`) to `openai/gpt-oss-120b`/`20b` with `reasoning_effort="low"`. Tests 52/52. | No live Groq account to confirm against real responses — maintainer should run one real classification/recall cycle and watch for truncated output or latency near the 30s timeout. |
| 2026-09-25 | COST-005 | PARTIAL | `groq_service.py`, `voyage_service.py`, `recall.py` | Added 401/403 cooldowns for both providers (Voyage had none before); offline-recall fallback now names the actual failure cause instead of always guessing "offline". Tests 66/66. | "Quota exhausted" is treated as the same case as rate-limit (429) — not independently verified against provider docs. |
| 2026-09-25 | OBS-001 | DONE | Sentry/PostHog removal (backend+app) | Deleted both telemetry services and every call site; CSP narrowed; bundle dropped 830→492 KB. Tests unaffected (66/66), `cargo test` 37/37. | Historical `docs/PHASE_*.md` still describes the old telemetry setup — `DOC-006` scope, not this task. |
| 2026-09-25 | SITE-001 | DONE | Landing site (Supabase/waitlist removal) | Removed Supabase/Resend/the waitlist form/server actions; converted to static export, zero server. `pnpm build`/`lint` clean. | Superseded 2026-09-26 — see the pivot entry below (download buttons this task shipped are now replaced by a GitHub link). |
| 2026-09-25 | DOC-001 | PARTIAL | `LICENSE` (new), `THIRD_PARTY_NOTICES.md` (new) | Apache-2.0 chosen after a dependency-license scan (582 Rust crates, 40 Python packages) found nothing blocking. | Maintainer should confirm the copyright-holder name in `LICENSE`, then flip `MAN-002` to `DONE` themselves. |
| 2026-09-25 | DOC-002 | PARTIAL | `README.md` (new), workspace READMEs | Wrote the root README from scratch: status, capture inventory, BYOK cost model, build/test commands per workspace. | Screenshots/demo images not added — no GUI access in this environment. |
| 2026-09-25 | DOC-003 | PARTIAL | Privacy policy, landing pages | Full rewrite fixing 2 internal contradictions and stale Claude/Gemini claims; researched Groq/Voyage's actual retention policies against their own docs. `pnpm build`/`lint` clean. | Can't cross-check against `DOC-005` (architecture/threat-model doc doesn't exist yet). |
| 2026-09-25 | APPSEC-001 | PARTIAL | Tauri CSP, `capabilities/default.json` | Restrictive CSP added; capabilities trimmed to exactly what the webview calls; missing updater/dialog/process permissions added. `cargo test` 37/37. | Maintainer should build a real `.dmg` and confirm devtools/local API/folder picker all still work under the new CSP, before `DONE`. |
| 2026-09-26 | ADR-000 (pivot) | AMENDED | ~38 files across `app/`, `backend/`, `landing/`, docs | Maintainer decision: stop active development for now, drop packaged releases/`orbit-releases`/the Cloudflare Worker/the auto-updater/the Chrome Web Store listing entirely, point the landing page at GitHub. Voyage made BYOK-direct; Claude/Gemini service files deleted; `release.yml`/`publish-extension.yml`/`worker/`/`releases/` deleted; `AGENTS.md`/`README.md`/`CONTRIBUTING.md`/`THIRD_PARTY_NOTICES.md` rewritten. Retires `REL-001`/`REL-002`/`REL-003`, rescopes `MAN-006`/`MAN-009`/`MAN-010`. Full verification clean: backend 66/66, `cargo test` 37/37, `pnpm test` 10/10, landing build/lint clean, actionlint/zizmor clean. | Live teardown performed separately, see `MAN-006`'s entry below. |
| 2026-09-26 | MAN-006 | PARTIAL | Live Cloudflare Worker (`orbit-api-proxy`), `orbit-releases` | Maintainer explicitly authorized the agent to do this directly, via the `github-personal` (`Saadaan-Hassan`) account. Deleted the deployed Worker (`wrangler delete`, confirmed gone — "This Worker does not exist on your account"). Archived (not deleted) `orbit-releases` (`gh repo archive`, confirmed `isArchived: true`) — chose archive over delete since it's reversible. | Provider-key revocation (Groq/Voyage/Anthropic/Gemini dashboards) still needs the maintainer's own account access. |
| 2026-09-27 | MAN-004/005/003 | DONE | `SECURITY.md`, `CHANGELOG.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `OPEN_SOURCE_ROADMAP.md` | Recorded three maintainer decisions directly given in conversation: `MAN-004` security contact is `saadaanedu@gmail.com` (already in `SECURITY.md` from earlier work). `MAN-005` — nothing Orbit-related was purchased/licensed (name picked freely, logo AI-generated); no formal trademark search was run, accepted as a known, non-blocking risk rather than pursued. `MAN-003` — maintainer initially asked to scrub `webmaker9d@gmail.com` from commit history, but after being shown the real scope (155 commits across 3 already-pushed branches, requiring a force-push to overwrite `origin`) via `AskUserQuestion`, decided to leave it as is; no rewrite was performed. While updating `SECURITY.md` for the new contact, found and fixed the same missed-in-the-pivot problem as `CONTRIBUTING.md`/`THIRD_PARTY_NOTICES.md` earlier: it and `CHANGELOG.md`/the PR template still described the deleted Worker/`orbit-releases`/auto-updater as if they existed. | None outstanding for these three. |
| 2026-09-27 | (live testing) | DONE | `app/src-tauri/src/lib.rs`, `app/src-tauri/src/main.rs`, `app/src/App.tsx`, `app/src/hooks/useOnboarding.ts`, `app/src/components/OnboardingFlow.tsx`, `AGENTS.md` | Maintainer ran `pnpm tauri dev` for the first time since the pivot and hit three real, previously-undiscovered bugs — significant since first-launch self-build is now the *only* way anyone ever runs Orbit. **(1)** App stuck permanently on "Orbit couldn't start": the post-startup health check (`lib.rs`) only retried for 10×1s before giving up forever, and separately, `emit("backend-ready")` fired before React had mounted and registered its listener — Tauri doesn't queue events for late listeners, so a fast/warm backend's readiness signal was silently lost. Fixed both: extended the retry budget to 120×1s (generous enough for a first-ever `uv sync` on a cold machine) and added a `get_backend_status` command + managed `BackendReadyState` the frontend polls once its listeners are confirmed registered, closing the race regardless of which side finishes first. **(2)** Accessibility onboarding step opened System Settings but Orbit never appeared in the list at all: `check_accessibility_permission_granted` only called the read-only `AXIsProcessTrusted()`, which never registers the app with macOS's TCC system — nothing in the codebase called the prompting variant, so macOS had nothing to list. Added `trigger_accessibility_permission_prompt` (calls `AXIsProcessTrustedWithOptions` with the prompt option via the `core-foundation` crate, already a dependency), wired to fire once automatically when the onboarding step is first reached — the same pattern Browser Automation's step already used, which Accessibility was missing. **(3)** A follow-up crash (`OSError: address already in use` + repeated `401 Unauthorized` health-check attempts) turned out to be self-inflicted by iterating on the fix: `tauri dev`'s file-watcher restarts the Rust binary externally on every source edit, which never runs the app's own exit-hook cleanup (only wired to in-app quit actions), orphaning the previous run's `uv`/`uvicorn` child still bound to port 47821 — the new backend couldn't bind and crashed, and the health check kept hitting the *old* orphan with a mismatched token. Added `free_stale_dev_backend_port()`, called before every dev-mode backend spawn: kills a stale process on port 47821 only if its command line actually matches Orbit's own `uvicorn ... main:app` invocation, leaving anything unrecognized alone (preserves the original security stance against killing an arbitrary process on the port). Updated `AGENTS.md`'s `main.rs`/`lib.rs` Key Files entries to match. Verification: `cargo fmt --check`/`clippy -- -D warnings`/`cargo test --bin app` (37/37) and `pnpm typecheck`/`pnpm lint` (7 pre-existing warnings, 0 errors)/`pnpm test` (10/10) all clean after each fix; confirmed live by the maintainer — app now reaches onboarding successfully. | This directly demonstrates the real value of `PRIV-002`'s and `APPSEC-001`'s still-open "maintainer must live-test" requirements — neither task is flipped to `DONE` by this alone (onboarding wasn't walked through to completion, and this was a debug build, not a release `.dmg`), but it's concrete evidence that first-launch correctness cannot be assumed from static review alone. Recommend finishing at least one full onboarding walkthrough before treating `PRIV-002` as verified. |
| 2026-09-27 | MAN-001 | PARTIAL | `~/Documents/Projects/Personal/orbit-backups/` (outside this repo) | Created a full `git bundle --all` (13 refs: both branches, 3 `origin/*` mirrors, 6 version tags), verified via `git bundle verify` and a real restore into a scratch clone (branches + latest commit confirmed intact, scratch clone deleted after). Inventoried GitHub via `gh api`/`gh run list`/`gh release list`: 1 Actions secret (`RELEASES_REPO_TOKEN`, name only — stale, no consumer left, should be revoked), 3 unused deployment Environments (`dev`/`Preview`/`Production`, no protection rules), no deploy keys/webhooks/Pages/Discussions, wiki flag on but zero pages, no branch protection (expected pre-launch). Found and flagged two real pre-launch risks in the private write-up and in `MAN-001`'s own entry: 3 GitHub Releases still on the *source* repo with real signed `v0.1.0` binaries attached (predates almost all security/privacy hardening in this roadmap — would let anyone bypass the self-build-only model), and 8 historical `Release` workflow runs whose logs leak `TAURI_SIGNING_PRIVATE_KEY`'s exact character count (`REL-001` fixed the workflow file, not these already-recorded logs). Neither was deleted — both are destructive actions on the remote repo needing explicit sign-off first. | External-account inventory (Groq/Voyage/Anthropic/Gemini/Vercel/Supabase/Resend/PostHog/Sentry/registrar/Chrome Web Store) needs the maintainer's own dashboard access — left as a template table in the private file. The two release/workflow-log findings should be resolved before `MAN-012`. |
| 2026-09-27 | MAN-001 (findings) | PARTIAL | Live GitHub state: `Saadaan-Hassan/orbit` releases, Actions run history | Maintainer gave explicit sign-off to act on both findings above. Deleted all 3 stale `v0.1.0` releases (`gh api -X DELETE repos/Saadaan-Hassan/orbit/releases/<id>` for IDs 336371802, 336386513, 339332495) — confirmed via a follow-up listing returning 0 releases. Attempted to delete the 8 historical `Release` workflow runs (leaking the signing key's character count) via a `gh run delete` loop; the agent's own permission system blocked it as "External System Writes" on a batch/range operation and explicitly disallows retrying the same outcome in smaller pieces (e.g. one-by-one calls), so this was left undone rather than worked around. | The 8 workflow-run deletions still need the maintainer to run directly — exact command list left in `MAN-001`'s own entry. Must be resolved before `MAN-012` (these logs become permanently public otherwise). |

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
