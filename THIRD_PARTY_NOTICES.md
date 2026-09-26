# Third-Party Notices

Orbit is released under the Apache License, Version 2.0 (see `LICENSE`).
This file records the results of a dependency-license review across all
four workspaces, as required by `DOC-001`.

**Scope note:** this covers *software dependencies* only (everything
resolved by pnpm/cargo/uv across `app/`, `app/src-tauri/`, `backend/`,
and `landing/`). It does not cover non-code assets (fonts,
icons, images, the app logo) — those require the maintainer's own
redistribution-rights review (`MAN-005`), which has not happened yet. This
file should be revisited once that's done, in case it surfaces additional
attributions.

## Summary

A review of all direct and transitive dependencies across all four
workspaces (582 Rust crates, 40 resolved Python packages, and the pnpm/npm
trees for `app/` and `landing/`) found:

- **No copyleft license that propagates to Orbit's own source** (no GPL,
  AGPL, or SSPL anywhere, direct or transitive).
- **No dependency with a missing, unknown, or non-standard/proprietary
  license.**
- All direct dependencies in every workspace are MIT, Apache-2.0, BSD, or
  ISC.

A few items are worth recording even though none of them are blocking:

### GPL-licensed, dev-tooling only — never distributed as part of Orbit

- **PyInstaller** (`backend`, a `dependency-groups.dev` entry — builds the
  bundled `orbit-backend` sidecar binary) and **`pyinstaller-hooks-contrib`**
  are GPLv2 (PyInstaller's own license includes an explicit bootloader
  exception permitting the *frozen executable it produces* to be
  distributed under any license). Neither ships as source with Orbit or is
  imported by Orbit's own code at runtime — they're build-time tooling only.

### Weak (file-level) copyleft — used unmodified, does not propagate

- **MPL-2.0**: `lightningcss` (transitive via Tailwind CSS v4, in `app/`
  and `landing/`), `axe-core` (accessibility test tooling, `landing/`),
  `certifi` (CA certificate bundle, `backend/`), and the Servo CSS stack
  pulled in transitively via Tauri in Rust (`cssparser`, `selectors`,
  `webpki-roots`, `dtoa-short`, `option-ext`). MPL-2.0 only requires that
  *modified files* of the covered work remain MPL-licensed — using these
  unmodified as libraries/build tooling does not affect Orbit's own license.

### LGPL, dynamic-link only — never bundled into Orbit's own source

- **`@img/sharp-libvips-*`** native binaries, transitive via `sharp` — an
  optional dependency pulled in by Next.js's image tooling (`landing/`).
  LGPL-3.0-or-later permits this as a dynamically-linked runtime
  dependency of build tooling.

### Not what the name suggests

- **`BSL-1.0`** appears on two Rust crates (`clipboard-win`, `error-code`)
  — this is the **Boost Software License**, a short, permissive, OSI-approved
  license. It is unrelated to the "Business Source License," which also
  abbreviates to BSL and is *not* present anywhere in this project.

### Attribution-only data, not code

- **`caniuse-lite`** (browser compatibility data, transitive via build
  tooling) is CC-BY-4.0 — a data license requiring attribution, not a
  software license. Not a redistribution concern for Orbit's own source.

## Method

Reviewed via each workspace's lockfile plus each ecosystem's dependency
tree (`cargo metadata` for Rust, `uv`/`pyproject.toml` for Python,
`pnpm`/`package.json` for the three JS/TS workspaces). No dependency was
found with a license this review could not identify.

## NOTICE and TRADEMARKS.md

- **No root `NOTICE` file** — Apache-2.0 only requires one when a covered
  work itself ships a `NOTICE` file whose attributions must propagate.
  This review did not find such a dependency; revisit if one is added later.
- **No `TRADEMARKS.md`** — conditional on `MAN-005` deciding whether "Orbit"
  and its logo are reserved trademarks. That decision has not been made yet.
