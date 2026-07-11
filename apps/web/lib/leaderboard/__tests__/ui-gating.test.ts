// F-4 U4 — UI ship-dark gating + component state renders.
//
// Server-side gate only (no NEXT_PUBLIC_ mirror): with LEADERBOARD_ENABLED
// unset/garbage the /leaderboard page 404s exactly like the API routes, the
// nav has no Leaderboard entry (no dead links), and the results page passes
// a false prop so the submit affordance never mounts. Component states are
// string-rendered (no DOM env) — every submit outcome + board state.

import { readFileSync } from "node:fs";
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
  BoardToolbar,
  EmptyBoard,
  MeChip,
} from "@/components/leaderboard/board-views";
import { SubmitPanelView } from "@/components/leaderboard/submit-panel-views";
import { LeaderboardSubmitPanel } from "@/components/leaderboard/submit-panel";
import LeaderboardPage from "@/app/leaderboard/page";
import ResultsPage from "@/app/play/results/page";
import { ResultsScreen } from "@/components/game/results-screen";

import { boardRowViews } from "../board-view";
import {
  ADVANCED_BOARD_CONFIG_OPTIONS,
  BOARD_LANE_OPEN_ENTRY_THRESHOLD,
  DEFAULT_BOARD_FILTER,
  DEFAULT_DAILY_BOARD_FILTER,
  boardConfigKey,
} from "../config";
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

  it("/leaderboard renders the daily board shell as the cold landing surface", () => {
    const html = renderToStaticMarkup(LeaderboardPage());
    expect(html).toContain("Leaderboard");
    expect(html).toContain("Daily Leaderboard");
    expect(html).toContain("Daily Draft");
    expect(html).toContain("Advanced");
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
      expect(html).toContain("Post casual run");
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
  const LEADERBOARD_HREF =
    "/leaderboard?mode=casual&draft_mode=classic&draft_order=squad_first&era=all_time&rating_basis=career";

  function render(phase: SubmitPhase, retryRemaining: number | null = null): string {
    return renderToStaticMarkup(
      createElement(SubmitPanelView, {
        score: 41,
        draftMode: "classic",
        submitMode: "casual",
        authReady: true,
        isSignedIn: false,
        publicUsername: null,
        leaderboardHref: LEADERBOARD_HREF,
        name: "golden_xi",
        nameHint: null,
        phase,
        retryRemaining,
        onModeChange: () => undefined,
        onNameChange: () => undefined,
        onSubmit: () => undefined,
      }),
    );
  }

  it("idle: form with name input + submit", () => {
    const html = render({ kind: "idle" });
    expect(html).toContain("lb-display-name");
    expect(html).toContain("Post casual run");
    expect(html).toContain("Ranked");
    expect(html).toContain("41");
  });

  it("submitting: disabled in-flight state", () => {
    const html = render({ kind: "submitting" });
    expect(html).toContain("Submitting…");
    expect(html).toContain("disabled");
  });

  it("accepted (201): rank from the same DB snapshot", () => {
    const html = render({
      kind: "accepted",
      rank: 4,
      score: 41,
      percentile: null,
      fieldSize: 0,
    });
    expect(html).toContain("On the board");
    expect(html).toContain("Rank #4");
    expect(html).toContain(`href="${LEADERBOARD_HREF.replace(/&/g, "&amp;")}"`);
  });

  it("accepted with null rank: posted, no invented rank", () => {
    const html = render({
      kind: "accepted",
      rank: null,
      score: 41,
      percentile: null,
      fieldSize: 0,
    });
    expect(html).toContain("On the board");
    expect(html).not.toContain("Rank #");
  });

  it("duplicate (200): honest already-on-the-board with existing rank", () => {
    const html = render({
      kind: "duplicate",
      rank: 7,
      score: 41,
      percentile: null,
      fieldSize: 0,
    });
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

  it("ranked signed-out: rule copy appears before submit and button is disabled", () => {
    const html = renderToStaticMarkup(
      createElement(SubmitPanelView, {
        score: 41,
        draftMode: "classic",
        submitMode: "ranked",
        authReady: true,
        isSignedIn: false,
        publicUsername: null,
        leaderboardHref: LEADERBOARD_HREF,
        name: "",
        nameHint: null,
        phase: { kind: "idle" },
        retryRemaining: null,
        onModeChange: () => undefined,
        onNameChange: () => undefined,
        onSubmit: () => undefined,
      }),
    );
    expect(html).toContain(
      "Sign in to post ranked runs. Casual posts anonymously and can be claimed later.",
    );
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain("Post ranked run");
    expect(html).toContain("disabled");
  });

  it("ranked signed-in without username: collects a username before posting", () => {
    const html = renderToStaticMarkup(
      createElement(SubmitPanelView, {
        score: 41,
        draftMode: "classic",
        submitMode: "ranked",
        authReady: true,
        isSignedIn: true,
        publicUsername: null,
        leaderboardHref: LEADERBOARD_HREF,
        name: "",
        nameHint: null,
        phase: { kind: "idle" },
        retryRemaining: null,
        onModeChange: () => undefined,
        onNameChange: () => undefined,
        onSubmit: () => undefined,
      }),
    );
    expect(html).toContain("Choose a username for ranked.");
    expect(html).toContain("lb-username");
    expect(html).toContain("Username (3-20 chars: a-z, 0-9, _)");
    expect(html).not.toContain("disabled");
  });

  it("ranked signed-in without verified email: shows verification affordance", () => {
    const html = renderToStaticMarkup(
      createElement(SubmitPanelView, {
        score: 41,
        draftMode: "classic",
        submitMode: "ranked",
        authReady: true,
        isSignedIn: true,
        emailVerified: false,
        publicUsername: "public_user",
        leaderboardHref: LEADERBOARD_HREF,
        name: "",
        nameHint: null,
        phase: { kind: "idle" },
        retryRemaining: null,
        onModeChange: () => undefined,
        onNameChange: () => undefined,
        onSubmit: () => undefined,
      }),
    );
    expect(html).toContain("Verify your email to post ranked runs.");
    expect(html).toContain('href="/account?verify=1"');
    expect(html).toContain("Post ranked run");
    expect(html).toContain("disabled");
  });

  it("ranked signed-in with username: alias is optional per entry", () => {
    const html = renderToStaticMarkup(
      createElement(SubmitPanelView, {
        score: 41,
        draftMode: "classic",
        submitMode: "ranked",
        authReady: true,
        isSignedIn: true,
        publicUsername: "public_user",
        leaderboardHref: LEADERBOARD_HREF,
        name: "",
        nameHint: null,
        phase: { kind: "idle" },
        retryRemaining: null,
        onModeChange: () => undefined,
        onNameChange: () => undefined,
        onSubmit: () => undefined,
      }),
    );
    expect(html).toContain("Posting as");
    expect(html).toContain("public_user");
    expect(html).toContain("Optional alias (3-20 chars)");
    expect(html).toContain("Post ranked run");
  });

  it("ranked username text is HTML-escaped by construction", () => {
    const html = renderToStaticMarkup(
      createElement(SubmitPanelView, {
        score: 41,
        draftMode: "classic",
        submitMode: "ranked",
        authReady: true,
        isSignedIn: true,
        publicUsername: '<script>alert("x")</script>',
        leaderboardHref: LEADERBOARD_HREF,
        name: "",
        nameHint: null,
        phase: { kind: "idle" },
        retryRemaining: null,
        onModeChange: () => undefined,
        onNameChange: () => undefined,
        onSubmit: () => undefined,
      }),
    );
    expect(html).toContain("Posting as");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
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
    expect(html).toContain("No server verdict");
    expect(html).toContain("Check leaderboard");
    expect(html).not.toContain("Post casual run");
    expect(html).not.toContain("<input");
  });

  it("timeout: mutation outcome stays unknown and is not presented as safe to replay", () => {
    const html = render({ kind: "timeout" });
    expect(html).toContain("post timed out");
    expect(html).toContain("outcome is unknown");
    expect(html).toContain("Check leaderboard");
    expect(html).not.toContain("Post casual run");
    expect(html).not.toContain("<input");
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
        draft_order: "squad_first",
        era: "all_time",
        rating_basis: "career",
        rating_version: "ratings-test",
        percentile: 100,
        field_size: 2,
        display_name: "alpha_xi",
        verified_score: 88,
        score_breakdown: [{ label: "Goals scored", raw: 4, weight: 3, points: 12 }],
        created_at: new Date(NOW - 120_000).toISOString(),
      },
      {
        rank: 2,
        id: "b",
        draft_mode: "hidden",
        draft_order: "squad_first",
        era: "all_time",
        rating_basis: "career",
        rating_version: "ratings-test",
        percentile: 50,
        field_size: 2,
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
      createElement(BoardRows, {
        rows,
        filter: DEFAULT_BOARD_FILTER,
        openKey: null,
        lineups: {},
        onToggle: () => undefined,
      }),
    );
    expect(html).toContain("alpha_xi");
    expect(html).toContain("88");
    expect(html).toContain("Classic");
    expect(html).toContain("Memory"); // hidden-mode badge
    expect(html).toContain("2m ago");
    expect(html).toContain("You"); // me-highlight badge on entry b only
    expect(html).toContain('data-mine="true"');
  });

  it("public board names and breakdown labels render as escaped text", () => {
    const html = renderToStaticMarkup(
      createElement(BoardRows, {
        rows: [
          {
            key: "hostile",
            rank: 1,
            displayName: '<img src=x onerror="alert(1)">',
            score: 99,
            draftMode: "classic",
            draftOrder: "squad_first",
            era: "all_time",
            ratingBasis: "career",
            ratingVersion: "ratings-test",
            percentile: 100,
            fieldSize: 1,
            timeLabel: "10m ago",
            isMine: false,
            breakdown: [{ label: "<script>breakdown()</script>", points: 1 }],
          },
        ],
        filter: DEFAULT_BOARD_FILTER,
        openKey: "hostile",
        lineups: {},
        onToggle: () => undefined,
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;breakdown()&lt;/script&gt;");
  });

  it("open row shows the verified score breakdown (evidence)", () => {
    const html = renderToStaticMarkup(
      createElement(BoardRows, {
        rows,
        filter: DEFAULT_BOARD_FILTER,
        openKey: "a",
        lineups: {},
        onToggle: () => undefined,
      }),
    );
    expect(html).toContain("Goals scored");
    expect(html).toContain("+12");
  });

  it("open row without a stored breakdown says so — never fabricates", () => {
    const html = renderToStaticMarkup(
      createElement(BoardRows, {
        rows,
        filter: DEFAULT_BOARD_FILTER,
        openKey: "b",
        lineups: {},
        onToggle: () => undefined,
      }),
    );
    expect(html).toContain("No breakdown recorded");
  });

  it("empty board is config-scoped words, not placeholder rows", () => {
    const html = renderToStaticMarkup(createElement(EmptyBoard, { filter: DEFAULT_BOARD_FILTER }));
    expect(html).toContain("No runs yet for this board");
    expect(html).toContain("Classic ranked runs for this exact config");
  });

  it("daily rows lead with standing while keeping raw score secondary", () => {
    const html = renderToStaticMarkup(
      createElement(BoardRows, {
        rows,
        filter: DEFAULT_DAILY_BOARD_FILTER,
        openKey: null,
        lineups: {},
        onToggle: () => undefined,
      }),
    );
    expect(html).toContain("Top 100%");
    expect(html).toContain("88 pts");
    expect(html).toContain("#1 of 2 today");
  });

  it("toolbar keeps Daily/Season headline lanes and gates Advanced combos by count", () => {
    const openOption = ADVANCED_BOARD_CONFIG_OPTIONS.find(
      (option) => option.filter.lane === "casual" && option.filter.draftMode === "hidden",
    )!;
    const closedOption = ADVANCED_BOARD_CONFIG_OPTIONS.find(
      (option) => option.filter.lane === "ranked" && option.filter.draftMode === "hidden",
    )!;
    const html = renderToStaticMarkup(
      createElement(BoardToolbar, {
        filter: DEFAULT_BOARD_FILTER,
        onFilter: () => undefined,
        advancedOpen: true,
        advancedPhase: "ready",
        advancedSummaries: {
          [openOption.key]: { kind: "ready", count: BOARD_LANE_OPEN_ENTRY_THRESHOLD },
          [closedOption.key]: { kind: "ready", count: BOARD_LANE_OPEN_ENTRY_THRESHOLD - 1 },
        },
      }),
    );
    expect(html).toContain("Daily");
    expect(html).toContain("Season");
    expect(html).toContain("Advanced");
    expect(html).toContain(`${BOARD_LANE_OPEN_ENTRY_THRESHOLD.toString()} runs`);
    expect(html).toContain(`opens at ${BOARD_LANE_OPEN_ENTRY_THRESHOLD.toString()} runs`);
    expect(html).toContain("disabled");
    expect(html).not.toContain(boardConfigKey(DEFAULT_BOARD_FILTER));
  });

  it("error state is an alert with retry — never an empty board", () => {
    const html = renderToStaticMarkup(createElement(BoardError, { onRetry: () => undefined }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
  });

  it("timeout board state exposes a safe retry and a non-blocking alternate action", () => {
    const html = renderToStaticMarkup(
      createElement(BoardError, { timedOut: true, onRetry: () => undefined }),
    );
    expect(html).toContain("12 seconds");
    expect(html).toContain("Retry board");
    expect(html).toContain("Keep drafting");
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

  it("board head carries a human season label + raw-key tooltip evidence", () => {
    const html = renderToStaticMarkup(
      createElement(BoardHead, {
        currentSeasonKey: "season-2026-manager-attrition",
      }),
    );
    expect(html).toContain("Season · Summer 2026");
    expect(html).toContain('title="season-2026-manager-attrition"');
    expect(html).toContain("Season key verified");
  });
});

describe("identity rendering implementation guard", () => {
  it("profile/leaderboard name surfaces do not use dangerouslySetInnerHTML", () => {
    const files = [
      "../../../components/account-menu.tsx",
      "../../../components/leaderboard/board-views.tsx",
      "../../../components/leaderboard/submit-panel-views.tsx",
    ];
    for (const file of files) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8"), file).not.toContain(
        "dangerouslySetInnerHTML",
      );
    }
  });
});
