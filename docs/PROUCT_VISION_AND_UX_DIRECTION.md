# Orbit — Product Vision & UX Direction

---

## The End Goal — One Sentence

> **Orbit is the tool people open when they've forgotten where they were — and it always knows.**

Not "AI memory companion." Not "personal ops layer." Not "second brain."
Just: *you ask, it knows, you continue.*

---

## What Orbit Actually Is

Most software helps people **do** work.
Orbit helps people **resume** work.

That is a fundamentally different product category. There is no mainstream tool
that owns this space. Notes apps, task managers, AI assistants — none of them
solve the specific pain of **context loss**. They all require you to have
remembered to write something down first.

Orbit requires nothing from the user. It just watches, understands, and answers.

**The positioning:**
> "Your computer's working memory."

Not a second brain (you have to feed a second brain).
Not a productivity tool (Orbit doesn't help you do more work).
Working memory — the thing that holds your mental state so you can pick up
exactly where you left off.

---

## Who Uses Orbit — Everyone, Same Experience

Orbit should never feel like a developer tool. The interface is identical for
every user. The AI adapts to what they actually do.

| User | They ask | Orbit knows |
|---|---|---|
| Developer | "What was I debugging?" | Files open, error messages, Stack Overflow searches, last code change |
| Designer | "What design was I working on?" | Figma tabs, reference images, design decisions, color research |
| Writer | "Where was I in my article?" | Draft state, research tabs, notes copied, outline structure |
| Student | "What was I studying?" | Course tabs, copied definitions, YouTube lectures, notes |
| Founder | "What did I discuss with Ahmed?" | Meeting context, action items, follow-ups, decisions made |
| Researcher | "What did I find about X?" | Papers read, key findings copied, related searches |
| Sales | "What's the context for tomorrow's call?" | Last interaction, notes, open questions, commitments made |
| Anyone | "What was I doing before lunch?" | Exactly what they were doing before lunch |

The question format is natural language. The answer is always specific.
The user never needs to understand how Orbit works to get value from it.

---

## The Three Stages of Orbit

### Stage 1 — "It knows what I was doing" (current)
The baseline. Someone asks a question, gets a real answer.
This alone is worth installing for. This is what the beta proves.

Core experience:
> "What was I working on before lunch?"
> 📌 *Before lunch — VS Code / Resume Builder*
> *You were fixing the mobile layout. Last file: template-editor.tsx.
> You had Tailwind docs and a ShadCN issue open.*

### Stage 2 — "It helps me continue" (Phase 3-4)
Orbit stops waiting to be asked and starts volunteering.

- Morning: "You left 3 things unfinished yesterday. Want to continue?"
- On app open: "You were mid-way through X. Here's where you were."
- Voice companion: speak naturally, get answers without typing
- The orb suggests rather than waits

Core experience:
> *[Orbit, proactively, Monday morning]*
> "Last week you were integrating Stripe. You got as far as the webhook
> handler but left the error case unfinished. The last thing you copied
> was a Stripe error code. Want me to pull up where you were?"

### Stage 3 — "It's irreplaceable" (Phase 5+)
Years of context accumulate. No competitor can replicate this.

- Decision history: "Why did we choose X?" → Orbit has the answer with date and reasoning
- Project timelines: "Show me everything on Orbit in June" → visual timeline
- Learning memory: "What did I learn about vector databases last year?" → Orbit knows
- Personal CRM: "What's my history with this client?" → full context

At this stage Orbit is not a tool you use. It's a tool you'd feel lost without.

---

## UX Principles — The Non-Negotiables

### 1. Invisible Until Needed
Orbit runs silently. No notifications, no interruptions, no badges.
The user forgets it's there until they need it — and then it's exactly right.
**The measure:** Could someone use their computer for a month and only interact
with Orbit through the recall interface? Yes, and that's the goal.

### 2. One Question, One Answer
The interface is not a dashboard. It's a conversation.
The main interaction is: type a question → get a specific answer.
No categories to browse. No timeline to scroll through unnecessarily.
No settings to configure before it works.
**The measure:** A 55-year-old non-technical user should be able to install Orbit
and get a useful answer within 5 minutes with zero instructions.

### 3. Speed Is Personality
If Orbit takes 8 seconds to answer, it feels broken.
Under 3 seconds feels fast. Under 1.5 seconds feels like magic.
Everything — streaming, local FTS5, Qdrant — is in service of this.
**The measure:** The time between pressing Enter and seeing the first token
streaming on screen. Target: under 800ms.

### 4. Honest Over Impressive
When Orbit doesn't have context, it says so clearly.
> "I don't have data from before you installed me. For anything before
> [install date], I won't be able to help."

> "I don't have browser context right now — the Chrome extension isn't
> installed. I can still tell you which apps you were using."

Users trust tools that know their own limits. They distrust tools that guess.

### 5. Privacy Is a Feature, Not a Footnote
Most privacy features are buried. Orbit's privacy controls are on the surface.
The memory viewer, the exclude list, the wipe button — these are primary UI,
not settings drawer items. Users should feel in control, not surveilled.
**The measure:** A user should be able to see EVERYTHING Orbit knows about them
within 2 taps, and delete all of it within 3.

### 6. Language That Anyone Understands
No technical terms in any user-facing copy.

| Instead of | Say |
|---|---|
| "Session generated" | "I've summarized your morning" |
| "Event captured" | "I saw this" |
| "Semantic search" | "I'm looking for related context" |
| "Embedding model" | (never mention this) |
| "Accessibility permission" | "Allow Orbit to see which app you're using" |
| "FTS5 keyword search" | (never mention this) |

The user should never need to know how Orbit works. Only that it does.

---

## The Orb — Designing for Warmth

The floating orb companion is the most important UX decision in the product.
Get this wrong and Orbit feels like an intrusive assistant. Get it right and
it feels like a trusted presence.

**What the orb must feel like:**
- A quiet presence, not a notification
- Calm and slow animations (not jittery or attention-grabbing)
- Available without being demanding
- Warm colors when active (soft amber/orange), neutral when idle
- Small — smaller than you think. 32-40px. Not a balloon.

**States:**
- Idle: barely visible, very slow pulse. Almost forgettable.
- Listening: gentle expansion, warmer color
- Thinking: slow internal swirl, not a spinner
- Speaking: rhythmic brightness pulse, calm
- Alert (has something to tell you): slight glow, not a badge

**One rule for the orb:** If the user is in deep work, the orb should be
completely invisible to their peripheral vision. It should never pull focus.

---

## The Onboarding Experience — "Show, Don't Explain"

Most apps explain what they do during onboarding.
Orbit should show it immediately.

After permissions are granted and the extension is installed, Orbit should
capture 5-10 minutes of activity and then show the user their own context —
unprompted:

> "I've been watching. Here's what I've captured so far:
> You were in VS Code working on something. You looked at 2 websites.
> Give me a couple of hours and I'll be able to answer any question
> about what you worked on today."

This moment — seeing your own activity summarized back to you for the first
time — is the activation moment. It's when the product becomes real.
Design everything toward making this moment happen as early as possible.

---

## The Metric That Defines Success

Not daily active users. Not session length. Not queries per day.

**The one metric:**
> "Did this person ask Orbit something they genuinely couldn't have
> remembered themselves — and get a correct, specific answer?"

One such moment per user per week = the product is working.
Five such moments per user per week = the product is indispensable.
Zero such moments after 7 days = something is broken in the core loop.

Ask every beta user this exact question at day 7:
> "Tell me one specific thing Orbit told you this week that you'd
> forgotten. What did you ask, and what did it say?"

If they can answer concretely, ship more. If they can't, fix the recall
quality before building anything else.

---

## What Makes Orbit Irreplaceable (The Moat)

Every competitor can build a memory tool. Not every competitor can replicate
**your** memory. The longer someone uses Orbit, the more irreplaceable it
becomes because the data is theirs, local, accumulated over time.

- After 1 month: useful
- After 6 months: relied upon
- After 2 years: no one would delete it

The moat is not the technology. The moat is time × personal context.
Ship fast, get users, let the clock run. The value compounds automatically.