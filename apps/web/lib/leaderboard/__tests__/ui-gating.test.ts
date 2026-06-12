// F-4 U4 — UI ship-dark gating + component state renders.
//
// Server-side gate only (no NEXT_PUBLIC_ mirror): with LEADERBOARD_ENABLED
// unset/garbage the /leaderboard page 404s exactly like the API routes, the
// nav has no Leaderboard entry (no dead links), and the results page passes
// a false prop so the submit affordance never mounts. Component states are
// string-rendered (no DOM env) — every submit outcome + board state.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildMenu, SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth-context";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  BoardError,
  BoardHead,
  BoardRows,
  EmptyBoard,
  MeChip,
} from "@/components/leaderboard/board-views";
import { SubmitPanelView } from "@/components/leaderboard/submit-panel-views";
import { LeaderboardSubmitPanel } from "@/components/leaderboard/submit-panel";
import LeaderboardPage from "@/app/leaderboard/page";
import ResultsPage from "@/app/play/results/page";
import { ResultsScreen } from "@/components/game/results-screen";

import { boardRowViews } from "../board-view";
import { submitStatusCopy } from "../submit-copy";
import type { SubmitPhase } from "../submit-state";
import { runSimulationSync } from "../../game/simulate";
import type { RunRecordV1 } from "../../game/run-record";
import { buildOriginRecord, buildServerGameData, serverScenarioBundle } from "./_harness";

const FLAG = "LEADERBOARD_ENABLED";
let savedFlag: string | undefined;

beforeEach(() => {
  savedFlag = process.env[FLAG];
  delete process.env[FLAG];
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
});

/** Depth-first search of a React element tree for a component type. */
function findElement(node: ReactNode, type: unknown): ReactElement | null {
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  const children = (node.props as { children?: ReactNode }).children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const hit = findElement(child, type);
    if (hit !== null) return hit;
  }
  return null;
}

