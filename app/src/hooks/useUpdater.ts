import { useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// ---------------------------------------------------------------------------
// Auto-updater hook
//
// Called once from App.tsx on mount. Asks the updater plugin to check the
// endpoint configured in tauri.conf.json (releases/latest.json on GitHub).
//
// The "dialog": true setting in tauri.conf.json means the plugin renders the
// native "Update available — install now?" prompt itself. We only need to
// call relaunch() after the download completes to apply the update.
//
// Errors are swallowed silently — a failed update check must never surface
// as a visible error to the user. Orbit should just continue working.
// ---------------------------------------------------------------------------

export function useUpdater(): void {
  useEffect(() => {
    async function checkForUpdate(): Promise<void> {
      try {
        const update = await check();

        if (update === null) {
          // Already on the latest version — nothing to do.
          return;
        }

        // download() triggers the native dialog (because "dialog": true in
        // tauri.conf.json). If the user accepts, the plugin downloads and
        // installs the update, then calls our onChunk / onDownloadFinished
        // callbacks. We relaunch immediately after installation completes.
        await update.downloadAndInstall();
        await relaunch();
      } catch {
        // Silently ignore — network unavailable, endpoint not yet published,
        // or running in dev mode where the updater is effectively a no-op.
      }
    }

    checkForUpdate();
    // No cleanup needed — the check is a one-shot call, not a subscription.
  }, []);
}
