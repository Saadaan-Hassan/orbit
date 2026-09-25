# Phase 3 Pre-Beta — Timeline, Project Cards & UX Philosophy

> **Historical planning doc — written 2026-09-06, before the open-source
> hardening pass.** This phase is complete — see `AGENTS.md`'s "Completed
> phases" line and its architecture reference for the current
> implementation. Kept for design-history context, not as a current
> reference.

**Goal:** Give users a reason to open Orbit every day — not just when they forget
something. Build the visual timeline, project cards dashboard, and fix the core
UX philosophy before the first beta user installs.

**Run these prompts in order. Each builds on the previous.**

---

## Product Philosophy (Read Before Building)

Orbit's job is **context restoration** — showing the user WHERE THEY WERE —
not task management. The distinction:

❌ **Wrong:** "Next step: Implement the webhook handler in billing.ts"
*(AI guessing what you should do — presumptuous, often wrong)*

✅ **Right:** "You were mid-way through implementing the webhook handler in
billing.ts. You had the Stripe docs open and had just copied `constructEvent`."
*(AI giving you your mental state back — always accurate, always valuable)*

Orbit does not know your priorities. It knows where you were. Every label,
every prompt, every UI string should reflect this difference.

**The rename:** `next_step` stays as a DB column and API field. In every
user-facing string it becomes **"Where you left off"** or
**"You were mid-way through."**

---

## What These Prompts Build

| Feature | Why It Matters |
|---|---|
| Philosophy fix | Changes how the product *feels* — honest, not presumptuous |
| Activity Timeline | Visual day view — gives users a reason to open Orbit daily |
| Project Cards | Dashboard for "I'm back, what was I doing?" — the core use case |
| Backend endpoints | Foundation both UI features depend on |

**Why the Timeline drives return visits:** Every day, there's something new
to see. The user's own behavior makes it fresh. After a month, it becomes a
personal record. The longer someone uses Orbit, the more interesting their
history gets. No other tool shows this automatically — no manual tracking.

---

## Prompt 1 — Philosophy Fix: Reframe "Next Step" Throughout the UI

**Run this first. Small effort, immediate impact on product feel.**

```
Read AGENTS.md fully first.

We are making a product philosophy change throughout the UI. Orbit's job
is context restoration — showing the user WHERE THEY WERE — not task
management. We are NOT removing the next_step data (keep all DB columns
and backend logic unchanged). We are only changing how it is LABELED and
FRAMED in the frontend.

Find every place in the frontend (app/src/) where:
- "next_step" is displayed to the user as a label
- "Next step:" appears as text in any component
- Recall responses reference "next step" in the Claude system prompt
  (backend/routes/recall.py RECALL_SYSTEM_PROMPT)
- The Continue button pre-fills "Next step:" in the chat query

Make these specific copy changes:

1. In any UI label:
   "Next step:" → "Where you left off:"
   "Next Step" → "Where you left off"

2. In the recall system prompt (RECALL_SYSTEM_PROMPT in recall.py),
   update the instruction about next_step:
   Find the line(s) that say something like "tell the user what their
   next step is" or reference next_step as a forward-looking suggestion.
   Change the framing to: "Describe where the user was in their work —
   what they were mid-way through, what was left open, what state things
   were in when they stopped. Do NOT prescribe what they should do next.
   Describe where they were."

3. In any session card or detail view that shows this data:
   The label next to the next_step value should read:
   "Mid-way through:" or "You were mid-way through:" depending on context.

4. If a "Continue" button exists in ChatPanel.tsx, change the auto-filled
   query from anything like "Help me with next step..." to:
   "I'm back — can you remind me exactly where I was with [project_name]?
   What was I in the middle of?"

Do NOT change: DB column names, API field names, any backend logic,
any variable names in Python or Rust code. Only change user-visible
text strings.

Show me every file changed and the exact text before/after for each
change. Follow AGENTS.md conventions.
```

---

## Prompt 2 — Backend: Timeline + Projects Endpoints

**Foundation for both UI features. Run before Prompts 3 and 4.**

