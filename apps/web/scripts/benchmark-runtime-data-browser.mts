import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { chromium } from "playwright-core";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const expectedDecodedBytes = 68_380_413;
const maxReadyMs = 10_000;
// Includes the browser, renderer, GPU/network helpers, and the benchmark's
// Node parent. The canonical minified artifact remains gated below 3 GiB.
const maxSampledBrowserRssMiB = 3_000;

type BrowserCase = {
  name: string;
  viewport: { width: number; height: number };
  isMobile?: boolean;
  hasTouch?: boolean;
};

const cases: readonly BrowserCase[] = [
  { name: "desktop", viewport: { width: 1366, height: 768 } },
  {
    name: "mobile-1GiB-js-heap",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function descendantRssKiB(rootPid: number): Promise<number> {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,rss="]);
  const rows = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/u).map(Number))
    .filter((row) => row.length === 3 && row.every(Number.isFinite));
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, ppid] of rows) {
      if (descendants.has(ppid!) && !descendants.has(pid!)) {
        descendants.add(pid!);
        changed = true;
      }
    }
  }
  return rows.reduce((sum, [pid, , rss]) => sum + (descendants.has(pid!) ? rss! : 0), 0);
}

for (const browserCase of cases) {
  const browser = await chromium.launch({
    channel: process.env.WCDRAFT_PLAYWRIGHT_CHANNEL ?? "chrome",
    headless: true,
    args: ["--js-flags=--max-old-space-size=1024"],
  });
  let sampling = true;
  let peakBrowserRssKiB = 0;
  const sampler = (async () => {
    while (sampling) {
      peakBrowserRssKiB = Math.max(peakBrowserRssKiB, await descendantRssKiB(process.pid));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  })();
  try {
    const context = await browser.newContext({
      viewport: browserCase.viewport,
      isMobile: browserCase.isMobile,
      hasTouch: browserCase.hasTouch,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const startedAt = performance.now();
    await page.goto(`${baseUrl}/play/draft?runtime-data-benchmark=${Date.now().toString()}`, {
      waitUntil: "domcontentloaded",
      timeout: maxReadyMs,
    });
    await page.getByRole("button", { name: /Lock .* & spin/u }).waitFor({ timeout: maxReadyMs });
    const readyMs = Math.round(performance.now() - startedAt);
    const metrics = (await cdp.send("Performance.getMetrics")) as {
      metrics: Array<{ name: string; value: number }>;
    };
    const jsHeapUsed = metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value;
    const resources = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.includes("draft-pool.compact.json.br"))
        .map((entry) => {
          const resource = entry as PerformanceResourceTiming;
          return {
            decodedBodySize: resource.decodedBodySize,
            durationMs: Math.round(resource.duration),
          };
        }),
    );
    assert(resources.length === 1, `${browserCase.name}: expected one draft-pool resource`);
    assert(
      resources[0]!.decodedBodySize === expectedDecodedBytes,
      `${browserCase.name}: decoded draft-pool bytes did not match the manifest`,
    );
    assert(readyMs <= maxReadyMs, `${browserCase.name}: setup readiness exceeded ${maxReadyMs}ms`);
    sampling = false;
    await sampler;
    const peakBrowserRssMiB = Math.round(peakBrowserRssKiB / 1024);
    assert(
      peakBrowserRssMiB <= maxSampledBrowserRssMiB,
      `${browserCase.name}: sampled browser RSS ${peakBrowserRssMiB} MiB exceeded ${maxSampledBrowserRssMiB} MiB`,
    );
    console.log(
      JSON.stringify({
        case: browserCase.name,
        readyMs,
        resourceDurationMs: resources[0]!.durationMs,
        decodedBodyBytes: resources[0]!.decodedBodySize,
        settledJsHeapMiB: jsHeapUsed === undefined ? null : Math.round(jsHeapUsed / 1_048_576),
        peakSampledBrowserRssMiB: peakBrowserRssMiB,
      }),
    );
    await context.close();
  } finally {
    sampling = false;
    await sampler;
    await browser.close();
  }
}
