// F-3 — server-side data access for `saved_runs` (cost-firewall safe).
//
// Pure functions taking `Db` + `AuthContext` + (optional) `now`. The route
// handlers in `apps/web/app/api/runs/*` are thin Next adapters; the
// real isolation + claim integrity tests in
// `lib/game/__tests__/saved-runs-store.test.ts` exercise THIS file
// directly against pglite. No server-side game simulation lives here —
// the replay token is stored opaquely; the client decodes for display.
//
// Authorisation model
// -------------------
// Every operation goes through `AuthContext`:
//   - `userId === null` → anonymous; only rows with that exact
//     `session_id` and `owner_user_id IS NULL` are reachable.
//   - `userId !== null` → authenticated; only rows with that exact
//     `owner_user_id` are reachable.
// Operations NEVER fall through to "list everything" when both ids are
// absent — anon callers without a session id can't reach any row.
//
// Cap policy
// ----------
// Per-scope cap is enforced on save: after the INSERT, if the scope has
// more than `SAVED_RUNS_CAP` rows, the oldest (lowest `created_at`) are
// deleted. Matches the F-1 local-storage cap so the swap-in provider
// preserves the user-visible behaviour the existing
// `lib/game/run-record.ts` already documents.
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { savedRuns } from "@wcdraft/db";
import type { Db, SavedRun } from "@wcdraft/db";

/** Match the local `RUN_RECORD_CAP` so the swap-in provider preserves user-visible behaviour. */
export const SAVED_RUNS_CAP = 5 as const;

export interface AuthContext {
  /** uuid of the signed-in user, or null for anonymous. */
  readonly userId: string | null;
  /** Opaque session id. Required for ALL operations — anon callers without a
   *  session id cannot reach saved_runs. */
  readonly sessionId: string;
}

/**
 * F-3.5 — display-ready summary persisted at save time. The shape is the
 * client's responsibility (the server treats it as opaque jsonb); the
 * server-history-provider reads it back to render real records.
 *
 * Honest-state: when this is `null` (pre-F-3.5 row, or a save mirror that
 * raced ahead of the simulation), the UI renders "—" — never fabricated.
 */
export interface SavedRunSummary {
  /** Team name the user picked at draft time. */
  readonly team_name: string;
  /** "W-L" pure record (matches the on-screen scoreboard). */
  readonly display_record: string;
  /** Formation pretty name e.g. "4-3-3". */
  readonly formation_name: string;
  /** Up to three: names + nation flag codes only. NEVER kit/crest marks. */
  readonly key_picks: ReadonlyArray<{
    readonly name: string;
    readonly nation_code: string;
  }>;
  /** True only when the run finished as champions. */
  readonly is_champion: boolean;
  /** The deterministic seed string (cosmetic). */
  readonly seed: string;
  /** Local sequence numbers for stable ordering on the client. */
  readonly created_seq?: number;
  readonly updated_seq?: number;
}

export interface SaveRunArgs {
  /** Reconstruction token (opaque to the server). */
  readonly token: string;
  /** F-1 column-stub jsonb (the seasonal version anchors). */
  readonly versionAnchors: Record<string, unknown> | null;
  readonly runId: string | null;
  readonly parentSeed: string | null;
  /** F-3.5 display-ready summary. Null until the client has it. */
  readonly summary: SavedRunSummary | null;
}

export interface SaveRunResult {
  readonly row: SavedRun;
  /** ids deleted by the cap enforcement step (oldest-first). */
  readonly evicted: string[];
  /** True when the same scope already had this token — the existing row is returned. */
  readonly idempotent: boolean;
}

export interface StoreDeps {
  readonly db: Db;
  /** Epoch milliseconds. Matches the auth-lib `now: () => number` convention. */
  readonly now?: () => number;
}

function nowOf(deps: StoreDeps): Date {
  return new Date(deps.now ? deps.now() : Date.now());
}

// ── Internal scope predicate ────────────────────────────────────────────

function scopeWhere(ctx: AuthContext) {
  if (ctx.userId !== null) {
    return and(
      eq(savedRuns.ownerUserId, ctx.userId),
      // We do NOT filter on session_id for account rows — the claim step
      // sets it null. An account row is identified by owner_user_id alone.
    );
  }
  return and(isNull(savedRuns.ownerUserId), eq(savedRuns.sessionId, ctx.sessionId));
}

// ── Save ────────────────────────────────────────────────────────────────

/**
 * Save a replay token under the caller's scope. Idempotent: if the same
 * scope already has this token, the existing row is returned (no insert).
 *
 * Cap policy: after a successful insert, the oldest rows beyond
 * `SAVED_RUNS_CAP` are deleted; the deleted ids are returned in `evicted`
 * so callers can log/telemetrise the trim. Eviction NEVER reaches across
 * scopes — only the saving user/session loses rows.
 */
