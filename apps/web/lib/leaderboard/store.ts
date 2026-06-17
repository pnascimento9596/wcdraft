// F-4 U3 — leaderboard_entries data access (server-only, thin Drizzle layer).
//
// Board semantics (plan §4): rank by verified_score DESC, created_at ASC
// (first to reach a score ranks first), id ASC for total order; the board
// shows the BEST entry per identity (user_id if claimed, else session_id,
// else the entry's own id for sessionless-anonymous rows); hidden rows
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
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
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

export type BoardMode = BoardLane;
export type BoardDraftMode = ConfigDraftMode;

// ─── Insert (dedupe-aware) ──────────────────────────────────────────────────

export interface AcceptedEntryInsert {
  readonly seasonKey: string;
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
}

export type InsertEntryResult =
  | { readonly kind: "inserted"; readonly row: LeaderboardEntry }
  | { readonly kind: "duplicate"; readonly row: LeaderboardEntry };

/**
 * Insert an ACCEPTED submission, honoring the NULLS-NOT-DISTINCT dedupe
 * constraint `(season_key, mode, user_id, token)`. On conflict the existing
 * row is returned (`kind: "duplicate"`) — the documented best-entry
 * semantics: all distinct accepted runs are retained, an identical token
 * is acknowledged honestly instead of erroring or double-inserting.
 */
export async function insertAcceptedEntry(
  db: Db,
  entry: AcceptedEntryInsert,
  now: () => number,
): Promise<InsertEntryResult> {
  const inserted = await db
    .insert(leaderboardEntries)
    .values({
      seasonKey: entry.seasonKey,
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
      createdAt: new Date(now()),
    })
    .onConflictDoNothing()
    .returning();
  const row = inserted[0];
  if (row) return { kind: "inserted", row };

  // NULLS NOT DISTINCT: the conflicting row is uniquely identified by
  // (season_key, mode, user_id-including-NULL, token).
  const existing = await db
    .select()
    .from(leaderboardEntries)
    .where(
      and(
        eq(leaderboardEntries.seasonKey, entry.seasonKey),
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

// ─── Board page (keyset over best-per-identity) ─────────────────────────────

export interface BoardCursor {
  readonly score: number;
  readonly createdAt: Date;
  readonly id: string;
}

export interface BoardPageQuery {
  readonly seasonKey: string;
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
  display_name: string | null;
  verified_score: number | string;
  score_breakdown: unknown;
  created_at: string | Date;
  rank: number | string;
};

function toBoardRow(r: RawBoardRow): BoardRow {
  const displayName = assertPublicDisplayName(r.display_name, r.id);
  return {
    rank: Number(r.rank),
    id: r.id,
    draft_mode: r.draft_mode,
    draft_order: r.draft_order,
    era: r.era,
    rating_basis: r.rating_basis,
    display_name: displayName,
    verified_score: Number(r.verified_score),
    score_breakdown: r.score_breakdown,
    created_at: new Date(r.created_at),
  };
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
    sql`${leaderboardEntries.seasonKey} = ${q.seasonKey}`,
    sql`${leaderboardEntries.mode} = ${q.mode}`,
    sql`${leaderboardEntries.draftMode} = ${q.draftMode}`,
    sql`${leaderboardEntries.draftOrder} = ${q.draftOrder}`,
    sql`${leaderboardEntries.era} = ${q.era}`,
    sql`${leaderboardEntries.ratingBasis} = ${q.ratingBasis}`,
    sql`${leaderboardEntries.hiddenAt} IS NULL`,
  ];
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
             COALESCE(${leaderboardEntries.displayAlias}, ${users.username}) AS display_name,
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
             ROW_NUMBER() OVER (ORDER BY verified_score DESC, created_at ASC, id ASC) AS rank
        FROM best
    )
    SELECT id, draft_mode, draft_order, era, rating_basis, display_name, verified_score, score_breakdown, created_at, rank
      FROM ranked
      ${cursorPredicate}
     ORDER BY verified_score DESC, created_at ASC, id ASC
     LIMIT ${q.limit + 1}
  `);
  const raw = result.rows;
  const hasMore = raw.length > q.limit;
  return { rows: raw.slice(0, q.limit).map(toBoardRow), hasMore };
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
}

interface IdentityRankQuery {
  readonly seasonKey: string;
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
  }>(sql`
    WITH best AS (
      SELECT DISTINCT ON (${IDENTITY_EXPR})
             ${IDENTITY_EXPR} AS identity, id, verified_score, created_at
        FROM ${leaderboardEntries}
       WHERE season_key = ${q.seasonKey}
         AND mode = ${q.mode}
         AND draft_mode = ${q.draftMode}
         AND draft_order = ${q.draftOrder}
         AND era = ${q.era}
         AND rating_basis = ${q.ratingBasis}
         AND hidden_at IS NULL
       ORDER BY ${IDENTITY_EXPR}, verified_score DESC, created_at ASC, id ASC
    ),
    ranked AS (
      SELECT best.*,
             ROW_NUMBER() OVER (ORDER BY verified_score DESC, created_at ASC, id ASC) AS rank
        FROM best
    )
    SELECT id, verified_score, rank FROM ranked WHERE identity = ${q.identityKey} LIMIT 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    rank: Number(row.rank),
    entryId: row.id,
    verifiedScore: Number(row.verified_score),
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
  const rows = await db
    .select({
      row: leaderboardEntries,
      username: users.username,
    })
    .from(leaderboardEntries)
    .leftJoin(users, eq(users.id, leaderboardEntries.userId))
    .where(
      and(
        eq(leaderboardEntries.seasonKey, q.seasonKey),
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
