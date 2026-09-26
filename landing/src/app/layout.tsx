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

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://heyorbit.saadaan.dev";

const DESCRIPTION =
  "Orbit remembers your work, restores your context, and helps you get back into flow without wasting time rebuilding your mental state.";

const CREATOR_NAME = "Saadaan Hassan";
const CREATOR_URL = "https://saadaan.dev";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: "Orbit — Never lose your place again.",
  description: DESCRIPTION,
  authors: [{ name: CREATOR_NAME, url: CREATOR_URL }],
  creator: CREATOR_NAME,
  alternates: {
    canonical: APP_URL,
  },
  openGraph: {
    type: "website",
    url: APP_URL,
    title: "Orbit — Never lose your place again.",
    description: DESCRIPTION,
    siteName: "Orbit",
  },
  twitter: {
    card: "summary_large_image",
    title: "Orbit — Never lose your place again.",
    description: DESCRIPTION,
  },
};

const CREATOR_PERSON_JSON_LD = {
  "@type": "Person",
  name: CREATOR_NAME,
  url: CREATOR_URL,
  sameAs: [
    "https://github.com/Saadaan-Hassan",
    "https://x.com/SaadaanHassan",
    "https://linkedin.com/in/Saadaan-Hassan",
  ],
};

const SOFTWARE_APPLICATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Orbit",
  description: DESCRIPTION,
  url: APP_URL,
  applicationCategory: "ProductivityApplication",
  operatingSystem: "macOS 13+",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  isAccessibleForFree: true,
  codeRepository: "https://github.com/Saadaan-Hassan/orbit",
  downloadUrl: "https://github.com/Saadaan-Hassan/orbit",
  license: "https://github.com/Saadaan-Hassan/orbit/blob/main/LICENSE",
  author: CREATOR_PERSON_JSON_LD,
  creator: CREATOR_PERSON_JSON_LD,
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
      <head>
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(SOFTWARE_APPLICATION_JSON_LD),
          }}
        />
      </head>
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