export async function saveRun(
  args: SaveRunArgs,
  ctx: AuthContext,
  deps: StoreDeps,
): Promise<SaveRunResult> {
  const existing = await deps.db
    .select()
    .from(savedRuns)
    .where(and(scopeWhere(ctx), eq(savedRuns.token, args.token)))
    .limit(1);
  if (existing[0]) {
    return { row: existing[0], evicted: [], idempotent: true };
  }
  const inserted = await deps.db
    .insert(savedRuns)
    .values({
      ownerUserId: ctx.userId,
      sessionId: ctx.userId !== null ? null : ctx.sessionId,
      token: args.token,
      versionAnchors: args.versionAnchors ?? null,
      summary: args.summary as unknown,
      runId: args.runId,
      parentSeed: args.parentSeed,
      claimState: ctx.userId !== null ? "claimed" : "anonymous",
      createdAt: nowOf(deps),
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("saveRun: INSERT did not return a row");
  // Enforce per-scope cap.
  const ranked = await deps.db
    .select({ id: savedRuns.id, createdAt: savedRuns.createdAt })
    .from(savedRuns)
    .where(scopeWhere(ctx))
    .orderBy(desc(savedRuns.createdAt));
  let evicted: string[] = [];
  if (ranked.length > SAVED_RUNS_CAP) {
    const overflow = ranked.slice(SAVED_RUNS_CAP);
    evicted = overflow.map((r) => r.id);
    await deps.db.delete(savedRuns).where(
      and(
        scopeWhere(ctx),
        sql`${savedRuns.id} IN (${sql.join(
          evicted.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );
  }
  return { row, evicted, idempotent: false };
}

// ── List ────────────────────────────────────────────────────────────────

export interface ListRunsOptions {
  readonly limit?: number;
}

/** Newest-first list of the caller's runs (account- or session-scoped). */
export async function listRuns(
  ctx: AuthContext,
  deps: StoreDeps,
  opts: ListRunsOptions = {},
): Promise<SavedRun[]> {
  const limit = Math.max(0, opts.limit ?? SAVED_RUNS_CAP);
  if (limit === 0) return [];
  return deps.db
    .select()
    .from(savedRuns)
    .where(scopeWhere(ctx))
    .orderBy(desc(savedRuns.createdAt))
    .limit(limit);
}

// ── Get / Delete (own-only) ────────────────────────────────────────────

export async function getRun(
  id: string,
  ctx: AuthContext,
  deps: StoreDeps,
): Promise<SavedRun | null> {
  const rows = await deps.db
    .select()
    .from(savedRuns)
    .where(and(scopeWhere(ctx), eq(savedRuns.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Delete the row only if it belongs to the caller's scope. Returns true on
 * actual delete, false when the id wasn't reachable — DOES NOT throw on
 * "not yours". Callers that need to distinguish 404 from 403 should call
 * `getRun` first.
 */
export async function deleteRun(id: string, ctx: AuthContext, deps: StoreDeps): Promise<boolean> {
  const deleted = await deps.db
    .delete(savedRuns)
    .where(and(scopeWhere(ctx), eq(savedRuns.id, id)))
    .returning({ id: savedRuns.id });
  return deleted.length > 0;
}

// ── Claim (anon → account) ──────────────────────────────────────────────

export interface ClaimResult {
  /** Anon rows successfully re-keyed under the new user_id. */
  readonly transferred: number;
  /** Anon rows dropped because the user already had a row with the same token. */
  readonly dropped: number;
}

/**
 * Atomically transfer this session's anonymous rows to the signed-in user.
 *
 * Conflict policy (account row wins, idempotent):
 *   1. DELETE every anon row in this session whose `token` already exists
 *      in the user's own rows — the existing account row is the source of
 *      truth, so we discard the anon duplicate.
 *   2. UPDATE the survivors: set `owner_user_id = userId`, set
 *      `session_id = NULL`, flip `claim_state = 'claimed'`.
 *
 * Idempotence:
 *   - If called twice in a row with the same args, the second call finds
 *     zero anon rows for this session (the first call cleared them) and
 *     returns `{ transferred: 0, dropped: 0 }`.
 *
 * Concurrency:
 *   - Two concurrent claims for the same session race on the DELETE +
 *     UPDATE; whichever runs second sees zero rows to process. The unique
 *     partial index on `(owner_user_id, token)` prevents a duplicate
 *     account row even under pessimistic interleaving.
 *
 * Cross-session theft:
 *   - The scope filter on the DELETE + UPDATE is
 *     `session_id = $1 AND owner_user_id IS NULL`. A signed-in user cannot
 *     pull another session's anon rows by passing that other session's id
 *     — that's not part of the route surface (the handler reads
 *     session_id from the verified cookie, never from a body field).
 */
export async function claimAnonRuns(
  args: { sessionId: string; userId: string },
  deps: StoreDeps,
): Promise<ClaimResult> {
  // Step 1 — drop conflicts. USING-DELETE to pair anon row × account row by token.
  const dropped = await deps.db.execute<{ id: string }>(sql`
    DELETE FROM ${savedRuns} AS s
    USING ${savedRuns} AS u
    WHERE s.session_id = ${args.sessionId}
      AND s.owner_user_id IS NULL
      AND u.owner_user_id = ${args.userId}
      AND u.token = s.token
    RETURNING s.id
  `);

  // Step 2 — transfer survivors.
  const transferred = await deps.db
    .update(savedRuns)
    .set({
      ownerUserId: args.userId,
      sessionId: null,
      claimState: "claimed",
    })
    .where(and(eq(savedRuns.sessionId, args.sessionId), isNull(savedRuns.ownerUserId)))
    .returning({ id: savedRuns.id });

  return { transferred: transferred.length, dropped: dropped.rows.length };
}

// ── Re-exports for the API route handlers ──────────────────────────────

/** Predicate used by the listRuns query — exported for ad-hoc count queries. */
export function whereAccountOwned(userId: string) {
  return and(eq(savedRuns.ownerUserId, userId), isNotNull(savedRuns.ownerUserId));
}

/** Newest-first ordering used by `listRuns`. */
export const orderByNewestFirst = desc(savedRuns.createdAt);
/** Oldest-first ordering used by cap-eviction (re-exported for tests). */
export const orderByOldestFirst = asc(savedRuns.createdAt);
