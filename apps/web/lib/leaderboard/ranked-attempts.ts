// Ranked attempt binding.
//
// Ranked runs get their parent seed from the server before draft creation.
// Submit then consumes exactly one unexpired attempt for the signed-in user,
// explicit season id, and full draft config. Casual and Daily never call this.

import { randomBytes as nodeRandomBytes } from "node:crypto";
import {
  leaderboardEntries,
  rankedAttempts,
  users,
  type Db,
  type LeaderboardEntry,
} from "@wcdraft/db";
import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";

import { consumeRateLimit } from "../auth/rate-limit";
import type { BoardDraftMode, BoardDraftOrder, BoardEra, BoardRatingBasis } from "./config";

export const RANKED_ATTEMPT_TTL_MS = 60 * 60 * 1000;
export const RANKED_ATTEMPT_ISSUE_LIMIT = 10;
export const RANKED_ATTEMPT_ISSUE_WINDOW_MS = 60 * 60 * 1000;
export const RANKED_ATTEMPT_SWEEP_LIMIT = 25;
export const RANKED_ATTEMPT_RATE_LIMIT_STORE_RETRY_AFTER_SECONDS = 60;
const RANKED_SEED_PREFIX = "wcdraft:ranked:v1:";

export interface RankedAttemptConfig {
  readonly seasonKey: string;
  readonly formationId: string;
  readonly draftMode: BoardDraftMode;
  readonly draftOrder: BoardDraftOrder;
  readonly era: BoardEra;
  readonly ratingBasis: BoardRatingBasis;
}

export interface IssuedRankedAttempt extends RankedAttemptConfig {
  readonly attemptId: string;
  readonly parentSeed: string;
  readonly expiresAt: Date;
  /** True when issuance returned the existing live attempt without minting. */
  readonly reused: boolean;
}

export interface CreateRankedAttemptArgs extends RankedAttemptConfig {
  readonly userId: string;
  readonly sessionId: string | null;
}

export interface CreateRankedAttemptDeps {
  readonly now: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
  /** Injectable only for deterministic fail-closed route tests. */
  readonly consumeIssueRateLimit?: typeof consumeRateLimit;
}

export class RankedAttemptRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("too many ranked attempt requests");
    this.name = "RankedAttemptRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function createRankedAttempt(
  db: Db,
  args: CreateRankedAttemptArgs,
  deps: CreateRankedAttemptDeps,
): Promise<IssuedRankedAttempt> {
  return db.transaction(async (tx) => {
    // The user row is the stable repository-native serialization boundary.
    // Every config for one account queues here, so two cold requests cannot
    // both observe "no live attempt" and mint different seeds.
    const locked = await tx.execute<{ id: string }>(sql`
      SELECT ${users.id} AS id
        FROM ${users}
       WHERE ${users.id} = ${args.userId}::uuid
       FOR UPDATE
    `);
    if (!locked.rows[0]) throw new Error("ranked attempt user no longer exists");

    const now = new Date(deps.now());
    // Bound every authenticated issuance request, including idempotent reuse.
    // Reuse prevents seed farming; the request cap prevents a live attempt
    // from turning this serialized DB endpoint into an unbounded read path.
    let limit;
    try {
      limit = await (deps.consumeIssueRateLimit ?? consumeRateLimit)(
        {
          bucket: { kind: "ranked-attempt-user-1h", value: args.userId },
          windowMs: RANKED_ATTEMPT_ISSUE_WINDOW_MS,
          maxCount: RANKED_ATTEMPT_ISSUE_LIMIT,
        },
        { db: tx as Db, now: () => now.getTime() },
      );
    } catch (err) {
      console.error("[leaderboard] ranked attempt rate-limit store error — failing CLOSED", err);
      throw new RankedAttemptRateLimitError(RANKED_ATTEMPT_RATE_LIMIT_STORE_RETRY_AFTER_SECONDS);
    }
    if (!limit.allowed) {
      throw new RankedAttemptRateLimitError(limit.retryAfterSeconds ?? 1);
    }

    await sweepExpiredRankedAttempts(tx as Db, args, now);
    const existing = await findLiveRankedAttempt(tx as Db, args, now);
    if (existing !== null) {
      await retireSupersededLiveRankedAttempts(tx as Db, args, now, existing.id);
      return {
        attemptId: existing.id,
        parentSeed: existing.parentSeed,
        expiresAt: existing.expiresAt,
        seasonKey: args.seasonKey,
        formationId: args.formationId,
        draftMode: args.draftMode,
        draftOrder: args.draftOrder,
        era: args.era,
        ratingBasis: args.ratingBasis,
        reused: true,
      };
    }

    const nonce = toBase64Url((deps.randomBytes ?? nodeRandomBytes)(24));
    const parentSeed = `${RANKED_SEED_PREFIX}${nonce}`;
    const expiresAt = new Date(now.getTime() + RANKED_ATTEMPT_TTL_MS);
    const rows = await tx
      .insert(rankedAttempts)
      .values({
        userId: args.userId,
        sessionId: args.sessionId,
        seasonKey: args.seasonKey,
        formationId: args.formationId,
        draftMode: args.draftMode,
        draftOrder: args.draftOrder,
        era: args.era,
        ratingBasis: args.ratingBasis,
        issuedParentSeed: parentSeed,
        nonce,
        issuedAt: now,
        windowExpiresAt: expiresAt,
      })
      .returning({ id: rankedAttempts.id });
    const row = rows[0];
    if (!row) throw new Error("ranked attempt insert returned no row");
    return {
      attemptId: row.id,
      parentSeed,
      expiresAt,
      seasonKey: args.seasonKey,
      formationId: args.formationId,
      draftMode: args.draftMode,
      draftOrder: args.draftOrder,
      era: args.era,
      ratingBasis: args.ratingBasis,
      reused: false,
    };
  });
}

