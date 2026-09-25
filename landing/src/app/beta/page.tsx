import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Early Access — Orbit",
  description:
    "You've been invited to try Orbit. Installation instructions are on their way.",
  robots: { index: false }, // Not indexed — only shared directly with invitees
};

export default function BetaPage() {
  return (
    <main className="grow flex flex-col items-center justify-center px-6 py-16 relative z-10">
      <div className="flex flex-col items-center gap-10 max-w-lg w-full text-center">

        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="relative w-10 h-10 rounded-xl overflow-hidden border border-white/10">
            <Image
              src="/logo.png"
              alt="Orbit Logo"
              fill
              className="object-cover"
              unoptimized
            />
          </div>
          <span className="font-semibold text-lg tracking-tight text-white">
            Orbit
          </span>
        </div>

        {/* Main card */}
        <div className="w-full flex flex-col gap-6 rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-xl p-8">

          {/* Status indicator */}
          <div className="flex items-center justify-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-zinc-300 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            <span className="text-[11px] font-semibold text-zinc-400 tracking-widest uppercase">
              Early Access
            </span>
          </div>

          {/* Headline */}
          <div className="flex flex-col gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              You&apos;re in. Download Orbit below.
            </h1>
            <p className="text-sm text-zinc-400 font-light leading-relaxed">
              Pick the download that matches your Mac, then follow the
              guided setup when you open the app.
            </p>
          </div>

          {/* Download buttons */}
          <div className="flex flex-col gap-2.5">
            <a
              href="https://github.com/Saadaan-Hassan/orbit-releases/releases/latest/download/Orbit-latest-aarch64.dmg"
              className="w-full py-3.5 rounded-xl bg-white text-zinc-950 text-sm font-semibold text-center hover:opacity-90 transition-all"
            >
              Download for Apple Silicon (M1/M2/M3/M4)
            </a>
            <a
              href="https://github.com/Saadaan-Hassan/orbit-releases/releases/latest/download/Orbit-latest-x86_64.dmg"
              className="w-full py-3 rounded-xl border border-white/10 text-zinc-300 text-xs font-semibold text-center hover:bg-white/5 transition-all"
            >
              Download for Intel Mac
            </a>
            <p className="text-[11px] text-zinc-600 text-center">
              Not sure which chip you have? — Apple menu → About This Mac.{" "}
              <a
                href="https://github.com/Saadaan-Hassan/orbit-releases/releases/latest"
                className="underline underline-offset-2 hover:text-zinc-400 transition-colors"
              >
                See all release files
              </a>
            </p>
          </div>

          {/* What to expect box */}
          <div className="flex flex-col gap-3 rounded-xl border border-white/5 bg-white/[0.015] p-5 text-left">
            <p className="text-[11px] font-semibold text-zinc-500 tracking-widest uppercase">
              What to expect
            </p>
            <ul className="flex flex-col gap-2.5">
              {[
                "macOS 13 Ventura or later required",
                "The app isn't notarized yet, so macOS will block it the first time you open it — click Done (not Move to Bin), then go to System Settings → Privacy & Security, scroll to the bottom, and click \"Open Anyway\" next to Orbit. Open it once more to confirm.",
                "Accessibility permission needed (you'll be guided through it)",
                "No account creation — Orbit runs entirely on your Mac",
              ].map((item) => (
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

          {/* Privacy note */}
          <p className="text-[11px] text-zinc-600 font-light leading-relaxed">
            All data stays on your Mac.{" "}
            <Link
              href="/privacy"
              className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors"
            >
              Read our privacy policy
            </Link>
          </p>
        </div>

        {/* Footer link */}
        <Link
          href="/"
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
