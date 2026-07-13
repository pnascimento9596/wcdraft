import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";

const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const nextEnvPath = path.join(appRoot, "next-env.d.ts");
const nextBin = require.resolve("next/dist/bin/next");
const host = "127.0.0.1";
const phase = process.env.WCDRAFT_NATIVE_APP_FEEL_PHASE ?? "after";
const strict = process.env.WCDRAFT_NATIVE_APP_FEEL_STRICT === "1";
const outDir =
  process.env.WCDRAFT_NATIVE_APP_FEEL_OUT_DIR ??
  path.join(repoRoot, "docs/reports/native-app-feel-r3", phase);

const viewports = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x800", width: 360, height: 800 },
] as const;
const themes = ["light", "dark"] as const;

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
    readonly filter: string;
    readonly opacity: string;
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
  readonly horizontalShiftPx: number;
  readonly layoutShift: boolean;
  readonly scrollStable: boolean;
  readonly horizontalOverflow: boolean;
  readonly failures: readonly string[];
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
  const port = await findFreePort();
  const baseUrl = `http://${host}:${port.toString()}`;
  const nextEnv = await readFile(nextEnvPath).catch(() => null);
  const proc = spawn(
    process.execPath,
    [nextBin, "dev", "--webpack", "--hostname", host, "--port", port.toString()],
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
        throw new Error(`Next dev exited ${proc.exitCode.toString()}\n${logs}`);
      try {
        const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) });
        if (response.status < 500) break;
      } catch {
        // Keep polling until the bounded deadline.
      }
      await delay(500);
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for Next dev\n${logs}`);
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
        userSelect: style.userSelect,
        transform: style.transform,
        filter: style.filter,
        opacity: style.opacity,
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
    before.css.transform !== active.css.transform ||
    before.css.filter !== active.css.filter ||
    before.css.opacity !== active.css.opacity ||
    before.css.backgroundColor !== active.css.backgroundColor
  );
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
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const active = await readState(target);
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
  const horizontalOverflow = before.documentWidth > before.viewportWidth;
  const failures = [
    before.css.tapHighlight !== "rgba(0, 0, 0, 0)"
      ? `tap highlight=${before.css.tapHighlight}`
      : null,
    before.css.touchAction !== "manipulation" ? `touch-action=${before.css.touchAction}` : null,
    before.css.userSelect !== "none" ? `user-select=${before.css.userSelect}` : null,
    !activeStateChanged ? "no instantaneous active-state style" : null,
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
    horizontalShiftPx,
    layoutShift,
    scrollStable,
    horizontalOverflow,
    failures,
  };
}

async function assertPageContracts(page: Page, viewportHeight: number): Promise<readonly string[]> {
  return await page.evaluate((expectedHeight) => {
    const shell = document.querySelector<HTMLElement>(".shell");
    const prose = document.querySelector<HTMLElement>(".hero__sub");
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!shell || !prose || !viewport) return ["missing shell, prose, or viewport meta"];
    const shellStyle = getComputedStyle(shell);
    const bodyStyle = getComputedStyle(document.body);
    const htmlStyle = getComputedStyle(document.documentElement);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(prose);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const selectedCharacters = selection?.toString().trim().length ?? 0;
    selection?.removeAllRanges();
    const content = viewport.content.toLowerCase();
    return [
      shellStyle.minHeight !== `${expectedHeight.toString()}px`
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
      getComputedStyle(prose).userSelect === "none" ? "prose user-select is none" : null,
      selectedCharacters === 0 ? "prose range could not be selected" : null,
      content.includes("user-scalable=no") || content.includes("maximum-scale=1")
        ? `zoom disabled by viewport: ${viewport.content}`
        : null,
    ].filter((failure): failure is string => failure !== null);
  }, viewportHeight);
}

const server = await startServer();
let browser: Browser | null = null;
const metrics: PressMetric[] = [];
const pageFailures: string[] = [];
try {
  browser = await chromium.launch({
    channel: process.env.WCDRAFT_PLAYWRIGHT_CHANNEL ?? "chrome",
    headless: true,
  });
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
      pageFailures.push(
        ...(await assertPageContracts(page, viewport.height)).map(
          (failure) => `${viewport.name} ${theme}: ${failure}`,
        ),
      );
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
      if (!(await openMenu.isVisible())) {
        // The pathname-closing effect can settle in the same frame as the
        // first hydration-time press. Re-press only when it demonstrably won.
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
    }
  }
} finally {
  try {
    await browser?.close();
  } finally {
    await server.stop();
  }
}

const failures = [...pageFailures, ...metrics.flatMap((metric) => metric.failures)];
const payload = {
  phase,
  browserEngine: "Chromium via Playwright (mobile emulation, not Mobile Safari)",
  generatedAt: new Date().toISOString(),
  metrics,
  pageFailures,
  summary: {
    contexts: viewports.length * themes.length,
    presses: metrics.length,
    failures: failures.length,
  },
};
await writeFile(
  path.join(outDir, `native-app-feel-${phase}.json`),
  `${JSON.stringify(payload, null, 2)}\n`,
);
console.log(
  `native-app-feel: phase=${phase} contexts=${payload.summary.contexts.toString()} presses=${metrics.length.toString()} failures=${failures.length.toString()} out=${outDir}`,
);
if (strict && failures.length > 0) {
  throw new Error(`native app-feel verification failed:\n${failures.join("\n")}`);
}
