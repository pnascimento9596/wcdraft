import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  chromium,
  webkit,
  type Browser,
  type BrowserType,
  type Locator,
  type Page,
} from "playwright-core";

const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const nextEnvPath = path.join(appRoot, "next-env.d.ts");
const nextBin = require.resolve("next/dist/bin/next");
const host = "127.0.0.1";
const phase = process.env.WCDRAFT_NATIVE_APP_FEEL_PHASE ?? "after";
const strict = process.env.WCDRAFT_NATIVE_APP_FEEL_STRICT === "1";
const browserEngine = process.env.WCDRAFT_NATIVE_APP_FEEL_ENGINE ?? "chromium";
const baseUrlOverride = process.env.WCDRAFT_NATIVE_APP_FEEL_BASE_URL;
const serverMode = process.env.WCDRAFT_NATIVE_APP_FEEL_SERVER ?? "dev";
const outDir =
  process.env.WCDRAFT_NATIVE_APP_FEEL_OUT_DIR ??
  path.join(repoRoot, "docs/reports/native-app-feel-r3", phase);

const viewports = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x800", width: 360, height: 800 },
] as const;
const themes = ["light", "dark"] as const;
const AA_BODY = 4.5;

type ElementState = {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly documentWidth: number;
  readonly viewportWidth: number;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly layout: {
    readonly offsetLeft: number;
    readonly offsetTop: number;
    readonly offsetWidth: number;
    readonly offsetHeight: number;
  };
  readonly css: {
    readonly tapHighlight: string;
    readonly touchAction: string;
    readonly userSelect: string;
    readonly transform: string;
    readonly translate: string;
    readonly filter: string;
    readonly opacity: string;
    readonly color: string;
    readonly backgroundColor: string;
    readonly transitionDuration: string;
  };
};

type PressMetric = {
  readonly control: string;
  readonly route: string;
  readonly viewport: string;
  readonly theme: string;
  readonly before: ElementState;
  readonly active: ElementState;
  readonly focused: ElementState;
  readonly after: ElementState;
  readonly activeStateChanged: boolean;
  readonly activeTextContrast: number | null;
  readonly horizontalShiftPx: number;
  readonly layoutShift: boolean;
  readonly scrollStable: boolean;
  readonly horizontalOverflow: boolean;
  readonly failures: readonly string[];
};

type PageContractMetric = {
  readonly viewport: string;
  readonly theme: string;
  readonly failures: readonly string[];
};

type OverscrollMetric = {
  readonly viewport: string;
  readonly theme: string;
  readonly input: string;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly visualViewportOffsetTop: number;
  readonly shellTop: number;
  readonly failure: string | null;
};

const pressAssertionCount = 9;
const pageAssertionCount = 7;
const overscrollAssertionCount = 1;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      assert(address && typeof address === "object", "failed to allocate a browser-test port");
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
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

async function startServer(): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  assert(serverMode === "dev" || serverMode === "production", `unknown server mode: ${serverMode}`);
  const port = await findFreePort();
  const baseUrl = `http://${host}:${port.toString()}`;
  const nextEnv = await readFile(nextEnvPath).catch(() => null);
  const proc = spawn(
    process.execPath,
    [
      nextBin,
      serverMode === "production" ? "start" : "dev",
      ...(serverMode === "dev" ? ["--webpack"] : []),
      "--hostname",
      host,
      "--port",
      port.toString(),
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        // Production CSP upgrades HTTP subresources to HTTPS. The deployed
        // site is HTTPS, but this loopback-only harness is not; report-only
        // keeps the real policy visible without breaking local hydration in
        // WebKit by rewriting assets to https://127.0.0.1.
        ...(serverMode === "production" ? { WCDRAFT_CSP_REPORT_ONLY: "1" } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  const append = (chunk: Buffer) => {
    logs = `${logs}${chunk.toString()}`.slice(-12_000);
  };
  proc.stdout.on("data", append);
  proc.stderr.on("data", append);
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await stopProcess(proc);
    if (nextEnv === null) await rm(nextEnvPath, { force: true });
    else await writeFile(nextEnvPath, nextEnv);
  };
  try {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null)
        throw new Error(`Next ${serverMode} exited ${proc.exitCode.toString()}\n${logs}`);
      try {
        const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) });
        if (response.status < 500) break;
      } catch {
        // Keep polling until the bounded deadline.
      }
      await delay(500);
    }
    if (Date.now() >= deadline)
      throw new Error(`timed out waiting for Next ${serverMode}\n${logs}`);
    return { baseUrl, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function readState(target: Locator): Promise<ElementState> {
  return await target.evaluate((node) => {
    const element = node as HTMLElement;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      layout: {
        offsetLeft: element.offsetLeft,
        offsetTop: element.offsetTop,
        offsetWidth: element.offsetWidth,
        offsetHeight: element.offsetHeight,
      },
      css: {
        tapHighlight: style.getPropertyValue("-webkit-tap-highlight-color"),
        touchAction: style.touchAction,
        userSelect:
          style.getPropertyValue("user-select") || style.getPropertyValue("-webkit-user-select"),
        transform: style.transform,
        translate: style.translate,
        filter: style.filter,
        opacity: style.opacity,
        color: style.color,
        backgroundColor: style.backgroundColor,
        transitionDuration: style.transitionDuration,
      },
    };
  });
}

