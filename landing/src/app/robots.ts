import type { MetadataRoute } from "next";

// Required for `output: "export"` (SITE-001) — this route has no
// per-request dynamic input, so it's generated once at build time.
export const dynamic = "force-static";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://heyorbit.saadaan.dev";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
