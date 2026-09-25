# ADR-005: Tauri shell hardening — CSP, devtools, capabilities, entitlements

## Status

Accepted

## Context

`APPSEC-001` requires the production desktop shell to run with no user-accessible
devtools, a restrictive Content-Security-Policy, a minimal webview capability
grant, and a documented rationale for every macOS hardened-runtime entitlement.
Before this task none of that was true:

- `Cargo.toml` unconditionally compiled the `tauri` crate with the `devtools`
  feature. Tauri/WRY already exposes devtools automatically in debug builds;
  the Cargo feature's only effect is forcing devtools on in **release** builds
  too, which is what shipped.
- `tauri.conf.json` had `security.csp: null` — no restriction on what the
  webview could load or connect to.
- `capabilities/default.json` granted `global-shortcut:default` and six
  `core:window:allow-*` permissions (`allow-set-position`, `allow-show`,
  `allow-set-focus`, `allow-is-visible`, `allow-set-always-on-top`,
  `allow-set-ignore-cursor-events`) that no webview code calls — the global
  hotkey and all of those window transitions are driven entirely from Rust
  (`lib.rs`), which does not go through the IPC/ACL boundary and needs no
  capability grant.
- The same file was simultaneously **missing** permissions for three plugin
  calls the webview genuinely makes: `check()`
  (`@tauri-apps/plugin-updater`, `useUpdater.ts`), `relaunch()`
  (`@tauri-apps/plugin-process`, `useUpdater.ts`), and `open()`
  (`@tauri-apps/plugin-dialog`, the "Add folder" picker in
  `PrivacyPanel.tsx`). All three would have been silently rejected by the ACL
  in a real build; each call site already wraps its result in a bare
  `try/catch`, so the failure mode was total, silent non-functionality of
  auto-update and folder selection rather than a visible error.

## Decision

**Devtools.** Remove `devtools` from `Cargo.toml`'s unconditional `tauri`
feature list. `cargo tauri dev` (debug profile) keeps devtools without any
feature flag; `cargo tauri build` (release profile) no longer does.

**CSP.** Set an explicit policy in `tauri.conf.json`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:;
connect-src 'self' http://localhost:47821 https://*.i.posthog.com
  https://*.posthog.com https://*.sentry.io;
