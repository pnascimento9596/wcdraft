import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@wcdraft/db";

import { setupTestDb } from "./_test-db";
import { readPublicProfile, updateUsername } from "../profile";

const { db, pg, reset } = await setupTestDb();
afterAll(async () => pg.close());
beforeEach(async () => reset());

async function makeUser(email: string, username?: string): Promise<string> {
  const [u] = await db.insert(users).values({ email, username }).returning();
  return u!.id;
}

describe("public profile username", () => {
  it("normalizes trim + case before persisting", async () => {
    const userId = await makeUser("name@example.com");
    const result = await updateUsername(db, userId, "  Case_User  ");
    expect(result).toEqual({
      ok: true,
      profile: { user_id: userId, username: "case_user" },
    });
    expect(await readPublicProfile(db, userId)).toEqual({
      user_id: userId,
      username: "case_user",
    });
  });

  it("last write wins for the same user", async () => {
    const userId = await makeUser("rename@example.com", "first_name");
    const result = await updateUsername(db, userId, "second_name");
    expect(result).toEqual({
      ok: true,
      profile: { user_id: userId, username: "second_name" },
    });
  });

  it("case-variant collision is rejected after normalization", async () => {
    await makeUser("taken@example.com", "caseuser");
    const contender = await makeUser("contender@example.com");
    const result = await updateUsername(db, contender, "CaseUser");
    expect(result).toEqual({ ok: false, code: "USERNAME_TAKEN" });
  });

  it("rejects invalid and reserved usernames with category only", async () => {
    const userId = await makeUser("invalid@example.com");
    expect(await updateUsername(db, userId, "ab")).toEqual({
      ok: false,
      code: "INVALID_USERNAME",
      reason: "too_short",
    });
    expect(await updateUsername(db, userId, "admin")).toEqual({
      ok: false,
      code: "INVALID_USERNAME",
      reason: "blocked_term",
    });
    expect(await updateUsername(db, userId, "bad-name")).toEqual({
      ok: false,
      code: "INVALID_USERNAME",
      reason: "invalid_chars",
    });
  });

  it("readPublicProfile never returns email", async () => {
    const userId = await makeUser("private@example.com", "public_user");
    const profile = await readPublicProfile(db, userId);
    expect(profile).toEqual({ user_id: userId, username: "public_user" });
    expect(JSON.stringify(profile)).not.toContain("private@example.com");
    expect(JSON.stringify(profile)).not.toContain("email");
  });
});
