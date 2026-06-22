# Landing Page Audit Prompts

**Run these before posting the waitlist publicly.**
**Paste Session Start Prompt first in each Claude Code session.**

---

## Session Start Prompt
```
Read AGENTS.md fully first. We are auditing the landing page at
landing/ to verify it is ready to be posted publicly for waitlist signups.
Check the actual code carefully. Be specific about any issues found.
Do not fix anything — report only.
```

---

## PROMPT 1 — Code & Content Audit

```
Read AGENTS.md. Audit the entire landing/ directory.

--- 1A: Core content check ---

Read landing/src/app/page.tsx and every component it imports.
Report the ACTUAL text content currently on the page:
  - What is the hero headline? (exact text)
  - What is the hero subheadline? (exact text)
  - What does the "How it works" section say?
  - What does the privacy section say?
  - What is the CTA button text?
  - What does the footer say?

Then judge each against these criteria:
  ✅ No technical jargon (embeddings, vectors, FTS5, sessions, events)
  ✅ Value prop is clear in under 10 seconds of reading
  ✅ The problem (context loss) is stated before the solution
  ✅ Privacy is addressed prominently, not buried
  ✅ CTA is clear (what happens when you click it?)
  ✅ No placeholder text ([YOUR NAME], [LINK], TODO, etc.)

--- 1B: Waitlist form check ---

Read landing/src/components/waitlist-form.tsx and
landing/src/lib/waitlist-actions.ts

Verify:
  - Does the form collect: email (required), name (optional)?
  - Is Zod validation applied before Supabase insert?
  - Is there a success state shown after submission?
  - Is there an error state for failed submissions?
  - What does the success message say? (judge: is it warm and clear?)
  - Is there a duplicate email guard (unique constraint)?
  - Is the Resend confirmation email set up?
    Read landing/src/emails/waitlist-confirmation.tsx — what does
    the confirmation email actually say?

--- 1C: SEO and metadata check ---

Read landing/src/app/layout.tsx

Verify:
  - Is there a <title> tag? What does it say?
  - Is there a meta description? What does it say?
  - Is there an og:title and og:description for social sharing?
  - Is there an og:image? Does the file exist at the correct path?
  - Is the canonical URL set?
  - What is the <html lang=""> attribute?

Judge: if someone shares the waitlist link on LinkedIn/Twitter,
what preview card will appear? Is it compelling?

--- 1D: Privacy page check ---

Read landing/src/app/privacy/page.tsx

Verify it exists and covers:
  ✅ What data is collected
  ✅ Where it's stored (local to device)
  ✅ What gets sent to cloud AI (session summaries, queries — not raw content)
  ✅ How to delete data
  ✅ Contact email for privacy questions
  ✅ Last updated date

Is there a link to the privacy page from the main page footer?

--- 1E: Beta page check ---

Does landing/src/app/beta/page.tsx exist?
If yes: read it and verify the installation instructions are complete.
If no: flag as missing — this is where email links point.

--- 1F: Missing or broken elements ---

Check for:
  - Any import that references a file that doesn't exist
  - Any hardcoded localhost URLs (should be production URLs)
  - Any [placeholder] text
  - Any TODO comments in the code
  - Any console.log() statements that would appear in production
  - The demo video section — does it have a real video embed or a placeholder?
    If placeholder: is the placeholder clearly marked "coming soon"
    or does it look broken?

Report format:
  ✅ PASS / ❌ FAIL / ⚠️ NEEDS ATTENTION
  For each FAIL/NEEDS ATTENTION: quote the exact text and suggest the fix.
```

---

## PROMPT 2 — Live Functionality Test

**Run AFTER deploying to Vercel. Requires the deployed URL.**

```
Read AGENTS.md first.

We are testing the live waitlist functionality before going public.
The deployed URL is: [paste your Vercel URL here]

--- 2A: Test the waitlist form end-to-end ---

Use a test email address (e.g. test+orbit@yourdomain.com) to submit
the waitlist form. Then verify:

1. POST to /waitlist-actions (Server Action) — does it complete without error?
2. Check Supabase:
   Run this query in the Supabase SQL editor:
   SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 5;
   Does the test email appear?

3. Check your inbox — did the confirmation email arrive?
   If yes: what does it say? Is it warm and clear?
   If no: check Resend dashboard for delivery errors.

--- 2B: Test duplicate email handling ---

Submit the same test email again.
Expected: silent success (no error shown to user — security practice).
If it shows "email already registered" or throws an error: flag this.

--- 2C: Test form validation ---

Submit with:
  - Empty email → should show validation error
  - Invalid email (abc@) → should show validation error
  - Valid email, no name → should succeed (name is optional)

--- 2D: Test mobile layout ---

Open the page on mobile (or resize browser to 390px width).
Does everything look correct?
  - Is the headline readable?
  - Is the form usable without horizontal scroll?
  - Is the CTA button tappable?
  - Does anything overflow?

--- 2E: Test page load speed ---

Open Chrome DevTools → Network tab → Hard reload.
Report:
  - First Contentful Paint: under 2s? ✅
  - Total page size: under 500KB? ✅
  - Any 404 errors in the network tab?
  - Any console errors in the browser console?

Report every failure with: what broke, what error, suggested fix.
```

