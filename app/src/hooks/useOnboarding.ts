import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface OnboardingState {
  isCompleted: boolean;
  isLoading: boolean;
  hasAccessibilityPermission: boolean;
  checkAccessibilityPermission: () => Promise<boolean>;
  openAccessibilitySettings: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

export function useOnboarding(): OnboardingState {
  const [isLoading, setIsLoading] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);
  const [hasAccessibilityPermission, setHasAccessibilityPermission] =
    useState(false);

  useEffect(() => {
    async function loadInitialState(): Promise<void> {
      try {
        const [completed, accessible] = await Promise.all([
          invoke<boolean>("get_onboarding_completed"),
          invoke<boolean>("check_accessibility_permission_granted"),
        ]);
        setIsCompleted(completed);
        setHasAccessibilityPermission(accessible);
      } catch {
        // Fail open — don't block the user if IPC fails
        setIsCompleted(true);
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialState();
  }, []);

  const checkAccessibilityPermission = useCallback(async (): Promise<boolean> => {
    try {
      const granted = await invoke<boolean>("check_accessibility_permission_granted");
      setHasAccessibilityPermission(granted);
      return granted;
    } catch {
      return false;
    }
  }, []);

  const openAccessibilitySettings = useCallback(async (): Promise<void> => {
    try {
      await invoke("open_accessibility_system_settings");
    } catch {
      // Fail silently
    }
  }, []);

  const completeOnboarding = useCallback(async (): Promise<void> => {
    try {
      await invoke("mark_onboarding_completed");
      setIsCompleted(true);
    } catch {
      // Still mark locally so the user isn't blocked
      setIsCompleted(true);
    }
  }, []);

  return {
    isCompleted,
    isLoading,
    hasAccessibilityPermission,
    checkAccessibilityPermission,
    openAccessibilitySettings,
    completeOnboarding,
  };
}
