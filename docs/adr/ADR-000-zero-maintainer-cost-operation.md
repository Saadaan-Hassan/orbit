# ADR-000: Zero-maintainer-cost, BYOK-only operation

- **Status:** Accepted, 2026-09-06 — amended 2026-09-26
- **Date:** 2026-09-06 (amended 2026-09-26)
- **Deciders:** Orbit maintainer

## Context

Orbit's desktop binaries originally called an unauthenticated Cloudflare
Worker that could spend maintainer-owned Groq, Voyage, Anthropic, and Gemini
API keys. Public distribution makes a universal shared credential impossible
to protect — anyone could extract and abuse it, and the maintainer would be
the one billed.

## Decision

- AI is optional and BYOK (bring your own key). User-supplied provider
  credentials are stored in macOS Keychain and used directly over the
  provider's own HTTPS API — never through a maintainer-run relay.
- No maintainer-owned provider key is shipped, used as a fallback, or
  exposed through a public proxy, for any provider.
- SQLite FTS5 is the default local/offline retrieval engine; it needs no key
  and no network access.
- Semantic embeddings (Voyage AI) are optional and fully lazy — nothing is
  initialized or called without a personal key.
- The landing page is fully static and stores no email addresses or other
  personal data.
- No telemetry or crash reporting (Sentry, PostHog, or equivalent) ships in
  the app, by default or otherwise.

**Amended 2026-09-26:** the maintainer decided to stop active development
for now and publish the repository as a fully open, source-only reference —
not just zero maintainer-*paid* infrastructure, but zero maintainer-run
infrastructure of any kind. This superseded two narrower parts of the
original decision:

- The Cloudflare Worker was **removed entirely**, not kept as an optional
  self-hosting template. `worker/` no longer exists in this repository;
  both Groq and Voyage calls are BYOK-direct from the backend.
- There is no packaged, signed release build of any kind. The former
  `orbit-releases` companion repo, the in-app Tauri auto-updater, and the
  Chrome Web Store extension listing were all retired outright. Anyone who
  wants to run Orbit clones this repo and builds it themselves — see the
  root [`README.md`](../../README.md) and `docs/ARCHITECTURE.md`'s
  `Distribution model` section.

## Consequences

**Positive:**

- Public adoption cannot create an AI bill for the maintainer, ever.
- The application remains fully useful offline (keyword search, no cloud AI).
- Users control whether their captured data ever reaches a third party.
- The architecture is simple to audit and self-host: no hidden relay, no
  shared credential, no server the maintainer operates.

**Negative:**

- Cloud AI setup has more friction — users need their own Groq/Voyage
  account and key, rather than it working out of the box.
- FTS5 keyword retrieval is less semantically capable than remote
  embeddings when no Voyage key is configured.
- Unsigned, non-notarized, self-build-only macOS distribution has more
  friction than a signed `.dmg` would (though no Gatekeeper "unidentified
  developer" warning, since a locally-built `.app` never carries the
  quarantine flag a downloaded one would).
- No hosted telemetry means no automatic product diagnostics of any kind.

**Neutral:**

- A future sponsor-funded service, if one is ever built, would need to be a
  separate, explicitly authenticated product with its own accounts, quotas,
  rate limits, spend caps, and privacy model — not a retrofit of this one.
