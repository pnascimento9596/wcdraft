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
import { isRequestTimeoutError } from "@wcdraft/data/client";
import { AuthError } from "./errors";
import { consumeRateLimit } from "./rate-limit";
import { generateToken, sha256Hex } from "./tokens";
import { RESEND_TIMEOUT_MS, type EmailSender } from "./email";
import { safeNextPath } from "./safe-next-path";
import { createCorrelationId, logSecurityEvent } from "./security-log";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
/** Per-email rate: at most N requests per W minutes. */
export const MAGIC_LINK_RATE_PER_EMAIL = { maxCount: 3, windowMs: 15 * 60 * 1000 };
/** Per-IP rate: at most N requests per W hour. */
export const MAGIC_LINK_RATE_PER_IP = { maxCount: 10, windowMs: 60 * 60 * 1000 };
/** Longer than the provider deadline so eligible and ineligible requests share a response target. */
export const PASSWORD_RESET_RESPONSE_TARGET_MS = RESEND_TIMEOUT_MS + 500;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MagicLinkDeps {
  readonly db: Db;
  readonly now: () => number;
  readonly sender: EmailSender;
  /** Base URL the verify link points at (e.g. https://wcdraft.com). */
  readonly verifyBaseUrl: string;
  /** From-address used by the email; LogEmailSender ignores it. */
  readonly fromAddress: string;
  /** Test seam; production uses PASSWORD_RESET_RESPONSE_TARGET_MS. */
  readonly passwordResetResponseTargetMs?: number;
}

export interface RequestMagicLinkArgs {
  readonly email: string;
  readonly next?: string | null;
  /** Hashed via rate-limit; raw IP never persisted. */
  readonly ipAddress: string;
  readonly purpose?: "signin" | "verification" | "reset";
}

export function buildMagicLinkVerifyUrl(args: {
  readonly token: string;
  readonly verifyBaseUrl: string;
  readonly next?: string | null;
  readonly nodeEnv?: string;
}): string {
  let verifyUrl: URL;
  try {
    verifyUrl = new URL("/api/auth/verify", args.verifyBaseUrl);
  } catch {
    throw new AuthError("SECRET_MISCONFIGURED", "AUTH_BASE_URL is not a valid absolute URL.");
  }
  verifyUrl.searchParams.set("token", args.token);
  const next = safeNextPath(args.next);
  if (next !== "/play") {
    verifyUrl.searchParams.set("next", next);
  }

  if ((args.nodeEnv ?? process.env.NODE_ENV) === "production") {
    const hostname = verifyUrl.hostname.toLowerCase();
    const isLocalHost =
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("127.");
    if (verifyUrl.protocol !== "https:" || isLocalHost) {
      throw new AuthError(
        "SECRET_MISCONFIGURED",
        "AUTH_BASE_URL must produce an https non-localhost verify URL in production.",
      );
    }
  }

  return verifyUrl.toString();
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

  const { token, tokenHash } = generateToken();
  const magicLinkUrl = buildMagicLinkVerifyUrl({
    token,
    verifyBaseUrl: deps.verifyBaseUrl,
    next: args.next,
  });

  await consumeMagicLinkQuotas(email, args.ipAddress, deps);

  const expiresAt = new Date(deps.now() + MAGIC_LINK_TTL_MS);
  const purpose = args.purpose ?? "signin";
  const correlationId = createCorrelationId();

  await deps.db.insert(magicLinkTokens).values({
    tokenHash,
    email,
    purpose,
    deliveryStatus: "pending",
    deliveryAttemptedAt: new Date(deps.now()),
    deliveryCorrelationId: correlationId,
    expiresAt,
  });

  try {
    await deps.sender.sendMagicLink({
      toEmail: email,
      magicLinkUrl,
      fromAddress: deps.fromAddress,
      purpose,
    });
  } catch (error) {
    // A token the user never received is not a valid outstanding sign-in.
    try {
      await deps.db.delete(magicLinkTokens).where(eq(magicLinkTokens.tokenHash, tokenHash));
    } catch (bookkeepingError) {
      logSecurityEvent({
        code: "AUTH_EMAIL_BOOKKEEPING_FAILED",
        correlationId,
        error: bookkeepingError,
      });
    }
    logSecurityEvent({ code: "AUTH_EMAIL_DELIVERY_FAILED", correlationId, error });
    throw error;
  }

  // Delivery succeeded. A bookkeeping outage must not invalidate the token the
  // user already received or turn a successful provider call into an error.
  try {
    await deps.db
      .update(magicLinkTokens)
      .set({ deliveryStatus: "delivered" })
      .where(eq(magicLinkTokens.tokenHash, tokenHash));
  } catch (error) {
    logSecurityEvent({ code: "AUTH_EMAIL_BOOKKEEPING_FAILED", correlationId, error });
  }

  return { tokenHash, expiresAt };
}

