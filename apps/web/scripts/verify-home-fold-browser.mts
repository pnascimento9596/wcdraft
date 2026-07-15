import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium, webkit, type BrowserType, type Page } from "playwright-core";

import {
  LEGACY_SCREENSHOT_EVIDENCE,
  oneScreenDeviceCases,
  type OneScreenEngine,
} from "./one-screen-device-matrix";

type Theme = "light" | "dark";
type Motion = "no-preference" | "reduce";
type RoutePath = "/" | "/play";

type FitMetric = {
  readonly engine: OneScreenEngine;
  readonly browserVersion: string;
  readonly device: string;
  readonly descriptorSource: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly theme: Theme;
  readonly motion: Motion;
  readonly pathname: RoutePath;
  readonly screenshot: string | null;
  readonly screenshotPaintStable: boolean | null;
  readonly screenshotCaptureCount: number | null;
  readonly scrollHeight: number;
  readonly bodyScrollHeight: number;
  readonly innerHeight: number;
  readonly scrollWidth: number;
  readonly innerWidth: number;
  readonly footerDisplay: string | null;
  readonly renderedTheme: string | null;
  readonly renderedReducedMotion: boolean;
  readonly unpaintedRequiredContent: readonly string[];
  readonly ledeLines: number | null;
  readonly requiredTargetCount: number;
  readonly requiredTargetsInViewport: boolean;
  readonly smallTargets: readonly string[];
  readonly homeDemoPresent: boolean | null;
  readonly homeStatCount: number | null;
  readonly modeCardCount: number | null;
  readonly regularModeColumns: number | null;
  readonly progressItemCount: number | null;
  readonly progressOneRow: boolean | null;
  readonly dailyOneRow: boolean | null;
  readonly cardCollisionCount: number | null;
  readonly zoomDisabled: boolean;
  readonly pageErrors: readonly string[];
};

type MeasuredFitMetric = Omit<
  FitMetric,
  | "engine"
  | "browserVersion"
  | "device"
  | "descriptorSource"
  | "viewport"
  | "theme"
  | "motion"
  | "pathname"
  | "screenshot"
  | "screenshotPaintStable"
  | "screenshotCaptureCount"
>;

type ManagedServer = {
  readonly baseUrl: string;
  readonly stop: () => Promise<void>;
};

const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const nextEnvPath = fileURLToPath(new URL("../next-env.d.ts", import.meta.url));
const nextBin = require.resolve("next/dist/bin/next");
const host = "127.0.0.1";
const strict =
  process.env.WCDRAFT_ONE_SCREEN_STRICT !== "0" && process.env.WCDRAFT_HOME_FOLD_STRICT !== "0";
const themes: readonly Theme[] = ["light", "dark"];
const motions: readonly Motion[] = ["no-preference", "reduce"];
const routes: readonly RoutePath[] = ["/", "/play"];
const engineEntries: readonly [OneScreenEngine, BrowserType][] = [
  ["chromium", chromium],
  ["webkit", webkit],
];
const devOverlayCss = `
  nextjs-portal,
  [data-nextjs-toast],
  [data-nextjs-dialog-overlay],
  [data-nextjs-build-indicator],
  [data-nextjs-dev-tools-button],
  [data-nextjs-dev-tools-panel] {
    display: none !important;
  }
`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      assert(address && typeof address === "object", "failed to allocate one-screen port");
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForExit(
  process: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (process.exitCode !== null || process.signalCode !== null) return true;
  return await new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      process.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    process.once("exit", onExit);
  });
}

async function stopProcess(process: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return;
  process.kill("SIGTERM");
  if (await waitForExit(process, 5_000)) return;
  process.kill("SIGKILL");
  if (!(await waitForExit(process, 5_000))) {
    throw new Error(`one-screen server ${process.pid?.toString() ?? "unknown"} did not stop`);
  }
}

