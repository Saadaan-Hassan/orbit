import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "404 — Page Not Found",
  description: "The page you are looking for does not exist.",
};

export default function NotFound() {
  return (
    <main className="grow flex flex-col items-center justify-center text-center px-6 py-24 relative z-10 select-none">
      <div className="flex flex-col items-center gap-8 max-w-md mx-auto">
        {/* Large 404 visual */}
        <div className="relative">
          <div className="relative w-28 h-28 rounded-full bg-white/3 border border-white/10 flex items-center justify-center backdrop-blur-md">
            <Image
              src="/logo.png"
              alt="Orbit Logo"
              width={64}
              height={64}
              className="object-contain opacity-90"
            />
          </div>
          <span className="absolute -bottom-1 -right-1 px-2 py-0.5 rounded-md bg-zinc-800 border border-white/10 text-xs font-bold tracking-wider uppercase text-zinc-400">
            404
          </span>
        </div>

        {/* Text content */}
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Lost in Space
          </h1>
          <p className="text-sm font-light text-zinc-400 leading-relaxed max-w-sm">
            The page you are looking for has drifted out of Orbit or was never in our flight plan.
          </p>
        </div>

        {/* Navigation Action */}
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-xl bg-white text-black px-6 py-2.5 text-xs font-semibold hover:bg-zinc-200 transition-colors shadow-lg hover:shadow-white/5"
        >
          Back to Home
        </Link>
      </div>
    </main>
  );
}
