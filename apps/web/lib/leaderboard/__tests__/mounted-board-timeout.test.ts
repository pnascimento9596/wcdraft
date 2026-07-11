// @vitest-environment happy-dom

import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardScreen } from "@/components/leaderboard/board-screen";
import { advanceTime, buttonByText, click, mountReact } from "@/lib/test/dom-harness";

vi.mock("@/components/auth-context", () => ({
  useAuth: () => ({
    authEnabled: true,
    session: null,
    ready: true,
    sessionError: null,
    isSignedIn: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("next/link", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
      React.createElement("a", { ...props, href: typeof href === "string" ? href : "#" }, children),
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe("mounted BoardScreen first load", () => {
  it("expires a held-open board read and Retry starts one new GET", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/leaderboard");
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetcher);

    const view = await mountReact(createElement(BoardScreen, { currentSeasonKey: "2026-s1" }));
    try {
      expect(view.container.textContent).toContain("Loading the board…");
      const initialCalls = fetcher.mock.calls.length;
      expect(initialCalls).toBeGreaterThan(0);

      await advanceTime(12_000);

      expect(view.container.textContent).toContain("The board took too long to load");
      expect(view.container.textContent).toContain("It is safe to retry this read.");
      expect(view.container.textContent).toContain("Keep drafting");
      expect(view.container.textContent).not.toContain("Loading the board…");

      await click(buttonByText(view.container, "Retry board"));
      expect(fetcher).toHaveBeenCalledTimes(initialCalls + 1);
      const retryCall = fetcher.mock.calls.at(-1);
      expect(retryCall?.[1]).not.toMatchObject({
        method: expect.stringMatching(/POST|PUT|PATCH|DELETE/),
      });

      await advanceTime(12_000);
      expect(view.container.textContent).toContain("The board took too long to load");
    } finally {
      await view.unmount();
    }
  });
});
