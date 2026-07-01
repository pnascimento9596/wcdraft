import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";
import {
  activeSpin,
  autoDraft,
  createDraft,
  isDraftComplete,
  pickPlayer,
  selectDraftTarget,
} from "@wcdraft/core";

import { buildGameDataFromBundles } from "../lib/game/__tests__/run-token.test-harness";
import {
  RUN_INDEX_KEY,
  RUN_RECORD_PREFIX,
  RUN_RECORD_SCHEMA_VERSION,
  type RunRecordV1,
} from "../lib/game/run-record";

const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const nextEnvPath = fileURLToPath(new URL("../next-env.d.ts", import.meta.url));
const nextBin = require.resolve("next/dist/bin/next");
const host = "127.0.0.1";
const gameData = buildGameDataFromBundles();

type BrowserCase = {
  page: Page;
  context: BrowserContext;
  errors: string[];
  httpErrors: string[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      assert(address && typeof address === "object", "failed to allocate test server port");
      const port = address.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForServer(baseUrl: string, proc: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastError = "server did not respond";
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Next dev server exited early with code ${proc.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/play`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for Next dev server: ${lastError}`);
}

async function startNextDev(): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const port = await findFreePort();
  const baseUrl = `http://${host}:${port}`;
  const nextEnvSnapshot = await snapshotFile(nextEnvPath);
  let restoredNextEnv = false;
  const restoreNextEnv = async () => {
    if (restoredNextEnv) return;
    restoredNextEnv = true;
    await restoreFile(nextEnvSnapshot);
  };
  const proc = spawn(
    process.execPath,
    [nextBin, "dev", "--webpack", "--hostname", host, "--port", String(port)],
    {
      cwd: appRoot,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  const append = (chunk: Buffer) => {
    logs = `${logs}${chunk.toString()}`.slice(-12_000);
  };
  proc.stdout.on("data", append);
  proc.stderr.on("data", append);
  await waitForServer(baseUrl, proc).catch(async (err) => {
    await stopProcess(proc);
    await restoreNextEnv();
    throw new Error(`${err instanceof Error ? err.message : String(err)}\n\n${logs}`);
  });
  return {
    baseUrl,
    stop: async () => {
      await stopProcess(proc);
      await restoreNextEnv();
    },
  };
}

async function snapshotFile(path: string): Promise<{ path: string; contents: Uint8Array | null }> {
  try {
    return { path, contents: await readFile(path) };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return { path, contents: null };
    }
    throw err;
  }
}

async function restoreFile(snapshot: { path: string; contents: Uint8Array | null }): Promise<void> {
  if (snapshot.contents === null) {
    await rm(snapshot.path, { force: true });
    return;
  }
  await writeFile(snapshot.path, snapshot.contents);
}

async function stopProcess(proc: ChildProcessWithoutNullStreams): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => proc.once("exit", () => resolve())),
    delay(5_000).then(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    }),
  ]);
}

async function newBrowserCase(
  browser: Browser,
  init?: {
    record: RunRecordV1;
  },
): Promise<BrowserCase> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    reducedMotion: "reduce",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  if (init) {
    await context.addInitScript(
      ({ record, recordPrefix, indexKey, schemaVersion }) => {
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
        window.localStorage.setItem("wcdraft:run-counter:v1", String(record.updated_seq));
      },
      {
        record: init.record,
        recordPrefix: RUN_RECORD_PREFIX,
        indexKey: RUN_INDEX_KEY,
        schemaVersion: RUN_RECORD_SCHEMA_VERSION,
      },
    );
  }
  const page = await context.newPage();
  const errors: string[] = [];
  const httpErrors: string[] = [];
  page.on("console", (msg) => {
    // Chromium logs failed fetches as generic console errors with no URL.
    // Those are asserted through the response hook below so known best-effort
    // endpoints can be allowed without hiding real page exceptions.
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource:")) {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    if (isAllowedBestEffortFailure(url.pathname)) return;
    httpErrors.push(`${response.status()} ${url.pathname}`);
  });
  return { page, context, errors, httpErrors };
}

