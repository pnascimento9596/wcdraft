// GET /api/leaderboard/lineup?entry_id=... — public lineup inspector for a
// visible board row. POST { token } supports token-class tests and tooling.
// Both paths re-derive from the stored/current run token and never echo it.
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@wcdraft/db";

import { createDbLineupRateLimiter } from "@/lib/game/run-og-sign-rate-limiter-db";
import {
  handleLeaderboardLineupGet,
  handleLeaderboardLineupPost,
} from "@/lib/leaderboard/lineup-route";
import { getValidationData } from "@/lib/leaderboard/server-data";
import { leaderboardGateResponse } from "@/lib/leaderboard/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** DB statement_timeout (8s) fires before this platform kill. */
export const maxDuration = 10;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = leaderboardGateResponse();
  if (gate) return gate;
  const now = () => Date.now();
  return handleLeaderboardLineupGet(req, {
    db: getDb(),
    now,
    getValidationData,
    getRateLimiter: () =>
      createDbLineupRateLimiter({
        db: getDb(),
        now,
        random: Math.random,
      }),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const gate = leaderboardGateResponse();
  if (gate) return gate;
  const now = () => Date.now();
  return handleLeaderboardLineupPost(request, {
    db: getDb(),
    now,
    getValidationData,
    getRateLimiter: () =>
      createDbLineupRateLimiter({
        db: getDb(),
        now,
        random: Math.random,
      }),
  });
}
