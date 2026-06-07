import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Privacy Policy — Orbit",
  description: "Orbit is designed to help you remember your work—not to collect your data.",
  alternates: {
    canonical: "/privacy",
  },
};

export default function PrivacyPolicy() {
  const contactEmail = process.env.REPLY_TO_EMAIL || "saadaanedu@gmail.com";

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
            Orbit is designed to help you remember your work—not to collect your data. Most information stays on your Mac, and you remain in control of what Orbit stores, processes, and remembers.
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
            <p>Orbit captures the following on your device:</p>
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2">
              <li>Active application name and window title (every 30 seconds)</li>
              <li>Browser URLs and page titles (via the Chrome extension)</li>
              <li>
                Clipboard text (passwords and API keys are automatically detected
                and replaced with <code className="px-1 py-0.5 rounded bg-white/5 text-xs text-zinc-400 font-mono">[REDACTED]</code> before storage)
              </li>
            </ul>
            <p className="mt-2">Orbit does <span className="text-white font-medium">NOT</span> capture:</p>
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2 text-zinc-400">
              <li>Clipboard content from password managers (1Password, Bitwarden, etc.)</li>
              <li>Your actual passwords, API keys, or credit card numbers</li>
              <li>Screenshots (not yet implemented)</li>
              <li>Audio or video</li>
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
              <li>Access your email accounts</li>
              <li>Access browser passwords</li>
              <li>Read messages from end-to-end encrypted services unless they appear in captured window titles or clipboard content</li>
              <li>Turn on your microphone or camera</li>
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
              All captured activity, clipboard items, and window histories are stored locally on your Mac at <code className="px-1.5 py-0.5 rounded bg-white/5 text-xs text-zinc-300 font-mono">~/.orbit/</code> in an SQLite database and local vector store. This data never leaves your device unless you explicitly opt in to cloud sync (which is disabled by default).
            </p>
            <p className="text-zinc-400">
              For operational logs, crash reports (Sentry), and privacy-safe usage analytics (PostHog), we transmit only non-personal telemetry which is used to diagnose issues and improve performance. You can disable analytics at any time in the app's settings.
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
              Orbit sends the following to cloud AI services via an encrypted proxy:
            </p>
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2">
              <li>
                Session summaries (AI-generated descriptions of your recent activity, for example: <span className="text-zinc-400 italic">"Worked on a Next.js project and reviewed GitHub pull requests"</span>)
              </li>
              <li>Your recall queries (the questions you ask Orbit)</li>
            </ul>
            <p className="mt-2">Orbit <span className="text-white font-medium">never</span> sends:</p>
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2 text-zinc-400">
              <li>Raw clipboard content</li>
              <li>Exact file contents</li>
              <li>Your actual passwords or API keys</li>
            </ul>
            <p className="mt-2">
              Orbit currently uses Claude, Gemini Flash, and Voyage AI to power AI features. These providers process only the information necessary to fulfill your request, and all communication is encrypted in transit.
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
              Orbit collects anonymous, non-personal usage analytics to understand
              how the app is being used. This includes:
            </p>
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2">
              <li>Whether the app was opened</li>
              <li>We record that a recall query occurred, but never store or transmit the contents of the query for analytics purposes</li>
              <li>Whether a session was generated</li>
            </ul>
            <p>
              We never collect query content, clipboard content, or anything
              you've typed. Analytics can be disabled at any time in the app's settings.
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
              <li>Pause capture at any time from the menu bar</li>
              <li>Exclude specific apps from being tracked</li>
              <li>View everything Orbit has stored in the Memory Viewer</li>
              <li>Delete individual events, sessions, or everything at once</li>
              <li>One-click memory wipe with no recovery</li>
            </ul>
          </div>
        </section>

        {/* Section 7 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            7. Updates to This Policy
          </h2>
          <p className="text-sm leading-relaxed font-light">
            As Orbit evolves, this policy may be updated. Significant changes will be communicated through the app or website.
          </p>
        </section>

        {/* Section 8 */}
        <section className="flex flex-col gap-3 border-t border-white/5 pt-8 mb-12">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            8. Contact
          </h2>
          <p className="text-sm leading-relaxed font-light">
            Questions? Email:{" "}
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