async function findLiveRankedAttempt(
  db: Db,
  args: RankedAttemptConfig & { readonly userId: string },
  now: Date,
): Promise<{ id: string; parentSeed: string; expiresAt: Date } | null> {
  const rows = await db
    .select({
      id: rankedAttempts.id,
      parentSeed: rankedAttempts.issuedParentSeed,
      expiresAt: rankedAttempts.windowExpiresAt,
    })
    .from(rankedAttempts)
    .where(
      and(
        eq(rankedAttempts.userId, args.userId),
        eq(rankedAttempts.seasonKey, args.seasonKey),
        eq(rankedAttempts.formationId, args.formationId),
        eq(rankedAttempts.draftMode, args.draftMode),
        eq(rankedAttempts.draftOrder, args.draftOrder),
        eq(rankedAttempts.era, args.era),
        eq(rankedAttempts.ratingBasis, args.ratingBasis),
        isNull(rankedAttempts.consumedAt),
        gt(rankedAttempts.windowExpiresAt, now),
      ),
    )
    .orderBy(desc(rankedAttempts.issuedAt), desc(rankedAttempts.id))
    .limit(1);
  return rows[0] ?? null;
}

async function sweepExpiredRankedAttempts(
  db: Db,
  args: CreateRankedAttemptArgs,
  now: Date,
): Promise<void> {
  // Scope the lazy sweep to the locked user's indexed issuance history. This
  // cleans expired attempts across configs without a global table scan.
  // Consumed attempts may back durable leaderboard rows and are never swept.
  await db.execute(sql`
    WITH expired AS (
      SELECT ${rankedAttempts.id}
        FROM ${rankedAttempts}
       WHERE ${rankedAttempts.userId} = ${args.userId}::uuid
         AND ${rankedAttempts.consumedAt} IS NULL
         AND ${rankedAttempts.windowExpiresAt} <= ${now}
       ORDER BY ${rankedAttempts.issuedAt}, ${rankedAttempts.id}
       LIMIT ${RANKED_ATTEMPT_SWEEP_LIMIT}
       FOR UPDATE
    )
    DELETE FROM ${rankedAttempts}
     WHERE ${rankedAttempts.id} IN (SELECT id FROM expired)
  `);
}

async function retireSupersededLiveRankedAttempts(
  db: Db,
  args: CreateRankedAttemptArgs,
  now: Date,
  keepId: string,
): Promise<void> {
  // Pre-fix callers could already have an unbounded number of live rows. The
  // user lock makes this exact-config cleanup atomic with canonical selection:
  // delete every other unconsumed live row so the physical one-live invariant
  // is true when issuance returns, not merely enforced logically at submit.
  // The full user/config prefix is indexed; consumed/B3-bound rows are excluded.
  await db.execute(sql`
    DELETE FROM ${rankedAttempts}
     WHERE ${rankedAttempts.userId} = ${args.userId}::uuid
       AND ${rankedAttempts.seasonKey} = ${args.seasonKey}
       AND ${rankedAttempts.formationId} = ${args.formationId}
       AND ${rankedAttempts.draftMode} = ${args.draftMode}
       AND ${rankedAttempts.draftOrder} = ${args.draftOrder}
       AND ${rankedAttempts.era} = ${args.era}
       AND ${rankedAttempts.ratingBasis} = ${args.ratingBasis}
       AND ${rankedAttempts.consumedAt} IS NULL
       AND ${rankedAttempts.windowExpiresAt} > ${now}
       AND ${rankedAttempts.id} <> ${keepId}::uuid
  `);
}

