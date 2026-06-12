// F-4 U6 — claim bridge: leaderboard_entries anon→account transfer.
//
// Runs against pglite at the full 0004 shape (real PostgreSQL 16 semantics:
// UNIQUE NULLS NOT DISTINCT, CHECK constraints, FK SET NULL) so the
// drop-then-transfer ordering and the constraint interplay behave exactly
// as they will on Neon. RED-adjacent: a regression here either leaks rows
// across identities or strands a user's entries mid-claim.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { setupTestDb } from "@/lib/auth/__tests__/_test-db";
import { sessions, users, savedRuns, leaderboardEntries } from "@wcdraft/db";
import { eq, isNull, and } from "drizzle-orm";
import { claimLeaderboardEntries, claimAnonArtifacts } from "@/lib/leaderboard/claim";

let env: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  env = await setupTestDb();
});
afterEach(async () => {
  await env.reset();
});

const deps = () => ({ db: env.db });

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

/** Insert a leaderboard entry; anon by default (user_id NULL). */
async function makeEntry(args: {
  token: string;
  sessionId?: string | null;
  userId?: string | null;
  seasonKey?: string;
  mode?: "casual" | "ranked";
  draftMode?: "classic" | "hidden";
  displayName?: string;
  verifiedScore?: number;
  hiddenAt?: Date | null;
}) {
  const [row] = await env.db
    .insert(leaderboardEntries)
    .values({
      seasonKey: args.seasonKey ?? "season-a",
      mode: args.mode ?? "casual",
      draftMode: args.draftMode ?? "classic",
      userId: args.userId ?? null,
      sessionId: args.sessionId ?? null,
      displayName: args.displayName ?? "Anon Ace",
      token: args.token,
      verifiedScore: args.verifiedScore ?? 100,
      hiddenAt: args.hiddenAt ?? null,
    })
    .returning();
  return row!;
}

async function entriesOfUser(userId: string) {
  return env.db.select().from(leaderboardEntries).where(eq(leaderboardEntries.userId, userId));
}

function errorMessages(err: unknown): string[] {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) messages.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  if (messages.length === 0) messages.push(String(err));
  return messages;
}

async function expectRejectsWithCause(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeDefined();
  expect(errorMessages(caught).join("\n")).toMatch(pattern);
}

// ── claimLeaderboardEntries ─────────────────────────────────────────────

describe("claimLeaderboardEntries — happy transfer", () => {
  it("transfers anon entries: user_id set, session_id NULL, everything else preserved", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    const before = await makeEntry({
      token: "t1.aaa",
      sessionId: "ses-anon",
      displayName: "Night Fox",
      verifiedScore: 123,
    });

    const r = await claimLeaderboardEntries({ sessionId: "ses-anon", userId: uid }, deps());
    expect(r).toEqual({ transferred: 1, dropped: 0 });

    const rows = await entriesOfUser(uid);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe(before.id);
    expect(row.sessionId).toBeNull();
    // The submit-time identity survives the claim verbatim.
    expect(row.displayName).toBe("Night Fox");
    expect(row.token).toBe("t1.aaa");
    expect(row.verifiedScore).toBe(123);
    expect(row.createdAt).toEqual(before.createdAt);
  });

  it("same-bucket collision is keep-both (best-per-identity resolves at read time)", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    // User already owns an entry in the same (season, mode, draft_mode)
    // bucket but with a DIFFERENT token → not a dedupe conflict.
    await makeEntry({ token: "t1.owned", userId: uid, verifiedScore: 200 });
    await makeEntry({
      token: "t1.anon",
      sessionId: "ses-anon",
      verifiedScore: 150,
    });

    const r = await claimLeaderboardEntries({ sessionId: "ses-anon", userId: uid }, deps());
    expect(r).toEqual({ transferred: 1, dropped: 0 });
    // Both rows retained under the user (plan §4: all accepted entries are
    // rows; the board picks the best per identity when reading).
    const rows = await entriesOfUser(uid);
    expect(rows.map((e) => e.token).sort()).toEqual(["t1.anon", "t1.owned"]);
  });

  it("hidden entries transfer with hidden_at preserved (moderation ⊥ ownership)", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    const hiddenAt = new Date("2026-06-01T00:00:00Z");
    await makeEntry({ token: "t1.hid", sessionId: "ses-anon", hiddenAt });

    await claimLeaderboardEntries({ sessionId: "ses-anon", userId: uid }, deps());
    const rows = await entriesOfUser(uid);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hiddenAt).toEqual(hiddenAt);
  });
});

