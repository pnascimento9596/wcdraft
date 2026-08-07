// F-2 — GET /api/auth/csrf
//
// First call from a fresh client: issues a signed five-minute bootstrap (or
// returns an existing durable session's csrf token). Used to bootstrap the
// client side of every mutating flow (sign-in, sign-out, F-3/F-4 submissions).
//
// Cookie-less reads do NOT mint a durable 30-day session. The bootstrap is pure
// crypto; a durable row is created only on the first protected mutation that
// upgrades the nonce exactly once.
//
// Anonymous-first is the WS-F default; ranked seed binding in F-4 needs a
// session id available even before sign-in.
import { NextResponse, type NextRequest } from "next/server";
import { BOOTSTRAP_CSRF_TTL_MS, createBootstrapCsrf } from "@/lib/auth/bootstrap-csrf";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";
import { AuthError } from "@/lib/auth/errors";
import {
  buildRuntimeDeps,
  jsonError,
  readRequestCookie,
  setBootstrapCsrfCookie,
  setCsrfCookie,
  setSessionCookie,
} from "@/lib/auth/handler-helpers";
import { createCorrelationId, logSecurityEvent } from "@/lib/auth/security-log";
import {
  SESSION_COOKIE_NAME,
  sweepExpiredSessions,
  validateSessionCookie,
} from "@/lib/auth/sessions";

// Explicit node runtime: cookie signing + Neon pool require Node, not Edge.
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const deps = buildRuntimeDeps();
    const cookie = readRequestCookie(req, SESSION_COOKIE_NAME);

    // Lazy expiry sweep is best-effort. Correctness never depends on it, and a
    // substrate blip (or a driver error on the sweep statement) must not abort
    // cookie-less bootstrap minting — that path is pure crypto and issues no
    // durable session row.
    try {
      await sweepExpiredSessions(deps);
    } catch (sweepError) {
      logSecurityEvent({
        code: "AUTH_UNEXPECTED_ERROR",
        correlationId: createCorrelationId(),
        error: sweepError,
      });
    }

    if (cookie) {
      try {
        const session = await validateSessionCookie(cookie, deps);
        const response = NextResponse.json({
          csrfToken: session.csrfSecret,
          csrfCookieName: CSRF_COOKIE_NAME,
          isAuthenticated: session.userId !== null,
        });
        setCsrfCookie(response, session.csrfSecret);
        return response;
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
      }
    }

    // Cookie-less callers receive a signed, short-lived bootstrap. No durable
    // session row exists until the browser dispatches its first real mutation.
    const bootstrap = createBootstrapCsrf({
      now: deps.now(),
      cookieSecret: deps.cookieSecret,
    });
    const response = NextResponse.json({
      csrfToken: bootstrap.csrfSecret,
      csrfCookieName: CSRF_COOKIE_NAME,
      isAuthenticated: false,
    });
    setBootstrapCsrfCookie(response, bootstrap.cookieValue);
    setSessionCookie(response, bootstrap.sessionCookieValue, BOOTSTRAP_CSRF_TTL_MS / 1000);
    setCsrfCookie(response, bootstrap.csrfSecret, BOOTSTRAP_CSRF_TTL_MS / 1000);
    return response;
  } catch (err) {
    return jsonError(err);
  }
}
