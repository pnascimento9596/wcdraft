import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  LEGACY_SCREENSHOT_EVIDENCE,
  oneScreenDeviceCases,
  type OneScreenEngine,
} from "../../../scripts/one-screen-device-matrix";

const expectedViewports = [
  [320, 568],
  [360, 732],
  [390, 664],
  [430, 740],
  [667, 375],
  [768, 1024],
  [1024, 768],
  [1280, 720],
  [1366, 720],
] as const;
const verifierSource = readFileSync(
  new URL("../../../scripts/verify-home-fold-browser.mts", import.meta.url),
  "utf8",
);
const packageManifest = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };
const gameFlowSource = readFileSync(
  new URL("../../../scripts/game-flow-playwright.mts", import.meta.url),
  "utf8",
);

describe("one-screen descriptor matrix", () => {
  it.each(["chromium", "webkit"] satisfies readonly OneScreenEngine[])(
    "resolves real Playwright viewports for %s",
    (engine) => {
      const cases = oneScreenDeviceCases(engine);
      expect(
        cases.map((entry) => [entry.descriptor.viewport.width, entry.descriptor.viewport.height]),
      ).toEqual(expectedViewports);
      expect(cases).toHaveLength(9);
    },
  );

  it("uses engine-native desktop descriptors and discloses the only override", () => {
    const chromium = oneScreenDeviceCases("chromium");
    const webkit = oneScreenDeviceCases("webkit");

    expect(chromium[7]?.source).toBe("Desktop Chrome");
    expect(webkit[7]?.source).toBe("Desktop Safari");
    for (const cases of [chromium, webkit]) {
      expect(cases.filter((entry) => entry.delegatedDecision)).toHaveLength(1);
      expect(cases[8]?.delegatedDecision).toContain("no built-in 1366 descriptor");
      expect(cases[8]?.descriptor.viewport.height).toBe(cases[7]?.descriptor.viewport.height);
    }
  });

  it("keeps device-height screenshots out of the assertion matrix", () => {
    expect(LEGACY_SCREENSHOT_EVIDENCE).toEqual([
      { name: "360x800", width: 360, height: 800 },
      { name: "390x844", width: 390, height: 844 },
    ]);
    const assertionPairs = oneScreenDeviceCases("chromium").map(
      ({ descriptor }) =>
        `${descriptor.viewport.width.toString()}x${descriptor.viewport.height.toString()}`,
    );
    expect(assertionPairs).not.toContain("360x800");
    expect(assertionPairs).not.toContain("390x844");
  });

  it("strictly adjudicates full-document fit for both routes and engines", () => {
    expect(verifierSource).toContain('const routes: readonly RoutePath[] = ["/", "/play"]');
    expect(verifierSource).toContain('["chromium", chromium]');
    expect(verifierSource).toContain('["webkit", webkit]');
    expect(verifierSource).toContain("if (metric.scrollHeight > metric.innerHeight)");
    expect(verifierSource).toContain(
      'assertionScope: "document.documentElement.scrollHeight <= window.innerHeight"',
    );
    expect(verifierSource).not.toContain('name: "360x800"');
    expect(verifierSource).not.toContain('name: "390x844"');
  });

  it("uses semantic route readiness instead of a brittle global network-idle gate", () => {
    expect(verifierSource).toContain(
      'page.goto(pathname, { waitUntil: "domcontentloaded" })',
    );
    expect(verifierSource).not.toContain('waitUntil: "networkidle"');
    expect(verifierSource).toContain("assert(response.ok()");
    expect(verifierSource).toContain("await waitForRouteReady(page, pathname)");
    expect(verifierSource).toContain("await waitForInitialRouteMotion(page, pathname)");
    expect(verifierSource).toContain('window.location.pathname !== expectedPath');
    expect(verifierSource).toContain("routeReadySelectors[pathname]");
    expect(verifierSource).toContain('pathname === "/" ? ["main > *", ".reveal > *"]');
    expect(verifierSource).toContain('animation.playState !== "running"');
    expect(verifierSource).toContain("Number.parseFloat(style.opacity) <= 0.01");
    expect(verifierSource).toContain("Recycle at the device boundary");
    expect(verifierSource).toContain("const browser = await browserType.launch");
    expect(verifierSource).toContain("animations, timeout: screenshotTimeoutMs");
    expect(verifierSource).toContain("const screenshotTimeoutMs = 30_000");
  });

  it("rejects opacity-zero required content through any ancestor", () => {
    expect(verifierSource).toContain(
      "for (let current = element; current; current = current.parentElement)",
    );
    expect(verifierSource).toContain("Number.parseFloat(style.opacity) <= 0.01");
    expect(verifierSource).toContain("unpaintedRequiredContent");
    expect(verifierSource).toContain("required content is not painted");
  });

  it("rejects unstable reduced-motion screenshot paint", () => {
    expect(verifierSource).toContain("const compositorSettleMs = 1_500");
    expect(verifierSource).toContain("page.waitForTimeout(compositorSettleMs)");
    expect(verifierSource).toContain("page.waitForTimeout(500)");
    expect(verifierSource).toContain("screenshotPaintStable");
    expect(verifierSource).toContain("normalizedChangedSampleRatio(previous, current)");
    expect(verifierSource).toContain("const maxChangedSampleRatio = 0.005");
    expect(verifierSource).toContain(
      "reduced-motion screenshot did not reach a stable painted frame",
    );
    expect(verifierSource).toContain("Keep routes in separate browser contexts");
  });

  it("normalizes portable PNG evidence and rejects flat required regions", () => {
    expect(verifierSource).toContain("async function captureNormalizedPng");
    expect(verifierSource).toContain("assertCompletePng(normalized)");
    expect(verifierSource).toContain("normalized PNG contains data after IEND");
    expect(verifierSource).toContain("metadata.width === expectedWidth");
    expect(verifierSource).toContain("if (left.equals(right)) return 0");
    expect(verifierSource).toContain("requiredPaintRegions");
    expect(verifierSource).toContain("expectedPaintLabels");
    expect(verifierSource).toContain("missingRequiredPaintTargets");
    expect(verifierSource).toContain("required paint targets are missing");
    expect(verifierSource).toContain("screenshotPaintFailures");
    expect(verifierSource).toContain('element.setAttribute("data-wcdraft-paint-target", label)');
    expect(verifierSource).toContain("async function captureHiddenPaintBaseline");
    expect(verifierSource).toContain(
      "requestAnimationFrame(() => requestAnimationFrame(() => resolve()))",
    );
    expect(verifierSource).toContain(
      "await captureNormalizedPng(page, animations, expectedWidth, expectedHeight)",
    );
    expect(verifierSource).toContain("const [paintedCrop, hiddenCrop] = await Promise.all");
    expect(verifierSource).toContain(
      'const stats = await sharp(paintedCrop, { failOn: "warning" }).stats()',
    );
    expect(verifierSource).toContain("normalizedChangedSampleRatio(paintedCrop, hiddenCrop)");
    expect(verifierSource).toContain("const minTargetChangedSampleRatio = 0.002");
    expect(verifierSource).toContain("no semantic paint contribution");
    expect(verifierSource).toContain("screenshotPaintContributions");
    expect(verifierSource).toContain("stats.entropy < 0.5");
    expect(verifierSource).toContain("screenshot required regions are not painted");
  });

  it("runs the descriptor gate in the normal web test envelope", () => {
    expect(packageManifest.scripts.test).toContain("tsx scripts/verify-home-fold-browser.mts");
    expect(packageManifest.scripts["verify:one-screen"]).toBe(
      "tsx scripts/verify-home-fold-browser.mts",
    );
  });

  it("pairs committed client routes with semantic readiness checks", () => {
    const modeCtaCase = gameFlowSource.slice(
      gameFlowSource.indexOf(
        'await page.waitForURL((url) => url.pathname === "/play/draft"',
      ),
      gameFlowSource.indexOf(
        'await assertNoBrowserErrors(testCase, "mode-select CTA tap target")',
      ),
    );
    expect(modeCtaCase).toContain(
      'getByRole("heading", { name: "Lock a formation" }).waitFor()',
    );
    expect(gameFlowSource).toMatch(
      /waitForURL\(\/\\\/play\\\/draft\\\?run=\[\^&\]\+\$\/,[\s\S]*?waitUntil: "commit"/u,
    );
    expect(gameFlowSource).toContain(
      'getByRole("heading", { name: "Choose the slot to fill" }).waitFor()',
    );
    expect(gameFlowSource.match(/waitUntil: "commit"/gu)).toHaveLength(4);
    expect(gameFlowSource).toContain('getByText("Results").first().waitFor()');
    expect(gameFlowSource).toContain('getByRole("heading", { name: "The card" }).waitFor()');
  });
});
