import { NextResponse, type NextRequest } from "next/server";

import { ensureSession } from "@/lib/auth/anon-session";
import { isAuthEnabled } from "@/lib/auth/auth-enabled";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
} from "@/lib/auth/csrf";
import { AuthError } from "@/lib/auth/errors";
import {
  buildMagicLinkDeps,
  buildRuntimeDeps,
  jsonError,
  readRequestCookie,
  setCsrfCookie,
  setSessionCookie,
} from "@/lib/auth/handler-helpers";
import { requestPasswordResetMagicLink } from "@/lib/auth/magic-link";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessions";
import { readClientIp } from "@/lib/http/client-ip";
import { requireJsonObject } from "@/lib/http/bounded-body";

export const runtime = "nodejs";

interface RequestBody {
  email?: unknown;
}

const MAX_RESET_BODY_BYTES = 2 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    if (!isAuthEnabled()) {
      throw new AuthError("AUTH_DISABLED", "Auth feature is not enabled.");
    }
    const deps = buildRuntimeDeps();
    verifyOriginHost({
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      host: req.headers.get("host"),
    });
    const cookieRaw = readRequestCookie(req, SESSION_COOKIE_NAME);
    const { session, fresh, cookieValue } = await ensureSession(cookieRaw, deps);
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: session.csrfSecret,
    });

    const body = (await requireJsonObject(req, {
      maxBytes: MAX_RESET_BODY_BYTES,
      allowedContentTypes: ["application/json"],
    })) as RequestBody;
    const email = typeof body.email === "string" ? body.email : "";
    await requestPasswordResetMagicLink(
      {
        email,
        next: "/account?set_new_password=1",
        ipAddress: readClientIp(req),
        purpose: "reset",
      },
      buildMagicLinkDeps(deps),
    );

    const response = NextResponse.json(
      { ok: true, message: "If the address has an account, a reset link has been sent." },
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
