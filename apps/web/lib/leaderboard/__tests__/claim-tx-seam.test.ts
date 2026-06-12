// UNIT 2 — typed transaction seam for the combined claim moment.
//
// The pglite-backed `claim.test.ts` proves the real-Postgres semantics. THIS
// file pins the *typed seam* `claimAnonArtifacts` opens: that both transfers
// run under ONE injected transaction handle, that a failure in the second
// transfer rolls the first back (atomicity), and that a Drizzle-style nested
// constraint error propagates through the seam unmodified (composing the #111
// `.cause`-chain handling, never reverting it).
//
// It uses a hand-rolled transaction DOUBLE rather than a database, so the
// rollback assertion is a direct observation of the seam's contract: if the
// production code stops routing both transfers through the single
// `deps.db.transaction(cb)` — or swallows the failure — these tests fail.
import { describe, it, expect } from "vitest";
import { savedRuns, leaderboardEntries } from "@wcdraft/db";
import { claimAnonArtifacts, type ClaimRunnerDeps } from "@/lib/leaderboard/claim";

// ── #111-style nested-cause walk (composed, not reverted) ───────────────────
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

type FailMode = "none" | "leaderboard-update" | "leaderboard-constraint";

/**
 * In-memory transaction double. `transaction(cb)` stages mutations and commits
 * them to `committed` ONLY if the callback resolves; a throw discards the
 * staged set (rollback). The tx handle implements exactly the `ClaimTx`
 * surface the claim path uses (`execute` + the `update→set→where→returning`
 * chain), dispatching on the Drizzle table object so it can tell the saved_runs
 * transfer from the leaderboard transfer.
 */
function makeFakeDb(failMode: FailMode = "none") {
  const committed = { runsTransferred: false, boardTransferred: false };

  function makeTx(staged: { runsTransferred: boolean; boardTransferred: boolean }) {
    const execute = async () => ({ rows: [] as { id: string }[] });
    const update = (table: unknown) => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            if (table === savedRuns) {
              staged.runsTransferred = true;
              return [{ id: "run-1" }];
            }
            if (table === leaderboardEntries) {
              if (failMode === "leaderboard-update") {
                throw new Error("u6-seam-injected-failure");
              }
              if (failMode === "leaderboard-constraint") {
                // Drizzle wraps the driver error: surface the constraint name
                // only on the nested `.cause`, exactly like the real path.
                const err = new Error("update failed");
                (err as { cause?: unknown }).cause = new Error(
                  "duplicate key value violates unique constraint " +
                    '"leaderboard_entries_dedupe_uq"',
                );
                throw err;
              }
              staged.boardTransferred = true;
              return [{ id: "board-1" }];
            }
            return [];
          },
        }),
      }),
    });
    return { execute, update };
  }

  const db = {
    committed,
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const staged = { runsTransferred: false, boardTransferred: false };
      const result = await cb(makeTx(staged));
      // Commit only reached when the callback resolved (no throw).
      committed.runsTransferred = staged.runsTransferred;
      committed.boardTransferred = staged.boardTransferred;
      return result;
    },
  };
  return db;
}

/** Inject the fake as the typed runner dependency (boundary cast, test-only). */
function depsOf(db: ReturnType<typeof makeFakeDb>): ClaimRunnerDeps {
  return { db: db as unknown as ClaimRunnerDeps["db"] };
}

const ARGS = { sessionId: "ses-seam", userId: "user-seam" };

describe("claimAnonArtifacts — typed transaction seam", () => {
  it("commit path: both transfers run under one injected tx and commit together", async () => {
    const db = makeFakeDb("none");
    const result = await claimAnonArtifacts(ARGS, depsOf(db));

    expect(result).toEqual({
      runs: { transferred: 1, dropped: 0 },
      leaderboard: { transferred: 1, dropped: 0 },
    });
    expect(db.committed).toEqual({ runsTransferred: true, boardTransferred: true });
  });

  it("rollback path: a failure in the leaderboard transfer rolls the runs transfer back", async () => {
    const db = makeFakeDb("leaderboard-update");

    await expect(claimAnonArtifacts(ARGS, depsOf(db))).rejects.toThrow(/u6-seam-injected-failure/);

    // The runs transfer staged inside the tx, but the leaderboard failure
    // aborted the callback before commit — neither table's change is durable.
    expect(db.committed).toEqual({ runsTransferred: false, boardTransferred: false });
  });

  it("constraint-violation path: the nested .cause surfaces through the seam (composes #111)", async () => {
    const db = makeFakeDb("leaderboard-constraint");

    let caught: unknown;
    try {
      await claimAnonArtifacts(ARGS, depsOf(db));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // The constraint name lives only on the nested cause — the #111 walk finds it.
    expect(errorMessages(caught).join("\n")).toMatch(/leaderboard_entries_dedupe_uq/);
    // And the whole moment rolled back.
    expect(db.committed).toEqual({ runsTransferred: false, boardTransferred: false });
  });
});
