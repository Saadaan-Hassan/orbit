// Landing page — Server Component.
// Client interactivity (waitlist form) is isolated in WaitlistForm.tsx.

import WaitlistForm from "@/components/WaitlistForm";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <div className="flex flex-col min-h-screen bg-[#0a0a0a] text-white">
      <HeroSection />
      <HowItWorksSection />
      <PrivacySection />
      <FooterSection />
    </div>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="relative flex flex-col items-center justify-center min-h-screen px-6 py-24 text-center bg-[#0a0a0a]">
      {/* Subtle radial glow — purely decorative */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="h-[500px] w-[500px] rounded-full bg-white/[0.03] blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6 max-w-3xl mx-auto">
        {/* Coming soon badge with pulse dot */}
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-zinc-400 tracking-wide uppercase">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/60 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white/80" />
          </span>
          Coming soon
        </span>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] text-white">
          Your computer remembers.
          <br />
          <span className="text-zinc-400">You don&apos;t have to.</span>
        </h1>

        {/* Subheadline */}
        <p className="max-w-xl text-base sm:text-lg text-zinc-400 leading-relaxed">
          Orbit silently captures your work context and lets you recall
          anything — what you were building, what you were reading, where you
          left off — just by asking.
        </p>

        {/* Demo video placeholder */}
        <div className="w-full max-w-[800px] mt-2">
          <div className="relative w-full aspect-video rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center overflow-hidden">
            <div className="flex flex-col items-center gap-2 text-zinc-600">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" />
              </svg>
              <span className="text-sm">Demo video coming soon</span>
            </div>
          </div>
        </div>

        {/* Waitlist form — client component */}
        <div className="w-full mt-2">
          <WaitlistForm />
        </div>

        {/* Social proof */}
        <p className="text-xs text-zinc-600 tracking-wide">
          Built in public by{" "}
          <a
            href="https://x.com/saadaanhassan"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 hover:text-zinc-300 transition-colors underline underline-offset-2"
          >
            @saadaanhassan
          </a>
        </p>
      </div>
    </section>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────

const HOW_IT_WORKS_STEPS = [
  {
    emoji: "🔍",
    title: "Captures silently",
    description:
      "Tracks what you open, browse, and copy. No setup, no tagging, no folders.",
  },
  {
    emoji: "🧠",
    title: "Understands context",
    description:
      "Every 30 minutes, Orbit generates a summary of what you worked on and why.",
  },
  {
    emoji: "💬",
    title: "Recalls on demand",
    description:
      "Ask anything in plain language. Get a specific, structured answer.",
  },
] as const;

function HowItWorksSection() {
  return (
    <section className="bg-white py-24 px-6">
      <div className="max-w-5xl mx-auto">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 text-center mb-4">
          How it works
        </p>

        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 text-center mb-16">
          Three steps. Zero effort.
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <div key={step.title} className="flex flex-col gap-3">
              <span className="text-3xl" role="img" aria-label={step.title}>
                {step.emoji}
              </span>
              <h3 className="text-lg font-semibold text-zinc-900">
                {step.title}
              </h3>
              <p className="text-sm text-zinc-500 leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Privacy ──────────────────────────────────────────────────────────────────

const PRIVACY_POINTS = [
  "All data stays on your machine",
  "Passwords and API keys are never stored",
  "Cloud sync is opt-in — off by default",
] as const;

function PrivacySection() {
  return (
    <section className="bg-[#0a0a0a] py-24 px-6 border-t border-white/5">
      <div className="max-w-4xl mx-auto text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-4">
          Privacy
        </p>

        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-16">
          Local-first. Always.
        </h2>

        <div className="flex flex-col sm:flex-row items-center sm:items-start justify-center gap-8 sm:gap-16">
          {PRIVACY_POINTS.map((point) => (
            <div
              key={point}
              className="flex items-start gap-3 text-left max-w-[220px]"
            >
              <span
                className="mt-0.5 flex-shrink-0 text-emerald-400 font-bold"
                aria-hidden="true"
              >
                ✓
              </span>
              <span className="text-sm text-zinc-300 leading-relaxed">
                {point}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function FooterSection() {
  return (
    <footer className="bg-[#0a0a0a] border-t border-white/5 py-10 px-6">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-600">
        <span>Orbit by Saadaan Hassan · © 2026</span>

        <div className="flex items-center gap-5">
          {/* X (Twitter) */}
          <a
            href="https://x.com/saadaanhassan"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-300 transition-colors"
            aria-label="Twitter / X"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.261 5.632 5.903-5.632Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>

          {/* GitHub */}
          <a
            href="https://github.com/saadaanhassan/orbit"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-300 transition-colors"
            aria-label="GitHub"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
