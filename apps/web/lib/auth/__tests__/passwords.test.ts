import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { authRateLimits, users } from "@wcdraft/db";

import { setupTestDb } from "./_test-db";
import type { AuthError } from "../errors";
import { authenticatePassword, hashPassword, validatePasswordStrength } from "../passwords";
import { consumeRateLimit } from "../rate-limit";
import { PASSWORD_RATE_PER_IP } from "../passwords";

let env: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  env = await setupTestDb();
});
afterEach(async () => {
  await env.reset();
});

const deps = () => ({ db: env.db, now: () => Date.UTC(2026, 5, 30, 12, 0, 0) });

describe("password auth", () => {
  it("hashes with argon2id and authenticates a correct password", async () => {
    const passwordHash = await hashPassword("Long-enough-42");
    expect(passwordHash).toContain("$argon2id$");
    const [user] = await env.db
      .insert(users)
      .values({ email: "a@example.com", passwordHash })
      .returning();

    const result = await authenticatePassword(
      { identifier: "A@example.com", password: "Long-enough-42", ipAddress: "127.0.0.1" },
      deps(),
    );
    expect(result.user.id).toBe(user!.id);
  });

  it("authenticates by username with the same password path", async () => {
    const passwordHash = await hashPassword("Long-enough-42");
    const [user] = await env.db
      .insert(users)
      .values({ email: "username-login@example.com", username: "user_login", passwordHash })
      .returning();

    const result = await authenticatePassword(
      { identifier: "USER_LOGIN", password: "Long-enough-42", ipAddress: "127.0.0.5" },
      deps(),
    );
    expect(result.user.id).toBe(user!.id);
  });

  it("returns the same generic 401 for wrong password and no-password account", async () => {
    const passwordHash = await hashPassword("Long-enough-42");
    await env.db.insert(users).values({ email: "has@example.com", passwordHash });
    await env.db.insert(users).values({ email: "magic@example.com" });

    await expect(
      authenticatePassword(
        { identifier: "has@example.com", password: "Wrong-enough-42", ipAddress: "127.0.0.2" },
        deps(),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      status: 401,
    } satisfies Partial<AuthError>);
    await expect(
      authenticatePassword(
        { identifier: "magic@example.com", password: "Wrong-enough-42", ipAddress: "127.0.0.3" },
        deps(),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      status: 401,
    } satisfies Partial<AuthError>);
    await expect(
      authenticatePassword(
        { identifier: "missing_user", password: "Wrong-enough-42", ipAddress: "127.0.0.6" },
        deps(),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      status: 401,
    } satisfies Partial<AuthError>);
  });

  it("rate-limits repeated password attempts and recovers next window", async () => {
    for (let i = 0; i < 11; i += 1) {
      const action = authenticatePassword(
        { identifier: "none@example.com", password: "Wrong-enough-42", ipAddress: "127.0.0.4" },
        deps(),
      );
      if (i < 10) {
        await expect(action).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
      } else {
        await expect(action).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
      }
    }

    await expect(
      authenticatePassword(
        { identifier: "none@example.com", password: "Wrong-enough-42", ipAddress: "127.0.0.4" },
        { db: env.db, now: () => Date.UTC(2026, 5, 30, 12, 16, 0) },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("does not consume a victim identifier bucket after the source IP is blocked", async () => {
    const now = Date.UTC(2026, 5, 30, 12, 0, 0);
    const blockedIp = "203.0.113.200";
    for (let index = 0; index < PASSWORD_RATE_PER_IP.maxCount; index += 1) {
      await consumeRateLimit(
        {
          bucket: { kind: "password-ip-15m", value: blockedIp },
          ...PASSWORD_RATE_PER_IP,
        },
        { db: env.db, now: () => now },
      );
    }
    await expect(
      authenticatePassword(
        { identifier: "victim@example.com", password: "Wrong-enough-42", ipAddress: blockedIp },
        { db: env.db, now: () => now },
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const rows = await env.db.select().from(authRateLimits);
    expect(rows.filter((row) => row.bucketKey.startsWith("password-email-15m:"))).toHaveLength(0);

    await expect(
      authenticatePassword(
        {
          identifier: "victim@example.com",
          password: "Wrong-enough-42",
          ipAddress: "198.51.100.200",
        },
        { db: env.db, now: () => now },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("rejects weak passwords with actionable reasons", () => {
    expect(validatePasswordStrength("password", "a@example.com")).toMatch(/10/);
    expect(validatePasswordStrength("password1234", "a@example.com")).toMatch(/obvious/);
    expect(validatePasswordStrength("Long-enough-42", "a@example.com")).toBeNull();
  });
});
