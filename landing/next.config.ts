import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SITE-001: no Supabase/Resend backend, no Server Actions — this site is
  // fully static and needs no Node.js server to run. `next build` emits
  // ready-to-serve HTML/CSS/JS into out/, deployable to GitHub Pages,
  // Cloudflare Pages, or any static host.
  output: "export",
};

export default nextConfig;
