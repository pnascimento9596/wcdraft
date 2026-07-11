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
import {
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "@/lib/auth/csrf";
import {
  buildRuntimeDeps,
  buildMagicLinkDeps,
  clearBootstrapCsrfCookie,
  ensureMutationSession,
  jsonError,
  readRequestCookie,
  setCsrfCookie,
  setSessionCookie,
} from "@/lib/auth/handler-helpers";
import { readClientIp } from "@/lib/http/client-ip";
import { requireJsonObject } from "@/lib/http/bounded-body";
import { AuthError } from "@/lib/auth/errors";
import { isAuthEnabled } from "@/lib/auth/auth-enabled";

interface RequestBody {
  email?: unknown;
  next?: unknown;
}

const MAX_MAGIC_LINK_BODY_BYTES = 2 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let freshSession: { readonly cookieValue: string; readonly csrfSecret: string } | null = null;
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
    const { session, fresh, cookieValue } = await ensureMutationSession(req, deps);
    if (fresh) freshSession = { cookieValue, csrfSecret: session.csrfSecret };
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: session.csrfSecret,
    });

    // 3) Parse + dispatch.
    const body = (await requireJsonObject(req, {
      maxBytes: MAX_MAGIC_LINK_BODY_BYTES,
      allowedContentTypes: ["application/json"],
    })) as RequestBody;
    const email = typeof body?.email === "string" ? body.email : "";
    const next = typeof body?.next === "string" ? body.next : null;
    await requestMagicLink({ email, next, ipAddress: readClientIp(req) }, buildMagicLinkDeps(deps));

    const response = NextResponse.json(
      { ok: true, message: "If the address is valid, a link has been sent." },
      { status: 202 },
    );
    if (fresh) {
      setSessionCookie(response, cookieValue);
      setCsrfCookie(response, session.csrfSecret);
      clearBootstrapCsrfCookie(response);
    }
    return response;
  } catch (err) {
    const response = jsonError(err);
    if (freshSession) {
      setSessionCookie(response, freshSession.cookieValue);
      setCsrfCookie(response, freshSession.csrfSecret);
      clearBootstrapCsrfCookie(response);
    }
    return response;
  }
}
