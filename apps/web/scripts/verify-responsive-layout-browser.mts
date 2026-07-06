import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import {
  autoDraft,
  computeSynergy,
  createDraft,
  FORMATION_TEMPLATES,
  type DraftMode,
} from "@wcdraft/core";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";

import { buildGameDataFromBundles } from "../lib/game/__tests__/run-token.test-harness";
import {
  lineStrengthViews,
  managerCardView,
  managerTournamentFor,
  pitchSlotViews,
} from "../lib/game/adapters";
import type { Theme } from "../components/theme-provider";
import { runSimulationSync } from "../lib/game/simulate";
import {
  RUN_INDEX_KEY,
  RUN_RECORD_PREFIX,
  RUN_RECORD_SCHEMA_VERSION,
  type RunRecordV1,
} from "../lib/game/run-record";
import type { BoardPageWire } from "../lib/leaderboard/board-view";
import type { LeaderboardLineupView } from "../lib/leaderboard/lineup-view";
import { configBadgesFromRecordToken } from "../lib/game/config-badges";

type ViewportCase = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
};

type SurfaceCase = {
  readonly label: string;
  readonly path: string;
  readonly prepare?: (page: Page) => Promise<void>;
  readonly route?: (page: Page) => Promise<void>;
  readonly shellRule?: boolean;
  readonly allowResponseErrorPathnames?: readonly string[];
  readonly primaryAction?: {
    readonly role: "button" | "link" | "radio";
    readonly name: string | RegExp;
  };
};

