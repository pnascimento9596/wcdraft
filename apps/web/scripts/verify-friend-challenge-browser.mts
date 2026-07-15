import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { autoDraft } from "@wcdraft/core";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

import { buildGameDataFromBundles } from "../lib/game/__tests__/run-token.test-harness";
import {
  sha256Hex,
  signFriendChallengePayload,
  SIGNED_FRIEND_CHALLENGE_MAX_LEN,
} from "../lib/game/run-og-signing";
import {
  RUN_INDEX_KEY,
  RUN_RECORD_PREFIX,
  RUN_RECORD_SCHEMA_VERSION,
  type FriendChallengeRunMetadata,
  type RunRecordV1,
} from "../lib/game/run-record";
import { encodeRunToken } from "../lib/game/run-token";
import { runSimulationSync } from "../lib/game/simulate";

type Theme = "light" | "dark";
type ViewportCase = { name: string; width: number; height: number };
type SurfaceMetric = {
  label: string;
  viewport: string;
  theme: Theme;
  screenshot: string;
  scrollWidth: number;
  clientWidth: number;
  horizontalOverflow: boolean;
  smallTargets: string[];
  axeViolations: string[];
};

const baseUrl = process.env.BASE_URL ?? "http://localhost:3028";
const outputDir =
  process.env.OUTPUT_DIR ??
  path.resolve("../../docs/reports/season2-s7-friend-challenge-2026-07-13/playwright");
const axeCdn = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";
const axeSource = await fetch(axeCdn).then((response) => {
  if (!response.ok) throw new Error(`failed to fetch axe-core: HTTP ${response.status.toString()}`);
  return response.text();
});
const gameData = buildGameDataFromBundles();
const secret = "season2-s7-browser-proof-secret-32-bytes";
const parentSeed = "wcdraft:season2:s7:browser-proof";
const viewports: readonly ViewportCase[] = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x800", width: 360, height: 800 },
];
const themes: readonly Theme[] = ["light", "dark"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function completedRecord(
  runId: string,
  teamName: string,
  friendChallenge?: FriendChallengeRunMetadata,
): RunRecordV1 {
  const draft = autoDraft({
    run_id: runId,
    parent_seed: parentSeed,
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
  const record: RunRecordV1 = {
    record_version: RUN_RECORD_SCHEMA_VERSION,
    run_id: runId,
    parent_seed: parentSeed,
    created_seq: 100,
    updated_seq: 100,
    versions: gameData.versions,
    draft,
    status: "ready",
    ...(friendChallenge ? { friend_challenge: friendChallenge } : {}),
  };
  const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record);
  return { ...record, status: "complete", simulation };
}

const originRecord = completedRecord("s7-browser-origin", "Challenge XI");
const originToken = encodeRunToken(originRecord);
const originProof = await signFriendChallengePayload(
  { v: 1, token_hash: await sha256Hex(originToken) },
  secret,
);
const friendRef: FriendChallengeRunMetadata = { token: originToken, proof: originProof };
const recipientComplete = completedRecord("s7-browser-recipient", "Your XI", friendRef);
const verifiedChallenge = {
  status: "VERIFIED" as const,
  parentSeed,
  formationId: "4-3-3",
  mode: "classic" as const,
  draftFlow: "squad_first" as const,
  ratingBasis: "career" as const,
  eraPreset: "all_time" as const,
  dailyDate: null,
  challengerDisplay: "a friend",
  challengerScore: originRecord.simulation!.run.score,
};

async function newSession(
  browser: Browser,
  viewport: ViewportCase,
  theme: Theme,
  record?: RunRecordV1,
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    reducedMotion: "reduce",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(baseUrl).origin,
  });
  await context.addInitScript(
    ({ selectedTheme, initialRecord, recordPrefix, indexKey, schemaVersion }) => {
      window.localStorage.setItem("wcdraft:theme", selectedTheme);
      if (!initialRecord) return;
      window.localStorage.setItem(
        `${recordPrefix}${initialRecord.run_id}`,
        JSON.stringify(initialRecord),
      );
      window.localStorage.setItem(
        indexKey,
        JSON.stringify({
          record_version: schemaVersion,
          entries: [
            {
              run_id: initialRecord.run_id,
              created_seq: initialRecord.created_seq,
              updated_seq: initialRecord.updated_seq,
              versions: initialRecord.versions,
            },
          ],
        }),
      );
    },
    {
      selectedTheme: theme,
      initialRecord: record ?? null,
      recordPrefix: RUN_RECORD_PREFIX,
      indexKey: RUN_INDEX_KEY,
      schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    },
  );
  await context.route("**/api/og/sign", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        signed: "ogs2.browser-proof",
        challenge_proof: originProof,
        cache_key: "browser-proof",
      }),
    });
  });
  await context.route("**/api/challenge/verify", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, challenge: verifiedChallenge }),
    });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      errors.push(message.text());
    }
  });
  return { context, page, errors };
}