async function assertNoBrowserErrors(testCase: BrowserCase, label: string): Promise<void> {
  await testCase.context.close();
  assert(
    testCase.errors.length === 0 && testCase.httpErrors.length === 0,
    `${label} emitted browser errors:\n${[...testCase.errors, ...testCase.httpErrors].join("\n")}`,
  );
}

function isAllowedBestEffortFailure(pathname: string): boolean {
  return pathname === "/api/auth/csrf" || pathname === "/api/runs" || pathname === "/api/og/sign";
}

interface PositionFirstTarget {
  slotId: string;
  label: string;
  group: "Starting XI" | "Bench";
}

function firstPositionFirstTarget(): PositionFirstTarget {
  const draft = createDraft(gameData.catalog, {
    run_id: "run-v1-1",
    parent_seed: "wcdraft:run:v1:run-v1-1:4-3-3",
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Your XI",
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    era_preset: "all_time",
    draft_flow: "position_first",
    rating_basis: "career",
  });
  const starterTargets = draft.squad.filter((slot) => slot.is_starter);
  for (const target of starterTargets) {
    try {
      selectDraftTarget(gameData.catalog, draft, target.slot_id);
      return { slotId: target.slot_id, label: target.slot_position, group: "Starting XI" };
    } catch {
      // Try the next visible starter slot; the UI surfaces the same dead-end.
    }
  }
  throw new Error("could not find a legal first position-first target");
}

function completedRunRecord(): RunRecordV1 {
  const run_id = "pw-complete-classic";
  const parent_seed = "wcdraft:playwright:complete-classic";
  return {
    record_version: RUN_RECORD_SCHEMA_VERSION,
    run_id,
    parent_seed,
    created_seq: 10,
    updated_seq: 10,
    versions: gameData.versions,
    draft: autoDraft({
      run_id,
      parent_seed,
      formation_id: "4-3-3",
      mode: "classic",
      team_name: "Playwright XI",
      dataset_version: gameData.versions.dataset_version,
      rating_version: gameData.versions.rating_version,
      engine_version: gameData.versions.engine_version,
      dataset: gameData.draftDataset,
      era_preset: "all_time",
      draft_flow: "squad_first",
      rating_basis: "career",
    }),
  };
}

function firstVacantSlotId(draft: ReturnType<typeof createDraft>): string | null {
  return draft.squad.find((slot) => slot.card_id === null)?.slot_id ?? null;
}

function managerOnlyRunRecord(): RunRecordV1 {
  for (let i = 1; i <= 2_000; i += 1) {
    const run_id = `pw-manager-only-${i.toString()}`;
    const parent_seed = `wcdraft:playwright:manager-only:${i.toString()}`;
    let draft = createDraft(gameData.catalog, {
      run_id,
      parent_seed,
      formation_id: "4-3-3",
      mode: "classic",
      team_name: "Manager Only XI",
      dataset_version: gameData.versions.dataset_version,
      rating_version: gameData.versions.rating_version,
      engine_version: gameData.versions.engine_version,
      era_preset: "all_time",
      draft_flow: "squad_first",
      rating_basis: "career",
    });

    for (;;) {
      const spin = activeSpin(draft);
      if (!spin) break;
      const filledPlayers = draft.squad.filter((slot) => slot.card_id !== null).length;
      if (
        spin.index === 16 &&
        draft.manager_card_id === null &&
        filledPlayers === 16 &&
        spin.rolled_manager_card_id !== null &&
        !isDraftComplete(draft)
      ) {
        return {
          record_version: RUN_RECORD_SCHEMA_VERSION,
          run_id,
          parent_seed,
          created_seq: 20,
          updated_seq: 20,
          versions: gameData.versions,
          draft,
        };
      }
      if (spin.index >= 16) break;
      const slotId = firstVacantSlotId(draft);
      if (!slotId) break;
      let picked = false;
      for (const cardId of spin.rolled_card_ids) {
        try {
          draft = pickPlayer(gameData.catalog, draft, cardId, slotId);
          picked = true;
          break;
        } catch {
          // Try the next legal player candidate for this spin.
        }
      }
      if (!picked) break;
    }
  }
  throw new Error("could not construct a manager-only guard draft");
}

