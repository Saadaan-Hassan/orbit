/**
 * Orbit service worker — browser activity capture.
 *
 * MV3 RULE: Service workers are terminated when idle and restarted on demand.
 * Never rely on in-memory global variables for state. All persistent state
 * (lastSentUrl) lives in chrome.storage.session which survives SW restarts
 * within the same browser session.
 */

const ORBIT_CAPTURE_ENDPOINT = "http://localhost:8000/capture";

// URL schemes that are browser-internal and should never be sent to Orbit.
const BLOCKED_URL_PREFIXES = ["chrome://", "chrome-extension://", "about:", "edge://", "brave://"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isUrlCapturable(url: string): boolean {
  if (!url) return false;
  return !BLOCKED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function readLastSentUrl(): Promise<string> {
  const stored = await chrome.storage.session.get("lastSentUrl");
  return (stored["lastSentUrl"] as string) ?? "";
}

async function writeLastSentUrl(url: string): Promise<void> {
  await chrome.storage.session.set({ lastSentUrl: url });
}

async function sendCaptureEvent(tab: chrome.tabs.Tab): Promise<void> {
  const tabUrl   = tab.url   ?? "";
  const tabTitle = tab.title ?? "";

  if (!isUrlCapturable(tabUrl)) return;

  const lastSentUrl = await readLastSentUrl();
  if (tabUrl === lastSentUrl) return;  // duplicate — skip

  const capturePayload = {
    id:          crypto.randomUUID(),
    timestamp:   Date.now(),
    type:        "url",
    raw_content: tabTitle,
    app_name:    "Chrome",
    url:         tabUrl,
    source:      "extension",
  };

  try {
    const response = await fetch(ORBIT_CAPTURE_ENDPOINT, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(capturePayload),
    });

    if (response.ok) {
      // Only update lastSentUrl after a confirmed successful delivery so
      // transient network failures don't permanently suppress future sends.
      await writeLastSentUrl(tabUrl);
    }
  } catch {
    // Orbit backend is not running — fail silently, no user-visible error.
  }
}

// ---------------------------------------------------------------------------
// Tab event listeners
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // onActivated gives us a tabId but not the full Tab object — fetch it.
  const activatedTab = await chrome.tabs.get(activeInfo.tabId);
  await sendCaptureEvent(activatedTab);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, updatedTab) => {
  // Only fire when the page has fully loaded; ignore intermediate states
  // like "loading" which fire before the final URL/title are available.
  if (changeInfo.status !== "complete") return;
  await sendCaptureEvent(updatedTab);
});
