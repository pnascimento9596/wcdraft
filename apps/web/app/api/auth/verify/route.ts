// F-2 (post-review) — /api/auth/verify, two-step anti-prefetch flow.
//
// GET  — renders a read-only interstitial. Does NOT consume the token.
//        Safe for mail-scanner GET prefetches; the human sees a single
//        "Sign in" button that submits the form.
// POST — the intentional click. Enforces CSRF double-submit + Origin/Host,
//        atomically consumes the token via verifyMagicLink, rotates the
//        existing anon session's user_id (see fixation threat-model
//        comment in lib/auth/verify-flow.ts), and 303 redirects to `next`.
//
// All token / session / CSRF logic lives in lib/auth/verify-flow.ts so the
// tests in lib/auth/__tests__/verify-flow.test.ts can exercise it directly
// without Next.js mocking. This file is the thin Next.js adapter.
import { NextResponse, type NextRequest } from "next/server";
import {
  prepareVerifyInterstitial,
  consumeAndIssueSession,
  safeNextPath,
} from "@/lib/auth/verify-flow";
import { claimAnonRuns } from "@/lib/game/saved-runs-store";
import {
  buildRuntimeDeps,
  jsonError,
  readRequestCookie,
  setCsrfCookie,
  setSessionCookie,
} from "@/lib/auth/handler-helpers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessions";
import { CSRF_COOKIE_NAME } from "@/lib/auth/csrf";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const deps = buildRuntimeDeps();
    const token = req.nextUrl.searchParams.get("token") ?? "";
    // `next` is forwarded into the form unchanged; the POST handler
    // re-runs `safeNextPath` so the final redirect target is what passes
    // the same-origin gate.
    const next = req.nextUrl.searchParams.get("next") ?? "/play";
    const result = await prepareVerifyInterstitial(
      {
        existingSessionCookie: readRequestCookie(req, SESSION_COOKIE_NAME),
        token,
        next,
      },
      deps,
    );
    const response = new NextResponse(result.html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Defence in depth against caches that might cache the interstitial
        // and serve it to a different user (the form embeds a CSRF token
        // tied to a specific session).
        "Cache-Control": "no-store",
      },
    });
    if (result.setSessionCookie) {
      setSessionCookie(response, result.sessionCookieValue);
    }
    // Always (re)set the CSRF cookie so the form's hidden field matches
    // the cookie the browser carries on the POST.
    setCsrfCookie(response, result.csrfSecret);
    return response;
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const deps = buildRuntimeDeps();
    // Forms POST as application/x-www-form-urlencoded by default. NextRequest's
    // .formData() handles both that and multipart/form-data uniformly.
    const form = await req.formData();
    const token = readFormString(form, "token");
    const next = readFormString(form, "next");
    const csrfFromForm = readFormString(form, "csrf");

    const result = await consumeAndIssueSession(
      {
        token,
        next,
        csrfFromForm,
        csrfFromCookie: readRequestCookie(req, CSRF_COOKIE_NAME),
        sessionCookieValue: readRequestCookie(req, SESSION_COOKIE_NAME),
        origin: req.headers.get("origin"),
        referer: req.headers.get("referer"),
        host: req.headers.get("host"),
        // F-3 hook — claim this session's anon saved_runs to the new
        // user. Errors here are caught + logged inside verify-flow; the
        // sign-in never blocks on the claim. POST /api/runs/claim is the
        // retry surface.
        onAuthenticatedSessionReady: async ({ sessionId, userId }) => {
          await claimAnonRuns({ sessionId, userId }, { db: deps.db });
        },
      },
      deps,
    );
    const response = NextResponse.redirect(
      new URL(result.redirectTo, req.url),
      303,
    );
    setSessionCookie(response, result.sessionCookieValue);
    setCsrfCookie(response, result.csrfSecret);
    return response;
  } catch (err) {
    return jsonError(err);
  }
}

function readFormString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

// `safeNextPath` is re-exported here as a convenience to test suites that
// want to assert on the whitelist directly.
export { safeNextPath };
