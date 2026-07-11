// F-3 — saved-runs-store: isolation, claim integrity, cap, idempotence.
//
// Tests run against pglite (real PostgreSQL 16 semantics) so the partial
// unique indexes, FK cascades, and DELETE..USING claim ordering all behave
// the way they will in production. Isolation invariants here are the RED
// gate: a regression in scope filtering = a data-leak landed.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { setupTestDb } from "@/lib/auth/__tests__/_test-db";
import { sessions, users, savedRuns } from "@wcdraft/db";
import { eq } from "drizzle-orm";
import {
  saveRun,
  listRuns,
  getRun,
  deleteRun,
  claimAnonRuns,
  SAVED_RUNS_CAP,
  ACCOUNT_SAVED_RUNS_CAP,
  SAVED_RUNS_BYTE_CAP,
  SavedRunQuotaError,
  readSavedRunQuota,
  setRunPinnedByRunId,
} from "@/lib/game/saved-runs-store";

let env: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  env = await setupTestDb();
});
afterEach(async () => {
  await env.reset();
});

async function makeUser(email: string): Promise<string> {
  const [u] = await env.db.insert(users).values({ email }).returning();
  return u!.id;
}
async function makeSession(args: { id: string; userId?: string | null }): Promise<void> {
  await env.db.insert(sessions).values({
    id: args.id,
    userId: args.userId ?? null,
    csrfSecret: "csrf-secret-for-test-only",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
}

const baseArgs = {
  versionAnchors: { dataset_version: "v1" },
  runId: "run-v1-abc",
  parentSeed: "wcdraft:run:v1:run-v1-abc:f4-3-3",
  summary: null,
};

const deps = () => ({ db: env.db, now: () => Date.UTC(2026, 5, 7, 0, 0, 0) });

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// ── Save: per-scope semantics ──────────────────────────────────────────
describe("saveRun", () => {
  it("anon scope: inserts a row keyed by session_id + token", async () => {
    await makeSession({ id: "ses-1" });
    const r = await saveRun(
      { ...baseArgs, token: "t1.aaa" },
      { userId: null, sessionId: "ses-1" },
      deps(),
    );
    expect(r.idempotent).toBe(false);
    expect(r.row.ownerUserId).toBeNull();
    expect(r.row.sessionId).toBe("ses-1");
    expect(r.row.claimState).toBe("anonymous");
  });

  it("account scope: inserts with owner_user_id and clears session_id", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-1", userId: uid });
    const r = await saveRun(
      { ...baseArgs, token: "t1.bbb" },
      { userId: uid, sessionId: "ses-1" },
      deps(),
    );
    expect(r.row.ownerUserId).toBe(uid);
    expect(r.row.sessionId).toBeNull();
    expect(r.row.claimState).toBe("claimed");
  });

  it("anon: idempotent re-save with the same token returns the existing row", async () => {
    await makeSession({ id: "ses-1" });
    const a = await saveRun(
      { ...baseArgs, token: "t1.ccc" },
      { userId: null, sessionId: "ses-1" },
      deps(),
    );
    const b = await saveRun(
      { ...baseArgs, token: "t1.ccc" },
      { userId: null, sessionId: "ses-1" },
      deps(),
    );
    expect(b.idempotent).toBe(true);
    expect(b.row.id).toBe(a.row.id);
  });

  it("anon: two DIFFERENT sessions can save the SAME token (no cross-session collision)", async () => {
    await makeSession({ id: "ses-x" });
    await makeSession({ id: "ses-y" });
    await saveRun(
      { ...baseArgs, token: "t1.shared" },
      { userId: null, sessionId: "ses-x" },
      deps(),
    );
    await saveRun(
      { ...baseArgs, token: "t1.shared" },
      { userId: null, sessionId: "ses-y" },
      deps(),
    );
    const rows = await env.db.select().from(savedRuns).where(eq(savedRuns.token, "t1.shared"));
    expect(rows).toHaveLength(2);
  });

  it("account: idempotent re-save returns the existing row", async () => {
    const uid = await makeUser("idem@example.com");
    await makeSession({ id: "ses-1", userId: uid });
    const a = await saveRun(
      { ...baseArgs, token: "t1.dup" },
      { userId: uid, sessionId: "ses-1" },
      deps(),
    );
    const b = await saveRun(
      { ...baseArgs, token: "t1.dup" },
      { userId: uid, sessionId: "ses-1" },
      deps(),
    );
    expect(b.idempotent).toBe(true);
    expect(b.row.id).toBe(a.row.id);
  });
});

// ── List / Get / Delete: scope isolation (the RED gate) ────────────────
describe("listRuns / getRun / deleteRun — scope isolation", () => {
  it("anon callers only see their OWN session's anon rows (and never another anon's)", async () => {
    await makeSession({ id: "ses-mine" });
    await makeSession({ id: "ses-other" });
    await saveRun(
      { ...baseArgs, token: "t1.mine" },
      { userId: null, sessionId: "ses-mine" },
      deps(),
    );
    await saveRun(
      { ...baseArgs, token: "t1.others" },
      { userId: null, sessionId: "ses-other" },
      deps(),
    );
    const list = await listRuns({ userId: null, sessionId: "ses-mine" }, deps());
    expect(list.map((r) => r.token)).toEqual(["t1.mine"]);
  });

  it("authed callers only see their OWN account rows (never another user's)", async () => {
    const a = await makeUser("a@example.com");
    const b = await makeUser("b@example.com");
    await makeSession({ id: "ses-a", userId: a });
    await makeSession({ id: "ses-b", userId: b });
    await saveRun({ ...baseArgs, token: "t1.a" }, { userId: a, sessionId: "ses-a" }, deps());
    await saveRun({ ...baseArgs, token: "t1.b" }, { userId: b, sessionId: "ses-b" }, deps());
    const list = await listRuns({ userId: a, sessionId: "ses-a" }, deps());
    expect(list.map((r) => r.token)).toEqual(["t1.a"]);
  });

  it("authed caller CANNOT see anon rows (different scope kind)", async () => {
    const a = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    await makeSession({ id: "ses-a", userId: a });
    await saveRun(
      { ...baseArgs, token: "t1.anon" },
      { userId: null, sessionId: "ses-anon" },
      deps(),
    );
    const list = await listRuns({ userId: a, sessionId: "ses-a" }, deps());
    expect(list).toEqual([]);
  });

  it("anon caller CANNOT see another user's account rows", async () => {
    const a = await makeUser("a@example.com");
    await makeSession({ id: "ses-a", userId: a });
    await makeSession({ id: "ses-anon" });
    await saveRun({ ...baseArgs, token: "t1.a" }, { userId: a, sessionId: "ses-a" }, deps());
    const list = await listRuns({ userId: null, sessionId: "ses-anon" }, deps());
    expect(list).toEqual([]);
  });

  it("getRun: user B cannot fetch user A's row by id (returns null)", async () => {
    const a = await makeUser("a@example.com");
    const b = await makeUser("b@example.com");
    await makeSession({ id: "ses-a", userId: a });
    await makeSession({ id: "ses-b", userId: b });
    const saved = await saveRun(
      { ...baseArgs, token: "t1.a" },
      { userId: a, sessionId: "ses-a" },
      deps(),
    );
    const found = await getRun(saved.row.id, { userId: b, sessionId: "ses-b" }, deps());
    expect(found).toBeNull();
  });

  it("deleteRun: user B cannot delete user A's row (returns false, row stays)", async () => {
    const a = await makeUser("a@example.com");
    const b = await makeUser("b@example.com");
    await makeSession({ id: "ses-a", userId: a });
    await makeSession({ id: "ses-b", userId: b });
    const saved = await saveRun(
      { ...baseArgs, token: "t1.a" },
      { userId: a, sessionId: "ses-a" },
      deps(),
    );
    const deleted = await deleteRun(saved.row.id, { userId: b, sessionId: "ses-b" }, deps());
    expect(deleted).toBe(false);
    const stillThere = await env.db.select().from(savedRuns).where(eq(savedRuns.id, saved.row.id));
    expect(stillThere).toHaveLength(1);
  });

  it("deleteRun: owner can delete their own row (returns true)", async () => {
    const a = await makeUser("a@example.com");
    await makeSession({ id: "ses-a", userId: a });
    const saved = await saveRun(
      { ...baseArgs, token: "t1.a" },
      { userId: a, sessionId: "ses-a" },
      deps(),
    );
    const deleted = await deleteRun(saved.row.id, { userId: a, sessionId: "ses-a" }, deps());
    expect(deleted).toBe(true);
    const rows = await env.db.select().from(savedRuns).where(eq(savedRuns.id, saved.row.id));
    expect(rows).toEqual([]);
  });
});

// ── Cap / eviction ─────────────────────────────────────────────────────
describe("cap + eviction", () => {
  it("anonymous session rows evict oldest entries beyond SAVED_RUNS_CAP", async () => {
    await makeSession({ id: "ses-a" });
    for (let i = 0; i < SAVED_RUNS_CAP + 2; i += 1) {
      await saveRun(
        { ...baseArgs, token: `t1.c${i.toString()}` },
        { userId: null, sessionId: "ses-a" },
        { db: env.db, now: () => Date.UTC(2026, 5, 7, 0, 0, i) },
      );
    }
    const list = await listRuns({ userId: null, sessionId: "ses-a" }, deps(), {
      limit: SAVED_RUNS_CAP + 5,
    });
    expect(list).toHaveLength(SAVED_RUNS_CAP);
    expect(list.map((r) => r.token)).not.toContain("t1.c0");
    expect(list.map((r) => r.token)).not.toContain("t1.c1");
  });

  it("account rows are retained beyond SAVED_RUNS_CAP for the /account full history", async () => {
    const a = await makeUser("a@example.com");
    await makeSession({ id: "ses-a", userId: a });
    for (let i = 0; i < SAVED_RUNS_CAP + 2; i += 1) {
      await saveRun(
        { ...baseArgs, token: `t1.aa${i.toString()}` },
        { userId: a, sessionId: "ses-a" },
        { db: env.db, now: () => Date.UTC(2026, 5, 7, 0, 10, i) },
      );
    }
    const listA = await listRuns({ userId: a, sessionId: "ses-a" }, deps(), { limit: 99 });
    expect(listA).toHaveLength(SAVED_RUNS_CAP + 2);
    expect(listA.map((r) => r.token)).toContain("t1.aa0");
  });

  it("stores the exact persisted payload byte measurement", async () => {
    await makeSession({ id: "ses-bytes" });
    const result = await saveRun(
      {
        ...baseArgs,
        token: "t1.utf8-⚽",
        summary: {
          team_name: "São Paulo",
          display_record: "1-0",
          formation_name: "4-3-3",
          key_picks: [],
          is_champion: false,
          seed: "á",
        },
      },
      { userId: null, sessionId: "ses-bytes" },
      deps(),
    );
    const exact = await env.pg.query<{ bytes: number }>(`
      SELECT
        octet_length(convert_to(token, 'UTF8'))
        + coalesce(octet_length(convert_to(version_anchors::text, 'UTF8')), 0)
        + coalesce(octet_length(convert_to(verified_result::text, 'UTF8')), 0)
        + coalesce(octet_length(convert_to(summary::text, 'UTF8')), 0)
        + coalesce(octet_length(convert_to(run_id, 'UTF8')), 0)
        + coalesce(octet_length(convert_to(parent_seed, 'UTF8')), 0)
        + octet_length(convert_to(claim_state, 'UTF8')) AS bytes
      FROM saved_runs WHERE id = '${result.row.id}'
    `);
    expect(result.row.payloadBytes).toBe(exact.rows[0]?.bytes);
  });

  it("evicts deterministically by created_at then id while preserving pinned rows", async () => {
    const userId = await makeUser("quota@example.com");
    await makeSession({ id: "ses-quota", userId });
    const createdAt = new Date(Date.UTC(2026, 5, 1));
    await env.db.insert(savedRuns).values(
      Array.from({ length: ACCOUNT_SAVED_RUNS_CAP }, (_, index) => ({
        id: `00000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
        ownerUserId: userId,
        token: `seed-${index.toString()}`,
        versionAnchors: null,
        runId: `run-${index.toString()}`,
        payloadBytes: 1,
        pinnedAt: index === 0 ? createdAt : null,
        claimState: "claimed",
        createdAt,
      })),
    );
    const result = await saveRun(
      { ...baseArgs, token: "t1.newest", runId: "newest" },
      { userId, sessionId: "ses-quota" },
      deps(),
    );
    expect(result.evicted).toEqual(["00000000-0000-4000-8000-000000000002"]);
    expect((await readSavedRunQuota({ userId, sessionId: "ses-quota" }, deps())).usedRows).toBe(
      ACCOUNT_SAVED_RUNS_CAP,
    );
    expect(
      await setRunPinnedByRunId("run-0", false, { userId, sessionId: "ses-quota" }, deps()),
    ).toMatchObject({
      updated: 1,
    });
  });

  it("serializes pin and save so a newly pinned eviction candidate survives", async () => {
    const userId = await makeUser("pin-race@example.com");
    await makeSession({ id: "ses-pin-race", userId });
    const createdAt = new Date(Date.UTC(2026, 5, 1));
    await env.db.insert(savedRuns).values(
      Array.from({ length: ACCOUNT_SAVED_RUNS_CAP }, (_, index) => ({
        id: `10000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
        ownerUserId: userId,
        token: `pin-race-${index.toString()}`,
        runId: `pin-race-${index.toString()}`,
        payloadBytes: 1,
        claimState: "claimed",
        createdAt,
      })),
    );
    const pinHasLock = deferred();
    const releasePin = deferred();
    let saveHasLock = false;
    const ctx = { userId, sessionId: "ses-pin-race" };
    const pin = setRunPinnedByRunId("pin-race-0", true, ctx, {
      ...deps(),
      onScopeLocked: async () => {
        pinHasLock.resolve();
        await releasePin.promise;
      },
    });
    await pinHasLock.promise;
    const save = saveRun({ ...baseArgs, token: "pin-race-new", runId: "pin-race-new" }, ctx, {
      ...deps(),
      onScopeLocked: async () => {
        saveHasLock = true;
      },
    });
    await Promise.resolve();
    expect(saveHasLock).toBe(false);
    releasePin.resolve();
    await Promise.all([pin, save]);

    const rows = await env.db.select().from(savedRuns).where(eq(savedRuns.ownerUserId, userId));
    expect(rows).toHaveLength(ACCOUNT_SAVED_RUNS_CAP);
    expect(rows.find((row) => row.runId === "pin-race-0")?.pinnedAt).not.toBeNull();
    expect(rows.map((row) => row.runId)).not.toContain("pin-race-1");
  });

  it("rejects atomically when pinned data consumes the 8 MiB quota", async () => {
    const userId = await makeUser("full@example.com");
    await makeSession({ id: "ses-full", userId });
    await env.db.insert(savedRuns).values({
      ownerUserId: userId,
      token: "pinned-full",
      payloadBytes: SAVED_RUNS_BYTE_CAP,
      pinnedAt: new Date(),
      claimState: "claimed",
    });
    await expect(
      saveRun({ ...baseArgs, token: "cannot-fit" }, { userId, sessionId: "ses-full" }, deps()),
    ).rejects.toBeInstanceOf(SavedRunQuotaError);
    const rows = await env.db.select().from(savedRuns);
    expect(rows.map((row) => row.token)).toEqual(["pinned-full"]);
  });
});

// ── Claim (anon → account) ────────────────────────────────────────────
describe("claimAnonRuns — idempotence, conflict, no theft", () => {
  it("transfers this session's anon rows to the new user_id (sets claim_state = 'claimed')", async () => {
    const a = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    await saveRun({ ...baseArgs, token: "t1.1" }, { userId: null, sessionId: "ses-anon" }, deps());
    await saveRun({ ...baseArgs, token: "t1.2" }, { userId: null, sessionId: "ses-anon" }, deps());
    const result = await claimAnonRuns({ sessionId: "ses-anon", userId: a }, deps());
    expect(result).toEqual({ transferred: 2, dropped: 0 });
    const owned = await listRuns({ userId: a, sessionId: "ses-anon" }, deps());
    expect(owned).toHaveLength(2);
    expect(owned.every((r) => r.claimState === "claimed")).toBe(true);
    expect(owned.every((r) => r.sessionId === null)).toBe(true);
  });

  it("recomputes exact payload bytes when claim_state changes", async () => {
    const userId = await makeUser("claim-bytes@example.com");
    await makeSession({ id: "ses-claim-bytes" });
    const saved = await saveRun(
      { ...baseArgs, token: "t1.claim-bytes-⚽" },
      { userId: null, sessionId: "ses-claim-bytes" },
      deps(),
    );
    await claimAnonRuns({ sessionId: "ses-claim-bytes", userId }, deps());
    const exact = await env.pg.query<{ bytes: number; payload_bytes: number }>(`
      SELECT payload_bytes,
        octet_length(convert_to(token, 'UTF8'))
        + coalesce(octet_length(convert_to(version_anchors::text, 'UTF8')), 0)
        + coalesce(octet_length(convert_to(verified_result::text, 'UTF8')), 0)
        + coalesce(octet_length(convert_to(summary::text, 'UTF8')), 0)
        + coalesce(octet_length(convert_to(run_id, 'UTF8')), 0)
        + coalesce(octet_length(convert_to(parent_seed, 'UTF8')), 0)
        + octet_length(convert_to(claim_state, 'UTF8')) AS bytes
      FROM saved_runs WHERE id = '${saved.row.id}'
    `);
    expect(exact.rows[0]?.payload_bytes).toBe(exact.rows[0]?.bytes);
    expect(exact.rows[0]?.payload_bytes).toBe(saved.row.payloadBytes - 2);
  });

  it("IS IDEMPOTENT: re-running yields zero transfers and zero drops", async () => {
    const a = await makeUser("idem@example.com");
    await makeSession({ id: "ses-anon" });
    await saveRun({ ...baseArgs, token: "t1.x" }, { userId: null, sessionId: "ses-anon" }, deps());
    const r1 = await claimAnonRuns({ sessionId: "ses-anon", userId: a }, deps());
    const r2 = await claimAnonRuns({ sessionId: "ses-anon", userId: a }, deps());
    expect(r1).toEqual({ transferred: 1, dropped: 0 });
    expect(r2).toEqual({ transferred: 0, dropped: 0 });
  });

  it("conflict policy: existing ACCOUNT row wins, anon duplicate is DROPPED", async () => {
    const a = await makeUser("a@example.com");
    await makeSession({ id: "ses-a", userId: a });
    await makeSession({ id: "ses-anon" });
    // Account row exists for token T.
    await saveRun({ ...baseArgs, token: "t1.T" }, { userId: a, sessionId: "ses-a" }, deps());
    // Anon session also has token T.
    await saveRun({ ...baseArgs, token: "t1.T" }, { userId: null, sessionId: "ses-anon" }, deps());
    const result = await claimAnonRuns({ sessionId: "ses-anon", userId: a }, deps());
    expect(result).toEqual({ transferred: 0, dropped: 1 });
    const owned = await listRuns({ userId: a, sessionId: "ses-a" }, deps());
    expect(owned).toHaveLength(1);
    // Anon row for that session is gone (dropped, NOT transferred).
    const anonRows = await env.db
      .select()
      .from(savedRuns)
      .where(eq(savedRuns.sessionId, "ses-anon"));
    expect(anonRows).toEqual([]);
  });

  it("mixed: some transfer, some drop (per-token conflict resolution)", async () => {
    const a = await makeUser("a@example.com");
    await makeSession({ id: "ses-a", userId: a });
    await makeSession({ id: "ses-anon" });
    // Account: t1.alpha
    await saveRun({ ...baseArgs, token: "t1.alpha" }, { userId: a, sessionId: "ses-a" }, deps());
    // Anon: t1.alpha (conflict) + t1.beta (transferable) + t1.gamma (transferable)
    await saveRun(
      { ...baseArgs, token: "t1.alpha" },
      { userId: null, sessionId: "ses-anon" },
      deps(),
    );
    await saveRun(
      { ...baseArgs, token: "t1.beta" },
      { userId: null, sessionId: "ses-anon" },
      deps(),
    );
    await saveRun(
      { ...baseArgs, token: "t1.gamma" },
      { userId: null, sessionId: "ses-anon" },
      deps(),
    );
    const result = await claimAnonRuns({ sessionId: "ses-anon", userId: a }, deps());
    expect(result).toEqual({ transferred: 2, dropped: 1 });
    const owned = await listRuns({ userId: a, sessionId: "ses-a" }, deps(), { limit: 99 });
    expect(owned.map((r) => r.token).sort()).toEqual(["t1.alpha", "t1.beta", "t1.gamma"]);
  });

  it("NO CROSS-SESSION THEFT: claiming session X does not touch session Y", async () => {
    const a = await makeUser("a@example.com");
    await makeSession({ id: "ses-mine" });
    await makeSession({ id: "ses-strangers" });
    await saveRun(
      { ...baseArgs, token: "t1.mine" },
      { userId: null, sessionId: "ses-mine" },
      deps(),
    );
    await saveRun(
      { ...baseArgs, token: "t1.strangers" },
      { userId: null, sessionId: "ses-strangers" },
      deps(),
    );
    const result = await claimAnonRuns({ sessionId: "ses-mine", userId: a }, deps());
    expect(result.transferred).toBe(1);
    // Stranger's anon row is untouched.
    const strangersStill = await env.db
      .select()
      .from(savedRuns)
      .where(eq(savedRuns.sessionId, "ses-strangers"));
    expect(strangersStill).toHaveLength(1);
    expect(strangersStill[0]?.ownerUserId).toBeNull();
  });

  it("CONCURRENT claim safety: two simultaneous claims race-without-error", async () => {
    const a = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    for (let i = 0; i < 4; i += 1) {
      await saveRun(
        { ...baseArgs, token: `t1.c${i.toString()}` },
        { userId: null, sessionId: "ses-anon" },
        deps(),
      );
    }
    const [r1, r2] = await Promise.all([
      claimAnonRuns({ sessionId: "ses-anon", userId: a }, deps()),
      claimAnonRuns({ sessionId: "ses-anon", userId: a }, deps()),
    ]);
    // One wins all 4, the other sees 0. (Or any partition that sums to 4.)
    expect(r1.transferred + r2.transferred).toBe(4);
    expect(r1.dropped + r2.dropped).toBe(0);
    // No duplicate account rows (unique partial index enforces this).
    const owned = await listRuns({ userId: a, sessionId: "ses-anon" }, deps(), { limit: 99 });
    expect(owned).toHaveLength(4);
  });
});

// ── F-3.5 summary persistence ──────────────────────────────────────────
describe("F-3.5 summary persistence", () => {
  const summary = {
    team_name: "Test XI",
    display_record: "4-1",
    formation_name: "4-3-3",
    key_picks: [
      { name: "Pele", nation_code: "BRA" },
      { name: "Maradona", nation_code: "ARG" },
      { name: "Zidane", nation_code: "FRA" },
    ],
    is_champion: false,
    seed: "wcdraft:test:seed",
    created_seq: 17,
    updated_seq: 22,
  } as const;

  it("persists the summary on save and surfaces it on list", async () => {
    const uid = await makeUser("sum@example.com");
    await makeSession({ id: "ses-sum", userId: uid });
    await saveRun(
      { ...baseArgs, token: "t1.sum", summary },
      { userId: uid, sessionId: "ses-sum" },
      deps(),
    );
    const list = await listRuns({ userId: uid, sessionId: "ses-sum" }, deps());
    expect(list).toHaveLength(1);
    expect(list[0]?.summary).toEqual(summary);
  });

  it("anon row also gets summary; survives the claim re-key to the user", async () => {
    const uid = await makeUser("anon2acc@example.com");
    await makeSession({ id: "ses-anon-sum" });
    await makeSession({ id: "ses-user-sum", userId: uid });
    await saveRun(
      { ...baseArgs, token: "t1.anon-sum", summary },
      { userId: null, sessionId: "ses-anon-sum" },
      deps(),
    );
    await claimAnonRuns({ sessionId: "ses-anon-sum", userId: uid }, deps());
    const list = await listRuns({ userId: uid, sessionId: "ses-user-sum" }, deps());
    expect(list).toHaveLength(1);
    expect(list[0]?.summary).toEqual(summary);
    expect(list[0]?.ownerUserId).toBe(uid);
    expect(list[0]?.claimState).toBe("claimed");
  });

  it("save without summary leaves the column NULL (honest-state)", async () => {
    const uid = await makeUser("nosum@example.com");
    await makeSession({ id: "ses-nosum", userId: uid });
    await saveRun(
      { ...baseArgs, token: "t1.nosum", summary: null },
      { userId: uid, sessionId: "ses-nosum" },
      deps(),
    );
    const list = await listRuns({ userId: uid, sessionId: "ses-nosum" }, deps());
    expect(list).toHaveLength(1);
    expect(list[0]?.summary).toBeNull();
  });

  it("cross-user isolation extends to summary — user B never sees A's summary", async () => {
    const a = await makeUser("a-sum@example.com");
    const b = await makeUser("b-sum@example.com");
    await makeSession({ id: "ses-a-sum", userId: a });
    await makeSession({ id: "ses-b-sum", userId: b });
    await saveRun(
      { ...baseArgs, token: "t1.a-summed", summary },
      { userId: a, sessionId: "ses-a-sum" },
      deps(),
    );
    const listB = await listRuns({ userId: b, sessionId: "ses-b-sum" }, deps());
    expect(listB).toEqual([]);
  });
});
