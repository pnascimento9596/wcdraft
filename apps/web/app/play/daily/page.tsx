import { Suspense } from "react";
import type { Metadata } from "next";
import { DraftScreen } from "../../../components/game/draft-screen";

export const metadata: Metadata = {
  title: "Daily Draft",
  description:
    "Today's shared wcdraft challenge: the same Classic, Squad First, All-time, Career draft for every player.",
  robots: { index: false, follow: true },
};

export default function DailyDraftPage() {
  return (
    <div className="container page game-page game-page--draft">
      <Suspense fallback={<DraftFallback />}>
        <DraftScreen daily />
      </Suspense>
    </div>
  );
}

function DraftFallback() {
  return <div style={{ padding: "2rem", textAlign: "center" }}>Loading daily draft...</div>;
}
