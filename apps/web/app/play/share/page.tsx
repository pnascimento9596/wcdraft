import { Suspense } from "react";
import type { Metadata } from "next";
import { ShareScreen } from "../../../components/game/share-screen";

// ws-results/history-share — link-unfurl metadata.
//
// Per-run dynamic OG (rendering the card from the `?run=t1.…` token via
// `@vercel/og` / Next's `opengraph-image` convention) is a deliberate
// FOLLOW-ON. The repo currently has no rasterizer or `@vercel/og` dep, and
// the share route's primary data lives client-side; standing up server-side
// per-run reconstruction is its own design pass. This pass ships the static
// branded default so pasted links preview with the wcdraft mark + tagline.
const OG_DEFAULT = "/og/share-default.svg" as const;
const OG_TITLE = "wcdraft — draft your all-time XI" as const;
const OG_DESCRIPTION =
  "A football drafting game. Spin, pick, build your XI, and chase the perfect run." as const;

export const metadata: Metadata = {
  title: "Share card",
  description:
    "A deterministic, seed-locked shareable card for your run. Names and national flag codes only — no competition marks.",
  openGraph: {
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    siteName: "wcdraft",
    type: "website",
    url: "/play/share",
    images: [
      {
        url: OG_DEFAULT,
        width: 1200,
        height: 630,
        alt: "wcdraft — draft your all-time XI",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [OG_DEFAULT],
  },
};

export default function SharePage() {
  return (
    <div className="container page">
      <Suspense fallback={<ShareFallback />}>
        <ShareScreen />
      </Suspense>
    </div>
  );
}

function ShareFallback() {
  return <div style={{ padding: "2rem", textAlign: "center" }}>Loading share card…</div>;
}