---

## PROMPT 3 — Cloudflare R2 Setup for Private Repo Distribution

```
Read AGENTS.md first.

The GitHub repo is private. GitHub release assets on private repos require
authentication to download, so tauri-plugin-updater cannot access them.

We need to host the .dmg and latest.json on public infrastructure.
Here is the setup:

--- 3A: Create R2 bucket (manual — do in Cloudflare dashboard) ---

Instruct the user to:
1. Go to dash.cloudflare.com → R2 → Create bucket: "orbit-releases"
2. Settings → Public Access → Enable public bucket
3. Note the public URL: https://pub-[hash].r2.dev/

--- 3B: Update releases/latest.json ---

Read the current releases/latest.json at the project root.
Update the platform URLs to use R2 instead of GitHub:

{
  "version": "0.1.0",
  "notes": "First beta release of Orbit",
  "pub_date": "2026-06-22T00:00:00Z",
  "platforms": {
    "darwin-x86_64": {
      "signature": "",
      "url": "https://pub-[your-r2-hash].r2.dev/v0.1.0/Orbit_0.1.0_x64.dmg.tar.gz"
    },
    "darwin-aarch64": {
      "signature": "",
      "url": "https://pub-[your-r2-hash].r2.dev/v0.1.0/Orbit_0.1.0_aarch64.dmg.tar.gz"
    }
  }
}

The signature field gets populated by running:
  pnpm tauri signer sign Orbit.dmg.tar.gz --private-key ~/.tauri/orbit-signing-key.key

Show the user what the file should look like with placeholders they can fill in.

--- 3C: Update tauri.conf.json updater endpoint ---

In app/src-tauri/tauri.conf.json, the updater endpoints array should
point to the Vercel-hosted latest.json:

"updater": {
  "endpoints": [
    "https://your-domain.com/releases/latest.json"
  ],
  ...
}

Verify this is already set correctly.

--- 3D: Email distribution workflow ---

For sharing .dmg via email:

1. Build: cd app && pnpm tauri build
2. Find the built files:
   app/src-tauri/target/release/bundle/dmg/Orbit_0.1.0_x64.dmg
3. Sign the archive:
   cd app/src-tauri/target/release/bundle/dmg/
   tar czf Orbit_0.1.0_x64.dmg.tar.gz Orbit_0.1.0_x64.dmg
   pnpm tauri signer sign Orbit_0.1.0_x64.dmg.tar.gz \
     --private-key ~/.tauri/orbit-signing-key.key
4. Upload .dmg AND .dmg.tar.gz to R2 bucket
5. Copy the signature output → paste into latest.json signature field
6. Push latest.json to git → Vercel auto-deploys it
7. Share the direct R2 .dmg URL in your email

Show me a clear step-by-step version of this workflow that the user
can follow each time they release a new version.
```

---

## Manual Pre-Post Checklist (do these yourself)

Before posting the waitlist link anywhere:

```
[ ] Submit the form with your real email — confirm you receive the confirmation email
[ ] Check Supabase waitlist table — confirm your submission appears
[ ] View the page on your phone — confirm it looks correct
[ ] Click every link on the page — confirm none are broken
[ ] Check the privacy page loads at yourdomain.com/privacy
[ ] Open the OG preview:
    Go to: https://www.opengraph.xyz/
    Paste your URL — confirm the preview card looks compelling
[ ] Verify the page title in the browser tab reads correctly
[ ] Confirm no "localhost" URLs appear anywhere on the page
[ ] Confirm the demo video section doesn't look broken
    (either real video or clearly-styled "coming soon" placeholder)
[ ] Test on Safari — confirm form works (not just Chrome)
```

---

## After the Waitlist Goes Live

Track these in the first 48 hours:

```bash
# Check Supabase for signups (run in Supabase SQL editor):
SELECT COUNT(*) as total_signups,
       DATE(created_at) as signup_date
FROM waitlist
GROUP BY signup_date
ORDER BY signup_date DESC;

# Check Resend dashboard for delivery rate:
# Sent / Delivered / Bounced — bounces mean invalid emails
# Target: >95% delivery rate

# Check PostHog for any landing page events you're tracking
```