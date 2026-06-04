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
      <ResultsScreen />
    </div>
  );
}
