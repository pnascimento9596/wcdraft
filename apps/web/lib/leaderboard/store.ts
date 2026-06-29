// F-4 U3 — leaderboard_entries data access (server-only, thin Drizzle layer).
//
// Board semantics (plan §4): rank by verified_score DESC, created_at ASC
// (first to reach a score ranks first), id ASC for total order; the board
// shows the BEST season entry per identity (user_id if claimed, else session_id,
// else the entry's own id for sessionless-anonymous rows). Daily writes already
// collapse each visible player/day/config identity to one best row; hidden rows
// (`hidden_at IS NOT NULL`) never appear. The keyset cursor paginates on the
// exact `leaderboard_entries_top_idx` config filter plus keyset triple
// (verified_score, created_at, id).
//
// created_at is ALWAYS written explicitly from `now()` (millisecond
// precision) instead of relying on the column default: Postgres `now()`
// carries microseconds, which a JSON cursor (ISO-8601, ms) cannot round-trip
// — the cursor row would reappear on the next page. Writing ms-precision
// timestamps makes keyset equality exact end-to-end.
//
// Ranks here are HONEST: every rank is computed by the database in the same
// statement snapshot as the rows it ranks — never client-merged, never
// incremented locally across pages.

import type { ScoreComponent } from "@wcdraft/core";
import { leaderboardEntries, users, type Db, type LeaderboardEntry } from "@wcdraft/db";
import { and, asc, desc, eq, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { LeaderboardChallengeKind } from "../game/daily";
import type {
  BoardDraftMode as ConfigDraftMode,
  BoardDraftOrder,
  BoardEra,
  BoardLane,
  BoardRatingBasis,
} from "./config";

/** `COALESCE(user_id::text, session_id, id::text)` — the board identity. */
const IDENTITY_EXPR = sql.raw(
  "COALESCE(leaderboard_entries.user_id::text, leaderboard_entries.session_id, leaderboard_entries.id::text)",
);
const PUBLIC_NAME_EXPR = sql.raw("COALESCE(leaderboard_entries.display_alias, users.username)");

export type BoardMode = BoardLane;
export type BoardDraftMode = ConfigDraftMode;

// ─── Insert (dedupe-aware) ──────────────────────────────────────────────────

export interface AcceptedEntryInsert {
  readonly seasonKey: string;
  readonly challengeType: LeaderboardChallengeKind;
  readonly challengeDate: string | null;
  readonly ratingVersion: string;
  readonly mode: BoardMode;
  readonly draftMode: BoardDraftMode;
  readonly draftOrder: BoardDraftOrder;
  readonly era: BoardEra;
  readonly ratingBasis: BoardRatingBasis;
  readonly userId: string | null;
  readonly sessionId: string | null;
  readonly displayAlias: string | null;
  readonly token: string;
  readonly verifiedScore: number;
  readonly scoreBreakdown: ScoreComponent[];
  readonly attemptId: string | null;
}

export type InsertEntryResult =
  | { readonly kind: "inserted"; readonly row: LeaderboardEntry }
  | { readonly kind: "updated"; readonly row: LeaderboardEntry }
  | { readonly kind: "duplicate"; readonly row: LeaderboardEntry };

/**
 * Insert an ACCEPTED submission. Season rows honor the partial
 * NULLS-NOT-DISTINCT index `(season_key, mode, user_id, token)` and return the
 * existing row on exact duplicates. Daily rows use one visible best row per
 * identity/date/config so repeated daily attempts improve or duplicate that
 * row instead of appending.
 */
export async function insertAcceptedEntry(
  db: Db,
  entry: AcceptedEntryInsert,
  now: () => number,
): Promise<InsertEntryResult> {
  if (entry.challengeType === "daily") {
    return upsertDailyBestEntry(db, entry, now);
  }
  const inserted = await db
    .insert(leaderboardEntries)
    .values({
      seasonKey: entry.seasonKey,
      challengeType: entry.challengeType,
      challengeDate: entry.challengeDate,
      ratingVersion: entry.ratingVersion,
      mode: entry.mode,
      draftMode: entry.draftMode,
      draftOrder: entry.draftOrder,
      era: entry.era,
      ratingBasis: entry.ratingBasis,
      userId: entry.userId,
      sessionId: entry.sessionId,
      displayAlias: entry.displayAlias,
      token: entry.token,
      verifiedScore: entry.verifiedScore,
      scoreBreakdown: entry.scoreBreakdown,
      attemptId: entry.attemptId,
      createdAt: new Date(now()),
    })
    .onConflictDoNothing()
    .returning();
  const row = inserted[0];
  if (row) return { kind: "inserted", row };

  // Season NULLS NOT DISTINCT: the conflicting row is uniquely identified by
  // (season_key, mode, user_id-including-NULL, token).
  const existing = await db
    .select()
    .from(leaderboardEntries)
    .where(
      and(
        eq(leaderboardEntries.seasonKey, entry.seasonKey),
        eq(leaderboardEntries.challengeType, entry.challengeType),
        eq(leaderboardEntries.mode, entry.mode),
        eq(leaderboardEntries.token, entry.token),
        entry.userId === null
          ? isNull(leaderboardEntries.userId)
          : eq(leaderboardEntries.userId, entry.userId),
      ),
    )
    .limit(1);
  const dup = existing[0];
  if (!dup) {
    // Conflict fired but the row is gone (concurrent moderation delete).
    // Surface honestly as an internal error rather than fabricating state.
    throw new Error("leaderboard_entries conflict with no resolvable duplicate row");
  }
  return { kind: "duplicate", row: dup };
}

async function upsertDailyBestEntry(
  db: Db,
  entry: AcceptedEntryInsert,
  now: () => number,
): Promise<InsertEntryResult> {
  if (entry.challengeDate === null) {
    throw new Error("daily leaderboard insert requires challengeDate");
  }
  const identity = dailyIdentityPredicate(entry);
  const existing = await db
    .select()
    .from(leaderboardEntries)
    .where(
      and(
        eq(leaderboardEntries.challengeType, "daily"),
        eq(leaderboardEntries.challengeDate, entry.challengeDate),
        eq(leaderboardEntries.mode, entry.mode),
        eq(leaderboardEntries.draftMode, entry.draftMode),
        eq(leaderboardEntries.draftOrder, entry.draftOrder),
        eq(leaderboardEntries.era, entry.era),
        eq(leaderboardEntries.ratingBasis, entry.ratingBasis),
        isNull(leaderboardEntries.hiddenAt),
        identity,
      ),
    )
    .orderBy(
      desc(leaderboardEntries.verifiedScore),
      asc(leaderboardEntries.createdAt),
      asc(leaderboardEntries.id),
    )
    .limit(1);
  const best = existing[0];
  if (best && best.verifiedScore >= entry.verifiedScore) {
    return { kind: "duplicate", row: best };
  }
  if (best) {
    const updated = await db
      .update(leaderboardEntries)
      .set({
        seasonKey: entry.seasonKey,
        ratingVersion: entry.ratingVersion,
        displayAlias: entry.displayAlias,
        token: entry.token,
        verifiedScore: entry.verifiedScore,
        scoreBreakdown: entry.scoreBreakdown,
        attemptId: entry.attemptId,
        createdAt: new Date(now()),
      })
      .where(
        and(
          eq(leaderboardEntries.id, best.id),
          lt(leaderboardEntries.verifiedScore, entry.verifiedScore),
        ),
      )
      .returning();
    const row = updated[0];
    if (!row) return upsertDailyBestEntry(db, entry, now);
    return { kind: "updated", row };
  }
  const inserted = await db
    .insert(leaderboardEntries)
    .values({
      seasonKey: entry.seasonKey,
      challengeType: "daily",
      challengeDate: entry.challengeDate,
      ratingVersion: entry.ratingVersion,
      mode: entry.mode,
      draftMode: entry.draftMode,
      draftOrder: entry.draftOrder,
      era: entry.era,
      ratingBasis: entry.ratingBasis,
      userId: entry.userId,
      sessionId: entry.sessionId,
      displayAlias: entry.displayAlias,
      token: entry.token,
      verifiedScore: entry.verifiedScore,
      scoreBreakdown: entry.scoreBreakdown,
      attemptId: entry.attemptId,
      createdAt: new Date(now()),
    })
    .onConflictDoNothing()
    .returning();
  const row = inserted[0];
  if (!row) return upsertDailyBestEntry(db, entry, now);
  return { kind: "inserted", row };
}

function dailyIdentityPredicate(entry: AcceptedEntryInsert): SQL {
  if (entry.userId !== null) return eq(leaderboardEntries.userId, entry.userId);
  if (entry.sessionId !== null) {
    return and(
      isNull(leaderboardEntries.userId),
      eq(leaderboardEntries.sessionId, entry.sessionId),
    )!;
  }
  if (entry.displayAlias !== null) {
    return and(
      isNull(leaderboardEntries.userId),
      isNull(leaderboardEntries.sessionId),
      eq(leaderboardEntries.displayAlias, entry.displayAlias),
    )!;
  }
  throw new Error("daily leaderboard insert requires a user, session, or display alias identity");
}

// ─── Board page (keyset over best-per-identity) ─────────────────────────────

export interface BoardCursor {
  readonly score: number;
  readonly createdAt: Date;
  readonly id: string;
}

export interface BoardPageQuery {
  readonly seasonKey: string;
  readonly challengeType: LeaderboardChallengeKind;
  readonly challengeDate: string | null;
  readonly mode: BoardMode;
  readonly draftMode: BoardDraftMode;
  readonly draftOrder: BoardDraftOrder;
  readonly era: BoardEra;
  readonly ratingBasis: BoardRatingBasis;
  readonly limit: number;
  readonly cursor: BoardCursor | null;
}

export interface BoardRow {
  readonly rank: number;
  readonly id: string;
  readonly draft_mode: BoardDraftMode;
  readonly draft_order: BoardDraftOrder;
  readonly era: BoardEra;
  readonly rating_basis: BoardRatingBasis;
  readonly rating_version: string | null;
  readonly percentile: number | null;
  readonly field_size: number;
  readonly display_name: string;
  readonly verified_score: number;
  readonly score_breakdown: unknown;
  readonly created_at: Date;
}

// Type literal (not interface) so it satisfies drizzle's Record constraint
// on `db.execute<T>` via TS's implicit index signature for literals.
type RawBoardRow = {
  id: string;
  draft_mode: BoardDraftMode;
  draft_order: BoardDraftOrder;
  era: BoardEra;
  rating_basis: BoardRatingBasis;
  rating_version: string | null;
  display_name: string | null;
  verified_score: number | string;
  score_breakdown: unknown;
  created_at: string | Date;
  rank: number | string;
  field_size: number | string;
};

function toBoardRow(r: RawBoardRow): BoardRow {
  const displayName = assertPublicDisplayName(r.display_name, r.id);
  const fieldSize = Number(r.field_size);
  const rank = Number(r.rank);
  return {
    rank,
    id: r.id,
    draft_mode: r.draft_mode,
    draft_order: r.draft_order,
    era: r.era,
    rating_basis: r.rating_basis,
    rating_version: r.rating_version,
    field_size: fieldSize,
    percentile:
      fieldSize > 0 ? Math.max(1, Math.ceil(((fieldSize - rank + 1) / fieldSize) * 100)) : null,
    display_name: displayName,
    verified_score: Number(r.verified_score),
    score_breakdown: r.score_breakdown,
    created_at: new Date(r.created_at),
  };
}

function toBoardRowOrNull(r: RawBoardRow): BoardRow | null {
  try {
    return toBoardRow(r);
  } catch {
    console.warn("[leaderboard] skipping row with no public display name", { entryId: r.id });
    return null;
  }
}

function mapBoardRows(rows: readonly RawBoardRow[]): BoardRow[] {
  const out: BoardRow[] = [];
  for (const row of rows) {
    const mapped = toBoardRowOrNull(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

/**
 * One board page. Returns up to `limit` rows plus `hasMore` (computed by
 * over-fetching one row). Ranks come from a ROW_NUMBER() window over the
 * full deduped board in the same snapshot, so they stay correct across
 * keyset pages without any client-side arithmetic.
 */
export async function boardPage(
  db: Db,
  q: BoardPageQuery,
): Promise<{ rows: BoardRow[]; hasMore: boolean }> {
  const filters: SQL[] = [
    sql`${leaderboardEntries.challengeType} = ${q.challengeType}`,
    sql`${leaderboardEntries.mode} = ${q.mode}`,
    sql`${leaderboardEntries.draftMode} = ${q.draftMode}`,
    sql`${leaderboardEntries.draftOrder} = ${q.draftOrder}`,
    sql`${leaderboardEntries.era} = ${q.era}`,
    sql`${leaderboardEntries.ratingBasis} = ${q.ratingBasis}`,
    sql`${leaderboardEntries.hiddenAt} IS NULL`,
    sql`${PUBLIC_NAME_EXPR} IS NOT NULL`,
  ];
  if (q.challengeType === "daily") {
    filters.push(sql`${leaderboardEntries.challengeDate} = ${q.challengeDate}`);
  } else {
    filters.push(sql`${leaderboardEntries.seasonKey} = ${q.seasonKey}`);
  }
  const cursorPredicate = q.cursor
    ? sql`WHERE verified_score < ${q.cursor.score}
            OR (verified_score = ${q.cursor.score}
                AND (created_at > ${q.cursor.createdAt}
                     OR (created_at = ${q.cursor.createdAt} AND id > ${q.cursor.id}::uuid)))`
    : sql.raw("");
  const result = await db.execute<RawBoardRow>(sql`
    WITH best AS (
      SELECT DISTINCT ON (${IDENTITY_EXPR})
             ${leaderboardEntries.id} AS id,
             ${leaderboardEntries.draftMode} AS draft_mode,
             ${leaderboardEntries.draftOrder} AS draft_order,
             ${leaderboardEntries.era} AS era,
             ${leaderboardEntries.ratingBasis} AS rating_basis,
             ${leaderboardEntries.ratingVersion} AS rating_version,
             ${PUBLIC_NAME_EXPR} AS display_name,
             ${leaderboardEntries.verifiedScore} AS verified_score,
             ${leaderboardEntries.scoreBreakdown} AS score_breakdown,
             ${leaderboardEntries.createdAt} AS created_at
        FROM ${leaderboardEntries}
        LEFT JOIN ${users} ON ${users.id} = ${leaderboardEntries.userId}
       WHERE ${sql.join(filters, sql` AND `)}
       ORDER BY ${IDENTITY_EXPR}, verified_score DESC, created_at ASC, id ASC
    ),
    ranked AS (
      SELECT best.*,
             ROW_NUMBER() OVER (ORDER BY verified_score DESC, created_at ASC, id ASC) AS rank,
             COUNT(*) OVER () AS field_size
        FROM best
    )
    SELECT id, draft_mode, draft_order, era, rating_basis, rating_version, display_name, verified_score, score_breakdown, created_at, rank, field_size
      FROM ranked
      ${cursorPredicate}
     ORDER BY verified_score DESC, created_at ASC, id ASC
     LIMIT ${q.limit + 1}
  `);
  const raw = result.rows;
  const hasMore = raw.length > q.limit;
  return { rows: mapBoardRows(raw.slice(0, q.limit)), hasMore };
}

// ─── Identity rank lookup (submit response + /me) ───────────────────────────

/** The board identity key for an entry's owner triple. */
export function identityKeyFor(
  userId: string | null,
  sessionId: string | null,
  entryId: string,
): string {
  return userId ?? sessionId ?? entryId;
}

export interface IdentityBest {
  readonly rank: number;
  readonly entryId: string;
  readonly verifiedScore: number;
  readonly fieldSize: number;
  readonly percentile: number | null;
}

interface IdentityRankQuery {
  readonly seasonKey: string;
  readonly challengeType: LeaderboardChallengeKind;
  readonly challengeDate: string | null;
  readonly mode: BoardMode;
  readonly draftMode: BoardDraftMode;
  readonly draftOrder: BoardDraftOrder;
  readonly era: BoardEra;
  readonly ratingBasis: BoardRatingBasis;
  readonly identityKey: string;
}

/**
 * The identity's best visible entry and its CURRENT board rank in
 * (season, lane, config) — same-snapshot window. Null when the identity
 * has no visible entry (e.g. all hidden or only present in a different lane).
 */
export async function identityBoardRank(
  db: Db,
  q: IdentityRankQuery,
): Promise<IdentityBest | null> {
  const result = await db.execute<{
    id: string;
    verified_score: number | string;
    rank: number | string;
    field_size: number | string;
  }>(sql`
    WITH best AS (
      SELECT DISTINCT ON (${IDENTITY_EXPR})
             ${IDENTITY_EXPR} AS identity,
             ${leaderboardEntries.id} AS id,
             ${leaderboardEntries.verifiedScore} AS verified_score,
             ${leaderboardEntries.createdAt} AS created_at
        FROM ${leaderboardEntries}
        LEFT JOIN ${users} ON ${users.id} = ${leaderboardEntries.userId}
       WHERE ${leaderboardEntries.challengeType} = ${q.challengeType}
         AND (${q.challengeType} = 'daily' AND ${leaderboardEntries.challengeDate} = ${q.challengeDate}
              OR ${q.challengeType} = 'season' AND ${leaderboardEntries.seasonKey} = ${q.seasonKey})
         AND ${leaderboardEntries.mode} = ${q.mode}
         AND ${leaderboardEntries.draftMode} = ${q.draftMode}
         AND ${leaderboardEntries.draftOrder} = ${q.draftOrder}
         AND ${leaderboardEntries.era} = ${q.era}
         AND ${leaderboardEntries.ratingBasis} = ${q.ratingBasis}
         AND ${leaderboardEntries.hiddenAt} IS NULL
         AND ${PUBLIC_NAME_EXPR} IS NOT NULL
       ORDER BY ${IDENTITY_EXPR}, verified_score DESC, created_at ASC, id ASC
    ),
    ranked AS (
      SELECT best.*,
             ROW_NUMBER() OVER (ORDER BY verified_score DESC, created_at ASC, id ASC) AS rank,
             COUNT(*) OVER () AS field_size
        FROM best
    )
    SELECT id, verified_score, rank, field_size FROM ranked WHERE identity = ${q.identityKey} LIMIT 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  const fieldSize = Number(row.field_size);
  const rank = Number(row.rank);
  return {
    rank,
    entryId: row.id,
    verifiedScore: Number(row.verified_score),
    fieldSize,
    percentile:
      fieldSize > 0 ? Math.max(1, Math.ceil(((fieldSize - rank + 1) / fieldSize) * 100)) : null,
  };
}

// ─── Caller's recent entries (/me) ──────────────────────────────────────────

/**
 * Newest-first visible entries owned by the caller in (season, lane, config).
 * Ownership = user_id when the session is account-bound, else session_id.
 */
export async function recentEntriesFor(
  db: Db,
  q: {
    seasonKey: string;
    challengeType: LeaderboardChallengeKind;
    challengeDate: string | null;
    mode: BoardMode;
    draftMode: BoardDraftMode;
    draftOrder: BoardDraftOrder;
    era: BoardEra;
    ratingBasis: BoardRatingBasis;
    userId: string | null;
    sessionId: string;
    limit: number;
  },
): Promise<ApiLeaderboardEntry[]> {
  const ownership =
    q.userId !== null
      ? eq(leaderboardEntries.userId, q.userId)
      : eq(leaderboardEntries.sessionId, q.sessionId);
  const challengeFilter =
    q.challengeType === "daily"
      ? q.challengeDate === null
        ? sql`false`
        : eq(leaderboardEntries.challengeDate, q.challengeDate)
      : and(
          eq(leaderboardEntries.seasonKey, q.seasonKey),
          isNull(leaderboardEntries.challengeDate),
        );
  const rows = await db
    .select({
      row: leaderboardEntries,
      username: users.username,
    })
    .from(leaderboardEntries)
    .leftJoin(users, eq(users.id, leaderboardEntries.userId))
    .where(
      and(
        eq(leaderboardEntries.challengeType, q.challengeType),
        challengeFilter,
        eq(leaderboardEntries.mode, q.mode),
        eq(leaderboardEntries.draftMode, q.draftMode),
        eq(leaderboardEntries.draftOrder, q.draftOrder),
        eq(leaderboardEntries.era, q.era),
        eq(leaderboardEntries.ratingBasis, q.ratingBasis),
        isNull(leaderboardEntries.hiddenAt),
        ownership,
      ),
    )
    .orderBy(desc(leaderboardEntries.createdAt), desc(leaderboardEntries.id))
    .limit(q.limit);
  return rows.map(({ row, username }) => toApiEntry(row, username));
}

// ─── API shape ──────────────────────────────────────────────────────────────

/** Snake_case wire shape for a full entry (submit response + /me). The raw
 *  token is deliberately NOT echoed — clients already hold their own. */
export interface ApiLeaderboardEntry {
  readonly id: string;
  readonly season_key: string;
  readonly mode: string;
  readonly draft_mode: string;
  readonly draft_order: string | null;
  readonly era: string | null;
  readonly rating_basis: string | null;
  readonly rating_version: string | null;
  readonly display_name: string;
  readonly verified_score: number;
  readonly score_breakdown: unknown;
  readonly created_at: string;
}

export function toApiEntry(row: LeaderboardEntry, username: string | null): ApiLeaderboardEntry {
  return {
    id: row.id,
    season_key: row.seasonKey,
    mode: row.mode,
    draft_mode: row.draftMode,
    draft_order: row.draftOrder,
    era: row.era,
    rating_basis: row.ratingBasis,
    rating_version: row.ratingVersion,
    display_name: publicDisplayName(row, username),
    verified_score: row.verifiedScore,
    score_breakdown: row.scoreBreakdown ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

export async function toApiEntryWithProfile(
  db: Db,
  row: LeaderboardEntry,
): Promise<ApiLeaderboardEntry> {
  if (row.userId === null) return toApiEntry(row, null);
  const profile = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  return toApiEntry(row, profile[0]?.username ?? null);
}

function publicDisplayName(row: LeaderboardEntry, username: string | null): string {
  return assertPublicDisplayName(row.displayAlias ?? username, row.id);
}

function assertPublicDisplayName(value: string | null, entryId: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`leaderboard entry ${entryId} has no public username or alias`);
}
