# Phase 2.5 — Deep Browser Capture

> **Historical planning doc — written 2026-09-06, before the open-source
> hardening pass.** This phase is complete — see `AGENTS.md`'s "Completed
> phases" line and the browser-capture sections of its architecture
> reference for the current implementation. Kept for design-history
> context, not as a current reference.

**Goal:** Capture what the user actually DID in the browser, not just which tabs
were open. This fixes the #1 recall complaint: "it knows the app but not what I
was doing in it."

**Why before Phase 3:** Most "what was I doing" activity happens in the browser.
This is higher value and far lower risk than screenshots. Build depth where
recall queries actually land first.

---

## What This Adds

Three new event types captured by the Chrome extension:

| Type | Captures | Answers queries like |
|---|---|---|
| `page_content` | Readable article/post text, author, site, time on page | "What did I read about X?" "What was that article?" |
| `link_click` | Which link you clicked and where it went | "What LinkedIn posts did I open?" |
| `search_query` | What you typed into search engines | "What did I search for?" |

---

## Privacy First (read before building)

Every new capture follows the EXISTING rules:
- Page content runs through the same secret-redaction patterns
- Domain exclude list — sensitive sites (banking, health, adult) never captured
- Only the first ~2000 chars of main content (not full pages)
- Content stored locally; only summaries go to AI
- User can view/delete all page content in MemoryViewer
- A global "don't capture page content" toggle (metadata-only mode)

---

## Step 1 — Backend: New Event Types + Schema

```
Read AGENTS.md fully first.

We are adding deeper browser capture. First, the backend must accept and store
three new event types: page_content, link_click, search_query.

Part A — backend/database.py
The events table currently has: id, timestamp, type, raw_content, app_name,
url, source, session_id, category.

Add three nullable columns to support richer browser data:
  page_text     TEXT,    -- extracted readable content (page_content events)
  link_target   TEXT,    -- destination URL (link_click events)
  metadata      TEXT     -- JSON: {author, site_name, time_on_page, link_text, search_engine}

Add these to the base CREATE TABLE and also to the lazy ALTER migration helper
(so existing DBs upgrade). Update the FTS5 virtual table and its triggers to
also index page_text (so we can keyword-search page content). The FTS5 table
should now mirror: raw_content, app_name, url, page_text.

Part B — backend/models/event.py
Extend the CaptureEvent Pydantic model with the new optional fields:
  page_text: str | None = None
  link_target: str | None = None
  metadata: dict | None = None

Keep all existing fields. The new fields are optional so existing events
(clipboard, window, url) still validate.

Part C — backend/routes/capture.py
Update POST /capture to accept and store the new fields. The same pause-state
and excluded-apps checks apply. Add one new check: a domain exclude list
(see Step 4) — if the event's URL domain is excluded, drop it.

Follow AGENTS.md conventions. Show me the schema changes, the model changes,
and the capture route changes.
```

**✅ Verify:**
```bash
rm ~/.orbit/orbit.db   # fresh schema
cd backend && uv run uvicorn main:app --port 47821 &
sqlite3 ~/.orbit/orbit.db "PRAGMA table_info(events);"
# Should show: page_text, link_target, metadata columns
curl -X POST http://localhost:47821/capture -H "Content-Type: application/json" \
  -d '{"id":"t1","timestamp":1700000000000,"type":"page_content","url":"https://example.com","raw_content":"Test Article","page_text":"This is the article body","app_name":"Chrome","source":"extension","metadata":{"author":"Jane","site_name":"Example"}}'
sqlite3 ~/.orbit/orbit.db "SELECT type, page_text FROM events WHERE type='page_content';"
```

---

## Step 2 — Chrome Extension: Page Content Extraction

