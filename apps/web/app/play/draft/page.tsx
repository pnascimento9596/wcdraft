import { Suspense } from "react";
import type { Metadata } from "next";
import { DraftScreen } from "../../../components/game/draft-screen";
import { GameFallback } from "../../../components/game/game-fallback";

export const metadata: Metadata = {
  title: "Draft",
  description:
    "The wcdraft spin: a rolled team and World Cup year, the squad's players and manager, position fit, and a live Synergy preview as you build your XI.",
  // Transient client-state route — renders empty without a live run in this
  // browser, so it's noindex (follow) to keep thin/empty pages out of the index.
  robots: { index: false, follow: true },
};

export default function DraftPage() {
  return (
    <div className="container page game-page game-page--draft">
      <Suspense fallback={<GameFallback />}>
        <DraftScreen />
      </Suspense>
    </div>
  );
}
