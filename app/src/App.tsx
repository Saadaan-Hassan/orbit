import { useEffect, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { BACKEND_BASE_URL } from "@/lib/config";
import { ActivityTimeline } from "./components/ActivityTimeline";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MemoryViewer } from "./components/MemoryViewer";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { PrivacyPanel } from "./components/PrivacyPanel";
import { RecallSearch } from "./components/RecallSearch";
import { useOnboarding } from "./hooks/useOnboarding";
import { useUpdater } from "./hooks/useUpdater";

type ActivePanel = "chat" | "memory" | "privacy";

export default function App() {
  const [activePanel, setActivePanel] = useState<ActivePanel>("chat");
  const [isCollapsed, setIsCollapsed] = useState(true);
  const isCollapsedRef = useRef(true);
  const [backendStatus, setBackendStatus] = useState<"unknown" | "unavailable" | "ready">("unknown");
  const { isCompleted: onboardingCompleted, isLoading: onboardingLoading, completeOnboarding } = useOnboarding();

  // Sync ref to avoid closure issues in listeners
  useEffect(() => {
    isCollapsedRef.current = isCollapsed;
  }, [isCollapsed]);

  // Check for updates
  useUpdater();

  // Resize Tauri window helper
  const setCollapsedState = async (collapsed: boolean) => {
    setIsCollapsed(collapsed);
    try {
      const appWindow = getCurrentWindow();
      if (collapsed) {
        // Pill mode size: compact capsule
        await appWindow.setSize(new LogicalSize(230, 60));
        await invoke("position_window", { mode: "collapsed" });
      } else {
        // Expanded panel size
        await appWindow.setSize(new LogicalSize(500, 650));
        await invoke("position_window", { mode: "expanded" });
      }
    } catch (err) {
      console.error("Failed to resize/position Tauri window:", err);
    }
  };

  // System Theme Auto-Detection
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const updateTheme = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };

    updateTheme(mediaQuery);

    mediaQuery.addEventListener("change", updateTheme);
    return () => mediaQuery.removeEventListener("change", updateTheme);
  }, []);

  useEffect(() => {
    // Initial size configuration on mount
    setCollapsedState(true);

    // Listen to tray menu navigations
    const unlistenNavigatePromise = listen<string>("navigate", (event) => {
      const targetPanel = event.payload as ActivePanel;
      setActivePanel(targetPanel);
      setCollapsedState(false);
    });

    // Auto-hide when expanded window loses focus (click away)
    let unlistenFocus: (() => void) | undefined;

    const setupFocusListener = async () => {
      try {
        const appWindow = getCurrentWindow();
        const unsub = await appWindow.onFocusChanged(({ payload: focused }) => {
          if (!focused && !isCollapsedRef.current) {
            appWindow.hide();
            setIsCollapsed(true);
          }
        });
        unlistenFocus = unsub;
      } catch (err) {
        console.error("Failed to set up focus listener:", err);
      }
    };

    setupFocusListener();

    // Listen for backend health events emitted by the Rust startup probe
    const unlistenUnavailablePromise = listen("backend-unavailable", () => {
      setBackendStatus("unavailable");
    });
    const unlistenReadyPromise = listen("backend-ready", () => {
      setBackendStatus("ready");
    });

    return () => {
      unlistenNavigatePromise.then((unlisten) => unlisten());
      unlistenUnavailablePromise.then((unlisten) => unlisten());
      unlistenReadyPromise.then((unlisten) => unlisten());
      if (unlistenFocus) unlistenFocus();
    };
  }, []);

  // When the backend was unreachable at startup, keep polling every 2s until it responds.
  // Also runs a one-off check at mount (when status is "unknown") to prevent missing early "backend-ready" events.
  useEffect(() => {
    if (backendStatus === "ready") return;

    if (backendStatus === "unknown") {
      fetch(`${BACKEND_BASE_URL}/health`)
        .then((res) => {
          if (res.ok) setBackendStatus("ready");
        })
        .catch(() => { });
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_BASE_URL}/health`);
        if (res.ok) setBackendStatus("ready");
      } catch {
        // still unavailable — keep polling
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [backendStatus]);

  // Resize and center the window for onboarding
  useEffect(() => {
    if (!onboardingLoading && !onboardingCompleted) {
      const appWindow = getCurrentWindow();
      appWindow.setSize(new LogicalSize(500, 650))
        .then(() => invoke("position_window", { mode: "center" }))
        .catch((err) => console.error("Failed to center onboarding window:", err));
    }
  }, [onboardingLoading, onboardingCompleted]);

  // Resize and center the window for backend startup/unavailable state
  useEffect(() => {
    if (backendStatus === "unavailable") {
      const appWindow = getCurrentWindow();
      appWindow.setSize(new LogicalSize(500, 650))
        .then(() => invoke("position_window", { mode: "center" }))
        .catch((err) => console.error("Failed to center startup window:", err));
    }
  }, [backendStatus]);

  // Transition window size back to collapsed pill once backend becomes ready
  useEffect(() => {
    if (backendStatus === "ready" && onboardingCompleted) {
      setCollapsedState(true);
    }
  }, [backendStatus, onboardingCompleted]);

  // Show a full-screen message while the FastAPI backend is starting up.
  // Auto-dismisses once the health poll succeeds (backendStatus → "ready").
  if (backendStatus !== "ready") {
    return (
      <ErrorBoundary>
        <div className="fixed inset-0 flex items-center justify-center bg-white dark:bg-black p-6 select-none">
          <div className="flex flex-col items-center gap-6 text-center max-w-[280px]">
            {/* Brand logo container */}
            <div className="relative w-16 h-16 rounded-2xl bg-black flex items-center justify-center shadow-lg overflow-hidden p-2.5">
              <img
                src="/logo.png"
                className="w-full h-full object-contain select-none pointer-events-none"
                draggable="false"
                alt="Orbit Logo"
              />
              {/* Subtle spinning glow/border effect around the logo */}
              <div className="absolute inset-0 rounded-2xl border border-zinc-400/20 dark:border-zinc-800/50 pointer-events-none" />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-center gap-2">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-400 dark:bg-zinc-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-zinc-500 dark:bg-zinc-400" />
                </span>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">
                  Starting Orbit
                </h1>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-light">
                Setting up your memory assistant. This takes a few seconds on first launch.
              </p>
            </div>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  // Show onboarding on first launch
  if (!onboardingLoading && !onboardingCompleted) {
    return (
      <ErrorBoundary>
        <OnboardingFlow onComplete={completeOnboarding} />
      </ErrorBoundary>
    );
  }

  // Toggle expanded view
  const handlePillClick = (panel: ActivePanel) => {
    if (isCollapsed) {
      setActivePanel(panel);
      setCollapsedState(false);
    } else if (activePanel === panel) {
      setCollapsedState(true);
    } else {
      setActivePanel(panel);
    }
  };

  if (isCollapsed) {
    return (
      <ErrorBoundary>
        <div
          className="w-full h-full flex items-center justify-center select-none"
          style={{ boxSizing: "border-box" }}
        >
          {/* Collapsed Pill UI */}
          <div
            data-tauri-drag-region
            className="w-[210px] h-[40px] px-3 rounded-full bg-zinc-900/90 dark:bg-black/95 flex items-center justify-between transition-all duration-300 cursor-grab active:cursor-grabbing"
          >
            {/* Logo Handle */}
            <div data-tauri-drag-region className="flex items-center gap-1.5 pointer-events-none select-none">
              <img data-tauri-drag-region src="/logo.png" className="w-5 h-5 object-contain select-none pointer-events-none" draggable="false" alt="Orbit" />
              <span data-tauri-drag-region className="text-xs font-semibold text-zinc-300 dark:text-zinc-200 select-none pointer-events-none">Orbit</span>
            </div>

            {/* Quick tab controls */}
            <div className="flex items-center gap-1">
              {/* Chat button */}
              <button
                onClick={() => handlePillClick("chat")}
                className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                title="Recall Search"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </button>

              {/* Timeline button */}
              <button
                onClick={() => handlePillClick("memory")}
                className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                title="Memory Viewer"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10"></line>
                  <line x1="12" y1="20" x2="12" y2="4"></line>
                  <line x1="6" y1="20" x2="6" y2="14"></line>
                </svg>
              </button>

              {/* Privacy settings */}
              <button
                onClick={() => handlePillClick("privacy")}
                className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                title="Privacy settings"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div
        className="w-full h-full flex flex-col select-none"
        style={{ boxSizing: "border-box" }}
      >
        {/* Expanded Card UI */}
        <div
          className="w-full h-full flex flex-col rounded-2xl bg-white dark:bg-black overflow-hidden transition-all duration-300"
        >
          {/* Custom Header Tab controller */}
          <header
            data-tauri-drag-region
            className="flex items-center justify-between px-4 py-3 bg-zinc-50/50 dark:bg-black cursor-grab active:cursor-grabbing"
          >
            {/* Logo region */}
            <div data-tauri-drag-region className="flex items-center gap-1.5 pointer-events-none select-none">
              <img data-tauri-drag-region src="/logo.png" className="w-5 h-5 object-contain select-none pointer-events-none" draggable="false" alt="Orbit" />
              <span data-tauri-drag-region className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 select-none pointer-events-none">Orbit</span>
            </div>

            {/* Tab Selector */}
            <div className="flex items-center bg-zinc-200/50 dark:bg-zinc-900/60 p-0.5 rounded-lg">
              <button
                onClick={() => setActivePanel("chat")}
                className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${activePanel === "chat"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
              >
                Recall
              </button>
              <button
                onClick={() => setActivePanel("memory")}
                className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${activePanel === "memory"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
              >
                Memories
              </button>
              <button
                onClick={() => setActivePanel("privacy")}
                className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${activePanel === "privacy"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
              >
                Privacy
              </button>
            </div>

            {/* Close / Minimize button */}
            <button
              onClick={() => setCollapsedState(true)}
              className="p-1 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-all cursor-pointer"
              title="Collapse back to pill"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </header>

          {/* Content Area */}
          <div className="flex-1 overflow-hidden p-4 bg-white dark:bg-black flex flex-col min-h-0">
            {activePanel === "chat" && (
              <RecallSearch>
                <ActivityTimeline />
              </RecallSearch>
            )}
            {activePanel === "memory" && (
              <div className="flex-1 overflow-y-auto">
                <MemoryViewer />
              </div>
            )}
            {activePanel === "privacy" && (
              <div className="flex-1 overflow-y-auto">
                <PrivacyPanel />
              </div>
            )}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
