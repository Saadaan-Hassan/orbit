import { Eye, Layers, Search } from "lucide-react";

const ORBIT_GITHUB_URL = "https://github.com/Saadaan-Hassan/orbit";

const WHAT_YOULL_NEED = [
  "macOS 13 Ventura or later, plus Xcode Command Line Tools",
  "Rust, Node.js/pnpm, and Python (uv) — see the README for exact build commands",
  "Your own Groq API key for AI features (free tier available) — Voyage AI key too if you want semantic search. Fully optional: Orbit works offline with keyword search alone",
  "Accessibility permission, granted during first launch (you'll be guided through it)",
];

const FAQ_ITEMS = [
  {
    question: "Who created Orbit?",
    answer:
      "Orbit was created by Saadaan Hassan (saadaan.dev), who publishes it as an open-source reference project rather than a commercially maintained product.",
  },
  {
    question: "Is Orbit free to use?",
    answer:
      "Yes. Orbit is fully open source and free — there's no purchase, subscription, or paywalled tier. You build it from source and run it on your own Mac.",
  },
  {
    question: "Does Orbit need an internet connection?",
    answer:
      "No. Local keyword search over your captured activity works fully offline. Cloud AI features (natural-language recall, semantic search) are optional and only activate if you add your own Groq or Voyage AI key.",
  },
  {
    question: "What does \"bring your own key\" (BYOK) mean?",
    answer:
      "Orbit never holds its own AI provider key, and there's no maintainer-run server in between. You add your own free Groq API key for AI-powered recall and summaries, and optionally your own Voyage AI key for semantic search. Orbit calls those providers directly from your Mac.",
  },
  {
    question: "Where is my data stored?",
    answer:
      "Everything Orbit captures stays in a local SQLite database on your own Mac. Nothing is uploaded anywhere unless you configure a cloud AI key yourself — and even then, only already-redacted content is sent, directly to the provider you chose.",
  },
  {
    question: "Is Orbit actively maintained?",
    answer:
      "No. Orbit is published as a finished, open-source reference project — issues and pull requests may not get a response. It's meant to be read, forked, and built upon rather than supported.",
  },
  {
    question: "Which platforms does Orbit support?",
    answer:
      "macOS 13 (Ventura) or later today. It's built on Tauri, so Windows support is architecturally possible, but it isn't implemented.",
  },
];

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: {
      "@type": "Answer",
      text: answer,
    },
  })),
};

const HOW_IT_WORKS = [
  {
    step: "01",
    icon: Eye,
    headline: "Orbit watches quietly",
    body: "No dock icon. No interruptions. Orbit lives in your menu bar and passively notes which apps, documents, and websites you work with. It never reads your passwords or private data.",
  },
  {
    step: "02",
    icon: Layers,
    headline: "Orbit builds your memory",
    body: "Every 30 minutes, your activity is turned into clear, searchable memory. No manual tagging, no journaling. It just works.",
  },
  {
    step: "03",
    icon: Search,
    headline: "You ask. Orbit remembers.",
    body: "Ask anything in plain language. What was I working on yesterday? Where did I leave that project? Orbit answers with specifics: files, URLs, context.",
  },
];

