import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ActivityTimeline } from "./components/ActivityTimeline";
import { MemoryViewer } from "./components/MemoryViewer";
import { PrivacyPanel } from "./components/PrivacyPanel";
import { RecallSearch } from "./components/RecallSearch";

// The tray menu emits "navigate" events with one of these panel names.
type ActivePanel = "chat" | "memory" | "privacy";

function App() {
  const [activePanel, setActivePanel] = useState<ActivePanel>("chat");

  useEffect(() => {
    // Listen for navigation events emitted by the Rust tray menu handler.
    // Returns an unlisten function that cleans up the listener on unmount.
    const unlistenPromise = listen<string>("navigate", (event) => {
      const targetPanel = event.payload as ActivePanel;
      setActivePanel(targetPanel);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  if (activePanel === "memory") {
    return <MemoryViewer />;
  }

  if (activePanel === "privacy") {
    return <PrivacyPanel />;
  }

  // Default: chat panel
  return (
    <main className="max-w-2xl mx-auto py-6 font-sans">
      <h1 className="text-2xl font-bold px-4 mb-6">🪐 Orbit</h1>
      <RecallSearch />
      <hr className="my-4 border-gray-200" />
      <ActivityTimeline />
    </main>
  );
}

export default App;
