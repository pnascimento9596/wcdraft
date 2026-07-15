import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
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
  createDraft,
  isDraftComplete,
  stepDraft,
  type DraftMode,
  type DraftState,
} from "@wcdraft/core";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";

import { buildGameDataFromBundles } from "../lib/game/__tests__/run-token.test-harness";
import {
  RUN_INDEX_KEY,
  RUN_RECORD_PREFIX,
  RUN_RECORD_SCHEMA_VERSION,
  type RunRecordV1,
} from "../lib/game/run-record";
import { runSimulationSync } from "../lib/game/simulate";

type Theme = "light" | "dark";
type Variant = "before" | "after" | string;
type ViewportCase = { name: string; width: number; height: number };
type SurfaceMetric = {
  label: string;
  route: string;
  viewport: string;
  theme: Theme;
  scrollHeight: number;
  clientHeight: number;
  scrollRatio: number;
  scrollWidth: number;
  clientWidth: number;
  horizontalOverflow: boolean;
  uniqueFontFamilies: string[];
  nonArchivoFamilies: string[];
  numericSampleCount: number;
  numericTabularSampleCount: number;
  uppercaseSampleCount: number;
  uppercaseRoleSampleCount: number;
  uppercaseRoleViolations: string[];
  axeViolations: string[];
};
type TargetMetric = {
  control: string;
  surface: string;
  viewport: string;
  theme: Theme;
  width: number;
  height: number;
  x: number;
  y: number;
  pass: boolean;
  thumbReachable: boolean | null;
  notes: string;
};
type Report = {
  variant: Variant;
  strict: boolean;
  baseUrl: string;
  generatedAt: string;
  viewports: ViewportCase[];
  themes: Theme[];
  surfaces: SurfaceMetric[];
  targets: TargetMetric[];
  failures: string[];
};

const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(appRoot, "..", "..");
const nextBin = require.resolve("next/dist/bin/next");
const host = "127.0.0.1";
const variant: Variant = process.env.WCDRAFT_FONT_AUDIT_VARIANT ?? "after";
const strict = process.env.WCDRAFT_FONT_AUDIT_STRICT === "1";
const outPath =
  process.env.WCDRAFT_FONT_AUDIT_OUT ??
  path.join(repoRoot, "docs", "reports", "font-consolidation-2026-07-03", `${variant}.json`);
const axeCdn = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";
const gameData = buildGameDataFromBundles();

const viewports: ViewportCase[] = [
  { name: "390x844", width: 390, height: 844 },
  { name: "360x800", width: 360, height: 800 },
];
const themes: Theme[] = ["light", "dark"];
const axeSource = await fetch(axeCdn).then((res) => {
  if (!res.ok) throw new Error(`failed to fetch axe-core: HTTP ${res.status}`);
  return res.text();
});

function shouldIgnoreConsoleError(text: string): boolean {
  return (
    text.startsWith("Failed to load resource:") ||
    text.includes("Encountered a script tag while rendering React component")
  );
}

function shouldIgnoreResponseStatus(pathname: string): boolean {
  return (
    pathname === "/api/auth/csrf" ||
    pathname === "/api/runs" ||
    pathname === "/api/og/sign" ||
    pathname === "/api/account" ||
    pathname === "/api/leaderboard" ||
    pathname.startsWith("/api/leaderboard/")
  );
}

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

async function startNextDev(): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  if (process.env.BASE_URL) {
    return { baseUrl: process.env.BASE_URL, stop: async () => {} };
  }
  const port = await findFreePort();
  const baseUrl = `http://${host}:${port}`;
  const proc = spawn(
    process.execPath,
    [nextBin, "dev", "--webpack", "--hostname", host, "--port", String(port)],
    {
      cwd: appRoot,
      env: { ...process.env, LEADERBOARD_ENABLED: "1", NEXT_TELEMETRY_DISABLED: "1" },
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
    throw new Error(`${err instanceof Error ? err.message : String(err)}\n\n${logs}`);
  });
  return {
    baseUrl,
    stop: async () => {
      await stopProcess(proc);
    },
  };
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

