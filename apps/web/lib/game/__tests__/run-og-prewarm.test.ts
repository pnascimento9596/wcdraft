import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  prewarmRunOgSign,
  resetRunOgPrewarmForTests,
  runOgPrewarmAttemptCountForTests,
  signRunOg,
} from "../run-og-prewarm";

const requestRunOgSign = vi.fn();

vi.mock("../run-og-client", () => ({
  requestRunOgSign: (...args: unknown[]) => requestRunOgSign(...args),
}));

describe("run OG prewarm dedupe", () => {
  beforeEach(() => {
    resetRunOgPrewarmForTests();
    requestRunOgSign.mockReset();
  });

  afterEach(() => {
    resetRunOgPrewarmForTests();
  });

  it("issues at most one sign request per run token regardless of rapid affordance touches", async () => {
    requestRunOgSign.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ signed: "signed-og", challengeProof: "proof-1" }),
            20,
          );
        }),
    );

    const token = "t3.same-run-token";
    const results = await Promise.all([
      prewarmRunOgSign(token),
      prewarmRunOgSign(token),
      signRunOg(token),
      signRunOg(token),
    ]);

    expect(requestRunOgSign).toHaveBeenCalledTimes(1);
    expect(runOgPrewarmAttemptCountForTests()).toBe(1);
    for (const result of results) {
      expect(result).toEqual({ signed: "signed-og", challengeProof: "proof-1" });
    }
  });

  it("does not block plain-link readiness while a sign is in flight", async () => {
    let release: ((value: { signed: string; challengeProof: null }) => void) | undefined;
    requestRunOgSign.mockImplementation(
      () =>
        new Promise<{ signed: string; challengeProof: null }>((resolve) => {
          release = resolve;
        }),
    );

    const pending = prewarmRunOgSign("t3.in-flight");
    const plainUrl = "https://wcdraft.com/play/share?run=t3.in-flight";
    expect(plainUrl).toContain("run=t3.in-flight");
    expect(requestRunOgSign).toHaveBeenCalledTimes(1);

    expect(release).toBeTypeOf("function");
    release!({ signed: "later", challengeProof: null });
    const result = await pending;
    expect(result?.signed).toBe("later");
  });

  it("reuses a successful cache and only re-fetches when force is set after soft-fail", async () => {
    requestRunOgSign
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ signed: "ok", challengeProof: null })
      .mockResolvedValueOnce({ signed: "again", challengeProof: null });

    expect(await signRunOg("t3.retry", { force: true })).toBeNull();
    expect(await signRunOg("t3.retry", { force: true })).toEqual({
      signed: "ok",
      challengeProof: null,
    });
    // Success is sticky without force.
    expect(await signRunOg("t3.retry")).toEqual({
      signed: "ok",
      challengeProof: null,
    });
    expect(requestRunOgSign).toHaveBeenCalledTimes(2);
  });
});
