import { Suspense } from "react";
import type { Metadata } from "next";
import { HistoryScreen } from "../../../components/game/history-screen";
import { GameFallback } from "../../../components/game/game-fallback";

export const metadata: Metadata = {
  title: "Run history",
  description:
    "Your most recent completed wcdraft runs, stored locally in this browser. Re-open each run via its seed-locked replay link.",
  // Local-only, per-browser content — nothing to index; noindex.
  robots: { index: false, follow: true },
};

export default function HistoryPage() {
  return (
    <div className="container page game-page game-page--history">
      <Suspense fallback={<GameFallback />}>
        <HistoryScreen />
      </Suspense>
    </div>
  );
}
