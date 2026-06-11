import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface OnboardingState {
  isCompleted: boolean;
  isLoading: boolean;
  hasAccessibilityPermission: boolean;
  browserAutomationGranted: boolean;
  checkAccessibilityPermission: () => Promise<boolean>;
  openAccessibilitySettings: () => Promise<void>;
  checkBrowserAutomation: () => Promise<boolean>;
  requestBrowserAutomation: () => Promise<void>;
  openAutomationSettings: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

export function useOnboarding(): OnboardingState {
  const [isLoading, setIsLoading] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);
  const [hasAccessibilityPermission, setHasAccessibilityPermission] =
    useState(false);
  const [browserAutomationGranted, setBrowserAutomationGranted] =
    useState(false);

  // Tracks whether requestBrowserAutomation's polling loop should keep running.
  // Set to false on unmount to prevent state updates after the component is gone.
  const shouldPollBrowserAutomation = useRef(false);

  useEffect(() => {
    async function loadInitialState(): Promise<void> {
      try {
        const [completed, accessible, browserAutomation] = await Promise.all([
          invoke<boolean>("get_onboarding_completed"),
          invoke<boolean>("check_accessibility_permission_granted"),
          invoke<boolean>("check_browser_automation_permission"),
        ]);
        setIsCompleted(completed);
        setHasAccessibilityPermission(accessible);
        setBrowserAutomationGranted(browserAutomation);
      } catch {
        // Fail open — don't block the user if IPC fails
        setIsCompleted(true);
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialState();

    // Stop any in-progress automation polling when the consuming component unmounts.
    return () => {
      shouldPollBrowserAutomation.current = false;
    };
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

  // ---------------------------------------------------------------------------
  // Browser Automation permission
  // ---------------------------------------------------------------------------

  const checkBrowserAutomation = useCallback(async (): Promise<boolean> => {
    try {
      const granted = await invoke<boolean>("check_browser_automation_permission");
      setBrowserAutomationGranted(granted);
      return granted;
    } catch {
      return false;
    }
  }, []);

  // Triggers the macOS Automation permission dialogs for all known browsers,
  // then polls every 3 seconds until the user grants the permission.
  // Polling stops automatically when the consuming component unmounts.
  const requestBrowserAutomation = useCallback(async (): Promise<void> => {
    try {
      await invoke("trigger_browser_automation_prompt");
    } catch {
      // The dialog is best-effort — keep going even if the command fails.
    }

    shouldPollBrowserAutomation.current = true;

    while (shouldPollBrowserAutomation.current) {
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));

      if (!shouldPollBrowserAutomation.current) {
        break;
      }

      try {
        const granted = await invoke<boolean>("check_browser_automation_permission");
        if (granted) {
          setBrowserAutomationGranted(true);
          shouldPollBrowserAutomation.current = false;
        }
      } catch {
        // Keep polling on transient IPC errors.
      }
    }
  }, []);

  const openAutomationSettings = useCallback(async (): Promise<void> => {
    try {
      await invoke("open_automation_system_settings");
    } catch {
      // Fail silently
    }
  }, []);

  // ---------------------------------------------------------------------------

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
    browserAutomationGranted,
    checkAccessibilityPermission,
    openAccessibilitySettings,
    checkBrowserAutomation,
    requestBrowserAutomation,
    openAutomationSettings,
    completeOnboarding,
  };
}
