// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShareScreen } from "@/components/game/share-screen";
import type { RunRecordV1 } from "@/lib/game/run-record";
import type { ShareView } from "@/lib/game/share-adapters";
import { resetRunOgPrewarmForTests } from "@/lib/game/run-og-prewarm";
import { advanceTime, buttonByText, click, mountReact } from "@/lib/test/dom-harness";

const TOKEN = "t3.share-resilience-token";
const UNSIGNED_URL = `http://localhost:3000/play/share?run=${TOKEN}`;

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams("run=run-v1-share-resilience"),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

const RECORD = {
  run_id: "run-v1-share-resilience",
  challenge: undefined,
} as unknown as RunRecordV1;

const VIEW: ShareView = {
  team_name: "Resilient XI",
  draft_mode: "classic",
  headline: "CHAMPIONS",
  display_record: "8-0",
  is_champion: true,
  is_perfect_eight_zero: true,
  score: 41,
  goals_for: 22,
  goals_against: 3,
  formation_name: "4-3-3",
  manager: { name: "Manager", nation_code: "BRA" },
  stars: [
    { name: "Player One", nation_code: "BRA", overall: 95 },
    { name: "Player Two", nation_code: "ARG", overall: 94 },
    { name: "Player Three", nation_code: "FRA", overall: 93 },
  ],
  top_scorer: null,
  narrative: "Won every match. A perfect run.",
  seed: "share-resilience-seed",
  reached_round: "FINAL",
  matches_played: 8,
  shootout_wins: 0,
  challenge_date: null,
  perfect_run_reference: "Maximum reference",
  reveal: null,
};

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => navigation.params,
}));

vi.mock("next/link", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
      React.createElement("a", { ...props, href: typeof href === "string" ? href : "#" }, children),
  };
});

vi.mock("next/image", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) =>
      React.createElement("img", {
        ...props,
        src: String(props.src),
        alt: props.alt,
        priority: undefined,
      }),
  };
});

vi.mock("@/lib/game/run-screen-loader", () => ({
  resolveDisplayRun: vi.fn(async () => ({
    kind: "ready",
    gameData: {},
    scenario: null,
    record: RECORD,
    isReplayedFromToken: false,
    linkRunValue: RECORD.run_id,
  })),
}));

vi.mock("@/lib/game/run-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/game/run-token")>();
  return { ...actual, encodeRunToken: vi.fn(() => TOKEN) };
});

vi.mock("@/lib/game/share-adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/game/share-adapters")>();
  return { ...actual, buildShareView: vi.fn(() => VIEW) };
});

vi.mock("@/lib/game/config-badges", () => ({
  configBadgesFromRecordToken: () => [],
  configBadgesFromReplayToken: () => [],
}));

vi.mock("@/lib/game/reference-standing", () => ({
  loadScoreDistributionOnce: vi.fn(async () => null),
  referenceStandingForRecord: vi.fn(() => null),
}));

vi.mock("@/lib/leaderboard/client", () => ({
  fetchBoardPage: vi.fn(),
}));

vi.mock("@/lib/leaderboard/submit-state", () => ({
  wasTokenSubmitted: () => false,
}));

function installShareApis(
  options: {
    clipboard?: ReturnType<typeof vi.fn>;
    share?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const clipboard = options.clipboard ?? vi.fn(async () => undefined);
  const share = options.share ?? vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: share,
  });
  return { clipboard, share };
}

async function mountShare(fetcher: ReturnType<typeof vi.fn<typeof fetch>>) {
  vi.stubGlobal("fetch", fetcher);
  const view = await mountReact(createElement(ShareScreen));
  await advanceTime(0);
  expect(view.container.textContent).toContain("The card");
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetRunOgPrewarmForTests();
  navigation.params = new URLSearchParams("run=run-v1-share-resilience");
  window.history.replaceState(null, "", "/play/share?run=run-v1-share-resilience");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resetRunOgPrewarmForTests();
  document.body.replaceChildren();
});

