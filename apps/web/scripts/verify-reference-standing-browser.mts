// FIT-06 UI proof — reference standing on the results surface.
//
//   pnpm --filter @wcdraft/web exec tsx scripts/verify-reference-standing-browser.mts
//
// Drives a real `next dev` server with Playwright:
//   • seeds complete run records (draft + deterministic simulation) at scores
//     nearest the requested probe set {−7, 0, 14, 84} found by scanning seeds;
//   • opens /play/results for each at 390×844 and 360×800, light + dark;
//   • asserts the reference-standing chip renders with honest reference
//     wording (and never field wording), matches the shipped table's value,
//     and appears identically on a token replay of the same run (stability);
//   • runs axe-core on the results page (0 violations at WCAG AA);
//   • saves screenshots to WCDRAFT_UI_PROOF_DIR (or a temp dir).
//
// This script is a verification tool; it does not ship to production.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright-core";

import { autoDraft } from "@wcdraft/core";
import { SCENARIO_2026_BUNDLE, SCORE_DISTRIBUTION_BUNDLE } from "@wcdraft/data";
import { referenceStanding } from "@wcdraft/data/client";

import { buildGameDataFromBundles } from "../lib/game/__tests__/run-token.test-harness";
import { runSimulationSync } from "../lib/game/simulate";
import { encodeRunToken } from "../lib/game/run-token";
import {
  RUN_INDEX_KEY,
  RUN_RECORD_PREFIX,
  RUN_RECORD_SCHEMA_VERSION,
  type RunRecordV1,
} from "../lib/game/run-record";

const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const nextBin = require.resolve("next/dist/bin/next");
const host = "127.0.0.1";
const axeCdn = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";

const PROBE_SCORES = [-7, 0, 14, 84] as const;
const SEED_SCAN = 160;
const OUT_DIR =
  process.env.WCDRAFT_UI_PROOF_DIR ?? path.join(appRoot, "..", "..", ".ui-proof-fit06");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, host, () => {
      const address = srv.address();
      srv.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
    srv.on("error", reject);
  });
}

// ── Seed complete records at scores nearest the probe set ──────────────────

const gameData = buildGameDataFromBundles();
const dist = SCORE_DISTRIBUTION_BUNDLE;
assert(dist, "score-distribution artifact must be committed");

interface SeededRun {
  targetScore: number;
  record: RunRecordV1;
  score: number;
  expectedLabel: string;
}

function buildCompleteRecord(runId: string, seed: string): RunRecordV1 {
  const draft = autoDraft({
    run_id: runId,
    parent_seed: seed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Proof XI",
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    dataset: gameData.draftDataset,
  });
  const base: RunRecordV1 = {
    record_version: RUN_RECORD_SCHEMA_VERSION,
    run_id: runId,
    parent_seed: seed,
    created_seq: 1,
    updated_seq: 1,
    versions: gameData.versions,
    draft,
    status: "complete",
  };
  const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, base);
  return { ...base, simulation };
}

function seedRuns(): SeededRun[] {
  const scanned: Array<{ seed: string; score: number }> = [];
  for (let i = 0; i < SEED_SCAN; i++) {
    const seed = `wcdraft:fit06-proof:v1:${i}`;
    const probe = buildCompleteRecord(`probe-${i}`, seed);
    scanned.push({ seed, score: probe.simulation!.run.score });
  }
  const runs: SeededRun[] = [];
  for (const target of PROBE_SCORES) {
    const best = scanned.reduce((a, b) =>
      Math.abs(b.score - target) < Math.abs(a.score - target) ? b : a,
    );
    const runId = `fit06-proof-${target < 0 ? `neg${-target}` : target}`;
    const record = buildCompleteRecord(runId, best.seed);
    runs.push({
      targetScore: target,
      record,
      score: record.simulation!.run.score,
      expectedLabel: referenceStanding(record.simulation!.run.score, dist!).label,
    });
  }
  return runs;
}

// ── Server + browser plumbing ───────────────────────────────────────────────

