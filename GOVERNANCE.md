# Governance

## Model

Orbit is currently maintained by a single maintainer, [Saadaan
Hassan](https://github.com/Saadaan-Hassan), who has final say over
architecture, scope, and what merges. There is no formal steering committee
or voting process — this reflects the project's actual size, not a
long-term commitment to staying that way.

## Decision-making

- **Day-to-day changes** (bug fixes, small features, docs): reviewed and
  merged by the maintainer directly, or by anyone with `CODEOWNERS` review
  rights once such people exist.
- **Architectural or scope changes** (new capture types, new AI providers,
  changes to the privacy model, breaking API/schema changes): require the
  maintainer's sign-off. Open an issue to discuss before sending a large
  PR — see `CONTRIBUTING.md`.
- **Security issues**: follow `SECURITY.md`, not this process.

## Becoming a maintainer

Not formalized yet. Sustained, high-quality contributions (especially
around capture correctness, privacy/redaction, or the Rust/Tauri layer)
are the path to being asked. There's no application process to apply to.

## Changes to this document

This file describes the project as it actually runs today. If that changes
(e.g. a second maintainer joins, a review-rights model is formalized), this
file is updated to match — it isn't meant to be aspirational.
