import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  NO_CAPTURE_CONSENT,
  type CaptureConsentChoices,
} from "@/components/CaptureConsentChoices";
import { orbitApiFetch } from "@/lib/local-api";

export interface CaptureConsent extends CaptureConsentChoices {
  consent_version: number;
  accepted: boolean;
}

export interface OnboardingState {
  isCompleted: boolean;
  isLoading: boolean;
  hasAccessibilityPermission: boolean;
  browserAutomationGranted: boolean;
  captureConsent: CaptureConsent;
  loadCaptureConsent: () => Promise<void>;
  saveCaptureConsent: (choices: CaptureConsentChoices) => Promise<void>;
  skipCaptureConsent: () => Promise<void>;
  checkAccessibilityPermission: () => Promise<boolean>;
  requestAccessibilityPermission: () => Promise<void>;
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
  const [captureConsent, setCaptureConsent] = useState<CaptureConsent>({
    consent_version: 1,
    accepted: false,
    ...NO_CAPTURE_CONSENT,
  });

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
        // A failed onboarding-state read must not bypass consent. The backend
        // itself still fails closed, and the user can continue after choosing
        // "keep capture off" from the review step.
        setIsCompleted(false);
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

  // Registers Orbit with macOS's TCC system (and surfaces the native
  // permission dialog if the user hasn't decided yet). Without this,
  // Orbit never appears in System Settings' Accessibility list at all —
  // `AXIsProcessTrusted()` alone only reads status, it never causes macOS
  // to add an entry for an app that's never asked.
  const requestAccessibilityPermission = useCallback(async (): Promise<void> => {
    try {
      await invoke("trigger_accessibility_permission_prompt");
    } catch {
      // Best-effort — the user can still enable it manually if this fails.
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

  const loadCaptureConsent = useCallback(async (): Promise<void> => {
    const response = await orbitApiFetch("/privacy/consent");
    if (!response.ok) throw new Error("Could not load capture consent.");
    setCaptureConsent((await response.json()) as CaptureConsent);
  }, []);

  const saveCaptureConsent = useCallback(
    async (choices: CaptureConsentChoices): Promise<void> => {
      const response = await orbitApiFetch("/privacy/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choices),
      });
      if (!response.ok) throw new Error("Could not save capture consent.");
      setCaptureConsent((previous) => ({ ...previous, accepted: true, ...choices }));
    },
    []
  );

  const skipCaptureConsent = useCallback(async (): Promise<void> => {
    const response = await orbitApiFetch("/privacy/consent/skip", {
      method: "POST",
    });
    if (!response.ok) throw new Error("Could not keep capture disabled.");
    setCaptureConsent((previous) => ({
      ...previous,
      accepted: false,
      ...NO_CAPTURE_CONSENT,
    }));
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
    captureConsent,
    loadCaptureConsent,
    saveCaptureConsent,
    skipCaptureConsent,
    checkAccessibilityPermission,
    requestAccessibilityPermission,
    openAccessibilitySettings,
    checkBrowserAutomation,
    requestBrowserAutomation,
    openAutomationSettings,
    completeOnboarding,
  };
}
