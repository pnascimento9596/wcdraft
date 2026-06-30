import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { users } from "@wcdraft/db";

import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  verifyCsrfDoubleSubmit,
  verifyOriginHost,
} from "@/lib/auth/csrf";
import { AuthError } from "@/lib/auth/errors";
import { buildRuntimeDeps, jsonError, readRequestCookie } from "@/lib/auth/handler-helpers";
import { SESSION_COOKIE_NAME, validateSessionCookie } from "@/lib/auth/sessions";
import { hashPassword, validatePasswordStrength, verifyPasswordHash } from "@/lib/auth/passwords";
import { RECENT_MAGIC_COOKIE_NAME, verifyRecentMagicCookieValue } from "@/lib/auth/recent-magic";
import { requireJsonObject } from "@/lib/http/bounded-body";

export const runtime = "nodejs";

interface RequestBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

const MAX_PASSWORD_BODY_BYTES = 4 * 1024;

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const deps = buildRuntimeDeps();
    verifyOriginHost({
      origin: req.headers.get("origin"),
      referer: req.headers.get("referer"),
      host: req.headers.get("host"),
    });
    const session = await validateSessionCookie(readRequestCookie(req, SESSION_COOKIE_NAME), deps);
    if (session.userId === null) {
      throw new AuthError("ANON_FORBIDDEN", "password changes require sign-in");
    }
    verifyCsrfDoubleSubmit({
      cookieValue: readRequestCookie(req, CSRF_COOKIE_NAME),
      headerValue: req.headers.get(CSRF_HEADER_NAME),
      sessionCsrfSecret: session.csrfSecret,
    });

    const body = (await requireJsonObject(req, {
      maxBytes: MAX_PASSWORD_BODY_BYTES,
      allowedContentTypes: ["application/json"],
    })) as RequestBody;
    const rows = await deps.db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    const user = rows[0];
    if (!user) throw new AuthError("SESSION_INVALID", "user row missing");

    const strength = validatePasswordStrength(body.newPassword, user.email ?? undefined);
    if (strength !== null) {
      throw new AuthError("PASSWORD_WEAK", strength);
    }
    const newPassword = body.newPassword as string;
    const recentMagic = verifyRecentMagicCookieValue(
      readRequestCookie(req, RECENT_MAGIC_COOKIE_NAME),
      {
        sessionId: session.id,
        userId: session.userId,
        now: deps.now(),
        cookieSecret: deps.cookieSecret,
      },
    );
    const currentPasswordOk =
      typeof body.currentPassword === "string" && body.currentPassword.length > 0
        ? await verifyPasswordHash(user.passwordHash, body.currentPassword)
        : false;
    const needsProof = user.passwordHash !== null;
    if (needsProof ? !currentPasswordOk && !recentMagic : !recentMagic) {
      throw new AuthError(
        "INVALID_CREDENTIALS",
        "Current password did not match, or the magic-link window expired.",
      );
    }

    const passwordHash = await hashPassword(newPassword);
    await deps.db
      .update(users)
      .set({ passwordHash, passwordSetAt: new Date(deps.now()) })
      .where(eq(users.id, session.userId));
    return NextResponse.json({ ok: true, hasPassword: true });
  } catch (err) {
    return jsonError(err);
  }
}
