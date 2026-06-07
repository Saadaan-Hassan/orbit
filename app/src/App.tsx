import { useEffect, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { ActivityTimeline } from "./components/ActivityTimeline";
import { MemoryViewer } from "./components/MemoryViewer";
import { PrivacyPanel } from "./components/PrivacyPanel";
import { RecallSearch } from "./components/RecallSearch";
import { useUpdater } from "./hooks/useUpdater";

type ActivePanel = "chat" | "memory" | "privacy";

export default function App() {
  const [activePanel, setActivePanel] = useState<ActivePanel>("chat");
  const [isCollapsed, setIsCollapsed] = useState(true);
  const isCollapsedRef = useRef(true);

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
      } else {
        // Expanded panel size
        await appWindow.setSize(new LogicalSize(500, 650));
      }
    } catch (err) {
      console.error("Failed to resize Tauri window:", err);
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

    return () => {
      unlistenNavigatePromise.then((unlisten) => unlisten());
      if (unlistenFocus) unlistenFocus();
    };
  }, []);

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
      <div
        className="w-full h-full p-2 flex items-center justify-center select-none"
        style={{ boxSizing: "border-box" }}
      >
        {/* Collapsed Pill UI */}
        <div
          data-tauri-drag-region
          className="w-[210px] h-[40px] px-3 rounded-full bg-zinc-900/90 dark:bg-black/95 flex items-center justify-between shadow-[0_4px_24px_rgba(0,0,0,0.6)] backdrop-blur-md transition-all duration-300 cursor-grab active:cursor-grabbing"
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
    );
  }

  return (
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
  );
}
