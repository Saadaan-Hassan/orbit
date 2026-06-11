/**
 * Orbit service worker — browser activity capture.
 *
 * MV3 RULE: Service workers are terminated when idle and restarted on demand.
 * Never rely on in-memory global variables for state. All persistent state
 * (lastSentUrl) lives in chrome.storage.session which survives SW restarts
 * within the same browser session.
 */

const ORBIT_CAPTURE_ENDPOINT = "http://localhost:47821/capture";

// ---------------------------------------------------------------------------
// Message types received from content.ts
// (Mirror the ContentToBackgroundMessage union defined there.)
// ---------------------------------------------------------------------------

interface ReceivedPageContent {
  type: "page_content";
  payload: {
    url: string;
    title: string;
    page_text: string;
    author: string | null;
    site_name: string | null;
    excerpt: string | null;
    time_on_page: number;
  };
}

interface ReceivedSearchQuery {
  type: "search_query";
  payload: {
    url: string;
    query: string;
    search_engine: string;
    time_on_page: number;
  };
}

interface ReceivedLinkClick {
  type: "link_click";
  payload: {
    source_url: string;
    link_target: string;
    link_text: string;
  };
}

type ReceivedContentMessage =
  | ReceivedPageContent
  | ReceivedSearchQuery
  | ReceivedLinkClick;

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

// ---------------------------------------------------------------------------
// Content script message handler
// ---------------------------------------------------------------------------

async function postToCaptureEndpoint(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(ORBIT_CAPTURE_ENDPOINT, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
  } catch {
    // Orbit backend is not running — fail silently.
  }
}

async function handleContentScriptMessage(
  message: ReceivedContentMessage,
  senderTabUrl: string,
): Promise<void> {
  if (message.type === "page_content") {
    const { title, page_text, author, site_name, excerpt, time_on_page } = message.payload;
    await postToCaptureEndpoint({
      id:          crypto.randomUUID(),
      timestamp:   Date.now(),
      type:        "page_content",
      raw_content: title,
      app_name:    "Chrome",
      url:         senderTabUrl,
      source:      "extension",
      page_text,
      metadata: { author, site_name, excerpt, time_on_page },
    });
    return;
  }

  if (message.type === "search_query") {
    const { query, search_engine, time_on_page } = message.payload;
    await postToCaptureEndpoint({
      id:          crypto.randomUUID(),
      timestamp:   Date.now(),
      type:        "search_query",
      raw_content: query,
      app_name:    "Chrome",
      url:         senderTabUrl,
      source:      "extension",
      metadata: { search_engine, time_on_page },
    });
    return;
  }

  if (message.type === "link_click") {
    const { link_target, link_text } = message.payload;
    await postToCaptureEndpoint({
      id:          crypto.randomUUID(),
      timestamp:   Date.now(),
      type:        "link_click",
      raw_content: link_text,
      app_name:    "Chrome",
      url:         senderTabUrl,
      source:      "extension",
      link_target,
      metadata: { link_text },
    });
  }
}

chrome.runtime.onMessage.addListener(
  (rawMessage: unknown, sender: chrome.runtime.MessageSender) => {
    const senderTabUrl = sender.tab?.url ?? "";
    if (!isUrlCapturable(senderTabUrl)) return;

    const message = rawMessage as ReceivedContentMessage;
    if (
      message.type !== "page_content" &&
      message.type !== "search_query" &&
      message.type !== "link_click"
    ) {
      return;
    }

    // Fire-and-forget: don't make the onMessage callback itself async —
    // that breaks the MV3 message channel for callbacks that use sendResponse.
    handleContentScriptMessage(message, senderTabUrl).catch(() => {});
  },
);
