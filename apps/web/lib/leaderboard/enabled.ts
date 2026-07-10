// F-4 U3 — ship-dark gate for the leaderboard feature (lead-architect ruling).
//
// The ENTIRE leaderboard surface ships DARK behind LEADERBOARD_ENABLED:
// absent (or anything but an explicit "1"/"true") → every /api/leaderboard*
// route returns a bare 404, indistinguishable from a route that does not
// exist. Mirrors the `isAuthEnabled()` ship-dark pattern (lib/auth/
// auth-enabled.ts) but with 404 instead of 503 — the ruling is "the surface
// does not exist yet", not "the surface exists and is unavailable".
//
// Route files MUST check this flag BEFORE building any dependency
// (db handle, cookie secret, bundle data) — the F-3.6 session-route lesson:
// a dark deploy with no DATABASE_URL / AUTH_COOKIE_SECRET must 404 cleanly,
// never 500.
//
// Server-only — reads process.env directly.

import { NextResponse } from "next/server";

/**
 * True when the leaderboard surface is live. Strict allowlist ("1" / "true",
 * case-insensitive, trimmed) so a garbage value in a half-configured deploy
 * can never accidentally open the surface. NEVER true when unset.
 */
export function isLeaderboardEnabled(): boolean {
  const v = (process.env.LEADERBOARD_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * Legacy identity-posture seam. L2 removes the OFF state for ranked:
 * ranked submissions are always account-required, while casual submissions
 * stay anonymous-capable in the submit route itself. Keep the helper as an
 * explicit no-op-off contract for code that still imports the old seam.
 */
export function isLeaderboardAccountRequired(): boolean {
  return true;
}

/** The dark response: a bare 404 with no JSON body, no headers of note. */
export function leaderboardDarkResponse(): NextResponse {
  return new NextResponse(null, { status: 404 });
}

export type LeaderboardAvailabilityError = {
  readonly error: "SERVICE_UNAVAILABLE";
};

/**
 * Shared runtime gate. The feature flag remains first so dark deploys stay a
 * bare 404; an enabled but DB-unconfigured deploy is an honest typed 503 and
 * never reaches getDb()'s generic configuration throw.
 */
export function leaderboardGateResponse(): NextResponse | null {
  if (!isLeaderboardEnabled()) return leaderboardDarkResponse();
  if (!process.env.DATABASE_URL?.trim()) {
    return NextResponse.json<LeaderboardAvailabilityError>(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return null;
}
