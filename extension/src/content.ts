/**
 * Orbit content script — extracts readable page content, detects search queries,
 * and captures link clicks. Runs inside the page context.
 *
 * MV3 content scripts are tied to the page they run in — a fresh module
 * instance is created per navigation. Module-level variables here are
 * page-scoped and do not have the service-worker restart pitfall described
 * in background.ts (global state is fine for a single-page lifetime).
 *
 * All messages are routed to the background service worker via
 * chrome.runtime.sendMessage — content scripts cannot reliably POST to
 * localhost directly in MV3.
 */

import { Readability } from "@mozilla/readability";

import { detectSearchQuery } from "./lib/search-engines";

// ---------------------------------------------------------------------------
// Message types — sent from this content script to background.ts.
// ---------------------------------------------------------------------------

interface PageContentMessage {
  type: "page_content";
  payload: {
    url: string;
    title: string;
    page_text: string;       // truncated to PAGE_TEXT_MAX_CHARS
    author: string | null;
    site_name: string | null;
    excerpt: string | null;
    time_on_page: number;    // seconds the tab was visible
  };
}

interface SearchQueryMessage {
  type: "search_query";
  payload: {
    url: string;
    query: string;
    search_engine: string;
    time_on_page: number;
  };
}

interface LinkClickMessage {
  type: "link_click";
  payload: {
    source_url: string;
    link_target: string;
    link_text: string;
  };
}

type ContentToBackgroundMessage =
  | PageContentMessage
  | SearchQueryMessage
  | LinkClickMessage;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Minimum visible time before we consider the page worth capturing. Pages
// the user bounced off (< 5 s) are discarded to avoid noise.
const PAGE_VISIBLE_THRESHOLD_MS = 5_000;

// We only need enough article text for the AI to understand context — not the
// whole article, which would blow up the session summary prompt.
const PAGE_TEXT_MAX_CHARS = 2_000;

// Minimum gap between link-click events for the same tab; prevents rapid
// double-fires from event bubbling or fast repeated clicks.
const LINK_CLICK_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Page-scoped state
// ---------------------------------------------------------------------------

let pageVisibleSinceMs: number | null = null;
let visibilityTimerId: ReturnType<typeof setTimeout> | null = null;

// Populated after the 5-second threshold passes; sent on first departure.
type BufferedCapture =
  | { kind: "page_content"; payload: Omit<PageContentMessage["payload"], "time_on_page"> }
  | { kind: "search_query"; payload: Omit<SearchQueryMessage["payload"], "time_on_page"> };

let bufferedCapture: BufferedCapture | null = null;
let captureEventSent = false;
let lastLinkClickSentMs = 0;

// ---------------------------------------------------------------------------
// Content extraction (runs once after the 5-second threshold)
// ---------------------------------------------------------------------------

function extractAndBufferCapture(): void {
  const detectedSearch = detectSearchQuery(window.location.href);

  if (detectedSearch) {
    bufferedCapture = {
      kind: "search_query",
      payload: {
        url: window.location.href,
        query: detectedSearch.query,
        search_engine: detectedSearch.engineName,
      },
    };
    return;
  }

  // Clone before passing to Readability — the library mutates the DOM of the
  // document it receives. Mutating the live document would break the page.
  const documentClone = document.cloneNode(true) as Document;
  const article = new Readability(documentClone).parse();

  bufferedCapture = {
    kind: "page_content",
    payload: {
      url: window.location.href,
      title: article?.title ?? document.title,
      page_text: (article?.textContent ?? "").trim().slice(0, PAGE_TEXT_MAX_CHARS),
      author: article?.byline ?? null,
      site_name: article?.siteName ?? null,
      excerpt: article?.excerpt ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Sending to background worker
// ---------------------------------------------------------------------------

function sendBufferedCapture(): void {
  if (captureEventSent || bufferedCapture === null || pageVisibleSinceMs === null) return;
  captureEventSent = true;

  const timeOnPageSeconds = Math.round((Date.now() - pageVisibleSinceMs) / 1000);

  let message: ContentToBackgroundMessage;

  if (bufferedCapture.kind === "page_content") {
    message = {
      type: "page_content",
      payload: { ...bufferedCapture.payload, time_on_page: timeOnPageSeconds },
    };
  } else {
    message = {
      type: "search_query",
      payload: { ...bufferedCapture.payload, time_on_page: timeOnPageSeconds },
    };
  }

  chrome.runtime.sendMessage(message).catch(() => {
    // Fail silently — background worker may not be running.
  });
}

function sendLinkClick(linkTarget: string, linkText: string): void {
  const now = Date.now();
  if (now - lastLinkClickSentMs < LINK_CLICK_DEBOUNCE_MS) return;
  lastLinkClickSentMs = now;

  const message: LinkClickMessage = {
    type: "link_click",
    payload: {
      source_url: window.location.href,
      link_target: linkTarget,
      link_text: linkText.trim().slice(0, 200),
    },
  };

  chrome.runtime.sendMessage(message).catch(() => {
    // Fail silently.
  });
}

// ---------------------------------------------------------------------------
// Visibility lifecycle
// ---------------------------------------------------------------------------

function onPageBecameVisible(): void {
  if (visibilityTimerId !== null) return;  // timer already running — do nothing

  pageVisibleSinceMs = Date.now();

  visibilityTimerId = setTimeout(() => {
    visibilityTimerId = null;
    extractAndBufferCapture();
  }, PAGE_VISIBLE_THRESHOLD_MS);
}

function onPageBecameHidden(): void {
  if (visibilityTimerId !== null) {
    // User left before the 5-second threshold — cancel and capture nothing.
    clearTimeout(visibilityTimerId);
    visibilityTimerId = null;
    pageVisibleSinceMs = null;
    return;
  }

  sendBufferedCapture();
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    onPageBecameVisible();
  } else {
    onPageBecameHidden();
  }
});

// pagehide fires more reliably than unload in modern Chrome for tab closes and
// back/forward navigations. The captureEventSent guard prevents a double-send
// when visibilitychange → hidden fires just before pagehide on the same exit.
window.addEventListener("pagehide", () => {
  onPageBecameHidden();
});

document.addEventListener("click", (event: MouseEvent) => {
  // Only capture left-clicks on actual anchor elements.
  if (event.button !== 0) return;

  const clickTarget = event.target as HTMLElement;
  const anchorElement = clickTarget.closest("a");
  if (!anchorElement) return;

  const href = anchorElement.href;
  // javascript:/vbscript: aren't real navigations. data: URIs can be
  // megabytes of inline base64 (e.g. a "download as data:" link) — none of
  // these are meaningful as a recorded link click, and the data: case would
  // otherwise bloat stored events with noise.
  if (
    !href ||
    href.startsWith("javascript:") ||
    href.startsWith("data:") ||
    href.startsWith("vbscript:")
  ) {
    return;
  }

  // Skip intra-page fragment jumps (#section links). These are scroll events,
  // not navigations — capturing them produces noise with no recall value.
  if (
    anchorElement.hash &&
    anchorElement.pathname === window.location.pathname &&
    anchorElement.hostname === window.location.hostname
  ) {
    return;
  }

  const linkText = anchorElement.textContent ?? "";
  sendLinkClick(href, linkText);
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

// If the content script injects while the page is already visible (the common
// case for foreground navigation), start the timer immediately. Background-tab
// preloads begin the timer only when the tab becomes active (visibilitychange).
if (document.visibilityState === "visible") {
  onPageBecameVisible();
}
