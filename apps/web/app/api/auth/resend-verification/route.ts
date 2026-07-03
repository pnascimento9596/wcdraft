import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { users } from "@wcdraft/db";

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
} from "@/lib/auth/handler-helpers";
import { requestMagicLink } from "@/lib/auth/magic-link";
import { SESSION_COOKIE_NAME, validateSessionCookie } from "@/lib/auth/sessions";
import { readClientIp } from "@/lib/http/client-ip";

export const runtime = "nodejs";

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
    const session = await validateSessionCookie(readRequestCookie(req, SESSION_COOKIE_NAME), deps);
    if (session.userId === null) {
      throw new AuthError("SESSION_INVALID", "verification email requires sign-in");
    }
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: session.csrfSecret,
    });

    const rows = await deps.db
      .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    const user = rows[0];
    if (!user?.email) {
      throw new AuthError("SESSION_INVALID", "user row missing");
    }
    if (user.emailVerifiedAt === null) {
      await requestMagicLink(
        {
          email: user.email,
          next: "/account?verify=sent",
          ipAddress: readClientIp(req),
          purpose: "verification",
        },
        buildMagicLinkDeps(deps),
      );
    }

    return NextResponse.json(
      { ok: true, message: "If verification is still needed, a link has been sent." },
      { status: 202 },
    );
  } catch (err) {
    return jsonError(err);
  }
}
