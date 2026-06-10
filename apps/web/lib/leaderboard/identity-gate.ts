// F-4 U3 — the swappable identity gate (plan §5.3). Pipeline step 4.
//
// AUTH POSTURE LIVES HERE AND ONLY HERE. Launch default is anonymous-first
// casual (lead-architect ruling):
//
//   - no session cookie        → fully anonymous {sessionId:null, userId:null}
//   - cookie present + valid   → identity attached; CSRF (Origin/Host +
//                                double-submit) enforced exactly like
//                                POST /api/runs — a session-bearing request
//                                carries ambient authority, so it gets the
//                                full mutating-request treatment
//   - cookie present + INVALID → 401 AUTH_REQUIRED (never silently
//                                downgraded to anonymous: the player would
//                                believe the entry is attached to their
//                                session/claimable when it is not)
//   - requireAccount() flipped → additionally reject userId === null
//
// Flipping LEADERBOARD_REQUIRE_ACCOUNT changes no schema, no pipeline step,
// no response contract — only this gate's verdict.
//
// Failures throw `LeaderboardGateError` carrying the U2-declared gate codes
// (`SubmitGateCode`) and the single-sourced SUBMIT_ERROR_HTTP_STATUS status,
// so AuthError's own statuses (e.g. CSRF_* → 401) never leak into the
// leaderboard contract (CSRF_FAILED is 403 here).

import type { NextRequest } from "next/server";
import type { Db } from "@wcdraft/db";

import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
} from "../auth/csrf";
import { AuthError } from "../auth/errors";
import { readRequestCookie } from "../auth/handler-helpers";
import { SESSION_COOKIE_NAME, validateSessionCookie, type SessionDeps } from "../auth/sessions";
import { SUBMIT_ERROR_HTTP_STATUS, type SubmitGateCode } from "./validate";

/** Resolved submitting identity. Both null = anonymous casual submission. */
export interface SubmitIdentity {
  readonly sessionId: string | null;
  readonly userId: string | null;
}

/** Gate failure with the single-sourced HTTP status for its code. */
export class LeaderboardGateError extends Error {
  readonly code: SubmitGateCode;
  readonly status: number;
  constructor(code: SubmitGateCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.status = SUBMIT_ERROR_HTTP_STATUS[code];
    this.name = "LeaderboardGateError";
  }
}

export interface IdentityGateDeps {
  readonly db: Db;
  readonly now: () => number;
  /** Lazy — only read when a session cookie is actually present, so a dark
   *  or half-configured deploy can never 500 the anonymous path (F-3.6). */
  readonly getCookieSecret: () => string;
  /** Plan §5.3 posture flag (LEADERBOARD_REQUIRE_ACCOUNT). */
  readonly requireAccount: () => boolean;
}

function sessionDeps(deps: IdentityGateDeps): SessionDeps {
  return { db: deps.db, now: deps.now, cookieSecret: deps.getCookieSecret() };
}

/**
 * Resolve the submitting identity for POST /api/leaderboard/submit.
 * Throws LeaderboardGateError (AUTH_REQUIRED | CSRF_FAILED) — never AuthError.
 */
export async function requireSubmitIdentity(
  req: NextRequest,
  deps: IdentityGateDeps,
): Promise<SubmitIdentity> {
  const cookie = readRequestCookie(req, SESSION_COOKIE_NAME);
  if (!cookie) {
    if (deps.requireAccount()) {
      throw new LeaderboardGateError("AUTH_REQUIRED", "an account is required to submit");
    }
    return { sessionId: null, userId: null };
  }

  let session;
  try {
    session = await validateSessionCookie(cookie, sessionDeps(deps));
  } catch (err) {
    if (err instanceof AuthError) {
      throw new LeaderboardGateError("AUTH_REQUIRED", `session invalid (${err.code})`);
    }
    throw err;
  }

  try {
    verifyOriginHost({
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      host: req.headers.get("host"),
    });
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: session.csrfSecret,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      throw new LeaderboardGateError("CSRF_FAILED", `csrf check failed (${err.code})`);
    }
    throw err;
  }

  if (deps.requireAccount() && session.userId === null) {
    throw new LeaderboardGateError("AUTH_REQUIRED", "an account is required to submit");
  }
  return { sessionId: session.id, userId: session.userId };
}

/**
 * Resolve the caller's identity for GET /api/leaderboard/me. Session
 * REQUIRED (there is no "me" without one); read-only → no CSRF.
 */
export async function requireReadIdentity(
  req: NextRequest,
  deps: Omit<IdentityGateDeps, "requireAccount">,
): Promise<SubmitIdentity> {
  const cookie = readRequestCookie(req, SESSION_COOKIE_NAME);
  if (!cookie) {
    throw new LeaderboardGateError("AUTH_REQUIRED", "a session is required");
  }
  try {
    const session = await validateSessionCookie(cookie, {
      db: deps.db,
      now: deps.now,
      cookieSecret: deps.getCookieSecret(),
    });
    return { sessionId: session.id, userId: session.userId };
  } catch (err) {
    if (err instanceof AuthError) {
      throw new LeaderboardGateError("AUTH_REQUIRED", `session invalid (${err.code})`);
    }
    throw err;
  }
}
