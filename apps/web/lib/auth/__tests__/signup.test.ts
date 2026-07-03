import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@wcdraft/db";

import { setupTestDb } from "./_test-db";
import { createPasswordAccount } from "../signup";
import { verifyPasswordHash } from "../passwords";

let env: Awaited<ReturnType<typeof setupTestDb>>;
const NOW = Date.UTC(2026, 6, 3, 12, 0, 0);

beforeAll(async () => {
  env = await setupTestDb();
});
afterAll(async () => env.pg.close());
afterEach(async () => env.reset());

describe("password-first sign-up", () => {
  it("creates an unverified account with normalized username, email, and argon2 password", async () => {
    const result = await createPasswordAccount(
      {
        username: "Manager_10",
        email: "NEW@Example.COM",
        password: "Strong signup 42!",
      },
      { db: env.db, now: () => NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected sign-up success");
    expect(result.user).toMatchObject({
      email: "new@example.com",
      username: "manager_10",
      emailVerifiedAt: null,
    });
    expect(result.user.passwordHash).toContain("$argon2id$");
    await expect(verifyPasswordHash(result.user.passwordHash, "Strong signup 42!")).resolves.toBe(
      true,
    );
  });

  it("rejects duplicate username, duplicate email, blocklisted username, and weak password", async () => {
    await env.db.insert(users).values({ email: "taken@example.com", username: "taken_user" });

    await expectResult(
      createPasswordAccount(
        { username: "other_user", email: "taken@example.com", password: "Strong signup 42!" },
        { db: env.db, now: () => NOW },
      ),
      "EMAIL_TAKEN",
    );
    await expectResult(
      createPasswordAccount(
        { username: "taken_user", email: "new@example.com", password: "Strong signup 42!" },
        { db: env.db, now: () => NOW },
      ),
      "USERNAME_TAKEN",
    );
    await expectResult(
      createPasswordAccount(
        { username: "admin", email: "blocked@example.com", password: "Strong signup 42!" },
        { db: env.db, now: () => NOW },
      ),
      "INVALID_USERNAME",
    );
    await expectResult(
      createPasswordAccount(
        { username: "weak_user", email: "weak@example.com", password: "password" },
        { db: env.db, now: () => NOW },
      ),
      "PASSWORD_WEAK",
    );

    const rows = await env.db.select().from(users).where(eq(users.email, "new@example.com"));
    expect(rows).toHaveLength(0);
  });
});

async function expectResult(
  action: Promise<Awaited<ReturnType<typeof createPasswordAccount>>>,
  code: string,
): Promise<void> {
  const result = await action;
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected sign-up rejection");
  expect(result.code).toBe(code);
}
