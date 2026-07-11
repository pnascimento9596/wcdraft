// F-4 U4 — /leaderboard board page.
//
// SHIP-DARK: the board and posting APIs remain server-gated. The public page
// stays reachable and explains the closed state without touching board data.

import type { Metadata } from "next";
import { BoardScreen } from "@/components/leaderboard/board-screen";
import { LeaderboardClosed } from "@/components/leaderboard/board-views";
import { isLeaderboardEnabled } from "@/lib/leaderboard/enabled";
import { currentSeasonKey } from "@/lib/leaderboard/server-data";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Season standings by lane and draft config. Finish a run and post it from your results screen.",
};

export default function LeaderboardPage() {
  const enabled = isLeaderboardEnabled();
  return (
    <div className="container container--narrow page leaderboard-page">
      {enabled ? <BoardScreen currentSeasonKey={currentSeasonKey()} /> : <LeaderboardClosed />}
    </div>
  );
}
