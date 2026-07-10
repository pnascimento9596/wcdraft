// F-1 — schema row/insert type compile assertions.
//
// Drizzle's `$inferSelect` / `$inferInsert` give us the row + insert types
// for every table. This file is the "if these types ever drift from the
// schema columns, the build fails" guard. The runtime assertions are
// trivial; the value is the type-level coverage at `pnpm typecheck`.
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  users,
  magicLinkTokens,
  sessions,
  savedRuns,
  rankedAttempts,
  leaderboardEntries,
  type User,
  type NewUser,
  type MagicLinkToken,
  type NewMagicLinkToken,
  type Session,
  type NewSession,
  type SavedRun,
  type NewSavedRun,
  type RankedAttempt,
  type NewRankedAttempt,
  type LeaderboardEntry,
  type NewLeaderboardEntry,
  authRateLimits,
  type AuthRateLimit,
  type NewAuthRateLimit,
} from "../src/index.ts";

describe("@wcdraft/db schema — shape", () => {
  it("exports all seven tables", () => {
    expect(users).toBeDefined();
    expect(magicLinkTokens).toBeDefined();
    expect(sessions).toBeDefined();
    expect(savedRuns).toBeDefined();
    expect(rankedAttempts).toBeDefined();
    expect(leaderboardEntries).toBeDefined();
    expect(authRateLimits).toBeDefined();
  });

  it("infers row and insert types for auth_rate_limits", () => {
    expectTypeOf<AuthRateLimit>().toMatchTypeOf<{
      bucketKey: string;
      windowStart: Date;
      count: number;
      updatedAt: Date;
    }>();
    expectTypeOf<NewAuthRateLimit>().toMatchTypeOf<{
      bucketKey: string;
      windowStart: Date;
    }>();
  });

  it("infers row and insert types for users", () => {
    expectTypeOf<User>().toMatchTypeOf<{
      id: string;
      email: string | null;
      username: string | null;
      passwordHash: string | null;
      passwordSetAt: Date | null;
      emailVerifiedAt: Date | null;
      createdAt: Date;
    }>();
    // email is nullable, so the insert type allows omission
    expectTypeOf<NewUser>().toMatchTypeOf<{
      email?: string | null;
      username?: string | null;
      passwordHash?: string | null;
      passwordSetAt?: Date | null;
      emailVerifiedAt?: Date | null;
    }>();
  });

  it("infers row and insert types for magic_link_tokens", () => {
    expectTypeOf<MagicLinkToken>().toMatchTypeOf<{
      tokenHash: string;
      email: string;
      userId: string | null;
      expiresAt: Date;
      consumedAt: Date | null;
      createdAt: Date;
    }>();
    expectTypeOf<NewMagicLinkToken>().toMatchTypeOf<{
      tokenHash: string;
      email: string;
      expiresAt: Date;
    }>();
  });

  it("infers row and insert types for sessions", () => {
    expectTypeOf<Session>().toMatchTypeOf<{
      id: string;
      userId: string | null;
      csrfSecret: string;
      createdAt: Date;
      expiresAt: Date;
    }>();
    expectTypeOf<NewSession>().toMatchTypeOf<{
      id: string;
      csrfSecret: string;
      expiresAt: Date;
    }>();
  });

  it("infers row and insert types for saved_runs", () => {
    expectTypeOf<SavedRun>().toMatchTypeOf<{
      id: string;
      ownerUserId: string | null;
      token: string;
      // version_anchors is jsonb, unknown by default
      versionAnchors: unknown;
      verifiedResult: unknown;
      runId: string | null;
      parentSeed: string | null;
      claimState: string;
      createdAt: Date;
    }>();
    expectTypeOf<NewSavedRun>().toMatchTypeOf<{
      token: string;
      claimState: string;
    }>();
  });

  it("infers row and insert types for ranked_attempts", () => {
    expectTypeOf<RankedAttempt>().toMatchTypeOf<{
      id: string;
      // F-4 U1: RANKED IS ACCOUNT-REQUIRED — user_id is structurally NOT NULL.
      userId: string;
      sessionId: string | null;
      seasonKey: string;
      formationId: string;
      draftMode: string;
      draftOrder: string;
      era: string;
      ratingBasis: string;
      issuedParentSeed: string;
      nonce: string;
      issuedAt: Date;
      windowExpiresAt: Date;
      consumedAt: Date | null;
    }>();
    expectTypeOf<NewRankedAttempt>().toMatchTypeOf<{
      userId: string;
      seasonKey: string;
      formationId: string;
      draftMode: string;
      draftOrder: string;
      era: string;
      ratingBasis: string;
      issuedParentSeed: string;
      nonce: string;
      windowExpiresAt: Date;
    }>();
    // The insert type must REQUIRE userId (a userId-less insert no longer
    // compiles — the structural account requirement at the type level).
    expectTypeOf<NewRankedAttempt["userId"]>().toEqualTypeOf<string>();
  });

  it("infers row and insert types for leaderboard_entries", () => {
    expectTypeOf<LeaderboardEntry>().toMatchTypeOf<{
      id: string;
      seasonKey: string;
      challengeType: string;
      challengeDate: string | null;
      ratingVersion: string | null;
      mode: string;
      draftMode: string;
      draftOrder: string | null;
      era: string | null;
      ratingBasis: string | null;
      userId: string | null;
      sessionId: string | null;
      displayAlias: string | null;
      token: string;
      verifiedScore: number;
      scoreBreakdown: unknown;
      attemptId: string | null;
      attemptFormationId: string | null;
      attemptConsumedAt: Date | null;
      hiddenAt: Date | null;
      createdAt: Date;
    }>();
    expectTypeOf<NewLeaderboardEntry>().toMatchTypeOf<{
      seasonKey: string;
      challengeType?: string;
      challengeDate?: string | null;
      ratingVersion?: string | null;
      mode: string;
      draftMode: string;
      draftOrder?: string | null;
      era?: string | null;
      ratingBasis?: string | null;
      displayAlias?: string | null;
      attemptFormationId?: string | null;
      attemptConsumedAt?: Date | null;
      token: string;
      verifiedScore: number;
    }>();
  });
});