async function measure(
  page: Page,
  label: string,
  viewport: ViewportCase,
  theme: Theme,
): Promise<SurfaceMetric> {
  await page.waitForFunction(() => document.title.trim().length > 0);
  await page.addScriptTag({ content: axeSource });
  const axeViolations = await page.evaluate(async () => {
    const axe = (
      window as typeof window & {
        axe?: {
          run: (options?: unknown) => Promise<{ violations: Array<{ id: string }> }>;
        };
      }
    ).axe;
    if (!axe) throw new Error("axe-core did not initialize");
    return (
      await axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })
    ).violations.map((violation) => violation.id);
  });
  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [role="button"], [role="radio"]',
      ),
    ).filter((element) => {
      const box = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden"
      );
    });
    const smallTargets = controls
      .map((element) => {
        const box = element.getBoundingClientRect();
        const label =
          element.getAttribute("aria-label") ??
          element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 70) ??
          element.tagName;
        return { label, width: Math.round(box.width), height: Math.round(box.height) };
      })
      .filter(({ width, height }) => width < 44 || height < 44)
      .map(({ label, width, height }) => `${label} (${width.toString()}x${height.toString()})`);
    return {
      scrollWidth: Math.max(root.scrollWidth, body.scrollWidth),
      clientWidth: root.clientWidth,
      smallTargets,
    };
  });
  const screenshot = path.join(
    outputDir,
    `${label.replace(/\s+/gu, "-")}-${viewport.name}-${theme}.png`,
  );
  await page.screenshot({ path: screenshot, fullPage: true });
  const metric: SurfaceMetric = {
    label,
    viewport: viewport.name,
    theme,
    screenshot,
    ...layout,
    horizontalOverflow: layout.scrollWidth > layout.clientWidth + 1,
    axeViolations,
  };
  assert(
    metric.axeViolations.length === 0,
    `${label} ${viewport.name} ${theme}: axe ${metric.axeViolations.join(", ")}`,
  );
  assert(
    !metric.horizontalOverflow,
    `${label} ${viewport.name} ${theme}: horizontal overflow ${metric.scrollWidth.toString()} > ${metric.clientWidth.toString()}`,
  );
  assert(
    metric.smallTargets.length === 0,
    `${label} ${viewport.name} ${theme}: small targets ${metric.smallTargets.join(", ")}`,
  );
  return metric;
}

function drawKey(record: RunRecordV1): string {
  return JSON.stringify(
    record.draft.spins.map((spin) =>
      spin.status === "awaiting_slot"
        ? null
        : { nation_id: spin.nation_id, tournament_id: spin.tournament_id },
    ),
  );
}

