import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, webkit, type BrowserType, type Page } from "playwright-core";

import { markAgentTempCleanupReady } from "./agent-temp-lifecycle";
import {
  LEGACY_SCREENSHOT_EVIDENCE,
  oneScreenDeviceCases,
  type OneScreenEngine,
} from "./one-screen-device-matrix";

type Theme = "light" | "dark";
type Motion = "no-preference" | "reduce";
type RoutePath = "/" | "/play" | "/play/draft";

type PaintRegion = {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type PaintContribution = {
  readonly label: string;
  readonly changedSampleRatio: number;
};

type PaintAnalysis = {
  readonly failures: readonly string[];
  readonly contributions: readonly PaintContribution[];
};

type ScrollInteractionProof = {
  readonly targetCount: number;
  readonly passed: boolean;
  readonly failures: readonly string[];
};

type SharpMetadata = {
  readonly format?: string;
  readonly width?: number;
  readonly height?: number;
};

type SharpStats = {
  readonly entropy: number;
  readonly channels: readonly {
    readonly min: number;
    readonly max: number;
    readonly stdev: number;
  }[];
};

type SharpPipeline = {
  png: (options: { compressionLevel: number; adaptiveFiltering: boolean }) => SharpPipeline;
  toBuffer: () => Promise<Buffer>;
  metadata: () => Promise<SharpMetadata>;
  extract: (region: { left: number; top: number; width: number; height: number }) => SharpPipeline;
  raw: () => SharpPipeline;
  stats: () => Promise<SharpStats>;
};

type SharpFactory = (
  input: Buffer,
  options?: { readonly failOn?: "none" | "warning" | "error" | "truncated" },
) => SharpPipeline;

type FitMetric = {
  readonly engine: OneScreenEngine;
  readonly browserVersion: string;
  readonly device: string;
  readonly descriptorSource: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly strictVerticalFit: boolean;
  readonly theme: Theme;
  readonly motion: Motion;
  readonly pathname: RoutePath;
  readonly screenshot: string | null;
  readonly screenshotPaintStable: boolean | null;
  readonly screenshotCaptureCount: number | null;
  readonly screenshotChangedSampleRatio: number | null;
  readonly screenshotPngNormalized: boolean | null;
  readonly screenshotPaintFailures: readonly string[];
  readonly screenshotPaintContributions: readonly PaintContribution[];
  readonly scrollHeight: number;
  readonly bodyScrollHeight: number;
  readonly innerHeight: number;
  readonly scrollWidth: number;
  readonly innerWidth: number;
  readonly footerDisplay: string | null;
  readonly disclosureLineCount: number;
  readonly disclosureLinesInViewport: boolean;
  readonly disclosureLinesReachable: boolean;
  readonly disclosureTexts: readonly string[];
  readonly disclosurePosition: string | null;
  readonly disclosureBottomGapPx: number | null;
  readonly modeDockDisclosureOverlapPx: number | null;
  readonly renderedTheme: string | null;
  readonly renderedReducedMotion: boolean;
  readonly unpaintedRequiredContent: readonly string[];
  readonly missingRequiredPaintTargets: readonly string[];
  readonly devicePixelRatio: number;
  readonly requiredPaintRegions: readonly PaintRegion[];
  readonly ledeLines: number | null;
  readonly requiredTargetCount: number;
  readonly requiredTargetsInViewport: boolean;
  readonly requiredTargetsReachable: boolean;
  readonly scrollInteractionRequired: boolean;
  readonly scrollInteractionTargetCount: number;
  readonly scrollInteractionPassed: boolean;
  readonly scrollInteractionFailures: readonly string[];
  readonly smallTargets: readonly string[];
  readonly homeDemoPresent: boolean | null;
  readonly homeStatCount: number | null;
  readonly modeCardCount: number | null;
  readonly regularModeColumns: number | null;
  readonly progressItemCount: number | null;
  readonly progressOneRow: boolean | null;
  readonly dailyHeaderOneRow: boolean | null;
  readonly cardCollisionCount: number | null;
  readonly modeDescriptorsUseBodyTypography: boolean | null;
  readonly modeCardBottomCount: number | null;
  readonly formationCardCount: number | null;
  readonly formationColumns: number | null;
  readonly formationDotCount: number | null;
  readonly formationGoalBoxCount: number | null;
  readonly formationShapeMarkerCount: number | null;
  readonly formationAppBarCount: number | null;
  readonly formationSetupNoteCount: number | null;
  readonly formationDescriptorTexts: readonly string[] | null;
  readonly formationSelectedCheckCount: number | null;
  readonly formationActiveMarkerColorsCorrect: boolean | null;
  readonly formationMinimumTextPx: number | null;
  readonly formationSectionFits: boolean | null;
  readonly formationCardCollisionCount: number | null;
  readonly formationCardContentOverflowCount: number | null;
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
  | "strictVerticalFit"
  | "theme"
  | "motion"
  | "pathname"
  | "screenshot"
  | "screenshotPaintStable"
  | "screenshotCaptureCount"
  | "screenshotChangedSampleRatio"
  | "screenshotPngNormalized"
  | "screenshotPaintFailures"
  | "screenshotPaintContributions"
  | "scrollInteractionRequired"
  | "scrollInteractionTargetCount"
  | "scrollInteractionPassed"
  | "scrollInteractionFailures"
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
const screenshotTimeoutMs = 30_000;
const shellReadyTimeoutMs = 15_000;
const hiddenPaintBaselineAttempts = 3;
const themes: readonly Theme[] = ["light", "dark"];
const motions: readonly Motion[] = ["no-preference", "reduce"];
const routes: readonly RoutePath[] = ["/", "/play", "/play/draft"];
const legalDisclosureTexts = [
  "Data: The Fjelstul World Cup Database © 2023 Joshua C. Fjelstul, Ph.D., licensed CC-BY-SA 4.0 (github.com/jfjelstul/worldcup), modified.",
  "wcdraft is an independent project and is not affiliated with, endorsed by, or associated with any official competition or governing body.",
] as const;
const formationDescriptors = [
  "Wide attack",
  "Compact block",
  "Two strikers",
  "Screened defence",
  "Midfield control",
  "Front three",
  "Twin creators",
  "Deep defence",
] as const;
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

async function loadSharp(): Promise<SharpFactory> {
  const moduleName = "sharp";
  try {
    return ((await import(moduleName)) as unknown as { default: SharpFactory }).default;
  } catch {
    const { globSync } = require("node:fs") as typeof import("node:fs");
    const root = path.join(appRoot, "..", "..", "node_modules", ".pnpm");
    const matches = globSync("sharp@*/node_modules/sharp/lib/index.js", { cwd: root });
    const match = matches[0];
    if (!match) {
      throw new Error(
        "sharp not found; install dev dependencies before running one-screen verification",
      );
    }
    return (
      (await import(pathToFileURL(path.join(root, match)).href)) as unknown as {
        default: SharpFactory;
      }
    ).default;
  }
}

const sharpPromise = loadSharp();

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

const routeReadySelectors: Readonly<Record<RoutePath, readonly string[]>> = {
  "/": [
    ".masthead",
    ".hero .display",
    ".hero .hero__sub",
    "[data-hero-spin-demo]",
    ".hero .hero__meta",
  ],
  "/play": [
    ".masthead",
    ".game-page--mode .page-head",
    '[aria-label="Daily progress"]',
    '[aria-label="Draft mode"]',
    '[role="radio"]:nth-of-type(5)',
    "main button.btn",
  ],
  "/play/draft": [
    ".masthead",
    "[data-formation-select]",
    "[data-formation-select] h1",
    '[data-formation-select] [aria-label="Era preset"]',
    "[data-formation-select] [class*='formationGrid']",
    "[data-formation-select] button[class*='formationCard']:nth-of-type(8)",
    "[data-formation-select] [class*='formationDock'] button",
  ],
};

async function waitForRouteReady(page: Page, pathname: RoutePath): Promise<void> {
  await page.waitForFunction(
    ({ expectedPath, selectors }) => {
      if (window.location.pathname !== expectedPath) return false;
      return selectors.every((selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        for (let current: HTMLElement | null = element; current; current = current.parentElement) {
          const style = window.getComputedStyle(current);
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
      });
    },
    { expectedPath: pathname, selectors: routeReadySelectors[pathname] },
  );
}

async function waitForShellReady(page: Page): Promise<void> {
  // Production auth performs a bounded mount-time session read. While it is
  // pending, AccountMenu renders a 5.5rem loading chip in the masthead; when
  // the read settles that chip disappears on mobile and moves the theme
  // control. Measuring paint regions before that transition creates a stale
  // crop even though the final control is visibly painted.
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Checking session"]') === null,
    undefined,
    { timeout: shellReadyTimeoutMs },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function waitForInitialRouteMotion(page: Page, pathname: RoutePath): Promise<void> {
  const animatedSurfaceSelectors = pathname === "/" ? ["main > *", ".reveal > *"] : ["main > *"];
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.waitForFunction(
    (selectors) =>
      selectors.every((selector) =>
        [...document.querySelectorAll(selector)].every((element) =>
          element
            .getAnimations()
            .every(
              (animation) => animation.playState !== "running" && animation.playState !== "pending",
            ),
        ),
      ),
    animatedSurfaceSelectors,
    { timeout: 5_000 },
  );
}

function metricFailures(metric: FitMetric): readonly string[] {
  const prefix = `${metric.engine}/${metric.device}/${metric.theme}/${metric.motion}${metric.pathname}`;
  const failures: string[] = [];
  if (metric.strictVerticalFit && metric.scrollHeight > metric.innerHeight) {
    failures.push(`${prefix}: document height ${metric.scrollHeight}/${metric.innerHeight}`);
  }
  if (metric.strictVerticalFit && metric.bodyScrollHeight > metric.innerHeight) {
    failures.push(`${prefix}: body height ${metric.bodyScrollHeight}/${metric.innerHeight}`);
  }
  if (metric.scrollWidth > metric.innerWidth) {
    failures.push(`${prefix}: document width ${metric.scrollWidth}/${metric.innerWidth}`);
  }
  if (metric.footerDisplay !== "none") failures.push(`${prefix}: footer is visible`);
  const expectsDisclosure = metric.pathname !== "/play/draft";
  if (expectsDisclosure) {
    if (metric.disclosureLineCount !== 2) {
      failures.push(
        `${prefix}: expected 2 disclosure lines, saw ${metric.disclosureLineCount.toString()}`,
      );
    }
    if (JSON.stringify(metric.disclosureTexts) !== JSON.stringify(legalDisclosureTexts)) {
      failures.push(`${prefix}: legal disclosure copy changed`);
    }
    if (!metric.disclosureLinesReachable) {
      failures.push(`${prefix}: disclosure lines are not reachable`);
    }
    if (metric.disclosurePosition === "fixed") {
      failures.push(`${prefix}: disclosure uses fixed positioning`);
    }
    if ((metric.disclosureBottomGapPx ?? Number.POSITIVE_INFINITY) > 1) {
      failures.push(
        `${prefix}: disclosure is ${String(metric.disclosureBottomGapPx)}px above its route shell`,
      );
    }
  } else if (metric.disclosureLineCount !== 0) {
    failures.push(
      `${prefix}: formation route unexpectedly renders ${metric.disclosureLineCount.toString()} disclosure lines`,
    );
  }
  if ((metric.modeDockDisclosureOverlapPx ?? 0) > 0) {
    failures.push(
      `${prefix}: mode dock overlaps disclosure by ${String(metric.modeDockDisclosureOverlapPx)}px`,
    );
  }
  if (expectsDisclosure && metric.strictVerticalFit && !metric.disclosureLinesInViewport) {
    failures.push(`${prefix}: disclosure lines are below the initial viewport`);
  }
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
  if (metric.missingRequiredPaintTargets.length > 0) {
    failures.push(
      `${prefix}: required paint targets are missing ` +
        metric.missingRequiredPaintTargets.join(" | "),
    );
  }
  if (!metric.requiredTargetsReachable)
    failures.push(`${prefix}: required target is not reachable`);
  if (metric.scrollInteractionRequired && !metric.scrollInteractionPassed) {
    failures.push(
      `${prefix}: interactive scroll reachability failed ${metric.scrollInteractionFailures.join(
        " | ",
      )}`,
    );
  }
  if (metric.strictVerticalFit && !metric.requiredTargetsInViewport) {
    failures.push(`${prefix}: required target below fold`);
  }
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
        `${String(metric.screenshotCaptureCount)} captures ` +
        `(changed sample ratio ${String(metric.screenshotChangedSampleRatio)})`,
    );
  }
  if (metric.screenshot !== null && !metric.screenshotPngNormalized) {
    failures.push(`${prefix}: screenshot was not normalized into portable PNG evidence`);
  }
  if (metric.screenshotPaintFailures.length > 0) {
    failures.push(
      `${prefix}: screenshot required regions are not painted ${metric.screenshotPaintFailures.join(
        " | ",
      )}`,
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
  } else if (metric.pathname === "/play") {
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
    if (!metric.dailyHeaderOneRow) {
      failures.push(`${prefix}: Daily card header and action are not one visual row`);
    }
    if ((metric.cardCollisionCount ?? 1) > 0) {
      failures.push(`${prefix}: ${String(metric.cardCollisionCount)} mode-card collisions`);
    }
    if (!metric.modeDescriptorsUseBodyTypography) {
      failures.push(`${prefix}: mode descriptors are not untracked regular-weight body copy`);
    }
    if (metric.modeCardBottomCount !== 5) {
      failures.push(
        `${prefix}: expected 5 visible per-card action labels, saw ${String(metric.modeCardBottomCount)}`,
      );
    }
  } else {
    const expectedColumns = metric.viewport.width < 360 ? 2 : 3;
    if (metric.formationCardCount !== 8) {
      failures.push(
        `${prefix}: expected 8 formation cards, saw ${String(metric.formationCardCount)}`,
      );
    }
    if (metric.formationColumns !== expectedColumns) {
      failures.push(
        `${prefix}: expected ${expectedColumns.toString()} formation columns, saw ${String(metric.formationColumns)}`,
      );
    }
    if (metric.requiredTargetCount !== 20) {
      failures.push(
        `${prefix}: expected setup toggle, 10 setup choices, 8 formations, and dock action; saw ${metric.requiredTargetCount.toString()} targets`,
      );
    }
    if (metric.formationDotCount !== 80 || metric.formationGoalBoxCount !== 8) {
      failures.push(
        `${prefix}: expected 80 uniform dots and 8 goalkeeper boxes; saw ${String(metric.formationDotCount)} and ${String(metric.formationGoalBoxCount)}`,
      );
    }
    if (metric.formationShapeMarkerCount !== 0) {
      failures.push(
        `${prefix}: selector leaked ${String(metric.formationShapeMarkerCount)} position-shape markers`,
      );
    }
    if (metric.formationAppBarCount !== 0) {
      failures.push(`${prefix}: duplicate draft app bar is still rendered`);
    }
    if (metric.formationSetupNoteCount !== 3) {
      failures.push(
        `${prefix}: expected 3 visible setup notes, saw ${String(metric.formationSetupNoteCount)}`,
      );
    }
    if (JSON.stringify(metric.formationDescriptorTexts) !== JSON.stringify(formationDescriptors)) {
      failures.push(`${prefix}: formation descriptors changed or are missing`);
    }
    if (metric.formationSelectedCheckCount !== 1) {
      failures.push(`${prefix}: selected formation does not expose one check mark`);
    }
    if (!metric.formationActiveMarkerColorsCorrect) {
      failures.push(`${prefix}: formation dots do not use ink/accent for inactive/active cards`);
    }
    if ((metric.formationMinimumTextPx ?? 0) < 12) {
      failures.push(
        `${prefix}: formation text falls below 12px (${String(metric.formationMinimumTextPx)}px)`,
      );
    }
    if (metric.strictVerticalFit && !metric.formationSectionFits) {
      failures.push(`${prefix}: formation content scrolls inside a strict one-screen context`);
    }
    if ((metric.formationCardCollisionCount ?? 1) > 0) {
      failures.push(
        `${prefix}: ${String(metric.formationCardCollisionCount)} formation-card collisions`,
      );
    }
    if ((metric.formationCardContentOverflowCount ?? 1) > 0) {
      failures.push(
        `${prefix}: ${String(metric.formationCardContentOverflowCount)} formation cards overflow their readable content box`,
      );
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
    const disclosureLines = [...document.querySelectorAll(".one-screen-disclosure [data-disclosure-line]")];
    const modeCards = [...document.querySelectorAll('[role="radio"]')].filter(visible);
    const formationCards = [...document.querySelectorAll('[data-formation-select] button[class*="formationCard"]')].filter(visible);
    const formationSetupButtons = [...document.querySelectorAll('[data-formation-select] button[class*="setupSegBtn"]')].filter(visible);
    const formationSetupToggle = document.querySelector('[data-formation-select] button[class*="setupRow"]');
    const formationDockAction = document.querySelector('[data-formation-select] [class*="formationDock"] button');
    const metaViewport = document.querySelector('meta[name="viewport"]')?.content ?? "";
    const requiredContent =
      pathValue === "/"
        ? [
            ["masthead", document.querySelector(".masthead")],
            ["hero title", document.querySelector(".hero .display")],
            ["hero lede", document.querySelector(".hero__sub")],
            ["spin demo", document.querySelector("[data-hero-spin-demo]")],
            ["stat strip", document.querySelector(".hero__meta")],
            ["attribution disclosure", document.querySelector('[data-disclosure-line="attribution"]')],
            ["not-affiliated disclosure", document.querySelector('[data-disclosure-line="not-affiliated"]')],
          ]
        : pathValue === "/play"
          ? [
              ["masthead", document.querySelector(".masthead")],
              ["mode heading", document.querySelector(".game-page--mode .page-head")],
              ["Daily progress", document.querySelector('[aria-label="Daily progress"]')],
              ["mode grid", document.querySelector('[aria-label="Draft mode"]')],
              ["attribution disclosure", document.querySelector('[data-disclosure-line="attribution"]')],
              ["not-affiliated disclosure", document.querySelector('[data-disclosure-line="not-affiliated"]')],
            ]
          : [
              ["masthead", document.querySelector(".masthead")],
              ["formation heading", document.querySelector('[data-formation-select] h1')],
              ["formation setup", document.querySelector('[data-formation-select] [class*="setupDisclosure"]')],
              ["formation grid", document.querySelector('[data-formation-select] [class*="formationGrid"]')],
              ["formation dock", formationDockAction],
            ];
    const mastheadPaintTargets = [
      ["wordmark", document.querySelector(".wordmark")],
      ["theme control", document.querySelector('[aria-label^="Switch to "]')],
      ["menu control", document.querySelector(".menu-toggle")],
    ];
    const modeCardPaintTargets = Array.from({ length: 5 }, (_, index) => [
      "mode card " + (index + 1).toString(),
      document.querySelectorAll('[role="radio"]')[index] ?? null,
    ]);
    const formationCardPaintTargets = Array.from({ length: 8 }, (_, index) => [
      "formation card " + (index + 1).toString(),
      formationCards[index] ?? null,
    ]);
    const routePaintTargets =
      pathValue === "/"
        ? [
            ["hero title", document.querySelector(".hero .display")],
            ["hero lede", document.querySelector(".hero__sub")],
            ["spin demo", document.querySelector("[data-hero-spin-demo]")],
            ["hero actions", document.querySelector(".hero .btn-row")],
            ["stat strip", document.querySelector(".hero__meta")],
            ["attribution disclosure", document.querySelector('[data-disclosure-line="attribution"]')],
            ["not-affiliated disclosure", document.querySelector('[data-disclosure-line="not-affiliated"]')],
          ]
        : pathValue === "/play"
          ? [
              ["mode title", document.querySelector(".game-page--mode .display")],
              ["mode lede", document.querySelector(".game-page--mode .lede")],
              ["Daily progress", document.querySelector('[aria-label="Daily progress"]')],
              ...modeCardPaintTargets,
              ["dock action", document.querySelector("main button.btn")],
              ["attribution disclosure", document.querySelector('[data-disclosure-line="attribution"]')],
              ["not-affiliated disclosure", document.querySelector('[data-disclosure-line="not-affiliated"]')],
            ]
          : [
              ["formation title", document.querySelector('[data-formation-select] h1')],
              ["formation setup", document.querySelector('[data-formation-select] [class*="setupDisclosure"]')],
              ...formationCardPaintTargets,
              ["formation dock", formationDockAction],
            ];
    const paintTargetEntries = [...mastheadPaintTargets, ...routePaintTargets];
    const paintTargetByLabel = new Map(paintTargetEntries);
    const expectedPaintLabels = [
      "wordmark",
      "theme control",
      ...(matchMedia("(max-width: 51.999rem)").matches ? ["menu control"] : []),
      ...(pathValue === "/"
        ? [
            "hero title",
            "hero lede",
            "spin demo",
            "hero actions",
            "stat strip",
            "attribution disclosure",
            "not-affiliated disclosure",
          ]
        : pathValue === "/play"
          ? [
              "mode title",
              "mode lede",
              "Daily progress",
              "mode card 1",
              "mode card 2",
              "mode card 3",
              "mode card 4",
              "mode card 5",
              "dock action",
              "attribution disclosure",
              "not-affiliated disclosure",
            ]
          : [
              "formation title",
              "formation setup",
              "formation card 1",
              "formation card 2",
              "formation card 3",
              "formation card 4",
              "formation card 5",
              "formation card 6",
              "formation card 7",
              "formation card 8",
              "formation dock",
            ]),
    ];
    const missingRequiredPaintTargets = expectedPaintLabels.filter(
      (label) => !visible(paintTargetByLabel.get(label)),
    );
    const requiredPaintRegions = expectedPaintLabels
      .filter((label) => visible(paintTargetByLabel.get(label)))
      .map((label) => {
        const element = paintTargetByLabel.get(label);
        element.setAttribute("data-wcdraft-paint-target", label);
        const rect = element.getBoundingClientRect();
        return {
          label,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      });
    const unpaintedRequiredContent = requiredContent
      .filter(([, element]) => !visible(element))
      .map(([label]) => label);
    const homeActions = [...document.querySelectorAll(".hero .btn-row a")].filter(visible);
    const dockAction = document.querySelector("main button.btn");
    const requiredTargets =
      pathValue === "/"
        ? homeActions
        : pathValue === "/play"
          ? [...modeCards, ...(dockAction && visible(dockAction) ? [dockAction] : [])]
          : [
              ...(formationSetupToggle && visible(formationSetupToggle) ? [formationSetupToggle] : []),
              ...formationSetupButtons,
              ...formationCards,
              ...(formationDockAction && visible(formationDockAction) ? [formationDockAction] : []),
            ];
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
    const reachableDocumentWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const reachableDocumentHeight = Math.max(doc.scrollHeight, body.scrollHeight);
    const requiredTargetsReachable = requiredTargets.every((element) => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.left >= 0 && rect.bottom <= reachableDocumentHeight && rect.right <= reachableDocumentWidth;
    });
    const disclosureLinesInViewport = disclosureLines.every((element) => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
    });
    const disclosureLinesReachable = disclosureLines.every((element) => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.left >= 0 && rect.bottom <= reachableDocumentHeight && rect.right <= innerWidth;
    });
    const disclosure = document.querySelector(".one-screen-disclosure");
    const disclosureShell =
      pathValue === "/"
        ? document.querySelector(".hero")
        : pathValue === "/play"
          ? document.querySelector(".game-page--mode")
          : null;
    const disclosurePosition = visible(disclosure) ? getComputedStyle(disclosure).position : null;
    const disclosureBottomGapPx =
      visible(disclosure) && visible(disclosureShell)
        ? Math.abs(
            disclosure.getBoundingClientRect().bottom -
              disclosureShell.getBoundingClientRect().bottom,
          )
        : null;
    const modeDockDisclosureOverlapPx = (() => {
      if (pathValue !== "/play") return null;
      const dock = document.querySelector('[class*="modeDock"]');
      if (!visible(dock) || !visible(disclosure)) return null;
      const dockRect = dock.getBoundingClientRect();
      const disclosureRect = disclosure.getBoundingClientRect();
      const overlapsHorizontally = dockRect.left < disclosureRect.right && dockRect.right > disclosureRect.left;
      if (!overlapsHorizontally) return 0;
      return Math.max(
        0,
        Math.min(dockRect.bottom, disclosureRect.bottom) -
          Math.max(dockRect.top, disclosureRect.top),
      );
    })();
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
    const dailyHeaderParts = dailyCard
      ? [...dailyCard.children].filter(
          (element) => visible(element) && /modeCard(?:Top|Bottom)/u.test(element.className),
        )
      : [];
    const modeDescriptors = modeCards
      .map((card) => card.querySelector('[class*="modeDesc"]'))
      .filter(visible);
    const modeDescriptorsUseBodyTypography =
      pathValue === "/play"
        ? modeDescriptors.length === 5 &&
          modeDescriptors.every((element) => {
            const style = getComputedStyle(element);
            return (
              Number.parseFloat(style.fontSize) >= 12 &&
              Number.parseInt(style.fontWeight, 10) === 400 &&
              (style.letterSpacing === "normal" || Number.parseFloat(style.letterSpacing) === 0) &&
              style.textTransform === "none"
            );
          })
        : null;
    const modeCardBottomCount =
      pathValue === "/play"
        ? modeCards.filter((card) => visible(card.querySelector('[class*="modeCardBottom"]'))).length
        : null;
    const formationSection = document.querySelector('[data-formation-select] [class*="formationSelect"]');
    const formationSetupNotes = [
      ...document.querySelectorAll('[data-formation-select] [class*="setupAxisNote"]'),
    ].filter(visible);
    const formationDescriptorTexts =
      pathValue === "/play/draft"
        ? [...document.querySelectorAll('[data-formation-select] [class*="formationCardDescriptor"]')].map(
            (element) => element.textContent?.replace(/\s+/gu, " ").trim() ?? "",
          )
        : null;
    const formationActiveMarkerColorsCorrect = (() => {
      if (pathValue !== "/play/draft") return null;
      const selectedDots = [
        ...document.querySelectorAll(
          '[data-formation-select] button[aria-pressed="true"] [data-formation-mini-pitch] [class*="miniDot"]',
        ),
      ];
      const inactiveDots = [
        ...document.querySelectorAll(
          '[data-formation-select] button[aria-pressed="false"] [data-formation-mini-pitch] [class*="miniDot"]',
        ),
      ];
      // Resolve each token on its own attached element. Reusing one probe and
      // mutating its background can expose the previous computed value in
      // WebKit reduced-motion contexts because the global motion guard gives
      // every property a minimal transition duration.
      const resolveTokenColor = (token) => {
        const probe = document.createElement("span");
        probe.style.position = "fixed";
        probe.style.pointerEvents = "none";
        probe.style.background = token;
        document.body.append(probe);
        const resolved = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return resolved;
      };
      const accent = resolveTokenColor("var(--accent)");
      const ink = resolveTokenColor("var(--ink)");
      return (
        selectedDots.length === 10 &&
        inactiveDots.length === 70 &&
        selectedDots.every((dot) => getComputedStyle(dot).backgroundColor === accent) &&
        inactiveDots.every((dot) => getComputedStyle(dot).backgroundColor === ink)
      );
    })();
    const formationTextSizes =
      pathValue === "/play/draft"
        ? [
            ...document.querySelectorAll(
              '[data-formation-select] [class*="formationSub"], [data-formation-select] [class*="setupAxisLabel"], [data-formation-select] [class*="setupSegBtn"], [data-formation-select] [class*="setupAxisNote"], [data-formation-select] [class*="formationCardName"], [data-formation-select] [class*="formationCardDescriptor"], [data-formation-select] [class*="formationCardCheck"], [data-formation-select] [class*="formationDock"] button',
            ),
          ]
            .filter(visible)
            .map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
        : [];
    const formationCardContentOverflowCount =
      pathValue === "/play/draft"
        ? formationCards.filter((card) => {
            const body = card.querySelector('[class*="formationCardBody"]');
            const descriptor = card.querySelector('[class*="formationCardDescriptor"]');
            if (descriptor === null) return true;
            const cardRect = card.getBoundingClientRect();
            const descriptorRange = document.createRange();
            descriptorRange.selectNodeContents(descriptor);
            const descriptorRects = [...descriptorRange.getClientRects()];
            const descriptorInsideCard =
              descriptorRects.length > 0 &&
              descriptorRects.every(
                (rect) =>
                  rect.left >= cardRect.left - 1 &&
                  rect.right <= cardRect.right + 1 &&
                  rect.top >= cardRect.top - 1 &&
                  rect.bottom <= cardRect.bottom + 1,
              );
            return (
              card.scrollWidth > card.clientWidth + 1 ||
              (body !== null && body.scrollWidth > body.clientWidth + 1) ||
              !descriptorInsideCard
            );
          }).length
        : null;

    return {
      scrollHeight: doc.scrollHeight,
      bodyScrollHeight: body.scrollHeight,
      innerHeight,
      scrollWidth: doc.scrollWidth,
      innerWidth,
      footerDisplay: footer ? getComputedStyle(footer).display : null,
      disclosureLineCount: disclosureLines.length,
      disclosureLinesInViewport,
      disclosureLinesReachable,
      disclosureTexts: disclosureLines.map((element) => element.textContent?.replace(/\s+/gu, " ").trim() ?? ""),
      disclosurePosition,
      disclosureBottomGapPx,
      modeDockDisclosureOverlapPx,
      renderedTheme: doc.dataset.theme ?? null,
      renderedReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      unpaintedRequiredContent,
      missingRequiredPaintTargets,
      devicePixelRatio,
      requiredPaintRegions,
      ledeLines: lineCount(document.querySelector(".hero__sub")),
      requiredTargetCount: requiredTargets.length,
      requiredTargetsInViewport,
      requiredTargetsReachable,
      smallTargets,
      homeDemoPresent:
        pathValue === "/" ? document.querySelector("[data-hero-spin-demo]") !== null : null,
      homeStatCount: pathValue === "/" ? document.querySelectorAll(".hero .stat").length : null,
      modeCardCount: pathValue === "/play" ? modeCards.length : null,
      regularModeColumns,
      progressItemCount: pathValue === "/play" ? progressItems.length : null,
      progressOneRow: pathValue === "/play" ? rectsShareRow(progressItems) : null,
      dailyHeaderOneRow:
        pathValue === "/play" ? Boolean(dailyCard) && rectsShareRow(dailyHeaderParts) : null,
      cardCollisionCount: pathValue === "/play" ? collisionCount(modeCards) : null,
      modeDescriptorsUseBodyTypography,
      modeCardBottomCount,
      formationCardCount: pathValue === "/play/draft" ? formationCards.length : null,
      formationColumns:
        pathValue === "/play/draft"
          ? new Set(
              formationCards.map((element) => Math.round(element.getBoundingClientRect().left)),
            ).size
          : null,
      formationDotCount:
        pathValue === "/play/draft"
          ? document.querySelectorAll('[data-formation-mini-pitch] [class*="miniDot"]').length
          : null,
      formationGoalBoxCount:
        pathValue === "/play/draft"
          ? document.querySelectorAll('[data-formation-mini-pitch] [class*="miniGoalBox"]').length
          : null,
      formationShapeMarkerCount:
        pathValue === "/play/draft"
          ? document.querySelectorAll('[data-formation-mini-pitch] [class*="miniDotShape_"]').length
          : null,
      formationAppBarCount:
        pathValue === "/play/draft"
          ? document.querySelectorAll('[data-formation-select] [class*="draftAppBar"]').length
          : null,
      formationSetupNoteCount:
        pathValue === "/play/draft" ? formationSetupNotes.length : null,
      formationDescriptorTexts,
      formationSelectedCheckCount:
        pathValue === "/play/draft"
          ? document.querySelectorAll('[data-formation-select] [class*="formationCardCheck"]').length
          : null,
      formationActiveMarkerColorsCorrect,
      formationMinimumTextPx:
        pathValue === "/play/draft" && formationTextSizes.length > 0
          ? Math.min(...formationTextSizes)
          : null,
      formationSectionFits:
        pathValue === "/play/draft" && formationSection
          ? formationSection.scrollHeight <= formationSection.clientHeight + 1
          : null,
      formationCardCollisionCount:
        pathValue === "/play/draft" ? collisionCount(formationCards) : null,
      formationCardContentOverflowCount,
      zoomDisabled: /(?:user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0+)?(?:\s|,|$))/iu.test(
        metaViewport,
      ),
      pageErrors: [],
    };
  })()`)) as MeasuredFitMetric;
}

async function proveScrollReachability(
  page: Page,
  pathname: RoutePath,
): Promise<ScrollInteractionProof> {
  return (await page.evaluate(String.raw`(async () => {
    const pathValue = ${JSON.stringify(pathname)};
    const controls =
      pathValue === "/"
        ? [...document.querySelectorAll(".hero .btn-row a")]
        : pathValue === "/play"
          ? [
              ...document.querySelectorAll('[role="radio"]'),
              ...document.querySelectorAll("main button.btn"),
            ]
          : [
              ...document.querySelectorAll('[data-formation-select] button[class*="setupRow"]'),
              ...document.querySelectorAll('[data-formation-select] button[class*="setupSegBtn"]'),
              ...document.querySelectorAll('[data-formation-select] button[class*="formationCard"]'),
              ...document.querySelectorAll('[data-formation-select] [class*="formationDock"] button'),
            ];
    const disclosures = [
      ...document.querySelectorAll(
        ".one-screen-disclosure [data-disclosure-line]",
      ),
    ].filter(() => pathValue !== "/play/draft");
    const targets = [
      ...controls.map((element, index) => ({
        element,
        interactive: true,
        label:
          element.textContent?.replace(/\s+/gu, " ").trim() ||
          element.getAttribute("aria-label") ||
          "control " + String(index + 1),
      })),
      ...disclosures.map((element) => ({
        element,
        interactive: false,
        label: "disclosure " + (element.dataset.disclosureLine ?? "unknown"),
      })),
    ];
    const scrollingElements = [...document.querySelectorAll("*")]
      .filter(
        (element) =>
          element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth,
      )
      .map((element) => ({ element, left: element.scrollLeft, top: element.scrollTop }));
    const initialWindow = { x: window.scrollX, y: window.scrollY };
    const failures = [];
    const nextPaint = async () => {
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    };
    const restoreScroll = async () => {
      for (const snapshot of scrollingElements) {
        snapshot.element.scrollTo({ left: snapshot.left, top: snapshot.top, behavior: "instant" });
      }
      window.scrollTo({ left: initialWindow.x, top: initialWindow.y, behavior: "instant" });
      await nextPaint();
    };

    try {
      for (const target of targets) {
        target.element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        await nextPaint();
        const rect = target.element.getBoundingClientRect();
        const style = getComputedStyle(target.element);
        const inLayoutViewport =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= window.innerHeight &&
          rect.right <= window.innerWidth;
        const readable =
          inLayoutViewport &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity) > 0.01 &&
          target.element.innerText.trim().length > 0;
        if (!readable) {
          failures.push(target.label + ": did not become readable in the layout viewport");
        }
        if (target.interactive && inLayoutViewport) {
          const centerX = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
          const centerY = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
          const hit = document.elementFromPoint(centerX, centerY);
          if (!(hit === target.element || (hit !== null && target.element.contains(hit)))) {
            failures.push(target.label + ": center point is not operable after scrolling");
          }
        }
        await restoreScroll();
      }
    } finally {
      await restoreScroll();
    }

    return { targetCount: targets.length, passed: failures.length === 0, failures };
  })()`)) as ScrollInteractionProof;
}

function assertCompletePng(buffer: Buffer): void {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(buffer.subarray(0, pngSignature.length).equals(pngSignature), "invalid PNG signature");
  let offset = pngSignature.length;
  let sawIend = false;
  while (offset < buffer.length) {
    assert(offset + 12 <= buffer.length, "truncated normalized PNG chunk header");
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    assert(chunkEnd <= buffer.length, "truncated normalized PNG chunk payload");
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    offset = chunkEnd;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  assert(sawIend, "normalized PNG is missing IEND");
  assert(offset === buffer.length, "normalized PNG contains data after IEND");
}

async function captureNormalizedPng(
  page: Page,
  animations: "allow" | "disabled",
  expectedWidth: number,
  expectedHeight: number | null,
  fullPage = false,
): Promise<Buffer> {
  const raw = await page.screenshot({ animations, fullPage, timeout: screenshotTimeoutMs });
  const sharp = await sharpPromise;
  const normalized = await sharp(raw, { failOn: "warning" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  assertCompletePng(normalized);
  const metadata = await sharp(normalized, { failOn: "warning" }).metadata();
  assert(metadata.format === "png", `normalized screenshot format is ${String(metadata.format)}`);
  const viewport = page.viewportSize();
  assert(viewport, "normalized screenshot page has no viewport");
  const minimumHeight = Math.round(viewport.height * (expectedWidth / viewport.width));
  assert(
    metadata.width === expectedWidth,
    `normalized screenshot width is ${String(metadata.width)}`,
  );
  if (expectedHeight === null) {
    assert(
      (metadata.height ?? 0) >= minimumHeight,
      `full-page screenshot height ${String(metadata.height)} is below viewport ${minimumHeight.toString()}`,
    );
  } else {
    assert(
      metadata.height === expectedHeight,
      `normalized screenshot height ${String(metadata.height)} did not match ${expectedHeight.toString()}`,
    );
  }
  return normalized;
}

async function normalizedPngHeight(buffer: Buffer): Promise<number> {
  const sharp = await sharpPromise;
  const metadata = await sharp(buffer, { failOn: "warning" }).metadata();
  assert(typeof metadata.height === "number", "normalized screenshot is missing its height");
  return metadata.height;
}

async function screenshotPaintFailures(
  screenshot: Buffer,
  hiddenTargetsScreenshot: Buffer,
  regions: readonly PaintRegion[],
  deviceScaleFactor: number,
): Promise<PaintAnalysis> {
  const sharp = await sharpPromise;
  const metadata = await sharp(screenshot, { failOn: "warning" }).metadata();
  const screenshotWidth = metadata.width ?? 0;
  const screenshotHeight = metadata.height ?? 0;
  const failures: string[] = [];
  const contributions: PaintContribution[] = [];
  const minTargetChangedSampleRatio = 0.002;

  for (const region of regions) {
    const left = Math.max(0, Math.floor(region.x * deviceScaleFactor));
    const top = Math.max(0, Math.floor(region.y * deviceScaleFactor));
    const right = Math.min(
      screenshotWidth,
      Math.ceil((region.x + region.width) * deviceScaleFactor),
    );
    const bottom = Math.min(
      screenshotHeight,
      Math.ceil((region.y + region.height) * deviceScaleFactor),
    );
    if (right <= left || bottom <= top) {
      failures.push(`${region.label}: empty crop`);
      continue;
    }
    // Sharp's stats() terminal ignores pending extract operations. Materialize
    // both crops first so the statistics and target-contribution comparison are
    // scoped to the required DOM rectangle rather than the whole screenshot.
    const cropRegion = { left, top, width: right - left, height: bottom - top };
    const [paintedCrop, hiddenCrop] = await Promise.all([
      sharp(screenshot, { failOn: "warning" })
        .extract(cropRegion)
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer(),
      sharp(hiddenTargetsScreenshot, { failOn: "warning" })
        .extract(cropRegion)
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer(),
    ]);
    const stats = await sharp(paintedCrop, { failOn: "warning" }).stats();
    const colorChannels = stats.channels.slice(0, 3);
    const maxRange = Math.max(...colorChannels.map((channel) => channel.max - channel.min));
    const maxStdev = Math.max(...colorChannels.map((channel) => channel.stdev));
    if (stats.entropy < 0.5 || maxRange < 24 || maxStdev < 2.5) {
      failures.push(
        `${region.label}: flat pixels entropy=${stats.entropy.toFixed(2)} ` +
          `range=${maxRange.toFixed(1)} stdev=${maxStdev.toFixed(1)}`,
      );
    }
    const targetChangedSampleRatio = await normalizedChangedSampleRatio(paintedCrop, hiddenCrop);
    contributions.push({ label: region.label, changedSampleRatio: targetChangedSampleRatio });
    if (targetChangedSampleRatio < minTargetChangedSampleRatio) {
      failures.push(
        `${region.label}: no semantic paint contribution ` +
          `changedSampleRatio=${targetChangedSampleRatio.toFixed(6)}`,
      );
    }
  }

  return { failures, contributions };
}

async function normalizedChangedSampleRatio(left: Buffer, right: Buffer): Promise<number> {
  if (left.equals(right)) return 0;
  const sharp = await sharpPromise;
  const [leftPixels, rightPixels] = await Promise.all([
    sharp(left, { failOn: "warning" }).raw().toBuffer(),
    sharp(right, { failOn: "warning" }).raw().toBuffer(),
  ]);
  assert(leftPixels.length === rightPixels.length, "normalized screenshot pixel sizes differ");
  let changedSamples = 0;
  for (let index = 0; index < leftPixels.length; index += 1) {
    if (Math.abs((leftPixels[index] ?? 0) - (rightPixels[index] ?? 0)) > 2) {
      changedSamples += 1;
    }
  }
  return changedSamples / leftPixels.length;
}

async function captureHiddenPaintBaseline(
  page: Page,
  animations: "allow" | "disabled",
  expectedWidth: number,
  expectedHeight: number,
  fullPage: boolean,
): Promise<Buffer> {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>("[data-wcdraft-paint-target]")) {
      const previousStyle = element.getAttribute("style");
      element.dataset.wcdraftPaintHadStyle = previousStyle === null ? "false" : "true";
      element.dataset.wcdraftPaintPreviousStyle = previousStyle ?? "";
      element.style.setProperty("visibility", "hidden", "important");
    }
  });
  try {
    // WebKit can return the prior compositor frame immediately after a
    // visibility mutation even though computed style already says hidden.
    // Cross two animation frames, then discard one normalized capture before
    // retaining the hidden baseline used for semantic contribution checks.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await page.waitForTimeout(150);
    await captureNormalizedPng(page, animations, expectedWidth, expectedHeight, fullPage);
    await page.waitForTimeout(100);
    return await captureNormalizedPng(page, animations, expectedWidth, expectedHeight, fullPage);
  } finally {
    await page.evaluate(() => {
      for (const element of document.querySelectorAll<HTMLElement>("[data-wcdraft-paint-target]")) {
        if (element.dataset.wcdraftPaintHadStyle === "true") {
          element.setAttribute("style", element.dataset.wcdraftPaintPreviousStyle ?? "");
        } else {
          element.removeAttribute("style");
        }
        delete element.dataset.wcdraftPaintHadStyle;
        delete element.dataset.wcdraftPaintPreviousStyle;
      }
    });
    // Let the restored visible frame reach WebKit's compositor before a
    // possible retry hides the same targets again.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await page.waitForTimeout(100);
  }
}

async function analyzePaintEvidence(
  page: Page,
  screenshot: Buffer,
  animations: "allow" | "disabled",
  expectedWidth: number,
  expectedHeight: number,
  requiredPaintRegions: readonly PaintRegion[],
  devicePixelRatio: number,
  fullPage: boolean,
): Promise<PaintAnalysis> {
  let bestAnalysis: PaintAnalysis | null = null;
  for (let attempt = 1; attempt <= hiddenPaintBaselineAttempts; attempt += 1) {
    const hiddenTargetsScreenshot = await captureHiddenPaintBaseline(
      page,
      animations,
      expectedWidth,
      expectedHeight,
      fullPage,
    );
    const analysis = await screenshotPaintFailures(
      screenshot,
      hiddenTargetsScreenshot,
      requiredPaintRegions,
      devicePixelRatio,
    );
    if (analysis.failures.length === 0) return analysis;
    if (
      bestAnalysis === null ||
      analysis.failures.length < bestAnalysis.failures.length ||
      (analysis.failures.length === bestAnalysis.failures.length &&
        analysis.contributions.reduce((sum, entry) => sum + entry.changedSampleRatio, 0) >
          bestAnalysis.contributions.reduce((sum, entry) => sum + entry.changedSampleRatio, 0))
    ) {
      bestAnalysis = analysis;
    }
    // Flat pixels come from the retained painted screenshot and cannot be
    // repaired by recapturing the hidden semantic baseline. A zero semantic
    // delta can be a stale WebKit compositor frame, so only that class earns
    // bounded retries; the same thresholds still adjudicate every attempt.
    if (!analysis.failures.some((failure) => failure.includes("no semantic paint contribution"))) {
      return analysis;
    }
  }
  assert(bestAnalysis, "hidden paint analysis did not run");
  return bestAnalysis;
}

async function captureEvidence(
  page: Page,
  screenshotPath: string | null,
  motion: Motion,
  requiredPaintRegions: readonly PaintRegion[],
  devicePixelRatio: number,
  captureFullPage: boolean,
): Promise<{
  readonly stable: boolean | null;
  readonly captureCount: number | null;
  readonly changedSampleRatio: number | null;
  readonly normalized: boolean | null;
  readonly paintFailures: readonly string[];
  readonly paintContributions: readonly PaintContribution[];
}> {
  if (screenshotPath === null) {
    return {
      stable: null,
      captureCount: null,
      changedSampleRatio: null,
      normalized: null,
      paintFailures: [],
      paintContributions: [],
    };
  }
  const viewport = page.viewportSize();
  assert(viewport, "one-screen screenshot page has no viewport");
  const expectedWidth = Math.round(viewport.width * devicePixelRatio);
  const expectedViewportHeight = Math.round(viewport.height * devicePixelRatio);
  const initialExpectedHeight = captureFullPage ? null : expectedViewportHeight;

  if (motion === "no-preference") {
    // Review evidence is about the finished one-screen composition, not a
    // nondeterministic frame within the finite entrance animation.
    const screenshot = await captureNormalizedPng(
      page,
      "disabled",
      expectedWidth,
      initialExpectedHeight,
      captureFullPage,
    );
    const expectedHeight = initialExpectedHeight ?? (await normalizedPngHeight(screenshot));
    await writeFile(screenshotPath, screenshot);
    const paintAnalysis = await analyzePaintEvidence(
      page,
      screenshot,
      "disabled",
      expectedWidth,
      expectedHeight,
      requiredPaintRegions,
      devicePixelRatio,
      captureFullPage,
    );
    return {
      stable: null,
      captureCount: 1,
      changedSampleRatio: null,
      normalized: true,
      paintFailures: paintAnalysis.failures,
      paintContributions: paintAnalysis.contributions,
    };
  }

  // Playwright can emit a structurally valid PNG that some decoders render
  // incompletely even though its pixel stream is intact. Normalize every frame
  // through an independent decoder before comparing or writing review evidence.
  // The UI is static except for the once-per-second countdown: demand two
  // visually stable normalized captures separated by 500ms. The Daily card has
  // a live countdown, so exact byte equality is accepted immediately and a
  // tightly bounded normalized-pixel delta handles only that small text tick.
  const compositorSettleMs = 1_500;
  const maxCaptures = 7;
  const maxChangedSampleRatio = 0.005;
  await page.waitForTimeout(compositorSettleMs);
  let previous = await captureNormalizedPng(
    page,
    "allow",
    expectedWidth,
    initialExpectedHeight,
    captureFullPage,
  );
  const expectedHeight = initialExpectedHeight ?? (await normalizedPngHeight(previous));
  let changedSampleRatio = 1;
  for (let captureCount = 2; captureCount <= maxCaptures; captureCount += 1) {
    await page.waitForTimeout(500);
    const current = await captureNormalizedPng(
      page,
      "allow",
      expectedWidth,
      expectedHeight,
      captureFullPage,
    );
    changedSampleRatio = await normalizedChangedSampleRatio(previous, current);
    if (changedSampleRatio <= maxChangedSampleRatio) {
      await writeFile(screenshotPath, current);
      const paintAnalysis = await analyzePaintEvidence(
        page,
        current,
        "allow",
        expectedWidth,
        expectedHeight,
        requiredPaintRegions,
        devicePixelRatio,
        captureFullPage,
      );
      return {
        stable: true,
        captureCount,
        changedSampleRatio,
        normalized: true,
        paintFailures: paintAnalysis.failures,
        paintContributions: paintAnalysis.contributions,
      };
    }
    previous = current;
  }
  await writeFile(screenshotPath, previous);
  const paintAnalysis = await analyzePaintEvidence(
    page,
    previous,
    "allow",
    expectedWidth,
    expectedHeight,
    requiredPaintRegions,
    devicePixelRatio,
    captureFullPage,
  );
  return {
    stable: false,
    captureCount: maxCaptures,
    changedSampleRatio,
    normalized: true,
    paintFailures: paintAnalysis.failures,
    paintContributions: paintAnalysis.contributions,
  };
}

async function main(): Promise<void> {
  const configuredOutputRoot =
    process.env.WCDRAFT_ONE_SCREEN_OUT_DIR ?? process.env.WCDRAFT_HOME_FOLD_OUT_DIR;
  const outputRoot =
    configuredOutputRoot ?? (await mkdtemp(path.join(tmpdir(), "wcdraft-one-screen-")));
  const screenshotsDir = path.join(outputRoot, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });
  const server = await startServer();
  const metrics: FitMetric[] = [];
  const resolvedDescriptors: unknown[] = [];

  try {
    for (const [engineName, browserType] of engineEntries) {
      const deviceCases = oneScreenDeviceCases(engineName);
      resolvedDescriptors.push(
        ...deviceCases.map((entry) => ({
          engine: engineName,
          name: entry.name,
          source: entry.source,
          viewport: entry.descriptor.viewport,
          strictVerticalFit: entry.strictVerticalFit,
          screen: entry.descriptor.screen,
          defaultBrowserType: entry.descriptor.defaultBrowserType,
          delegatedDecision: entry.delegatedDecision ?? null,
        })),
      );
      for (const deviceCase of deviceCases) {
        // WebKit reproducibly degraded on the 64th sequential context when all
        // Long sequential engine runs previously stalled after dozens of contexts:
        // navigation first timed out, then
        // semantic navigation exposed the same lifecycle stall at screenshot.
        // Recycle at the device boundary so each launch owns exactly the eight
        // theme/motion/route contexts for one descriptor.
        const browser = await browserType.launch({ headless: true });
        const browserVersion = browser.version();
        try {
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
                  const response = await page.goto(pathname, { waitUntil: "domcontentloaded" });
                  assert(response !== null, `${pathname} did not return a main-document response`);
                  assert(
                    response.ok(),
                    `${pathname} returned HTTP ${response.status().toString()}`,
                  );
                  await waitForRouteReady(page, pathname);
                  await waitForShellReady(page);
                  await page.evaluate(() => document.fonts.ready);
                  await waitForInitialRouteMotion(page, pathname);
                  await hideDevOverlay(page);
                  await page.waitForTimeout(100);
                  const measured = await measurePage(page, pathname);
                  const scrollInteraction = deviceCase.strictVerticalFit
                    ? { targetCount: 0, passed: true, failures: [] }
                    : await proveScrollReachability(page, pathname);
                  const routeLabel =
                    pathname === "/" ? "home" : pathname === "/play" ? "play" : "formation";
                  const screenshot = path.join(
                    screenshotsDir,
                    [engineName, deviceCase.name, theme, motion, routeLabel].join("-") + ".png",
                  );
                  const screenshotCapture = await captureEvidence(
                    page,
                    screenshot,
                    motion,
                    measured.requiredPaintRegions,
                    measured.devicePixelRatio,
                    !deviceCase.strictVerticalFit,
                  );
                  const metric: FitMetric = {
                    engine: engineName,
                    browserVersion,
                    device: deviceCase.name,
                    descriptorSource: deviceCase.source,
                    viewport: deviceCase.descriptor.viewport,
                    strictVerticalFit: deviceCase.strictVerticalFit,
                    theme,
                    motion,
                    pathname,
                    screenshot,
                    screenshotPaintStable: screenshotCapture.stable,
                    screenshotCaptureCount: screenshotCapture.captureCount,
                    screenshotChangedSampleRatio: screenshotCapture.changedSampleRatio,
                    screenshotPngNormalized: screenshotCapture.normalized,
                    screenshotPaintFailures: screenshotCapture.paintFailures,
                    screenshotPaintContributions: screenshotCapture.paintContributions,
                    scrollInteractionRequired: !deviceCase.strictVerticalFit,
                    scrollInteractionTargetCount: scrollInteraction.targetCount,
                    scrollInteractionPassed: scrollInteraction.passed,
                    scrollInteractionFailures: scrollInteraction.failures,
                    ...measured,
                    pageErrors,
                  };
                  metrics.push(metric);
                  const failures = metricFailures(metric);
                  process.stdout.write(
                    `[one-screen] ${engineName} ${deviceCase.name} ${theme} ${motion} ${pathname} ` +
                      `height=${metric.scrollHeight.toString()}/${metric.innerHeight.toString()} ` +
                      `strictVerticalFit=${metric.strictVerticalFit.toString()} ` +
                      `failures=${failures.length.toString()}\n`,
                  );
                  await page.close();
                } finally {
                  await context.close();
                }
              }
            }
          }
        } finally {
          await browser.close();
        }
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
        assertionScope: {
          strictVerticalFit:
            "document.documentElement.scrollHeight <= window.innerHeight for every descriptor except 320x568",
          scrollAllowed:
            "320x568 permits vertical scrolling only; committed scroll interactions must make every disclosure and required control readable or operable before restoring scroll, and all non-vertical-fit assertions remain strict",
        },
        routes,
        themes,
        motions,
        resolvedDescriptors,
        legacyScreenshotEvidenceOnly: LEGACY_SCREENSHOT_EVIDENCE,
        metricCount: metrics.length,
        strictVerticalFitContextCount: metrics.filter((metric) => metric.strictVerticalFit).length,
        scrollAllowedContextCount: metrics.filter((metric) => !metric.strictVerticalFit).length,
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
  if (configuredOutputRoot === undefined) await markAgentTempCleanupReady(outputRoot, tmpdir());
}

await main();
