import React from "react";
import * as Sentry from "@sentry/react";
import { invoke } from "@tauri-apps/api/core";

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  handleRestart(): void {
    invoke("restart_app").catch(() => {
      // If the Tauri command fails, fall back to reloading the webview
      window.location.reload();
    });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white dark:bg-black p-6 select-none">
        <div className="flex flex-col items-center gap-6 text-center max-w-[280px]">
          {/* Brand logo container */}
          <div className="w-16 h-16 rounded-2xl bg-black flex items-center justify-center shadow-lg overflow-hidden p-2.5">
            <img
              src="/logo.png"
              className="w-full h-full object-contain select-none pointer-events-none"
              draggable="false"
              alt="Orbit Logo"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">
              Orbit ran into an issue
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-light">
              Try restarting the app. If this keeps happening, please let us know.
            </p>
          </div>

          <button
            onClick={() => this.handleRestart()}
            className="w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-all cursor-pointer mt-1"
          >
            Restart Orbit
          </button>
        </div>
      </div>
    );
  }
}
