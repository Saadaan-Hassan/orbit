import { useState, useEffect } from "react";
import { BACKEND_BASE_URL } from "../lib/config";

export interface ProviderStatusState {
  claudeEnabled: boolean;
  geminiEnabled: boolean;
  groqEnabled: boolean;
  isLoading: boolean;
}

/**
 * Read-only status of which AI providers are currently active. This is an
 * admin-controlled setting (Cloudflare Worker kill switch) — there is no
 * user-facing control to change it, only to see it.
 */
export function useProviderStatus(): ProviderStatusState {
  const [claudeEnabled, setClaudeEnabled] = useState(true);
  const [geminiEnabled, setGeminiEnabled] = useState(true);
  const [groqEnabled, setGroqEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus(): Promise<void> {
      try {
        const response = await fetch(`${BACKEND_BASE_URL}/settings/provider-status`);
        if (!response.ok) throw new Error("Failed to load provider status.");
        const data = await response.json() as { claude: boolean; gemini: boolean; groq: boolean };
        if (cancelled) return;
        setClaudeEnabled(data.claude);
        setGeminiEnabled(data.gemini);
        setGroqEnabled(data.groq);
      } catch {
        // Fail open — treat every provider as enabled if the backend or
        // Worker is unreachable, matching the backend's own fail-open default.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  return { claudeEnabled, geminiEnabled, groqEnabled, isLoading };
}