```
Read AGENTS.md fully first.

We are upgrading the Chrome extension to extract readable page content.
Use Mozilla's Readability algorithm (the same one Firefox Reader Mode uses)
to extract the main article/post text, ignoring nav, ads, and sidebars.

Part A — Install Readability
  cd extension
  pnpm add @mozilla/readability

Part B — Update extension/src/content.ts (the content script)

The content script runs in the page context. It should:

1. Wait until the page has been visible for 5 seconds (use a timer; if the
   user leaves before 5s, capture nothing — avoids capturing pages they
   bounced off).

2. Extract readable content using Readability:
   - Clone the document (Readability mutates the DOM)
   - Run new Readability(documentClone).parse()
   - Get: title, textContent (the main readable text), byline (author),
     siteName, excerpt

3. Truncate textContent to the first 2000 characters (we don't need the whole
   article — just enough for the AI to understand what it was about).

4. Track time on page: record when the page became visible, and send the
   time_on_page when the user navigates away (use the visibilitychange and
   pagehide events).

5. Send a page_content event to the background script via chrome.runtime
   .sendMessage (content scripts can't directly POST to localhost reliably —
   route through the background service worker).

6. Detect search queries: if the URL matches known search engines
   (google.com/search, youtube.com/results, bing.com/search, duckduckgo.com),
   extract the query param (q for most, search_query for youtube) and send a
   search_query event instead.

7. Detect link clicks: add a click listener on the document. When a user
   clicks an <a> tag, capture the link text and href, send a link_click event.
   Debounce/dedupe rapid clicks.

Part C — Update extension/src/background.ts (service worker)

The background worker receives messages from content scripts and forwards them
to POST /capture. It already handles URL events — extend it to handle the new
message types (page_content, link_click, search_query), building the correct
event payload for each and POSTing to localhost:47821/capture.

Keep using chrome.storage.session for any state. Fail silently if Orbit backend
is unreachable.

Part D — Manifest permissions
Update extension/manifest.json if needed:
  - content_scripts must run on <all_urls> (already does)
  - May need "scripting" permission for the content extraction

Follow AGENTS.md conventions. Show me content.ts, the background.ts additions,
and any manifest.json changes.
```

**✅ Verify:**
```bash
cd extension && pnpm build
# Reload extension in chrome://extensions
# Visit a news article, wait 10 seconds, then:
sqlite3 ~/.orbit/orbit.db "SELECT type, raw_content, substr(page_text,1,80), metadata FROM events WHERE type='page_content' ORDER BY timestamp DESC LIMIT 3;"
# Should show the article title + extracted text + author/site metadata
# Do a Google search, then:
sqlite3 ~/.orbit/orbit.db "SELECT type, raw_content FROM events WHERE type='search_query' ORDER BY timestamp DESC LIMIT 3;"
```

---

## Step 3 — Redaction for Page Content

```
Read AGENTS.md fully first.

Page content could contain secrets (someone reading a page with an API key,
a tutorial showing a token, etc.). We must apply the same redaction to
page_text that we apply to clipboard content — but in the extension/backend,
since the Rust clipboard redaction doesn't see browser content.

Part A — Create a shared redaction function in the backend
backend/services/redaction_service.py

Port the same patterns from the Rust clipboard redaction:
  - PEM private keys
  - API key prefixes (sk-, AIza, AKIA, xoxb-, ghp_, pk_live_, sk_live_, pa-)
  - JWTs (3 base64 segments)
  - Credit cards
  - SSNs
  - Crypto addresses

Function: redact_sensitive_content(text: str) -> str
Returns the text with any matched secrets replaced by [REDACTED:type].
Unlike clipboard (which redacts the whole value), for page content replace
just the matched substring inline, so the surrounding context is preserved.

Part B — backend/routes/capture.py
For page_content events, run page_text through redact_sensitive_content()
before storing. Same for search_query text (someone might paste a key into
a search box).

Follow AGENTS.md conventions. Show me redaction_service.py and the capture
route change.
```

---

## Step 4 — Domain Exclude List

```
Read AGENTS.md fully first.

Users need to exclude sensitive sites from content capture (banking, health,
adult, internal company tools). We have an app exclude list — add a domain
exclude list for the browser.

Part A — backend/database.py
Create a new table:
  excluded_domains(
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    added_at INTEGER NOT NULL
  )

Seed default excluded domains on first run (sensitive categories):
  Banking/finance patterns are hard to enumerate, so seed a starter set:
  "mail.google.com", "accounts.google.com" (login flows)
  Leave most empty — users add their own. But DO seed a clear example so the
  UI isn't empty.

Part B — backend/routes/privacy.py
Add endpoints mirroring the excluded-apps ones:
  GET    /privacy/excluded-domains
  POST   /privacy/excluded-domains      {domain}
  DELETE /privacy/excluded-domains/{domain}

Part C — backend/routes/capture.py
For page_content, link_click, and url events: extract the domain from the URL
and check it against excluded_domains (cached in memory, refreshed every 30s
like the app exclude list). If excluded, drop the event silently.

Part D — Frontend: add domain exclusion to PrivacyPanel.tsx
Add a section "Excluded Websites" mirroring the excluded apps UI — list,
add by domain, remove. Subtext: "Content from these sites is never captured."
Wire it through usePrivacySettings.ts.

Follow AGENTS.md conventions. Show me the schema, the privacy endpoints, the
capture check, and the PrivacyPanel addition.
```

