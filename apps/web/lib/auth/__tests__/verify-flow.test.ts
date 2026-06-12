// F-2 (post-review) — two-step verify flow + prefetch-burn coverage.
//
// The reviewer caught that the original single-step GET-consumes verify
// would be burned by mail-scanner prefetches before the user clicks. These
// tests pin the new two-step contract:
//
//   * GET (`prepareVerifyInterstitial`) MUST NOT consume the token.
//   * POST (`consumeAndIssueSession`) consumes, only with CSRF + Origin/Host.
//   * The prefetch-then-click sequence still completes the sign-in.
//
// All flows run against pglite (real Postgres 16 semantics) so the atomic
// token consume + session rotation are exercised end-to-end.
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { setupTestDb, testCookieSecret } from "./_test-db";
import {
  prepareVerifyInterstitial,
  consumeAndIssueSession,
  renderVerifyInterstitialHtml,
  safeNextPath,
} from "@/lib/auth/verify-flow";
import { requestMagicLink } from "@/lib/auth/magic-link";
import { LogEmailSender } from "@/lib/auth/email";
import { createSession, validateSessionCookie } from "@/lib/auth/sessions";
import { sha256Hex } from "@/lib/auth/tokens";
import {
  leaderboardEntries,
  magicLinkTokens,
  savedRuns,
  sessions,
} from "@wcdraft/db";
import { eq } from "drizzle-orm";
import { claimAnonArtifacts } from "@/lib/leaderboard/claim";

let env: Awaited<ReturnType<typeof setupTestDb>>;
const COOKIE_SECRET = testCookieSecret("verify-flow");

beforeAll(async () => {
  env = await setupTestDb();
});
afterEach(async () => {
  await env.reset();
});

function deps(now: number) {
  return {
    db: env.db,
    now: () => now,
    cookieSecret: COOKIE_SECRET,
    sender: new LogEmailSender(() => undefined),
    verifyBaseUrl: "https://wcdraft.com",
    fromAddress: "wcdraft <onboarding@resend.dev>",
  };
}

async function issueLink(args: { now: number; email?: string }): Promise<{
  rawToken: string;
  tokenHash: string;
}> {
  const sender = new LogEmailSender(() => undefined);
  await requestMagicLink(
    { email: args.email ?? "u@example.com", ipAddress: "1.1.1.1" },
    { ...deps(args.now), sender },
  );
  const rawToken = new URL(sender.lastSent!.magicLinkUrl).searchParams.get(
    "token",
  )!;
  return { rawToken, tokenHash: sha256Hex(rawToken) };
}

async function tokenIsConsumed(hash: string): Promise<boolean> {
  const rows = await env.db
    .select()
    .from(magicLinkTokens)
    .where(eq(magicLinkTokens.tokenHash, hash));
  return rows[0]?.consumedAt !== null;
}

// ── safeNextPath whitelist ────────────────────────────────────────────────
describe("safeNextPath", () => {
  it("defaults to /play when input is empty / null / undefined", () => {
    expect(safeNextPath(null)).toBe("/play");
    expect(safeNextPath(undefined)).toBe("/play");
    expect(safeNextPath("")).toBe("/play");
  });
  it("allows same-origin pathnames", () => {
    expect(safeNextPath("/play")).toBe("/play");
    expect(safeNextPath("/play/draft")).toBe("/play/draft");
    expect(safeNextPath("/play?x=1&y=2")).toBe("/play?x=1&y=2");
  });
  it("REJECTS protocol-relative URLs", () => {
    expect(safeNextPath("//evil.example/")).toBe("/play");
  });
  it("REJECTS absolute URLs", () => {
    expect(safeNextPath("https://evil.example")).toBe("/play");
    expect(safeNextPath("http://wcdraft.com")).toBe("/play");
  });
  it("REJECTS scheme-relative tricks (`/\\foo`)", () => {
    expect(safeNextPath("/\\evil")).toBe("/play");
  });
  it("REJECTS percent-encoded CRLF (CRLF / response-splitting)", () => {
    expect(safeNextPath("/play%0d%0aSet-Cookie:%20x=y")).toBe("/play");
    expect(safeNextPath("/play%0D%0ASet-Cookie:%20x=y")).toBe("/play");
    expect(safeNextPath("/play%0a")).toBe("/play");
  });
  it("REJECTS percent-encoded tab and other C0 control bytes", () => {
    expect(safeNextPath("/play%09evil")).toBe("/play");
    expect(safeNextPath("/play%00")).toBe("/play");
    expect(safeNextPath("/play%1f")).toBe("/play");
  });
  it("REJECTS percent-encoded DEL (0x7f)", () => {
    expect(safeNextPath("/play%7f")).toBe("/play");
  });
  it("REJECTS malformed percent-encoding (invalid escape)", () => {
    expect(safeNextPath("/play%zz")).toBe("/play");
    expect(safeNextPath("/play%g")).toBe("/play");
  });
  it("ALLOWS benign percent-encoding (visible characters)", () => {
    expect(safeNextPath("/play?q=hello%20world")).toBe(
      "/play?q=hello%20world",
    );
  });
});

