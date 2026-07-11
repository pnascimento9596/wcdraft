import { createHmac } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { sessions, type Session } from "@wcdraft/db";

import { verifyCsrfDoubleSubmit } from "./csrf";
import { AuthError } from "./errors";
import { SESSION_TTL_MS, signCookie, type SessionDeps } from "./sessions";
import { base64UrlEncode, generateOpaqueToken, timingSafeStringEqual } from "./tokens";

export const BOOTSTRAP_CSRF_COOKIE_NAME = "wcdraft_bootstrap";
export const BOOTSTRAP_CSRF_TTL_MS = 5 * 60 * 1000;
const VERSION = "b1";

export interface BootstrapCsrf {
  readonly cookieValue: string;
  readonly sessionCookieValue: string;
  readonly csrfSecret: string;
  readonly expiresAt: number;
}

interface ParsedBootstrapCsrf {
  readonly nonce: string;
  readonly csrfSecret: string;
  readonly expiresAt: number;
}

export function createBootstrapCsrf(args: {
  readonly now: number;
  readonly cookieSecret: string;
}): BootstrapCsrf {
  const nonce = generateOpaqueToken();
  const csrfSecret = generateOpaqueToken();
  const expiresAt = args.now + BOOTSTRAP_CSRF_TTL_MS;
  const payload = `${VERSION}.${nonce}.${csrfSecret}.${expiresAt.toString()}`;
  return {
    cookieValue: `${payload}.${sign(payload, args.cookieSecret)}`,
    sessionCookieValue: signCookie(nonce, args.cookieSecret),
    csrfSecret,
    expiresAt,
  };
}

export function verifyBootstrapCsrf(
  value: string | null | undefined,
  args: { readonly now: number; readonly cookieSecret: string },
): ParsedBootstrapCsrf {
  if (!value) throw new AuthError("CSRF_MISSING", "bootstrap cookie missing");
  const parts = value.split(".");
  if (parts.length !== 5) throw new AuthError("CSRF_MISMATCH", "bootstrap shape invalid");
  const [version, nonce, csrfSecret, expiresRaw, suppliedSignature] = parts;
  if (
    version !== VERSION ||
    !nonce ||
    !csrfSecret ||
    !expiresRaw ||
    !suppliedSignature ||
    !/^[A-Za-z0-9_-]{43}$/u.test(nonce) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(csrfSecret)
  ) {
    throw new AuthError("CSRF_MISMATCH", "bootstrap fields invalid");
  }
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= args.now) {
    throw new AuthError("CSRF_MISMATCH", "bootstrap expired");
  }
  const payload = `${version}.${nonce}.${csrfSecret}.${expiresRaw}`;
  if (!timingSafeStringEqual(suppliedSignature, sign(payload, args.cookieSecret))) {
    throw new AuthError("CSRF_MISMATCH", "bootstrap signature invalid");
  }
  return { nonce, csrfSecret, expiresAt };
}

/**
 * Upgrade one signed stateless bootstrap into exactly one durable anonymous
 * session. The bootstrap nonce becomes the opaque session id; concurrent
 * replays converge on the same row, and a replay after promotion/CSRF rotation
 * is rejected instead of minting another session.
 */
export async function materializeBootstrapSession(
  args: {
    readonly bootstrapCookieValue: string | null | undefined;
    readonly csrfCookieValue: string | null | undefined;
    readonly csrfHeaderValue: string | null | undefined;
  },
  deps: SessionDeps,
): Promise<{ session: Session; cookieValue: string }> {
  const parsed = verifyBootstrapCsrf(args.bootstrapCookieValue, {
    now: deps.now(),
    cookieSecret: deps.cookieSecret,
  });
  verifyCsrfDoubleSubmit({
    cookieValue: args.csrfCookieValue,
    headerValue: args.csrfHeaderValue,
    sessionCsrfSecret: parsed.csrfSecret,
  });

  const now = new Date(deps.now());
  const inserted = await deps.db
    .insert(sessions)
    .values({
      id: parsed.nonce,
      userId: null,
      csrfSecret: parsed.csrfSecret,
      createdAt: now,
      expiresAt: new Date(deps.now() + SESSION_TTL_MS),
    })
    .onConflictDoNothing({ target: sessions.id })
    .returning();
  let session = inserted[0];
  if (!session) {
    const existing = await deps.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, parsed.nonce),
          isNull(sessions.userId),
          eq(sessions.csrfSecret, parsed.csrfSecret),
        ),
      )
      .limit(1);
    session = existing[0];
  }
  if (!session || session.expiresAt.getTime() <= deps.now()) {
    throw new AuthError("CSRF_MISMATCH", "bootstrap was already upgraded");
  }
  return { session, cookieValue: signCookie(session.id, deps.cookieSecret) };
}

function sign(payload: string, secret: string): string {
  return base64UrlEncode(createHmac("sha256", secret).update(payload, "utf8").digest());
}
