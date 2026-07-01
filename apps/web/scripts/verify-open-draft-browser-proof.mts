import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { autoDraft, encodeRunTokenBody, type RunTokenV4Body } from "@wcdraft/core";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";

import { buildGameDataFromBundles } from "../lib/game/__tests__/run-token.test-harness";
import {
  RUN_INDEX_KEY,
  RUN_RECORD_PREFIX,
  RUN_RECORD_SCHEMA_VERSION,
  type RunRecordV1,
} from "../lib/game/run-record";
import { decodeRunToken, encodeRunToken, reconstructDraftFromToken } from "../lib/game/run-token";
import { runSimulationSync } from "../lib/game/simulate";

type Theme = "light" | "dark";
type ViewportCase = { name: string; width: number; height: number };
type SurfaceMetrics = {
  label: string;
  viewport: string;
  theme: Theme;
  scrollHeight: number;
  clientHeight: number;
  maxScrollWidth: number;
  clientWidth: number;
  horizontalOverflow: boolean;
  minTargetWidth: number | null;
  minTargetHeight: number | null;
  smallTargets: string[];
  axeViolations: string[];
};

const baseUrl = process.env.BASE_URL ?? "http://localhost:3021";
const axeCdn = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";
const axeSource = await fetch(axeCdn).then((res) => {
  if (!res.ok) throw new Error(`failed to fetch axe-core: HTTP ${res.status}`);
  return res.text();
});
const gameData = buildGameDataFromBundles();

const viewports: ViewportCase[] = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x800", width: 360, height: 800 },
];
const themes: Theme[] = ["light", "dark"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function completedOpenRecord(): RunRecordV1 {
  const run_id = "pw-open-complete";
  const parent_seed = "wcdraft:playwright:open-complete";
  const draft = autoDraft({
    run_id,
    parent_seed,
    formation_id: "4-3-3",
    mode: "open",
    team_name: "Open Proof XI",
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
    created_seq: 100,
    updated_seq: 100,
    versions: gameData.versions,
    draft,
    status: "ready",
  };
  const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, base);
  return { ...base, status: "complete", simulation };
}

function tamperedTokenFrom(token: string): string {
  const decoded = decodeRunToken(token);
  assert(decoded?.v === 4, "expected a t4 Open Draft token");
  const body: RunTokenV4Body = structuredClone(decoded);
  const players = body.pl
    .map((pick, i) => (pick.k === "p" ? { pick, i } : null))
    .filter(
      (item): item is { pick: Extract<RunTokenV4Body["pl"][number], { k: "p" }>; i: number } =>
        item !== null,
    );
  assert(players.length >= 2, "expected at least two player picks to tamper");
  body.pl[players[1].i] = { ...players[1].pick, c: players[0].pick.c };
  return encodeRunTokenBody(body);
}

async function newPage(
  browser: Browser,
  viewport: ViewportCase,
  theme: Theme,
  initRecord?: RunRecordV1,
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    reducedMotion: "reduce",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(
    ({ selectedTheme, record, recordPrefix, indexKey, schemaVersion }) => {
      window.localStorage.setItem("wcdraft:theme", selectedTheme);
      if (!record) return;
      window.localStorage.setItem(`${recordPrefix}${record.run_id}`, JSON.stringify(record));
      window.localStorage.setItem(
        indexKey,
        JSON.stringify({
          record_version: schemaVersion,
          entries: [
            {
              run_id: record.run_id,
              created_seq: record.created_seq,
              updated_seq: record.updated_seq,
              versions: record.versions,
            },
          ],
        }),
      );
    },
    {
      selectedTheme: theme,
      record: initRecord ?? null,
      recordPrefix: RUN_RECORD_PREFIX,
      indexKey: RUN_INDEX_KEY,
      schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    },
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource:")) {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const pathname = new URL(response.url()).pathname;
    if (["/api/auth/csrf", "/api/runs", "/api/og/sign"].includes(pathname)) return;
    errors.push(`${response.status()} ${pathname}`);
  });
  return { context, page, errors };
}

