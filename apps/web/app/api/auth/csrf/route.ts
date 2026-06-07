// F-2 — GET /api/auth/csrf
//
// First call from a fresh client: issues an anonymous session, sets both
// cookies, and returns the csrf token. Subsequent calls return the existing
// session's csrf token. Used to bootstrap the client side of every mutating
// flow (sign-in, sign-out, future F-3/F-4 submissions).
//
// Anonymous-first is the WS-F default; ranked seed binding in F-4 needs a
// session id available even before sign-in.
import { NextResponse, type NextRequest } from "next/server";
import { ensureSession } from "@/lib/auth/anon-session";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import {
  buildRuntimeDeps,
  jsonError,
  readRequestCookie,
  setCsrfCookie,
  setSessionCookie,
} from "@/lib/auth/handler-helpers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessions";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const deps = buildRuntimeDeps();
    const cookie = readRequestCookie(req, SESSION_COOKIE_NAME);
    const { session, fresh, cookieValue } = await ensureSession(cookie, deps);
    const response = NextResponse.json({
      csrfToken: session.csrfSecret,
      csrfCookieName: CSRF_COOKIE_NAME,
      isAuthenticated: session.userId !== null,
    });
    if (fresh) setSessionCookie(response, cookieValue);
    // Always (re)set the csrf cookie so a client that lost it can recover.
    setCsrfCookie(response, session.csrfSecret);
    return response;
  } catch (err) {
    return jsonError(err);
  }
}