type SurfaceMetric = {
  readonly surface: string;
  readonly viewport: string;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly theme: Theme;
  readonly screenshot: string;
  readonly shellRule: boolean;
  readonly noScrollGate: "pass" | "fail" | "n-a";
  readonly primaryActionAboveFold: boolean | null;
  readonly primaryActionInViewport: boolean | null;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly maxScrollWidth: number;
  readonly clientWidth: number;
  readonly horizontalOverflow: boolean;
  readonly navWraps: readonly string[];
  readonly maxContainerWidth: number;
  readonly smallTargets: readonly string[];
  readonly axeViolations: readonly string[];
  readonly desktopSignals: Record<string, boolean | number | string | null>;
  readonly consoleErrors: readonly string[];
};

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3027";
const PHASE = process.env.WCDRAFT_RESPONSIVE_PHASE ?? "capture";
const STRICT = process.env.WCDRAFT_RESPONSIVE_STRICT === "1";
const VIEWPORT_FILTER = new Set(
  (process.env.WCDRAFT_RESPONSIVE_VIEWPORTS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const SURFACE_FILTER = new Set(
  (process.env.WCDRAFT_RESPONSIVE_SURFACES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const OUT_DIR =
  process.env.WCDRAFT_RESPONSIVE_OUT_DIR ??
  path.join(REPO_ROOT, "docs/reports/desktop-responsive-2026-07-06", PHASE);
const AXE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";
const DEV_OVERLAY_CSS = `
  nextjs-portal,
  [data-nextjs-toast],
  [data-nextjs-dialog-overlay],
  [data-nextjs-build-indicator],
  [data-nextjs-dev-tools-button],
  [data-nextjs-dev-tools-panel] {
    display: none !important;
  }
`;
const gameData = buildGameDataFromBundles();

const viewports: readonly ViewportCase[] = [
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1512x982", width: 1512, height: 982 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "390x844", width: 390, height: 844 },
  { name: "360x800", width: 360, height: 800 },
];
const themes: readonly Theme[] = ["light", "dark"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function draftRecord(
  mode: DraftMode = "classic",
  opts: {
    readonly runId?: string;
    readonly parentSeed?: string;
    readonly draftFlow?: "squad_first" | "position_first";
    readonly teamName?: string;
  } = {},
): RunRecordV1 {
  const run_id = opts.runId ?? `resp-active-${mode}`;
  const parent_seed = opts.parentSeed ?? `wcdraft:responsive:${mode}:active`;
  const draft = createDraft(gameData.catalog, {
    run_id,
    parent_seed,
    formation_id: "4-3-3",
    mode,
    team_name: opts.teamName ?? "Responsive XI",
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    era_preset: "all_time",
    draft_flow: opts.draftFlow ?? "squad_first",
    rating_basis: "career",
  });
  return {
    record_version: RUN_RECORD_SCHEMA_VERSION,
    run_id,
    parent_seed,
    created_seq: 1,
    updated_seq: 1,
    versions: gameData.versions,
    draft,
    status: "ready",
  };
}

function completedRecord(run_id: string, teamName: string): RunRecordV1 {
  const parent_seed = `wcdraft:responsive:${run_id}`;
  const draft = autoDraft({
    run_id,
    parent_seed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: teamName,
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    dataset: gameData.draftDataset,
    era_preset: "all_time",
    draft_flow: "squad_first",
    rating_basis: "career",
  });
  const base: RunRecordV1 = {
    record_version: RUN_RECORD_SCHEMA_VERSION,
    run_id,
    parent_seed,
    created_seq: 10,
    updated_seq: 10,
    versions: gameData.versions,
    draft,
    status: "ready",
  };
  const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, base);
  return { ...base, status: "complete", simulation };
}

const activeDraftRecord = draftRecord("classic");
const activePositionRecord = draftRecord("classic", {
  runId: "resp-active-position-first",
  parentSeed: "wcdraft:responsive:position-first:active",
  draftFlow: "position_first",
  teamName: "Target XI",
});
const activeOpenRecord = draftRecord("open", {
  runId: "resp-active-open",
  parentSeed: "wcdraft:responsive:open:active",
  teamName: "Open XI",
});
const activeBlindOpenRecord = draftRecord("open_hidden", {
  runId: "resp-active-open-hidden",
  parentSeed: "wcdraft:responsive:open-hidden:active",
  teamName: "Blind Open XI",
});
const completeA = completedRecord("resp-complete-a", "Broadcast XI");
const completeB = completedRecord("resp-complete-b", "Wide View XI");
const seededRecords = [
  activeDraftRecord,
  activePositionRecord,
  activeOpenRecord,
  activeBlindOpenRecord,
  completeA,
  completeB,
] as const;

function localStoragePayload(records: readonly RunRecordV1[]) {
  return {
    recordPrefix: RUN_RECORD_PREFIX,
    indexKey: RUN_INDEX_KEY,
    schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    records,
  };
}

function lineupFromRecord(record: RunRecordV1): LeaderboardLineupView {
  assert(record.simulation, "leaderboard mock requires a simulated record");
  const formation = FORMATION_TEMPLATES[record.draft.formation_id]!;
  const basis = record.draft.rating_basis;
  const { starters, bench } = pitchSlotViews(gameData.indexes, record.draft, {
    blindRatings: false,
    basis,
  });
  const manager = record.draft.manager_card_id
    ? managerCardView(gameData.indexes, record.draft.manager_card_id)
    : null;
  const managerTournament = record.draft.manager_card_id
    ? managerTournamentFor(gameData.indexes, record.draft.manager_card_id)
    : null;
  const synergy = computeSynergy(
    record.draft.squad,
    formation,
    managerTournament,
    gameData.nationByCardId,
  );
  const run = record.simulation.run;
  return {
    team_name: record.draft.team_name,
    mode_label: "Classic",
    formation: { id: record.draft.formation_id, name: formation.name },
    badges: configBadgesFromRecordToken(record),
    result: {
      score: run.score,
      score_label: `${run.score.toString()} pts`,
      record: run.record,
      wins: run.wins,
      losses: run.losses,
      matches_played: record.simulation.matches.length,
      goals_for: run.goals_for,
      goals_against: run.goals_against,
      reached_round: run.reached_round,
      is_champion: run.is_champion,
      shootout_wins: run.shootout_wins,
    },
    starters,
    bench,
    manager,
    linked_pairs: synergy.linked_pairs,
    line_strengths: lineStrengthViews(gameData.indexes, record.draft, {
      blindRatings: false,
      basis,
    }),
    squad_average: null,
  };
}

function boardPage(): BoardPageWire {
  const now = Date.now();
  return {
    season_key: "season-2026-manager-attrition",
    current_season_key: "season-2026-manager-attrition",
    mode: "casual",
    draft_mode: "classic",
    draft_order: "squad_first",
    era: "all_time",
    rating_basis: "career",
    challenge_type: "season",
    challenge_date: null,
    next_cursor: null,
    entries: [
      {
        rank: 1,
        id: "11111111-1111-4111-8111-111111111111",
        draft_mode: "classic",
        draft_order: "squad_first",
        era: "all_time",
        rating_basis: "career",
        rating_version: gameData.versions.rating_version,
        percentile: 1,
        field_size: 38,
        display_name: "Broadcast XI",
        verified_score: completeA.simulation?.run.score ?? 0,
        score_breakdown: [
          { label: "Run score", points: completeA.simulation?.run.score ?? 0 },
          { label: "Champion bonus", points: completeA.simulation?.run.is_champion ? 20 : 0 },
        ],
        created_at: new Date(now - 12 * 60_000).toISOString(),
      },
      {
        rank: 2,
        id: "22222222-2222-4222-8222-222222222222",
        draft_mode: "classic",
        draft_order: "squad_first",
        era: "all_time",
        rating_basis: "career",
        rating_version: gameData.versions.rating_version,
        percentile: 5,
        field_size: 38,
        display_name: "Wide View XI",
        verified_score: completeB.simulation?.run.score ?? 0,
        score_breakdown: [{ label: "Run score", points: completeB.simulation?.run.score ?? 0 }],
        created_at: new Date(now - 42 * 60_000).toISOString(),
      },
    ],
  };
}

async function mockLeaderboard(page: Page): Promise<void> {
  await page.route("**/api/leaderboard**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/leaderboard/lineup") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, lineup: lineupFromRecord(completeA) }),
      });
      return;
    }
    if (url.pathname === "/api/leaderboard/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          best: {
            id: "11111111-1111-4111-8111-111111111111",
            verified_score: completeA.simulation?.run.score ?? 0,
          },
          rank: 1,
        }),
      });
      return;
    }
    if (url.pathname === "/api/leaderboard") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(boardPage()),
      });
      return;
    }
    await route.continue();
  });
}

