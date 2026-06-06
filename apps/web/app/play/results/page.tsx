import { Suspense } from "react";
import type { Metadata } from "next";
import { ResultsScreen } from "../../../components/game/results-screen";

export const metadata: Metadata = {
  title: "Run results",
  description:
    "Your 8-match run: per-match box scores from the event log, the final record, the generated narrative, and a seed-locked replay.",
};

export default function ResultsPage() {
  return (
    <div className="container page">
      <Suspense fallback={<ResultsFallback />}>
        <ResultsScreen />
      </Suspense>
    </div>
  );
}

function ResultsFallback() {
  return <div style={{ padding: "2rem", textAlign: "center" }}>Loading the run…</div>;
}
