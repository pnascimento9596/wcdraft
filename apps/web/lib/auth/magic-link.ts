// F-2 — magic-link request + verify.
//
// REQUEST flow:
//   1. Validate the email shape (cheap regex; no DNS).
//   2. Rate-limit per email AND per IP. Either bucket exceeded → RATE_LIMITED.
//   3. Generate {token, tokenHash}; insert magic_link_tokens row with the
//      hash (raw token NEVER stored), 15-min TTL.
//   4. Hand the URL to the EmailSender. The handler returns 202 in all
//      cases so a probe can't enumerate registered emails.
//
// VERIFY flow:
//   1. Hash the inbound token; look up the row.
//   2. Reject if missing → TOKEN_UNKNOWN.
//   3. Reject if expires_at <= now → TOKEN_EXPIRED.
//   4. Reject if consumed_at != null → TOKEN_CONSUMED (replay attack).
//   5. Atomically UPDATE consumed_at = now WHERE consumed_at IS NULL; if
//      zero rows updated, raced with another verify → TOKEN_CONSUMED.
//   6. Upsert the users row by email.
//   7. (Caller) create a session bound to that user_id.
import { and, eq, isNull } from "drizzle-orm";
import { magicLinkTokens, users } from "@wcdraft/db";
import type { Db, User } from "@wcdraft/db";
import { AuthError } from "./errors";
import { consumeRateLimit } from "./rate-limit";
import { generateToken, sha256Hex } from "./tokens";
import type { EmailSender } from "./email";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
/** Per-email rate: at most N requests per W minutes. */
export const MAGIC_LINK_RATE_PER_EMAIL = { maxCount: 3, windowMs: 15 * 60 * 1000 };
/** Per-IP rate: at most N requests per W hour. */
export const MAGIC_LINK_RATE_PER_IP = { maxCount: 10, windowMs: 60 * 60 * 1000 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MagicLinkDeps {
  readonly db: Db;
  readonly now: () => number;
  readonly sender: EmailSender;
  /** Base URL the verify link points at (e.g. https://wcdraft.com). */
  readonly verifyBaseUrl: string;
  /** From-address used by the email; LogEmailSender ignores it. */
  readonly fromAddress: string;
}

export interface RequestMagicLinkArgs {
  readonly email: string;
  /** Hashed via rate-limit; raw IP never persisted. */
  readonly ipAddress: string;
}

/** Issue a magic link. Always resolves to "sent" externally; throws only on rate-limit / invalid email. */
export async function requestMagicLink(
  args: RequestMagicLinkArgs,
  deps: MagicLinkDeps,
): Promise<{ tokenHash: string; expiresAt: Date }> {
  const email = args.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new AuthError("EMAIL_INVALID");
  }

  const emailRate = await consumeRateLimit(
    {
      bucket: { kind: "email", value: email },
      windowMs: MAGIC_LINK_RATE_PER_EMAIL.windowMs,
      maxCount: MAGIC_LINK_RATE_PER_EMAIL.maxCount,
    },
    { db: deps.db, now: deps.now },
  );
  if (!emailRate.allowed) {
    throw new AuthError("RATE_LIMITED", "too many requests for this email");
  }
  const ipRate = await consumeRateLimit(
    {
      bucket: { kind: "ip", value: args.ipAddress || "unknown" },
      windowMs: MAGIC_LINK_RATE_PER_IP.windowMs,
      maxCount: MAGIC_LINK_RATE_PER_IP.maxCount,
    },
    { db: deps.db, now: deps.now },
  );
  if (!ipRate.allowed) {
    throw new AuthError("RATE_LIMITED", "too many requests from this address");
  }

  const { token, tokenHash } = generateToken();
  const expiresAt = new Date(deps.now() + MAGIC_LINK_TTL_MS);

  await deps.db.insert(magicLinkTokens).values({
    tokenHash,
    email,
    expiresAt,
  });

  const verifyUrl = new URL("/api/auth/verify", deps.verifyBaseUrl);
  verifyUrl.searchParams.set("token", token);
  await deps.sender.sendMagicLink({
    toEmail: email,
    magicLinkUrl: verifyUrl.toString(),
    fromAddress: deps.fromAddress,
  });

  return { tokenHash, expiresAt };
}

export interface VerifyMagicLinkArgs {
  readonly token: string;
}

export interface VerifyMagicLinkResult {
  readonly user: User;
}

/** Consume a magic-link token. Throws on any rejection reason. */
export async function verifyMagicLink(
  args: VerifyMagicLinkArgs,
  deps: Pick<MagicLinkDeps, "db" | "now">,
): Promise<VerifyMagicLinkResult> {
  if (!args.token || typeof args.token !== "string") {
    throw new AuthError("TOKEN_MALFORMED");
  }
  const tokenHash = sha256Hex(args.token);
  const rows = await deps.db
    .select()
    .from(magicLinkTokens)
    .where(eq(magicLinkTokens.tokenHash, tokenHash));
  const row = rows[0];
  if (!row) {
    throw new AuthError("TOKEN_UNKNOWN");
  }
  if (row.expiresAt.getTime() <= deps.now()) {
    throw new AuthError("TOKEN_EXPIRED");
  }
  if (row.consumedAt !== null) {
    throw new AuthError("TOKEN_CONSUMED");
  }
  // Atomic consume — the WHERE consumed_at IS NULL clause makes a parallel
  // verify race lose, so a replayed-second-tab attack can only burn one
  // attempt.
  const consumed = await deps.db
    .update(magicLinkTokens)
    .set({ consumedAt: new Date(deps.now()) })
    .where(
      and(
        eq(magicLinkTokens.tokenHash, tokenHash),
        isNull(magicLinkTokens.consumedAt),
      ),
    )
    .returning({ tokenHash: magicLinkTokens.tokenHash });
  if (consumed.length === 0) {
    throw new AuthError("TOKEN_CONSUMED", "lost the consume race");
  }

  // Upsert user. The email column is UNIQUE, so a fresh email gets a new
  // row and a returning user gets their existing one. Drizzle 0.36 lacks
  // a fluent upsert returning helper for nullable-unique conflicts; we
  // do select-first, then insert if missing.
  const existing = await deps.db
    .select()
    .from(users)
    .where(eq(users.email, row.email));
  let user = existing[0];
  if (!user) {
    const inserted = await deps.db
      .insert(users)
      .values({ email: row.email })
      .returning();
    user = inserted[0];
  }
  if (!user) {
    throw new Error("verifyMagicLink: failed to materialize user row");
  }
  return { user };
}
