// GET /api/leaderboard/lineup?entry_id=... — public lineup inspector for a
// visible board row. POST { token } supports token-class tests and tooling.
// Both paths re-derive from the stored/current run token and never echo it.
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@wcdraft/db";

import { createDbRunOgSignRateLimiter } from "@/lib/game/run-og-sign-rate-limiter-db";
import {
  handleLeaderboardLineupGet,
  handleLeaderboardLineupPost,
} from "@/lib/leaderboard/lineup-route";
import { getValidationData } from "@/lib/leaderboard/server-data";
import { isLeaderboardEnabled, leaderboardDarkResponse } from "@/lib/leaderboard/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isLeaderboardEnabled()) return leaderboardDarkResponse();
  const now = () => Date.now();
  return handleLeaderboardLineupGet(req, {
    db: getDb(),
    now,
    getValidationData,
    getRateLimiter: () =>
      createDbRunOgSignRateLimiter({
        db: getDb(),
        now,
        random: Math.random,
      }),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isLeaderboardEnabled()) return leaderboardDarkResponse();
  const now = () => Date.now();
  return handleLeaderboardLineupPost(request, {
    db: getDb(),
    now,
    getValidationData,
    getRateLimiter: () =>
      createDbRunOgSignRateLimiter({
        db: getDb(),
        now,
        random: Math.random,
      }),
  });
}
