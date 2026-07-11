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
  requestPasswordResetMagicLink,
  verifyMagicLink,
  MAGIC_LINK_TTL_MS,
  MAGIC_LINK_RATE_PER_EMAIL,
  MAGIC_LINK_RATE_PER_IP,
  PASSWORD_RESET_RESPONSE_TARGET_MS,
} from "@/lib/auth/magic-link";
import { LogEmailSender, RESEND_TIMEOUT_MS, type EmailSender } from "@/lib/auth/email";
import { RequestTimeoutError } from "@wcdraft/data/client";
import { sha256Hex } from "@/lib/auth/tokens";
import { authRateLimits, magicLinkTokens, users } from "@wcdraft/db";
import { eq } from "drizzle-orm";

let env: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  env = await setupTestDb();
});
afterEach(async () => {
  vi.useRealTimers();
  await env.reset();
});

function makeDeps(args: {
  now: number;
  sender?: EmailSender;
  passwordResetResponseTargetMs?: number;
}) {
  return {
    db: env.db,
    now: () => args.now,
    sender: args.sender ?? new LogEmailSender(() => undefined),
    verifyBaseUrl: "https://wcdraft.com",
    fromAddress: "wcdraft <onboarding@resend.dev>",
    passwordResetResponseTargetMs: args.passwordResetResponseTargetMs ?? 0,
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

  it("checks the IP quota first so a blocked source cannot poison a victim identifier", async () => {
    const now = Date.UTC(2026, 5, 1);
    const sender = new LogEmailSender(() => undefined);
    const attackingIp = "203.0.113.9";
    for (let index = 0; index < 40; index += 1) {
      const request = requestMagicLink(
        {
          email: index === 39 ? "victim@example.com" : `decoy-${index.toString()}@example.com`,
          ipAddress: attackingIp,
        },
        makeDeps({ now, sender }),
      );
      if (index < MAGIC_LINK_RATE_PER_IP.maxCount) await request;
      else await expect(request).rejects.toMatchObject({ code: "RATE_LIMITED" });
    }

    const rowsAfterAttack = await env.db.select().from(authRateLimits);
    expect(rowsAfterAttack.filter((row) => row.bucketKey.startsWith("email:"))).toHaveLength(
      MAGIC_LINK_RATE_PER_IP.maxCount,
    );

    // The victim still has the full identifier allowance from a legitimate source.
    for (let index = 0; index < MAGIC_LINK_RATE_PER_EMAIL.maxCount; index += 1) {
      await requestMagicLink(
        { email: "victim@example.com", ipAddress: `198.51.100.${index.toString()}` },
        makeDeps({ now, sender }),
      );
    }
  });

  it("deletes an undelivered sign-in token when the sender fails", async () => {
    const sender: EmailSender = {
      kind: "resend",
      sendMagicLink: async () => {
        throw new Error("provider failed for user@example.com");
      },
    };
    await expect(
      requestMagicLink(
        { email: "user@example.com", ipAddress: "1.1.1.1" },
        makeDeps({ now: Date.UTC(2026, 5, 1), sender }),
      ),
    ).rejects.toThrow("provider failed");
    expect(await env.db.select().from(magicLinkTokens)).toHaveLength(0);
  });

  it("keeps a delivered sign-in token usable when delivery bookkeeping fails", async () => {
    const now = Date.UTC(2026, 5, 1);
    const sender = new LogEmailSender(() => undefined);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await env.pg.exec(`
      CREATE OR REPLACE FUNCTION fail_delivered_bookkeeping() RETURNS trigger AS $$
      BEGIN
        IF OLD.delivery_status = 'pending' AND NEW.delivery_status = 'delivered' THEN
          RAISE EXCEPTION 'injected-delivery-bookkeeping-failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_delivered_bookkeeping_update
        BEFORE UPDATE ON magic_link_tokens
        FOR EACH ROW EXECUTE FUNCTION fail_delivered_bookkeeping();
    `);
    try {
      await expect(
        requestMagicLink(
          { email: "user@example.com", ipAddress: "1.1.1.1" },
          makeDeps({ now, sender }),
        ),
      ).resolves.toBeDefined();
      const rawToken = new URL(sender.lastSent!.magicLinkUrl).searchParams.get("token")!;
      const [row] = await env.db.select().from(magicLinkTokens);
      expect(row?.deliveryStatus).toBe("pending");
      await expect(
        verifyMagicLink({ token: rawToken }, { db: env.db, now: () => now + 1 }),
      ).resolves.toMatchObject({ user: { email: "user@example.com" } });
      expect(JSON.stringify(spy.mock.calls)).toContain("AUTH_EMAIL_BOOKKEEPING_FAILED");
    } finally {
      await env.pg.exec(`
        DROP TRIGGER fail_delivered_bookkeeping_update ON magic_link_tokens;
        DROP FUNCTION fail_delivered_bookkeeping();
      `);
      spy.mockRestore();
    }
  });

  it("records reset delivery truth without logging the target address", async () => {
    const now = Date.UTC(2026, 5, 1);
    await env.db.insert(users).values({ email: "victim@example.com" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sender: EmailSender = {
      kind: "resend",
      sendMagicLink: async () => {
        throw new Error("database/provider detail victim@example.com");
      },
    };
    try {
      const result = await requestPasswordResetMagicLink(
        { email: "victim@example.com", ipAddress: "1.1.1.1" },
        { ...makeDeps({ now }), sender },
      );
      expect(result).toMatchObject({ eligible: true, requested: true, delivered: false });
      const [row] = await env.db.select().from(magicLinkTokens);
      expect(row).toMatchObject({ purpose: "reset", deliveryStatus: "failed" });
      expect(row?.deliveryCorrelationId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(JSON.stringify(spy.mock.calls)).not.toContain("victim@example.com");
    } finally {
      spy.mockRestore();
    }
  });

  it("records a successful reset provider outcome as delivered", async () => {
    const now = Date.UTC(2026, 5, 1);
    await env.db.insert(users).values({ email: "delivered@example.com" });
    const result = await requestPasswordResetMagicLink(
      { email: "delivered@example.com", ipAddress: "1.1.1.1" },
      makeDeps({ now }),
    );
    expect(result).toMatchObject({ eligible: true, requested: true, delivered: true });
    const [row] = await env.db.select().from(magicLinkTokens);
    expect(row?.deliveryStatus).toBe("delivered");
  });

  it("records an ambiguous provider timeout as unknown, not failed", async () => {
    const now = Date.UTC(2026, 5, 1);
    await env.db.insert(users).values({ email: "timeout@example.com" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sender: EmailSender = {
      kind: "resend",
      sendMagicLink: async () => {
        throw new RequestTimeoutError({
          operation: "auth-email-send",
          timeoutMs: RESEND_TIMEOUT_MS,
          safety: "unsafe-mutation",
        });
      },
    };
    try {
      const result = await requestPasswordResetMagicLink(
        { email: "timeout@example.com", ipAddress: "1.1.1.1" },
        makeDeps({ now, sender }),
      );
      expect(result).toMatchObject({ eligible: true, requested: true, delivered: false });
      const [row] = await env.db.select().from(magicLinkTokens);
      expect(row?.deliveryStatus).toBe("unknown");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not send to nonexistent accounts and normalizes reset response timing", async () => {
    expect(PASSWORD_RESET_RESPONSE_TARGET_MS).toBe(RESEND_TIMEOUT_MS + 500);
    const now = Date.UTC(2026, 5, 1);
    await env.db.insert(users).values({ email: "existing@example.com" });
    const sent: string[] = [];
    const sender: EmailSender = {
      kind: "resend",
      sendMagicLink: async ({ toEmail }) => {
        sent.push(toEmail);
        await new Promise((resolve) => setTimeout(resolve, 300));
      },
    };
    vi.useFakeTimers();
    const targetMs = 1_000;
    const completedAt: number[] = [];
    const existing = requestPasswordResetMagicLink(
      { email: "existing@example.com", ipAddress: "1.1.1.1" },
      makeDeps({ now, sender, passwordResetResponseTargetMs: targetMs }),
    ).then(() => completedAt.push(performance.now()));
    const missing = requestPasswordResetMagicLink(
      { email: "missing@example.com", ipAddress: "2.2.2.2" },
      makeDeps({ now, sender, passwordResetResponseTargetMs: targetMs }),
    ).then(() => completedAt.push(performance.now()));

    await vi.advanceTimersByTimeAsync(targetMs - 1);
    expect(completedAt).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([existing, missing]);
    expect(completedAt).toEqual([targetMs, targetMs]);
    expect(sent).toEqual(["existing@example.com"]);
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

  it("marks an existing magic-link account verified when the link is consumed", async () => {
    const t = Date.UTC(2026, 5, 1);
    await env.db.insert(users).values({ email: "verify-existing@example.com" });
    const { rawToken } = await issueToken({ now: t, email: "verify-existing@example.com" });

    const { user } = await verifyMagicLink({ token: rawToken }, { db: env.db, now: () => t + 1 });

    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    const [row] = await env.db
      .select({ emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, "verify-existing@example.com"));
    expect(row?.emailVerifiedAt).toBeInstanceOf(Date);
  });
});
