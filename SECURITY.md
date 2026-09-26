# Security Policy

## Supported versions

Orbit is source-only and self-build — there are no packaged releases or
version numbers to track (see `AGENTS.md`'s `Distribution` section). Only
the latest commit on the default branch is supported. Before reporting an
issue, pull the latest source, rebuild (`pnpm tauri build`), and confirm it
still reproduces.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.** Orbit
captures activity data directly off a user's Mac, so a capture, storage, or
redaction bug can expose real personal data — treat anything in that
category as sensitive until triaged.

Report privately using either of these:

- **[GitHub Private Vulnerability Reporting](https://github.com/Saadaan-Hassan/orbit/security/advisories/new)**
  (preferred — keeps the whole exchange, including any patch, out of public
  view until a fix ships)
- **Email**: saadaanedu@gmail.com

Include what you can:

- The affected component (Rust capture module, FastAPI route, Tauri IPC
  command, extension, landing site)
- Steps to reproduce, or a proof of concept
- What data or capability is exposed, and to whom (local-only vs.
  network-reachable)
- macOS version, and the commit/branch you built from

## What counts as a security issue here

Given what Orbit does, treat these as security reports, not ordinary bugs:

- A capture path that writes unredacted secrets (API keys, private keys,
  credit card/SSN patterns, crypto addresses) to SQLite
- `AXSecureTextField` (password field) content becoming readable through
  the on-screen capture path
- Any AI provider call that receives more than the documented redacted
  fields, or that fires without a configured personal key
- A way to read, modify, or exfiltrate another user's local `~/.orbit/`
  data
- Any path that sends captured data anywhere other than directly to the
  user's own configured AI provider (BYOK) — there is no maintainer-run
  server of any kind in between, by design (see `AGENTS.md`'s
  `Distribution` section)

General crashes, UI bugs, and capture accuracy issues are ordinary bugs —
file those as a normal GitHub issue instead.

## Disclosure expectations

**This project is not actively maintained** (see
[`GOVERNANCE.md`](GOVERNANCE.md)) — there is no dedicated security team, and
realistically no guarantee a report gets read at all, let alone acted on.
This isn't a "best-effort, response within a few days" situation; it's
genuinely unstaffed. Private reporting is still the right move over a
public issue regardless — it costs you nothing extra, and it means a
finding doesn't sit publicly exploitable in the meantime if someone
eventually does pick this project back up (via GitHub's own retention of
private advisories, or your own copy of the email).

If a maintainer does become active again, the intent would be: private
disclosure preserved and triaged first, credit given in the security
advisory and/or commit message unless you ask to stay anonymous, and no
public disclosure before a fix exists or the reporter agrees otherwise.
None of that is a promise this repo can currently keep — treat it as what
a response would look like *if* one comes, not a commitment that it will.
