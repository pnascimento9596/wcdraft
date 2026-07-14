import { Suspense } from "react";
import type { Metadata } from "next";
import { ReviewScreen } from "../../../components/game/review-screen";
import { GameFallback } from "../../../components/game/game-fallback";

export const metadata: Metadata = {
  title: "Squad review",
  description:
    "Your committed XI on the formation, five on the bench, your manager, rating by line and a Synergy summary — then simulate the run.",
  // Transient client-state route — renders empty without a live run; noindex.
  robots: { index: false, follow: true },
};

export default function ReviewPage() {
  return (
    <div className="container page game-page game-page--review">
      <Suspense fallback={<GameFallback />}>
        <ReviewScreen />
      </Suspense>
    </div>
  );
}
