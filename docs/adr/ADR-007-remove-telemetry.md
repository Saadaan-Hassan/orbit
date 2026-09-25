# ADR-007: Remove PostHog and Sentry entirely, rather than building opt-in

## Status

Accepted

## Context

`OBS-001` asks Orbit to either remove PostHog (analytics) and Sentry (crash
reporting) if they aren't essential, or — if kept — put them behind a
genuine, separately-tracked opt-in with a working, immediately-respected
revoke toggle, scrubbing hooks, and documentation of exactly what's sent.
`ADR-000` (accepted 2026-09-06, before any of this code was touched) already
set the target: "Sentry and PostHog are absent from official builds by
default. Future telemetry must be explicit opt-in and independently
revocable."

Before this task, both were wired in but gated only by whether a DSN/API key
was present in the build environment — there was no user-facing consent of
any kind. If a build (official or a maintainer's own) shipped with those
keys set, every user of that build had both telemetry systems active with no
way to see that fact or turn it off. `capture_analytics_event()` also
created a stable anonymous device ID (`~/.orbit/device_id`) the first time
any event fired — again, with no user action or awareness.

## Decision

**Remove PostHog and Sentry entirely** rather than build the opt-in/revoke
system the "keep, but gate" path would have required. This was a deliberate
choice, not the default — the maintainer was asked directly and chose
removal, consistent with `COST-002`'s parallel decision to remove Claude/
Gemini rather than keep them behind more infrastructure.

Removed:
- Backend: `services/analytics_service.py`, `services/sentry_service.py`,
  every `capture_analytics_event(...)` call site, the `posthog`/
  `sentry-sdk[fastapi]` dependencies.
- Frontend: `src/instrument.ts`, `src/hooks/useAnalytics.ts`, the
  `<PostHogProvider>` wrapper in `main.tsx`, every `useAnalytics()`/
  `captureEvent(...)` call site, `Sentry.captureException()` in
  `ErrorBoundary.tsx` (replaced with a local `console.error`), the
  `@sentry/react`/`@sentry/vite-plugin`/`posthog-js`/`@posthog/react`
  dependencies, and the `sentryVitePlugin` + hidden-sourcemap build step in
  `vite.config.ts` (sourcemaps now off entirely — nothing consumes them).
- Rust: the `SIDECAR_POSTHOG_API_KEY`/`SIDECAR_SENTRY_DSN` compile-time
  constants in `lib.rs` and the `.env()` calls that passed them to the
  sidecar process.
- CI: the `VITE_POSTHOG_*`/`VITE_SENTRY_DSN`/`POSTHOG_API_KEY`/
  `SENTRY_DSN_BACKEND`/`SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN`
  secrets from `.github/workflows/release.yml`.
- The Tauri CSP's `connect-src` no longer allowlists `*.posthog.com`/
  `*.i.posthog.com`/`*.sentry.io` (see `ADR-005`'s update note).
- The landing page's privacy policy no longer claims Orbit sends telemetry.

Not removed: the Rust clipboard sanitizer's detection patterns for Sentry
auth tokens and PostHog API keys (`app/src-tauri/src/capture/clipboard.rs`).
Those redact a user's *own* clipboard content if they happen to copy such a
token for an unrelated project — a general secret-detection feature,
unconnected to whether Orbit itself uses either service.

## Consequences

### Positive

- Satisfies `ADR-000`'s target directly and unambiguously: there is nothing
  to configure wrong, no DSN that could accidentally ship active, no consent
  flow to get subtly wrong. "Fresh/default official build sends zero
  PostHog/Sentry requests" is true by construction, not by careful
  configuration.
- No stable device ID is ever created — `get_or_create_device_id()` doesn't
  exist anymore.
- Meaningfully smaller frontend bundle: 830 KB → 492 KB JS (the Vite
  chunk-size warning present before this change is gone), 652 → 313 modules.
- One less category of "is this configured correctly for this build"
  question when cutting a release.

### Negative

- No crash reporting. A render error the `ErrorBoundary` catches, or a
  backend exception, is only visible in local logs / a manual repro — there
  is no way to learn about a crash that happens on someone else's machine
  unless they report it themselves (e.g. via `POST /feedback`).
- No usage analytics. Feature adoption, error rates, and engagement are
  invisible unless deliberately measured some other way.

### Neutral

- If real crash reporting or analytics is wanted later, it needs a genuine
  opt-in/revoke design built from scratch (a real settings flag, checked
  synchronously in a `beforeSend`-equivalent hook on both stacks, a
  PrivacyPanel toggle separate from capture consent) — not a re-import of
  the removed SDKs gated the old way.