describe("mounted share preview resilience", () => {
  it("keeps copy, native share, caption, and the sign contract available while preview is held open", async () => {
    const held: { signal?: AbortSignal } = {};
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>(() => {
          if (init?.signal instanceof AbortSignal) held.signal = init.signal;
        }),
    );
    const { clipboard, share } = installShareApis();
    const view = await mountShare(fetcher);
    try {
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0]?.[0]).toBe("/api/og/sign");
      expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run: TOKEN }),
      });
      expect(held.signal?.aborted).toBe(false);
      expect(view.container.textContent).toContain(
        "sharing works now with the static preview card",
      );
      expect(view.container.querySelector('[aria-label="Share caption"]')?.textContent).toContain(
        UNSIGNED_URL,
      );

      const copyCaption = buttonByText(view.container, "Copy caption");
      const nativeShare = buttonByText(view.container, "Native share");
      const copyLink = buttonByText(view.container, "Copy link");
      expect(copyCaption.disabled).toBe(false);
      expect(nativeShare.disabled).toBe(false);
      expect(copyLink.disabled).toBe(false);

      await click(copyLink);
      expect(clipboard).toHaveBeenLastCalledWith(UNSIGNED_URL);
      await click(buttonByText(view.container, "Copy caption"));
      expect(String(clipboard.mock.calls.at(-1)?.[0])).toContain(UNSIGNED_URL);
      await click(nativeShare);
      expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: UNSIGNED_URL }));
    } finally {
      await view.unmount();
    }
  });

  it("falls back honestly after signing failure and isolates Retry from share actions", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ ok: false }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { clipboard, share } = installShareApis();
    const view = await mountShare(fetcher);
    try {
      await advanceTime(650);
      await advanceTime(1_500);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(view.container.textContent).toContain("preview unavailable, link works");
      expect(view.container.textContent).toContain("static preview card");

      await click(buttonByText(view.container, "Copy link"));
      await click(buttonByText(view.container, "Copy caption"));
      await click(buttonByText(view.container, "Native share"));
      expect(clipboard).toHaveBeenCalledTimes(2);
      expect(share).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledTimes(3);

      await click(buttonByText(view.container, "Retry preview"));
      await advanceTime(0);
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      await view.unmount();
    }
  });

  it("uses the bounded timeout and leaves the replay link usable", async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    installShareApis();
    const view = await mountShare(fetcher);
    try {
      await advanceTime(4_000);
      await advanceTime(650);
      await advanceTime(4_000);
      await advanceTime(1_500);
      await advanceTime(4_000);

      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(view.container.textContent).toContain("preview unavailable, link works");
      expect(buttonByText(view.container, "Copy caption").disabled).toBe(false);
      expect(buttonByText(view.container, "Native share").disabled).toBe(false);
      expect(buttonByText(view.container, "Copy link").disabled).toBe(false);
    } finally {
      await view.unmount();
    }
  });

  it("includes a held-open preview response body in the signing budget", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull: () => new Promise<void>(() => undefined),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    installShareApis();
    const view = await mountShare(fetcher);
    try {
      await advanceTime(4_000);
      await advanceTime(650);
      await advanceTime(4_000);
      await advanceTime(1_500);
      await advanceTime(4_000);

      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(view.container.textContent).toContain("preview unavailable, link works");
      expect(buttonByText(view.container, "Copy link").disabled).toBe(false);
    } finally {
      await view.unmount();
    }
  });

  it("rejects an oversized preview response before accepting its signed value", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ ok: true, signed: "x".repeat(20_000) }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    installShareApis();
    const view = await mountShare(fetcher);
    try {
      await advanceTime(650);
      await advanceTime(1_500);

      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(view.container.textContent).toContain("preview unavailable, link works");
      expect(view.container.textContent).toContain("static preview card");
    } finally {
      await view.unmount();
    }
  });

  it("aborts on unmount and ignores a late signed-preview success", async () => {
    const deferred: {
      resolve?: (response: Response) => void;
      signal?: AbortSignal;
    } = {};
    const fetcher = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((resolve) => {
          deferred.resolve = resolve;
          if (init?.signal instanceof AbortSignal) deferred.signal = init.signal;
        }),
    );
    installShareApis();
    const view = await mountShare(fetcher);
    await view.unmount();
    expect(deferred.signal?.aborted).toBe(true);

    await act(async () => {
      deferred.resolve?.(
        new Response(JSON.stringify({ ok: true, signed: "late-signed-preview" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("late-signed-preview");
  });

  it("dispatches native share exactly once while the platform sheet is pending", async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const deferred: { resolve?: () => void } = {};
    const nativeShare = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          deferred.resolve = resolve;
        }),
    );
    installShareApis({ share: nativeShare });
    const view = await mountShare(fetcher);
    try {
      const button = buttonByText(view.container, "Native share");
      await click(button);
      await click(button);
      expect(nativeShare).toHaveBeenCalledOnce();
      expect(buttonByText(view.container, "Sharing...").disabled).toBe(true);

      await act(async () => {
        deferred.resolve?.();
        await Promise.resolve();
      });
      expect(buttonByText(view.container, "Native share").disabled).toBe(false);
    } finally {
      await view.unmount();
    }
  });
});
