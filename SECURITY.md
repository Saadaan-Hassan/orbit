# Security Policy

## Supported versions

Orbit is in beta (`v0.2.x`). Only the latest published release is
supported — there is no parallel maintenance of older versions. Update to
the latest `.dmg` from
[orbit-releases](https://github.com/Saadaan-Hassan/orbit-releases/releases/latest)
(or let the in-app auto-updater do it) before reporting an issue you
haven't confirmed still reproduces.

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
  command, Cloudflare Worker, extension, landing site)
- Steps to reproduce, or a proof of concept
- What data or capability is exposed, and to whom (local-only vs.
  network-reachable)
- Orbit version and macOS version

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
- Any path that sends captured data to Orbit's Cloudflare Worker or
  landing infrastructure in a way that isn't a direct BYOK passthrough
  documented in `AGENTS.md`
- Auto-updater signature verification bypass

General crashes, UI bugs, and capture accuracy issues are ordinary bugs —
file those as a normal GitHub issue instead.

## Disclosure expectations

This is a solo-maintainer project without a dedicated security team.
Response times are best-effort, not contractual:

- Acknowledgement: within a few days
- Initial assessment (confirmed / not a vulnerability / needs more info):
  as soon as practical after that
- Fix and coordinated disclosure timeline: agreed with the reporter once
  the report is confirmed, scaled to severity

Public disclosure happens after a fix is available, or by mutual agreement
with the reporter if a fix isn't feasible in a reasonable timeframe. Credit
is given in the release notes and/or security advisory unless you ask to
stay anonymous.