describe("claimLeaderboardEntries — dedupe conflict resolution", () => {
  it("drops the anon duplicate when the user already owns the same (season, mode, token)", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    const owned = await makeEntry({
      token: "t1.dup",
      userId: uid,
      displayName: "Account Name",
      verifiedScore: 200,
    });
    // Same token as anon is insertable (NULLS NOT DISTINCT keys on user_id
    // too, and NULL ≠ uid)…
    await makeEntry({
      token: "t1.dup",
      sessionId: "ses-anon",
      displayName: "Anon Name",
      verifiedScore: 150,
    });
    // …but transferring it would collide; the drop step resolves it first.
    const r = await claimLeaderboardEntries({ sessionId: "ses-anon", userId: uid }, deps());
    expect(r).toEqual({ transferred: 0, dropped: 1 });

    // Account row wins, fully intact.
    const rows = await entriesOfUser(uid);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(owned.id);
    expect(rows[0]!.displayName).toBe("Account Name");
    expect(rows[0]!.verifiedScore).toBe(200);
  });

  it("same token in a DIFFERENT (season, mode) is not a conflict", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    await makeEntry({ token: "t1.x", userId: uid, seasonKey: "season-a" });
    await makeEntry({
      token: "t1.x",
      sessionId: "ses-anon",
      seasonKey: "season-b",
    });

    const r = await claimLeaderboardEntries({ sessionId: "ses-anon", userId: uid }, deps());
    expect(r).toEqual({ transferred: 1, dropped: 0 });
    expect(await entriesOfUser(uid)).toHaveLength(2);
  });
});

describe("claimLeaderboardEntries — multi-session + idempotence", () => {
  it("claims from two sessions accumulate under the same user", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-1" });
    await makeSession({ id: "ses-2" });
    await makeEntry({ token: "t1.s1", sessionId: "ses-1" });
    await makeEntry({ token: "t1.s2", sessionId: "ses-2" });

    const r1 = await claimLeaderboardEntries({ sessionId: "ses-1", userId: uid }, deps());
    const r2 = await claimLeaderboardEntries({ sessionId: "ses-2", userId: uid }, deps());
    expect(r1).toEqual({ transferred: 1, dropped: 0 });
    expect(r2).toEqual({ transferred: 1, dropped: 0 });
    expect(await entriesOfUser(uid)).toHaveLength(2);
  });

  it("second-session duplicate of an already-claimed token is dropped", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-1" });
    await makeSession({ id: "ses-2" });
    await makeEntry({ token: "t1.same", sessionId: "ses-1" });
    await claimLeaderboardEntries({ sessionId: "ses-1", userId: uid }, deps());
    // The anon (season, mode, NULL, token) slot is free again after the
    // claim, so a second session can submit the same token anonymously…
    await makeEntry({ token: "t1.same", sessionId: "ses-2" });
    // …and claiming that session drops it against the user's claimed row.
    const r2 = await claimLeaderboardEntries({ sessionId: "ses-2", userId: uid }, deps());
    expect(r2).toEqual({ transferred: 0, dropped: 1 });
    expect(await entriesOfUser(uid)).toHaveLength(1);
  });

  it("re-claim is a no-op: second call transfers and drops nothing", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    await makeEntry({ token: "t1.once", sessionId: "ses-anon" });

    const r1 = await claimLeaderboardEntries({ sessionId: "ses-anon", userId: uid }, deps());
    const r2 = await claimLeaderboardEntries({ sessionId: "ses-anon", userId: uid }, deps());
    expect(r1).toEqual({ transferred: 1, dropped: 0 });
    expect(r2).toEqual({ transferred: 0, dropped: 0 });
    expect(await entriesOfUser(uid)).toHaveLength(1);
  });
});

describe("claimLeaderboardEntries — constraint interplay + isolation", () => {
  it("anon ranked rows are structurally impossible (ranked CHECK), so transfers are casual-only", async () => {
    await makeSession({ id: "ses-anon" });
    await expectRejectsWithCause(
      makeEntry({ token: "t1.rk", sessionId: "ses-anon", mode: "ranked" }),
      /leaderboard_entries_ranked_user_chk/,
    );
  });

  it("a ranked user-bound row carrying the claiming session's id is untouched (no reassignment)", async () => {
    const claimant = await makeUser("a@example.com");
    const other = await makeUser("b@example.com");
    await makeSession({ id: "ses-anon" });
    // Ranked rows are always user-bound; even if one recorded this session
    // id, the transfer scope (user_id IS NULL) must never reassign it.
    const ranked = await makeEntry({
      token: "t1.rk2",
      sessionId: "ses-anon",
      userId: other,
      mode: "ranked",
    });

    const r = await claimLeaderboardEntries({ sessionId: "ses-anon", userId: claimant }, deps());
    expect(r).toEqual({ transferred: 0, dropped: 0 });
    const [row] = await env.db
      .select()
      .from(leaderboardEntries)
      .where(eq(leaderboardEntries.id, ranked.id));
    expect(row!.userId).toBe(other);
    expect(row!.sessionId).toBe("ses-anon");
  });

  it("swept-session entries (session_id NULL) are structurally unclaimable — intended", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    // Simulate the FK SET NULL sweep outcome: an orphaned public entry.
    await makeEntry({ token: "t1.swept", sessionId: null });

    const r = await claimLeaderboardEntries({ sessionId: "ses-anon", userId: uid }, deps());
    expect(r).toEqual({ transferred: 0, dropped: 0 });
    const orphans = await env.db
      .select()
      .from(leaderboardEntries)
      .where(and(isNull(leaderboardEntries.userId), isNull(leaderboardEntries.sessionId)));
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.token).toBe("t1.swept");
  });

  it("deleting the session row sweeps session_id to NULL but keeps the entry (FK SET NULL)", async () => {
    await makeSession({ id: "ses-gone" });
    const entry = await makeEntry({ token: "t1.fk", sessionId: "ses-gone" });
    await env.db.delete(sessions).where(eq(sessions.id, "ses-gone"));
    const [row] = await env.db
      .select()
      .from(leaderboardEntries)
      .where(eq(leaderboardEntries.id, entry.id));
    expect(row!.sessionId).toBeNull();
    expect(row!.userId).toBeNull();
  });

  it("cannot pull another session's anon entries (scope filter)", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-mine" });
    await makeSession({ id: "ses-theirs" });
    await makeEntry({ token: "t1.theirs", sessionId: "ses-theirs" });

    const r = await claimLeaderboardEntries({ sessionId: "ses-mine", userId: uid }, deps());
    expect(r).toEqual({ transferred: 0, dropped: 0 });
    expect(await entriesOfUser(uid)).toHaveLength(0);
  });
});