async function makeContext(
  browser: Browser,
  viewport: ViewportCase,
  theme: Theme,
  allowResponseErrorPathnames: readonly string[] = [],
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const mobile = viewport.width <= 430;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    reducedMotion: "reduce",
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(
    ({ selectedTheme, storage, spinSkipReady }) => {
      window.localStorage.setItem("wcdraft:theme", selectedTheme);
      window.sessionStorage.setItem(spinSkipReady, "1");
      for (const record of storage.records) {
        window.localStorage.setItem(
          `${storage.recordPrefix}${record.run_id}`,
          JSON.stringify(record),
        );
      }
      window.localStorage.setItem(
        storage.indexKey,
        JSON.stringify({
          record_version: storage.schemaVersion,
          entries: storage.records.map((record) => ({
            run_id: record.run_id,
            created_seq: record.created_seq,
            updated_seq: record.updated_seq,
            versions: record.versions,
          })),
        }),
      );
      window.localStorage.setItem("wcdraft:run-counter:v1", "99");
    },
    {
      selectedTheme: theme,
      storage: localStoragePayload(seededRecords),
      spinSkipReady: "wcdraft.spin-skip-ready.v1",
    },
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !text.startsWith("Failed to load resource:")) {
      errors.push(text);
    }
  });
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const pathname = new URL(response.url()).pathname;
    if (allowResponseErrorPathnames.includes(pathname)) return;
    if (["/api/auth/csrf", "/api/runs", "/api/og/sign"].includes(pathname)) return;
    errors.push(`${response.status()} ${pathname}`);
  });
  return { context, page, errors };
}

