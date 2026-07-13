import { useEffect, useRef, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// ---------------------------------------------------------------------------
// Auto-updater hook
//
// Called once from App.tsx on mount. Asks the updater plugin to check the
// endpoint configured in tauri.conf.json (orbit-releases latest.json).
//
// Does NOT auto-install. "dialog": true in tauri.conf.json is a Tauri v1
// option that no longer exists in v2 — it's silently ignored, so calling
// downloadAndInstall() immediately here would relaunch the app with zero
// warning to the user. Instead this exposes update state so App.tsx can
// show an in-app prompt, and only installs when the user explicitly clicks
// through it.
//
// Errors are swallowed silently — a failed update check must never surface
// as a visible error to the user. Orbit should just continue working.
// ---------------------------------------------------------------------------

export interface UpdaterState {
  updateAvailable: boolean;
  updateVersion: string | null;
  isInstalling: boolean;
  installUpdate: () => Promise<void>;
}

export function useUpdater(): UpdaterState {
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  // The live Update handle isn't serializable state — a ref avoids re-renders
  // and keeps the SDK object out of anything that might try to clone it.
  const pendingUpdateRef = useRef<Update | null>(null);

  useEffect(() => {
    async function checkForUpdate(): Promise<void> {
      try {
        const update = await check();
        if (update === null) return; // already on the latest version
        pendingUpdateRef.current = update;
        setUpdateVersion(update.version);
      } catch {
        // Network unavailable, endpoint not yet published, or dev mode
        // where the updater is effectively a no-op.
      }
    }

    checkForUpdate();
    // One-shot check on mount — no cleanup needed.
  }, []);

  async function installUpdate(): Promise<void> {
    const update = pendingUpdateRef.current;
    if (!update) return;
    setIsInstalling(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch {
      // Leave the prompt showing so the user can retry.
      setIsInstalling(false);
    }
  }

  return {
    updateAvailable: updateVersion !== null,
    updateVersion,
    isInstalling,
    installUpdate,
  };
}
