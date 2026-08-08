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
import { asc, eq, inArray, lte } from "drizzle-orm";
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

/**
 * Indexed, bounded lazy sweep; correctness never depends on it running.
 *
 * Implemented with the query builder (select + delete) rather than a raw CTE
 * through `db.execute`. The CTE path was observed in production to throw an
 * untyped driver error on every `/api/auth/csrf` call (Vercel
 * `AUTH_UNEXPECTED_ERROR` / `error_class: unexpected`), which previously
 * aborted cookie-less bootstrap even though the bootstrap itself is pure
 * crypto and does not need a durable row. The two-step form keeps the same
 * order/limit contract while avoiding the execute/result-shape edge.
 *
 * Batch delete can still fail when a selected session is referenced by a
 * pre-binding ranked `leaderboard_entries` row: `ON DELETE SET NULL` on
 * `session_id` re-validates `leaderboard_entries_ranked_attempt_binding_chk`
 * (NOT VALID only exempts pre-existing rows at constraint-add time; any later
 * UPDATE must satisfy the check). One poisoned id in a multi-id DELETE aborts
 * the whole batch, which historically froze the sweep after the oldest
 * expired session became that historical ranked exception. On batch failure
 * we fall back to per-id deletes so safe expired sessions still reaped.
 */
export async function sweepExpiredSessions(
  deps: Pick<SessionDeps, "db" | "now">,
  limit = 250,
): Promise<number> {
  const boundedLimit = Math.max(1, Math.min(1_000, Math.trunc(limit)));
  const cutoff = new Date(deps.now());
  const expired = await deps.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(lte(sessions.expiresAt, cutoff))
    .orderBy(asc(sessions.expiresAt), asc(sessions.id))
    .limit(boundedLimit);
  if (expired.length === 0) return 0;
  const ids = expired.map((row) => row.id);
  try {
    const deleted = await deps.db
      .delete(sessions)
      .where(inArray(sessions.id, ids))
      .returning({ id: sessions.id });
    return deleted.length;
  } catch {
    // Progress over freeze: one cascade/CHECK failure must not block the rest.
    let deleted = 0;
    for (const id of ids) {
      try {
        const rows = await deps.db
          .delete(sessions)
          .where(eq(sessions.id, id))
          .returning({ id: sessions.id });
        deleted += rows.length;
      } catch {
        // Leave the poisoned session; next sweep will skip it again after
        // selecting it, or succeed if the blocking row is later repaired.
      }
    }
    return deleted;
  }
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