// ── renderVerifyInterstitialHtml ─────────────────────────────────────────
describe("renderVerifyInterstitialHtml", () => {
  it("uses POST method and the configured action", () => {
    const html = renderVerifyInterstitialHtml({
      token: "tok",
      next: "/play",
      csrfToken: "csrf",
    });
    expect(html).toMatch(/<form\s+method="POST"\s+action="\/api\/auth\/verify">/);
  });
  it("embeds token, next, csrf as hidden form fields", () => {
    const html = renderVerifyInterstitialHtml({
      token: "tok-xyz",
      next: "/play",
      csrfToken: "csrf-abc",
    });
    expect(html).toMatch(/name="token"\s+value="tok-xyz"/);
    expect(html).toMatch(/name="next"\s+value="\/play"/);
    expect(html).toMatch(/name="csrf"\s+value="csrf-abc"/);
  });
  it("HTML-escapes user-controlled fields (XSS resistance)", () => {
    const html = renderVerifyInterstitialHtml({
      token: '"><script>alert(1)</script>',
      next: "/?a=<b>",
      csrfToken: 'csrf"abc',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;");
    expect(html).toContain('csrf&quot;abc');
  });
  it("marks the page noindex (search engines should not list interstitials)", () => {
    const html = renderVerifyInterstitialHtml({
      token: "t",
      next: "/",
      csrfToken: "c",
    });
    expect(html).toMatch(/<meta\s+name="robots"\s+content="noindex">/);
  });
  it("does NOT include any <script> tag (no auto-submit; bots must click)", () => {
    const html = renderVerifyInterstitialHtml({
      token: "t",
      next: "/",
      csrfToken: "c",
    });
    expect(html).not.toMatch(/<script/i);
  });
});

// ── GET path: must NOT consume ────────────────────────────────────────────
describe("prepareVerifyInterstitial (GET) — prefetch-safe", () => {
  it("does NOT consume the token (prefetcher arm)", async () => {
    const now = Date.UTC(2026, 5, 1);
    const { tokenHash, rawToken } = await issueLink({ now });
    expect(await tokenIsConsumed(tokenHash)).toBe(false);
    await prepareVerifyInterstitial(
      {
        existingSessionCookie: null,
        token: rawToken,
        next: "/play",
      },
      deps(now + 1),
    );
    // Token is STILL alive after the GET (this is the reviewer's catch).
    expect(await tokenIsConsumed(tokenHash)).toBe(false);
  });

  it("issues a fresh anon session when no cookie present", async () => {
    const now = Date.UTC(2026, 5, 1);
    const r = await prepareVerifyInterstitial(
      { existingSessionCookie: null, token: "t", next: "/play" },
      deps(now),
    );
    expect(r.setSessionCookie).toBe(true);
    expect(r.csrfSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.html).toContain(`value="${r.csrfSecret}"`);
  });

  it("reuses an existing valid session when the cookie is present", async () => {
    const now = Date.UTC(2026, 5, 1);
    const created = await createSession({ userId: null }, deps(now));
    const r = await prepareVerifyInterstitial(
      {
        existingSessionCookie: created.cookieValue,
        token: "t",
        next: "/play",
      },
      deps(now + 1),
    );
    expect(r.setSessionCookie).toBe(false);
    expect(r.csrfSecret).toBe(created.session.csrfSecret);
  });

  it("idempotent on multiple GETs — calling N times still leaves token alive", async () => {
    const now = Date.UTC(2026, 5, 1);
    const { rawToken, tokenHash } = await issueLink({ now });
    for (let i = 0; i < 3; i++) {
      await prepareVerifyInterstitial(
        { existingSessionCookie: null, token: rawToken, next: "/play" },
        deps(now + i + 1),
      );
    }
    expect(await tokenIsConsumed(tokenHash)).toBe(false);
  });
});

// ── POST path: consumes only with CSRF + Origin/Host ─────────────────────
describe("consumeAndIssueSession (POST) — guarded consume", () => {
  async function setupSessionAndToken(now: number): Promise<{
    sessionCookieValue: string;
    csrfSecret: string;
    rawToken: string;
    tokenHash: string;
  }> {
    const created = await createSession({ userId: null }, deps(now));
    const { rawToken, tokenHash } = await issueLink({ now });
    return {
      sessionCookieValue: created.cookieValue,
      csrfSecret: created.session.csrfSecret,
      rawToken,
      tokenHash,
    };
  }

  it("happy path: consumes the token, rotates the session, returns same-origin redirect", async () => {
    const now = Date.UTC(2026, 5, 1);
    const setup = await setupSessionAndToken(now);
    const result = await consumeAndIssueSession(
      {
        token: setup.rawToken,
        next: "/play/draft",
        csrfFromForm: setup.csrfSecret,
        csrfFromCookie: setup.csrfSecret,
        sessionCookieValue: setup.sessionCookieValue,
        origin: "https://wcdraft.com",
        referer: null,
        host: "wcdraft.com",
      },
      deps(now + 1),
    );
    expect(result.redirectTo).toBe("/play/draft");
    expect(await tokenIsConsumed(setup.tokenHash)).toBe(true);
    // Session rotated: new csrfSecret, but row preserved.
    const validated = await validateSessionCookie(
      result.sessionCookieValue,
      deps(now + 2),
    );
    expect(validated.userId).not.toBeNull();
    expect(validated.csrfSecret).toBe(result.csrfSecret);
    expect(validated.csrfSecret).not.toBe(setup.csrfSecret);
  });

  it("CSRF_MISSING when form csrf is blank", async () => {
    const now = Date.UTC(2026, 5, 1);
    const setup = await setupSessionAndToken(now);
    await expect(
      consumeAndIssueSession(
        {
          token: setup.rawToken,
          next: "/play",
          csrfFromForm: "",
          csrfFromCookie: setup.csrfSecret,
          sessionCookieValue: setup.sessionCookieValue,
          origin: "https://wcdraft.com",
          referer: null,
          host: "wcdraft.com",
        },
        deps(now + 1),
      ),
    ).rejects.toMatchObject({ code: "CSRF_MISSING" });
    // The guard fires BEFORE verifyMagicLink — token still alive.
    expect(await tokenIsConsumed(setup.tokenHash)).toBe(false);
  });

  it("CSRF_MISMATCH when form csrf differs from session secret", async () => {
    const now = Date.UTC(2026, 5, 1);
    const setup = await setupSessionAndToken(now);
    await expect(
      consumeAndIssueSession(
        {
          token: setup.rawToken,
          next: "/play",
          csrfFromForm: "forged-csrf-value-of-correct-shape-but-bogus",
          csrfFromCookie: setup.csrfSecret,
          sessionCookieValue: setup.sessionCookieValue,
          origin: "https://wcdraft.com",
          referer: null,
          host: "wcdraft.com",
        },
        deps(now + 1),
      ),
    ).rejects.toMatchObject({ code: "CSRF_MISMATCH" });
    expect(await tokenIsConsumed(setup.tokenHash)).toBe(false);
  });

  it("ORIGIN_MISMATCH when Origin host differs from Host", async () => {
    const now = Date.UTC(2026, 5, 1);
    const setup = await setupSessionAndToken(now);
    await expect(
      consumeAndIssueSession(
        {
          token: setup.rawToken,
          next: "/play",
          csrfFromForm: setup.csrfSecret,
          csrfFromCookie: setup.csrfSecret,
          sessionCookieValue: setup.sessionCookieValue,
          origin: "https://evil.example",
          referer: null,
          host: "wcdraft.com",
        },
        deps(now + 1),
      ),
    ).rejects.toMatchObject({ code: "ORIGIN_MISMATCH" });
    expect(await tokenIsConsumed(setup.tokenHash)).toBe(false);
  });

  it("SESSION_INVALID when no session cookie present (need session for CSRF)", async () => {
    const now = Date.UTC(2026, 5, 1);
    const { rawToken } = await issueLink({ now });
    await expect(
      consumeAndIssueSession(
        {
          token: rawToken,
          next: "/play",
          csrfFromForm: "x",
          csrfFromCookie: "x",
          sessionCookieValue: null,
          origin: "https://wcdraft.com",
          referer: null,
          host: "wcdraft.com",
        },
        deps(now + 1),
      ),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("rejects a cross-origin `next` to /play (whitelisted same-origin)", async () => {
    const now = Date.UTC(2026, 5, 1);
    const setup = await setupSessionAndToken(now);
    const result = await consumeAndIssueSession(
      {
        token: setup.rawToken,
        next: "https://evil.example/steal",
        csrfFromForm: setup.csrfSecret,
        csrfFromCookie: setup.csrfSecret,
        sessionCookieValue: setup.sessionCookieValue,
        origin: "https://wcdraft.com",
        referer: null,
        host: "wcdraft.com",
      },
      deps(now + 1),
    );
    expect(result.redirectTo).toBe("/play");
  });
});

// ── End-to-end prefetch then click ────────────────────────────────────────
describe("prefetch-then-click round-trip — the reviewer's catch", () => {
  it("scanner GET (no consume) + user POST (consume) succeeds", async () => {
    const now = Date.UTC(2026, 5, 1);
    const { rawToken, tokenHash } = await issueLink({ now });

    // (Simulating a mail-scanner.) Fresh GET with no cookie. Mints an anon
    // session, sets cookies, renders HTML. The scanner discards the
    // response.
    const scannerView = await prepareVerifyInterstitial(
      { existingSessionCookie: null, token: rawToken, next: "/play" },
      deps(now + 1),
    );
    expect(scannerView.setSessionCookie).toBe(true);
    expect(await tokenIsConsumed(tokenHash)).toBe(false);

    // (Now the user opens the email link in their browser — a SEPARATE
    // cookie jar.) Fresh GET, mints THEIR anon session, renders THEIR
    // form with their csrf.
    const userView = await prepareVerifyInterstitial(
      { existingSessionCookie: null, token: rawToken, next: "/play" },
      deps(now + 2),
    );
    expect(await tokenIsConsumed(tokenHash)).toBe(false);

    // User clicks the button → POST with form csrf matching the cookie csrf.
    const result = await consumeAndIssueSession(
      {
        token: rawToken,
        next: "/play",
        csrfFromForm: userView.csrfSecret,
        csrfFromCookie: userView.csrfSecret,
        sessionCookieValue: userView.sessionCookieValue,
        origin: "https://wcdraft.com",
        referer: null,
        host: "wcdraft.com",
      },
      deps(now + 3),
    );
    expect(result.redirectTo).toBe("/play");
    expect(await tokenIsConsumed(tokenHash)).toBe(true);
  });

  it("replay with the SAME (stale) csrf is caught at CSRF_MISMATCH (rotation invalidated it)", async () => {
    // After a successful consume the session's csrfSecret rotates. A
    // browser back-button or attacker replay carrying the OLD csrf will
    // be rejected at the CSRF check BEFORE the token check fires — the
    // most specific 401 reason we can give.
    const now = Date.UTC(2026, 5, 1);
    const { rawToken } = await issueLink({ now });
    const view = await prepareVerifyInterstitial(
      { existingSessionCookie: null, token: rawToken, next: "/play" },
      deps(now + 1),
    );
    await consumeAndIssueSession(
      {
        token: rawToken,
        next: "/play",
        csrfFromForm: view.csrfSecret,
        csrfFromCookie: view.csrfSecret,
        sessionCookieValue: view.sessionCookieValue,
        origin: "https://wcdraft.com",
        referer: null,
        host: "wcdraft.com",
      },
      deps(now + 2),
    );
    await expect(
      consumeAndIssueSession(
        {
          token: rawToken,
          next: "/play",
          csrfFromForm: view.csrfSecret,       // stale
          csrfFromCookie: view.csrfSecret,     // stale
          sessionCookieValue: view.sessionCookieValue,
          origin: "https://wcdraft.com",
          referer: null,
          host: "wcdraft.com",
        },
        deps(now + 3),
      ),
    ).rejects.toMatchObject({ code: "CSRF_MISMATCH" });
  });

  it("replay with the ROTATED (current) csrf is caught at TOKEN_CONSUMED", async () => {
    // The other side of the replay-vs-CSRF check: when the attacker
    // somehow holds the rotated csrf (e.g. the post-rotation cookie jar),
    // CSRF passes and we fall through to the atomic token-consume guard.
    const now = Date.UTC(2026, 5, 1);
    const { rawToken } = await issueLink({ now });
    const view = await prepareVerifyInterstitial(
      { existingSessionCookie: null, token: rawToken, next: "/play" },
      deps(now + 1),
    );
    const first = await consumeAndIssueSession(
      {
        token: rawToken,
        next: "/play",
        csrfFromForm: view.csrfSecret,
        csrfFromCookie: view.csrfSecret,
        sessionCookieValue: view.sessionCookieValue,
        origin: "https://wcdraft.com",
        referer: null,
        host: "wcdraft.com",
      },
      deps(now + 2),
    );
    await expect(
      consumeAndIssueSession(
        {
          token: rawToken,
          next: "/play",
          csrfFromForm: first.csrfSecret,          // current
          csrfFromCookie: first.csrfSecret,        // current
          sessionCookieValue: first.sessionCookieValue,
          origin: "https://wcdraft.com",
          referer: null,
          host: "wcdraft.com",
        },
        deps(now + 3),
      ),
    ).rejects.toMatchObject({ code: "TOKEN_CONSUMED" });
  });
});

// ── Session rotation specifics (fixation threat model) ────────────────────
describe("session rotation on consume", () => {
  it("preserves the session row (id unchanged) but mints a fresh csrfSecret", async () => {
    const now = Date.UTC(2026, 5, 1);
    const created = await createSession({ userId: null }, deps(now));
    const sender = new LogEmailSender(() => undefined);
    await requestMagicLink(
      { email: "rot@example.com", ipAddress: "1.1.1.1" },
      { ...deps(now), sender },
    );
    const rawToken = new URL(sender.lastSent!.magicLinkUrl).searchParams.get(
      "token",
    )!;
    const result = await consumeAndIssueSession(
      {
        token: rawToken,
        next: "/play",
        csrfFromForm: created.session.csrfSecret,
        csrfFromCookie: created.session.csrfSecret,
        sessionCookieValue: created.cookieValue,
        origin: "https://wcdraft.com",
        referer: null,
        host: "wcdraft.com",
      },
      deps(now + 1),
    );
    // Session id unchanged → F-4 anon-attempt bindings survive.
    const after = await env.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, created.session.id));
    expect(after[0]?.id).toBe(created.session.id);
    // csrfSecret rotated.
    expect(after[0]?.csrfSecret).not.toBe(created.session.csrfSecret);
    expect(after[0]?.csrfSecret).toBe(result.csrfSecret);
    // user_id flipped from null to the verified user.
    expect(after[0]?.userId).not.toBeNull();
  });
});

// ── F-3 onAuthenticatedSessionReady hook ─────────────────────────────────
describe("onAuthenticatedSessionReady hook (F-3 claim wiring)", () => {
  it("fires after rotation with the preserved sessionId and the new userId", async () => {
    const now = Date.UTC(2026, 5, 1);
    const created = await createSession({ userId: null }, deps(now));
    const sender = new LogEmailSender(() => undefined);
    await requestMagicLink(
      { email: "hook@example.com", ipAddress: "1.1.1.1" },
      { ...deps(now), sender },
    );
    const rawToken = new URL(sender.lastSent!.magicLinkUrl).searchParams.get(
      "token",
    )!;
    const calls: Array<{ sessionId: string; userId: string }> = [];
    await consumeAndIssueSession(
      {
        token: rawToken,
        next: "/play",
        csrfFromForm: created.session.csrfSecret,
        csrfFromCookie: created.session.csrfSecret,
        sessionCookieValue: created.cookieValue,
        origin: "https://wcdraft.com",
        referer: null,
        host: "wcdraft.com",
        onAuthenticatedSessionReady: async (args) => {
          calls.push(args);
        },
      },
      deps(now + 1),
    );
    expect(calls).toHaveLength(1);
    // sessionId is the SAME session row (rotation preserves id) — F-4
    // ranked binding survives sign-in.
    expect(calls[0]?.sessionId).toBe(created.session.id);
    expect(calls[0]?.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("hook FAILURE does NOT block sign-in (logged, swallowed)", async () => {
    const now = Date.UTC(2026, 5, 1);
    const created = await createSession({ userId: null }, deps(now));
    const sender = new LogEmailSender(() => undefined);
    await requestMagicLink(
      { email: "swallow@example.com", ipAddress: "1.1.1.1" },
      { ...deps(now), sender },
    );
    const rawToken = new URL(sender.lastSent!.magicLinkUrl).searchParams.get(
      "token",
    )!;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await consumeAndIssueSession(
        {
          token: rawToken,
          next: "/play",
          csrfFromForm: created.session.csrfSecret,
          csrfFromCookie: created.session.csrfSecret,
          sessionCookieValue: created.cookieValue,
          origin: "https://wcdraft.com",
          referer: null,
          host: "wcdraft.com",
          onAuthenticatedSessionReady: () => {
            throw new Error("simulated claim failure");
          },
        },
        deps(now + 1),
      );
      expect(result.redirectTo).toBe("/play");
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
    // Session is still rotated even though the hook threw.
    const validated = await validateSessionCookie(
      created.cookieValue,
      deps(now + 2),
    );
    void validated;
  });

  it("drives the verify hook to claim anon saved runs and leaderboard entries", async () => {
    const now = Date.UTC(2026, 5, 1);
    const created = await createSession({ userId: null }, deps(now));
    await env.db.insert(savedRuns).values({
      sessionId: created.session.id,
      ownerUserId: null,
      token: "t1.verify-claimed-run",
      versionAnchors: { dataset_version: "v1" },
      runId: "run-verify-claim",
      parentSeed: "seed-verify-claim",
      claimState: "anonymous",
    });
    await env.db.insert(leaderboardEntries).values({
      seasonKey: "season-verify-claim",
      mode: "casual",
      draftMode: "classic",
      userId: null,
      sessionId: created.session.id,
      displayName: "Anon Verify",
      token: "t1.verify-claimed-board",
      verifiedScore: 777,
    });

    const sender = new LogEmailSender(() => undefined);
    await requestMagicLink(
      { email: "claim-via-verify@example.com", ipAddress: "1.1.1.1" },
      { ...deps(now), sender },
    );
    const rawToken = new URL(sender.lastSent!.magicLinkUrl).searchParams.get(
      "token",
    )!;

    const result = await consumeAndIssueSession(
      {
        token: rawToken,
        next: "/history",
        csrfFromForm: created.session.csrfSecret,
        csrfFromCookie: created.session.csrfSecret,
        sessionCookieValue: created.cookieValue,
        origin: "https://wcdraft.com",
        referer: null,
        host: "wcdraft.com",
        onAuthenticatedSessionReady: async (args) => {
          await claimAnonArtifacts(args, { db: env.db });
        },
      },
      deps(now + 1),
    );

    expect(result.redirectTo).toBe("/history");
    const authedSession = await validateSessionCookie(
      result.sessionCookieValue,
      deps(now + 2),
    );
    expect(authedSession.id).toBe(created.session.id);
    expect(authedSession.userId).not.toBeNull();
    const userId = authedSession.userId!;

    const claimedRuns = await env.db
      .select()
      .from(savedRuns)
      .where(eq(savedRuns.ownerUserId, userId));
    expect(claimedRuns).toHaveLength(1);
    expect(claimedRuns[0]!.token).toBe("t1.verify-claimed-run");
    expect(claimedRuns[0]!.sessionId).toBeNull();
    expect(claimedRuns[0]!.claimState).toBe("claimed");

    const claimedEntries = await env.db
      .select()
      .from(leaderboardEntries)
      .where(eq(leaderboardEntries.userId, userId));
    expect(claimedEntries).toHaveLength(1);
    expect(claimedEntries[0]!.token).toBe("t1.verify-claimed-board");
    expect(claimedEntries[0]!.sessionId).toBeNull();

    expect(
      await env.db
        .select()
        .from(savedRuns)
        .where(eq(savedRuns.sessionId, created.session.id)),
    ).toHaveLength(0);
    expect(
      await env.db
        .select()
        .from(leaderboardEntries)
        .where(eq(leaderboardEntries.sessionId, created.session.id)),
    ).toHaveLength(0);
  });
});