async function readRunRecords(page: Page): Promise<RunRecordV1[]> {
  return await page.evaluate((recordPrefix) => {
    return Object.keys(window.localStorage)
      .filter((key) => key.startsWith(recordPrefix))
      .map((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"))
      .filter(Boolean);
  }, RUN_RECORD_PREFIX);
}

async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  const maxScroll = Math.max(metrics.scrollWidth, metrics.bodyScrollWidth);
  assert(
    maxScroll <= metrics.clientWidth + 1,
    `${label} overflow ${maxScroll} > ${metrics.clientWidth}`,
  );
}

async function assertFullyVisibleInViewport(
  page: Page,
  locator: Locator,
  label: string,
): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert(box, `${label} did not render a measurable bounding box`);
  assert(viewport, `${label} could not read viewport size`);
  assert(box.x >= -1, `${label} left edge is outside viewport: ${box.x}`);
  assert(box.y >= -1, `${label} top edge is outside viewport: ${box.y}`);
  assert(
    box.x + box.width <= viewport.width + 1,
    `${label} right edge is outside viewport: ${box.x + box.width} > ${viewport.width}`,
  );
  assert(
    box.y + box.height <= viewport.height + 1,
    `${label} bottom edge is outside viewport: ${box.y + box.height} > ${viewport.height}`,
  );
}

