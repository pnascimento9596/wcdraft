// POST /api/ranked/attempt — server-issued ranked parent seed.
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@wcdraft/db";

import { validateCookieSecret } from "@/lib/auth/handler-helpers";
import { leaderboardGateResponse } from "@/lib/leaderboard/enabled";
import { handleRankedAttemptPost } from "@/lib/leaderboard/ranked-attempt-route";
import { currentSeasonKey } from "@/lib/leaderboard/server-data";

/** DB statement_timeout (8s) fires before this platform kill. */
export const maxDuration = 10;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = leaderboardGateResponse();
  if (gate) return gate;
  return handleRankedAttemptPost(req, {
    db: getDb(),
    now: () => Date.now(),
    getCookieSecret: () => validateCookieSecret(process.env.AUTH_COOKIE_SECRET),
    currentSeasonKey,
  });
}
