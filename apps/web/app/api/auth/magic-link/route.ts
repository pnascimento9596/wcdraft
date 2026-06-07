// F-2 — POST /api/auth/magic-link
//
// Body: { email }. CSRF + Origin/Host required even though the magic-link
// request itself is anonymous: a CSRF on this endpoint protects against an
// attacker forcing a victim's browser to spam itself with magic links.
//
// Always returns 202 on success — no leak of "is email registered?". An
// invalid email shape (clearly malformed) returns 400.
//
// Rate limits (per email AND per IP) are applied inside requestMagicLink.
import { NextResponse, type NextRequest } from "next/server";
import { requestMagicLink } from "@/lib/auth/magic-link";
import { ensureSession } from "@/lib/auth/anon-session";
import { verifyCsrfDoubleSubmit, verifyOriginHost, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/auth/csrf";
import {
  buildRuntimeDeps,
  buildMagicLinkDeps,
  jsonError,
  readClientIp,
  readRequestCookie,
  setCsrfCookie,
  setSessionCookie,
} from "@/lib/auth/handler-helpers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessions";
import { AuthError } from "@/lib/auth/errors";
import { isAuthEnabled } from "@/lib/auth/auth-enabled";

interface RequestBody {
  email?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // F-3.6 ship-dark gate — refuse before building secret-dependent deps.
    // The sign-in UI is hidden in this mode, but a directly-POSTed payload
    // would otherwise crash with INTERNAL_ERROR on missing AUTH_COOKIE_SECRET
    // or send a real email via a misconfigured sender.
    if (!isAuthEnabled()) {
      throw new AuthError("AUTH_DISABLED", "Auth feature is not enabled.");
    }
    const deps = buildRuntimeDeps();

    // 1) Origin/Host first — cheap, catches drive-by mutations.
    verifyOriginHost({
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      host: req.headers.get("host"),
    });

    // 2) Resolve / ensure session, then CSRF double-submit check.
    const cookieRaw = readRequestCookie(req, SESSION_COOKIE_NAME);
    const { session, fresh, cookieValue } = await ensureSession(cookieRaw, deps);
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: session.csrfSecret,
    });

    // 3) Parse + dispatch.
    const body = (await req.json().catch(() => null)) as RequestBody | null;
    const email = typeof body?.email === "string" ? body.email : "";
    await requestMagicLink(
      { email, ipAddress: readClientIp(req) },
      buildMagicLinkDeps(deps),
    );

    const response = NextResponse.json(
      { ok: true, message: "If the address is valid, a link has been sent." },
      { status: 202 },
    );
    if (fresh) {
      setSessionCookie(response, cookieValue);
      setCsrfCookie(response, session.csrfSecret);
    }
    return response;
  } catch (err) {
    return jsonError(err);
  }
}
