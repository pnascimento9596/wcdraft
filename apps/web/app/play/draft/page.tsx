import { Suspense } from "react";
import type { Metadata } from "next";
import { DraftScreen } from "../../../components/game/draft-screen";

export const metadata: Metadata = {
  title: "Draft",
  description:
    "The wcdraft spin: a rolled team and World Cup year, the squad's players and coach, position fit, and a live Synergy preview as you build your XI.",
};

export default function DraftPage() {
  return (
    <div className="container page">
      <Suspense fallback={<DraftFallback />}>
        <DraftScreen />
      </Suspense>
    </div>
  );
}

function DraftFallback() {
  return <div style={{ padding: "2rem", textAlign: "center" }}>Loading draft…</div>;
}
