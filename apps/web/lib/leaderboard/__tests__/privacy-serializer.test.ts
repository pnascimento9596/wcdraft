import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leaderboardEntries, users } from "@wcdraft/db";

import { setupTestDb } from "../../auth/__tests__/_test-db";
import { boardPage, identityBoardRank, toApiEntryWithProfile } from "../store";

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());
beforeEach(async () => reset());

describe("leaderboard public serializers", () => {
  it("derive display_name from username fallback and never include email", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: "private-user@example.com", username: "public_user" })
      .returning();
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
        createdAt: new Date("2026-06-12T12:00:00.000Z"),
      })
      .returning();

    const apiEntry = await toApiEntryWithProfile(db, entry!);
    expect(apiEntry.display_name).toBe("public_user");
    expect(JSON.stringify(apiEntry)).not.toContain("private-user@example.com");
    expect(JSON.stringify(apiEntry)).not.toContain("email");

    const page = await boardPage(db, {
      seasonKey: "season-privacy",
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
        createdAt: new Date("2026-06-12T12:00:01.000Z"),
      },
    ]);

    const query = {
      seasonKey: "season-privacy",
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
