// Ranked attempt binding.
//
// Ranked runs get their parent seed from the server before draft creation.
// Submit then consumes exactly one unexpired attempt for the signed-in user,
// explicit season id, and full draft config. Casual and Daily never call this.

import { randomBytes as nodeRandomBytes } from "node:crypto";
import { leaderboardEntries, rankedAttempts, type Db, type LeaderboardEntry } from "@wcdraft/db";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import type {
  BoardDraftMode,
  BoardDraftOrder,
  BoardEra,
  BoardRatingBasis,
} from "./config";

export const RANKED_ATTEMPT_TTL_MS = 60 * 60 * 1000;
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
}

export interface CreateRankedAttemptArgs extends RankedAttemptConfig {
  readonly userId: string;
  readonly sessionId: string | null;
}

export interface CreateRankedAttemptDeps {
  readonly now: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
}

export async function createRankedAttempt(
  db: Db,
  args: CreateRankedAttemptArgs,
  deps: CreateRankedAttemptDeps,
): Promise<IssuedRankedAttempt> {
  const nonce = toBase64Url((deps.randomBytes ?? nodeRandomBytes)(24));
  const parentSeed = `${RANKED_SEED_PREFIX}${nonce}`;
  const now = new Date(deps.now());
  const expiresAt = new Date(now.getTime() + RANKED_ATTEMPT_TTL_MS);
  const rows = await db
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
  };
}

export interface ConsumeRankedAttemptArgs extends RankedAttemptConfig {
  readonly userId: string;
  readonly parentSeed: string;
}

export async function consumeRankedAttempt(
  db: Db,
  args: ConsumeRankedAttemptArgs,
  now: () => number,
): Promise<{ id: string } | null> {
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
          AND ${rankedAttempts.issuedParentSeed} = ${args.parentSeed}
          AND ${rankedAttempts.consumedAt} IS NULL
          AND ${rankedAttempts.windowExpiresAt} > ${at}
        ORDER BY ${rankedAttempts.issuedAt} DESC, ${rankedAttempts.id} DESC
        LIMIT 1
     )
     RETURNING id
  `);
  return result.rows[0] ?? null;
}

export async function findExistingRankedAttemptEntry(
  db: Db,
  args: {
    readonly seasonKey: string;
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