function makeDraft(runId: string, mode: DraftMode): DraftState {
  return createDraft(gameData.catalog, {
    run_id: runId,
    parent_seed: `wcdraft:font-proof:${runId}`,
    formation_id: "4-3-3",
    mode,
    team_name: "Font Proof XI",
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
  });
}

function completeDraft(mode: DraftMode): DraftState {
  let draft = makeDraft(`font-${mode}-complete`, mode);
  while (!isDraftComplete(draft)) draft = stepDraft(gameData.catalog, draft);
  return draft;
}

function recordForDraft(draft: DraftState, status: RunRecordV1["status"] = "ready"): RunRecordV1 {
  return {
    record_version: RUN_RECORD_SCHEMA_VERSION,
    run_id: draft.run_id,
    parent_seed: `wcdraft:font-proof:${draft.run_id}`,
    created_seq: 1,
    updated_seq: 1,
    versions: gameData.versions,
    draft,
    status,
  };
}

function completeRecord(mode: DraftMode = "classic"): RunRecordV1 {
  const draft = completeDraft(mode);
  const base = recordForDraft(draft, "complete");
  const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, base);
  return { ...base, simulation };
}

async function newAuditedPage(
  browser: Browser,
  viewport: ViewportCase,
  theme: Theme,
  records: RunRecordV1[] = [],
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
    ({ selectedTheme, recs, recordPrefix, indexKey, schemaVersion }) => {
      window.localStorage.clear();
      window.localStorage.setItem("wcdraft:theme", selectedTheme);
      if (recs.length === 0) return;
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
        window.localStorage.setItem(`${recordPrefix}${record.run_id}`, JSON.stringify(record));
      }
      window.localStorage.setItem("wcdraft:run-counter:v1", String(recs.length));
    },
    {
      selectedTheme: theme,
      recs: records,
      recordPrefix: RUN_RECORD_PREFIX,
      indexKey: RUN_INDEX_KEY,
      schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    },
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !shouldIgnoreConsoleError(text)) {
      errors.push(text);
    }
  });
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const pathname = new URL(response.url()).pathname;
    if (shouldIgnoreResponseStatus(pathname)) return;
    errors.push(`${response.status()} ${pathname}`);
  });
  return { context, page, errors };
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(async () => {
    if ("fonts" in document) await document.fonts.ready;
  });
  await page.waitForTimeout(250);
}

async function runAxe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: axeSource });
  return await page.evaluate(async () => {
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
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    });
    return result.violations.map((v) => v.id);
  });
}

function isArchivoFamily(family: string): boolean {
  const normalized = family.toLowerCase();
  return normalized.includes("archivo");
}