function sameLayout(a: ElementState, b: ElementState): boolean {
  return JSON.stringify(a.layout) === JSON.stringify(b.layout);
}

function activeChanged(before: ElementState, active: ElementState): boolean {
  return (
    normalizedTransform(before.css.transform) !== normalizedTransform(active.css.transform) ||
    normalizedTranslate(before.css.translate) !== normalizedTranslate(active.css.translate) ||
    before.css.filter !== active.css.filter ||
    before.css.opacity !== active.css.opacity ||
    before.css.backgroundColor !== active.css.backgroundColor
  );
}

function normalizedTransform(value: string): string {
  if (value === "none") return "identity";
  const channels = value.match(/-?[0-9.]+/gu)?.map(Number);
  if (
    channels?.length === 6 &&
    channels.every((channel, index) => channel === [1, 0, 0, 1, 0, 0][index])
  ) {
    return "identity";
  }
  return value;
}

function normalizedTranslate(value: string): string {
  if (value === "none") return "identity";
  const channels = value.match(/-?[0-9.]+/gu)?.map(Number);
  return channels?.every((channel) => channel === 0) ? "identity" : value;
}

function opaqueRgb(value: string): readonly [number, number, number] | null {
  const channels = value.match(/[0-9.]+/gu)?.map(Number);
  if (!channels || channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) {
    return null;
  }
  if (channels.length >= 4 && channels[3] !== 1) return null;
  return [channels[0]!, channels[1]!, channels[2]!];
}

function cssContrastRatio(foreground: string, background: string): number | null {
  const fg = opaqueRgb(foreground);
  const bg = opaqueRgb(background);
  if (!fg || !bg) return null;
  const luminance = (rgb: readonly [number, number, number]): number => {
    const [red, green, blue] = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  };
  const fgLuminance = luminance(fg);
  const bgLuminance = luminance(bg);
  const high = Math.max(fgLuminance, bgLuminance);
  const low = Math.min(fgLuminance, bgLuminance);
  return (high + 0.05) / (low + 0.05);
}

