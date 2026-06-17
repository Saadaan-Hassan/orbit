# The Signal Fusion Prompt

This replaces the current session summary prompt in `scheduler.py`. Its job:
take many overlapping, imperfect signals from one time window and **reconstruct
what the user was actually doing** — like a detective assembling clues — then
produce a continuation-focused summary.

---

## System Prompt

```python
FUSION_SESSION_SYSTEM_PROMPT = """\
You reconstruct what a person was doing on their computer during a short work
session, using multiple overlapping signals captured from their machine.

You are like a detective, not a camera. No single signal tells you the whole
story. Each is a partial clue:
- active app + window title = which app and document/file
- on-screen text (screen_content) = what was actually visible/being worked on
- file activity = which files were created or edited
- clipboard = what they copied (often an error, a snippet, a value)
- browser URLs + page content = what they were reading or researching
- search queries = what they were trying to find out
- idle/active = whether they were truly working or the app was just open
- system lock/sleep = when they stepped away

Your job: TRIANGULATE these into a specific, confident description of what the
person was DOING — not a list of apps. Cross-reference signals. The clipboard
snippet often reveals the purpose of the file edit. The open browser tab reveals
what the code change was for. The on-screen text reveals the actual task.

Rules:
- Be specific and concrete. Name the real file, the real topic, the real ticket,
  the real document, the real conversation subject — pulled from the signals.
- Infer the activity from overlapping evidence, but DO NOT invent details that
  no signal supports. If signals conflict or are thin, say what you can support
  and mark uncertainty.
- Distinguish primary activity from incidental noise (a quick Slack check during
  deep coding is not the session's purpose).
- Focus on CONTINUATION: where they were in the work, what the natural next step
  is, and anything they appeared stuck on. This is the most valuable output.
- Ignore anything that looks like a password, secret, or [REDACTED:...] value.
- Use plain language. No technical jargon about how you were given this data.

Return ONLY valid JSON. No markdown, no preamble, no explanation outside the JSON.\
"""
```

## User Prompt Template

```python
FUSION_SESSION_USER_PROMPT_TEMPLATE = """\
Here are the captured signals from one work session, in chronological order.
Each line is one signal. Fields may be empty when a signal type doesn't apply.

{fused_signals}

Reconstruct what this person was doing and return EXACTLY this JSON structure:

{{
  "project_name": "the project/context name, or null if unclear",
  "activity": "a specific 1-2 sentence description of WHAT they were actually doing, inferred by combining the signals. Name real files/topics/tickets/documents. Not 'used VS Code' — instead 'implementing Stripe webhook verification in billing.service.ts'.",
  "evidence": "one short sentence: which signals support this conclusion (e.g. 'file edits to billing.ts + clipboard showing constructEvent + open Stripe webhooks docs')",
  "goal": "one sentence: what they appeared to be trying to accomplish",
  "summary": "2-3 sentences describing how the session unfolded",
  "last_action": "the most recent meaningful thing they did before the session ended — be specific, this is what helps them remember where they stopped",
  "next_step": "the most likely next action to continue this work, inferred from where they left off. If genuinely unclear, null.",
  "blockers": "anything they appeared stuck on or an unresolved problem, or null",
  "key_resources": ["specific files, URLs, docs, or tickets that mattered this session"],
  "topics": ["the actual subjects/topics engaged with"]
}}\
"""
```

## How `fused_signals` Is Built (in scheduler.py)

Format each event into a compact, signal-labelled line so Claude sees the
overlap clearly. Example of what the formatted block looks like:

```
[14:30] APP focus: VS Code — window: "billing.service.ts — myapp"
[14:30] SCREEN text: "export async function handleWebhook(req) { const sig = req.headers['stripe-signature']; const event = stripe.webhooks.constructEvent(..."
[14:31] FILE modified: /Users/sa/myapp/src/billing.service.ts
[14:31] CLIPBOARD: "stripe.webhooks.constructEvent"
[14:33] BROWSER: stripe.com/docs/webhooks/signatures — "Verify webhook signatures"
[14:33] PAGE content: "Verify the events that Stripe sends by checking the signature..."
[14:40] APP focus: Slack — window: "#engineering"
[14:40] SCREEN text: "deploy is failing on staging, anyone seen this?"
[14:41] active: yes
[14:52] APP focus: VS Code — window: "billing.service.ts — myapp"
[14:58] SYSTEM: screen locked
```

