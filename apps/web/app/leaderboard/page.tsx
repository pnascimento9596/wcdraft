// F-4 U4 — /leaderboard board page.
//
// SHIP-DARK: server-gated on the same LEADERBOARD_ENABLED env the API
// routes read — no NEXT_PUBLIC_ mirror. When dark this page 404s exactly
// like the routes (notFound() before anything else is touched), and the
// nav entry that links here isn't rendered (site-header gate).

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BoardScreen } from "@/components/leaderboard/board-screen";
import { isLeaderboardEnabled } from "@/lib/leaderboard/enabled";
import { currentSeasonKey } from "@/lib/leaderboard/server-data";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Season standings — the best server-verified run per manager. Finish a run and post it from your results screen.",
};

export default function LeaderboardPage() {
  if (!isLeaderboardEnabled()) notFound();
  return (
    <div className="container container--narrow page leaderboard-page">
      <BoardScreen currentSeasonKey={currentSeasonKey()} />
    </div>
  );
}