async function pressWithoutNavigation(
  page: Page,
  target: Locator,
  metadata: Omit<
    PressMetric,
    | "before"
    | "active"
    | "focused"
    | "after"
    | "activeStateChanged"
    | "activeTextContrast"
    | "horizontalShiftPx"
    | "layoutShift"
    | "scrollStable"
    | "horizontalOverflow"
    | "failures"
  >,
): Promise<PressMetric> {
  await target.waitFor({ state: "visible" });
  await target.evaluate((element) => element.setAttribute("data-native-app-feel-probe", ""));
  await page.evaluate(() => {
    document.addEventListener(
      "click",
      (event) => {
        if ((event.target as Element | null)?.closest("[data-native-app-feel-probe]")) {
          event.preventDefault();
        }
      },
      { capture: true, once: true },
    );
  });
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  assert(box && viewport, `${metadata.control}: missing box or viewport`);
  const x = Math.min(Math.max(box.x + box.width / 2, 2), viewport.width - 2);
  const y = Math.min(Math.max(box.y + Math.min(box.height / 2, 20), 2), viewport.height - 2);
  const before = await readState(target);
  await page.mouse.move(x, y);
  await page.mouse.down();
  // WebKit applies :active synchronously but can defer the computed paint
  // value for controls inside momentum-scroll regions until the next frame.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const active = await readState(target);
  // Release outside the target after sampling the held frame. WebKit can
  // otherwise synthesize a delayed link click after preventDefault and race
  // the harness's next explicit navigation.
  const releaseX = box.x > viewport.width / 2 ? 2 : viewport.width - 2;
  const releaseY = box.y > viewport.height / 2 ? 2 : viewport.height - 2;
  await page.mouse.move(releaseX, releaseY);
  await page.mouse.up();
  await target.evaluate((element) => (element as HTMLElement).focus());
  const focused = await readState(target);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const after = await readState(target);
  const horizontalShiftPx = Math.max(
    Math.abs(active.rect.x - before.rect.x),
    Math.abs(focused.rect.x - before.rect.x),
    Math.abs(after.rect.x - before.rect.x),
  );
  // Pointer-down applies :focus and :active before click semantics run. Compare
  // that frame only: radio selection may intentionally change card content on
  // pointer-up, which is an application state change rather than press reflow.
  const layoutShift = !sameLayout(before, active);
  const scrollStable = [active, focused, after].every(
    (state) => state.scrollX === before.scrollX && state.scrollY === before.scrollY,
  );
  const activeStateChanged = activeChanged(before, active);
  const activeTextContrast =
    metadata.control === "PLAY DAILY"
      ? cssContrastRatio(active.css.color, active.css.backgroundColor)
      : null;
  const horizontalOverflow = before.documentWidth > before.viewportWidth;
  const failures = [
    [before, active, focused, after].some((state) => state.css.tapHighlight !== "rgba(0, 0, 0, 0)")
      ? `tap highlight=${before.css.tapHighlight}/${active.css.tapHighlight}/${focused.css.tapHighlight}/${after.css.tapHighlight}`
      : null,
    before.css.touchAction !== "manipulation" ? `touch-action=${before.css.touchAction}` : null,
    before.css.userSelect !== "none" ? `user-select=${before.css.userSelect}` : null,
    !activeStateChanged ? "no instantaneous active-state style" : null,
    active.css.opacity !== before.css.opacity
      ? `whole-element active opacity=${before.css.opacity}/${active.css.opacity}`
      : null,
    metadata.control === "PLAY DAILY" &&
    (active.css.opacity !== "1" || activeTextContrast === null || activeTextContrast < AA_BODY)
      ? `PLAY DAILY active contrast=${activeTextContrast?.toFixed(4) ?? "unresolved"} opacity=${active.css.opacity} color=${active.css.color} background=${active.css.backgroundColor}`
      : null,
    horizontalShiftPx > 0.01 ? `horizontal shift=${horizontalShiftPx.toFixed(3)}px` : null,
    layoutShift ? "layout metrics changed during press/focus" : null,
    !scrollStable
      ? `scroll changed ${before.scrollY}/${active.scrollY}/${focused.scrollY}/${after.scrollY}`
      : null,
    horizontalOverflow
      ? `${before.documentWidth.toString()}px document in ${before.viewportWidth.toString()}px viewport`
      : null,
  ].filter((failure): failure is string => failure !== null);
  return {
    ...metadata,
    before,
    active,
    focused,
    after,
    activeStateChanged,
    activeTextContrast,
    horizontalShiftPx,
    layoutShift,
    scrollStable,
    horizontalOverflow,
    failures,
  };
}

