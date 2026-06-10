// F-4 U3 — POST /api/leaderboard/submit (RED: user-facing write endpoint).
//
// SHIP-DARK: the flag check runs BEFORE any dependency is built — a dark
// deploy with no DATABASE_URL / AUTH_COOKIE_SECRET 404s cleanly, never 500s.
// Only POST is exported; Next rejects every other method at the framework
// layer. All handler logic lives in lib/leaderboard/submit-route.ts so the
// PGlite test suite can exercise it with injected deps.
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@wcdraft/db";

import { validateCookieSecret } from "@/lib/auth/handler-helpers";
import {
  isLeaderboardAccountRequired,
  isLeaderboardEnabled,
  leaderboardDarkResponse,
} from "@/lib/leaderboard/enabled";
import { getValidationData } from "@/lib/leaderboard/server-data";
import { handleLeaderboardSubmit } from "@/lib/leaderboard/submit-route";
import { createDbSubmitRateLimiter } from "@/lib/leaderboard/submit-rate-limiter-db";

// Plan §6 — replay + re-sim is ~17 ms p95, but allow for serverless cold
// start (bundle parse + catalog build) on the same invocation.
export const maxDuration = 10;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isLeaderboardEnabled()) return leaderboardDarkResponse();
  const db = getDb();
  const now = (): number => Date.now();
  return handleLeaderboardSubmit(req, {
    db,
    now,
    getCookieSecret: () => validateCookieSecret(process.env.AUTH_COOKIE_SECRET),
    getValidation: getValidationData,
    // U5: the real auth_rate_limits-backed limiter (plan §5.2) — swapped in
    // here at the deps builder; the handler logic did not change.
    rateLimiter: createDbSubmitRateLimiter({ db, now, random: Math.random }),
    requireAccount: isLeaderboardAccountRequired,
  });
}