async function startServer(port: number): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(
    process.execPath,
    [nextBin, "dev", "--webpack", "--hostname", host, "--port", `${port}`],
    {
      cwd: appRoot,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ) as ChildProcessWithoutNullStreams;
  let logs = "";
  const append = (chunk: Buffer) => {
    logs = `${logs}${chunk.toString()}`.slice(-12_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    assert(child.exitCode === null, `next dev exited early (${child.exitCode})\n${logs}`);
    try {
      const response = await fetch(`http://${host}:${port}/play`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status < 500) return child;
    } catch {
      // keep polling
    }
    await delay(500);
  }
  throw new Error(`next dev did not become ready in 120s\n${logs}`);
}

async function injectRecords(page: Page, records: RunRecordV1[]): Promise<void> {
  await page.evaluate(
    ({ recs, prefix, indexKey, schemaVersion }) => {
      const entries = recs.map((record) => ({
        run_id: record.run_id,
        created_seq: record.created_seq,
        updated_seq: record.updated_seq,
        versions: record.versions,
      }));
      window.localStorage.setItem(
        indexKey,
        JSON.stringify({ record_version: schemaVersion, entries }),
      );
      for (const record of recs) {
        window.localStorage.setItem(`${prefix}${record.run_id}`, JSON.stringify(record));
      }
      window.localStorage.setItem("wcdraft:run-counter:v1", String(recs.length));
    },
    {
      recs: records,
      prefix: RUN_RECORD_PREFIX,
      indexKey: RUN_INDEX_KEY,
      schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    },
  );
}

interface Violation {
  id: string;
  impact: string | null;
  nodes: number;
}

async function runAxe(page: Page, axeSource: string): Promise<Violation[]> {
  await page.addScriptTag({ content: axeSource });
  return await page.evaluate(async () => {
    const runner = (
      window as unknown as {
        axe?: {
          run: (
            ctx: Document,
            opts: unknown,
          ) => Promise<{
            violations: Array<{ id: string; impact: string | null; nodes: unknown[] }>;
          }>;
        };
      }
    ).axe;
    if (!runner) throw new Error("axe not loaded");
    const result = await runner.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

const runs = seedRuns();
console.log(
  "[FIT06-PROOF] seeded runs:",
  runs.map((r) => `target=${r.targetScore} actual=${r.score} "${r.expectedLabel}"`).join(" | "),
);

await mkdir(OUT_DIR, { recursive: true });
const port = await findFreePort();
const server = await startServer(port);
const base = `http://${host}:${port}`;

const axeSource = await fetch(axeCdn).then((res) => {
  if (!res.ok) throw new Error(`failed to fetch axe-core: HTTP ${res.status}`);
  return res.text();
});

let browser: Browser | null = null;
try {
  browser = await chromium.launch();
  const viewports = [
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ];
  const themes: Array<"light" | "dark"> = ["light", "dark"];
  let axeChecked = false;

  for (const viewport of viewports) {
    for (const theme of themes) {
      const context = await browser.newContext({ viewport, colorScheme: theme });
      const page = await context.newPage();
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await injectRecords(
        page,
        runs.map((r) => r.record),
      );

      for (const run of runs) {
        await page.goto(`${base}/play/results?run=${run.record.run_id}`, {
          waitUntil: "networkidle",
        });
        const chip = page.locator(`text=${run.expectedLabel}`).first();
        await chip.waitFor({ state: "visible", timeout: 20_000 });
        // `innerText` reflects CSS text-transform (the chip row renders
        // uppercase) — compare case-insensitively.
        const bodyText = (await page.locator("body").innerText())
          .replace(/\s+/gu, " ")
          .toLowerCase();
        assert(
          bodyText.includes(run.expectedLabel.toLowerCase()),
          `standing chip missing for ${run.record.run_id}`,
        );
        assert(
          !/reference drafts of today's field|today's field of reference/iu.test(bodyText),
          "cross-contaminated standing wording",
        );
        const shot = path.join(
          OUT_DIR,
          `results-${run.record.run_id}-${viewport.width}x${viewport.height}-${theme}.png`,
        );
        await page.screenshot({ path: shot, fullPage: true });

        if (!axeChecked) {
          const violations = await runAxe(page, axeSource);
          assert(
            violations.length === 0,
            `axe violations on results: ${JSON.stringify(violations)}`,
          );
          axeChecked = true;
          console.log("[FIT06-PROOF] axe: 0 violations (results, WCAG A/AA/2.1AA)");
        }
      }

      // Replay stability: the same record served through a `?run=` token must
      // show the identical standing text.
      const stable = runs[2] ?? runs[0]!;
      const token = encodeRunToken(stable.record);
      await page.goto(`${base}/play/results?run=${encodeURIComponent(token)}`, {
        waitUntil: "networkidle",
      });
      await page
        .locator(`text=${stable.expectedLabel}`)
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });
      await context.close();
      console.log(
        `[FIT06-PROOF] ok viewport=${viewport.width}x${viewport.height} theme=${theme} (4 scores + token replay)`,
      );
    }
  }
  console.log(`[FIT06-PROOF] PASS — screenshots in ${OUT_DIR}`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
