import { useCallback, useEffect, useState } from "react";

import { orbitApiFetch } from "../lib/local-api";

// ---------------------------------------------------------------------------
// Groq BYOK (bring-your-own-key) settings hook.
//
// The raw key is never returned by the backend after it's saved — only
// `configured`/`enabled` booleans. `testKey` sends a candidate key for a
// one-off validation call; the backend never persists it either way.
// ---------------------------------------------------------------------------

export type GroqKeyTestResult = { valid: true } | { valid: false; reason: string };

export interface GroqKeySettingsState {
  configured: boolean;
  enabled: boolean;
  isLoading: boolean;
  saveKey: (apiKey: string) => Promise<void>;
  removeKey: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  testKey: (apiKey: string) => Promise<GroqKeyTestResult>;
}

export function useGroqKeySettings(): GroqKeySettingsState {
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabledState] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await orbitApiFetch("/settings/groq-key");
      if (!response.ok) throw new Error("Failed to load Groq key status.");
      const data = (await response.json()) as { configured: boolean; enabled: boolean };
      setConfigured(data.configured);
      setEnabledState(data.enabled);
    } catch {
      // Leave prior state on a transient failure rather than blanking the UI.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveKey = useCallback(
    async (apiKey: string): Promise<void> => {
      const response = await orbitApiFetch("/settings/groq-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(body?.detail ?? "Could not save the key.");
      }
      await refresh();
    },
    [refresh]
  );

  const removeKey = useCallback(async (): Promise<void> => {
    const response = await orbitApiFetch("/settings/groq-key", { method: "DELETE" });
    if (!response.ok) throw new Error("Could not remove the key.");
    await refresh();
  }, [refresh]);

  const setEnabled = useCallback(
    async (nextEnabled: boolean): Promise<void> => {
      const response = await orbitApiFetch("/settings/groq-key/enabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      if (!response.ok) throw new Error("Could not update the key's enabled state.");
      await refresh();
    },
    [refresh]
  );

  const testKey = useCallback(async (apiKey: string): Promise<GroqKeyTestResult> => {
    try {
      const response = await orbitApiFetch("/settings/groq-key/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
      if (!response.ok) return { valid: false, reason: "network_error" };
      const data = (await response.json()) as { valid: boolean; reason: string };
      return data.valid ? { valid: true } : { valid: false, reason: data.reason };
    } catch {
      return { valid: false, reason: "network_error" };
    }
  }, []);

  return { configured, enabled, isLoading, saveKey, removeKey, setEnabled, testKey };
}