```
Read AGENTS.md fully first.

We are adding two new read-only endpoints that power the Activity Timeline
and Project Cards UI features. These query existing sessions data — no
new capture logic, no new tables.

--- Part A: backend/routes/timeline.py ---

Create this new router. Mount it in main.py with prefix /timeline.

GET /timeline/day

Query params: date (string, format "YYYY-MM-DD", defaults to today
in local time if omitted).

Logic:
  Convert the date string to start_ms and end_ms (midnight-to-midnight
  UTC offsets — use the local timezone from the system, or accept an
  optional tz_offset_minutes query param as integer, default 0).

  Query sessions:
    SELECT id, start_time, end_time, project_name, activity,
           ai_summary, active_minutes, category, topics,
           last_action, key_resources, blockers
    FROM sessions
    WHERE start_time >= :start_ms AND start_time < :end_ms
      AND project_name IS NOT NULL
    ORDER BY start_time ASC

Response model (Pydantic):
  class TimelineSession(BaseModel):
      id: str
      start_time: int       -- unix ms
      end_time: int         -- unix ms
      duration_minutes: int -- computed: (end_time - start_time) / 60000
      project_name: str
      activity: str | None
      ai_summary: str | None
      active_minutes: int | None
      category: str | None
      topics: list[str]         -- parsed from JSON, empty list if null
      last_action: str | None
      key_resources: list[str]  -- parsed from JSON
      blockers: str | None

  class DayTimelineResponse(BaseModel):
      date: str                    -- "YYYY-MM-DD"
      sessions: list[TimelineSession]
      total_active_minutes: int    -- sum of active_minutes
      total_duration_minutes: int  -- sum of duration_minutes
      project_count: int           -- distinct project_names

Return 200 with DayTimelineResponse (sessions list may be empty).

GET /timeline/dates

Returns a list of dates that have session data (for navigation/calendar):
  SELECT DISTINCT DATE(start_time/1000, 'unixepoch') as session_date
  FROM sessions
  WHERE project_name IS NOT NULL
  ORDER BY session_date DESC
  LIMIT 90   -- last 90 days max

Response: {"dates": ["2026-06-23", "2026-06-22", ...]}

--- Part B: backend/routes/projects.py ---

Create this new router. Mount in main.py with prefix /projects.

GET /projects

Returns all auto-detected projects with aggregated stats.

  SELECT
    project_name,
    COUNT(*) as total_session_count,
    SUM(CASE WHEN start_time > :seven_days_ago THEN 1 ELSE 0 END)
      as session_count_7d,
    SUM(CASE WHEN start_time > :seven_days_ago
      THEN COALESCE(active_minutes,0) ELSE 0 END)
      as total_active_minutes_7d,
    MAX(end_time) as last_active_ms
  FROM sessions
  WHERE project_name IS NOT NULL
  GROUP BY project_name
  ORDER BY last_active_ms DESC

For each project, also fetch the most recent session's activity and
last_action (subquery: SELECT activity, last_action FROM sessions
WHERE project_name = x ORDER BY end_time DESC LIMIT 1).

Response model:
  class ProjectCard(BaseModel):
      project_name: str
      last_active_ms: int
      last_active_minutes_ago: int    -- computed: (now_ms - last_active_ms) / 60000
      last_activity: str | None       -- activity field from most recent session
      last_action: str | None         -- last_action from most recent session
      active_minutes_7d: int
      session_count_7d: int
      total_session_count: int

  class ProjectsResponse(BaseModel):
      projects: list[ProjectCard]

GET /projects/{project_name}/sessions

Returns all sessions for a specific project, newest first:
  SELECT id, start_time, end_time, activity, ai_summary, active_minutes,
         last_action, key_resources, topics, blockers
  FROM sessions
  WHERE project_name = :project_name
  ORDER BY end_time DESC
  LIMIT 20

Response: {"project_name": str, "sessions": list[TimelineSession]}

--- Part C: backend/main.py ---

Mount the two new routers:
  from backend.routes import timeline, projects
  app.include_router(timeline.router)
  app.include_router(projects.router)

Follow all AGENTS.md conventions. Type hints everywhere, async routes,
Pydantic response models. Show me the complete timeline.py, projects.py,
and the main.py additions.
```

---

## Prompt 3 — Activity Timeline UI

**The feature that gives users a reason to open Orbit every day.**

