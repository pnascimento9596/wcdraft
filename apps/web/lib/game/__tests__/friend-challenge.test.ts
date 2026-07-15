import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";
import { encodeRunTokenBody } from "@wcdraft/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildFriendChallengeShareCopy,
  buildFriendChallengeUrl,
  FRIEND_CHALLENGE_URL_MAX_LEN,
  FRIEND_CHALLENGE_VERIFICATION_BUDGET_MS,
  parseFriendChallengeSearchParams,
  FRIEND_CHALLENGE_VERIFICATION_COPY,
  verifyFriendChallenge,
} from "../friend-challenge";
import {
  signVerifiedFriendChallenge,
  verifyFriendChallengeForPlay,
} from "../friend-challenge-server";
import {
  isLikelySignedFriendChallenge,
  sha256Hex,
  SIGNED_FRIEND_CHALLENGE_MAX_LEN,
  SIGNED_RUN_OG_VERSION,
  signFriendChallengePayload,
  signRunOgPayload,
  verifySignedFriendChallengePayload,
} from "../run-og-signing";
import { decodeRunToken, encodeRunToken } from "../run-token";
import type { RunRecordV1 } from "../run-record";
import { runSimulationSync } from "../simulate";
import { verifyRunTokenForOg } from "../run-og-server";
import { buildGameDataFromBundles, buildOriginRecord } from "./run-token.test-harness";
import { handleChallengeVerifyPost } from "../../../app/api/challenge/verify/route";
import skewFixtures from "./fixtures/run-token-skew.json" with { type: "json" };

const gameData = buildGameDataFromBundles();
const validation = { gameData, scenario: SCENARIO_2026_BUNDLE };
const SECRET = "friend-challenge-test-secret-32-bytes";

function heldOpenVerificationRef() {
  const token = ["t3", "placeholder"].join(".");
  const proof = ["fc1", "placeholder"].join(".");
  return { token, proof };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function complete(record: RunRecordV1): RunRecordV1 {
  const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record);
  return { ...record, status: "complete", simulation };
}

async function proofFor(token: string): Promise<string> {
  return signFriendChallengePayload({ v: 1, token_hash: await sha256Hex(token) }, SECRET);
}