export interface ConsumeRankedAttemptArgs extends RankedAttemptConfig {
  readonly userId: string;
  readonly parentSeed: string;
}

export type RankedAttemptPrecheck =
  | { readonly kind: "duplicate"; readonly row: LeaderboardEntry }
  | { readonly kind: "live" }
  | { readonly kind: "missing" };

export async function precheckRankedAttempt(
  db: Db,
  args: ConsumeRankedAttemptArgs & { readonly token: string },
  now: () => number,
): Promise<RankedAttemptPrecheck> {
  const duplicate = await findExistingRankedAttemptEntry(db, {
    seasonKey: args.seasonKey,
    formationId: args.formationId,
    userId: args.userId,
    token: args.token,
    draftMode: args.draftMode,
    draftOrder: args.draftOrder,
    era: args.era,
    ratingBasis: args.ratingBasis,
  });
  if (duplicate !== null) return { kind: "duplicate", row: duplicate };

  const live = await findLiveRankedAttempt(db, args, new Date(now()));
  return live?.parentSeed === args.parentSeed ? { kind: "live" } : { kind: "missing" };
}

export async function consumeRankedAttempt(
  db: Db,
  args: ConsumeRankedAttemptArgs,
  now: () => number,
): Promise<{ id: string; consumedAt: Date } | null> {
  const at = new Date(now());
  const result = await db.execute<{ id: string }>(sql`
    UPDATE ${rankedAttempts}
       SET consumed_at = ${at}
     WHERE id = (
       SELECT id
         FROM ${rankedAttempts}
        WHERE ${rankedAttempts.userId} = ${args.userId}::uuid
          AND ${rankedAttempts.seasonKey} = ${args.seasonKey}
          AND ${rankedAttempts.formationId} = ${args.formationId}
          AND ${rankedAttempts.draftMode} = ${args.draftMode}
          AND ${rankedAttempts.draftOrder} = ${args.draftOrder}
          AND ${rankedAttempts.era} = ${args.era}
          AND ${rankedAttempts.ratingBasis} = ${args.ratingBasis}
          AND ${rankedAttempts.consumedAt} IS NULL
          AND ${rankedAttempts.windowExpiresAt} > ${at}
        ORDER BY ${rankedAttempts.issuedAt} DESC, ${rankedAttempts.id} DESC
        LIMIT 1
     )
       AND ${rankedAttempts.issuedParentSeed} = ${args.parentSeed}
       AND ${rankedAttempts.consumedAt} IS NULL
     RETURNING id
  `);
  const row = result.rows[0];
  return row ? { id: row.id, consumedAt: at } : null;
}

export async function findExistingRankedAttemptEntry(
  db: Db,
  args: {
    readonly seasonKey: string;
    readonly formationId: string;
    readonly userId: string;
    readonly token: string;
    readonly draftMode: BoardDraftMode;
    readonly draftOrder: BoardDraftOrder;
    readonly era: BoardEra;
    readonly ratingBasis: BoardRatingBasis;
  },
): Promise<LeaderboardEntry | null> {
  const rows = await db
    .select()
    .from(leaderboardEntries)
    .where(
      and(
        eq(leaderboardEntries.challengeType, "season"),
        isNull(leaderboardEntries.challengeDate),
        eq(leaderboardEntries.seasonKey, args.seasonKey),
        eq(leaderboardEntries.mode, "ranked"),
        eq(leaderboardEntries.userId, args.userId),
        eq(leaderboardEntries.token, args.token),
        eq(leaderboardEntries.attemptFormationId, args.formationId),
        eq(leaderboardEntries.draftMode, args.draftMode),
        eq(leaderboardEntries.draftOrder, args.draftOrder),
        eq(leaderboardEntries.era, args.era),
        eq(leaderboardEntries.ratingBasis, args.ratingBasis),
        isNotNull(leaderboardEntries.attemptId),
      ),
    )
    .orderBy(desc(leaderboardEntries.createdAt), desc(leaderboardEntries.id))
    .limit(1);
  return rows[0] ?? null;
}

export function isRankedIssuedSeed(seed: string): boolean {
  return seed.startsWith(RANKED_SEED_PREFIX);
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