// ── claimAnonArtifacts — the combined F-3 claim moment ──────────────────

describe("claimAnonArtifacts — one transaction, two transfers", () => {
  async function seedBoth(sessionId: string) {
    await env.db.insert(savedRuns).values({
      sessionId,
      ownerUserId: null,
      token: "t1.run",
      versionAnchors: { dataset_version: "v1" },
      runId: "run-1",
      parentSeed: "seed-1",
      claimState: "anonymous",
    });
    await makeEntry({ token: "t1.board", sessionId });
  }

  it("transfers saved_runs AND leaderboard_entries in one claim moment", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    await seedBoth("ses-anon");

    const r = await claimAnonArtifacts({ sessionId: "ses-anon", userId: uid }, deps());
    expect(r).toEqual({
      runs: { transferred: 1, dropped: 0 },
      leaderboard: { transferred: 1, dropped: 0 },
    });

    const runs = await env.db.select().from(savedRuns).where(eq(savedRuns.ownerUserId, uid));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.sessionId).toBeNull();
    expect(runs[0]!.claimState).toBe("claimed");
    expect(await entriesOfUser(uid)).toHaveLength(1);
  });

  it("is idempotent as a unit: second sign-in transfers nothing on either table", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    await seedBoth("ses-anon");

    await claimAnonArtifacts({ sessionId: "ses-anon", userId: uid }, deps());
    const r2 = await claimAnonArtifacts({ sessionId: "ses-anon", userId: uid }, deps());
    expect(r2).toEqual({
      runs: { transferred: 0, dropped: 0 },
      leaderboard: { transferred: 0, dropped: 0 },
    });
  });

  it("partial failure rolls back BOTH transfers (saved_runs stays anon)", async () => {
    const uid = await makeUser("a@example.com");
    await makeSession({ id: "ses-anon" });
    await seedBoth("ses-anon");

    // Inject a failure into the SECOND transfer (leaderboard UPDATE) so a
    // commit would leave the runs transfer applied — the transaction must
    // prevent exactly that half-claimed state.
    await env.pg.exec(`
      CREATE OR REPLACE FUNCTION u6_test_fail_update() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'u6-injected-failure'; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER u6_fail_leaderboard_update
        BEFORE UPDATE ON leaderboard_entries
        FOR EACH ROW EXECUTE FUNCTION u6_test_fail_update();
    `);
    try {
      await expectRejectsWithCause(
        claimAnonArtifacts({ sessionId: "ses-anon", userId: uid }, deps()),
        /u6-injected-failure/,
      );

      // The runs transfer ran before the leaderboard failure — it must be
      // rolled back: row still anon, still claimable.
      const runs = await env.db.select().from(savedRuns).where(eq(savedRuns.sessionId, "ses-anon"));
      expect(runs).toHaveLength(1);
      expect(runs[0]!.ownerUserId).toBeNull();
      expect(runs[0]!.claimState).toBe("anonymous");
      expect(await entriesOfUser(uid)).toHaveLength(0);
    } finally {
      await env.pg.exec(`
        DROP TRIGGER u6_fail_leaderboard_update ON leaderboard_entries;
        DROP FUNCTION u6_test_fail_update();
      `);
    }

    // And the retry surface works once the fault clears.
    const retry = await claimAnonArtifacts({ sessionId: "ses-anon", userId: uid }, deps());
    expect(retry).toEqual({
      runs: { transferred: 1, dropped: 0 },
      leaderboard: { transferred: 1, dropped: 0 },
    });
  });
});