describe("same-seed friend challenge contract", () => {
  it("round-trips a compact URL and snapshots honest share copy", async () => {
    const token = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:friend:roundtrip")));
    const proof = await proofFor(token);
    expect(proof).toMatch(/^fc1\.[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/u);
    expect(proof).toHaveLength(SIGNED_FRIEND_CHALLENGE_MAX_LEN);
    const url = buildFriendChallengeUrl("https://www.wcdraft.com/", { token, proof }, null);
    const parsed = new URL(url);

    expect(url.length).toBeLessThanOrEqual(FRIEND_CHALLENGE_URL_MAX_LEN);
    expect(parseFriendChallengeSearchParams(parsed.searchParams)).toEqual({
      kind: "ready",
      ref: { token, proof },
    });
    expect(buildFriendChallengeShareCopy(url)).toMatchInlineSnapshot(`
      "Challenge a friend on my WCDraft board. Same seed, same setup. Can you beat my score?
      ${url}"
    `);
    expect(FRIEND_CHALLENGE_VERIFICATION_COPY).toMatchInlineSnapshot(
      `"Your friend’s score was re-derived from the shared token; your completed run used the same seed and build."`,
    );
  });

  it("accepts only the exact canonical fc1 wire encoding", async () => {
    const proof = await signFriendChallengePayload({ v: 1, token_hash: "a".repeat(64) }, SECRET);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const finalIndex = alphabet.indexOf(proof.at(-1)!);
    if (finalIndex < 0 || finalIndex % 4 !== 0) {
      throw new Error("canonical SHA-256 HMAC fixture has an invalid final base64url sextet");
    }
    // For a 32-byte value the final sextet has two zero padding bits. Changing
    // only those bits can decode to the same bytes in permissive decoders, but
    // it is not the canonical unpadded base64url representation.
    const alternateEncoding = `${proof.slice(0, -1)}${alphabet[finalIndex + 1]}`;
    const malformed = [
      proof.slice(0, -1),
      `${proof}A`,
      `FC1.${proof.slice(4)}`,
      `fc1.A${proof.slice(5)}`,
      `${proof}.tail`,
      `${proof.slice(0, -1)}=`,
      alternateEncoding,
    ];

    expect(isLikelySignedFriendChallenge(proof)).toBe(true);
    await expect(verifySignedFriendChallengePayload(proof, SECRET)).resolves.toEqual({
      v: 1,
      token_hash: "a".repeat(64),
    });
    for (const candidate of malformed) {
      expect(isLikelySignedFriendChallenge(candidate)).toBe(false);
      await expect(verifySignedFriendChallengePayload(candidate, SECRET)).resolves.toBeNull();
      expect(
        parseFriendChallengeSearchParams(
          new URLSearchParams({ challenge: "t3.placeholder", proof: candidate }),
        ),
      ).toEqual({ kind: "invalid" });
    }
  });

  it("fails closed when the escaped deep link exceeds the 8 KiB budget", async () => {
    const proof = await proofFor("t3.placeholder");
    expect(() =>
      buildFriendChallengeUrl(
        "https://www.wcdraft.com",
        { token: `t3.${"x".repeat(8_050)}`, proof },
        null,
      ),
    ).toThrow(/maximum is 8192/u);
  });

  it("bounds verification when the request never returns headers", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise<Response>(() => {
            requestSignal = init?.signal instanceof AbortSignal ? init.signal : undefined;
          }),
      ),
    );

    const pending = verifyFriendChallenge(heldOpenVerificationRef());
    await vi.advanceTimersByTimeAsync(FRIEND_CHALLENGE_VERIFICATION_BUDGET_MS);

    await expect(pending).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("includes a held-open response body in the verification budget", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        requestSignal = init?.signal instanceof AbortSignal ? init.signal : undefined;
        return {
          ok: true,
          json: () => new Promise<unknown>(() => undefined),
        } as Response;
      }),
    );

    const pending = verifyFriendChallenge(heldOpenVerificationRef());
    await vi.advanceTimersByTimeAsync(FRIEND_CHALLENGE_VERIFICATION_BUDGET_MS);

    await expect(pending).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("stops a headerless oversized verify body while streaming", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    const response = await handleChallengeVerifyPost(
      new Request("http://localhost/api/challenge/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: `t3.${"x".repeat(12_000)}`, proof: "fc1.invalid" }),
      }),
      {
        now: () => 0,
        getRateLimiter: () => ({
          async checkSign() {
            throw new Error("oversized body must fail before limiter");
          },
        }),
      },
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: "INVALID_CHALLENGE" });
  });

  it("serves a verified current-build challenge through the bounded API", async () => {
    vi.stubEnv("WCDRAFT_OG_SIGNING_SECRET", SECRET);
    const token = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:friend:api")));
    let rateChecks = 0;
    const response = await handleChallengeVerifyPost(
      new Request("http://localhost/api/challenge/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, proof: await proofFor(token) }),
      }),
      {
        now: () => 0,
        getRateLimiter: () => ({
          async checkSign() {
            rateChecks += 1;
            return { allowed: true as const };
          },
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      challenge: expect.objectContaining({
        status: "VERIFIED",
        parentSeed: "wcdraft:friend:api",
        formationId: "4-3-3",
        mode: "classic",
        draftFlow: "squad_first",
        ratingBasis: "career",
        eraPreset: "all_time",
        challengerDisplay: "a friend",
        challengerScore: expect.any(Number),
      }),
    });
    expect(rateChecks).toBe(1);
  });

  it("binds the exact raw token and re-derives the challenger score through OG verification", async () => {
    const token = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:friend:verify")));
    const verification = verifyRunTokenForOg(token, validation);
    const proof = await signVerifiedFriendChallenge(token, verification, validation, SECRET);
    expect(proof).not.toBeNull();
    const result = await verifyFriendChallengeForPlay(token, proof!, validation, SECRET);
    const og = verifyRunTokenForOg(token, validation);
    expect(og.status).toBe("accepted");
    expect(result).toEqual({
      status: "accepted",
      challenge: expect.objectContaining({
        status: "VERIFIED",
        parentSeed: "wcdraft:friend:verify",
        challengerDisplay: "a friend",
        challengerScore: og.status === "accepted" ? og.run.score : Number.NaN,
      }),
    });
  });

  it("rejects token substitution, signature tamper, and cross-protocol OG signatures", async () => {
    const tokenA = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:friend:a")));
    const tokenB = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:friend:b")));
    const proofA = await proofFor(tokenA);
    const tampered = `${proofA.slice(0, -1)}${proofA.endsWith("A") ? "B" : "A"}`;
    const verified = verifyRunTokenForOg(tokenA, validation);
    if (verified.status !== "accepted") throw new Error("fixture did not verify");
    const ogSignature = await signRunOgPayload(
      {
        v: SIGNED_RUN_OG_VERSION,
        token_hash: await sha256Hex(tokenA),
        versions: gameData.versions,
        model: verified.model,
      },
      SECRET,
    );

    await expect(
      signVerifiedFriendChallenge(tokenB, verified, validation, SECRET),
    ).resolves.toBeNull();

    await expect(verifyFriendChallengeForPlay(tokenB, proofA, validation, SECRET)).resolves.toEqual(
      {
        status: "rejected",
        reason: "INVALID_CHALLENGE",
      },
    );
    await expect(verifySignedFriendChallengePayload(tampered, SECRET)).resolves.toBeNull();
    await expect(verifySignedFriendChallengePayload(ogSignature, SECRET)).resolves.toBeNull();
  });

  it("authenticates skewed config but returns DIFFERENT_BUILD without a score", async () => {
    const current = encodeRunToken(complete(buildOriginRecord(gameData, "wcdraft:friend:skew")));
    const decoded = decodeRunToken(current);
    if (!decoded || (decoded.v !== 3 && decoded.v !== 4)) throw new Error("expected current token");
    const skewed = encodeRunTokenBody({ ...decoded, ev: `${decoded.ev}-previous` });
    const result = await verifyFriendChallengeForPlay(
      skewed,
      await proofFor(skewed),
      validation,
      SECRET,
    );
    expect(result).toEqual({
      status: "accepted",
      challenge: expect.objectContaining({
        status: "DIFFERENT_BUILD",
        parentSeed: "wcdraft:friend:skew",
        challengerDisplay: "a friend",
        challengerScore: null,
      }),
    });
  });

  it("surfaces the real pre-Season-2 production token as DIFFERENT_BUILD", async () => {
    const token = skewFixtures.shipped_pre_s2_t3.token;
    const result = await verifyFriendChallengeForPlay(
      token,
      await proofFor(token),
      validation,
      SECRET,
    );
    expect(result).toEqual({
      status: "accepted",
      challenge: expect.objectContaining({
        status: "DIFFERENT_BUILD",
        challengerDisplay: "a friend",
        challengerScore: null,
      }),
    });
  });

  it("accepts covered Daily links and fails closed outside published coverage", async () => {
    const published = gameData.dailySeedSaltMap?.dates[0];
    if (!published) throw new Error("daily fixture missing");
    const daily = complete({
      ...buildOriginRecord(gameData, published.seed),
      challenge: { kind: "daily", date: published.date, seed: published.seed },
    });
    const coveredToken = encodeRunToken(daily);
    const coveredVerification = verifyRunTokenForOg(coveredToken, validation);
    const coveredProof = await signVerifiedFriendChallenge(
      coveredToken,
      coveredVerification,
      validation,
      SECRET,
    );
    expect(coveredProof).not.toBeNull();
    await expect(
      verifyFriendChallengeForPlay(coveredToken, coveredProof!, validation, SECRET),
    ).resolves.toEqual({
      status: "accepted",
      challenge: expect.objectContaining({ status: "VERIFIED", dailyDate: published.date }),
    });

    const oldDate = "2020-01-01";
    const oldSeed = `wcdraft:daily:v1:${oldDate}`;
    const oldToken = encodeRunToken(
      complete({
        ...buildOriginRecord(gameData, oldSeed),
        challenge: { kind: "daily", date: oldDate, seed: oldSeed },
      }),
    );
    const oldVerification = verifyRunTokenForOg(oldToken, validation);
    await expect(
      signVerifiedFriendChallenge(oldToken, oldVerification, validation, SECRET),
    ).resolves.toBeNull();
    await expect(
      verifyFriendChallengeForPlay(oldToken, await proofFor(oldToken), validation, SECRET),
    ).resolves.toEqual({ status: "rejected", reason: "DAILY_UNAVAILABLE" });
  });
});
