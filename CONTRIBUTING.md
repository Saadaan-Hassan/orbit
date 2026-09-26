# Contributing to Orbit

**This project is not actively maintained** (see
[`GOVERNANCE.md`](GOVERNANCE.md)) — pull requests may not be reviewed or
merged, regardless of quality, and issues may not get a response. This
document isn't a guide to getting something merged; it's a description of
the conventions this codebase was built with, kept here for anyone who
forks it and wants to build on it consistently, or on the small chance
someone does pick up maintenance later.

Read [`AGENTS.md`](AGENTS.md) first. It's the canonical architecture
reference — data flow, tech stack, file-by-file responsibilities, code
style, and a `DO NOT` list of things that have already been tried, reverted,
or ruled out for a reason, along with why. If you're extending this
codebase (in a fork or otherwise), that reasoning is worth understanding
before reintroducing something on that list.

## Picking a task

Since nobody's triaging issues (see the notice above), "open an issue
first" won't get you a design discussion the way it would on an actively
maintained project — treat the guidance below as what a careful contributor
would do anyway, not a step that unblocks a response:

- **Bug fixes and small, self-contained improvements**: just send a PR.
- **Anything that touches capture, redaction, AI provider calls, or the
  privacy model**: these are the highest-risk parts of the codebase — see
  [Privacy and safety rules](#privacy-and-safety-rules) below, and be
  extra sure your change is deliberate, not incidental.
- **New capture types, new AI providers, schema changes, or anything
  architectural**: read `AGENTS.md`'s `DO NOT` section and `docs/adr/`
  first — several things in this category were already tried and reverted
  for documented reasons.
- **Features listed as future/unbuilt phases in `AGENTS.md`** (Windows
  support, voice, screenshots): these have a rough shape already planned
  there; worth reading before building something that conflicts with it.

Don't send large, unsolicited refactors. `AGENTS.md`'s `DO NOT` section
explicitly rules out "add features, refactors, or improvements beyond exact
scope" — that rule applies to contributions too, not just AI-assisted
changes.

## Development setup

Three independent workspaces — you generally only need the one you're
changing.

**Desktop app** (Tauri v2 + React + Rust):
```bash
cd app && pnpm install && pnpm tauri dev
```

**Backend** (FastAPI, Python — `uv` only, never `pip`):
```bash
cd backend && uv sync
uv run uvicorn main:app --reload --port 47821
```

**Landing site** (static Next.js export):
```bash
cd landing && pnpm install && pnpm dev
```

## Tests

Run the relevant workspace's checks before sending a PR — each workspace
has real lint/typecheck/test commands, not placeholders (`CI-001`). All of
this also runs automatically on every pull request via
`.github/workflows/ci.yml` (`CI-002`), plus a secret scan and a dependency
review — but running it locally first means you're not waiting on CI to
find out something fails:

**Backend** (Python — ruff for lint, mypy for types, unittest for tests):
```bash
cd backend
uv run ruff check .
uv run mypy .
uv run python -m unittest discover -s tests -p 'test_*.py'
```

**Desktop app, Rust side** (`app/src-tauri`):
```bash
cd app/src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --bin app
```

**Desktop app, frontend** (`app`):
```bash
cd app
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

**Chrome extension**:
```bash
cd extension
pnpm typecheck
pnpm test
pnpm build
```

**Landing site** (no test suite — it's a static site; lint + a successful
static build are the checks):
```bash
cd landing
pnpm lint
pnpm build
```

If you bumped the app version (`app/src-tauri/tauri.conf.json`), backend, or
extension version, also run `sh scripts/check-versions.sh` from the repo
root — it checks that `app/package.json`, `Cargo.toml`, and
`backend/pyproject.toml` all agree with `tauri.conf.json`, and that
`extension/package.json` agrees with `extension/manifest.json`.

Changes to capture, redaction, or AI provider request/response handling
need test coverage — these paths handle real personal data, and a
regression here is a privacy incident, not just a bug. None of these tests
make a real network/provider call: backend tests mock every provider HTTP
call (`_SequencedPostClient`-style test doubles), and the JS/TS test suites
(app, extension) only cover pure logic with no network dependency.

## Dependency security and license scanning

Not run on every PR, but check periodically or after adding a dependency —
these aren't wired into a required CI gate yet:

```bash
# JS/TS workspaces (app, extension, landing) — pnpm's built-in scanner
cd app && pnpm audit        # or extension, landing

# Python
cd backend && uvx pip-audit

# Rust (one-time: cargo install cargo-audit --locked)
cd app/src-tauri && cargo audit
```

`cargo audit` will likely report a handful of `unmaintained`/`unsound`
warnings on transitive dependencies of Tauri's own dependency tree that
aren't fixable from this repo (no patched version exists upstream, or the
crate is genuinely unreachable from any build target despite appearing in
`Cargo.lock` — verify with `cargo tree -i <crate> --target all` before
assuming a finding is real). Real, fixable findings should be addressed
(bump the direct dependency, or add a `pnpm.overrides`-equivalent — see
each workspace's `pnpm-workspace.yaml` if one exists) rather than ignored.

## Privacy and safety rules

Non-negotiable, enforced in review regardless of how the PR is otherwise
scoped:

- **Secrets are redacted before any disk write**, in Rust (`clipboard.rs`)
  and Python (`redaction_service.py`) — never after, never only at display
  time.
- **No new AI provider integration** without a BYOK (bring-your-own-key)
  design — calls go directly from this Mac to the provider's own API with
  the user's own key, never through a relay. There is no maintainer-funded
  key for anything, and no maintainer-run infrastructure of any kind, by
  design (`COST-001`/`COST-002` in `AGENTS.md`) — don't reintroduce either.
- **No remote telemetry, analytics, or crash reporting of any kind** —
  removed deliberately (`OBS-001`). If you think this should change, open
  an issue first; it needs a genuine opt-in/revoke design, not a dependency
  add.
- **`AXSecureTextField` (password fields) is never read**, at any
  traversal depth, by the on-screen capture path. Don't touch
  `screen_content.rs`'s traversal logic without preserving this check.
- **Never log, store, or transmit keystroke content, key codes, mouse
  coordinates, or click targets.** Idle detection is a timer only.
- Full rules: the `Security & Privacy Rules` and `DO NOT` sections of
  `AGENTS.md`.

## Commit sign-off (DCO)

Every commit must include a `Signed-off-by` trailer certifying you wrote
it or otherwise have the right to submit it under this project's license
(the [Developer Certificate of Origin](https://developercertificate.org/)).
Add it with:

```bash
git commit -s -m "your message"
```

This is **not** a CLA — you keep copyright over your own contribution.
Orbit doesn't require a separate contributor license agreement.

## Pull request scope

These are still good practice even with no one guaranteed to review the
result:

- One logical change per PR. Split unrelated fixes into separate PRs even
  if you noticed them in the same session.
- Fill in the PR template's checkboxes honestly, including the
  data-flow/privacy and cost sections — a "no changes here" answer is fine
  when it's true, but an unfilled checkbox is a poor record for whoever
  (including future-you) reads this PR later.
- If a maintainer does become active again, see
  [`GOVERNANCE.md`](GOVERNANCE.md) for how merge decisions would be made.

## Release boundaries

Nobody cuts releases — there's no release process to trigger. Orbit is
source-only and self-build: no signed `.dmg`, no `orbit-releases` companion
repo, no Chrome Web Store listing, no auto-updater. See the `Distribution`
section of `AGENTS.md` for the full reasoning. Don't bump version numbers
in a contribution PR unless asked to as part of the change.
