import { useEffect, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { BACKEND_BASE_URL } from "@/lib/config";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MemoryViewer } from "./components/MemoryViewer";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { PrivacyPanel } from "./components/PrivacyPanel";
import { RecallSearch } from "./components/RecallSearch";
import { TimelineView } from "./components/Timeline/TimelineView";
import { useOnboarding } from "./hooks/useOnboarding";
import { useUpdater } from "./hooks/useUpdater";
import { useWindowPosition } from "./hooks/useWindowPosition";
import { useOrbitStore } from "./store/orbitStore";

type ActivePanel = "chat" | "timeline" | "memory" | "privacy";

export default function App() {
  const [activePanel, setActivePanel] = useState<ActivePanel>("chat");
  const [isCollapsed, setIsCollapsed] = useState(true);
  const isCollapsedRef = useRef(true);
  const [backendStatus, setBackendStatus] = useState<"unknown" | "unavailable" | "ready">("unknown");
  const [startupErrored, setStartupErrored] = useState(false);
  const [accessibilityBannerDismissed, setAccessibilityBannerDismissed] = useState(false);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  const { positionWindow } = useWindowPosition();
  const {
    isCompleted: onboardingCompleted,
    isLoading: onboardingLoading,
    completeOnboarding,
    hasAccessibilityPermission,
    checkAccessibilityPermission,
  } = useOnboarding();
  const { setPendingQuery } = useOrbitStore();

  function handleAskOrbitFromTimeline(query: string): void {
    setPendingQuery(query);
    setActivePanel("chat");
  }

  // Sync ref to avoid closure issues in listeners
  useEffect(() => {
    isCollapsedRef.current = isCollapsed;
  }, [isCollapsed]);

  // Check for updates — does not auto-install; see useUpdater.ts for why.
  const { updateAvailable, updateVersion, isInstalling, installUpdate } = useUpdater();

  // Transition to a hard error screen if the backend hasn't responded within 15 s.
  // Cancels immediately if backendStatus reaches "ready" before the timer fires.
  useEffect(() => {
    if (backendStatus === "ready") return;
    const timeout = setTimeout(() => setStartupErrored(true), 15_000);
    return () => clearTimeout(timeout);
  }, [backendStatus]);

  // Poll for accessibility permission every 5 s while the banner is visible so
  // it auto-dismisses when the user grants the permission from System Settings.
  useEffect(() => {
    if (!onboardingCompleted || hasAccessibilityPermission || accessibilityBannerDismissed) return;
    const interval = setInterval(() => { checkAccessibilityPermission(); }, 5_000);
    return () => clearInterval(interval);
  }, [onboardingCompleted, hasAccessibilityPermission, accessibilityBannerDismissed, checkAccessibilityPermission]);

  // Resize Tauri window helper
  const setCollapsedState = async (collapsed: boolean) => {
    setIsCollapsed(collapsed);
    try {
      const appWindow = getCurrentWindow();
      if (collapsed) {
        // Pill mode size: compact capsule
        await appWindow.setSize(new LogicalSize(230, 60));
        await positionWindow("collapsed");
      } else {
        // Expanded panel size
        await appWindow.setSize(new LogicalSize(720, 800));
        await positionWindow("expanded");
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
      setStartupErrored(true);
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
      appWindow.setSize(new LogicalSize(720, 800))
        .then(() => positionWindow("center"))
        .catch((err) => console.error("Failed to center onboarding window:", err));
    }
  }, [onboardingLoading, onboardingCompleted]);

  // Resize and center the window for backend startup/unavailable state
  useEffect(() => {
    if (backendStatus === "unavailable") {
      const appWindow = getCurrentWindow();
      appWindow.setSize(new LogicalSize(720, 800))
        .then(() => positionWindow("center"))
        .catch((err) => console.error("Failed to center startup window:", err));
    }
  }, [backendStatus]);

  // Transition window size back to collapsed pill once backend becomes ready
  useEffect(() => {
    if (backendStatus === "ready" && onboardingCompleted) {
      setCollapsedState(true);
    }
  }, [backendStatus, onboardingCompleted]);

  // Backend startup screens — spinner while waiting, hard error after 15 s.
  if (backendStatus !== "ready") {
    if (startupErrored) {
      return (
        <ErrorBoundary>
          <div className="fixed inset-0 flex items-center justify-center bg-white dark:bg-black p-6 select-none">
            <div className="flex flex-col items-center gap-6 text-center max-w-[280px]">
              <div className="relative w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center shadow-lg overflow-hidden p-2.5">
                <img
                  src="/logo.png"
                  className="w-full h-full object-contain select-none pointer-events-none opacity-50"
                  draggable="false"
                  alt="Orbit Logo"
                />
              </div>
              <div className="flex flex-col gap-2">
                <h1 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">
                  Orbit couldn't start
                </h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-light">
                  Try quitting and reopening the app. If this keeps happening, restart your computer.
                </p>
              </div>
              <button
                onClick={() => invoke("quit_app")}
                className="w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-all cursor-pointer"
              >
                Quit Orbit
              </button>
            </div>
          </div>
        </ErrorBoundary>
      );
    }

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
                onClick={() => handlePillClick("timeline")}
                className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                title="Timeline"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
              </button>

              {/* Memory Viewer button */}
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
                onClick={() => setActivePanel("timeline")}
                className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${activePanel === "timeline"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                  }`}
              >
                Timeline
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

          {/* Accessibility permission banner — shown until granted or dismissed */}
          {onboardingCompleted && !hasAccessibilityPermission && !accessibilityBannerDismissed && (
            <div className="flex items-center justify-between gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800/30 shrink-0">
              <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium leading-tight flex-1 min-w-0">
                Orbit needs one permission to start learning →
              </p>
              <button
                onClick={() => invoke("open_accessibility_system_settings")}
                className="shrink-0 text-[11px] font-semibold text-amber-700 dark:text-amber-400 underline underline-offset-2 cursor-pointer hover:opacity-70 transition-opacity"
              >
                Open Settings
              </button>
              <button
                onClick={() => setAccessibilityBannerDismissed(true)}
                className="shrink-0 p-0.5 text-amber-500 dark:text-amber-600 hover:opacity-70 transition-opacity cursor-pointer"
                aria-label="Dismiss"
              >
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="3" y1="3" x2="13" y2="13" />
                  <line x1="13" y1="3" x2="3" y2="13" />
                </svg>
              </button>
            </div>
          )}

          {/* Update available banner — shown until installed or dismissed.
              Dismissing only skips this session; the check reruns (and the
              banner reappears if still on an old version) on next launch. */}
          {updateAvailable && !updateBannerDismissed && (
            <div className="flex items-center justify-between gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800/30 shrink-0">
              <p className="text-[11px] text-blue-700 dark:text-blue-400 font-medium leading-tight flex-1 min-w-0">
                {isInstalling
                  ? "Installing update — Orbit will restart shortly…"
                  : `Update available (v${updateVersion}) →`}
              </p>
              {!isInstalling && (
                <>
                  <button
                    onClick={() => void installUpdate()}
                    className="shrink-0 text-[11px] font-semibold text-blue-700 dark:text-blue-400 underline underline-offset-2 cursor-pointer hover:opacity-70 transition-opacity"
                  >
                    Restart to update
                  </button>
                  <button
                    onClick={() => setUpdateBannerDismissed(true)}
                    className="shrink-0 p-0.5 text-blue-500 dark:text-blue-600 hover:opacity-70 transition-opacity cursor-pointer"
                    aria-label="Dismiss"
                  >
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="3" y1="3" x2="13" y2="13" />
                      <line x1="13" y1="3" x2="3" y2="13" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 overflow-hidden p-4 bg-white dark:bg-black flex flex-col min-h-0">
            {activePanel === "chat" && (
              <RecallSearch />
            )}
            {activePanel === "timeline" && (
              <TimelineView onAskOrbit={handleAskOrbitFromTimeline} />
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
