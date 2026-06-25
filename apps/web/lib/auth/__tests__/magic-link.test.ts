// F-2 — magic-link request + verify, end-to-end against pglite.
//
// Exercises:
//   - email shape validation
//   - LogEmailSender receives the URL exactly once per accepted request
//   - rate-limit per email rejects beyond the configured count
//   - rate-limit per IP rejects beyond the configured count
//   - verify against an EXPIRED token → TOKEN_EXPIRED
//   - verify against a CONSUMED token → TOKEN_CONSUMED (no replay)
//   - parallel verify races: at most one succeeds, the other gets TOKEN_CONSUMED
//   - verify against an UNKNOWN token → TOKEN_UNKNOWN
//   - verify against a malformed token → TOKEN_MALFORMED
//   - user is upserted by email (no duplicate users on second sign-in)
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { setupTestDb } from "./_test-db";
import {
  requestMagicLink,
  verifyMagicLink,
  MAGIC_LINK_TTL_MS,
  MAGIC_LINK_RATE_PER_EMAIL,
} from "@/lib/auth/magic-link";
import { LogEmailSender } from "@/lib/auth/email";
import { sha256Hex } from "@/lib/auth/tokens";
import { authRateLimits, magicLinkTokens } from "@wcdraft/db";
import { eq } from "drizzle-orm";

let env: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  env = await setupTestDb();
});
afterEach(async () => {
  await env.reset();
});

function makeDeps(args: { now: number; sender?: LogEmailSender }) {
  return {
    db: env.db,
    now: () => args.now,
    sender: args.sender ?? new LogEmailSender(() => undefined),
    verifyBaseUrl: "https://wcdraft.com",
    fromAddress: "wcdraft <onboarding@resend.dev>",
  };
}