```
Read AGENTS.md fully first.

We are building the Activity Timeline — a visual day view that shows
what the user worked on, when, and for how long. This is a new tab/panel
in the app alongside the existing chat panel.

The backend endpoints /timeline/day and /timeline/dates already exist
(built in the previous prompt).

--- Part A: app/src/hooks/useTimeline.ts ---

New hook.

  useTimeline(date?: string):
    date defaults to today ("YYYY-MM-DD" in local time).
    Fetches GET /timeline/day?date=<date> on mount and when date changes.
    Also fetches GET /timeline/dates once on mount (for navigation).
    Returns: { sessions, totalActiveMinutes, totalDurationMinutes,
               projectCount, availableDates, isLoading, error,
               selectedDate, setSelectedDate }
    On setSelectedDate: re-fetches /timeline/day for the new date.
    Caches results in a Map keyed by date string (no re-fetch if cached).

--- Part B: app/src/components/Timeline/TimelineView.tsx ---

The main timeline component.

Layout (vertical stack):

  1. DATE NAVIGATION BAR
     ← [Yesterday] [Today] [→ disabled if today]
     Show the formatted date: "Today, June 23" / "Yesterday, June 22" /
     "Monday, June 20"
     Left arrow navigates to previous available date in availableDates.
     Right arrow disabled when viewing today.

  2. STATS ROW (3 small pills/badges):
     🕐 <totalActiveMinutes>m active
     📁 <projectCount> projects
     ⚡ <longest_block>m longest focus
     (longest_block = max duration_minutes of any single session)
     These are shown only when sessions exist. Subtle, not prominent.

  3. THE TIMELINE STRIP
     A horizontal bar spanning the full width.
     Represents the work day: default 8am–8pm (12 hours visible).
     If sessions exist outside this range, auto-expand to fit.

     Each session is a colored block:
     - X position: proportional to start_time within the day
     - Width: proportional to duration_minutes
     - Minimum width: 8px (so short sessions are still visible/clickable)
     - Color: derived from project_name using a deterministic hash
       (same project always gets same color; use 8 distinct warm colors
       from a predefined palette — no random colors)
     - The block is slightly rounded (border-radius: 4px)
     - On hover: show a small tooltip with project_name + duration

     TIME MARKERS below the strip:
     Show hour labels at clean intervals: 8am, 10am, 12pm, 2pm, 4pm, 6pm, 8pm
     As small gray text below the strip.

     "No data" state: If no sessions, show the empty strip with time markers
     and a centered message: "Nothing captured yet for this day"

  4. SESSION LIST (below the strip)
     Scrollable list of session cards, ordered by start_time ASC.

     Each session card:
     ┌─────────────────────────────────────────────────────┐
     │ ● [color dot] PROJECT NAME          9:30 – 10:45am │
     │                                     75 min          │
     │ You were mid-way through: <activity or ai_summary>  │
     │                                                      │
     │ [if last_action] Left off: <last_action>            │
     │ [if topics] Topics: tag, tag, tag                   │
     └─────────────────────────────────────────────────────┘

     Color dot matches the timeline block color for that project.

     Clicking a card:
     - Expands it to show full detail (key_resources, blockers if any)
     - Shows an "Ask Orbit about this" button that pre-fills the recall
       chat with: "Tell me about my [project_name] session on [date]"
       and switches to the Chat tab

  5. EMPTY STATE (no sessions at all)
     If sessions is empty:
     "No activity recorded for this day.
      Orbit captures activity automatically while you work."

Color palette for projects (8 colors, warm/distinct):
  ["#E8A87C", "#85C1E9", "#82E0AA", "#F1948A", "#BB8FCE",
   "#F8C471", "#76D7C4", "#AEB6BF"]
  Assign by: hash(project_name) % 8

--- Part C: app/src/components/TabBar.tsx (or equivalent nav) ---

Add a "Timeline" tab alongside the existing chat tab.
Use a calendar or clock icon (from lucide-react).
Tab label: "Timeline"

The existing chat panel is still the default/first tab.
Timeline is the second tab.

--- Part D: app/src/App.tsx or the main layout ---

Wire up the TabBar and render either <ChatPanel> or <TimelineView>
based on active tab. Manage active tab in local state.

Use existing Tailwind classes and any shadcn/ui components already
in the project. Match the existing visual style exactly.
No new npm dependencies unless absolutely necessary.

Follow AGENTS.md conventions. Show me the complete hook,
TimelineView.tsx, and the layout changes.
```

---

## Prompt 4 — Project Cards Home Screen

**The daily utility view: "I'm back at my desk, what was I working on?"**

