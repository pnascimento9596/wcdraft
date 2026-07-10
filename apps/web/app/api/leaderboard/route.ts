// F-4 U3 — GET /api/leaderboard (public board read).
//
// SHIP-DARK: flag check before any dependency is built (404, never 500).
// Only GET is exported. Handler logic lives in lib/leaderboard/
// board-route.ts for PGlite-backed tests with injected deps.
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@wcdraft/db";

import { validateCookieSecret } from "@/lib/auth/handler-helpers";
import { handleLeaderboardBoardGet } from "@/lib/leaderboard/board-route";
import { leaderboardGateResponse } from "@/lib/leaderboard/enabled";
import { currentSeasonKey } from "@/lib/leaderboard/server-data";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = leaderboardGateResponse();
  if (gate) return gate;
  return handleLeaderboardBoardGet(req, {
    db: getDb(),
    now: () => Date.now(),
    getCookieSecret: () => validateCookieSecret(process.env.AUTH_COOKIE_SECRET),
    currentSeasonKey,
  });
}
