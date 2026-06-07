import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN ?? "",
  environment: import.meta.env.VITE_APP_ENVIRONMENT ?? "development",
  release: `orbit-frontend@${import.meta.env.VITE_APP_VERSION ?? "0.0.0"}`,
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
  tracesSampleRate: 0.2,
  // Never send PII — Orbit is privacy-first
  sendDefaultPii: false,
  // Only initialise if DSN is set (allows dev without Sentry)
  enabled: Boolean(import.meta.env.VITE_SENTRY_DSN),
});
