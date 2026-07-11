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
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { savedRuns, sessions, users } from "@wcdraft/db";
import type { Db, SavedRun } from "@wcdraft/db";
import type { DraftMode } from "@wcdraft/core";

/** Anonymous history matches the local recent-run cap. */
export const ANON_SAVED_RUNS_CAP = 5 as const;
/** Signed-in durable history is bounded for cost and privacy. */
export const ACCOUNT_SAVED_RUNS_CAP = 500 as const;
export const SAVED_RUNS_BYTE_CAP = 8 * 1024 * 1024;
/** Backward-compatible alias for callers that mean anonymous recent history. */
export const SAVED_RUNS_CAP = ANON_SAVED_RUNS_CAP;

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
  readonly score?: number;
  readonly wins?: number;
  readonly draws?: number;
  readonly losses?: number;
  readonly undefeated_regulation?: boolean;
  /** Formation pretty name e.g. "4-3-3". */
  readonly formation_name: string;
  readonly draft_mode?: DraftMode;
  readonly draft_order?: "squad_first" | "position_first";
  readonly era_preset?: "all_time" | "post_2000" | "post_2010" | "modern";
  readonly rating_basis?: "career" | "current";
  /** Up to three: names + nation flag codes only. NEVER kit/crest marks. */
  readonly key_picks: ReadonlyArray<{
    readonly name: string;
    readonly nation_code: string;
  }>;
  /** True only when the run finished as champions. */
  readonly is_champion: boolean;
  readonly is_perfect_eight_zero?: boolean;
  readonly reached_round?: string;
  readonly matches_played?: number;
  readonly challenge_date?: string | null;
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
  readonly pinned?: boolean;
}

export interface SaveRunResult {
  readonly row: SavedRun;
  /** ids deleted by the cap enforcement step (oldest-first). */
  readonly evicted: string[];
  /** True when the same scope already had this token — the existing row is returned. */
  readonly idempotent: boolean;
  readonly quota: SavedRunQuota;
}

export interface SavedRunQuota {
  readonly maxRows: number;
  readonly maxBytes: number;
  readonly usedRows: number;
  readonly usedBytes: number;
}

export class SavedRunQuotaError extends Error {
  readonly code = "SAVED_RUN_QUOTA_EXCEEDED";
  readonly status = 409;
  constructor() {
    super("Saved-run quota is full and no unpinned run can be evicted.");
    this.name = "SavedRunQuotaError";
  }
}

export interface StoreDeps {
  readonly db: Db;
  /** Epoch milliseconds. Matches the auth-lib `now: () => number` convention. */
  readonly now?: () => number;
  /** Deterministic concurrency-test seam, called while the scope lock is held. */
  readonly onScopeLocked?: (scope: { kind: "user" | "session"; id: string }) => Promise<void>;
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
  return deps.db.transaction(async (tx) => {
    const transactionDeps: StoreDeps = { ...deps, db: tx as unknown as Db };
    await lockScope(ctx, transactionDeps);
    const existing = await transactionDeps.db
      .select()
      .from(savedRuns)
      .where(and(scopeWhere(ctx), eq(savedRuns.token, args.token)))
      .limit(1);
    if (existing[0]) {
      const quota = await readSavedRunQuota(ctx, transactionDeps);
      return { row: existing[0], evicted: [], idempotent: true, quota };
    }
    const inserted = await transactionDeps.db
      .insert(savedRuns)
      .values({
        ownerUserId: ctx.userId,
        sessionId: ctx.userId !== null ? null : ctx.sessionId,
        token: args.token,
        versionAnchors: args.versionAnchors ?? null,
        summary: args.summary as unknown,
        runId: args.runId,
        parentSeed: args.parentSeed,
        payloadBytes: 0,
        pinnedAt: args.pinned === true ? nowOf(deps) : null,
        claimState: ctx.userId !== null ? "claimed" : "anonymous",
        createdAt: nowOf(deps),
      })
      .returning();
    const initial = inserted[0];
    if (!initial) throw new Error("saveRun: INSERT did not return a row");
    const measured = await transactionDeps.db
      .update(savedRuns)
      .set({ payloadBytes: persistedPayloadBytesSql() })
      .where(eq(savedRuns.id, initial.id))
      .returning();
    const row = measured[0];
    if (!row) throw new Error("saveRun: payload measurement did not return a row");
    const enforced = await enforceSavedRunQuota(ctx, row.id, transactionDeps);
    return {
      row,
      evicted: enforced.evicted,
      idempotent: false,
      quota: enforced.quota,
    };
  });
}