async function assertPageContracts(
  page: Page,
  viewport: (typeof viewports)[number],
  theme: (typeof themes)[number],
): Promise<PageContractMetric> {
  return await page.evaluate(
    ({ expectedHeight, viewportName, themeName }) => {
      const shell = document.querySelector<HTMLElement>(".shell");
      const prose = document.querySelector<HTMLElement>(".hero__sub");
      const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
      if (!shell || !prose || !viewport) {
        return {
          viewport: viewportName,
          theme: themeName,
          failures: ["missing shell, prose, or viewport meta"],
        };
      }
      const shellStyle = getComputedStyle(shell);
      const bodyStyle = getComputedStyle(document.body);
      const htmlStyle = getComputedStyle(document.documentElement);
      const selection = window.getSelection();
      const proseStyle = getComputedStyle(prose);
      const range = document.createRange();
      range.selectNodeContents(prose);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const selectedCharacters = selection?.toString().trim().length ?? 0;
      selection?.removeAllRanges();
      const content = viewport.content.toLowerCase();
      const failures = [
        Math.abs(Number.parseFloat(shellStyle.minHeight) - expectedHeight) > 0.01
          ? `shell min-height=${shellStyle.minHeight}`
          : null,
        shellStyle.overscrollBehavior !== "none"
          ? `shell overscroll=${shellStyle.overscrollBehavior}`
          : null,
        bodyStyle.overscrollBehavior !== "none"
          ? `body overscroll=${bodyStyle.overscrollBehavior}`
          : null,
        htmlStyle.overscrollBehavior !== "none"
          ? `html overscroll=${htmlStyle.overscrollBehavior}`
          : null,
        (proseStyle.getPropertyValue("user-select") ||
          proseStyle.getPropertyValue("-webkit-user-select")) === "none"
          ? "prose user-select is none"
          : null,
        selectedCharacters === 0 ? "prose range could not be selected" : null,
        content.includes("user-scalable=no") || content.includes("maximum-scale=1")
          ? `zoom disabled by viewport: ${viewport.content}`
          : null,
      ].filter((failure): failure is string => failure !== null);
      return { viewport: viewportName, theme: themeName, failures };
    },
    { expectedHeight: viewport.height, viewportName: viewport.name, themeName: theme },
  );
}

async function measureBoundaryOverscroll(
  browser: Browser,
  baseUrl: string,
  viewport: (typeof viewports)[number],
  theme: (typeof themes)[number],
): Promise<OverscrollMetric> {
  // Playwright rejects mouse.wheel in a mobile WebKit context. Exercise each
  // engine in a sibling context at the exact same CSS viewport instead; the
  // physical-iPhone residual remains explicit.
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    reducedMotion: "reduce",
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  try {
    await context.addInitScript((value) => localStorage.setItem("wcdraft:theme", value), theme);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Draft your/u }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, -600);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    return await page.evaluate(
      ({ viewportName, themeName, browserEngine }) => {
        const shell = document.querySelector<HTMLElement>(".shell");
        const metric = {
          viewport: viewportName,
          theme: themeName,
          input: `wheel boundary attempt in an exact-size ${browserEngine} context`,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          visualViewportOffsetTop: window.visualViewport?.offsetTop ?? 0,
          shellTop: shell?.getBoundingClientRect().top ?? 0,
        };
        const displaced =
          metric.scrollX !== 0 ||
          metric.scrollY !== 0 ||
          Math.abs(metric.visualViewportOffsetTop) > 0.01 ||
          Math.abs(metric.shellTop) > 0.01;
        return {
          ...metric,
          failure: displaced
            ? `boundary overscroll displaced viewport: ${JSON.stringify(metric)}`
            : null,
        };
      },
      { viewportName: viewport.name, themeName: theme, browserEngine },
    );
  } finally {
    await context.close();
  }
}

assert(
  browserEngine === "chromium" || browserEngine === "webkit",
  `unknown browser engine: ${browserEngine}`,
);
assert(serverMode === "dev" || serverMode === "production", `unknown server mode: ${serverMode}`);
const browserType: BrowserType = browserEngine === "webkit" ? webkit : chromium;
const server = baseUrlOverride
  ? { baseUrl: baseUrlOverride.replace(/\/$/u, ""), stop: async () => {} }
  : await startServer();