export default function Page() {
  return (
    <main className="grow flex flex-col">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center pt-8 pb-14 px-6 text-center max-w-6xl mx-auto w-full">
        <div className="relative z-10 flex flex-col items-center gap-6 max-w-3xl mx-auto">

          {/* Status badge */}
          <span className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-zinc-950/80 px-4 py-1.5 text-[11px] font-semibold text-zinc-400 tracking-wider uppercase animate-pulse-subtle">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-300 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            Open source · macOS · Bring your own key
          </span>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tighter leading-[1.1] text-gradient select-none">
            Never lose
            <br />
            <span className="text-zinc-500">your place again.</span>
          </h1>

          {/* Subheadline */}
          <p className="max-w-xl text-base sm:text-lg text-zinc-400/90 leading-relaxed font-light">
            You spend hours rebuilding mental context every time you switch tasks. Orbit remembers your work so you never have to start over.
          </p>

          {/* Primary CTA */}
          <div className="w-full max-w-md mt-4 flex flex-col gap-2.5">
            <a
              href={ORBIT_GITHUB_URL}
              className="w-full py-3.5 rounded-xl bg-white text-zinc-950 text-sm font-semibold text-center hover:opacity-90 transition-all"
            >
              View on GitHub
            </a>
            <p className="text-[11px] text-zinc-500 text-center font-mono bg-white/[0.02] border border-white/5 rounded-lg py-2.5 px-3">
              git clone {ORBIT_GITHUB_URL}.git
            </p>
          </div>

          {/* What you'll need box */}
          <div className="w-full max-w-md flex flex-col gap-3 rounded-xl border border-white/5 bg-white/[0.015] p-5 text-left">
            <p className="text-[11px] font-semibold text-zinc-500 tracking-widest uppercase">
              What you&apos;ll need
            </p>
            <ul className="flex flex-col gap-2.5">
              {WHAT_YOULL_NEED.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2.5 text-xs text-zinc-400 font-light leading-relaxed"
                >
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-zinc-600 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Privacy trust */}
          <p className="text-[11px] text-zinc-400 font-light tracking-wide">
            Local by default · Cloud AI only if you add your own key · No maintainer infrastructure of any kind · Delete anytime
          </p>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="w-full max-w-6xl mx-auto px-6 pb-20">
        {/* Section header */}
        <div className="flex flex-col items-center gap-3 mb-12 text-center">
          <span className="text-[11px] font-semibold text-zinc-500 tracking-widest uppercase">
            How it works
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Your computer&apos;s working memory.
          </h2>
          <p className="text-sm text-zinc-500 font-light max-w-md leading-relaxed">
            Three steps. No setup. Works automatically from the moment you open the app.
          </p>
        </div>

        {/* Steps grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {HOW_IT_WORKS.map(({ step, icon: Icon, headline, body }) => (
            <div
              key={step}
              className="relative flex flex-col gap-5 rounded-2xl border border-white/5 bg-zinc-950/60 p-6 hover:border-white/10 hover:bg-white/[0.03] transition-all duration-300"
            >
              {/* Step number + icon row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl border border-white/8 bg-white/4">
                  <Icon className="h-4.5 w-4.5 text-zinc-300" strokeWidth={1.5} />
                </div>
                <span className="text-[11px] font-semibold text-zinc-500 tracking-widest tabular-nums">
                  {step}
                </span>
              </div>

              {/* Text */}
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-white tracking-tight">
                  {headline}
                </h3>
                <p className="text-xs text-zinc-500 font-light leading-relaxed">
                  {body}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Privacy callout strip */}
        <div className="mt-6 flex items-center justify-center gap-3 rounded-xl border border-white/5 bg-white/[0.015] px-6 py-4 text-center">
          <p className="text-xs text-zinc-400 font-light leading-relaxed">
            <span className="text-zinc-400 font-medium">Your privacy is the foundation, not a checkbox.</span>
            {" "}Everything Orbit captures stays on your Mac in a local database, with zero cloud AI, unless you add your own Groq or Voyage AI key — there&apos;s no maintainer-funded shared key. Passwords and secrets are redacted before anything touches disk, whether or not cloud AI is on. You can pause, exclude apps, or wipe everything at any time.{" "}
            <a href="/privacy" className="text-zinc-400 underline underline-offset-2 hover:text-white transition-colors">
              Read our privacy policy →
            </a>
          </p>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="w-full max-w-3xl mx-auto px-6 pb-24">
        <div className="flex flex-col items-center gap-3 mb-12 text-center">
          <span className="text-[11px] font-semibold text-zinc-500 tracking-widest uppercase">
            Frequently asked
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Questions, answered.
          </h2>
        </div>

        <div className="flex flex-col gap-3">
          {FAQ_ITEMS.map(({ question, answer }) => (
            <details
              key={question}
              className="group rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4 open:bg-white/[0.03] transition-colors"
            >
              <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-sm font-medium text-white">
                {question}
                <span className="shrink-0 text-zinc-500 transition-transform group-open:rotate-45 text-lg leading-none">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm text-zinc-500 font-light leading-relaxed">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
