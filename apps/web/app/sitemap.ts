import type { MetadataRoute } from "next";
import { metadataBaseUrl } from "../lib/site-metadata";

// SEO surface — /sitemap.xml. Stable, indexable public routes only.
// Excludes transient `/play/*` run states, `/settings`, `/sign-in`, and API
// routes (all either client-state-dependent or non-content). `lastModified` is
// intentionally omitted to keep the generated XML deterministic across builds.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = metadataBaseUrl();
  const loc = (path: string) => new URL(path, base).toString();
  return [
    { url: loc("/"), changeFrequency: "monthly", priority: 1 },
    { url: loc("/play"), changeFrequency: "monthly", priority: 0.9 },
    { url: loc("/how-to-play"), changeFrequency: "monthly", priority: 0.7 },
    { url: loc("/leaderboard"), changeFrequency: "daily", priority: 0.6 },
    { url: loc("/attribution"), changeFrequency: "yearly", priority: 0.3 },
    { url: loc("/privacy"), changeFrequency: "yearly", priority: 0.3 },
    { url: loc("/contact"), changeFrequency: "yearly", priority: 0.3 },
  ];
}
