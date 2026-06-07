// Landing page component
import Image from "next/image";
import WaitlistForm from "@/components/waitlist-form";
import BackgroundOrbit from "@/components/background-orbit";

export default function Page() {
  return (
    <div className="relative flex flex-col min-h-screen text-white overflow-hidden bg-transparent">
      {/* Dynamic Cosmic Orbit Background */}
      <BackgroundOrbit />

      {/* Ambient Top Glow Grid */}
      {/* <div className="absolute top-0 inset-x-0 h-[600px] bg-grid-pattern opacity-40 pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[350px] bg-white/2 rounded-full blur-[120px] pointer-events-none" /> */}

      {/* Navigation Header */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-0">
          <div className="relative w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center">
            <Image
              src="/logo.png"
              alt="Orbit Logo"
              width={26}
              height={26}
              className="object-cover"
            />
          </div>
          <span className="font-semibold text-lg tracking-tight">Orbit</span>
        </div>
      </header>

      {/* Hero Section */}
      <main className="grow">
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

      {/* Footer Section */}
      <footer className="relative z-10 py-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-zinc-500 font-light">
          <div className="flex items-center gap-1">
            <Image
              src="/logo.png"
              alt="Orbit Logo"
              width={20}
              height={20}
              className="opacity-70"
            />
            <span>Orbit by <a
              href="https://saadaan.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors cursor-pointer hover:underline"
              aria-label="My Website"
            > Saadaan Hassan </a> · © {new Date().getFullYear()}</span>
          </div>

          <div className="flex items-center gap-6">
            {/* Twitter / X */}
            <a
              href="https://x.com/SaadaanHassan"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors flex items-center gap-2"
              aria-label="Twitter / X"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="h-4 w-4">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.261 5.632 5.903-5.632Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>

            {/* GitHub */}
            <a
              href="https://github.com/Saadaan-Hassan"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors flex items-center gap-2"
              aria-label="GitHub"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
              </svg>
            </a>

            {/* LinkedIn */}
            <a
              href="https://linkedin.com/in/Saadaan-Hassan"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors flex items-center gap-2"
              aria-label="LinkedIn"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path>
                <rect x="2" y="9" width="4" height="12"></rect>
                <circle cx="4" cy="4" r="2"></circle>
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
