import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Privacy Policy — Orbit",
  description:
    "Orbit is designed to help you remember your work — not to collect your data.",
  alternates: {
    canonical: "/privacy",
  },
};

export default function PrivacyPolicy() {
  const contactEmail =
    process.env.REPLY_TO_EMAIL ?? "saadaanedu@gmail.com";

  return (
    <main className="grow relative z-10 w-full max-w-2xl mx-auto px-6 py-12 flex flex-col gap-10">
      {/* Back navigation */}
      <Link
        href="/"
        className="self-start text-xs font-semibold text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5"
      >
        <span>←</span> Back to home
      </Link>

      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-white/5 pb-8">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Orbit Logo"
            width={28}
            height={28}
            className="object-contain"
          />
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Privacy First
          </h1>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-zinc-500">Last updated: June 2026</p>
          <p className="text-sm font-light text-zinc-400 mt-2 leading-relaxed">
            Orbit is designed to help you remember your work — not to collect
            your data. Almost everything stays on your Mac, and you remain in
            complete control of what Orbit stores, processes, and remembers.
          </p>
        </div>
      </header>

      {/* Sections */}
      <div className="flex flex-col gap-10 text-zinc-300">

        {/* Section 1 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            1. What Orbit Captures
          </h2>
          <div className="flex flex-col gap-4 text-sm leading-relaxed font-light">
            <p>
              Orbit captures the following on your device to build your
              personal memory:
            </p>
            <ul className="list-disc list-inside flex flex-col gap-3 pl-2">
              <li>
                <span className="text-zinc-300 font-medium">Active app and window title</span> — which application is in focus and what its window is titled, captured when the title changes.
              </li>
              <li>
                <span className="text-zinc-300 font-medium">On-screen text</span> — the readable text visible in your active app&apos;s interface, read via macOS&apos;s built-in Accessibility API. This requires the Accessibility permission you grant during setup.{" "}
                <span className="text-zinc-400">Password fields are never read — they are identified and skipped before any text is accessed, at every level of the interface.</span>
              </li>
              <li>
                <span className="text-zinc-300 font-medium">Browser URL and page title</span> — the URL and title of your active browser tab. Captured natively from Chrome, Safari, Arc, Brave, and Edge using macOS Automation, and optionally via the Orbit Chrome extension for richer page context (article text, search queries).
              </li>
              <li>
                <span className="text-zinc-300 font-medium">Clipboard text</span> — text you copy. Secrets are detected and replaced with{" "}
                <code className="px-1 py-0.5 rounded bg-white/5 text-xs text-zinc-400 font-mono">
                  [REDACTED]
                </code>{" "}
                before any storage. The original value is never written to disk.
              </li>
              <li>
                <span className="text-zinc-300 font-medium">File activity</span> — when you create, modify, or move files in your Documents, Desktop, and Downloads folders. Only the file name and path are recorded.{" "}
                <span className="text-zinc-400">File contents are never read.</span>
              </li>
              <li>
                <span className="text-zinc-300 font-medium">App launches and quits</span> — which applications you open and close, to help Orbit understand the flow of your work sessions.
              </li>
              <li>
                <span className="text-zinc-300 font-medium">System events</span> — when your screen locks or unlocks, and when your Mac sleeps or wakes. Used to mark session boundaries in your memory timeline.
              </li>
            </ul>

            <p className="mt-2">
              Orbit does{" "}
              <span className="text-white font-medium">NOT</span> capture:
            </p>
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2 text-zinc-400">
              <li>File contents (only file names and paths)</li>
              <li>
                Clipboard content from password managers (1Password, Bitwarden,
                Keychain, etc. are excluded by default)
              </li>
              <li>
                Passwords, API keys, credit card numbers, or other secrets
                (detected and redacted before storage)
              </li>
              <li>
                Password fields or secure text inputs in any application
                (skipped unconditionally by the Accessibility reader)
              </li>
              <li>Screenshots or video of your screen</li>
              <li>Audio or microphone input</li>
              <li>Network traffic, DNS queries, or HTTP request contents</li>
              <li>Email message bodies or end-to-end encrypted messages</li>
            </ul>
          </div>
        </section>

        {/* Section 2 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            2. What Orbit Cannot See
          </h2>
          <div className="flex flex-col gap-4 text-sm leading-relaxed font-light">
            <p>For absolute clarity, Orbit cannot:</p>
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2 text-zinc-400">
              <li>Read the contents of arbitrary files on your disk</li>
              <li>Access your email or messaging accounts</li>
              <li>Access saved passwords in your browser or keychain</li>
              <li>
                Read messages from end-to-end encrypted services (unless
                they appear in a window title you have shared)
              </li>
              <li>Turn on your microphone or camera</li>
              <li>
                Read text in other apps while they are not the focused
                foreground application
              </li>
            </ul>
          </div>
        </section>

        {/* Section 3 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            3. Where Your Data Is Stored
          </h2>
          <div className="flex flex-col gap-4 text-sm leading-relaxed font-light">
            <p>
              All captured activity is stored locally on your Mac at{" "}
              <code className="px-1.5 py-0.5 rounded bg-white/5 text-xs text-zinc-300 font-mono">
                ~/.orbit/
              </code>{" "}
              in an SQLite database and a local vector index. This data never
              leaves your device unless you explicitly opt in to cloud sync
              (which does not yet exist — it is a future opt-in feature).
            </p>
            <p className="text-zinc-400">
              Orbit also transmits non-personal telemetry for crash reporting
              (Sentry) and anonymous usage analytics (PostHog). These never
              include captured content, query text, or anything that identifies
              what you were working on. You can disable analytics at any time
              in the app.
            </p>
          </div>
        </section>

        {/* Section 4 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            4. What Gets Sent to the Cloud
          </h2>
          <div className="flex flex-col gap-4 text-sm leading-relaxed font-light">
            <p>
              To generate session summaries and answer your recall questions,
              Orbit sends the following to cloud AI services via an encrypted
              proxy:
            </p>
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2">
              <li>
                App names, window titles, browser URLs, and file paths from
                your recent activity — to give the AI enough context to write
                a useful summary of what you worked on.
              </li>
              <li>
                On-screen text snippets (already filtered to remove any
                detected secrets before they leave the app).
              </li>
              <li>
                AI-generated session summaries — short descriptions of your
                activity, for example:{" "}
                <span className="text-zinc-400 italic">
                  &ldquo;Worked on a Next.js project in VS Code, reviewed
                  billing.service.ts, and browsed Stripe documentation.&rdquo;
                </span>
              </li>
              <li>Your recall queries — the questions you ask Orbit.</li>
            </ul>
            <p className="mt-2">
              Orbit{" "}
              <span className="text-white font-medium">never</span> sends:
            </p>
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2 text-zinc-400">
              <li>Raw clipboard content</li>
              <li>File contents</li>
              <li>
                Secrets — passwords, API keys, tokens (they are replaced with{" "}
                <code className="px-1 py-0.5 rounded bg-white/5 text-xs font-mono">
                  [REDACTED]
                </code>{" "}
                before Orbit ever touches them)
              </li>
            </ul>
            <p className="mt-2 text-zinc-400">
              Orbit currently uses Claude (Anthropic), Gemini Flash (Google),
              and Voyage AI to power AI features. These providers process only
              the information necessary to fulfil your request; all
              communication is encrypted in transit.
            </p>
          </div>
        </section>

        {/* Section 5 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            5. Analytics
          </h2>
          <div className="flex flex-col gap-4 text-sm leading-relaxed font-light">
            <p>
              Orbit collects anonymous, non-personal usage analytics to
              understand how the app is being used. This includes:
            </p>
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2">
              <li>Whether the app was opened</li>
              <li>
                That a recall query occurred — never the contents of the query
              </li>
              <li>Whether a memory session was generated</li>
            </ul>
            <p>
              We never collect query content, clipboard content, or anything
              you have typed. Analytics can be disabled at any time in the
              app&apos;s settings.
            </p>
          </div>
        </section>

        {/* Section 6 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            6. Your Controls
          </h2>
          <div className="flex flex-col gap-2 text-sm leading-relaxed font-light">
            <p>You have complete control:</p>
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2">
              <li>Pause all capture at any time from the menu bar</li>
              <li>Exclude specific apps from being tracked</li>
              <li>Exclude specific websites from being tracked</li>
              <li>Turn off on-screen text capture independently</li>
              <li>Turn off file activity monitoring independently</li>
              <li>Choose which folders are watched for file activity</li>
              <li>View everything Orbit has stored in the Memory Viewer</li>
              <li>Delete individual events, sessions, or everything at once</li>
              <li>One-click full memory wipe with no recovery</li>
            </ul>
          </div>
        </section>

        {/* Section 7 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            7. Updates to This Policy
          </h2>
          <p className="text-sm leading-relaxed font-light">
            As Orbit evolves, this policy may be updated. Significant changes
            will be communicated through the app or website. The &ldquo;last
            updated&rdquo; date at the top of this page reflects the most
            recent revision.
          </p>
        </section>

        {/* Section 8 */}
        <section className="flex flex-col gap-3 border-t border-white/5 pt-8 mb-12">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            8. Contact
          </h2>
          <p className="text-sm leading-relaxed font-light">
            Questions about privacy? Email:{" "}
            <a
              href={`mailto:${contactEmail}`}
              className="text-white hover:underline transition-all font-medium"
            >
              {contactEmail}
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
