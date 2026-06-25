// F-2 — anonymous session issuance.
//
// First visit (no `wcdraft_sid` cookie, or cookie fails validation):
//   → create a new sessions row with user_id = NULL,
//   → set the signed cookie,
//   → return the row to the caller (route handler).
//
// F-4 binds a ranked_attempts.parent_seed to the session_id at this point;
// F-3 is responsible for the anon→account CLAIM flow that re-keys a saved_run
// (and later, additional surfaces) under the new user_id. F-2 only ISSUES.
import { AuthError } from "./errors";
import type { Session } from "@wcdraft/db";
import { createSession, validateSessionCookie, type SessionDeps } from "./sessions";

export interface EnsureSessionResult {
  readonly session: Session;
  /** True when this call created a fresh anonymous session. */
  readonly fresh: boolean;
  /** Cookie value the handler must Set-Cookie on the response. */
  readonly cookieValue: string;
}

/**
 * Resolve the request's session: validate the cookie if present + valid,
 * otherwise create a fresh anonymous session. NEVER throws for "no cookie"
 * — that's the happy path for a first visit.
 *
 * The caller (handler) is responsible for applying `cookieValue` via
 * Set-Cookie when `fresh` is true.
 */
export async function ensureSession(
  cookieValue: string | undefined | null,
  deps: SessionDeps,
): Promise<EnsureSessionResult> {
  if (cookieValue) {
    try {
      const session = await validateSessionCookie(cookieValue, deps);
      return { session, fresh: false, cookieValue };
    } catch (e) {
      // Any failure mode (tampered, expired, missing row) falls through
      // and we issue a fresh anon session. The browser overwrites the
      // bad cookie.
      if (!(e instanceof AuthError)) throw e;
    }
  }
  const { session, cookieValue: fresh } = await createSession({ userId: null }, deps);
  return { session, fresh: true, cookieValue: fresh };
}

/**
 * Resolve the session and additionally require an authenticated user.
 * Throws AuthError("ANON_FORBIDDEN") if the resolved session is anonymous.
 */
export async function requireAuthenticatedSession(
  cookieValue: string | undefined | null,
  deps: SessionDeps,
): Promise<Session> {
  if (!cookieValue) {
    throw new AuthError("SESSION_INVALID");
  }
  const session = await validateSessionCookie(cookieValue, deps);
  if (session.userId === null) {
    throw new AuthError("ANON_FORBIDDEN");
  }
  return session;
}
