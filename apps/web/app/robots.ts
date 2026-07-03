import type { MetadataRoute } from "next";
import { metadataBaseUrl } from "../lib/site-metadata";

// SEO surface — /robots.txt. Public content is crawlable; transient in-app
// states and private/account routes are not.
//
// Deliberately NOT disallowed: `/play/share` and `/api/og` — the per-run share
// cards depend on social scrapers (facebookexternalhit, Twitterbot) fetching
// the share page for its `og:`/`twitter:` tags AND the OG image route. A blanket
// `Disallow: /play/` or `Disallow: /api/` would break that unfurl. Search
// indexing of the (infinite, ephemeral) per-run share URLs is suppressed by a
// `robots: { index: false }` meta on the share route instead, which does NOT
// affect social-card scraping.
export default function robots(): MetadataRoute.Robots {
  const base = metadataBaseUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/settings",
        "/sign-in",
        "/sign-up",
        "/play/draft",
        "/play/review",
        "/play/results",
        "/play/history",
        "/api/auth/",
        "/api/profile",
        "/api/runs",
        "/api/leaderboard",
      ],
    },
    sitemap: new URL("sitemap.xml", base).toString(),
  };
}
