import Link from "next/link";
import Image from "next/image";

export default function Header() {
  return (
    <header className="relative z-10 w-full max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
      <Link href="/" className="flex items-center gap-0 group">
        <div className="relative w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center">
          <Image
            src="/logo.png"
            alt="Orbit Logo"
            width={26}
            height={26}
            className="object-cover"
          />
        </div>
        <span className="font-semibold text-lg tracking-tight hover:text-zinc-200 transition-colors">Orbit</span>
      </Link>
    </header>
  );
}
