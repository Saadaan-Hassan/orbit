import { useCallback, useEffect, useState } from "react";

import { orbitApiFetch } from "@/lib/local-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CaptureStatus {
  is_paused: boolean;
  paused_until: number | null; // unix ms, null = indefinite
}

export interface PrivacySettings {
  // Whether capture is currently active.
  isCapturing: boolean;
  // Unix ms timestamp when an auto-expiring pause ends, or null.
  pausedUntil: number | null;
  // Ordered list of app names excluded from capture.
  excludedApps: string[];
  // Ordered list of domains excluded from browser capture.
  excludedDomains: string[];
  // Whether native browser URL capture (osascript, no extension) is enabled.
  nativeBrowserEnabled: boolean;
  // Whether file activity capture is enabled.
  fileWatchEnabled: boolean;
  // Absolute folder paths being watched for file activity.
  watchedFolders: string[];
  // Whether on-screen text capture via Accessibility API is enabled.
  screenContentEnabled: boolean;
  // True while DELETE /privacy/all-data is in flight.
  isWiping: boolean;
  // True while the initial load is in flight.
  isLoading: boolean;
  // Non-null when a network call fails.
  error: string | null;
  // Actions
  addExcludedApp: (appName: string) => Promise<void>;
  removeExcludedApp: (appName: string) => Promise<void>;
  addExcludedDomain: (domain: string) => Promise<void>;
  removeExcludedDomain: (domain: string) => Promise<void>;
  setNativeBrowserEnabled: (enabled: boolean) => Promise<void>;
  setFileWatchEnabled: (enabled: boolean) => Promise<void>;
  setScreenContentEnabled: (enabled: boolean) => Promise<void>;
  addWatchedFolder: (folder: string) => Promise<void>;
  removeWatchedFolder: (folder: string) => Promise<void>;
  pauseCapture: (durationMinutes: number | null) => Promise<void>;
  resumeCapture: () => Promise<void>;
  wipeAllMemory: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Accepts a bare hostname ("mail.google.com") or a full URL
// ("https://mail.google.com/u/0") and returns just the hostname.
// The backend stores and compares bare hostnames, so this normalises
// whatever the user typed before it reaches the API.
function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).hostname;
    }
    // Strip any leading slashes and drop the path/query.
    return trimmed.replace(/^\/+/, "").split("/")[0];
  } catch {
    return trimmed;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePrivacySettings(): PrivacySettings {
  const [isCapturing, setIsCapturing] = useState(true);
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  const [excludedApps, setExcludedApps] = useState<string[]>([]);
  const [excludedDomains, setExcludedDomains] = useState<string[]>([]);
  const [nativeBrowserEnabled, setNativeBrowserEnabledState] = useState(true);
  const [fileWatchEnabled, setFileWatchEnabledState] = useState(true);
  const [screenContentEnabled, setScreenContentEnabledState] = useState(true);
  const [watchedFolders, setWatchedFolders] = useState<string[]>([]);
  const [isWiping, setIsWiping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load all endpoints in parallel on mount so the panel has data immediately.
  useEffect(() => {
    async function loadInitialState(): Promise<void> {
      try {
        const [
          statusResponse,
          excludedAppsResponse,
          excludedDomainsResponse,
          browserCaptureResponse,
          fileWatchResponse,
          screenContentResponse,
        ] = await Promise.all([
          orbitApiFetch("/privacy/capture-status"),
          orbitApiFetch("/privacy/excluded-apps"),
          orbitApiFetch("/privacy/excluded-domains"),
          orbitApiFetch("/privacy/browser-capture"),
          orbitApiFetch("/privacy/file-watching"),
          orbitApiFetch("/privacy/screen-content"),
        ]);

        if (
          !statusResponse.ok ||
          !excludedAppsResponse.ok ||
          !excludedDomainsResponse.ok ||
          !browserCaptureResponse.ok ||
          !fileWatchResponse.ok ||
          !screenContentResponse.ok
        ) {
          throw new Error("Failed to load privacy settings from backend.");
        }

        const statusData: CaptureStatus = await statusResponse.json();
        const excludedAppsData: { excluded_apps: string[] } =
          await excludedAppsResponse.json();
        const excludedDomainsData: { excluded_domains: string[] } =
          await excludedDomainsResponse.json();
        const browserCaptureData: { native_enabled: boolean } =
          await browserCaptureResponse.json();
        const fileWatchData: { enabled: boolean; watched_folders: string[] } =
          await fileWatchResponse.json();
        const screenContentData: { enabled: boolean } =
          await screenContentResponse.json();

        setIsCapturing(!statusData.is_paused);
        setPausedUntil(statusData.paused_until);
        setExcludedApps(excludedAppsData.excluded_apps);
        setExcludedDomains(excludedDomainsData.excluded_domains);
        setNativeBrowserEnabledState(browserCaptureData.native_enabled);
        setFileWatchEnabledState(fileWatchData.enabled);
        setScreenContentEnabledState(screenContentData.enabled);
        setWatchedFolders(fileWatchData.watched_folders);
        setError(null);
      } catch {
        setError("Could not reach Orbit backend.");
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialState();
  }, []);

  const addExcludedApp = useCallback(async (appName: string): Promise<void> => {
    const trimmedName = appName.trim();
    if (!trimmedName) return;

    const response = await orbitApiFetch("/privacy/excluded-apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_name: trimmedName }),
    });

    if (!response.ok) throw new Error("Failed to add excluded app.");

    // Append optimistically — keeps the UI instant without a refetch round-trip.
    setExcludedApps((previous) =>
      previous.includes(trimmedName) ? previous : [...previous, trimmedName].sort()
    );
  }, []);

  const removeExcludedApp = useCallback(
    async (appName: string): Promise<void> => {
      const encodedName = encodeURIComponent(appName);
      const response = await orbitApiFetch(
        `/privacy/excluded-apps/${encodedName}`,
        { method: "DELETE" }
      );

      if (!response.ok) throw new Error("Failed to remove excluded app.");

      setExcludedApps((previous) =>
        previous.filter((existingName) => existingName !== appName)
      );
    },
    []
  );

  const addExcludedDomain = useCallback(
    async (domain: string): Promise<void> => {
      const normalizedDomain = normalizeDomain(domain);
      if (!normalizedDomain) return;

      const response = await orbitApiFetch(
        "/privacy/excluded-domains",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: normalizedDomain }),
        }
      );

      if (!response.ok) throw new Error("Failed to add excluded domain.");

      setExcludedDomains((previous) =>
        previous.includes(normalizedDomain)
          ? previous
          : [...previous, normalizedDomain].sort()
      );
    },
    []
  );

  const removeExcludedDomain = useCallback(
    async (domain: string): Promise<void> => {
      const encodedDomain = encodeURIComponent(domain);
      const response = await orbitApiFetch(
        `/privacy/excluded-domains/${encodedDomain}`,
        { method: "DELETE" }
      );

      if (!response.ok) throw new Error("Failed to remove excluded domain.");

      setExcludedDomains((previous) =>
        previous.filter((existingDomain) => existingDomain !== domain)
      );
    },
    []
  );

  const setNativeBrowserEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      const response = await orbitApiFetch("/privacy/browser-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ native_enabled: enabled }),
      });
      if (!response.ok) throw new Error("Failed to update native browser capture setting.");
      setNativeBrowserEnabledState(enabled);
    },
    []
  );

  const setFileWatchEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      const response = await orbitApiFetch("/privacy/file-watching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("Failed to update file watching setting.");
      setFileWatchEnabledState(enabled);
    },
    []
  );

  const setScreenContentEnabled = useCallback(
    async (enabled: boolean): Promise<void> => {
      const response = await orbitApiFetch("/privacy/screen-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("Failed to update on-screen content setting.");
      setScreenContentEnabledState(enabled);
    },
    []
  );

  const addWatchedFolder = useCallback(
    async (folder: string): Promise<void> => {
      const response = await orbitApiFetch("/privacy/watched-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      });
      if (!response.ok) throw new Error("Failed to add watched folder.");
      setWatchedFolders((previous) =>
        previous.includes(folder) ? previous : [...previous, folder]
      );
    },
    []
  );

  const removeWatchedFolder = useCallback(
    async (folder: string): Promise<void> => {
      const response = await orbitApiFetch("/privacy/watched-folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      });
      if (!response.ok) throw new Error("Failed to remove watched folder.");
      setWatchedFolders((previous) =>
        previous.filter((existingFolder) => existingFolder !== folder)
      );
    },
    []
  );

  // durationMinutes: how long to pause. null = pause indefinitely.
  const pauseCapture = useCallback(
    async (durationMinutes: number | null): Promise<void> => {
      const pausedUntilTimestamp =
        durationMinutes !== null
          ? Date.now() + durationMinutes * 60 * 1000
          : null;

      const response = await orbitApiFetch("/privacy/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused_until_timestamp: pausedUntilTimestamp }),
      });

      if (!response.ok) throw new Error("Failed to pause capture.");

      setIsCapturing(false);
      setPausedUntil(pausedUntilTimestamp);
    },
    []
  );

  const resumeCapture = useCallback(async (): Promise<void> => {
    const response = await orbitApiFetch("/privacy/resume", {
      method: "POST",
    });

    if (!response.ok) throw new Error("Failed to resume capture.");

    setIsCapturing(true);
    setPausedUntil(null);
  }, []);

  const wipeAllMemory = useCallback(async (): Promise<void> => {
    setIsWiping(true);
    try {
      const response = await orbitApiFetch("/privacy/all-data", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Wipe failed.");
    } finally {
      // Always clear the wiping spinner, even on error.
      setIsWiping(false);
    }
  }, []);

  return {
    isCapturing,
    pausedUntil,
    excludedApps,
    excludedDomains,
    nativeBrowserEnabled,
    fileWatchEnabled,
    screenContentEnabled,
    watchedFolders,
    isWiping,
    isLoading,
    error,
    addExcludedApp,
    removeExcludedApp,
    addExcludedDomain,
    removeExcludedDomain,
    setNativeBrowserEnabled,
    setFileWatchEnabled,
    setScreenContentEnabled,
    addWatchedFolder,
    removeWatchedFolder,
    pauseCapture,
    resumeCapture,
    wipeAllMemory,
  };
}
