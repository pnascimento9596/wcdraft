// F-2 — /api/auth/session
//
// GET    → current session info {userId, isAnonymous, expiresAt}.
// DELETE → sign-out. Requires CSRF + Origin/Host. Clears cookies.
//
// GET intentionally does NOT mint an anon session — call /api/auth/csrf for
// that. This endpoint reads-or-zero.
//
// F-3.6 (ship-dark hardening) — the anonymous path MUST NOT 500.
//
// In ship-dark prod (auth feature gated off, AUTH_COOKIE_SECRET not yet set
// because go-live hasn't happened) the previous code eagerly called
// buildRuntimeDeps() before the no-cookie check; readCookieSecret() threw,
// jsonError swallowed the non-AuthError, and every page load saw a 500.
//
// New order for GET:
//   1. If `isAuthEnabled()` is false  → 200 {session:null}, no deps built.
//   2. Else if no SESSION cookie       → 200 {session:null}, no deps built.
//   3. Else                            → build deps, validate, return.
//
// DELETE (sign-out): when auth is disabled, return 503 AUTH_DISABLED before
// touching any secret-dependent dep. There is no in-flight session to clear
// when the sign-in UI is dark.
import { NextResponse, type NextRequest } from "next/server";
import { users } from "@wcdraft/db";
import { eq } from "drizzle-orm";
import { validateSessionCookie, deleteSession } from "@/lib/auth/sessions";
import {
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "@/lib/auth/csrf";
import { AuthError } from "@/lib/auth/errors";
import {
  buildRuntimeDeps,
  clearSessionCookie,
  jsonError,
  readRequestCookie,
} from "@/lib/auth/handler-helpers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessions";
import { isAuthEnabled } from "@/lib/auth/auth-enabled";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Ship-dark fast path — the feature is gated off, so there is no
    // session story to tell. Return the same shape the client expects for
    // an anonymous caller and DO NOT touch buildRuntimeDeps (which reads
    // AUTH_COOKIE_SECRET and would throw before go-live).
    if (!isAuthEnabled()) {
      return NextResponse.json({ session: null });
    }
    const cookie = readRequestCookie(req, SESSION_COOKIE_NAME);
    if (!cookie) {
      // No cookie → nothing to validate. Skip dep build entirely so a
      // missing AUTH_COOKIE_SECRET cannot cause a 500 for an anonymous
      // caller even with the feature flag flipped on mid-rollout.
      return NextResponse.json({ session: null });
    }
    const deps = buildRuntimeDeps();
    try {
      const session = await validateSessionCookie(cookie, deps);
      const profile =
        session.userId === null ? null : await readSessionProfile(deps.db, session.userId);
      return NextResponse.json({
        session: {
          userId: session.userId,
          username: profile?.username ?? null,
          emailVerified: profile?.emailVerified ?? false,
          isAnonymous: session.userId === null,
          expiresAt: session.expiresAt.toISOString(),
        },
      });
    } catch (e) {
      if (e instanceof AuthError) {
        return NextResponse.json({ session: null });
      }
      throw e;
    }
  } catch (err) {
    return jsonError(err);
  }
}

async function readSessionProfile(
  db: ReturnType<typeof buildRuntimeDeps>["db"],
  userId: string,
): Promise<{ username: string | null; emailVerified: boolean } | null> {
  const rows = await db
    .select({ username: users.username, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  return row ? { username: row.username, emailVerified: row.emailVerifiedAt !== null } : null;
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    // Ship-dark — refuse the mutation honestly before building deps.
    if (!isAuthEnabled()) {
      throw new AuthError("AUTH_DISABLED", "Auth feature is not enabled.");
    }
    const deps = buildRuntimeDeps();
    verifyOriginHost({
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      host: req.headers.get("host"),
    });
    const cookie = readRequestCookie(req, SESSION_COOKIE_NAME);
    if (!cookie) {
      throw new AuthError("SESSION_INVALID");
    }
    const session = await validateSessionCookie(cookie, deps);
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: session.csrfSecret,
    });
    await deleteSession(session.id, deps);
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (err) {
    return jsonError(err);
  }
}