async function measureSurface(
  page: Page,
  label: string,
  route: string,
  viewport: ViewportCase,
  theme: Theme,
): Promise<SurfaceMetric> {
  const axeViolations = await runAxe(page);
  const metric = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const visible = Array.from(
      document.querySelectorAll<HTMLElement | SVGElement>("body *"),
    ).filter((el) => {
      const box = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none"
      );
    });
    const families = Array.from(
      new Set(visible.map((el) => window.getComputedStyle(el).fontFamily)),
    ).sort();
    const numeric = visible.filter((el) => /\d/.test(el.textContent ?? "")).slice(0, 50);
    const numericTabular = numeric.filter((el) => {
      const style = window.getComputedStyle(el);
      return (
        style.fontVariantNumeric.includes("tabular-nums") ||
        style.fontFeatureSettings.toLowerCase().includes("tnum")
      );
    });
    const uppercase = visible.flatMap((el) => {
      const ownText = Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();
      const style = window.getComputedStyle(el);
      if (!/[A-Za-z]/u.test(ownText) || style.textTransform !== "uppercase") return [];
      const fontSize = Number.parseFloat(style.fontSize);
      const trackingPx =
        style.letterSpacing === "normal" ? 0 : Number.parseFloat(style.letterSpacing);
      const trackingEm = Number.isFinite(fontSize) && fontSize > 0 ? trackingPx / fontSize : NaN;
      const weight = Number.parseInt(style.fontWeight, 10);
      const rolePairs = [
        [900, -0.035],
        [800, -0.02],
        [500, 0.1],
        [800, 0.02],
      ] as const;
      const roleMatch = rolePairs.some(
        ([roleWeight, roleTracking]) =>
          weight === roleWeight && Math.abs(trackingEm - roleTracking) <= 0.002,
      );
      const className =
        typeof el.className === "string"
          ? el.className
          : el.className instanceof SVGAnimatedString
            ? el.className.baseVal
            : "";
      return [
        {
          node: el.tagName.toLowerCase(),
          className,
          text: ownText.slice(0, 80),
          weight,
          trackingEm: Number(trackingEm.toFixed(4)),
          roleMatch,
        },
      ];
    });
    const displayRoleViolations = visible.flatMap((el) => {
      if (!(el instanceof HTMLElement) || !el.classList.contains("display")) return [];
      const style = window.getComputedStyle(el);
      const fontSize = Number.parseFloat(style.fontSize);
      const trackingPx =
        style.letterSpacing === "normal" ? 0 : Number.parseFloat(style.letterSpacing);
      const trackingEm = Number.isFinite(fontSize) && fontSize > 0 ? trackingPx / fontSize : NaN;
      const weight = Number.parseInt(style.fontWeight, 10);
      if (weight === 900 && Math.abs(trackingEm + 0.035) <= 0.002) return [];
      return [
        `display ${el.tagName.toLowerCase()}.${Array.from(el.classList).join(".")} ${weight.toString()}/${trackingEm.toFixed(4)}em`,
      ];
    });
    const scrollHeight = Math.max(doc.scrollHeight, body.scrollHeight);
    const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    return {
      scrollHeight,
      clientHeight: doc.clientHeight,
      scrollWidth,
      clientWidth: doc.clientWidth,
      uniqueFontFamilies: families,
      numericSampleCount: numeric.length,
      numericTabularSampleCount: numericTabular.length,
      uppercaseSampleCount: uppercase.length,
      uppercaseRoleSampleCount: uppercase.filter(({ roleMatch }) => roleMatch).length,
      uppercaseRoleViolations: [
        ...uppercase
          .filter(({ roleMatch }) => !roleMatch)
          .map(
            ({ node, className, text, weight, trackingEm }) =>
              `${node}${className ? `.${className.trim().replace(/\s+/gu, ".")}` : ""} ${weight.toString()}/${trackingEm.toFixed(4)}em ${JSON.stringify(text)}`,
          ),
        ...displayRoleViolations,
      ],
    };
  });
  return {
    label,
    route,
    viewport: viewport.name,
    theme,
    ...metric,
    scrollRatio: Number((metric.scrollHeight / metric.clientHeight).toFixed(3)),
    horizontalOverflow: metric.scrollWidth > metric.clientWidth + 1,
    nonArchivoFamilies: metric.uniqueFontFamilies.filter((family) => !isArchivoFamily(family)),
    axeViolations,
  };
}

async function measureTarget(
  locator: Locator,
  control: string,
  surface: string,
  viewport: ViewportCase,
  theme: Theme,
  opts: { thumbPrimary?: boolean; notes?: string } = {},
): Promise<TargetMetric> {
  const first = locator.first();
  await first.waitFor({ state: "visible", timeout: 15_000 });
  const box = await first.boundingBox();
  assert(box, `missing bounding box for ${control}`);
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  const centerY = box.y + box.height / 2;
  return {
    control,
    surface,
    viewport: viewport.name,
    theme,
    width,
    height,
    x: Math.round(box.x),
    y: Math.round(box.y),
    pass: width >= 44 && height >= 44,
    thumbReachable: opts.thumbPrimary ? centerY >= viewport.height * 0.45 : null,
    notes: opts.notes ?? "",
  };
}

