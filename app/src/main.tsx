import "./instrument";
import React from "react";
import ReactDOM from "react-dom/client";
import { PostHogProvider } from "@posthog/react";
import "./App.css";
import App from "./App";

const posthogApiKey = import.meta.env.VITE_POSTHOG_PROJECT_KEY ?? "";

const posthogOptions = {
  api_host: import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
  defaults: "2026-01-30",
  autocapture: false,              // privacy-first — no automatic click/input capture
  capture_pageview: false,         // no pageviews in a desktop app
  disable_session_recording: true, // never record sessions
  persistence: "memory" as const,  // no localStorage — memory only
  loaded: (posthog: { debug: () => void }) => {
    if (import.meta.env.DEV) posthog.debug();
  },
} as const;

const root = (
  <React.StrictMode>
    {posthogApiKey ? (
      <PostHogProvider apiKey={posthogApiKey} options={posthogOptions}>
        <App />
      </PostHogProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(root);