---

## Step 5 — Use Rich Content in Session Generation

```
Read AGENTS.md fully first.

Now that we capture page content, link clicks, and searches, the session
generator and recall must actually USE this richer data.

Part A — backend/scheduler.py
When building the events payload for Claude session summaries, include the
new fields for browser events:
  - For page_content events: include page_text (truncated to ~500 chars per
    event to control token cost), author, site_name
  - For search_query events: include the search query text
  - For link_click events: include link_text and link_target

This gives Claude the actual content to summarise, not just URLs. Update the
session summary user prompt to mention these are available, so Claude writes
summaries like "read an article by Jane Doe about vector databases" instead
of "visited a website."

Also update the JSON structure Claude returns to add:
  "topics": ["list of actual subjects/topics the user engaged with"]
Store this in the session (add a topics column, JSON array) — it makes
"what was I researching about X" queries far more accurate.

Part B — backend/routes/recall.py
The FTS5 search now indexes page_text, so keyword recall already improves.
Update the context block builder to include page content for matching events:
  [Jun 10 2:15 PM] Read: "Article Title" by Author (site.com) — <first 200 chars>
  [Jun 10 2:30 PM] Searched: "vector database comparison" on Google
  [Jun 10 2:31 PM] Clicked: "Interesting post" → linkedin.com/posts/...

This is what lets Orbit finally answer "what did I read?" and "what did I
search for?" with real specifics.

Follow AGENTS.md conventions. Show me the scheduler payload changes, the
prompt update, the topics column, and the recall context format change.
```

**✅ Verify (the real test):**
```bash
# Browse for 30 min: read 2-3 articles, do some searches, click some links
# Force a session:
cd backend && uv run python -c "from scheduler import generate_sessions_from_recent_events; import asyncio; asyncio.run(generate_sessions_from_recent_events())"
# Check the session captured real topics:
sqlite3 ~/.orbit/orbit.db "SELECT project_name, goal, ai_summary, topics FROM sessions ORDER BY start_time DESC LIMIT 2;"

# Then ask the questions that used to fail:
curl -X POST http://localhost:47821/recall -H "Content-Type: application/json" \
  -d '{"query":"what articles did I read?"}' --no-buffer
curl -X POST http://localhost:47821/recall -H "Content-Type: application/json" \
  -d '{"query":"what did I search for?"}' --no-buffer
# These should now give SPECIFIC answers with real titles/topics
```

---

## Step 6 — Update AGENTS.md

```
Read the current state of the extension, backend/routes/capture.py,
backend/database.py, backend/scheduler.py, and backend/routes/recall.py.

Update AGENTS.md to document Phase 2.5:
- New event types: page_content, link_click, search_query
- New events columns: page_text, link_target, metadata, and sessions.topics
- FTS5 now indexes page_text
- New redaction_service.py (shared redaction for browser content)
- Domain exclude list (excluded_domains table + privacy endpoints)
- Extension now extracts readable content via @mozilla/readability
- Privacy: page content redacted before storage, domain exclusions, content
  capture toggle
- Update the data flow diagrams to show the richer capture
- Mark Phase 2.5 complete

Show me what you changed.
```

---

## Phase 2.5 Done Checklist

- [ ] Article content captured (page_text populated for pages visited >5s)
- [ ] Search queries captured
- [ ] Link clicks captured
- [ ] Page content redacted before storage (test with a fake key on a page)
- [ ] Domain exclude list works (excluded site → nothing captured)
- [ ] Content capture can be toggled off entirely
- [ ] Session summaries now mention actual topics/articles, not just "a website"
- [ ] "What did I read about X?" returns specific, correct answers
- [ ] "What did I search for?" works
- [ ] MemoryViewer shows page content and lets you delete it

---

## The Test That Proves It Worked

Before Phase 2.5, this failed:
> "What links did I open on LinkedIn?" → "weren't captured at that level of detail"

After Phase 2.5, this should work:
> "What did I read this afternoon?"
> 📌 This afternoon you read 3 articles:
>   • "Building Memory Systems" by Jane Doe (example.com) — about vector
>     databases and retrieval
>   • "Why Context Matters" on Medium — you spent 8 minutes on this one
>   • A LinkedIn post about personal branding you clicked from your feed
> You also searched for "qdrant vs pinecone" and "voyage ai pricing".

If you get specifics like that, Phase 2.5 succeeded and you're ready for beta.