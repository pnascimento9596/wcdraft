import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leaderboardEntries, rankedAttempts, users } from "@wcdraft/db";

import { setupTestDb } from "../../auth/__tests__/_test-db";
import { boardPage, identityBoardRank, toApiEntryWithProfile } from "../store";

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());

let attemptSeq = 0;
const ATTEMPT_CONSUMED_AT = new Date("2026-06-12T12:30:00.000Z");
beforeEach(async () => {
  await reset();
  attemptSeq = 0;
});

async function issueRankedAttempt(userId: string, seed: string): Promise<string> {
  attemptSeq += 1;
  const [attempt] = await db
    .insert(rankedAttempts)
    .values({
      userId,
      sessionId: null,
      seasonKey: "season-privacy",
      formationId: "4-3-3",
      draftMode: "classic",
      draftOrder: "squad_first",
      era: "all_time",
      ratingBasis: "career",
      issuedParentSeed: seed,
      nonce: `nonce-privacy-${String(attemptSeq).padStart(4, "0")}`,
      issuedAt: new Date("2026-06-12T12:00:00.000Z"),
      windowExpiresAt: new Date("2026-06-12T13:00:00.000Z"),
      consumedAt: ATTEMPT_CONSUMED_AT,
    })
    .returning();
  return attempt!.id;
}

describe("leaderboard public serializers", () => {
  it("derive display_name from username fallback and never include email", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: "private-user@example.com", username: "public_user" })
      .returning();
    const attemptId = await issueRankedAttempt(user!.id, "seed-privacy");
    const [entry] = await db
      .insert(leaderboardEntries)
      .values({
        seasonKey: "season-privacy",
        mode: "ranked",
        draftMode: "classic",
        draftOrder: "squad_first",
        era: "all_time",
        ratingBasis: "career",
        userId: user!.id,
        sessionId: null,
        displayAlias: null,
        token: "t1.privacy",
        verifiedScore: 88,
        scoreBreakdown: [],
        attemptId,
        attemptFormationId: "4-3-3",
        attemptConsumedAt: ATTEMPT_CONSUMED_AT,
        createdAt: new Date("2026-06-12T12:00:00.000Z"),
      })
      .returning();

    const apiEntry = await toApiEntryWithProfile(db, entry!);
    expect(apiEntry.display_name).toBe("public_user");
    expect(JSON.stringify(apiEntry)).not.toContain("private-user@example.com");
    expect(JSON.stringify(apiEntry)).not.toContain("email");

    const page = await boardPage(db, {
      seasonKey: "season-privacy",
      challengeType: "season",
      challengeDate: null,
      mode: "ranked",
      draftMode: "classic",
      draftOrder: "squad_first",
      era: "all_time",
      ratingBasis: "career",
      limit: 10,
      cursor: null,
    });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]!.display_name).toBe("public_user");
    expect(JSON.stringify(page)).not.toContain("private-user@example.com");
    expect(JSON.stringify(page)).not.toContain("email");
  });

  it("skips public board rows whose account has no username or alias", async () => {
    const [goodUser, badUser] = await db
      .insert(users)
      .values([
        { email: "good-public@example.com", username: "good_public" },
        { email: "missing-public@example.com", username: null },
      ])
      .returning();
    const badAttemptId = await issueRankedAttempt(badUser!.id, "seed-missing-public");
    const goodAttemptId = await issueRankedAttempt(goodUser!.id, "seed-good-public");
    await db.insert(leaderboardEntries).values([
      {
        seasonKey: "season-privacy",
        mode: "ranked",
        draftMode: "classic",
        draftOrder: "squad_first",
        era: "all_time",
        ratingBasis: "career",
        userId: badUser!.id,
        sessionId: null,
        displayAlias: null,
        token: "t1.missing-public",
        verifiedScore: 99,
        scoreBreakdown: [],
        attemptId: badAttemptId,
        attemptFormationId: "4-3-3",
        attemptConsumedAt: ATTEMPT_CONSUMED_AT,
        createdAt: new Date("2026-06-12T12:00:00.000Z"),
      },
      {
        seasonKey: "season-privacy",
        mode: "ranked",
        draftMode: "classic",
        draftOrder: "squad_first",
        era: "all_time",
        ratingBasis: "career",
        userId: goodUser!.id,
        sessionId: null,
        displayAlias: null,
        token: "t1.good-public",
        verifiedScore: 88,
        scoreBreakdown: [],
        attemptId: goodAttemptId,
        attemptFormationId: "4-3-3",
        attemptConsumedAt: ATTEMPT_CONSUMED_AT,
        createdAt: new Date("2026-06-12T12:00:01.000Z"),
      },
    ]);

    const query = {
      seasonKey: "season-privacy",
      challengeType: "season" as const,
      challengeDate: null,
      mode: "ranked" as const,
      draftMode: "classic" as const,
      draftOrder: "squad_first" as const,
      era: "all_time" as const,
      ratingBasis: "career" as const,
    };
    const page = await boardPage(db, { ...query, limit: 10, cursor: null });
    expect(page.rows.map((row) => row.display_name)).toEqual(["good_public"]);
    await expect(
      identityBoardRank(db, {
        ...query,
        identityKey: badUser!.id,
      }),
    ).resolves.toBeNull();
  });
});