async function startServer(): Promise<ManagedServer> {
  const externalBaseUrl = process.env.BASE_URL;
  if (externalBaseUrl) return { baseUrl: externalBaseUrl, stop: async () => undefined };

  const nextEnvSnapshot = await readFile(nextEnvPath).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  let nextEnvRestored = false;
  const restoreNextEnv = async () => {
    if (nextEnvRestored) return;
    nextEnvRestored = true;
    if (nextEnvSnapshot === null) await rm(nextEnvPath, { force: true });
    else await writeFile(nextEnvPath, nextEnvSnapshot);
  };
  const port = await findFreePort();
  const baseUrl = `http://${host}:${port.toString()}`;
  const proc = spawn(
    process.execPath,
    [nextBin, "dev", "--webpack", "--hostname", host, "--port", port.toString()],
    {
      cwd: appRoot,
      env: { ...globalThis.process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  const append = (chunk: Buffer) => {
    logs = `${logs}${chunk.toString()}`.slice(-100_000);
  };
  proc.stdout.on("data", append);
  proc.stderr.on("data", append);

  try {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) {
        throw new Error(`one-screen server exited ${proc.exitCode.toString()}\n${logs}`);
      }
      try {
        const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(2_000) });
        if (response.status < 500) break;
      } catch {
        // The server is still compiling.
      }
      await delay(300);
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for one-screen server\n${logs}`);
    }
  } catch (error) {
    await stopProcess(proc);
    await restoreNextEnv();
    throw error;
  }

  return {
    baseUrl,
    stop: async () => {
      try {
        await stopProcess(proc);
      } finally {
        await restoreNextEnv();
      }
    },
  };
}

async function hideDevOverlay(page: Page): Promise<void> {
  await page.evaluate((css) => {
    const nonceElement = document.querySelector<HTMLScriptElement | HTMLStyleElement>(
      "script[nonce], style[nonce]",
    );
    const nonce = nonceElement?.nonce ?? "";
    if (!nonce) return;
    const style = document.createElement("style");
    style.nonce = nonce;
    style.dataset.wcdraftOneScreenHarness = "dev-overlay";
    style.textContent = css;
    document.head.append(style);
  }, devOverlayCss);
}

function metricFailures(metric: FitMetric): readonly string[] {
  const prefix = `${metric.engine}/${metric.device}/${metric.theme}/${metric.motion}${metric.pathname}`;
  const failures: string[] = [];
  if (metric.scrollHeight > metric.innerHeight) {
    failures.push(`${prefix}: document height ${metric.scrollHeight}/${metric.innerHeight}`);
  }
  if (metric.bodyScrollHeight > metric.innerHeight) {
    failures.push(`${prefix}: body height ${metric.bodyScrollHeight}/${metric.innerHeight}`);
  }
  if (metric.scrollWidth > metric.innerWidth) {
    failures.push(`${prefix}: document width ${metric.scrollWidth}/${metric.innerWidth}`);
  }
  if (metric.footerDisplay !== "none") failures.push(`${prefix}: footer is visible`);
  if (metric.renderedTheme !== metric.theme) {
    failures.push(`${prefix}: rendered theme is ${String(metric.renderedTheme)}`);
  }
  if (metric.renderedReducedMotion !== (metric.motion === "reduce")) {
    failures.push(`${prefix}: rendered motion preference did not match`);
  }
  if (metric.unpaintedRequiredContent.length > 0) {
    failures.push(
      `${prefix}: required content is not painted ${metric.unpaintedRequiredContent.join(" | ")}`,
    );
  }
  if (!metric.requiredTargetsInViewport) failures.push(`${prefix}: required target below fold`);
  if (metric.smallTargets.length > 0) {
    failures.push(`${prefix}: sub-44px targets ${metric.smallTargets.join(" | ")}`);
  }
  if (metric.zoomDisabled) failures.push(`${prefix}: viewport metadata disables zoom`);
  if (metric.pageErrors.length > 0) {
    failures.push(`${prefix}: page errors ${metric.pageErrors.join(" | ")}`);
  }
  if (metric.screenshot !== null && metric.motion === "reduce" && !metric.screenshotPaintStable) {
    failures.push(
      `${prefix}: reduced-motion screenshot did not reach a stable painted frame after ` +
        `${String(metric.screenshotCaptureCount)} captures`,
    );
  }

  if (metric.pathname === "/") {
    if ((metric.ledeLines ?? Number.POSITIVE_INFINITY) > 2) {
      failures.push(`${prefix}: home lede uses ${String(metric.ledeLines)} lines`);
    }
    if (metric.requiredTargetCount !== 3) {
      failures.push(
        `${prefix}: expected 3 home CTAs, saw ${metric.requiredTargetCount.toString()}`,
      );
    }
    if (!metric.homeDemoPresent) failures.push(`${prefix}: spin demo missing`);
    if (metric.homeStatCount !== 3) {
      failures.push(`${prefix}: expected 3 stats, saw ${String(metric.homeStatCount)}`);
    }
  } else {
    const expectedColumns = metric.viewport.width <= 430 ? 2 : 4;
    if (metric.modeCardCount !== 5) {
      failures.push(`${prefix}: expected 5 mode cards, saw ${String(metric.modeCardCount)}`);
    }
    if (metric.regularModeColumns !== expectedColumns) {
      failures.push(
        `${prefix}: expected ${expectedColumns.toString()} regular columns, saw ${String(metric.regularModeColumns)}`,
      );
    }
    if (metric.requiredTargetCount !== 6) {
      failures.push(
        `${prefix}: expected 5 cards plus dock action, saw ${metric.requiredTargetCount.toString()}`,
      );
    }
    if (metric.progressItemCount !== 4 || !metric.progressOneRow) {
      failures.push(`${prefix}: progress is not four items on one row`);
    }
    if (!metric.dailyOneRow) failures.push(`${prefix}: Daily card is not one visual row`);
    if ((metric.cardCollisionCount ?? 1) > 0) {
      failures.push(`${prefix}: ${String(metric.cardCollisionCount)} mode-card collisions`);
    }
  }
  return failures;
}

async function measurePage(page: Page, pathname: RoutePath): Promise<MeasuredFitMetric> {
  return (await page.evaluate(String.raw`(() => {
    const pathValue = ${JSON.stringify(pathname)};
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          Number.parseFloat(style.opacity) <= 0.01
        ) {
          return false;
        }
      }
      return true;
    };
    const rectsShareRow = (elements) => {
      if (elements.length <= 1) return true;
      const rects = elements.map((element) => element.getBoundingClientRect());
      return Math.max(...rects.map((rect) => rect.top)) < Math.min(...rects.map((rect) => rect.bottom));
    };
    const lineCount = (element) => {
      if (!element) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set(
        [...range.getClientRects()].map((rect) => Math.round(rect.top * 10) / 10),
      ).size;
    };
    const collisionCount = (elements) => {
      const rects = elements.map((element) => element.getBoundingClientRect());
      let collisions = 0;
      for (let left = 0; left < rects.length; left += 1) {
        for (let right = left + 1; right < rects.length; right += 1) {
          const a = rects[left];
          const b = rects[right];
          if (!a || !b) continue;
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
            collisions += 1;
          }
        }
      }
      return collisions;
    };

    const doc = document.documentElement;
    const body = document.body;
    const footer = document.querySelector(".site-footer");
    const metaViewport = document.querySelector('meta[name="viewport"]')?.content ?? "";
    const requiredContent =
      pathValue === "/"
        ? [
            ["masthead", document.querySelector(".masthead")],
            ["hero title", document.querySelector(".hero .display")],
            ["hero lede", document.querySelector(".hero__sub")],
            ["spin demo", document.querySelector("[data-hero-spin-demo]")],
            ["stat strip", document.querySelector(".hero__meta")],
          ]
        : [
            ["masthead", document.querySelector(".masthead")],
            ["mode heading", document.querySelector(".game-page--mode .page-head")],
            ["Daily progress", document.querySelector('[aria-label="Daily progress"]')],
            ["mode grid", document.querySelector('[aria-label="Draft mode"]')],
          ];
    const unpaintedRequiredContent = requiredContent
      .filter(([, element]) => !visible(element))
      .map(([label]) => label);
    const homeActions = [...document.querySelectorAll(".hero a")].filter(visible);
    const modeCards = [...document.querySelectorAll('[role="radio"]')].filter(visible);
    const dockAction = document.querySelector("main button.btn");
    const requiredTargets =
      pathValue === "/"
        ? homeActions
        : [...modeCards, ...(dockAction && visible(dockAction) ? [dockAction] : [])];
    const smallTargets = requiredTargets
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.textContent?.trim() ?? element.getAttribute("aria-label") ?? "", rect };
      })
      .filter(({ rect }) => rect.width < 44 || rect.height < 44)
      .map(({ label, rect }) => label + ":" + rect.width.toFixed(1) + "x" + rect.height.toFixed(1));
    const requiredTargetsInViewport = requiredTargets.every((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
    });
    const isDailyCard = (element) =>
      element.textContent?.toLocaleUpperCase().includes("TODAY'S DRAFT") === true;
    const regularCards = modeCards.filter((element) => !isDailyCard(element));
    const regularModeColumns =
      pathValue === "/play"
        ? new Set(regularCards.map((element) => Math.round(element.getBoundingClientRect().left))).size
        : null;
    const progressItems = [
      ...document.querySelectorAll(
        'section[aria-label="Daily progress"] > div:first-child > span',
      ),
    ].filter(visible);
    const dailyCard = modeCards.find(isDailyCard);
    const dailyParts = dailyCard ? [...dailyCard.children].filter(visible) : [];

    return {
      scrollHeight: doc.scrollHeight,
      bodyScrollHeight: body.scrollHeight,
      innerHeight,
      scrollWidth: doc.scrollWidth,
      innerWidth,
      footerDisplay: footer ? getComputedStyle(footer).display : null,
      renderedTheme: doc.dataset.theme ?? null,
      renderedReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      unpaintedRequiredContent,
      ledeLines: lineCount(document.querySelector(".hero__sub")),
      requiredTargetCount: requiredTargets.length,
      requiredTargetsInViewport,
      smallTargets,
      homeDemoPresent:
        pathValue === "/" ? document.querySelector("[data-hero-spin-demo]") !== null : null,
      homeStatCount: pathValue === "/" ? document.querySelectorAll(".hero .stat").length : null,
      modeCardCount: pathValue === "/play" ? modeCards.length : null,
      regularModeColumns,
      progressItemCount: pathValue === "/play" ? progressItems.length : null,
      progressOneRow: pathValue === "/play" ? rectsShareRow(progressItems) : null,
      dailyOneRow: pathValue === "/play" ? Boolean(dailyCard) && rectsShareRow(dailyParts) : null,
      cardCollisionCount: pathValue === "/play" ? collisionCount(modeCards) : null,
      zoomDisabled: /(?:user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0+)?(?:\s|,|$))/iu.test(
        metaViewport,
      ),
      pageErrors: [],
    };
  })()`)) as MeasuredFitMetric;
}

async function captureEvidence(
  page: Page,
  screenshotPath: string | null,
  motion: Motion,
): Promise<{ readonly stable: boolean | null; readonly captureCount: number | null }> {
  if (screenshotPath === null) return { stable: null, captureCount: null };

  if (motion === "no-preference") {
    // Review evidence is about the finished one-screen composition, not a
    // nondeterministic frame within the finite entrance animation.
    await page.screenshot({ path: screenshotPath, animations: "disabled" });
    return { stable: null, captureCount: 1 };
  }

  // A geometry-only gate previously passed while reduced-motion screenshots
  // were paint-incomplete, and two early captures could even match while both
  // were incomplete. A direct Chromium/WebKit probe reached complete paint by
  // 1.2s, so establish a conservative floor before comparing frames. This UI
  // is then static except for the once-per-second countdown: demand two byte-
  // identical captures separated by 500ms, retrying across a clock tick.
  const compositorSettleMs = 1_500;
  const maxCaptures = 7;
  await page.waitForTimeout(compositorSettleMs);
  let previous = await page.screenshot({ animations: "allow" });
  for (let captureCount = 2; captureCount <= maxCaptures; captureCount += 1) {
    await page.waitForTimeout(500);
    const current = await page.screenshot({ animations: "allow" });
    if (current.equals(previous)) {
      await writeFile(screenshotPath, current);
      return { stable: true, captureCount };
    }
    previous = current;
  }
  await writeFile(screenshotPath, previous);
  return { stable: false, captureCount: maxCaptures };
}

async function main(): Promise<void> {
  const outputRoot =
    process.env.WCDRAFT_ONE_SCREEN_OUT_DIR ??
    process.env.WCDRAFT_HOME_FOLD_OUT_DIR ??
    (await mkdtemp(path.join(tmpdir(), "wcdraft-one-screen-")));
  const screenshotsDir = path.join(outputRoot, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });
  const server = await startServer();
  const metrics: FitMetric[] = [];
  const resolvedDescriptors: unknown[] = [];

  try {
    for (const [engineName, browserType] of engineEntries) {
      const browser = await browserType.launch({ headless: true });
      const browserVersion = browser.version();
      try {
        const deviceCases = oneScreenDeviceCases(engineName);
        resolvedDescriptors.push(
          ...deviceCases.map((entry) => ({
            engine: engineName,
            name: entry.name,
            source: entry.source,
            viewport: entry.descriptor.viewport,
            screen: entry.descriptor.screen,
            defaultBrowserType: entry.descriptor.defaultBrowserType,
            delegatedDecision: entry.delegatedDecision ?? null,
          })),
        );
        for (const deviceCase of deviceCases) {
          for (const theme of themes) {
            for (const motion of motions) {
              for (const pathname of routes) {
                // Keep routes in separate browser contexts. Reusing a context
                // after closing the home page produced reproducible stale/
                // incomplete compositor paint on the subsequent /play page,
                // despite correct DOM state and zero scroll offset.
                const context = await browser.newContext({
                  ...deviceCase.descriptor,
                  baseURL: server.baseUrl,
                  colorScheme: theme,
                  reducedMotion: motion,
                });
                await context.addInitScript((selectedTheme: Theme) => {
                  localStorage.setItem("wcdraft:theme", selectedTheme);
                }, theme);
                try {
                  const page = await context.newPage();
                  const pageErrors: string[] = [];
                  page.on("pageerror", (error) => pageErrors.push(error.message));
                  await page.goto(pathname, { waitUntil: "networkidle" });
                  await hideDevOverlay(page);
                  await page.evaluate(() => document.fonts.ready);
                  await page.waitForTimeout(100);
                  const measured = await measurePage(page, pathname);
                  const screenshot =
                    theme === "dark"
                      ? path.join(
                          screenshotsDir,
                          [
                            engineName,
                            deviceCase.name,
                            motion,
                            pathname === "/" ? "home" : "play",
                          ].join("-") + ".png",
                        )
                      : null;
                  const screenshotCapture = await captureEvidence(page, screenshot, motion);
                  const metric: FitMetric = {
                    engine: engineName,
                    browserVersion,
                    device: deviceCase.name,
                    descriptorSource: deviceCase.source,
                    viewport: deviceCase.descriptor.viewport,
                    theme,
                    motion,
                    pathname,
                    screenshot,
                    screenshotPaintStable: screenshotCapture.stable,
                    screenshotCaptureCount: screenshotCapture.captureCount,
                    ...measured,
                    pageErrors,
                  };
                  metrics.push(metric);
                  const failures = metricFailures(metric);
                  process.stdout.write(
                    `[one-screen] ${engineName} ${deviceCase.name} ${theme} ${motion} ${pathname} ` +
                      `height=${metric.scrollHeight.toString()}/${metric.innerHeight.toString()} ` +
                      `failures=${failures.length.toString()}\n`,
                  );
                  await page.close();
                } finally {
                  await context.close();
                }
              }
            }
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.stop();
  }

  const failures = metrics.flatMap(metricFailures);
  const reportPath = path.join(outputRoot, "one-screen-fit.json");
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        strict,
        assertionScope: "document.documentElement.scrollHeight <= window.innerHeight",
        routes,
        themes,
        motions,
        resolvedDescriptors,
        legacyScreenshotEvidenceOnly: LEGACY_SCREENSHOT_EVIDENCE,
        metricCount: metrics.length,
        failureCount: failures.length,
        failures,
        metrics,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  process.stdout.write(
    `one-screen-fit: ${failures.length === 0 ? "ok" : "failed"} - ` +
      `metrics=${metrics.length.toString()} failures=${failures.length.toString()} ` +
      `report=${reportPath}\n`,
  );
  if (strict && failures.length > 0) {
    throw new Error(`one-screen fit failed:\n${failures.join("\n")}`);
  }
}

await main();