async function verifyPositionFirstDraftFlow(browser: Browser, baseUrl: string): Promise<void> {
  const target = firstPositionFirstTarget();
  const testCase = await newBrowserCase(browser);
  const { page } = testCase;
  await page.goto(`${baseUrl}/play/draft`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Lock a formation" }).waitFor();

  const draftOrderGroup = page.getByRole("group", { name: "Draft order" });
  if (!(await draftOrderGroup.isVisible())) {
    await page.getByRole("button", { name: /Draft setup/ }).click();
  }
  await draftOrderGroup.getByRole("button", { name: "Position First" }).click();
  await page.getByRole("button", { name: /4-3-3[\s\S]*(Selected|Lock this shape)/ }).click();
  const formationLockButton = page.getByRole("button", { name: /Lock 4-3-3/ });
  await assertNoHorizontalOverflow(page, "formation setup");
  await assertFullyVisibleInViewport(page, formationLockButton, "formation lock CTA");
  await formationLockButton.click();
  await page.waitForURL(/\/play\/draft\?run=[^&]+$/, { timeout: 30_000 });

  await page.getByRole("heading", { name: "Choose the slot to fill" }).waitFor();
  const targetButton = page
    .locator('section[aria-label="Choose your target"]')
    .getByRole("button")
    .filter({ hasText: target.label })
    .filter({ hasText: target.group })
    .first();
  await targetButton.click();
  await page.getByRole("button", { name: "Spin" }).waitFor();

  let records = await readRunRecords(page);
  assert(
    records.length === 1,
    `expected one run record after target commit, found ${records.length}`,
  );
  let record = records[0]!;
  assert(
    record.draft.draft_flow === "position_first",
    "draft flow was not persisted as position_first",
  );
  assert(
    record.draft.spins[0]?.target_slot_id === target.slotId,
    `first spin target was ${record.draft.spins[0]?.target_slot_id}, expected ${target.slotId}`,
  );
  assert(record.draft.spins[0]?.status === "pending", "target commit did not materialize the spin");

  await page.getByRole("button", { name: "Spin" }).click();
  await page.getByRole("button", { name: /Reveal choices/ }).click();
  const candidates = page.locator('section[aria-label="Candidates"]');
  await candidates.waitFor();
  await candidates.getByRole("button").filter({ hasText: /OVR/ }).first().click();
  await page.getByRole("button", { name: /Lock pick/ }).click();

  await page.waitForFunction(
    ([recordPrefix, expectedTarget]) => {
      const recordKey = Object.keys(window.localStorage).find((key) =>
        key.startsWith(recordPrefix),
      );
      if (!recordKey) return false;
      const rec = JSON.parse(window.localStorage.getItem(recordKey) ?? "null");
      return (
        rec?.draft?.spins?.[0]?.status === "picked" &&
        rec?.draft?.spins?.[0]?.target_slot_id === expectedTarget &&
        rec?.draft?.spins?.[0]?.assigned_slot_id === expectedTarget
      );
    },
    [RUN_RECORD_PREFIX, target.slotId],
    { timeout: 15_000 },
  );

  records = await readRunRecords(page);
  record = records[0]!;
  assert(record.draft.spins[0]?.picked_card_id, "lock-pick did not persist a picked card");

  await assertNoBrowserErrors(testCase, "position-first draft flow");
}

async function verifyReviewResultsShareFlow(browser: Browser, baseUrl: string): Promise<void> {
  const seeded = completedRunRecord();
  const testCase = await newBrowserCase(browser, { record: seeded });
  const { page } = testCase;

  await page.goto(`${baseUrl}/play/review?run=${seeded.run_id}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Simulate the run" }).waitFor();
  await page.getByRole("button", { name: "Simulate the run" }).click();
  await page.waitForURL(/\/play\/results\?run=pw-complete-classic$/, { timeout: 90_000 });
  await page.getByText("Results").first().waitFor();
  await page.getByRole("link", { name: "Share" }).click();
  await page.waitForURL(/\/play\/share\?run=pw-complete-classic$/, { timeout: 30_000 });
  await page.getByRole("heading", { name: "The card" }).waitFor();
  await page.getByRole("button", { name: "Copy caption" }).waitFor();

  const [record] = await readRunRecords(page);
  assert(record?.status === "complete", "simulate flow did not mark the run complete");
  assert(record.simulation?.run?.record, "simulate flow did not persist run results");

  await assertNoBrowserErrors(testCase, "review/results/share flow");
}

async function verifyManagerOnlyGuardFlow(browser: Browser, baseUrl: string): Promise<void> {
  const seeded = managerOnlyRunRecord();
  const testCase = await newBrowserCase(browser, { record: seeded });
  const { page } = testCase;

  await page.goto(`${baseUrl}/play/draft?run=${seeded.run_id}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Spin" }).click();
  await page.getByRole("button", { name: /Reveal choices/ }).click();
  await page.getByText("All player slots filled — pick the manager.").waitFor();
  await page.waitForFunction(() => /Manager/u.test(document.activeElement?.textContent ?? ""));

  const playerButtons = page
    .locator('section[aria-label="Candidates"]')
    .getByRole("button")
    .filter({ hasText: /OVR/ });
  const count = await playerButtons.count();
  assert(count > 0, "manager-only guard did not render disabled player candidates");
  for (let i = 0; i < count; i += 1) {
    assert(await playerButtons.nth(i).isDisabled(), `player candidate ${i} was not disabled`);
  }

  await assertNoBrowserErrors(testCase, "manager-only guard flow");
}

async function main(): Promise<void> {
  const server = await startNextDev();
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      channel: process.env.WCDRAFT_PLAYWRIGHT_CHANNEL ?? "chrome",
      headless: true,
    });
    await verifyPositionFirstDraftFlow(browser, server.baseUrl);
    await verifyManagerOnlyGuardFlow(browser, server.baseUrl);
    await verifyReviewResultsShareFlow(browser, server.baseUrl);
    console.log(
      "game-flow-playwright: ok - draft setup, position-first target, lock-pick, manager guard, review simulate, results, and share",
    );
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
}

await main();