async function validateShareSvgExport(page: Page): Promise<string | null> {
  await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).some(
          (candidate) =>
            /download card/i.test(candidate.textContent ?? "") &&
            candidate instanceof HTMLButtonElement &&
            !candidate.disabled,
        ),
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => null);

  return await page.evaluate(async () => {
    const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
      /download card/i.test(candidate.textContent ?? ""),
    );
    if (!(button instanceof HTMLButtonElement)) return "share export: missing Download card button";
    if (button.disabled) return "share export: Download card button stayed disabled";

    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
    let capturedBlob: Blob | null = null;
    let capturedUrl: string | null = null;

    URL.createObjectURL = ((value: Blob | MediaSource) => {
      if (value instanceof Blob) capturedBlob = value;
      capturedUrl = originalCreateObjectUrl(value);
      return capturedUrl;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => {
      if (url !== capturedUrl) originalRevokeObjectUrl(url);
    }) as typeof URL.revokeObjectURL;

    try {
      button.click();
      for (let i = 0; i < 300 && capturedBlob === null; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
      if (capturedUrl) originalRevokeObjectUrl(capturedUrl);
    }

    if (capturedBlob === null) return "share export: no SVG blob captured";
    const xml = await capturedBlob.text();
    if (!xml.includes("Archivo")) return "share export: missing Archivo contract";
    if (!xml.includes("--font-family")) return "share export: missing font-family token";
    if (!xml.includes("data:font/woff2;base64,")) {
      return "share export: missing embedded Archivo font data";
    }
    const monoFamilyLeak = new RegExp(
      [
        "Space " + "Mono",
        "Space" + "Mono",
        "space-" + "mono",
        "ui-" + "mono" + "space",
        "mono" + "space",
      ].join("|"),
    );
    if (monoFamilyLeak.test(xml)) {
      return "share export: leaked mono font reference";
    }
    return null;
  });
}

async function auditStaticSurface(
  browser: Browser,
  baseUrl: string,
  viewport: ViewportCase,
  theme: Theme,
  route: string,
  label: string,
  records: RunRecordV1[] = [],
): Promise<{ surfaces: SurfaceMetric[]; targets: TargetMetric[]; errors: string[] }> {
  const { context, page, errors } = await newAuditedPage(browser, viewport, theme, records);
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const surfaces = [await measureSurface(page, label, route, viewport, theme)];
  const targets: TargetMetric[] = [];
  if (label === "mode select") {
    targets.push(
      await measureTarget(page.getByRole("radio").first(), "mode card CTA", label, viewport, theme),
    );
    targets.push(
      await measureTarget(
        page.getByRole("button", { name: /Play daily/i }),
        "daily play CTA",
        label,
        viewport,
        theme,
        {
          thumbPrimary: true,
        },
      ),
    );
  }
  if (label === "setup") {
    targets.push(
      await measureTarget(
        page.locator("button", { hasText: /^4-3-3/ }),
        "formation card",
        label,
        viewport,
        theme,
      ),
    );
    targets.push(
      await measureTarget(
        page.getByRole("button", { name: /Lock 4-3-3 & spin/i }),
        "formation lock",
        label,
        viewport,
        theme,
        {
          thumbPrimary: true,
        },
      ),
    );
  }
  if (label === "share") {
    const copyCaption = page.getByRole("button", { name: /Copy caption/i });
    if ((await copyCaption.count()) > 0) {
      targets.push(await measureTarget(copyCaption, "Copy caption", label, viewport, theme));
    }
    const copyLink = page.getByRole("button", { name: /Copy (share )?link/i });
    if ((await copyLink.count()) > 0) {
      targets.push(await measureTarget(copyLink, "Copy link", label, viewport, theme));
    }
    const exportError = await validateShareSvgExport(page);
    if (exportError) errors.push(exportError);
  }
  await context.close();
  return { surfaces, targets, errors };
}