Implementation guidance:
```python
def build_fused_signals(events: list[dict]) -> str:
    lines = []
    for event in sorted(events, key=lambda e: e["timestamp"]):
        time_label = format_local_time(event["timestamp"])  # "14:30"
        event_type = event["type"]
        app = event.get("app_name") or ""

        if event_type == "window":
            lines.append(f'[{time_label}] APP focus: {app} — window: "{event.get("raw_content","")}"')
        elif event_type == "screen_content":
            lines.append(f'[{time_label}] SCREEN text: "{truncate(event.get("screen_text",""), 400)}"')
        elif event_type == "file_activity":
            action = json.loads(event.get("metadata") or "{}").get("action","")
            lines.append(f'[{time_label}] FILE {action}: {event.get("file_path","")}')
        elif event_type == "clipboard":
            lines.append(f'[{time_label}] CLIPBOARD: "{truncate(event.get("raw_content",""), 200)}"')
        elif event_type == "url":
            lines.append(f'[{time_label}] BROWSER: {event.get("url","")} — "{event.get("raw_content","")}"')
        elif event_type == "page_content":
            lines.append(f'[{time_label}] PAGE content: "{truncate(event.get("page_text",""), 300)}"')
        elif event_type == "search_query":
            lines.append(f'[{time_label}] SEARCHED: "{event.get("raw_content","")}"')
        elif event_type == "link_click":
            lines.append(f'[{time_label}] CLICKED: "{event.get("raw_content","")}" -> {event.get("link_target","")}')
        elif event_type == "app_lifecycle":
            action = json.loads(event.get("metadata") or "{}").get("action","")
            lines.append(f'[{time_label}] APP {action}: {app}')
        elif event_type == "system_state":
            state = json.loads(event.get("metadata") or "{}").get("state","")
            lines.append(f'[{time_label}] SYSTEM: {state}')

        # idle flag inline where present
        if event.get("is_user_active") == 0:
            lines.append(f'[{time_label}] (user idle)')

    return "\n".join(lines)
```

---

## Why This Prompt Is the Real Product

The capture layers are individually dumb. Window says "VS Code." Clipboard says
"constructEvent." Browser says "stripe.com/docs/webhooks." None of those alone
is useful. This prompt is what turns them into:

> "You were implementing Stripe webhook signature verification in
> billing.service.ts. You were referencing Stripe's signature docs and had
> copied constructEvent. You got pulled into a Slack thread about a staging
> deploy failure, then came back to the billing file before locking your screen.
> Next step: finish the signature check in handleWebhook. You didn't appear
> blocked."

That reconstruction — from scattered clues to coherent activity + next step — is
the thing users can't get anywhere else. It's the catch. Invest the most prompt-
engineering effort here, test it against real captured sessions, and iterate on
it more than any other prompt in the system.

---

## Tuning Notes

- **Test against YOUR real sessions first.** Pull a real fused_signals block from
  your DB, run it through this prompt, and judge: could someone reconstruct your
  work from the `activity` + `next_step`? If vague, the issue is usually thin
  signals (capture gap) OR the prompt needs a sharper "be specific" push.
- **If Claude over-guesses** (invents details no signal supports), strengthen the
  "DO NOT invent details that no signal supports" rule and add: "When evidence is
  thin, prefer 'appeared to be X' over stating X as fact."
- **If answers are too long**, cap: "summary max 3 sentences, activity max 2."
- **The `evidence` field is for you, not users** — it lets you debug whether the
  fusion is reasoning correctly. You can hide it from the UI but keep it for
  quality checking during beta.
- **Use Claude Sonnet for this**, not Haiku. Fusion is reasoning-heavy and runs
  only every 30 min, so the cost is fine and the quality gain is large.