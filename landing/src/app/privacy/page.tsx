import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Privacy Policy | Orbit",
  description:
    "Exactly what Orbit captures, where it's stored, what leaves your Mac and when, and the controls you have over all of it.",
  alternates: {
    canonical: "/privacy",
  },
};

const CONTACT_EMAIL = "saadaanedu@gmail.com";

export default function PrivacyPolicy() {
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
            unoptimized
          />
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Privacy Policy
          </h1>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-zinc-500">
            Last updated: September 27, 2026 · Policy owner: Saadaan Hassan
          </p>
          <p className="text-sm font-light text-zinc-400 mt-2 leading-relaxed">
            Orbit captures activity on your Mac to build a searchable memory
            of your work. All capture stays local by default. AI features are
            entirely optional and only reach the cloud if you configure your
            own API key — this page explains exactly what happens in both
            cases, with no simplifications that stop being true once you
            look closely.
          </p>
          <p className="text-xs text-zinc-400 mt-2 italic">
            This page was drafted with AI assistance from Orbit&apos;s own
            source code, not from marketing copy. It is not legal advice,
            and has not yet had a professional legal review — treat it as an
            accurate technical description of current behavior, not a
            binding legal document.
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
              Nothing below is captured until you complete Orbit&apos;s
              first-launch consent screen, which asks about each category
              independently — there is no single &ldquo;accept all&rdquo;
              that turns on more than you chose. Orbit captures, only for
              categories you&apos;ve enabled:
            </p>
            <ul className="list-disc list-inside flex flex-col gap-3 pl-2">
              <li>
                <span className="text-zinc-300 font-medium">Active app and window title.</span>{" "}
                Which application is in focus and what its window is titled, captured on a short poll interval.
              </li>
              <li>
                <span className="text-zinc-300 font-medium">On-screen text.</span>{" "}
                The readable text visible in your active app&apos;s interface, accessed via macOS&apos;s built-in Accessibility API. This requires the Accessibility permission you grant during setup.{" "}
                <span className="text-zinc-400">Password fields are never read. They are identified and skipped before any text is accessed, at every level of the interface — unconditionally, this is not a setting.</span>
              </li>
              <li>
                <span className="text-zinc-300 font-medium">Browser URL and page title.</span>{" "}
                The URL and title of your active browser tab. Captured natively from Chrome, Safari, Arc, Brave, and Edge using macOS Automation, and optionally via the Orbit Chrome extension for richer context like article text, search queries, and link clicks.
              </li>
              <li>
                <span className="text-zinc-300 font-medium">Clipboard text.</span>{" "}
                Text you copy. Recognizable secrets (API key formats, private keys, credit card and SSN patterns, crypto addresses) are detected and replaced with{" "}
                <code className="px-1 py-0.5 rounded bg-white/5 text-xs text-zinc-400 font-mono">
                  [REDACTED:type]
                </code>{" "}
                before anything is written to disk — see{" "}
                <span className="text-zinc-400">Section 5</span> for the limits of this.
              </li>
              <li>
                <span className="text-zinc-300 font-medium">File activity.</span>{" "}
                When files are created, modified, or removed in folders you choose to watch (Documents, Desktop, and Downloads by default; you can add or remove folders). Only the file <em>path</em> and the action are recorded.{" "}
                <span className="text-zinc-400">File contents are never read, by this feature or any other part of Orbit.</span>
              </li>
              <li>
                <span className="text-zinc-300 font-medium">App launches and quits.</span>{" "}
                Which applications you open and close, to help Orbit understand the shape of your work sessions.
              </li>
              <li>
                <span className="text-zinc-300 font-medium">System events.</span>{" "}
                When your screen locks or unlocks, and when your Mac sleeps or wakes. Used to mark session boundaries — Orbit never starts a new &ldquo;session&rdquo; mid-lock.
              </li>
            </ul>

            <p className="mt-2">
              Orbit does{" "}
              <span className="text-white font-medium">NOT</span> capture,
              under any setting:
            </p>
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2 text-zinc-400">
              <li>File contents (only file paths and the action taken)</li>
              <li>
                Anything from apps excluded by default — 1Password, Bitwarden,
                Keychain Access, LastPass, Dashlane, System Preferences/Settings,
                and Orbit itself — or any app or website you add to your own
                exclusion list
              </li>
              <li>
                Text typed into a password field or secure text input, in any
                application (skipped unconditionally by the Accessibility
                reader, before any text is read)
              </li>
              <li>Keystrokes, key codes, or mouse coordinates — idle detection uses only a timer (seconds since last input), never what was typed or clicked</li>
              <li>Screenshots or video of your screen, or audio/microphone input (none of this exists in the current app — these would be future, separately-announced features, not silent additions)</li>
              <li>Network traffic, DNS queries, or HTTP request/response bodies</li>
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
              <li>Access your email or messaging accounts directly</li>
              <li>Access saved passwords in your browser or keychain</li>
              <li>
                Read messages from end-to-end encrypted services, unless
                their on-screen text happens to be visible in a window you
                have Orbit watching
              </li>
              <li>Turn on your microphone or camera</li>
              <li>
                Read text in apps that are not the currently focused,
                foreground application
              </li>
            </ul>
          </div>
        </section>

        {/* Section 3 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            3. Storage, Retention, and Encryption
          </h2>
          <div className="flex flex-col gap-4 text-sm leading-relaxed font-light">
            <p>
              All captured activity is stored locally on your Mac at{" "}
              <code className="px-1.5 py-0.5 rounded bg-white/5 text-xs text-zinc-300 font-mono">
                ~/.orbit/
              </code>{" "}
              in a SQLite database, plus a local vector index if you&apos;ve
              configured semantic search (Section 4). This data never leaves
              your device unless you configure your own AI provider key —
              see Section 4 for exactly what that sends and when. There is
              no cloud sync feature today.
            </p>
            <p className="text-zinc-400">
              Raw activity events are retained for 90 days on a rolling
              basis. AI-written session summaries are kept until you delete
              them or wipe your data — see Section 6 for what deleting a
              session does and does not remove.
            </p>
            <p className="text-zinc-400">
              Local data is <span className="text-zinc-300">not</span>{" "}
              encrypted by Orbit itself beyond restrictive file permissions
              (readable only by your macOS user account). We recommend
              enabling FileVault, macOS&apos;s built-in full-disk
              encryption, for protection if your Mac is lost or stolen —
              Orbit does not do this for you and does not claim
              application-level encryption of its own.
            </p>
          </div>
        </section>

        {/* Section 4 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            4. Cloud AI Is Fully Optional
          </h2>
          <div className="flex flex-col gap-4 text-sm leading-relaxed font-light">
            <p>
              Orbit has <span className="text-white font-medium">no AI
              features funded by the maintainer</span>. There is no shared
              key, no free tier, and no maintainer-run AI backend of any
              kind. Without your own key, Orbit is fully usable via local
              keyword search — no network request happens for AI purposes at
              all.
            </p>
            <p>
              If you add your own key (Privacy tab in the app), two
              independent providers are involved, only for the feature each
              one powers:
            </p>
            <ul className="list-disc list-inside flex flex-col gap-3 pl-2">
              <li>
                <span className="text-zinc-300 font-medium">Groq</span> — chat-style recall, session summaries, and event classification. With your key configured, requests go{" "}
                <span className="text-zinc-300">directly from your Mac to Groq&apos;s API</span>{" "}
                — never through any server the maintainer runs. Per Groq&apos;s
                own published policy, inference requests are not retained by
                default, and a temporary log kept only for abuse/reliability
                troubleshooting is deleted within 30 days; Groq offers a
                Zero Data Retention setting on your own account for an even
                stricter guarantee. Orbit does not control this — check{" "}
                <a href="https://console.groq.com/docs/your-data" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white transition-colors">
                  Groq&apos;s own data policy
                </a>{" "}
                directly.
              </li>
              <li>
                <span className="text-zinc-300 font-medium">Voyage AI</span> — semantic (&ldquo;search by meaning&rdquo;) recall only. With your key configured, requests go{" "}
                <span className="text-zinc-300">directly from your Mac to Voyage&apos;s API</span>{" "}
                — never through any server the maintainer runs, and no maintainer infrastructure of any kind sits in between.{" "}
                <span className="text-amber-500">
                  Unlike Groq, Voyage&apos;s default is to store and use your
                  data for model training unless you opt out on your own
                  Voyage account
                </span>{" "}
                — see{" "}
                <a href="https://docs.voyageai.com/docs/faq" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white transition-colors">
                  Voyage&apos;s FAQ
                </a>{" "}
                for how to opt out. Orbit cannot change this setting on your
                behalf; it lives entirely on your Voyage account.
              </li>
            </ul>
            <p className="mt-2">
              What either provider receives, only when its key is active:
              short AI-written session summaries, on-screen text/clipboard
              snippets already redacted per Section 1, your recall
              questions, and up to your last 4 conversation turns for
              context. Every field passes through the same redaction
              patterns as local storage a second time, immediately before
              the request leaves your device — this is defense in depth,
              not a replacement for capture-time redaction, and neither
              layer can guarantee no unusual secret format ever slips
              through.
            </p>
            <p className="mt-2 text-zinc-400">
              Orbit{" "}
              <span className="text-white font-medium">never</span> sends
              raw clipboard content, file contents, or the redacted secret
              values themselves — those don&apos;t exist past the
              capture-time redaction step.
            </p>
          </div>
        </section>

        {/* Section 5 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            5. Limits of Automatic Redaction
          </h2>
          <p className="text-sm leading-relaxed font-light text-zinc-400">
            Secret detection is pattern-based and best-effort, not a
            guarantee. It recognizes common formats (API key prefixes,
            private key blocks, JWTs, card/SSN-shaped numbers, crypto
            addresses) but cannot catch every secret in every format,
            especially unusual internal formats. Treat this as a safety net,
            not a reason to freely copy or expose credentials while Orbit is
            running. You can exclude any app (password managers already are,
            by default) or any website from capture entirely.
          </p>
        </section>

        {/* Section 6 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            6. Your Controls, and What Delete Actually Does
          </h2>
          <div className="flex flex-col gap-3 text-sm leading-relaxed font-light">
            <ul className="list-disc list-inside flex flex-col gap-2 pl-2">
              <li>Pause all capture at any time from the menu bar</li>
              <li>Change or withdraw your consent for any capture category independently, at any time — not just at first launch</li>
              <li>Exclude specific apps or websites from being tracked</li>
              <li>Turn off on-screen text capture or file activity monitoring independently</li>
              <li>Choose which folders are watched for file activity</li>
              <li>Remove your own AI provider key at any time; capture and local search keep working exactly as before</li>
              <li>View everything Orbit has stored in the Memory Viewer</li>
              <li>Delete individual events or sessions, or wipe everything at once</li>
            </ul>
            <p className="mt-2 text-zinc-400">
              <span className="text-zinc-300 font-medium">Deleting a raw
              event</span> (a single clipboard entry, window title, browser
              visit, etc.) permanently removes that row — this is
              irreversible.
            </p>
            <p className="text-zinc-400">
              <span className="text-zinc-300 font-medium">Deleting a
              session</span> removes its AI-written summary and its
              semantic-search entry, but the individual raw events that fed
              into it are <span className="text-zinc-300">not</span> deleted
              — they&apos;re only unlinked from that summary. Because
              unprocessed events are exactly what the next automatic
              summary cycle looks for, those same events may be summarized
              into a <em>new</em> session again later. If you want an
              activity permanently gone, delete the underlying events too,
              or use the full wipe below.
            </p>
            <p className="text-zinc-400">
              <span className="text-zinc-300 font-medium">A full memory
              wipe</span> (one click in the Privacy tab) deletes all events,
              sessions, the local search index, the semantic-search index,
              and paired browser-extension connections, and securely
              compacts the database file. This cannot be undone.
            </p>
          </div>
        </section>

        {/* Section 7 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            7. No Telemetry
          </h2>
          <p className="text-sm leading-relaxed font-light text-zinc-400">
            Orbit sends no telemetry, analytics, or crash reports of any
            kind, to anyone, ever — not even anonymized, not even a count of
            app launches. No stable device identifier is created. This has
            been true since the app removed its analytics and crash
            reporting SDKs entirely, rather than disabling them by default —
            there is no setting that turns telemetry back on, because there
            is no code path left that could send it.
          </p>
        </section>

        {/* Section 8 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            8. If You Capture Someone Else&apos;s Content
          </h2>
          <p className="text-sm leading-relaxed font-light text-zinc-400">
            Orbit captures whatever is on your own screen — which may
            include an employer&apos;s, client&apos;s, or colleague&apos;s
            material if it appears in a window, document, or message you
            have open. You are responsible for getting any permission your
            workplace, contracts, or applicable law require before running
            Orbit in contexts involving other people&apos;s confidential or
            personal information. When in doubt, exclude the relevant
            app or pause capture for that work.
          </p>
        </section>

        {/* Section 9 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            9. Updates to This Policy
          </h2>
          <p className="text-sm leading-relaxed font-light">
            If this policy changes, this page will be updated to keep
            matching actual behavior — there are no separate release notes
            to check; Orbit has no packaged release process, so the
            project&apos;s Git history is the record of what changed and
            when. The date at the top of this page reflects the most recent
            revision.
          </p>
        </section>

        {/* Section 10 */}
        <section className="flex flex-col gap-3 border-t border-white/5 pt-8 mb-12">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
            10. Contact
          </h2>
          <p className="text-sm leading-relaxed font-light">
            Questions about privacy, or to report a security issue? Email:{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-white hover:underline transition-all font-medium"
            >
              {CONTACT_EMAIL}
            </a>
            . This project is not actively maintained, so there&apos;s no
            guarantee of a response — but privacy and security reports sent
            here are still the right way to reach the policy owner if one is
            possible.
          </p>
        </section>
      </div>
    </main>
  );
}
