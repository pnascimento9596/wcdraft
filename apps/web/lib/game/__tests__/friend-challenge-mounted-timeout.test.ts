// @vitest-environment happy-dom

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDraftScreenLoader } from "@/components/game/draft-screen/use-draft-screen-loader";
import {
  FRIEND_CHALLENGE_VERIFICATION_BUDGET_MS,
  type FriendChallengeSearchState,
} from "@/lib/game/friend-challenge";
import { advanceTime, buttonByText, click, mountReact } from "@/lib/test/dom-harness";

vi.mock("@/lib/game/data", () => ({
  loadDailyAvailability: vi.fn(async () => true),
  loadGameData: vi.fn(async () => ({})),
}));

const FRIEND_CHALLENGE: FriendChallengeSearchState = {
  kind: "ready",
  ref: { token: "t3.mounted-timeout", proof: "fc1.mounted-timeout" },
};
const LOADER_OPTIONS = { friendChallenge: FRIEND_CHALLENGE } as const;

function ChallengeLoaderHarness() {
  const { mode, retryFromError } = useDraftScreenLoader(null, LOADER_OPTIONS);
  return createElement(
    "div",
    null,
    createElement("span", null, mode.kind),
    mode.kind === "recovery" ? createElement("span", null, mode.title) : null,
    mode.kind === "recovery" && mode.retryable
      ? createElement("button", { type: "button", onClick: retryFromError }, "Retry verification")
      : null,
  );
}

function verifiedResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      challenge: {
        status: "VERIFIED",
        parentSeed: "wcdraft:friend:mounted-timeout",
        formationId: "4-3-3",
        mode: "classic",
        draftFlow: "squad_first",
        ratingBasis: "career",
        eraPreset: "all_time",
        dailyDate: null,
        challengerDisplay: "a friend",
        challengerScore: 42,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe("mounted friend-challenge verification timeout recovery", () => {
  it.each([
    {
      name: "request that never returns headers",
      firstResponse: () => new Promise<Response>(() => undefined),
    },
    {
      name: "response whose JSON body never settles",
      firstResponse: async () =>
        ({ ok: true, json: () => new Promise<unknown>(() => undefined) }) as Response,
    },
  ])("leaves loading after a $name and manually retries once", async ({ firstResponse }) => {
    const requestSignals: AbortSignal[] = [];
    let requestCount = 0;
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      if (!(init?.signal instanceof AbortSignal)) throw new Error("verification signal missing");
      requestSignals.push(init.signal);
      requestCount += 1;
      return requestCount === 1 ? firstResponse() : Promise.resolve(verifiedResponse());
    });
    vi.stubGlobal("fetch", fetcher);

    const view = await mountReact(createElement(ChallengeLoaderHarness));
    try {
      await advanceTime(0);
      expect(view.container.textContent).toContain("loading");
      expect(fetcher).toHaveBeenCalledOnce();

      await advanceTime(FRIEND_CHALLENGE_VERIFICATION_BUDGET_MS);

      expect(fetcher).toHaveBeenCalledOnce();
      expect(requestSignals[0]?.aborted).toBe(true);
      expect(view.container.textContent).toContain("recovery");
      expect(view.container.textContent).toContain("Couldn’t verify that challenge");
      expect(view.container.textContent).not.toContain("loading");
      expect(buttonByText(view.container, "Retry verification").disabled).toBe(false);

      await click(buttonByText(view.container, "Retry verification"));
      await advanceTime(0);

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(requestSignals[1]).not.toBe(requestSignals[0]);
      expect(requestSignals[1]?.aborted).toBe(false);
      expect(view.container.textContent).toContain("friend_setup");
    } finally {
      await view.unmount();
    }
  });
});
