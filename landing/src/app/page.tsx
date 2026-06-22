import WaitlistForm from "@/components/waitlist-form";
import { Eye, Layers, Search } from "lucide-react";

const HOW_IT_WORKS = [
  {
    step: "01",
    icon: Eye,
    headline: "Orbit watches quietly",
    body: "No dock icon. No interruptions. Orbit lives in your menu bar and passively notes which apps, documents, and websites you're working with — without ever reading your passwords or private data.",
  },
  {
    step: "02",
    icon: Layers,
    headline: "Orbit builds your memory",
    body: "Every 30 minutes, your activity is distilled into clear, searchable memory. No manual tagging, no journaling required. What you were doing and why — just there, when you need it.",
  },
  {
    step: "03",
    icon: Search,
    headline: "You ask. Orbit remembers.",
    body: "Ask anything in plain language. \"What was I working on yesterday morning?\" or \"Where did I leave that project?\" Orbit answers with specifics — files, URLs, context.",
  },
];

export default function Page() {
  return (
    <main className="grow flex flex-col">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center pt-16 pb-20 px-6 text-center max-w-6xl mx-auto w-full">
        <div className="relative z-10 flex flex-col items-center gap-8 max-w-3xl mx-auto">

          {/* Status badge */}
          <span className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-white/3 backdrop-blur-md px-4 py-1.5 text-[11px] font-semibold text-zinc-400 tracking-wider uppercase animate-pulse-subtle">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-300 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            Early Access Coming Soon
          </span>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tighter leading-[1.1] text-gradient select-none">
            Never lose
            <br />
            <span className="text-zinc-500">your place again.</span>
          </h1>

          {/* Subheadline */}
          <p className="max-w-xl text-base sm:text-lg text-zinc-400/90 leading-relaxed font-light">
            You spend hours rebuilding mental context every time you switch tasks. Orbit fixes that — it quietly remembers your work so you never have to start over.
          </p>

          {/* Waitlist form */}
          <div className="w-full max-w-md mt-4">
            <WaitlistForm />
          </div>

          {/* Privacy trust + social proof */}
          <div className="flex flex-col items-center gap-1.5">
            <p className="text-[11px] text-zinc-600 font-light tracking-wide">
              All data stays on your Mac · Never sold · Delete anytime
            </p>
            <p className="text-[11px] text-zinc-500 font-light tracking-wide">
              Join early access and help shape Orbit&apos;s future.
            </p>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="w-full max-w-6xl mx-auto px-6 pb-24">
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
              className="relative flex flex-col gap-5 rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-md p-6 hover:border-white/10 hover:bg-white/[0.03] transition-all duration-300"
            >
              {/* Step number + icon row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl border border-white/8 bg-white/4">
                  <Icon className="h-4.5 w-4.5 text-zinc-300" strokeWidth={1.5} />
                </div>
                <span className="text-[11px] font-semibold text-zinc-700 tracking-widest tabular-nums">
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
          <p className="text-xs text-zinc-600 font-light leading-relaxed max-w-xl">
            <span className="text-zinc-400 font-medium">Your privacy is the foundation, not a checkbox.</span>
            {" "}Everything Orbit captures stays on your Mac in a local database. Cloud AI only ever sees anonymised summaries — never raw content, passwords, or file data. You can pause, exclude apps, or wipe everything at any time.{" "}
            <a href="/privacy" className="text-zinc-400 underline underline-offset-2 hover:text-white transition-colors">
              Read our privacy policy →
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
