import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import BackgroundOrbit from "@/components/background-orbit";
import Header from "@/components/header";
import Footer from "@/components/footer";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Orbit — Never lose your place again.",
  description:
    "Orbit remembers your work, restores your context, and helps you get back into flow without wasting time rebuilding your mental state.",
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#030303]">
        <div className="relative flex flex-col min-h-screen text-white overflow-hidden bg-transparent selection:bg-zinc-800 selection:text-white">
          {/* Dynamic Cosmic Orbit Background */}
          <BackgroundOrbit />

          {/* Navigation Header */}
          <Header />

          {/* Page Contents */}
          {children}

          {/* Footer Section */}
          <Footer />
        </div>
      </body>
    </html>
  );
}

