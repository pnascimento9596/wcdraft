// F-2 — session create / validate / sign.
//
// Storage: opaque session id (base64url, 256 bits of entropy) lives in the
// `sessions` table along with a per-session csrf_secret + tz-aware expiry.
//
// Transport: a SIGNED cookie wraps the session id with HMAC-SHA256 over an
// app-wide AUTH_COOKIE_SECRET:
//
//     wcdraft_sid = <sessionId>.<hmacB64Url>
//
// Validation does (in order):
//   1. Split + length-check the cookie format. Anything off → SESSION_TAMPERED.
//   2. Recompute the HMAC over the parsed sessionId; timing-safe compare to
//      the provided one. Mismatch → SESSION_TAMPERED.
//   3. Look up the row in `sessions`. Missing → SESSION_INVALID.
//   4. Compare expires_at to now. Past → SESSION_EXPIRED.
//
// The DB round-trip on every authenticated request is intentional: a
// deleted session row revokes everywhere immediately. F-2 deals only with
// the engagement/retention layer; the cost is acceptable.
import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { sessions } from "@wcdraft/db";
import type { Db, Session } from "@wcdraft/db";
import { AuthError } from "./errors";
import { base64UrlEncode, generateOpaqueToken, timingSafeStringEqual } from "./tokens";

export const SESSION_COOKIE_NAME = "wcdraft_sid";
/** Active session lifetime (30 days). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionDeps {
  readonly db: Db;
  readonly now: () => number;
  readonly cookieSecret: string;
}

/** Create a fresh session row. `userId` may be null for anonymous sessions. */
export async function createSession(
  args: { userId: string | null; ttlMs?: number },
  deps: SessionDeps,
): Promise<{ session: Session; cookieValue: string }> {
  const id = generateOpaqueToken();
  const csrfSecret = generateOpaqueToken();
  const now = new Date(deps.now());
  const expiresAt = new Date(deps.now() + (args.ttlMs ?? SESSION_TTL_MS));
  const inserted = await deps.db
    .insert(sessions)
    .values({
      id,
      userId: args.userId,
      csrfSecret,
      createdAt: now,
      expiresAt,
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("createSession: INSERT did not return a row");
  }
  return { session: row, cookieValue: signCookie(row.id, deps.cookieSecret) };
}

/**
 * Verify a session cookie + return the live session row. Throws AuthError
 * with the most specific code we can produce, so handlers can clear the
 * cookie + return 401 with a discriminating reason.
 */
export async function validateSessionCookie(
  cookieValue: string | undefined | null,
  deps: SessionDeps,
): Promise<Session> {
  if (!cookieValue) {
    throw new AuthError("SESSION_INVALID", "missing session cookie");
  }
  const parsed = parseSignedCookie(cookieValue);
  if (!parsed) {
    throw new AuthError("SESSION_TAMPERED", "cookie format invalid");
  }
  const expected = sign(parsed.payload, deps.cookieSecret);
  if (!timingSafeStringEqual(parsed.sig, expected)) {
    throw new AuthError("SESSION_TAMPERED", "signature mismatch");
  }
  const rows = await deps.db.select().from(sessions).where(eq(sessions.id, parsed.payload));
  const row = rows[0];
  if (!row) {
    throw new AuthError("SESSION_INVALID", "session row missing");
  }
  if (row.expiresAt.getTime() <= deps.now()) {
    throw new AuthError("SESSION_EXPIRED", "session expired");
  }
  return row;
}

/** Delete a session row (sign-out). Idempotent. */
export async function deleteSession(sessionId: string, deps: SessionDeps): Promise<void> {
  await deps.db.delete(sessions).where(eq(sessions.id, sessionId));
}

// ── Cookie signing helpers ─────────────────────────────────────────────────
//
// Exported only for the unit tests; route handlers use signCookie /
// parseSignedCookie indirectly via {create,validateSession}Cookie.

export function signCookie(sessionId: string, secret: string): string {
  return `${sessionId}.${sign(sessionId, secret)}`;
}

export function parseSignedCookie(cookieValue: string): { payload: string; sig: string } | null {
  // Exactly one '.' splits payload from sig.
  const dot = cookieValue.indexOf(".");
  if (dot < 1 || dot === cookieValue.length - 1) return null;
  const payload = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!payload || !sig) return null;
  // Payload is the opaque session id (43 char base64url).
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(sig)) {
    return null;
  }
  return { payload, sig };
}

function sign(payload: string, secret: string): string {
  return base64UrlEncode(createHmac("sha256", secret).update(payload, "utf8").digest());
}

/**
 * Generate a cryptographically strong cookie secret (32 random bytes).
 * Used by a future install script; documented in .env.example.
 */
export function generateCookieSecret(): string {
  return base64UrlEncode(randomBytes(32));
}
