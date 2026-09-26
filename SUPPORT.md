# Support

Orbit is not actively maintained (see [`GOVERNANCE.md`](GOVERNANCE.md)).
There is no support team, no SLA, and realistically no guarantee anyone
will see or respond to an issue at all — not "best-effort," just genuinely
unstaffed.

## Before you file anything

Most "is this expected?" questions are already answered without needing a
response from anyone:

- [README.md](README.md)'s Known Limitations section
- [`AGENTS.md`](AGENTS.md) — the full architecture reference, including
  what's built, what's planned-but-unbuilt, and documented `DO NOT`s
- [`OPEN_SOURCE_ROADMAP.md`](OPEN_SOURCE_ROADMAP.md) — the audit trail of
  what was decided, when, and why
- `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, and
  `docs/PRIVACY_DATA_FLOW.md` for how data moves through the app

## If you still want to file something

Issues and pull requests are open on GitHub and you're welcome to use
them — for your own record, for a future contributor who finds the same
problem, or on the chance someone does pick this project back up. Just
don't expect a reply. A private disclosure route is still available for
anything sensitive:

- **Security vulnerability** — do not use a public issue. See
  [`SECURITY.md`](SECURITY.md).
- **Privacy concern** — use the Privacy Concern issue template, or email
  saadaanedu@gmail.com if you'd rather not make it public. Same caveat: no
  guaranteed response.

## What isn't in scope here, response or not

- General macOS, Tauri, Rust, or FastAPI troubleshooting unrelated to Orbit
  itself — the relevant upstream project's own support channels are a
  better bet.
- Feature requests for phases already listed as future/unbuilt in
  `AGENTS.md` (Windows support, voice, screenshots) — filing a duplicate
  won't change their status.

## Want this actually maintained?

Fork it. See [`GOVERNANCE.md`](GOVERNANCE.md) — that's explicitly what this
project's open-source release is for.
