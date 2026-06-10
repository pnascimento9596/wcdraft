import { Suspense } from "react";
import type { Metadata } from "next";
import { ResultsScreen } from "../../../components/game/results-screen";
import { isLeaderboardEnabled } from "../../../lib/leaderboard/enabled";

export const metadata: Metadata = {
  title: "Run results",
  description:
    "Your 8-match run: per-match box scores from the event log, the final record, the generated narrative, and a seed-locked replay.",
};

export default function ResultsPage() {
  // F-4 U4 — ship-dark gate read server-side (same LEADERBOARD_ENABLED env
  // the API routes use; no NEXT_PUBLIC_ mirror). When dark, the results
  // screen renders no submit affordance at all.
  const leaderboardEnabled = isLeaderboardEnabled();
  return (
    <div className="container page game-page game-page--results">
      <Suspense fallback={<ResultsFallback />}>
        <ResultsScreen leaderboardEnabled={leaderboardEnabled} />
      </Suspense>
    </div>
  );
}

function ResultsFallback() {
  return <div style={{ padding: "2rem", textAlign: "center" }}>Loading the run…</div>;
}
