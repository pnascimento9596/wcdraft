import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { leaderboardEntries, sessions, users } from "@wcdraft/db";

import { setupTestDb } from "@/lib/auth/__tests__/_test-db";
import { saveRun } from "@/lib/game/saved-runs-store";
import { readAccountRunsPage } from "@/lib/account/runs";

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

async function makeSession(id: string, userId: string): Promise<void> {
  await env.db.insert(sessions).values({
    id,
    userId,
    csrfSecret: "csrf-secret-for-test-only",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
}

const summary = {
  team_name: "Account XI",
  display_record: "8-0",
  score: 108,
  wins: 8,
  draws: 0,
  losses: 0,
  undefeated_regulation: true,
  formation_name: "4-3-3",
  draft_mode: "classic" as const,
  draft_order: "squad_first" as const,
  era_preset: "all_time" as const,
  rating_basis: "career" as const,
  key_picks: [{ name: "Marta", nation_code: "BRA" }],
  is_champion: true,
  is_perfect_eight_zero: true,
  reached_round: "F",
  matches_played: 8,
  challenge_date: "2026-06-30",
  seed: "seed-1",
};

describe("account runs", () => {
  it("returns only the caller's account runs and caller-scoped posted badges", async () => {
    const a = await makeUser("a@example.com");
    const b = await makeUser("b@example.com");
    await makeSession("ses-a", a);
    await makeSession("ses-b", b);
    await saveRun(
      {
        token: "t1.a",
        versionAnchors: null,
        runId: "run-a",
        parentSeed: "seed-a",
        summary,
      },
      { userId: a, sessionId: "ses-a" },
      { db: env.db, now: () => Date.UTC(2026, 5, 30, 1, 0, 0) },
    );
    await saveRun(
      {
        token: "t1.b",
        versionAnchors: null,
        runId: "run-b",
        parentSeed: "seed-b",
        summary: { ...summary, team_name: "Other XI", score: 1 },
      },
      { userId: b, sessionId: "ses-b" },
      { db: env.db, now: () => Date.UTC(2026, 5, 30, 2, 0, 0) },
    );
    await env.db.insert(leaderboardEntries).values({
      seasonKey: "season",
      mode: "casual",
      draftMode: "classic",
      draftOrder: "squad_first",
      era: "all_time",
      ratingBasis: "career",
      userId: a,
      displayAlias: "player_a",
      token: "t1.a",
      verifiedScore: 108,
      scoreBreakdown: [],
    });

    const page = await readAccountRunsPage(env.db, a, { limit: 25 });
    expect(page.identity.email).toBe("a@example.com");
    expect(page.runs).toHaveLength(1);
    expect(page.runs[0]).toMatchObject({
      teamName: "Account XI",
      postedToLeaderboard: true,
      score: 108,
      perfectRun: true,
    });
    expect(page.stats).toMatchObject({
      totalRuns: 1,
      bestScore: 108,
      perfectRunCount: 1,
      todayBest: 108,
    });
  });
});