let browser: Browser | null = null;
const metrics: PressMetric[] = [];
const pageMetrics: PageContractMetric[] = [];
const overscrollMetrics: OverscrollMetric[] = [];
let launchedBrowserVersion: string;
try {
  browser = await browserType.launch({
    ...(browserEngine === "chromium"
      ? {
          channel:
            process.env.WCDRAFT_PLAYWRIGHT_CHANNEL === "chromium" ||
            !process.env.WCDRAFT_PLAYWRIGHT_CHANNEL
              ? undefined
              : process.env.WCDRAFT_PLAYWRIGHT_CHANNEL,
        }
      : {}),
    headless: true,
  });
  launchedBrowserVersion = browser.version();
  await mkdir(path.join(outDir, "screenshots"), { recursive: true });
  for (const viewport of viewports) {
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
        reducedMotion: "reduce",
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
      });
      await context.addInitScript((value) => localStorage.setItem("wcdraft:theme", value), theme);
      const page = await context.newPage();

      await page.goto(`${server.baseUrl}/`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: /Draft your/u }).waitFor();
      pageMetrics.push(await assertPageContracts(page, viewport, theme));
      await page.screenshot({
        path: path.join(outDir, "screenshots", `${phase}-home-${viewport.name}-${theme}.png`),
        fullPage: false,
      });
      metrics.push(
        await pressWithoutNavigation(page, page.getByRole("link", { name: "Play today's draft" }), {
          control: "PLAY DAILY",
          route: "/",
          viewport: viewport.name,
          theme,
        }),
      );

      await page.goto(`${server.baseUrl}/play`, { waitUntil: "networkidle" });
      const modeCards = page.getByRole("radio");
      await modeCards.first().waitFor();
      metrics.push(
        await pressWithoutNavigation(page, modeCards.first(), {
          control: "PLAY DAILY MODE CARD",
          route: "/play",
          viewport: viewport.name,
          theme,
        }),
      );
      metrics.push(
        await pressWithoutNavigation(page, modeCards.nth(1), {
          control: "START DRAFTING MODE CARD",
          route: "/play",
          viewport: viewport.name,
          theme,
        }),
      );

      await page.goto(`${server.baseUrl}/`, { waitUntil: "networkidle" });
      const menuToggle = page.getByRole("button", { name: "Open menu" });
      await menuToggle.waitFor();
      await menuToggle.click();
      const openMenu = page.locator("#mobile-menu:not([hidden])");
      const firstPressOpened = await openMenu
        .waitFor({ state: "visible", timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      if (!firstPressOpened) {
        // The pathname-closing effect can settle in the same frame as the
        // first hydration-time press. Re-press only after WebKit has had a
        // bounded paint window and the first press demonstrably did not win.
        await page.getByRole("button", { name: "Open menu" }).click();
      }
      await openMenu.waitFor();
      // The visible 01 index is intentionally part of the accessible name.
      const nav = page.locator("#mobile-menu").getByRole("link", { name: "Play" }).first();
      metrics.push(
        await pressWithoutNavigation(page, nav, {
          control: "MOBILE NAV PLAY",
          route: "/",
          viewport: viewport.name,
          theme,
        }),
      );
      await context.close();
      overscrollMetrics.push(
        await measureBoundaryOverscroll(browser, server.baseUrl, viewport, theme),
      );
    }
  }
} finally {
  try {
    await browser?.close();
  } finally {
    await server.stop();
  }
}

const failures = [
  ...pageMetrics.flatMap((metric) =>
    metric.failures.map((failure) => `${metric.viewport} ${metric.theme}: ${failure}`),
  ),
  ...overscrollMetrics.flatMap((metric) =>
    metric.failure === null ? [] : [`${metric.viewport} ${metric.theme}: ${metric.failure}`],
  ),
  ...metrics.flatMap((metric) => metric.failures),
];
const assertionCount =
  metrics.length * pressAssertionCount +
  pageMetrics.length * pageAssertionCount +
  overscrollMetrics.length * overscrollAssertionCount +
  metrics.filter((metric) => metric.activeTextContrast !== null).length;
const payload = {
  phase,
  browserEngine:
    browserEngine === "webkit"
      ? `WebKit ${launchedBrowserVersion} via Playwright (real WebKit engine; not a physical iPhone or Mobile Safari)`
      : `Chromium ${launchedBrowserVersion} via Playwright (mobile emulation, not Mobile Safari)`,
  target: baseUrlOverride ? "deployed URL" : `local Next ${serverMode}`,
  generatedAt: new Date().toISOString(),
  metrics,
  pageMetrics,
  overscrollMetrics,
  summary: {
    contexts: viewports.length * themes.length,
    presses: metrics.length,
    assertions: assertionCount,
    failures: failures.length,
  },
};
await writeFile(
  path.join(outDir, `native-app-feel-${phase}.json`),
  `${JSON.stringify(payload, null, 2)}\n`,
);
console.log(
  `native-app-feel: engine=${browserEngine} target=${payload.target} phase=${phase} contexts=${payload.summary.contexts.toString()} presses=${metrics.length.toString()} assertions=${assertionCount.toString()} failures=${failures.length.toString()} out=${outDir}`,
);
if (strict && failures.length > 0) {
  throw new Error(`native app-feel verification failed:\n${failures.join("\n")}`);
}
