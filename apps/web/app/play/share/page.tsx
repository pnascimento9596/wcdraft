import { Suspense } from "react";
import type { Metadata } from "next";
import { loadDataManifest } from "@wcdraft/data/client";
import { ShareScreen } from "../../../components/game/share-screen";
import { composeVersions } from "../../../lib/game/data";
import { shareOgImageForRunValue } from "../../../lib/game/run-og-metadata";
import {
  OG_DEFAULT_IMAGE,
  OG_DEFAULT_IMAGE_ALT,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
} from "../../../lib/site-metadata";

// ws-results/history-share — link-unfurl metadata.

export const dynamic = "force-dynamic";

const STATIC_SHARE_METADATA: Metadata = {
  title: "Share card",
  description:
    "A deterministic, seed-locked shareable card for your run. Names and national flag codes only — no competition marks.",
  // Per-run share URLs are an infinite, ephemeral space — keep them out of the
  // search index. `noindex` does NOT block social-card scrapers (they read the
  // og:/twitter: tags below regardless), so unfurls still work; only search
  // indexing is suppressed. Valid-token renders spread this object and inherit
  // the directive intentionally.
  robots: { index: false, follow: true },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    type: "website",
    url: "/play/share",
    images: [
      {
        url: OG_DEFAULT_IMAGE,
        width: 1200,
        height: 630,
        alt: OG_DEFAULT_IMAGE_ALT,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: OG_DEFAULT_IMAGE,
        alt: OG_DEFAULT_IMAGE_ALT,
      },
    ],
  },
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ run?: string | string[]; og?: string | string[] }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const versions = await currentVersionsForMetadata();
  const image = versions ? shareOgImageForRunValue(params.run, params.og, versions) : null;
  if (!image || !image.dynamic) return STATIC_SHARE_METADATA;
  return {
    ...STATIC_SHARE_METADATA,
    openGraph: {
      ...STATIC_SHARE_METADATA.openGraph,
      url: "/play/share",
      images: [
        {
          url: image.url,
          width: image.width,
          height: image.height,
          alt: image.alt,
        },
      ],
    },
    twitter: {
      ...STATIC_SHARE_METADATA.twitter,
      card: "summary_large_image",
      images: [
        {
          url: image.url,
          alt: image.alt,
        },
      ],
    },
  };
}

export default function SharePage() {
  return (
    <div className="container page game-page game-page--share">
      <Suspense fallback={<ShareFallback />}>
        <ShareScreen />
      </Suspense>
    </div>
  );
}

function ShareFallback() {
  return <div style={{ padding: "2rem", textAlign: "center" }}>Loading share card…</div>;
}

async function currentVersionsForMetadata() {
  try {
    const manifest = await loadDataManifest({
      basePath: runtimeDataBasePath(),
      fetch: fetch.bind(globalThis),
    });
    return composeVersions(manifest);
  } catch {
    return null;
  }
}

function runtimeDataBasePath(): string {
  const base =
    process.env.WCDRAFT_SITE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return new URL("/data/wcdraft", base).toString();
}