describe("ship-dark — flag off", () => {
  it("/leaderboard page 404s like the API (notFound before any data work)", () => {
    let digest: string | null = null;
    try {
      LeaderboardPage();
    } catch (err) {
      digest = (err as { digest?: string }).digest ?? null;
    }
    expect(digest).toMatch(/NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("nav has no Leaderboard entry (no dead link anywhere)", () => {
    const menu = buildMenu({ leaderboardEnabled: false });
    expect(menu.some((m) => m.href === "/leaderboard")).toBe(false);
  });

  it("results page passes leaderboardEnabled=false to the screen", () => {
    const tree = ResultsPage();
    const screen = findElement(tree, ResultsScreen);
    expect(screen).not.toBeNull();
    expect((screen!.props as { leaderboardEnabled: boolean }).leaderboardEnabled).toBe(false);
  });
});

describe("ship-dark — flag on", () => {
  beforeEach(() => {
    process.env[FLAG] = "1";
  });

  it("/leaderboard renders the board shell with the current season key", () => {
    const html = renderToStaticMarkup(LeaderboardPage());
    expect(html).toContain("Leaderboard");
    expect(html).toContain("Season ");
    // The full derived key is shown as evidence.
    expect(html).toMatch(/engine-[0-9.]+_/);
  });

  it("nav gains the Leaderboard entry between History and How to Play", () => {
    const menu = buildMenu({ leaderboardEnabled: true });
    const hrefs = menu.map((m) => m.href);
    expect(hrefs.indexOf("/leaderboard")).toBe(hrefs.indexOf("/play/history") + 1);
  });

  it("site header renders the entry in desktop and mobile menus", () => {
    const noop = () => undefined;
    const routerStub = {
      push: noop,
      replace: noop,
      prefetch: noop,
      back: noop,
      forward: noop,
      refresh: noop,
    } as unknown as AppRouterInstance;
    const renderHeader = (leaderboardEnabled: boolean) =>
      renderToStaticMarkup(
        createElement(
          AppRouterContext.Provider,
          { value: routerStub },
          createElement(
            ThemeProvider,
            null,
            createElement(AuthProvider, {
              authEnabled: false,
              children: createElement(SiteHeader, { leaderboardEnabled }),
            }),
          ),
        ),
      );
    expect(renderHeader(true).split('href="/leaderboard"').length - 1).toBe(2);
    expect(renderHeader(false)).not.toContain('href="/leaderboard"');
  });

  it("results page passes leaderboardEnabled=true to the screen", () => {
    const tree = ResultsPage();
    const screen = findElement(tree, ResultsScreen);
    expect((screen!.props as { leaderboardEnabled: boolean }).leaderboardEnabled).toBe(true);
  });
});

// ─── Submit affordance — container gates ────────────────────────────────────

describe("LeaderboardSubmitPanel (container)", () => {
  const gameData = buildServerGameData();
  const scenario = serverScenarioBundle();

  function simulatedRecord(mode: "classic" | "hidden"): RunRecordV1 {
    const record = buildOriginRecord(gameData, `wcdraft:f4-u4-ui:${mode}:1`, mode);
    const { simulation } = runSimulationSync(gameData, scenario, record);
    return { ...record, status: "complete", simulation };
  }

  it("renders the affordance for a simulated run (classic AND hidden)", () => {
    for (const mode of ["classic", "hidden"] as const) {
      const html = renderToStaticMarkup(
        createElement(LeaderboardSubmitPanel, { gameData, record: simulatedRecord(mode) }),
      );
      expect(html).toContain("Post to leaderboard");
      expect(html).toContain(mode === "hidden" ? "Memory" : "Classic");
    }
  });

  it("shows the run's engine score (the value being claimed)", () => {
    const record = simulatedRecord("classic");
    const html = renderToStaticMarkup(createElement(LeaderboardSubmitPanel, { gameData, record }));
    expect(html).toContain(`${record.simulation!.run.score}`);
  });

  it("is ABSENT (not disabled) when version anchors mismatch the bundle", () => {
    const record = simulatedRecord("classic");
    const skewed: RunRecordV1 = {
      ...record,
      versions: { ...record.versions, dataset_version: "1999-01-01" },
    };
    const html = renderToStaticMarkup(
      createElement(LeaderboardSubmitPanel, { gameData, record: skewed }),
    );
    expect(html).toBe("");
  });

  it("is absent for an unsimulated record", () => {
    const record = buildOriginRecord(gameData, "wcdraft:f4-u4-ui:nosim:1");
    const html = renderToStaticMarkup(createElement(LeaderboardSubmitPanel, { gameData, record }));
    expect(html).toBe("");
  });
});

// ─── Submit affordance — every outcome state ────────────────────────────────

describe("SubmitPanelView — every outcome state string maps to its phase", () => {
  function render(phase: SubmitPhase, retryRemaining: number | null = null): string {
    return renderToStaticMarkup(
      createElement(SubmitPanelView, {
        score: 41,
        draftMode: "classic",
        name: "golden_xi",
        nameHint: null,
        phase,
        retryRemaining,
        onNameChange: () => undefined,
        onSubmit: () => undefined,
      }),
    );
  }

  it("idle: form with name input + submit", () => {
    const html = render({ kind: "idle" });
    expect(html).toContain("lb-display-name");
    expect(html).toContain("Post to leaderboard");
    expect(html).toContain("41");
  });

  it("submitting: disabled in-flight state", () => {
    const html = render({ kind: "submitting" });
    expect(html).toContain("Submitting…");
    expect(html).toContain("disabled");
  });

  it("accepted (201): rank from the same DB snapshot", () => {
    const html = render({ kind: "accepted", rank: 4, score: 41 });
    expect(html).toContain("On the board");
    expect(html).toContain("Rank #4");
    expect(html).toContain('href="/leaderboard"');
  });

  it("accepted with null rank: posted, no invented rank", () => {
    const html = render({ kind: "accepted", rank: null, score: 41 });
    expect(html).toContain("On the board");
    expect(html).not.toContain("Rank #");
  });

  it("duplicate (200): honest already-on-the-board with existing rank", () => {
    const html = render({ kind: "duplicate", rank: 7, score: 41 });
    expect(html).toContain("Already on the board");
    expect(html).toContain("rank #7");
  });

  it("submitted-earlier (local memory): no form, link to board", () => {
    const html = render({ kind: "submitted-earlier" });
    expect(html).toContain("Posted from this device");
    expect(html).not.toContain("lb-display-name");
  });

  it("WRONG_SEASON: different-build/season copy", () => {
    const html = render({
      kind: "rejected",
      code: "WRONG_SEASON",
      copy: submitStatusCopy("WRONG_SEASON"),
      nameHint: null,
      retryAfterSeconds: null,
    });
    expect(html).toContain("Different season");
    expect(html).toContain("different build/season");
  });

  it("RATE_LIMITED: Retry-After surfaced and submit disabled", () => {
    const html = render(
      {
        kind: "rejected",
        code: "RATE_LIMITED",
        copy: submitStatusCopy("RATE_LIMITED"),
        nameHint: null,
        retryAfterSeconds: 30,
      },
      30,
    );
    expect(html).toContain("Try again in 30s.");
    expect(html).toContain("disabled");
  });

  it("AUTH_REQUIRED: sign-in affordance", () => {
    const html = render({
      kind: "rejected",
      code: "AUTH_REQUIRED",
      copy: submitStatusCopy("AUTH_REQUIRED"),
      nameHint: null,
      retryAfterSeconds: null,
    });
    expect(html).toContain('href="/sign-in"');
  });

  it("INVALID_NAME: server verdict + mirrored hint", () => {
    const html = render({
      kind: "rejected",
      code: "INVALID_NAME",
      copy: submitStatusCopy("INVALID_NAME"),
      nameHint: "At most 20 characters.",
      retryAfterSeconds: null,
    });
    expect(html).toContain("Name not accepted");
    expect(html).toContain("At most 20 characters.");
  });

  it("unreachable: transport failure is its own honest state", () => {
    const html = render({ kind: "unreachable" });
    expect(html).toContain("reach the server");
    expect(html).toContain("Nothing was posted");
  });
});

// ─── Board views ─────────────────────────────────────────────────────────────

describe("board views", () => {
  const NOW = Date.parse("2026-06-10T12:00:00.000Z");
  const rows = boardRowViews(
    [
      {
        rank: 1,
        id: "a",
        draft_mode: "classic",
        display_name: "alpha_xi",
        verified_score: 88,
        score_breakdown: [{ label: "Goals scored", raw: 4, weight: 3, points: 12 }],
        created_at: new Date(NOW - 120_000).toISOString(),
      },
      {
        rank: 2,
        id: "b",
        draft_mode: "hidden",
        display_name: "blind_side",
        verified_score: 70,
        score_breakdown: null,
        created_at: new Date(NOW - 3_600_000).toISOString(),
      },
    ],
    { nowMs: NOW, myEntryId: "b" },
  );

  it("populated rows: rank, name, score, declared-mode badge, time, me-highlight", () => {
    const html = renderToStaticMarkup(
      createElement(BoardRows, { rows, openKey: null, onToggle: () => undefined }),
    );
    expect(html).toContain("alpha_xi");
    expect(html).toContain("88");
    expect(html).toContain("Classic");
    expect(html).toContain("Memory"); // hidden-mode badge
    expect(html).toContain("2m ago");
    expect(html).toContain("You"); // me-highlight badge on entry b only
    expect(html).toContain('data-mine="true"');
  });

  it("open row shows the verified score breakdown (evidence)", () => {
    const html = renderToStaticMarkup(
      createElement(BoardRows, { rows, openKey: "a", onToggle: () => undefined }),
    );
    expect(html).toContain("Goals scored");
    expect(html).toContain("+12");
  });

  it("open row without a stored breakdown says so — never fabricates", () => {
    const html = renderToStaticMarkup(
      createElement(BoardRows, { rows, openKey: "b", onToggle: () => undefined }),
    );
    expect(html).toContain("No breakdown recorded");
  });

  it("empty board is words, not placeholder rows", () => {
    const html = renderToStaticMarkup(createElement(EmptyBoard));
    expect(html).toContain("No verified entries yet");
  });

  it("error state is an alert with retry — never an empty board", () => {
    const html = renderToStaticMarkup(createElement(BoardError, { onRetry: () => undefined }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
  });

  it("me-chip shows season-scope best + rank; honest dash when boardless", () => {
    const withRank = renderToStaticMarkup(
      createElement(MeChip, { me: { bestEntryId: "b", rank: 9, verifiedScore: 70 } }),
    );
    expect(withRank).toContain("rank #9");
    const noRank = renderToStaticMarkup(
      createElement(MeChip, { me: { bestEntryId: "b", rank: null, verifiedScore: 70 } }),
    );
    expect(noRank).toContain("—");
  });

  it("board head carries the season label + full key as evidence", () => {
    const html = renderToStaticMarkup(
      createElement(BoardHead, {
        currentSeasonKey:
          "engine-2026.06.11_wc-perf-4.2.1+proj-career-3.0.0_2026-06-04_ruleset-2026.06.04_f166edc0",
      }),
    );
    expect(html).toContain("Season 2026-06-04 · engine-2026.06.11");
    expect(html).toContain("f166edc0");
  });
});
