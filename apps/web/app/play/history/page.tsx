import { Suspense } from "react";
import type { Metadata } from "next";
import { HistoryScreen } from "../../../components/game/history-screen";

export const metadata: Metadata = {
  title: "Run history",
  description:
    "Your most recent completed wcdraft runs, stored locally in this browser. Re-open each run via its seed-locked replay link.",
};

export default function HistoryPage() {
  return (
    <div className="container page">
      <Suspense fallback={<HistoryFallback />}>
        <HistoryScreen />
      </Suspense>
    </div>
  );
}

function HistoryFallback() {
  return <div style={{ padding: "2rem", textAlign: "center" }}>Loading history…</div>;
}