object-src 'none'; base-uri 'self'; form-action 'self'
```

- `connect-src` is scoped to exactly what the webview calls directly: the
  fixed-port local FastAPI sidecar (`http://localhost:47821`, see
  `app/src/lib/config.ts`), and the two telemetry SDKs that ship their own
  in-webview network calls — PostHog (`posthog-js`/`@posthog/react`,
  wildcarded to cover both the `us`/`eu` ingest hosts and the
  `*-assets.i.posthog.com` host, since the exact host is env-configurable at
  build time) and Sentry (`@sentry/react`, wildcarded because the ingest
  subdomain is derived from the org ID embedded in each project's DSN).
  Neither the Cloudflare Worker nor any AI provider is reachable from
  `connect-src` — the webview never calls them; only the FastAPI backend does,
  over its own outbound HTTPS, outside the webview's CSP entirely.
- `style-src 'unsafe-inline'` is required — the app uses inline `style={{}}`
  props in a handful of components and Tailwind's runtime does not use a
  nonce Tauri could inject. `script-src` has no such exception: the production
  Vite bundle is plain `<script type="module">` with no inline or `eval`'d
  code.
- No Google Fonts or other CDN is used (`App.css` only has
  `@import "tailwindcss"`), so `font-src`/`img-src` only need `'self'` and
  `data:`.
- CSP is only enforced for content Tauri itself serves (the production
  bundle); it does not apply to `tauri dev`'s Vite dev server origin.

**Capabilities.** `capabilities/default.json` now grants exactly:

- `core:default`, `opener:default` — baseline IPC plus safe external-link
  handling (recall responses render Markdown links via `react-markdown`, and
  the opener plugin routes their clicks to the system browser instead of
  navigating the app window).
- `core:window:allow-set-size`, `allow-hide`, `allow-start-dragging` — the
  only three window commands the webview actually calls
  (`getCurrentWindow().setSize()`/`.hide()` in `App.tsx`, and
  `data-tauri-drag-region` for the custom title bar).
- `updater:allow-check`, `updater:allow-download-and-install`,
  `process:allow-restart` — restores the auto-update flow documented in
  "Release & Distribution", scoped to only the two updater calls and the one
  process call actually made (not the broader `updater:default`/
  `process:default`, which also cover install-without-download and
  process-exit).
- `dialog:allow-open` — the watched-folder picker, scoped to the one dialog
  operation used (not `dialog:default`, which also covers save/message/ask/
  confirm dialogs nothing in the app calls).

`global-shortcut:default` and the six unused `core:window:allow-*`
permissions are removed. The Alt+Space hotkey and every `show`/`hide`/
`set_focus`/`is_visible`/`set_always_on_top`/`set_ignore_cursor_events` call
those permissions used to cover are Rust-native (`lib.rs`) and were never
gated by this file to begin with, so removing them changes nothing at
runtime — it only removes standing webview-callable capability that had no
corresponding caller.

**Entitlements** (`entitlements.plist`) were already individually commented
with their justification and are unchanged by this task; that inline
commentary is this project's record of entitlement rationale. For
completeness here: `com.apple.security.cs.allow-jit` and
`allow-unsigned-executable-memory` are required by WKWebView's JIT compiler;
`disable-library-validation` is required to load Tauri's own unsigned dylibs;
`network.client`/`network.server` are required to reach the local FastAPI
sidecar and to let it bind a loopback port; `files.user-selected.read-write`
backs the native folder-picker dialog. None were removed — each is exercised
by a real, current code path.

**`macOSPrivateApi: true`** (`tauri.conf.json`) is required by the `main`
window's `shadow: false` and by the `overlay` window's transparency/
click-through/always-on-top behavior; Tauri's public window API cannot
express either on macOS. Kept, for the same reason it was accepted originally.

## Consequences

### Positive

- A release build has no user-reachable devtools/inspector.
- The webview can only load its own bundled assets and connect to the four
  hosts it actually needs; a compromised or malicious renderer content
  injection cannot exfiltrate to or load script from an arbitrary origin.
- The capability grant is now a precise match for what the webview calls —
  neither over- nor under-provisioned. Fixing the missing updater/process/
  dialog permissions is a functional fix, not just hardening: auto-update and
  the folder picker were silently broken before this change.

### Negative

- Any new webview-facing plugin call must be paired with an explicit
  capability addition here, or it will fail silently (the existing call sites
  already swallow such errors by design — see `useUpdater.ts`). This is a
  standing maintenance cost of least-privilege capabilities.
- The CSP's `connect-src` wildcards `*.posthog.com`/`*.sentry.io` rather than
  pinning exact ingest hosts, because those hosts depend on env-configured
  region/org values not fixed at build time. `OBS-001` (making telemetry
  genuine opt-in / removing it from official builds) will let this policy
  narrow further once that task lands.

### Neutral

- This task does not change `PRIV-002`/`PRIV-003`'s `PARTIAL` status or the
  blocked Consent gate; it is independent, security-shell hardening.
- No automated test exercises CSP behavior at runtime (CSP violations are a
  webview-console concern, not a compile- or unit-test one). The `cargo
  check --bin app` step validates the capabilities file against the plugins'
  permission schemas (an invalid permission identifier fails the build), and
  `cargo test --bin app` / `pnpm build` confirm no regression, but a maintainer
  should still smoke-test a real production build once: confirm the local API
  calls, PostHog/Sentry, the update check, and the folder picker all still
  work, and that right-click → Inspect Element is unavailable.