export async function readSavedRunQuota(ctx: AuthContext, deps: StoreDeps): Promise<SavedRunQuota> {
  const rows = await deps.db
    .select({
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${savedRuns.payloadBytes}), 0)::int`,
    })
    .from(savedRuns)
    .where(scopeWhere(ctx));
  return {
    maxRows: ctx.userId === null ? ANON_SAVED_RUNS_CAP : ACCOUNT_SAVED_RUNS_CAP,
    maxBytes: SAVED_RUNS_BYTE_CAP,
    usedRows: Number(rows[0]?.count ?? 0),
    usedBytes: Number(rows[0]?.bytes ?? 0),
  };
}

export async function setRunPinnedByRunId(
  runId: string,
  pinned: boolean,
  ctx: AuthContext,
  deps: StoreDeps,
): Promise<{ updated: number; quota: SavedRunQuota }> {
  return deps.db.transaction(async (tx) => {
    const transactionDeps: StoreDeps = { ...deps, db: tx as unknown as Db };
    await lockScope(ctx, transactionDeps);
    const updated = await transactionDeps.db
      .update(savedRuns)
      .set({ pinnedAt: pinned ? nowOf(deps) : null })
      .where(and(scopeWhere(ctx), eq(savedRuns.runId, runId)))
      .returning({ id: savedRuns.id });
    return {
      updated: updated.length,
      quota: await readSavedRunQuota(ctx, transactionDeps),
    };
  });
}

async function lockScope(ctx: AuthContext, deps: StoreDeps): Promise<void> {
  if (ctx.userId !== null) {
    await deps.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .for("update");
    await deps.onScopeLocked?.({ kind: "user", id: ctx.userId });
    return;
  }
  await deps.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, ctx.sessionId))
    .for("update");
  await deps.onScopeLocked?.({ kind: "session", id: ctx.sessionId });
}

async function enforceSavedRunQuota(
  ctx: AuthContext,
  insertedId: string | null,
  deps: StoreDeps,
): Promise<{ evicted: string[]; quota: SavedRunQuota }> {
  let quota = await readSavedRunQuota(ctx, deps);
  if (quota.usedRows <= quota.maxRows && quota.usedBytes <= quota.maxBytes) {
    return { evicted: [], quota };
  }
  const candidates = await deps.db
    .select({ id: savedRuns.id, payloadBytes: savedRuns.payloadBytes })
    .from(savedRuns)
    .where(and(scopeWhere(ctx), isNull(savedRuns.pinnedAt)))
    .orderBy(asc(savedRuns.createdAt), asc(savedRuns.id));
  const selected: string[] = [];
  let rows = quota.usedRows;
  let bytes = quota.usedBytes;
  for (const candidate of candidates) {
    if (rows <= quota.maxRows && bytes <= quota.maxBytes) break;
    selected.push(candidate.id);
    rows -= 1;
    bytes -= candidate.payloadBytes;
  }
  if (
    rows > quota.maxRows ||
    bytes > quota.maxBytes ||
    (insertedId !== null && selected.includes(insertedId))
  ) {
    throw new SavedRunQuotaError();
  }
  let evicted: string[] = [];
  if (selected.length > 0) {
    const deleted = await deps.db
      .delete(savedRuns)
      .where(and(scopeWhere(ctx), isNull(savedRuns.pinnedAt), inArray(savedRuns.id, selected)))
      .returning({ id: savedRuns.id });
    const deletedIds = new Set(deleted.map((row) => row.id));
    evicted = selected.filter((id) => deletedIds.has(id));
  }
  quota = await readSavedRunQuota(ctx, deps);
  if (quota.usedRows > quota.maxRows || quota.usedBytes > quota.maxBytes) {
    throw new SavedRunQuotaError();
  }
  return { evicted, quota };
}

function persistedPayloadBytesSql(claimState: "persisted" | "claimed" = "persisted") {
  const claimStateSql = claimState === "claimed" ? sql`'claimed'` : sql`${savedRuns.claimState}`;
  return sql<number>`
    octet_length(convert_to(${savedRuns.token}, 'UTF8'))
    + coalesce(octet_length(convert_to(${savedRuns.versionAnchors}::text, 'UTF8')), 0)
    + coalesce(octet_length(convert_to(${savedRuns.verifiedResult}::text, 'UTF8')), 0)
    + coalesce(octet_length(convert_to(${savedRuns.summary}::text, 'UTF8')), 0)
    + coalesce(octet_length(convert_to(${savedRuns.runId}, 'UTF8')), 0)
    + coalesce(octet_length(convert_to(${savedRuns.parentSeed}, 'UTF8')), 0)
    + octet_length(convert_to(${claimStateSql}, 'UTF8'))
  `;
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
  // This helper deliberately does not open its own transaction: the only
  // production caller composes it with leaderboard claiming under one outer
  // transaction, so quota enforcement rolls that entire claim moment back.
  // Always acquire the account lock before the source-session lock. Saves and
  // pins take only one of these locks, while competing claims use this same
  // order, so there is no lock-order cycle.
  await lockScope({ userId: args.userId, sessionId: args.sessionId }, deps);
  await lockScope({ userId: null, sessionId: args.sessionId }, deps);
  const dropped = await deps.db.execute<{ id: string }>(sql`
    DELETE FROM ${savedRuns} AS s
    USING ${savedRuns} AS u
    WHERE s.session_id = ${args.sessionId}
      AND s.owner_user_id IS NULL
      AND u.owner_user_id = ${args.userId}
      AND u.token = s.token
    RETURNING s.id
  `);
  const transferred = await deps.db
    .update(savedRuns)
    .set({
      ownerUserId: args.userId,
      sessionId: null,
      claimState: "claimed",
      payloadBytes: persistedPayloadBytesSql("claimed"),
    })
    .where(and(eq(savedRuns.sessionId, args.sessionId), isNull(savedRuns.ownerUserId)))
    .returning({ id: savedRuns.id });
  await enforceSavedRunQuota({ userId: args.userId, sessionId: args.sessionId }, null, deps);
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
