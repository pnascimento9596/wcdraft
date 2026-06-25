// F-3 — server-side helper: resolve AuthContext from the request cookies.
//
// Lives in lib/game (not lib/auth) so the runs route handlers stay
// self-contained for code review; it just wraps `validateSessionCookie`
// + falls through to "no session". A null session means the caller has
// no cookie at all (or the cookie failed HMAC/expiry/DB-lookup); the
// route handler should return 401 in that case (anon session is
// mandatory for /api/runs).
import type { NextRequest } from "next/server";
import { validateSessionCookie } from "@/lib/auth/sessions";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessions";
import { buildRuntimeDeps, readRequestCookie, type RuntimeDeps } from "@/lib/auth/handler-helpers";
import { AuthError } from "@/lib/auth/errors";
import type { AuthContext } from "@/lib/game/saved-runs-store";

export interface ResolvedAuth {
  readonly ctx: AuthContext;
  readonly csrfSecret: string;
  readonly deps: RuntimeDeps;
}

/**
 * Resolve the caller's `AuthContext` + the `RuntimeDeps` from the request.
 * Throws AuthError on any failure; the route handler maps to a 401 JSON.
 *
 * Anon callers (cookie present, user_id null) get
 * `{ userId: null, sessionId }`.
 * Authed callers get `{ userId, sessionId }`.
 * Missing cookie → AuthError("SESSION_INVALID").
 */
export async function resolveAuth(req: NextRequest): Promise<ResolvedAuth> {
  const deps = buildRuntimeDeps();
  const cookie = readRequestCookie(req, SESSION_COOKIE_NAME);
  if (!cookie) {
    throw new AuthError("SESSION_INVALID", "missing session cookie");
  }
  const session = await validateSessionCookie(cookie, deps);
  return {
    deps,
    csrfSecret: session.csrfSecret,
    ctx: { userId: session.userId, sessionId: session.id },
  };
}
