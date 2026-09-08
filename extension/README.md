# Orbit browser extension

The extension captures browser activity only after you explicitly pair it from
Orbit's Privacy panel. It stores its capture-only bearer token in
`chrome.storage.local`: this survives a browser restart, but is never exposed to
web pages or content scripts. Removing/revoking the pairing disables capture.

Permissions: `tabs` reads the active tab URL/title; `storage` retains pairing
and duplicate-delivery state; the single host permission reaches Orbit's local
sidecar at `http://localhost:47821`. It does not request `file://` access.
Incognito pages are excluded unless the user separately enables the extension in
Chrome's “Allow in Incognito” setting.
