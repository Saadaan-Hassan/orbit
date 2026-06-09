import { useCallback, useEffect, useState } from "react";

const BACKEND_BASE_URL = "http://localhost:47821";

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
  // True while DELETE /privacy/all-data is in flight.
  isWiping: boolean;
  // True while the initial load is in flight.
  isLoading: boolean;
  // Non-null when a network call fails.
  error: string | null;
  // Actions
  addExcludedApp: (appName: string) => Promise<void>;
  removeExcludedApp: (appName: string) => Promise<void>;
  pauseCapture: (durationMinutes: number | null) => Promise<void>;
  resumeCapture: () => Promise<void>;
  wipeAllMemory: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePrivacySettings(): PrivacySettings {
  const [isCapturing, setIsCapturing] = useState(true);
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  const [excludedApps, setExcludedApps] = useState<string[]>([]);
  const [isWiping, setIsWiping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load both endpoints in parallel on mount so the panel has data immediately.
  useEffect(() => {
    async function loadInitialState(): Promise<void> {
      try {
        const [statusResponse, excludedResponse] = await Promise.all([
          fetch(`${BACKEND_BASE_URL}/privacy/capture-status`),
          fetch(`${BACKEND_BASE_URL}/privacy/excluded-apps`),
        ]);

        if (!statusResponse.ok || !excludedResponse.ok) {
          throw new Error("Failed to load privacy settings from backend.");
        }

        const statusData: CaptureStatus = await statusResponse.json();
        const excludedData: { excluded_apps: string[] } =
          await excludedResponse.json();

        setIsCapturing(!statusData.is_paused);
        setPausedUntil(statusData.paused_until);
        setExcludedApps(excludedData.excluded_apps);
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

    const response = await fetch(`${BACKEND_BASE_URL}/privacy/excluded-apps`, {
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
      const response = await fetch(
        `${BACKEND_BASE_URL}/privacy/excluded-apps/${encodedName}`,
        { method: "DELETE" }
      );

      if (!response.ok) throw new Error("Failed to remove excluded app.");

      setExcludedApps((previous) =>
        previous.filter((existingName) => existingName !== appName)
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

      const response = await fetch(`${BACKEND_BASE_URL}/privacy/pause`, {
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
    const response = await fetch(`${BACKEND_BASE_URL}/privacy/resume`, {
      method: "POST",
    });

    if (!response.ok) throw new Error("Failed to resume capture.");

    setIsCapturing(true);
    setPausedUntil(null);
  }, []);

  const wipeAllMemory = useCallback(async (): Promise<void> => {
    setIsWiping(true);
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/privacy/all-data`, {
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
    isWiping,
    isLoading,
    error,
    addExcludedApp,
    removeExcludedApp,
    pauseCapture,
    resumeCapture,
    wipeAllMemory,
  };
}
