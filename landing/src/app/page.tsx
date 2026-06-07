// Landing page component
import WaitlistForm from "@/components/waitlist-form";

export default function Page() {
  return (
    <main className="grow flex flex-col justify-center">
      <section className="relative flex flex-col items-center justify-center pt-12 pb-20 px-6 text-center max-w-6xl mx-auto">
        <div className="relative z-10 flex flex-col items-center gap-8 max-w-3xl mx-auto">
          {/* Status Badge */}
          <span className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-white/3 backdrop-blur-md px-4 py-1.5 text-[11px] font-semibold text-zinc-400 tracking-wider uppercase animate-pulse-subtle">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-300 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            Alpha Release Coming Soon
          </span>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tighter leading-[1.1] text-gradient select-none">
            Never lose
            <br />
            <span className="text-zinc-500">your place again.</span>
          </h1>

          {/* Subheadline */}
          <p className="max-w-xl text-base sm:text-lg text-zinc-400/90 leading-relaxed font-light">
            Orbit remembers your work, restores your context, and helps you get back into flow without wasting time rebuilding your mental state.
          </p>

          {/* Waitlist Form container */}
          <div className="w-full max-w-md mt-4">
            <WaitlistForm />
          </div>

          {/* Social Proof */}
          <p className="text-[11px] text-zinc-500 font-light mt-2 tracking-wide">
            Join early access and help shape Orbit's future.
          </p>
        </div>
      </section>
    </main>
  );
}