async function exerciseRoundTrip(
  browser: Browser,
  viewport: ViewportCase,
  theme: Theme,
): Promise<{ metrics: SurfaceMetric[]; linkLength: number; sameSeedDraws: boolean }> {
  const metrics: SurfaceMetric[] = [];
  const origin = await newSession(browser, viewport, theme, originRecord);
  await origin.page.goto(`${baseUrl}/play/results?run=${originRecord.run_id}`, {
    waitUntil: "domcontentloaded",
  });
  await origin.page.getByText("Results").first().waitFor();
  await origin.page.getByRole("button", { name: "Challenge a friend" }).click();
  await origin.page.getByRole("button", { name: /Challenge link copied/ }).waitFor();
  const copied = await origin.page.evaluate(() => navigator.clipboard.readText());
  const deepLink = copied.split("\n").at(-1) ?? "";
  const parsed = new URL(deepLink);
  assert(copied.startsWith("Challenge a friend on my WCDraft board."), "share copy is missing");
  assert(parsed.searchParams.get("challenge") === originToken, "copied token changed");
  assert(parsed.searchParams.get("proof") === originProof, "copied proof changed");
  assert(originProof.length === SIGNED_FRIEND_CHALLENGE_MAX_LEN, "proof length changed");
  assert(
    deepLink.length <= 8192,
    `escaped deep link exceeded 8 KiB: ${deepLink.length.toString()}`,
  );
  metrics.push(await measure(origin.page, "challenge-cta", viewport, theme));
  assert(origin.errors.length === 0, `origin browser errors: ${origin.errors.join("\n")}`);
  await origin.context.close();

  const recipient = await newSession(browser, viewport, theme);
  await recipient.page.goto(deepLink, { waitUntil: "domcontentloaded" });
  await recipient.page.getByRole("heading", { name: "You're playing a friend's board" }).waitFor();
  await recipient.page.getByText("Casual only").waitFor();
  await recipient.page.getByLabel("Draft mode: Classic · Casual", { exact: true }).waitFor();
  const setupText = await recipient.page.locator("body").innerText();
  assert(/casual/iu.test(setupText), "challenge setup is missing its casual label");
  assert(
    !setupText.includes("Ranked-capable"),
    "challenge setup incorrectly advertises Ranked-capable",
  );
  metrics.push(await measure(recipient.page, "challenge-setup", viewport, theme));
  await recipient.page.getByRole("button", { name: "Play this board" }).click();
  await recipient.page.waitForURL(/\/play\/draft\?run=run-/u);
  await recipient.page.getByRole("button", { name: "Spin" }).waitFor();
  await recipient.page.getByText("Classic · Casual", { exact: true }).waitFor();
  const activeDraftText = await recipient.page.locator("body").innerText();
  const recipientRecord = await recipient.page.evaluate((recordPrefix) => {
    const runId = new URL(window.location.href).searchParams.get("run");
    if (!runId) return null;
    return JSON.parse(
      window.localStorage.getItem(`${recordPrefix}${runId}`) ?? "null",
    ) as RunRecordV1 | null;
  }, RUN_RECORD_PREFIX);
  assert(recipientRecord, "recipient run was not persisted");
  assert(/casual/iu.test(activeDraftText), "active challenge draft is missing its casual label");
  assert(
    !activeDraftText.includes("Ranked-capable"),
    "active challenge draft incorrectly advertises Ranked-capable",
  );
  assert(recipientRecord.parent_seed === parentSeed, "recipient seed changed");
  assert(recipientRecord.friend_challenge?.token === originToken, "recipient token ref changed");
  assert(recipientRecord.friend_challenge?.proof === originProof, "recipient proof ref changed");
  assert(recipientRecord.ranked_attempt === undefined, "recipient gained ranked metadata");
  assert(recipientRecord.draft.formation_id === "4-3-3", "recipient formation changed");
  assert(recipientRecord.draft.mode === "classic", "recipient mode changed");
  assert(recipientRecord.draft.draft_flow === "squad_first", "recipient flow changed");
  assert(recipientRecord.draft.rating_basis === "career", "recipient rating basis changed");
  assert(recipientRecord.draft.era_preset === "all_time", "recipient era changed");
  const sameSeedDraws = drawKey(recipientRecord) === drawKey(originRecord);
  assert(sameSeedDraws, "recipient did not receive the origin's deterministic draw sequence");
  metrics.push(await measure(recipient.page, "challenge-draft", viewport, theme));
  assert(recipient.errors.length === 0, `recipient browser errors: ${recipient.errors.join("\n")}`);
  await recipient.context.close();

  const headToHead = await newSession(browser, viewport, theme, recipientComplete);
  await headToHead.page.goto(`${baseUrl}/play/results?run=${recipientComplete.run_id}`, {
    waitUntil: "domcontentloaded",
  });
  await headToHead.page.getByText("Verified head to head").waitFor();
  await headToHead.page.getByText(/re-derived from the shared token/u).waitFor();
  metrics.push(await measure(headToHead.page, "challenge-head-to-head", viewport, theme));
  assert(
    headToHead.errors.length === 0,
    `head-to-head browser errors: ${headToHead.errors.join("\n")}`,
  );
  await headToHead.context.close();

  return { metrics, linkLength: deepLink.length, sameSeedDraws };
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.WCDRAFT_PLAYWRIGHT_CHANNEL ?? "chrome",
  headless: true,
});
try {
  const cases: unknown[] = [];
  for (const viewport of viewports) {
    for (const theme of themes) {
      const result = await exerciseRoundTrip(browser, viewport, theme);
      cases.push({ viewport: viewport.name, theme, ...result });
    }
  }
  const proof = {
    baseUrl,
    exactIntegrationBase: "71a4408482b2cb7f619dac9ad4f83a1716935c6c",
    viewports: viewports.map(({ name }) => name),
    themes,
    axeSource: axeCdn,
    originTokenPrefix: originToken.slice(0, 3),
    proofLength: originProof.length,
    cases,
  };
  const proofPath = path.join(outputDir, "friend-challenge-browser-proof.json");
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  console.log(
    `friend-challenge-browser: ok cases=${cases.length.toString()} surfaces=${(
      cases.length * 4
    ).toString()} out=${proofPath}`,
  );
} finally {
  await browser.close();
}
