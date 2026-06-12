import { Suspense } from "react";
import type { Metadata } from "next";
import { ShareScreen } from "../../../components/game/share-screen";
import {
  OG_DEFAULT_IMAGE,
  OG_DEFAULT_IMAGE_ALT,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
} from "../../../lib/site-metadata";

// ws-results/history-share — link-unfurl metadata.
//
// Per-run dynamic OG (rendering the card from the `?run=` token via
// `@vercel/og` / Next's `opengraph-image` convention) is a deliberate
// FOLLOW-ON. The repo currently has no rasterizer or `@vercel/og` dep, and
// the share route's primary data lives client-side; standing up server-side
// per-run reconstruction remains the F-4-server backlog item. This pass keeps
// share links on the same static marketing default as the rest of the site.

export const metadata: Metadata = {
  title: "Share card",
  description:
    "A deterministic, seed-locked shareable card for your run. Names and national flag codes only — no competition marks.",
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
