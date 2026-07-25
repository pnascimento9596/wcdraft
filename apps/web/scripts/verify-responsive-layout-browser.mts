import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit, type Browser, type BrowserContext, type Page } from "playwright-core";
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
import { sha256Hex, signFriendChallengePayload } from "../lib/game/run-og-signing";
import { runSimulationSync } from "../lib/game/simulate";
import {
  RUN_INDEX_KEY,
  RUN_RECORD_PREFIX,
  RUN_RECORD_SCHEMA_VERSION,
  type RunRecordV1,
} from "../lib/game/run-record";
import type { BoardPageWire } from "../lib/leaderboard/board-view";
import type { LeaderboardLineupView } from "../lib/leaderboard/lineup-view";
import { encodeRunToken } from "../lib/game/run-token";
import { ADVANCED_BOARD_CONFIG_OPTIONS } from "../lib/leaderboard/config";
import { DEFAULT_LEADERBOARD_SEASON_ID } from "../lib/leaderboard/season";
import { configBadgesFromRecordToken } from "../lib/game/config-badges";
import {
  INLINE_TEXT_LINK_ALLOWLIST,
  MIN_INTERACTION_TARGET_PX,
  adjudicateNarrowCollision,
  narrowCollisionMetricIdentityFailures,
  narrowCollisionMetricFailures,
  isExpectedBrowserDiagnostic,
  isRetryableCollisionNavigationError,
  responsiveMetricFailures,
  type NarrowCollisionFinding,
  type NarrowCollisionRawFinding,
} from "./responsive-layout-contract";
import { scanNarrowCollisions } from "./narrow-collision-scan";

type ViewportCase = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
};

type SurfaceCase = {
  readonly label: string;
  readonly path: string;
  /** Feature-specific proof surfaces run only when explicitly filtered in. */
  readonly optIn?: boolean;
  readonly prepare?: (page: Page) => Promise<void>;
  readonly route?: (page: Page) => Promise<void>;
  readonly waitForNetworkIdle?: boolean;
  readonly shellRule?: boolean;
  readonly viewportScreenshot?: boolean;
  readonly allowResponseErrorPathnames?: readonly string[];
  readonly primaryAction?: {
    readonly role: "button" | "link" | "radio";
    readonly name: string | RegExp;
  };
};