async function measure(page: Page, label: string, viewport: ViewportCase, theme: Theme) {
  await page.waitForFunction(() => document.title.trim().length > 0);
  await page.addScriptTag({ content: axeSource });
  const axeViolations = await page.evaluate(async () => {
    const runner = (
      window as typeof window & {
        axe?: {
          run: (
            node?: Element | Document,
            options?: unknown,
          ) => Promise<{ violations: { id: string }[] }>;
        };
      }
    ).axe;
    if (!runner) throw new Error("axe not loaded");
    const result = await runner.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    return result.violations.map((v) => v.id);
  });
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [role="button"], [role="radio"]',
      ),
    ).filter((el) => {
      const box = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      );
    });
    const boxes = controls.map((el) => {
      const box = el.getBoundingClientRect();
      const name =
        el.getAttribute("aria-label") ??
        el.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ??
        el.tagName;
      return { name, width: Math.round(box.width), height: Math.round(box.height) };
    });
    const smallTargets = boxes
      .filter((box) => box.width < 44 || box.height < 44)
      .map((box) => `${box.name} (${box.width}x${box.height})`)
      .slice(0, 8);
    return {
      scrollHeight: Math.max(doc.scrollHeight, body.scrollHeight),
      clientHeight: doc.clientHeight,
      maxScrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      clientWidth: doc.clientWidth,
      minTargetWidth: boxes.length ? Math.min(...boxes.map((box) => box.width)) : null,
      minTargetHeight: boxes.length ? Math.min(...boxes.map((box) => box.height)) : null,
      smallTargets,
    };
  });
  const surface: SurfaceMetrics = {
    label,
    viewport: viewport.name,
    theme,
    ...metrics,
    horizontalOverflow: metrics.maxScrollWidth > metrics.clientWidth + 1,
    axeViolations,
  };
  assert(
    surface.axeViolations.length === 0,
    `${label} ${viewport.name} ${theme} axe violations: ${surface.axeViolations.join(", ")}`,
  );
  assert(!surface.horizontalOverflow, `${label} ${viewport.name} ${theme} horizontal overflow`);
  assert(
    surface.smallTargets.length === 0,
    `${label} ${viewport.name} ${theme} small targets: ${surface.smallTargets.join(", ")}`,
  );
  return surface;
}

async function verifyInteractiveOpenDraft(browser: Browser, viewport: ViewportCase, theme: Theme) {
  const session = await newPage(browser, viewport, theme);
  const { page, context, errors } = session;
  const metrics: SurfaceMetrics[] = [];
  await page.goto(`${baseUrl}/play`, { waitUntil: "domcontentloaded" });
  await page.getByRole("radio", { name: /Open Draft/i }).click();
  await page.getByRole("button", { name: /Continue with Open Draft/i }).click();
  await page.getByRole("heading", { name: "Lock a formation" }).waitFor();
  await page.getByText("Open Draft").first().waitFor();
  metrics.push(await measure(page, "open setup", viewport, theme));

  await page.getByRole("button", { name: /4-3-3[\s\S]*(Selected|Lock this shape)/ }).click();
  await page.getByRole("button", { name: /Lock 4-3-3/ }).click();
  await page.waitForURL(/\/play\/draft\?run=[^&]+$/, { timeout: 30_000 });
  await page.getByText("Open").first().waitFor();
  metrics.push(await measure(page, "open spin", viewport, theme));

  await page.getByRole("button", { name: "Spin" }).click();
  await page.getByRole("button", { name: /Reveal choices/ }).click();
  await page.locator('section[aria-label="Candidates"]').waitFor();
  await page.getByRole("group", { name: "Filter Open Draft roster" }).waitFor();
  const record = await page.evaluate((recordPrefix) => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith(recordPrefix));
    return key ? JSON.parse(window.localStorage.getItem(key) ?? "null") : null;
  }, RUN_RECORD_PREFIX);
  const rolledCount = record?.draft?.spins?.[0]?.rolled_card_ids?.length ?? 0;
  assert(rolledCount > 3, `Open Draft did not expose a full roster; got ${rolledCount}`);
  metrics.push(await measure(page, "open roster", viewport, theme));

  await page
    .locator('section[aria-label="Candidates"]')
    .getByRole("button")
    .filter({ hasText: /OVR/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Lock pick/ }).click();
  await page.waitForFunction((recordPrefix) => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith(recordPrefix));
    const rec = key ? JSON.parse(window.localStorage.getItem(key) ?? "null") : null;
    return rec?.draft?.spins?.[0]?.status === "picked";
  }, RUN_RECORD_PREFIX);
  assert(errors.length === 0, `browser errors: ${errors.join("\n")}`);
  await context.close();
  return { rolledCount, metrics };
}