async function auditClassicDraftFlow(
  browser: Browser,
  baseUrl: string,
  viewport: ViewportCase,
  theme: Theme,
): Promise<{ surfaces: SurfaceMetric[]; targets: TargetMetric[]; errors: string[] }> {
  const spin = recordForDraft(makeDraft("font-classic-spin", "classic"));
  const { context, page, errors } = await newAuditedPage(browser, viewport, theme, [spin]);
  const surfaces: SurfaceMetric[] = [];
  const targets: TargetMetric[] = [];
  await page.goto(`${baseUrl}/play/draft?run=${spin.run_id}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  surfaces.push(await measureSurface(page, "spin", "/play/draft", viewport, theme));
  targets.push(
    await measureTarget(
      page.getByRole("button", { name: /^Spin$/i }),
      "SPIN",
      "spin",
      viewport,
      theme,
      {
        thumbPrimary: true,
      },
    ),
  );
  await page.getByRole("button", { name: /^Spin$/i }).click();
  await page.getByRole("button", { name: /Reveal choices/i }).click();
  await page.locator('section[aria-label="Candidates"]').waitFor();
  await settle(page);
  surfaces.push(await measureSurface(page, "classic pick", "/play/draft", viewport, theme));
  const candidates = page.locator('section[aria-label="Candidates"] button[aria-pressed]');
  targets.push(
    await measureTarget(
      candidates.first(),
      "choose-from-3 candidate card",
      "classic pick",
      viewport,
      theme,
    ),
  );
  await candidates.first().click();
  targets.push(
    await measureTarget(
      page.getByRole("button", { name: /Lock pick/i }),
      "lock pick",
      "classic pick",
      viewport,
      theme,
      {
        thumbPrimary: true,
      },
    ),
  );
  await context.close();
  return { surfaces, targets, errors };
}

async function auditOpenDraftFlow(
  browser: Browser,
  baseUrl: string,
  viewport: ViewportCase,
  theme: Theme,
  mode: Extract<DraftMode, "open" | "open_hidden">,
): Promise<{ surfaces: SurfaceMetric[]; targets: TargetMetric[]; errors: string[] }> {
  const record = recordForDraft(makeDraft(`font-${mode}-spin`, mode));
  const { context, page, errors } = await newAuditedPage(browser, viewport, theme, [record]);
  await page.goto(`${baseUrl}/play/draft?run=${record.run_id}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByRole("button", { name: /^Spin$/i }).click();
  await page.getByRole("button", { name: /Reveal choices/i }).click();
  await page.locator('section[aria-label="Candidates"]').waitFor();
  await settle(page);
  const label = mode === "open" ? "open roster" : "blind-open roster";
  const surfaces = [await measureSurface(page, label, "/play/draft", viewport, theme)];
  const targets = [
    await measureTarget(
      page.locator('section[aria-label="Candidates"] button[aria-pressed]').first(),
      mode === "open" ? "Open roster row pick" : "Blind Open roster row pick",
      label,
      viewport,
      theme,
    ),
  ];
  await context.close();
  return { surfaces, targets, errors };
}

async function auditAll(baseUrl: string): Promise<Report> {
  const completed = completeRecord("classic");
  const browser = await chromium.launch();
  const report: Report = {
    variant,
    strict,
    baseUrl,
    generatedAt: new Date().toISOString(),
    viewports,
    themes,
    surfaces: [],
    targets: [],
    failures: [],
  };
  try {
    for (const viewport of viewports) {
      for (const theme of themes) {
        const runs = [
          await auditStaticSurface(browser, baseUrl, viewport, theme, "/", "home"),
          await auditStaticSurface(browser, baseUrl, viewport, theme, "/play", "mode select"),
          await auditStaticSurface(browser, baseUrl, viewport, theme, "/sign-in", "sign-in"),
          await auditStaticSurface(browser, baseUrl, viewport, theme, "/play/draft", "setup"),
          await auditClassicDraftFlow(browser, baseUrl, viewport, theme),
          await auditOpenDraftFlow(browser, baseUrl, viewport, theme, "open"),
          await auditOpenDraftFlow(browser, baseUrl, viewport, theme, "open_hidden"),
          await auditStaticSurface(
            browser,
            baseUrl,
            viewport,
            theme,
            `/play/review?run=${completed.run_id}`,
            "squad review",
            [completed],
          ),
          await auditStaticSurface(
            browser,
            baseUrl,
            viewport,
            theme,
            `/play/results?run=${completed.run_id}`,
            "results",
            [completed],
          ),
          await auditStaticSurface(
            browser,
            baseUrl,
            viewport,
            theme,
            `/play/share?run=${completed.run_id}`,
            "share",
            [completed],
          ),
          await auditStaticSurface(
            browser,
            baseUrl,
            viewport,
            theme,
            "/leaderboard",
            "leaderboard",
          ),
          await auditStaticSurface(browser, baseUrl, viewport, theme, "/account", "account"),
          await auditStaticSurface(
            browser,
            baseUrl,
            viewport,
            theme,
            "/how-to-play",
            "How-to-Play",
          ),
        ];
        for (const run of runs) {
          report.surfaces.push(...run.surfaces);
          report.targets.push(...run.targets);
          if (run.errors.length > 0) {
            report.failures.push(
              `${viewport.name} ${theme} browser errors: ${run.errors.join(" | ")}`,
            );
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  for (const surface of report.surfaces) {
    if (surface.horizontalOverflow) {
      report.failures.push(
        `${surface.label} ${surface.viewport} ${surface.theme}: horizontal overflow`,
      );
    }
    if (surface.axeViolations.length > 0) {
      report.failures.push(
        `${surface.label} ${surface.viewport} ${surface.theme}: axe ${surface.axeViolations.join(",")}`,
      );
    }
    if (strict && surface.nonArchivoFamilies.length > 0) {
      report.failures.push(
        `${surface.label} ${surface.viewport} ${surface.theme}: non-Archivo families ${surface.nonArchivoFamilies.join(" | ")}`,
      );
    }
    if (strict && surface.numericSampleCount > 0 && surface.numericTabularSampleCount === 0) {
      report.failures.push(
        `${surface.label} ${surface.viewport} ${surface.theme}: no tabular numeric sample`,
      );
    }
    if (strict && surface.uppercaseRoleViolations.length > 0) {
      report.failures.push(
        `${surface.label} ${surface.viewport} ${surface.theme}: Terrace roles ${surface.uppercaseRoleViolations.join(" | ")}`,
      );
    }
    const coreNoScroll = ["spin", "classic pick"].includes(surface.label);
    if (strict && coreNoScroll && surface.scrollHeight > surface.clientHeight + 2) {
      report.failures.push(
        `${surface.label} ${surface.viewport} ${surface.theme}: scroll shell ${surface.scrollHeight}/${surface.clientHeight}`,
      );
    }
  }
  for (const target of report.targets) {
    if (!target.pass) {
      report.failures.push(
        `${target.control} ${target.viewport} ${target.theme}: ${target.width}x${target.height}`,
      );
    }
    if (strict && target.thumbReachable === false) {
      report.failures.push(
        `${target.control} ${target.viewport} ${target.theme}: not thumb reachable`,
      );
    }
  }
  return report;
}

const server = await startNextDev();
try {
  const report = await auditAll(server.baseUrl);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[font-audit] wrote ${outPath}`);
  console.log(`[font-audit] surfaces=${report.surfaces.length} targets=${report.targets.length}`);
  if (report.failures.length > 0) {
    console.error(report.failures.map((failure) => ` - ${failure}`).join("\n"));
    if (strict) process.exitCode = 1;
  }
} finally {
  await server.stop();
}