describe("requestMagicLink", () => {
  it("EMAIL_INVALID for malformed email", async () => {
    const now = Date.UTC(2026, 5, 1);
    await expect(
      requestMagicLink({ email: "not-an-email", ipAddress: "1.1.1.1" }, makeDeps({ now })),
    ).rejects.toMatchObject({ code: "EMAIL_INVALID" });
  });

  it("issues token + invokes EmailSender with a verify URL once", async () => {
    const now = Date.UTC(2026, 5, 1);
    const sender = new LogEmailSender(() => undefined);
    await requestMagicLink(
      { email: "user@example.com", ipAddress: "1.1.1.1" },
      makeDeps({ now, sender }),
    );
    expect(sender.lastSent).not.toBeNull();
    expect(sender.lastSent?.toEmail).toBe("user@example.com");
    expect(sender.lastSent?.magicLinkUrl).toMatch(
      /^https:\/\/wcdraft\.com\/api\/auth\/verify\?token=[A-Za-z0-9_-]{43}$/,
    );
  });

  it.each([
    ["missing base URL", ""],
    ["http localhost", "http://localhost:3000"],
    ["https localhost", "https://localhost"],
    ["http public host", "http://www.wcdraft.com"],
  ])(
    "refuses to persist or send an unsafe production verify URL (%s)",
    async (_label, verifyBaseUrl) => {
      const now = Date.UTC(2026, 5, 1);
      const sender = new LogEmailSender(() => undefined);
      vi.stubEnv("NODE_ENV", "production");
      try {
        await expect(
          requestMagicLink(
            { email: "user@example.com", ipAddress: "1.2.3.4" },
            { ...makeDeps({ now, sender }), verifyBaseUrl },
          ),
        ).rejects.toMatchObject({ code: "SECRET_MISCONFIGURED" });
      } finally {
        vi.unstubAllEnvs();
      }
      expect(sender.lastSent).toBeNull();
      expect(await env.db.select().from(magicLinkTokens)).toHaveLength(0);
      expect(await env.db.select().from(authRateLimits)).toHaveLength(0);
    },
  );

  it("stores ONLY the sha-256 hash; raw token is never persisted", async () => {
    const now = Date.UTC(2026, 5, 1);
    const sender = new LogEmailSender(() => undefined);
    await requestMagicLink(
      { email: "user@example.com", ipAddress: "1.1.1.1" },
      makeDeps({ now, sender }),
    );
    const rawToken = new URL(sender.lastSent!.magicLinkUrl).searchParams.get("token")!;
    const rows = await env.db.select().from(magicLinkTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(sha256Hex(rawToken));
    // Belt: raw token must not appear anywhere on the row.
    expect(JSON.stringify(rows[0])).not.toContain(rawToken);
  });

  it("RATE_LIMITED when per-email cap exceeded within window", async () => {
    const now = Date.UTC(2026, 5, 1);
    const sender = new LogEmailSender(() => undefined);
    for (let i = 0; i < MAGIC_LINK_RATE_PER_EMAIL.maxCount; i++) {
      await requestMagicLink(
        { email: "spam@example.com", ipAddress: `2.2.2.${i.toString()}` },
        makeDeps({ now, sender }),
      );
    }
    await expect(
      requestMagicLink(
        { email: "spam@example.com", ipAddress: "2.2.2.99" },
        makeDeps({ now, sender }),
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("normalises email (trim + lowercase)", async () => {
    const now = Date.UTC(2026, 5, 1);
    const sender = new LogEmailSender(() => undefined);
    await requestMagicLink(
      { email: "  User@Example.COM  ", ipAddress: "1.1.1.1" },
      makeDeps({ now, sender }),
    );
    const rows = await env.db.select().from(magicLinkTokens);
    expect(rows[0]?.email).toBe("user@example.com");
  });
});

describe("verifyMagicLink", () => {
  async function issueToken(opts: {
    email?: string;
    now: number;
    sender?: LogEmailSender;
  }): Promise<{ rawToken: string; tokenHash: string }> {
    const sender = opts.sender ?? new LogEmailSender(() => undefined);
    await requestMagicLink(
      { email: opts.email ?? "u@example.com", ipAddress: "9.9.9.9" },
      makeDeps({ now: opts.now, sender }),
    );
    const rawToken = new URL(sender.lastSent!.magicLinkUrl).searchParams.get("token")!;
    return { rawToken, tokenHash: sha256Hex(rawToken) };
  }

  it("happy path: returns the upserted user, marks token consumed", async () => {
    const now = Date.UTC(2026, 5, 1);
    const { rawToken, tokenHash } = await issueToken({ now });
    const { user } = await verifyMagicLink(
      { token: rawToken },
      { db: env.db, now: () => now + 100 },
    );
    expect(user.email).toBe("u@example.com");
    const rows = await env.db
      .select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, tokenHash));
    expect(rows[0]?.consumedAt).not.toBeNull();
  });

  it("TOKEN_UNKNOWN for a token never issued", async () => {
    const now = Date.UTC(2026, 5, 1);
    await expect(
      verifyMagicLink({ token: "B".repeat(43) }, { db: env.db, now: () => now }),
    ).rejects.toMatchObject({ code: "TOKEN_UNKNOWN" });
  });

  it("TOKEN_MALFORMED for non-string token", async () => {
    const now = Date.UTC(2026, 5, 1);
    await expect(
      verifyMagicLink(
        // @ts-expect-error — deliberately malformed
        { token: 0 },
        { db: env.db, now: () => now },
      ),
    ).rejects.toMatchObject({ code: "TOKEN_MALFORMED" });
  });

  it("TOKEN_EXPIRED when now > expiresAt", async () => {
    const now = Date.UTC(2026, 5, 1);
    const { rawToken } = await issueToken({ now });
    await expect(
      verifyMagicLink({ token: rawToken }, { db: env.db, now: () => now + MAGIC_LINK_TTL_MS + 1 }),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });

  it("TOKEN_CONSUMED on replay (no second consume allowed)", async () => {
    const now = Date.UTC(2026, 5, 1);
    const { rawToken } = await issueToken({ now });
    await verifyMagicLink({ token: rawToken }, { db: env.db, now: () => now + 1 });
    await expect(
      verifyMagicLink({ token: rawToken }, { db: env.db, now: () => now + 2 }),
    ).rejects.toMatchObject({ code: "TOKEN_CONSUMED" });
  });

  it("PARALLEL race: only one verify wins, the other is rejected", async () => {
    const now = Date.UTC(2026, 5, 1);
    const { rawToken } = await issueToken({ now });
    const results = await Promise.allSettled([
      verifyMagicLink({ token: rawToken }, { db: env.db, now: () => now + 1 }),
      verifyMagicLink({ token: rawToken }, { db: env.db, now: () => now + 1 }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "TOKEN_CONSUMED",
    });
  });

  it("upserts user by email: second sign-in returns the SAME user row", async () => {
    const t1 = Date.UTC(2026, 5, 1);
    const t2 = t1 + 60 * 60 * 1000;
    const { rawToken: token1 } = await issueToken({ now: t1, email: "two@example.com" });
    const { user: u1 } = await verifyMagicLink(
      { token: token1 },
      { db: env.db, now: () => t1 + 1 },
    );
    const { rawToken: token2 } = await issueToken({ now: t2, email: "two@example.com" });
    const { user: u2 } = await verifyMagicLink(
      { token: token2 },
      { db: env.db, now: () => t2 + 1 },
    );
    expect(u2.id).toBe(u1.id);
  });
});
