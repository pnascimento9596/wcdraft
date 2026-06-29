// F-4 U6 — anon→account claim bridge for leaderboard entries.
//
// Mirrors the F-3 `claimAnonRuns` drop-conflicts-then-transfer shape
// (`lib/game/saved-runs-store.ts:273-305`) on `leaderboard_entries`, and
// composes BOTH transfers into the single F-3 claim moment via
// `claimAnonArtifacts` (one transaction; a partial failure rolls back the
// whole claim so a session is never half-claimed).
//
// Conflict policy (account row wins, idempotent — same as F-3):
//   1. Season rows: DELETE every anon row in this session whose
//      (season_key, mode, token) already exists among the user's own season
//      rows. The partial unique index `leaderboard_entries_season_dedupe_uq`
//      on (season_key, mode, user_id, token) NULLS NOT DISTINCT would reject
//      the transfer of such a row; the account row is the source of truth.
//   2. Daily rows: if a visible anon row would collide with the user's
//      visible row for the same daily date/config identity, merge the better
//      score into the user row, then discard the anon row. Daily allows the
//      same token across identities, so token equality is not a conflict by
//      itself; the per-day identity is.
//   3. UPDATE the survivors: set `user_id = userId`, `session_id = NULL`.
//      `display_alias` is deliberately NOT touched — the alias chosen at
//      submit time stays on the entry after the claim.
//
// Same-bucket collisions are NOT conflicts: per the F-4 plan §4, ALL
// accepted entries are retained as rows (audit + re-rank freedom later) and
// "best entry per identity" is resolved at READ time by the board query.
// A user who already owns an entry in the same (season_key, mode,
// draft_mode) bucket simply ends up with two rows after the claim — only an
// exact season (season_key, mode, token) duplicate is dropped. Daily boards
// keep one visible row per account/day/config, matching the write path's
// best-of-many identity semantics.
//
// Constraint interplay:
//   - Season dedupe: NULLS NOT DISTINCT also guarantees the season anon set
//     itself holds at most one row per (season_key, mode, token) — anon rows
//     all carry user_id NULL, so two same-token season anon rows can never
//     coexist. The transfer therefore cannot create an intra-batch duplicate;
//     only user-owned conflicts need the drop step.
//   - Daily identity: visible daily rows are unique by
//     (challenge_date, mode, config, identity). A claim that already has a
//     user-owned visible daily row for that bucket is resolved as a merge,
//     not a transfer, so the unique index remains an invariant instead of a
//     runtime failure.
//   - Ranked CHECK (`leaderboard_entries_ranked_user_chk`): an anon ranked
//     row is structurally impossible (mode = 'ranked' requires a non-null
//     user_id), so the transfer scope (`user_id IS NULL`) is casual-only by
//     construction; setting user_id non-null can never violate the CHECK.
//   - Swept sessions: `session_id` is ON DELETE SET NULL — an entry whose
//     session was swept has session_id NULL and is unreachable by the
//     transfer filter. That is INTENDED: board entries are public artifacts
//     that survive session expiry as permanently unclaimable anon rows.
//   - `hidden_at` is not touched: moderation state is orthogonal to
//     ownership; a hidden anon entry transfers hidden (audit trail keeps
//     pointing at its true owner).
//
// Idempotence / concurrency / theft: identical reasoning to claimAnonRuns —
// a second claim finds zero anon rows for the session; concurrent claims
// race benignly (the dedupe constraint is the backstop); the session id
// always comes from the verified cookie, never from a request body, so a
// signed-in user cannot pull another session's rows.
import { and, eq, isNull, sql } from "drizzle-orm";
import { leaderboardEntries } from "@wcdraft/db";
import type { Db } from "@wcdraft/db";
import { claimAnonRuns, type ClaimResult } from "@/lib/game/saved-runs-store";

/**
 * The exact transactional surface the claim path touches: the raw USING-DELETE
 * (`execute`) and the survivor transfer (`update → set → where → returning`).
 * Both a full `Db` connection and a Drizzle transaction handle satisfy this
 * structurally, so the claim runs unchanged under either — no cast at the tx
 * seam. Members are pinned to `Db`'s own method types so the interface cannot
 * silently drift from the driver.
 */
export interface ClaimTx {
  readonly execute: Db["execute"];
  readonly update: Db["update"];
}

/** Dependencies for a single-table claim — satisfied by `Db` or a tx handle. */
export interface ClaimDeps {
  readonly db: ClaimTx;
}

/** Dependencies for the combined claim moment — needs to open a transaction. */
export interface ClaimRunnerDeps {
  readonly db: Pick<Db, "transaction">;
}

export interface ClaimArgs {
  readonly sessionId: string;
  readonly userId: string;
}