```
Read AGENTS.md fully first.

We are redesigning the ChatPanel's initial state (when conversation
history is empty) to show a Project Cards dashboard instead of a
blank chat input. When the user starts typing, the cards slide away
and the chat takes focus.

The backend endpoint GET /projects already exists (built in Prompt 2).

--- Part A: app/src/hooks/useProjects.ts ---

  useProjects():
    Fetches GET /projects on mount.
    Returns: { projects: ProjectCard[], isLoading: boolean }
    Caches for 5 minutes (don't re-fetch on every render).
    Fails silently (returns empty array) on error.
    Re-fetches when the window becomes visible
    (document.addEventListener('visibilitychange')).

--- Part B: app/src/components/ProjectCards.tsx ---

Shown only when conversation history is empty AND projects exist.

Layout:

  HEADER ROW:
  "Your projects" (small gray label, left)  "Today" badge showing
  total active minutes today if > 0 (right, e.g. "2h 15m today")

  CARDS GRID (2 columns, or 1 column if panel is narrow):
  Show up to 6 most recent projects (sorted by last_active_ms DESC).

  Each card:
  ┌────────────────────────────────┐
  │ ● PROJECT NAME                 │
  │                                │
  │ <activity (first 60 chars)>    │
  │                                │
  │ 2h 15m this week  · 3 sessions │
  │ Last active: 2 hours ago       │
  └────────────────────────────────┘

  The ● color dot is the same deterministic project color from Timeline.
  "Last active" formats as:
    < 60 min  → "X minutes ago"
    < 24h     → "X hours ago"
    yesterday → "Yesterday"
    else      → "Jun 20"

  Clicking a card body:
  - Pre-fills the recall input with: "Where did I leave off with
    [project_name]?" and auto-focuses the input (does NOT auto-submit —
    the user hits Enter to confirm).

  Clicking a small "→" icon on the card:
  - Instantly submits the query (for users who want one-click resume).

  "Show all projects" link below the grid if projects.length > 6
  (shows a simple scrollable list in the same panel).

  EMPTY STATE: if no projects yet (brand new install):
    Don't show anything — just show the chat input as normal.
    This prevents an ugly empty state during onboarding.

--- Part C: app/src/components/ChatPanel.tsx ---

Integrate ProjectCards:

  Import and render <ProjectCards /> above the input area,
  but ONLY when conversationHistory.length === 0.

  When the user starts typing in the recall input:
  - ProjectCards fades out with a simple CSS opacity transition
    (0.2s ease-out).
  - The input area expands to fill the space.

  Use a local isTyping state: set to true on any input onChange event,
  reset to false when conversationHistory resets.

  The transition should feel smooth, not jarring. Cards disappear when
  the user starts typing, reappear when the conversation is cleared.

Follow AGENTS.md conventions. Match existing visual style.
No new npm packages. Show me the complete hook, ProjectCards.tsx,
and the ChatPanel.tsx integration.
```

---

## Run Order

```
Prompt 1  →  Prompt 2  →  Prompt 3  →  Prompt 4
(30 min)     (1-2h)        (2-3h)        (1-2h)
```

- **Prompt 1** can be run independently at any time.
- **Prompt 2** must be run before Prompts 3 and 4 (UI depends on these endpoints).
- **Prompts 3 and 4** can be run in parallel if needed (they touch different files).

---

## Verify Each Prompt

After each Claude Code session, check:

**Prompt 1:**
```bash
# Search for any remaining "next step" labels in the UI
grep -r "Next step" app/src/ --include="*.tsx" --include="*.ts"
# Should return zero results
```

**Prompt 2:**
```bash
cd backend && uv run uvicorn main:app --port 47821 &
curl "http://localhost:47821/timeline/day?date=$(date +%Y-%m-%d)"
curl "http://localhost:47821/timeline/dates"
curl "http://localhost:47821/projects"
# All should return valid JSON
```

**Prompt 3:**
```bash
cd app && pnpm tauri dev
# Open the app — a "Timeline" tab should appear
# Click it — strip renders with time markers
# Click a session card — it expands
# "Ask Orbit about this" button switches to Chat tab with query pre-filled
```

**Prompt 4:**
```bash
cd app && pnpm tauri dev
# Open the app — Project Cards visible when chat is empty
# Start typing — cards fade out
# Click a card → input pre-filled
# Clear conversation → cards reappear
```

---

## After All 4 Prompts: Update AGENTS.md

```
Read all files changed across these four prompts.

Update AGENTS.md to document the new features:

- UX philosophy change: next_step renamed to "Where you left off" 
  in all user-facing strings. DB columns and API fields unchanged.
- New backend routes: /timeline/day, /timeline/dates, /projects, 
  /projects/{name}/sessions
- New frontend: Timeline tab (TimelineView.tsx, useTimeline.ts)
- New frontend: Project Cards dashboard (ProjectCards.tsx, useProjects.ts)
- Project color palette: 8 deterministic warm colors, hash(project_name) % 8
- ChatPanel: shows ProjectCards when conversation is empty, fades on typing
- Add new files to Key Files table
- Mark Phase 3 Pre-Beta UI complete

Show me what you changed in AGENTS.md.
```

---

*Phase 3 Pre-Beta — Orbit by Saadaan Hassan 🪐*
*Generated: June 2026*
