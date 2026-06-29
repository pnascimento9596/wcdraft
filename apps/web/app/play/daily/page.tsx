import { Suspense } from "react";
import type { Metadata } from "next";
import { DraftScreen } from "../../../components/game/draft-screen";
import { GameFallback } from "../../../components/game/game-fallback";

export const metadata: Metadata = {
  title: "Daily Draft",
  description:
    "Today's shared wcdraft challenge: the same Classic, Squad First, All-time, Career draft for every player.",
  robots: { index: false, follow: true },
};

export default function DailyDraftPage() {
  return (
    <div className="container page game-page game-page--draft">
      <Suspense fallback={<GameFallback />}>
        <DraftScreen daily />
      </Suspense>
    </div>
  );
}
