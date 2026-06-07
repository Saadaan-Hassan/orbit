import { usePostHog } from "@posthog/react";

export function useAnalytics() {
  const posthog = usePostHog();

  function captureEvent(
    eventName: string,
    properties?: Record<string, string | number | boolean>,
  ): void {
    if (!posthog) return;
    try {
      posthog.capture(eventName, properties);
    } catch {
      // Analytics must never break the app
    }
  }

  return { captureEvent };
}