/** Per-table outcome of the combined claim moment. */
export interface ClaimArtifactsResult {
  readonly runs: ClaimResult;
  readonly leaderboard: ClaimResult;
}

/**
 * Atomically transfer this session's anonymous leaderboard entries to the
 * signed-in user. Drop-conflicts-then-transfer; see module header for the
 * full policy. Safe to run inside a transaction (pass the tx as `deps.db`).
 */
export async function claimLeaderboardEntries(
  args: ClaimArgs,
  deps: ClaimDeps,
): Promise<ClaimResult> {
  // Step 1 — drop season conflicts. USING-DELETE pairs each anon row with an
  // account row on the season dedupe key (season_key, mode, token); user_id is
  // the claimant on one side and NULL on the other by the scope filters.
  const seasonDropped = await deps.db.execute<{ id: string }>(sql`
    DELETE FROM ${leaderboardEntries} AS e
    USING ${leaderboardEntries} AS u
    WHERE e.session_id = ${args.sessionId}
      AND e.user_id IS NULL
      AND e.challenge_type = 'season'
      AND u.user_id = ${args.userId}
      AND u.challenge_type = 'season'
      AND u.season_key = e.season_key
      AND u.mode = e.mode
      AND u.token = e.token
    RETURNING e.id
  `);

  // Step 2 — merge visible daily identity conflicts, then discard the anon row.
  // Hidden daily rows do not participate in the visible identity index and can
  // transfer like ordinary survivors.
  const dailyDropped = await deps.db.execute<{ id: string }>(sql`
    WITH daily_conflicts AS (
      SELECT
        e.id AS anon_id,
        u.id AS user_id,
        e.season_key,
        e.rating_version,
        e.display_alias,
        e.token,
        e.verified_score,
        e.score_breakdown,
        e.created_at
      FROM ${leaderboardEntries} AS e
      JOIN ${leaderboardEntries} AS u
        ON u.user_id = ${args.userId}
       AND u.challenge_type = 'daily'
       AND u.hidden_at IS NULL
       AND u.challenge_date = e.challenge_date
       AND u.mode = e.mode
       AND u.draft_mode = e.draft_mode
       AND u.draft_order IS NOT DISTINCT FROM e.draft_order
       AND u.era IS NOT DISTINCT FROM e.era
       AND u.rating_basis IS NOT DISTINCT FROM e.rating_basis
      WHERE e.session_id = ${args.sessionId}
        AND e.user_id IS NULL
        AND e.challenge_type = 'daily'
        AND e.hidden_at IS NULL
    ),
    merged AS (
      UPDATE ${leaderboardEntries} AS u
      SET
        season_key = d.season_key,
        rating_version = d.rating_version,
        display_alias = d.display_alias,
        token = d.token,
        verified_score = d.verified_score,
        score_breakdown = d.score_breakdown,
        created_at = d.created_at
      FROM daily_conflicts AS d
      WHERE u.id = d.user_id
        AND (
          d.verified_score > u.verified_score
          OR (d.verified_score = u.verified_score AND d.created_at < u.created_at)
        )
      RETURNING d.anon_id
    )
    DELETE FROM ${leaderboardEntries} AS e
    USING daily_conflicts AS d
    WHERE e.id = d.anon_id
    RETURNING e.id
  `);

  // Step 3 — transfer survivors. display_alias / hidden_at / created_at are
  // deliberately untouched (see module header).
  const transferred = await deps.db
    .update(leaderboardEntries)
    .set({ userId: args.userId, sessionId: null })
    .where(and(eq(leaderboardEntries.sessionId, args.sessionId), isNull(leaderboardEntries.userId)))
    .returning({ id: leaderboardEntries.id });

  return {
    transferred: transferred.length,
    dropped: seasonDropped.rows.length + dailyDropped.rows.length,
  };
}

/**
 * The single F-3 claim moment, extended: transfer this session's anonymous
 * saved_runs AND leaderboard_entries to the signed-in user in ONE
 * transaction. Either both transfers commit or neither does — a partial
 * failure must not leave the session half-claimed, because both call sites
 * (the verify-POST hook and POST /api/runs/claim) treat the claim as a unit
 * and retry it as a unit.
 */
export async function claimAnonArtifacts(
  args: ClaimArgs,
  deps: ClaimRunnerDeps,
): Promise<ClaimArtifactsResult> {
  return deps.db.transaction(async (tx) => {
    // The drizzle transaction handle structurally satisfies both the saved-runs
    // `StoreDeps.db` surface and `ClaimTx`, so the SAME `tx` drives both
    // transfers under one transaction — no cast at the seam.
    const runs = await claimAnonRuns(args, { db: tx });
    const leaderboard = await claimLeaderboardEntries(args, { db: tx });
    return { runs, leaderboard };
  });
}