async function runAxe(page: Page, axeSource: string): Promise<string[]> {
  await page.addScriptTag({ content: axeSource });
  return await page.evaluate(async () => {
    const runner = (
      window as typeof window & {
        axe?: {
          run: (
            node?: Element | Document,
            options?: unknown,
          ) => Promise<{ violations: { id: string; impact: string | null }[] }>;
        };
      }
    ).axe;
    if (!runner) throw new Error("axe not loaded");
    const result = await runner.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    return result.violations.map((violation) =>
      violation.impact ? `${violation.id}:${violation.impact}` : violation.id,
    );
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(250);
}

async function hideDevOverlay(page: Page): Promise<void> {
  if (process.env.WCDRAFT_HIDE_DEV_OVERLAY === "0") return;
  await page.addStyleTag({ content: DEV_OVERLAY_CSS }).catch(() => undefined);
}

function surfaceCases(): readonly SurfaceCase[] {
  const settleSpin = async (page: Page) => {
    await page.getByRole("button", { name: "Spin" }).click();
    await page.getByRole("button", { name: /Reveal choices/u }).waitFor();
  };
  const revealChoices = async (page: Page) => {
    await settleSpin(page);
    await page.getByRole("button", { name: /Reveal choices/u }).click();
    await page.locator('section[aria-label="Candidates"]').waitFor();
  };
  return [
    {
      label: "home",
      path: "/",
      primaryAction: { role: "link", name: /Play daily|Start drafting|Play/u },
      prepare: async (page) => {
        await page.getByRole("heading", { name: /Draft your/u }).waitFor();
      },
    },
    {
      label: "mode-select",
      path: "/play",
      primaryAction: { role: "radio", name: /Today/u },
      prepare: async (page) => {
        await page.getByRole("radio", { name: /Classic/u }).waitFor();
      },
    },
    {
      label: "draft-setup",
      path: "/play/draft",
      primaryAction: { role: "button", name: /Lock .* & spin/u },
      prepare: async (page) => {
        await page.getByRole("heading", { name: /Lock a formation/u }).waitFor();
      },
    },
    {
      label: "daily-spin",
      path: "/play/daily",
      shellRule: true,
      primaryAction: { role: "button", name: /Spin|Reveal choices/u },
      prepare: async (page) => {
        await page.getByRole("button", { name: /Spin|Reveal choices/u }).waitFor();
      },
    },
    {
      label: "spin-stage",
      path: `/play/draft?run=${activeDraftRecord.run_id}`,
      shellRule: true,
      primaryAction: { role: "button", name: /Reveal choices/u },
      prepare: async (page) => {
        await settleSpin(page);
      },
    },
    {
      label: "position-target",
      path: `/play/draft?run=${activePositionRecord.run_id}`,
      shellRule: true,
      primaryAction: { role: "button", name: /Starting XI|Bench|Manager/u },
      prepare: async (page) => {
        await page.getByRole("heading", { name: /Choose the slot to fill/u }).waitFor();
      },
    },
    {
      label: "classic-pick",
      path: `/play/draft?run=${activeDraftRecord.run_id}`,
      shellRule: true,
      primaryAction: { role: "button", name: /Lock pick|Choose slot/u },
      prepare: revealChoices,
    },
    {
      label: "open-roster-pick",
      path: `/play/draft?run=${activeOpenRecord.run_id}`,
      shellRule: true,
      primaryAction: { role: "button", name: /Lock pick|Choose slot/u },
      prepare: revealChoices,
    },
    {
      label: "blind-open-roster-pick",
      path: `/play/draft?run=${activeBlindOpenRecord.run_id}`,
      shellRule: true,
      primaryAction: { role: "button", name: /Lock pick|Choose slot/u },
      prepare: revealChoices,
    },
    {
      label: "squad-review",
      path: `/play/review?run=${completeA.run_id}`,
      shellRule: true,
      primaryAction: { role: "button", name: /Simulate the run/u },
      prepare: async (page) => {
        await page.getByRole("heading", { name: /4-3-3/u }).first().waitFor();
      },
    },
    {
      label: "results",
      path: `/play/results?run=${completeA.run_id}`,
      primaryAction: { role: "link", name: /Share|Review|Leaderboard|Play/u },
      prepare: async (page) => {
        await page.getByRole("heading", { name: /The run/u }).waitFor();
      },
    },
    {
      label: "share-author",
      path: `/play/share?run=${completeA.run_id}`,
      primaryAction: { role: "button", name: /Copy|Retry/u },
      prepare: async (page) => {
        await page.getByText("Share").first().waitFor();
      },
    },
    {
      label: "history",
      path: "/play/history",
      primaryAction: { role: "link", name: /View results|Replay|New draft|Play/u },
      prepare: async (page) => {
        await page.getByRole("heading", { name: /Recent runs/u }).waitFor();
      },
    },
    {
      label: "leaderboard",
      path: "/leaderboard?challenge=season",
      route: mockLeaderboard,
      primaryAction: { role: "button", name: /Broadcast XI/u },
      prepare: async (page) => {
        await page.getByText("Broadcast XI").first().waitFor();
        await page.getByRole("button", { name: /Broadcast XI/u }).click();
        await page.locator('[role="region"][aria-label^="Lineup inspector"]').waitFor();
      },
    },
    {
      label: "how-to-play",
      path: "/how-to-play",
      primaryAction: { role: "link", name: /Start drafting|Play/u },
      prepare: async (page) => {
        await page.getByRole("heading", { name: "How to Play" }).waitFor();
      },
    },
    {
      label: "account",
      path: "/account",
      primaryAction: { role: "link", name: /Sign in|Start/u },
      prepare: async (page) => {
        await page.getByRole("heading").first().waitFor();
      },
    },
    {
      label: "sign-in",
      path: "/sign-in",
      primaryAction: { role: "button", name: /Sign in|Send sign-in link/u },
      prepare: async (page) => {
        await page.getByRole("heading", { name: /sign in/u }).waitFor();
      },
    },
    {
      label: "sign-up",
      path: "/sign-up",
      primaryAction: { role: "button", name: /Create account/u },
      prepare: async (page) => {
        await page.getByRole("heading", { name: /create account/u }).waitFor();
      },
    },
    {
      label: "settings",
      path: "/settings",
      primaryAction: { role: "button", name: /Use system|Light|Dark/u },
      prepare: async (page) => {
        await page.getByRole("heading", { name: /Settings/u }).waitFor();
      },
    },
    {
      label: "privacy",
      path: "/privacy",
      prepare: async (page) => {
        await page.getByRole("heading", { name: /Privacy/u }).waitFor();
      },
    },
    {
      label: "not-found",
      path: "/definitely-not-a-wcdraft-route",
      allowResponseErrorPathnames: ["/definitely-not-a-wcdraft-route"],
      primaryAction: { role: "link", name: /home|Play/u },
      prepare: async (page) => {
        await page.getByRole("heading").first().waitFor();
      },
    },
  ];
}

async function measure(
  page: Page,
): Promise<
  Omit<
    SurfaceMetric,
    | "surface"
    | "viewport"
    | "viewportWidth"
    | "viewportHeight"
    | "theme"
    | "screenshot"
    | "shellRule"
    | "noScrollGate"
    | "primaryActionAboveFold"
    | "primaryActionInViewport"
    | "axeViolations"
    | "consoleErrors"
  >
> {
  return await page.evaluate(`(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      return el ? el.getBoundingClientRect() : null;
    };
    const sideBySide = (leftSelector, rightSelector) => {
      const left = rect(leftSelector);
      const right = rect(rightSelector);
      if (!left || !right) return false;
      const yOverlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      return yOverlap > 24 && Math.abs(left.left - right.left) > 80;
    };
    const doc = document.documentElement;
    const body = document.body;
    const navWraps = Array.from(document.querySelectorAll(".nav-link"))
      .map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const wraps = range.getClientRects().length > 1;
        range.detach();
        return wraps ? (el.textContent || "").trim() : null;
      })
      .filter(Boolean);
    const controls = Array.from(
      document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="radio"]'),
    ).filter((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        box.width > 0 &&
        box.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        !el.closest("[hidden]")
      );
    });
    const smallTargets = controls
      .map((el) => {
        const box = el.getBoundingClientRect();
        const text = (el.getAttribute("aria-label") || el.textContent || el.tagName)
          .replace(/\\s+/gu, " ")
          .trim()
          .slice(0, 80);
        return box.width < 44 || box.height < 44
          ? \`\${text || el.tagName} \${Math.round(box.width)}x\${Math.round(box.height)}\`
          : null;
      })
      .filter(Boolean);
    const containerWidths = Array.from(document.querySelectorAll(".container")).map(
      (el) => Math.round(el.getBoundingClientRect().width),
    );
    const maxScrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const modeGrid = document.querySelector('[class*="modeGrid"]');
    const desktopSignals = {
      draftSideBySide: sideBySide('section[aria-label="Your formation"]', 'section[aria-label="Candidates"]'),
      reviewSideBySide: sideBySide('section[aria-label="Final XI"]', 'section:not([aria-label])'),
      resultsOutcomeNarrativeSideBySide: sideBySide('[class*="outcome"]', '[class*="narrative"]'),
      leaderboardInspectorWide: sideBySide('[class*="lineupView"] [class*="pitch"]', '[class*="lineupMetrics"]'),
      modeGridColumns: modeGrid ? getComputedStyle(modeGrid).gridTemplateColumns.split(" ").length : null,
      bodyScrolls: doc.scrollHeight > doc.clientHeight + 1,
    };
    return {
      scrollHeight: doc.scrollHeight,
      clientHeight: doc.clientHeight,
      maxScrollWidth,
      clientWidth: doc.clientWidth,
      horizontalOverflow: maxScrollWidth > doc.clientWidth + 1,
      navWraps,
      maxContainerWidth: Math.max(0, ...containerWidths),
      smallTargets,
      desktopSignals,
    };
  })()`);
}

async function measurePrimaryAction(
  page: Page,
  action: SurfaceCase["primaryAction"],
): Promise<{ aboveFold: boolean | null; inViewport: boolean | null }> {
  if (!action) return { aboveFold: null, inViewport: null };
  const target = page.getByRole(action.role, { name: action.name }).first();
  const box = await target.boundingBox().catch(() => null);
  const viewport = page.viewportSize();
  if (!box || !viewport) return { aboveFold: null, inViewport: null };
  return {
    aboveFold: box.y < viewport.height,
    inViewport:
      box.x >= -1 &&
      box.y >= -1 &&
      box.x + box.width <= viewport.width + 1 &&
      box.y + box.height <= viewport.height + 1,
  };
}

function metricFailures(metric: SurfaceMetric): string[] {
  const failures: string[] = [];
  if (metric.shellRule && metric.noScrollGate === "fail") {
    const action =
      metric.primaryActionInViewport === true
        ? "primary visible"
        : `primary ${String(metric.primaryActionInViewport)}`;
    failures.push(
      `${metric.surface} ${metric.viewport} ${metric.theme}: shell scroll ${metric.scrollHeight}/${metric.clientHeight}; ${action}`,
    );
  }
  if (metric.horizontalOverflow) {
    failures.push(
      `${metric.surface} ${metric.viewport} ${metric.theme}: horizontal overflow ${metric.maxScrollWidth}/${metric.clientWidth}`,
    );
  }
  if (metric.axeViolations.length > 0) {
    failures.push(
      `${metric.surface} ${metric.viewport} ${metric.theme}: axe ${metric.axeViolations.join(",")}`,
    );
  }
  if (metric.navWraps.length > 0) {
    failures.push(
      `${metric.surface} ${metric.viewport} ${metric.theme}: nav wraps ${metric.navWraps.join(",")}`,
    );
  }
  if (metric.consoleErrors.length > 0) {
    failures.push(
      `${metric.surface} ${metric.viewport} ${metric.theme}: console ${metric.consoleErrors.join(",")}`,
    );
  }
  return failures;
}

function shellRuleApplies(surface: SurfaceCase, viewport: ViewportCase): boolean {
  return surface.shellRule === true && viewport.width >= 1024;
}

async function captureSurface(
  browser: Browser,
  axeSource: string,
  surface: SurfaceCase,
  viewport: ViewportCase,
  theme: Theme,
): Promise<SurfaceMetric> {
  const { context, page, errors } = await makeContext(
    browser,
    viewport,
    theme,
    surface.allowResponseErrorPathnames,
  );
  try {
    await surface.route?.(page);
    await page.goto(`${BASE_URL}${surface.path}`, { waitUntil: "domcontentloaded" });
    await surface.prepare?.(page);
    await settle(page);
    await hideDevOverlay(page);
    const axeViolations = await runAxe(page, axeSource);
    const primaryAction = await measurePrimaryAction(page, surface.primaryAction);
    const screenshotName = `${PHASE}-${surface.label}-${viewport.name}-${theme}.png`;
    const screenshotPath = path.join(OUT_DIR, "screenshots", screenshotName);
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const baseMetric = await measure(page);
    const shellRule = shellRuleApplies(surface, viewport);
    const noScrollGate = shellRule
      ? baseMetric.scrollHeight <= baseMetric.clientHeight + 1 && primaryAction.inViewport === true
        ? "pass"
        : "fail"
      : "n-a";
    return {
      surface: surface.label,
      viewport: viewport.name,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      theme,
      screenshot: path.relative(REPO_ROOT, screenshotPath),
      shellRule,
      noScrollGate,
      primaryActionAboveFold: primaryAction.aboveFold,
      primaryActionInViewport: primaryAction.inViewport,
      axeViolations,
      consoleErrors: errors,
      ...baseMetric,
    };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const axeSource = await fetch(AXE_CDN).then((res) => {
    if (!res.ok) throw new Error(`failed to fetch axe-core: HTTP ${res.status.toString()}`);
    return res.text();
  });
  const browser = await chromium.launch({
    channel: process.env.WCDRAFT_PLAYWRIGHT_CHANNEL ?? "chrome",
    headless: true,
  });
  const metrics: SurfaceMetric[] = [];
  const selectedSurfaces = surfaceCases().filter(
    (surface) => SURFACE_FILTER.size === 0 || SURFACE_FILTER.has(surface.label),
  );
  const selectedViewports = viewports.filter(
    (viewport) => VIEWPORT_FILTER.size === 0 || VIEWPORT_FILTER.has(viewport.name),
  );
  try {
    for (const surface of selectedSurfaces) {
      for (const viewport of selectedViewports) {
        for (const theme of themes) {
          const metric = await captureSurface(browser, axeSource, surface, viewport, theme);
          metrics.push(metric);
          const failures = metricFailures(metric);
          const status = failures.length === 0 ? "ok" : `issues=${failures.length.toString()}`;
          console.log(
            `[responsive:${PHASE}] ${status} ${surface.label} ${viewport.name} ${theme} screenshot=${metric.screenshot}`,
          );
        }
      }
    }
  } finally {
    await browser.close();
  }
  const payload = {
    phase: PHASE,
    baseUrl: BASE_URL,
    axeSource: AXE_CDN,
    surfaces: selectedSurfaces.map((surface) => surface.label),
    viewports: selectedViewports.map((viewport) => viewport.name),
    generatedAt: new Date().toISOString(),
    metrics,
  };
  await writeFile(path.join(OUT_DIR, `responsive-${PHASE}.json`), JSON.stringify(payload, null, 2));
  const failures = metrics.flatMap(metricFailures);
  if (STRICT && failures.length > 0) {
    throw new Error(`responsive layout verification failed:\n${failures.join("\n")}`);
  }
  console.log(
    `[responsive:${PHASE}] complete metrics=${metrics.length.toString()} failures=${failures.length.toString()} out=${OUT_DIR}`,
  );
}

await main();
