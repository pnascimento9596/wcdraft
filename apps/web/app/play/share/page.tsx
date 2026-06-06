import { Suspense } from "react";
import type { Metadata } from "next";
import { ShareScreen } from "../../../components/game/share-screen";

export const metadata: Metadata = {
  title: "Share card",
  description:
    "A deterministic, seed-locked shareable card for your run. Names and national flag codes only — no competition marks.",
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