type SurfaceMetric = {
  readonly engine: "chromium" | "webkit";
  readonly surface: string;
  readonly path: string;
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
  readonly modeDockInitialClearance: number | null;
  readonly modeDockTerminalClearance: number | null;
  readonly navWraps: readonly string[];
  readonly maxContainerWidth: number;
  readonly smallTargets: readonly string[];
  readonly axeViolations: readonly string[];
  readonly desktopSignals: Record<string, boolean | number | string | null>;
  readonly consoleErrors: readonly string[];
  readonly collisionFindings: readonly NarrowCollisionFinding[];
};

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3027";
const PHASE = process.env.WCDRAFT_RESPONSIVE_PHASE ?? "capture";
const STRICT = process.env.WCDRAFT_RESPONSIVE_STRICT === "1";
const ENGINE = process.env.WCDRAFT_RESPONSIVE_ENGINE === "webkit" ? "webkit" : "chromium";
const COLLISION_MODE =
  process.env.WCDRAFT_RESPONSIVE_COLLISIONS === "report"
    ? "report"
    : process.env.WCDRAFT_RESPONSIVE_COLLISIONS === "strict"
      ? "strict"
      : "off";
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
const THEME_FILTER = new Set(
  (process.env.WCDRAFT_RESPONSIVE_THEMES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const OUT_DIR =
  process.env.WCDRAFT_RESPONSIVE_OUT_DIR ??
  path.join(REPO_ROOT, "docs/reports/desktop-responsive-2026-07-06", PHASE);
const AXE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";
const gameData = buildGameDataFromBundles();

const viewports: readonly ViewportCase[] = [
  { name: "320x568", width: 320, height: 568 },
  { name: "667x375", width: 667, height: 375 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1512x982", width: 1512, height: 982 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "390x844", width: 390, height: 844 },
  { name: "360x800", width: 360, height: 800 },
  { name: "430x932", width: 430, height: 932 },
];
const availableThemes: readonly Theme[] = ["light", "dark"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type DailyAvailabilityFixtureState = "checking" | "available" | "unavailable" | "timeout";

async function installDailyAvailabilityFixture(
  page: Page,
  state: DailyAvailabilityFixtureState,
): Promise<void> {
  const saltMap = gameData.dailySeedSaltMap;
  assert(saltMap, "responsive Daily state fixture requires the committed salt map");
  const saltMapBody = JSON.stringify(saltMap);
  const saltMapBytes = Buffer.byteLength(saltMapBody);
  const saltMapSha256 = createHash("sha256").update(saltMapBody).digest("hex");
  const unavailableBundles: Record<string, unknown> = { ...gameData.manifest.bundles };
  delete unavailableBundles.daily_seed_salt_map;
  const manifest =
    state === "unavailable"
      ? { ...gameData.manifest, bundles: unavailableBundles }
      : {
          ...gameData.manifest,
          bundles: {
            ...gameData.manifest.bundles,
            daily_seed_salt_map: {
              ...gameData.manifest.bundles.daily_seed_salt_map!,
              bytes: saltMapBytes,
              sha256: saltMapSha256,
              raw_sha256: saltMapSha256,
              options: {
                ...gameData.manifest.bundles.daily_seed_salt_map!.options!,
                size_hint: saltMapBytes,
              },
            },
          },
        };
  const frozenNow = Date.parse(`${saltMap.window.start_date}T12:00:00.000Z`);
  assert(Number.isFinite(frozenNow), "responsive Daily state fixture has an invalid start date");
  await page.addInitScript({ content: `Date.now = () => ${frozenNow.toString()};` });
  if (state === "checking" || state === "timeout") {
    await page.addInitScript({
      content: `{
        const originalFetch = globalThis.fetch.bind(globalThis);
        const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
        ${
          state === "timeout"
            ? `globalThis.setTimeout = function(callback, delay, ...args) {
          return originalSetTimeout(callback, delay === 12000 ? 1 : delay, ...args);
        };`
            : ""
        }
        globalThis.fetch = function(input, init) {
          const requestUrl = typeof input === "string" || input instanceof URL
            ? input.toString()
            : input.url;
          const pathname = new URL(requestUrl, globalThis.location.href).pathname;
          if (pathname.endsWith("/manifest.json")) {
            return new Promise(function() {});
          }
          return originalFetch(input, init);
        };
      }`,
    });
    return;
  }
  await page.route("**/manifest.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(manifest),
    });
  });
  await page.route("**/daily-seed-salt-map.compact.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: saltMapBody,
    });
  });
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
const completedTeamSheet = completedRecord("resp-team-sheet", "Mutable XI");
const teamSheetRecord: RunRecordV1 = {
  ...completedTeamSheet,
  status: "ready",
  simulation: undefined,
};
const completeAToken = encodeRunToken(completeA);
const friendChallengeSecret = "fixture";
const friendChallengeProof = await signFriendChallengePayload(
  { v: 1, token_hash: await sha256Hex(completeAToken) },
  friendChallengeSecret,
);
const verifiedChallenge = {
  status: "VERIFIED" as const,
  parentSeed: completeA.parent_seed,
  formationId: completeA.draft.formation_id,
  mode: completeA.draft.mode,
  draftFlow: completeA.draft.draft_flow ?? "squad_first",
  ratingBasis: completeA.draft.rating_basis ?? "career",
  eraPreset: completeA.draft.era_preset ?? "all_time",
  dailyDate: null,
  challengerDisplay: "a friend",
  challengerScore: completeA.simulation!.run.score,
};
// This fixed seed has one activation in G2 and two in G3. G3 opens by
// default, leaving the first recap-linked G2 event collapsed for the S6
// hash-navigation interaction proof.
const completeFactualRecap = completedRecord("resp-recap-1", "Factual XI");
const seededRecords = [
  activeDraftRecord,
  activePositionRecord,
  activeOpenRecord,
  activeBlindOpenRecord,
  teamSheetRecord,
  completeA,
  completeB,
  ...(SURFACE_FILTER.has("results-factual-recap") ? [completeFactualRecap] : []),
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
    season_key: DEFAULT_LEADERBOARD_SEASON_ID,
    current_season_key: DEFAULT_LEADERBOARD_SEASON_ID,
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
    // The responsive fixtures mock leaderboard/challenge APIs at the browser
    // context boundary. A newly activated production service worker can bypass
    // that route interception and leak the unconfigured local API's 503 into a
    // later cell, making matrix results depend on registration timing.
    serviceWorkers: "block",
  });
  await context.route("**/*", async (route, request) => {
    const requestUrl = new URL(request.url());
    if (request.resourceType() !== "document" || requestUrl.origin !== new URL(BASE_URL).origin) {
      await route.continue();
      return;
    }
    const response = await route.fetch({ maxRedirects: 0 });
    if (response.status() >= 300 && response.status() < 400) {
      await route.continue();
      return;
    }
    const headers = response.headers();
    for (const name of ["content-security-policy", "content-security-policy-report-only"]) {
      const value = headers[name];
      if (value === undefined) continue;
      headers[name] = value
        .split(";")
        .filter((directive) => directive.trim() !== "upgrade-insecure-requests")
        .join(";");
    }
    await route.fulfill({ response, headers });
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
    if (
      msg.type() === "error" &&
      !text.startsWith("Failed to load resource:") &&
      !isExpectedBrowserDiagnostic(ENGINE, text)
    ) {
      errors.push(text);
    }
  });
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "unknown browser failure";
    const url = new URL(request.url());
    const expectedNextPrefetchCancellation =
      errorText === "net::ERR_ABORTED" &&
      request.resourceType() === "fetch" &&
      url.origin === new URL(BASE_URL).origin &&
      url.searchParams.has("_rsc");
    if (expectedNextPrefetchCancellation) return;
    errors.push(`request failed ${request.method()} ${url.pathname}: ${errorText}`);
  });
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

