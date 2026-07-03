import { useState, useEffect } from "react";
import { BACKEND_BASE_URL } from "../lib/config";

export interface GroqSettingsState {
  isConfigured: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveKey: (apiKey: string) => Promise<void>;
  removeKey: () => Promise<void>;
}

export function useGroqSettings(): GroqSettingsState {
  const [isConfigured, setIsConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchStatus();
  }, []);

  async function fetchStatus(): Promise<void> {
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/settings/groq-key`);
      if (!response.ok) throw new Error("Failed to load Groq key status.");
      const data = await response.json() as { configured: boolean };
      setIsConfigured(data.configured);
    } catch {
      // Fail silently — treat as unconfigured if the backend is unreachable.
    } finally {
      setIsLoading(false);
    }
  }

  async function saveKey(apiKey: string): Promise<void> {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/settings/groq-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
      if (!response.ok) {
        const data = await response.json() as { detail?: string };
        throw new Error(data.detail ?? "Failed to save key.");
      }
      setIsConfigured(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save key.";
      setError(message);
      throw err;
    } finally {
      setIsSaving(false);
    }
  }

  async function removeKey(): Promise<void> {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/settings/groq-key`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to remove key.");
      setIsConfigured(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove key.";
      setError(message);
      throw err;
    } finally {
      setIsSaving(false);
    }
  }

  return { isConfigured, isLoading, isSaving, error, saveKey, removeKey };
}
