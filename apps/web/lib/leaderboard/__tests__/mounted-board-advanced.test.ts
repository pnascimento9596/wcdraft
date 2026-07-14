// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardScreen } from "@/components/leaderboard/board-screen";
import { click, mountReact } from "@/lib/test/dom-harness";

import { ADVANCED_BOARD_CONFIG_OPTIONS } from "../config";
import { ARCHIVED_LEADERBOARD_SEASON_IDS, DEFAULT_LEADERBOARD_SEASON_ID } from "../season";

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
    default: ({
      href,
      children,
      onNavigate,
      ...props
    }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { onNavigate?: () => void }) =>
      React.createElement(
        "a",
        {
          ...props,
          href: typeof href === "string" ? href : "#",
          onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
            props.onClick?.(event);
            if (!event.defaultPrevented) onNavigate?.();
          },
        },
        children,
      ),
  };
});

const ARCHIVED_SEASON = ARCHIVED_LEADERBOARD_SEASON_IDS[0];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

function requestUrl(input: RequestInfo | URL): URL {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, window.location.origin);
}

function boardResponse(url: URL, fieldSize: number): Response {
  const summary = url.searchParams.get("limit") === "1";
  return Response.json({
    season_key: url.searchParams.get("season") ?? DEFAULT_LEADERBOARD_SEASON_ID,
    current_season_key: DEFAULT_LEADERBOARD_SEASON_ID,
    mode: url.searchParams.get("mode") ?? "ranked",
    draft_mode: url.searchParams.get("draft_mode") ?? "classic",
    draft_order: url.searchParams.get("draft_order") ?? "squad_first",
    era: url.searchParams.get("era") ?? "all_time",
    rating_basis: url.searchParams.get("rating_basis") ?? "career",
    challenge_type: "season",
    challenge_date: null,
    next_cursor: null,
    entries: summary ? [{ field_size: fieldSize }] : [],
  });
}

async function setAdvancedOpen(container: ParentNode, open: boolean): Promise<void> {
  const details = container.querySelector("details");
  if (!(details instanceof HTMLDetailsElement)) throw new Error("Advanced details not found");
  await act(async () => {
    details.open = open;
    details.dispatchEvent(new Event("toggle"));
  });
}

function advancedLaneButton(container: ParentNode): HTMLButtonElement {
  const label = ADVANCED_BOARD_CONFIG_OPTIONS[0]!.label;
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Advanced lane not found: ${label}`);
  return button;
}

function linkByText(container: ParentNode, text: string): HTMLAnchorElement {
  const link = [...container.querySelectorAll("a")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!(link instanceof HTMLAnchorElement)) throw new Error(`Link not found: ${text}`);
  return link;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("mounted BoardScreen advanced summaries", () => {
  it("settles all 62 summaries and enables a lane at the five-run threshold", async () => {
    window.history.replaceState(null, "", "/leaderboard?challenge=season");
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      return boardResponse(url, 5);
    });
    vi.stubGlobal("fetch", fetcher);

    const view = await mountReact(
      createElement(BoardScreen, {
        currentSeasonKey: DEFAULT_LEADERBOARD_SEASON_ID,
        archivedSeasonKeys: ARCHIVED_LEADERBOARD_SEASON_IDS,
      }),
    );
    try {
      expect(ADVANCED_BOARD_CONFIG_OPTIONS).toHaveLength(62);
      await setAdvancedOpen(view.container, true);
      await act(async () => {
        await vi.waitFor(() => {
          expect(view.container.textContent).not.toContain("Checking which lanes are open…");
        });
      });

      const summaryCalls = fetcher.mock.calls.filter(
        ([input]) => requestUrl(input).searchParams.get("limit") === "1",
      );
      expect(summaryCalls).toHaveLength(62);
      expect(advancedLaneButton(view.container).disabled).toBe(false);
      expect(advancedLaneButton(view.container).textContent).toContain("5 runs");

      await setAdvancedOpen(view.container, false);
      expect(view.container.textContent).toContain("Checking which lanes are open…");
      await setAdvancedOpen(view.container, true);
      await act(async () => {
        await vi.waitFor(() => {
          const reopenedCalls = fetcher.mock.calls.filter(
            ([input]) => requestUrl(input).searchParams.get("limit") === "1",
          );
          expect(reopenedCalls).toHaveLength(124);
          expect(view.container.textContent).not.toContain("Checking which lanes are open…");
        });
      });
      expect(advancedLaneButton(view.container).disabled).toBe(false);
    } finally {
      await view.unmount();
    }
  });

  it("refetches across current/archive navigation and ignores the stale season batch", async () => {
    window.history.replaceState(null, "", "/leaderboard?challenge=season");
    const staleCurrent = Array.from({ length: 62 }, () => deferred<Response>());
    let staleIndex = 0;
    let deferCurrent = true;
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.searchParams.get("limit") !== "1") {
        return Promise.resolve(boardResponse(url, 0));
      }
      const season = url.searchParams.get("season");
      if (season === DEFAULT_LEADERBOARD_SEASON_ID && deferCurrent) {
        return staleCurrent[staleIndex++]!.promise;
      }
      return Promise.resolve(boardResponse(url, season === ARCHIVED_SEASON ? 5 : 7));
    });
    vi.stubGlobal("fetch", fetcher);

    const view = await mountReact(
      createElement(BoardScreen, {
        currentSeasonKey: DEFAULT_LEADERBOARD_SEASON_ID,
        archivedSeasonKeys: ARCHIVED_LEADERBOARD_SEASON_IDS,
      }),
    );
    try {
      await setAdvancedOpen(view.container, true);
      await act(async () => {
        await vi.waitFor(() => expect(staleIndex).toBe(62));
      });

      await click(linkByText(view.container, "Summer 2026 archive"));
      await act(async () => {
        await vi.waitFor(() => {
          expect(view.container.textContent).toContain("Season closed");
          expect(advancedLaneButton(view.container).textContent).toContain("5 runs");
        });
      });

      await act(async () => {
        for (const pending of staleCurrent) {
          pending.resolve(
            boardResponse(
              new URL(
                `/api/leaderboard?season=${DEFAULT_LEADERBOARD_SEASON_ID}&limit=1`,
                window.location.origin,
              ),
              99,
            ),
          );
        }
        await Promise.all(staleCurrent.map(({ promise }) => promise));
      });
      expect(advancedLaneButton(view.container).textContent).toContain("5 runs");
      expect(advancedLaneButton(view.container).textContent).not.toContain("99 runs");

      deferCurrent = false;
      await click(linkByText(view.container, "View current season"));
      await act(async () => {
        await vi.waitFor(() => {
          expect(view.container.textContent).not.toContain("Season closed");
          expect(advancedLaneButton(view.container).textContent).toContain("7 runs");
        });
      });

      const summarySeasons = fetcher.mock.calls
        .map(([input]) => requestUrl(input))
        .filter((url) => url.searchParams.get("limit") === "1")
        .map((url) => url.searchParams.get("season"));
      expect(summarySeasons.filter((season) => season === ARCHIVED_SEASON)).toHaveLength(62);
      expect(
        summarySeasons.filter((season) => season === DEFAULT_LEADERBOARD_SEASON_ID),
      ).toHaveLength(124);
    } finally {
      await view.unmount();
    }
  });
});
