// @vitest-environment happy-dom

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHALLENGE_PROOF_BUDGET_MS,
  ChallengeFriendButton,
} from "@/components/game/challenge-friend-button";
import type { RunRecordV1 } from "@/lib/game/run-record";
import { resetRunOgPrewarmForTests } from "@/lib/game/run-og-prewarm";
import { advanceTime, buttonByText, click, mountReact } from "@/lib/test/dom-harness";

const TOKEN = "t3.challenge-proof-mounted-timeout";
const RECORD = {} as RunRecordV1;

vi.mock("@/lib/game/run-token", () => ({
  encodeRunToken: vi.fn(() => TOKEN),
}));

function proofResponse(): Response {
  const challengeProof = ["fc1", "mounted-proof"].join(".");
  return new Response(JSON.stringify({ challenge_proof: challengeProof }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetRunOgPrewarmForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resetRunOgPrewarmForTests();
  document.body.replaceChildren();
});

describe("mounted friend-challenge proof timeout recovery", () => {
  it.each([
    {
      name: "request that never returns headers",
      firstResponse: () => new Promise<Response>(() => undefined),
    },
    {
      name: "response whose JSON body never settles",
      firstResponse: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull: () => new Promise<void>(() => undefined),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    },
  ])("leaves pending after a $name and manually retries once", async ({ firstResponse }) => {
    const requestSignals: AbortSignal[] = [];
    let requestCount = 0;
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      if (!(init?.signal instanceof AbortSignal)) throw new Error("proof request signal missing");
      requestSignals.push(init.signal);
      requestCount += 1;
      return requestCount === 1 ? firstResponse() : Promise.resolve(proofResponse());
    });
    const clipboard = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetcher);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboard },
    });

    const view = await mountReact(createElement(ChallengeFriendButton, { record: RECORD }));
    try {
      await click(buttonByText(view.container, "Challenge a friend"));
      await advanceTime(0);

      expect(fetcher).toHaveBeenCalledOnce();
      expect(view.container.textContent).toContain("Verifying challenge…");
      expect(clipboard).not.toHaveBeenCalled();

      await advanceTime(CHALLENGE_PROOF_BUDGET_MS);

      expect(fetcher).toHaveBeenCalledOnce();
      expect(requestSignals[0]?.aborted).toBe(true);
      expect(view.container.textContent).toContain("Retry challenge link");
      expect(view.container.textContent).not.toContain("Verifying challenge…");
      expect(clipboard).not.toHaveBeenCalled();

      await click(buttonByText(view.container, "Retry challenge link"));
      await advanceTime(0);

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(requestSignals[1]).not.toBe(requestSignals[0]);
      expect(requestSignals[1]?.aborted).toBe(false);
      expect(clipboard).toHaveBeenCalledOnce();
      expect(view.container.textContent).toContain("Challenge link copied ✓");
    } finally {
      await view.unmount();
    }
  });
});
