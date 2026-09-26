import type { MetadataRoute } from "next";

// Required for `output: "export"` (SITE-001) — this route has no
// per-request dynamic input, so it's generated once at build time.
export const dynamic = "force-static";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://heyorbit.saadaan.dev";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: APP_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${APP_URL}/privacy`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