export async function requestPasswordResetMagicLink(
  args: RequestMagicLinkArgs,
  deps: MagicLinkDeps,
): Promise<{
  eligible: boolean;
  requested: boolean;
  delivered: boolean;
  tokenHash: string;
  expiresAt: Date;
}> {
  const responseStartedAt = performance.now();
  const email = args.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new AuthError("EMAIL_INVALID");
  }

  await consumeMagicLinkQuotas(email, args.ipAddress, deps);

  const existing = await deps.db.select({ id: users.id }).from(users).where(eq(users.email, email));
  const userId = existing[0]?.id ?? null;

  const { token, tokenHash } = generateToken();
  const magicLinkUrl = buildMagicLinkVerifyUrl({
    token,
    verifyBaseUrl: deps.verifyBaseUrl,
    next: args.next,
  });
  const expiresAt = new Date(deps.now() + MAGIC_LINK_TTL_MS);
  const correlationId = createCorrelationId();
  await deps.db.insert(magicLinkTokens).values({
    tokenHash,
    email,
    userId,
    purpose: "reset",
    deliveryStatus: userId === null ? "not_eligible" : "pending",
    deliveryAttemptedAt: userId === null ? null : new Date(deps.now()),
    deliveryCorrelationId: correlationId,
    expiresAt,
  });
  let delivered = false;
  if (userId !== null) {
    let deliveryStatus: "delivered" | "failed" | "unknown";
    try {
      await deps.sender.sendMagicLink({
        toEmail: email,
        magicLinkUrl,
        fromAddress: deps.fromAddress,
        purpose: "reset",
      });
      delivered = true;
      deliveryStatus = "delivered";
    } catch (error) {
      deliveryStatus = isRequestTimeoutError(error) ? "unknown" : "failed";
      logSecurityEvent({ code: "AUTH_EMAIL_DELIVERY_FAILED", correlationId, error });
    }
    try {
      await deps.db
        .update(magicLinkTokens)
        .set({ deliveryStatus })
        .where(eq(magicLinkTokens.tokenHash, tokenHash));
    } catch (error) {
      logSecurityEvent({ code: "AUTH_EMAIL_BOOKKEEPING_FAILED", correlationId, error });
    }
  }
  await waitForPasswordResetTarget(
    responseStartedAt,
    deps.passwordResetResponseTargetMs ?? PASSWORD_RESET_RESPONSE_TARGET_MS,
  );
  return {
    eligible: userId !== null,
    requested: userId !== null,
    delivered,
    tokenHash,
    expiresAt,
  };
}

async function waitForPasswordResetTarget(
  responseStartedAt: number,
  targetMs: number,
): Promise<void> {
  const remaining = targetMs - (performance.now() - responseStartedAt);
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, remaining));
}

async function consumeMagicLinkQuotas(
  email: string,
  ipAddress: string,
  deps: Pick<MagicLinkDeps, "db" | "now">,
): Promise<void> {
  const outcome = await deps.db.transaction(async (tx) => {
    // Coarse source quota is always consumed first. A blocked source returns
    // before the identifier bucket is touched, preventing target poisoning.
    const ipRate = await consumeRateLimit(
      {
        bucket: { kind: "ip", value: ipAddress || "unknown" },
        windowMs: MAGIC_LINK_RATE_PER_IP.windowMs,
        maxCount: MAGIC_LINK_RATE_PER_IP.maxCount,
      },
      { db: tx, now: deps.now },
    );
    if (!ipRate.allowed) return { ipRate, emailRate: null };
    const emailRate = await consumeRateLimit(
      {
        bucket: { kind: "email", value: email },
        windowMs: MAGIC_LINK_RATE_PER_EMAIL.windowMs,
        maxCount: MAGIC_LINK_RATE_PER_EMAIL.maxCount,
      },
      { db: tx, now: deps.now },
    );
    return { ipRate, emailRate };
  });
  if (!outcome.ipRate.allowed) {
    throw new AuthError("RATE_LIMITED", "too many requests from this address");
  }
  if (!outcome.emailRate?.allowed) {
    throw new AuthError("RATE_LIMITED", "too many requests for this email");
  }
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
    .where(and(eq(magicLinkTokens.tokenHash, tokenHash), isNull(magicLinkTokens.consumedAt)))
    .returning({ tokenHash: magicLinkTokens.tokenHash });
  if (consumed.length === 0) {
    throw new AuthError("TOKEN_CONSUMED", "lost the consume race");
  }

  // Upsert user. The email column is UNIQUE, so a fresh email gets a new
  // row and a returning user gets their existing one. Drizzle 0.36 lacks
  // a fluent upsert returning helper for nullable-unique conflicts; we
  // do select-first, then insert if missing.
  const verifiedAt = new Date(deps.now());
  const existing = await deps.db.select().from(users).where(eq(users.email, row.email));
  let user = existing[0];
  if (!user) {
    const inserted = await deps.db
      .insert(users)
      .values({ email: row.email, emailVerifiedAt: verifiedAt })
      .returning();
    user = inserted[0];
  } else if (user.emailVerifiedAt === null) {
    const updated = await deps.db
      .update(users)
      .set({ emailVerifiedAt: verifiedAt })
      .where(eq(users.id, user.id))
      .returning();
    user = updated[0] ?? user;
  }
  if (!user) {
    throw new Error("verifyMagicLink: failed to materialize user row");
  }
  return { user };
}
