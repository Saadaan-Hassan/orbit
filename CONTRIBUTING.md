# Contributing to Orbit

Thanks for considering a contribution. Orbit is a solo-maintainer,
beta-stage project — this doc sets expectations so your time (and the
maintainer's review time) isn't wasted.

Read [`AGENTS.md`](AGENTS.md) first. It's the canonical architecture
reference — data flow, tech stack, file-by-file responsibilities, code
style, and a `DO NOT` list of things that have already been tried, reverted,
or ruled out for a reason. A PR that reintroduces something on that list
will be asked to explain why the reasoning no longer applies, not just
merged around it.

## Picking a task

- **Bug fixes and small, self-contained improvements**: just send a PR.
- **Anything that touches capture, redaction, AI provider calls, or the
  privacy model**: open an issue first and describe the change before
  writing code. These are the highest-risk parts of the codebase — see
  [Privacy and safety rules](#privacy-and-safety-rules) below.
- **New capture types, new AI providers, schema changes, or anything
  architectural**: open an issue first. See [`GOVERNANCE.md`](GOVERNANCE.md)
  for how these get decided.
- **Features listed as future/unbuilt phases in `AGENTS.md`** (Windows
  support, voice, screenshots): these have a rough shape already planned.
  Ask before building, so work isn't duplicated or built against a stale
  assumption.

Don't send large, unsolicited refactors. `AGENTS.md`'s `DO NOT` section
explicitly rules out "add features, refactors, or improvements beyond exact
scope" — that rule applies to contributions too, not just AI-assisted
changes.

## Development setup

Four independent workspaces — you generally only need the one you're
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

**Cloudflare Worker** (BYOK passthrough — holds no secrets, nothing to
configure locally):
```bash
cd worker && npm install && npx wrangler dev
```

**Landing site** (static Next.js export):
```bash
cd landing && pnpm install && pnpm dev
```

## Tests

Run the relevant workspace's suite before sending a PR:

```bash
cd backend && uv run python -m unittest discover -s tests -p 'test_*.py'
cd app/src-tauri && cargo test --bin app
cd worker && npm run test
cd app && pnpm build   # TypeScript + production build
```

If you bumped the app version (`app/src-tauri/tauri.conf.json`), backend, or
extension version, also run `sh scripts/check-versions.sh` from the repo
root — it checks that `app/package.json`, `Cargo.toml`, and
`backend/pyproject.toml` all agree with `tauri.conf.json`, and that
`extension/package.json` agrees with `extension/manifest.json`.

Changes to capture, redaction, or AI provider request/response handling
need test coverage — these paths handle real personal data, and a
regression here is a privacy incident, not just a bug.

## Privacy and safety rules

Non-negotiable, enforced in review regardless of how the PR is otherwise
scoped:

- **Secrets are redacted before any disk write**, in Rust (`clipboard.rs`)
  and Python (`redaction_service.py`) — never after, never only at display
  time.
- **No new AI provider integration** without a BYOK (bring-your-own-key)
  design and a real plan for keeping any Worker route safe from anonymous
  abuse. There is no maintainer-funded key for anything, by design
  (`COST-001`/`COST-002` in `AGENTS.md`) — don't reintroduce one.
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

- One logical change per PR. Split unrelated fixes into separate PRs even
  if you noticed them in the same session.
- Reference the issue you opened (or explain why one wasn't needed) in the
  PR description.
- Fill in the PR template's checkboxes honestly, including the
  data-flow/privacy and cost sections — a "no changes here" answer is fine
  when it's true, but an unfilled checkbox reads as unreviewed.
- The maintainer decides what merges, including scope and timing. See
  [`GOVERNANCE.md`](GOVERNANCE.md).

## Release boundaries

Contributors don't cut releases. Tags (`v*` for the app, `ext-v*` for the
Chrome extension) are pushed by the maintainer once a change set is judged
ready — see the `Release & Distribution` section of `AGENTS.md` for what
that triggers. Don't bump version numbers in a contribution PR unless asked
to as part of the change.