async function verifyCompletedOpenRun(browser: Browser, viewport: ViewportCase, theme: Theme) {
  const record = completedOpenRecord();
  const token = encodeRunToken(record);
  assert(token.startsWith("t4."), "Open Draft share did not emit a t4 token");
  const decoded = decodeRunToken(token);
  assert(decoded?.v === 4, "Open Draft token did not decode as v4");
  const replayed = reconstructDraftFromToken(decoded, gameData);
  assert(
    JSON.stringify(replayed) === JSON.stringify(record.draft),
    "t4 replay was not byte-identical",
  );
  const tampered = tamperedTokenFrom(token);
  let tamperedRejected = false;
  try {
    const bad = decodeRunToken(tampered);
    assert(bad?.v === 4, "tampered token did not decode as v4");
    reconstructDraftFromToken(bad, gameData);
  } catch {
    tamperedRejected = true;
  }
  assert(tamperedRejected, "tampered t4 token was not rejected");

  const session = await newPage(browser, viewport, theme, record);
  const { page, context, errors } = session;
  const metrics: SurfaceMetrics[] = [];
  await page.goto(`${baseUrl}/play/results?run=${record.run_id}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByText("Results").first().waitFor();
  await page.getByText("Open").first().waitFor();
  metrics.push(await measure(page, "open results", viewport, theme));
  await page.getByRole("link", { name: "Share" }).click();
  await page.getByRole("heading", { name: /the card/i }).waitFor();
  await page.getByText("Open").first().waitFor();
  metrics.push(await measure(page, "open share local", viewport, theme));
  assert(errors.length === 0, `browser errors: ${errors.join("\n")}`);
  await context.close();

  const replaySession = await newPage(browser, viewport, theme);
  await replaySession.page.goto(`${baseUrl}/play/share?run=${encodeURIComponent(token)}`, {
    waitUntil: "domcontentloaded",
  });
  await replaySession.page.getByText("Shared run").first().waitFor();
  await replaySession.page.getByRole("heading", { name: /open proof xi/i }).waitFor();
  await replaySession.page.getByText("Open").first().waitFor();
  metrics.push(await measure(replaySession.page, "open share token", viewport, theme));
  assert(
    replaySession.errors.length === 0,
    `token replay browser errors: ${replaySession.errors.join("\n")}`,
  );
  await replaySession.context.close();

  const badSession = await newPage(browser, viewport, theme);
  await badSession.page.goto(`${baseUrl}/play/share?run=${encodeURIComponent(tampered)}`, {
    waitUntil: "domcontentloaded",
  });
  await badSession.page.getByText(/Couldn't replay the shared run/i).waitFor();
  assert(
    badSession.errors.length === 0,
    `tampered token browser errors: ${badSession.errors.join("\n")}`,
  );
  await badSession.context.close();

  return { tokenPrefix: token.slice(0, 3), tamperedRejected, metrics };
}

async function verifyHowToPlay(browser: Browser, viewport: ViewportCase, theme: Theme) {
  const session = await newPage(browser, viewport, theme);
  const { page, context, errors } = session;
  await page.goto(`${baseUrl}/how-to-play`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Draft modes" }).waitFor();
  await page.getByText("Open Draft").first().waitFor();
  await page
    .getByText(/casual-only/i)
    .first()
    .waitFor();
  const metrics = await measure(page, "how-to-play", viewport, theme);
  assert(errors.length === 0, `how-to-play browser errors: ${errors.join("\n")}`);
  await context.close();
  return metrics;
}

const browser = await chromium.launch({
  channel: process.env.WCDRAFT_PLAYWRIGHT_CHANNEL ?? "chrome",
  headless: true,
});
try {
  const proof = {
    baseUrl,
    axeSource: axeCdn,
    reducedMotion: "reduce",
    cases: [] as unknown[],
  };
  for (const viewport of viewports) {
    for (const theme of themes) {
      const interactive = await verifyInteractiveOpenDraft(browser, viewport, theme);
      const completed = await verifyCompletedOpenRun(browser, viewport, theme);
      const howToPlay = await verifyHowToPlay(browser, viewport, theme);
      proof.cases.push({
        viewport: viewport.name,
        theme,
        openRosterRolledCount: interactive.rolledCount,
        tokenPrefix: completed.tokenPrefix,
        tamperedRejected: completed.tamperedRejected,
        metrics: [...interactive.metrics, ...completed.metrics, howToPlay],
      });
    }
  }
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await browser.close();
}
