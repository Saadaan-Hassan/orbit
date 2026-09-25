// URL schemes that are browser-internal or local-filesystem and must never be
// sent to Orbit. "file://" covers local HTML files; the extension:// variants
// cover browser-internal extension pages across Chrome, Safari, and Chromium forks.
export const BLOCKED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "safari-extension://",
  "about:",
  "edge://",
  "brave://",
  "file://",
];

export function isUrlCapturable(url: string): boolean {
  if (!url) return false;
  return !BLOCKED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}