async function settle(page: Page, waitForNetworkIdle = true): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  if (waitForNetworkIdle) {
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  }
  await page.waitForTimeout(250);
}

async function mockOgSignFailure(page: Page): Promise<void> {
  await page.route("**/api/og/sign", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "responsive harness preview failure" }),
    });
  });
}

async function mockFriendChallenge(page: Page): Promise<void> {
  const body = JSON.stringify({ ok: true, challenge: verifiedChallenge });
  await page.addInitScript(
    ({ expectedOrigin, responseBody }) => {
      const originalFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = function (input, init) {
        const requestUrl =
          typeof input === "string" || input instanceof URL ? input.toString() : input.url;
        const url = new URL(requestUrl, globalThis.location.href);
        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        if (
          url.origin === expectedOrigin &&
          url.pathname === "/api/challenge/verify" &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(responseBody, {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return originalFetch(input, init);
      };
    },
    { expectedOrigin: new URL(BASE_URL).origin, responseBody: body },
  );
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
      label: "mobile-menu-open",
      path: "/",
      primaryAction: { role: "link", name: "Play" },
      prepare: async (page) => {
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "Open menu" }).click();
        await page.locator("#mobile-menu:not([hidden])").waitFor();
      },
    },
    {
      label: "mode-select-checking",
      path: "/play",
      primaryAction: { role: "radio", name: /Today/u },
      waitForNetworkIdle: false,
      route: async (page) => {
        await installDailyAvailabilityFixture(page, "checking");
      },
      prepare: async (page) => {
        await page.getByRole("button", { name: "Play Classic while we check →" }).waitFor();
      },
    },
    {
      label: "mode-select-available",
      path: "/play",
      primaryAction: { role: "radio", name: /Today/u },
      route: async (page) => {
        await installDailyAvailabilityFixture(page, "available");
      },
      prepare: async (page) => {
        await page.getByRole("button", { name: "Play daily →" }).waitFor();
      },
    },
    {
      label: "mode-select-unavailable",
      path: "/play",
      primaryAction: { role: "radio", name: /Today/u },
      route: async (page) => {
        await installDailyAvailabilityFixture(page, "unavailable");
      },
      prepare: async (page) => {
        await page.getByRole("status").waitFor();
      },
    },
    {
      label: "mode-select-timeout",
      path: "/play",
      primaryAction: { role: "radio", name: /Today/u },
      route: async (page) => {
        await installDailyAvailabilityFixture(page, "timeout");
      },
      prepare: async (page) => {
        await page.getByRole("button", { name: "Retry Daily check" }).waitFor();
        await page.getByRole("button", { name: "Play Classic instead" }).waitFor();
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
      label: "classic-pick-off-natural",
      path: `/play/draft?run=${activeDraftRecord.run_id}`,
      shellRule: true,
      viewportScreenshot: true,
      primaryAction: { role: "button", name: /Lock pick|Choose slot/u },
      prepare: async (page) => {
        await revealChoices(page);
        await page.getByRole("button", { name: /C\. Gamarra/u }).click();
        await page.getByRole("button", { name: "Choose slot" }).click();
        const dialog = page.getByRole("dialog", { name: "Assign to slot" });
        await dialog.getByText("CM", { exact: true }).first().click();
        const changedChip = page.locator("[data-fit-teaching-chip]", { hasText: "DF → CM" });
        await changedChip.waitFor();
        await changedChip.evaluate((element) => element.scrollIntoView({ block: "center" }));
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
      },
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
      label: "team-sheet",
      path: `/play/review?run=${teamSheetRecord.run_id}`,
      shellRule: true,
      primaryAction: { role: "button", name: /Confirm team sheet & simulate/u },
      prepare: async (page) => {
        await page.getByRole("button", { name: /Confirm team sheet & simulate/u }).waitFor();
      },
    },
    {
      label: "simulation-ceremony",
      path: `/play/review?run=${teamSheetRecord.run_id}`,
      shellRule: true,
      primaryAction: { role: "button", name: /Skip/u },
      route: async (page) => {
        await page.emulateMedia({ reducedMotion: "no-preference" });
      },
      prepare: async (page) => {
        await page.getByRole("button", { name: /Confirm team sheet & simulate/u }).click();
        await page.locator("[data-simulation-ceremony='true']").waitFor();
      },
    },
    {
      label: "simulation-ceremony-reduced",
      path: `/play/review?run=${teamSheetRecord.run_id}`,
      shellRule: true,
      primaryAction: { role: "button", name: /Skip/u },
      route: async (page) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
      },
      prepare: async (page) => {
        await page.getByRole("button", { name: /Confirm team sheet & simulate/u }).click();
        await page.locator("[data-simulation-ceremony='true']").waitFor();
      },
    },
    {
      label: "squad-review",
      path: `/play/review?run=${completeA.run_id}`,
      shellRule: true,
      // The persisted fixture is complete, so Review must expose the
      // read-only lifecycle state instead of an affordance that can pair a
      // new arrangement with the old simulation.
      primaryAction: { role: "button", name: /Simulation complete/u },
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
        await page.getByRole("group", { name: "Leaderboard lane" }).waitFor();
      },
    },
    {
      label: "results-factual-recap",
      path: `/play/results?run=${completeFactualRecap.run_id}`,
      optIn: true,
      primaryAction: { role: "link", name: "Event log" },
      prepare: async (page) => {
        await page.getByRole("heading", { name: "Why it went this way" }).waitFor();
        const link = page.getByRole("link", { name: "Event log" }).first();
        const href = await link.getAttribute("href");
        assert(href?.startsWith("#event-"), "S6 event-log link must carry a real event hash");
        const target = page.locator(`[id="${href.slice(1)}"]`);
        await target.waitFor({ state: "attached" });
        const matchItem = target.locator("xpath=ancestor::li[1]");
        const toggle = matchItem.getByRole("button").first();
        assert(
          (await toggle.getAttribute("aria-expanded")) === "false",
          "S6 proof requires the linked match to begin collapsed",
        );
        assert(
          await target.evaluate((node) => node.closest("[hidden]") !== null),
          "S6 proof requires the linked event to begin under a hidden match panel",
        );

        await link.focus();
        assert(
          await link.evaluate((node) => document.activeElement === node),
          "S6 proof could not focus the event-log link before keyboard activation",
        );
        await link.press("Enter");
        await page.waitForFunction((expectedHash) => window.location.hash === expectedHash, href);
        await page.waitForFunction(
          (eventId) =>
            document
              .getElementById(eventId)
              ?.closest("li")
              ?.querySelector("button")
              ?.getAttribute("aria-expanded") === "true",
          href.slice(1),
        );
        assert(
          (await toggle.getAttribute("aria-expanded")) === "true",
          "event-log link did not expand its owning match",
        );
        assert(
          !(await target.evaluate((node) => node.closest("[hidden]") !== null)),
          "event-log target remained under a hidden panel after link activation",
        );
        assert(await target.isVisible(), "event-log target is not visible after link activation");
        assert(
          await target.evaluate((node) => document.activeElement === node),
          "event-log target did not receive programmatic focus",
        );
        const box = await target.boundingBox();
        const viewport = page.viewportSize();
        assert(
          box !== null && viewport !== null,
          "event-log target has no measurable viewport box",
        );
        assert(
          box.y >= -1 && box.y + box.height <= viewport.height + 1,
          "event-log target did not land inside the viewport",
        );
      },
    },
    {
      label: "share-author",
      path: `/play/share?run=${completeA.run_id}`,
      route: mockOgSignFailure,
      primaryAction: { role: "button", name: /Copy|Retry/u },
      prepare: async (page) => {
        await page.getByText("Share").first().waitFor();
        await page.getByRole("button", { name: "Retry preview" }).waitFor();
      },
    },
    {
      label: "share-recipient",
      path: `/play/share?run=${encodeURIComponent(completeAToken)}`,
      route: mockOgSignFailure,
      primaryAction: { role: "button", name: /Copy|Retry/u },
      prepare: async (page) => {
        await page.getByText("Share").first().waitFor();
      },
    },
    {
      label: "challenge-setup",
      path: `/play/draft?challenge=${encodeURIComponent(completeAToken)}&proof=${encodeURIComponent(friendChallengeProof)}`,
      route: mockFriendChallenge,
      primaryAction: { role: "button", name: "Play this board" },
      prepare: async (page) => {
        await page
          .getByRole("heading", { name: "You're playing a friend's board" })
          .waitFor({ timeout: 30_000 })
          .catch(async (error) => {
            const body = (
              await page
                .locator("body")
                .innerText()
                .catch(() => "<body unavailable>")
            )
              .replace(/\s+/gu, " ")
              .slice(0, 500);
            const resources = await page
              .evaluate(() =>
                performance
                  .getEntriesByType("resource")
                  .map((entry) => ({ name: entry.name, duration: Math.round(entry.duration) }))
                  .filter(({ name }) => name.includes("/data/wcdraft/"))
                  .slice(-8),
              )
              .catch(() => []);
            const serviceWorkerState = await page
              .evaluate(() => ({
                present: "serviceWorker" in navigator,
                controller:
                  "serviceWorker" in navigator && navigator.serviceWorker.controller !== null,
              }))
              .catch(() => ({ present: false, controller: false }));
            throw new Error(
              `friend-board fixture did not render at ${page.url()}: ${body}; serviceWorker=${JSON.stringify(serviceWorkerState)}; runtime resources=${JSON.stringify(resources)}; ${error instanceof Error ? error.message : String(error)}`,
            );
          });
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
        await page.getByText("Advanced", { exact: true }).click();
        await page.waitForFunction((expected) => {
          const grid = document.querySelector('[aria-label="Advanced season board lanes"]');
          if (grid === null) return false;
          const buttons = grid.querySelectorAll("button");
          return buttons.length === expected && [...buttons].every((button) => !button.disabled);
        }, ADVANCED_BOARD_CONFIG_OPTIONS.length);
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
      path: "/sign-in?next=%2Faccount",
      primaryAction: { role: "link", name: /Sign in|Start/u },
      prepare: async (page) => {
        await page.getByRole("heading").first().waitFor();
        const url = new URL(page.url());
        assert(
          url.pathname === "/sign-in" && url.searchParams.get("next") === "/account",
          `account collision fixture must prove the unauthenticated redirect, got ${page.url()}`,
        );
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
      label: "contact",
      path: "/contact",
      prepare: async (page) => {
        await page.getByRole("heading", { name: "Contact" }).waitFor();
      },
    },
    {
      label: "attribution",
      path: "/attribution",
      prepare: async (page) => {
        await page.getByRole("heading", { name: "Data attribution" }).waitFor();
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
    | "engine"
    | "surface"
    | "path"
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
    | "collisionFindings"
  >
> {
  const inlineTextLinkAllowlist = JSON.stringify(INLINE_TEXT_LINK_ALLOWLIST);
  return await page.evaluate(`(() => {
    const inlineTextLinkAllowlist = ${inlineTextLinkAllowlist};
    const minTargetSize = ${MIN_INTERACTION_TARGET_PX.toString()};
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
    if (!doc || !body) throw new Error("responsive measurement raced document navigation");
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
      .filter((el) => {
        const style = getComputedStyle(el);
        return !(
          style.display === "inline" &&
          inlineTextLinkAllowlist.some((selector) => el.matches(selector))
        );
      })
      .map((el) => {
        const box = el.getBoundingClientRect();
        const text = (el.getAttribute("aria-label") || el.textContent || el.tagName)
          .replace(/\\s+/gu, " ")
          .trim()
          .slice(0, 80);
        return box.width < minTargetSize || box.height < minTargetSize
          ? (text || el.tagName) + " " + Math.round(box.width) + "x" + Math.round(box.height)
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

async function measureModeDockClearance(
  page: Page,
  surface: SurfaceCase,
): Promise<{
  modeDockInitialClearance: number | null;
  modeDockTerminalClearance: number | null;
}> {
  if (!surface.label.startsWith("mode-select")) {
    return { modeDockInitialClearance: null, modeDockTerminalClearance: null };
  }
  const measureCurrentClearance = async () =>
    await page.evaluate(() => {
      const dockBox = document.querySelector('[class*="modeDock"]')?.getBoundingClientRect();
      const cardBottoms = [...document.querySelectorAll('button[role="radio"]')].map(
        (card) => card.getBoundingClientRect().bottom,
      );
      if (!dockBox || cardBottoms.length === 0) return null;
      return Math.round(dockBox.top - Math.max(...cardBottoms));
    });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  const modeDockInitialClearance = await measureCurrentClearance();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(100);
  const modeDockTerminalClearance = await measureCurrentClearance();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  return { modeDockInitialClearance, modeDockTerminalClearance };
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
    try {
      await surface.prepare?.(page);
    } catch (error) {
      throw new Error(
        `${surface.label} preparation failed; browser errors=${JSON.stringify(errors)}; ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    await settle(page, surface.waitForNetworkIdle !== false);
    const modeDockClearances = await measureModeDockClearance(page, surface);
    let rawCollisionFindings: readonly NarrowCollisionRawFinding[] = [];
    let stableCollisionMeasurement:
      | {
          readonly primaryAction: Awaited<ReturnType<typeof measurePrimaryAction>>;
          readonly baseMetric: Awaited<ReturnType<typeof measure>>;
        }
      | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        rawCollisionFindings = COLLISION_MODE === "off" ? [] : await scanNarrowCollisions(page);
        if (COLLISION_MODE !== "off") {
          stableCollisionMeasurement = {
            primaryAction: await measurePrimaryAction(page, surface.primaryAction),
            baseMetric: await measure(page),
          };
        }
        break;
      } catch (error) {
        if (
          attempt > 0 ||
          COLLISION_MODE === "off" ||
          !isRetryableCollisionNavigationError(error)
        ) {
          throw error;
        }
        await page.waitForLoadState("domcontentloaded");
        await surface.prepare?.(page);
        await settle(page, surface.waitForNetworkIdle !== false);
      }
    }
    const collisionFindings = rawCollisionFindings.map((finding) =>
      adjudicateNarrowCollision({
        surface: surface.label,
        viewport: viewport.name,
        theme,
        engine: ENGINE,
        finding,
      }),
    );
    const axeViolations = COLLISION_MODE === "off" ? await runAxe(page, axeSource) : [];
    const primaryAction =
      stableCollisionMeasurement?.primaryAction ??
      (await measurePrimaryAction(page, surface.primaryAction));
    const screenshotName = `${PHASE}-${surface.label}-${viewport.name}-${theme}.png`;
    const screenshotPath = path.join(OUT_DIR, "screenshots", screenshotName);
    if (COLLISION_MODE === "off") {
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({
        path: screenshotPath,
        fullPage: surface.viewportScreenshot !== true,
      });
    }
    const baseMetric = stableCollisionMeasurement?.baseMetric ?? (await measure(page));
    const shellRule = shellRuleApplies(surface, viewport);
    const noScrollGate = shellRule
      ? baseMetric.scrollHeight <= baseMetric.clientHeight + 1 && primaryAction.inViewport === true
        ? "pass"
        : "fail"
      : "n-a";
    return {
      engine: ENGINE,
      surface: surface.label,
      path: surface.path,
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
      collisionFindings,
      ...baseMetric,
      ...modeDockClearances,
    };
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const axeSource =
    COLLISION_MODE === "off"
      ? await fetch(AXE_CDN).then((res) => {
          if (!res.ok) throw new Error(`failed to fetch axe-core: HTTP ${res.status.toString()}`);
          return res.text();
        })
      : "not-loaded-collision-only";
  const browserType = ENGINE === "webkit" ? webkit : chromium;
  const browser = await browserType.launch(
    ENGINE === "chromium"
      ? {
          channel:
            process.env.WCDRAFT_PLAYWRIGHT_CHANNEL === "chromium" ||
            !process.env.WCDRAFT_PLAYWRIGHT_CHANNEL
              ? undefined
              : process.env.WCDRAFT_PLAYWRIGHT_CHANNEL,
          headless: true,
        }
      : { headless: true },
  );
  const metrics: SurfaceMetric[] = [];
  const availableSurfaces = surfaceCases();
  const availableSurfaceLabels = new Set(availableSurfaces.map(({ label }) => label));
  const unknownSurfaceFilters = [...SURFACE_FILTER].filter(
    (label) => !availableSurfaceLabels.has(label),
  );
  assert(
    unknownSurfaceFilters.length === 0,
    `unknown responsive surface filters: ${unknownSurfaceFilters.join(", ")}`,
  );
  const availableViewportNames = new Set(viewports.map(({ name }) => name));
  const unknownViewportFilters = [...VIEWPORT_FILTER].filter(
    (name) => !availableViewportNames.has(name),
  );
  assert(
    unknownViewportFilters.length === 0,
    `unknown responsive viewport filters: ${unknownViewportFilters.join(", ")}`,
  );
  const selectedSurfaces = availableSurfaces.filter(
    (surface) =>
      SURFACE_FILTER.has(surface.label) || (SURFACE_FILTER.size === 0 && surface.optIn !== true),
  );
  const selectedViewports = viewports.filter(
    (viewport) => VIEWPORT_FILTER.size === 0 || VIEWPORT_FILTER.has(viewport.name),
  );
  const unknownThemeFilters = [...THEME_FILTER].filter(
    (theme) => !(availableThemes as readonly string[]).includes(theme),
  );
  assert(
    unknownThemeFilters.length === 0,
    `unknown responsive theme filters: ${unknownThemeFilters.join(", ")}`,
  );
  const selectedThemes = availableThemes.filter(
    (theme) => THEME_FILTER.size === 0 || THEME_FILTER.has(theme),
  );
  const recordMetric = (metric: SurfaceMetric) => {
    metrics.push(metric);
    const failures =
      COLLISION_MODE === "strict"
        ? narrowCollisionMetricFailures(metric)
        : responsiveMetricFailures(metric);
    const status = failures.length === 0 ? "ok" : `issues=${failures.length.toString()}`;
    console.log(
      `[responsive:${PHASE}] ${status} engine=${ENGINE} ${metric.surface} ${metric.viewport} ${metric.theme} collisions=${metric.collisionFindings.length.toString()} screenshot=${metric.screenshot}`,
    );
  };
  try {
    for (const surface of selectedSurfaces) {
      if (COLLISION_MODE === "off") {
        for (const viewport of selectedViewports) {
          for (const theme of selectedThemes) {
            recordMetric(await captureSurface(browser, axeSource, surface, viewport, theme));
          }
        }
        continue;
      }
      const surfaceMetrics = await Promise.all(
        selectedViewports.flatMap((viewport) =>
          selectedThemes.map(
            async (theme) => await captureSurface(browser, axeSource, surface, viewport, theme),
          ),
        ),
      );
      surfaceMetrics.forEach(recordMetric);
    }
  } finally {
    await browser.close();
  }
  const expectedMetricIdentities = selectedSurfaces.flatMap((surface) =>
    selectedViewports.flatMap((viewport) =>
      selectedThemes.map((theme) => `${surface.label}|${viewport.name}|${theme}|${ENGINE}`),
    ),
  );
  const actualMetricIdentities = metrics.map(
    (metric) => `${metric.surface}|${metric.viewport}|${metric.theme}|${metric.engine}`,
  );
  const identityFailures = narrowCollisionMetricIdentityFailures(
    expectedMetricIdentities,
    actualMetricIdentities,
  );
  assert(
    identityFailures.length === 0,
    `responsive metric identity mismatch: ${identityFailures.join("; ")}`,
  );
  const payload = {
    phase: PHASE,
    engine: ENGINE,
    collisionMode: COLLISION_MODE,
    baseUrl: BASE_URL,
    axeSource: AXE_CDN,
    surfaces: selectedSurfaces.map((surface) => surface.label),
    viewports: selectedViewports.map((viewport) => viewport.name),
    themes: selectedThemes,
    generatedAt: new Date().toISOString(),
    metrics,
  };
  await writeFile(path.join(OUT_DIR, `responsive-${PHASE}.json`), JSON.stringify(payload, null, 2));
  const failures = metrics.flatMap((metric) =>
    COLLISION_MODE === "strict"
      ? narrowCollisionMetricFailures(metric)
      : responsiveMetricFailures(metric),
  );
  if (STRICT && failures.length > 0) {
    throw new Error(`responsive layout verification failed:\n${failures.join("\n")}`);
  }
  console.log(
    `[responsive:${PHASE}] complete metrics=${metrics.length.toString()} failures=${failures.length.toString()} out=${OUT_DIR}`,
  );
}

await main();
