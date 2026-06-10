// F-4 U3 — leaderboard_entries data access (server-only, thin Drizzle layer).
//
// Board semantics (plan §4): rank by verified_score DESC, created_at ASC
// (first to reach a score ranks first), id ASC for total order; the board
// shows the BEST entry per identity (user_id if claimed, else session_id,
// else the entry's own id for sessionless-anonymous rows); hidden rows
// (`hidden_at IS NOT NULL`) never appear. The keyset cursor paginates on the
// exact `leaderboard_entries_top_idx` triple (verified_score, created_at,
// id) — migration 0004.
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
import { leaderboardEntries, type Db, type LeaderboardEntry } from "@wcdraft/db";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";

/** `COALESCE(user_id::text, session_id, id::text)` — the board identity. */
const IDENTITY_EXPR = sql.raw("COALESCE(user_id::text, session_id, id::text)");

export type BoardMode = "casual" | "ranked";
export type BoardDraftMode = "classic" | "hidden";

// ─── Insert (dedupe-aware) ──────────────────────────────────────────────────

export interface AcceptedEntryInsert {
  readonly seasonKey: string;
  readonly mode: BoardMode;
  readonly draftMode: BoardDraftMode;
  readonly userId: string | null;
  readonly sessionId: string | null;
  readonly displayName: string;
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
      userId: entry.userId,
      sessionId: entry.sessionId,
      displayName: entry.displayName,
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
  readonly draftMode: BoardDraftMode | null;
  readonly limit: number;
  readonly cursor: BoardCursor | null;
}

export interface BoardRow {
  readonly rank: number;
  readonly id: string;
  readonly draft_mode: BoardDraftMode;
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
  display_name: string;
  verified_score: number | string;
  score_breakdown: unknown;
  created_at: string | Date;
  rank: number | string;
};

function toBoardRow(r: RawBoardRow): BoardRow {
  return {
    rank: Number(r.rank),
    id: r.id,
    draft_mode: r.draft_mode,
    display_name: r.display_name,
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
    sql`season_key = ${q.seasonKey}`,
    sql`mode = ${q.mode}`,
    sql`hidden_at IS NULL`,
  ];
  if (q.draftMode !== null) filters.push(sql`draft_mode = ${q.draftMode}`);
  const cursorPredicate = q.cursor
    ? sql`WHERE verified_score < ${q.cursor.score}
            OR (verified_score = ${q.cursor.score}
                AND (created_at > ${q.cursor.createdAt}
                     OR (created_at = ${q.cursor.createdAt} AND id > ${q.cursor.id}::uuid)))`
    : sql.raw("");
  const result = await db.execute<RawBoardRow>(sql`
    WITH best AS (
      SELECT DISTINCT ON (${IDENTITY_EXPR})
             id, draft_mode, display_name, verified_score, score_breakdown, created_at
        FROM ${leaderboardEntries}
       WHERE ${sql.join(filters, sql` AND `)}
       ORDER BY ${IDENTITY_EXPR}, verified_score DESC, created_at ASC, id ASC
    ),
    ranked AS (
      SELECT best.*,
             ROW_NUMBER() OVER (ORDER BY verified_score DESC, created_at ASC, id ASC) AS rank
        FROM best
    )
    SELECT id, draft_mode, display_name, verified_score, score_breakdown, created_at, rank
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

/**
 * The identity's best visible entry and its CURRENT board rank in
 * (season, mode) — unfiltered view, same-snapshot window. Null when the
 * identity has no visible entry (e.g. all hidden).
 */
export async function identityBoardRank(
  db: Db,
  q: { seasonKey: string; mode: BoardMode; identityKey: string },
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
       WHERE season_key = ${q.seasonKey} AND mode = ${q.mode} AND hidden_at IS NULL
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
 * Newest-first visible entries owned by the caller in (season, mode).
 * Ownership = user_id when the session is account-bound, else session_id.
 */
export async function recentEntriesFor(
  db: Db,
  q: {
    seasonKey: string;
    mode: BoardMode;
    userId: string | null;
    sessionId: string;
    limit: number;
  },
): Promise<LeaderboardEntry[]> {
  const ownership =
    q.userId !== null
      ? eq(leaderboardEntries.userId, q.userId)
      : eq(leaderboardEntries.sessionId, q.sessionId);
  return db
    .select()
    .from(leaderboardEntries)
    .where(
      and(
        eq(leaderboardEntries.seasonKey, q.seasonKey),
        eq(leaderboardEntries.mode, q.mode),
        isNull(leaderboardEntries.hiddenAt),
        ownership,
      ),
    )
    .orderBy(desc(leaderboardEntries.createdAt), desc(leaderboardEntries.id))
    .limit(q.limit);
}

// ─── API shape ──────────────────────────────────────────────────────────────

/** Snake_case wire shape for a full entry (submit response + /me). The raw
 *  token is deliberately NOT echoed — clients already hold their own. */
export interface ApiLeaderboardEntry {
  readonly id: string;
  readonly season_key: string;
  readonly mode: string;
  readonly draft_mode: string;
  readonly display_name: string;
  readonly verified_score: number;
  readonly score_breakdown: unknown;
  readonly created_at: string;
}

export function toApiEntry(row: LeaderboardEntry): ApiLeaderboardEntry {
  return {
    id: row.id,
    season_key: row.seasonKey,
    mode: row.mode,
    draft_mode: row.draftMode,
    display_name: row.displayName,
    verified_score: row.verifiedScore,
    score_breakdown: row.scoreBreakdown ?? null,
    created_at: row.createdAt.toISOString(),
  };
}
