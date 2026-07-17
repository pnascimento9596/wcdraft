import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getBuildStamp } from "../../build-stamp";
import { readGameCssSource } from "./game-css-source";

/**
 * ws-ux/tap-stability-2 — CI-checkable contract for the iOS first-tap fix.
 *
 * CI cannot emulate Safari's toolbar collapse, so the on-device protocol in
 * the PR body owns the behavioural proof. What CI CAN pin down is the CSS
 * contract that makes the bar immovable: the canonical .lockBar block must
 * not be viewport-fixed, the anchored draft shell must trap scrolling in
 * .draftScroll, and the gesture-zone clearance padding must be present.
 * Source-level assertions are deliberate — a regression back to
 * `position: fixed` is a one-line diff this test must catch.
 */

const css = readGameCssSource();
const modeSelectSource = readFileSync(
  fileURLToPath(new URL("../../../components/game/mode-select.tsx", import.meta.url)),
  "utf8",
);
const responsiveHarnessSource = readFileSync(
  fileURLToPath(new URL("../../../scripts/verify-responsive-layout-browser.mts", import.meta.url)),
  "utf8",
);

// The canonical lock-bar section (the later block wins the cascade over the
// shadowed legacy block earlier in the file).
const canonical = css.slice(css.indexOf("── In-shell lock bar"));

function block(selector: string): string {
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{[^}]*\\}`);
  return re.exec(css)?.[0] ?? "";
}

describe("in-shell lock bar contract", () => {
  it("has a canonical in-shell lock bar section", () => {
    expect(canonical.length).toBeGreaterThan(0);
  });

  it("canonical .lockBar is not viewport-fixed", () => {
    const block = /\.lockBar \{[^}]*\}/.exec(canonical)?.[0];
    expect(block).toBeTruthy();
    expect(block).not.toContain("position: fixed");
    // sticky (in-flow in the anchored shell, visible-pinned as degradation)
    expect(block).toContain("position: sticky");
  });

  it("anchored draft layout pins the page column and hides the footer", () => {
    const globals = readFileSync(
      fileURLToPath(new URL("../../../app/globals.css", import.meta.url)),
      "utf8",
    );
    expect(globals).toContain("body:has([data-draft-anchored]) .shell");
    expect(globals).toContain("body:has([data-draft-anchored]) .site-footer");
  });

  it("canonical .lockBar keeps ≥12px gesture-zone clearance above the safe area", () => {
    const block = /\.lockBar \{[^}]*\}/.exec(canonical)?.[0] ?? "";
    expect(block).toContain("calc(12px + env(safe-area-inset-bottom, 0px))");
  });

  it("anchored shell traps scrolling inside .draftScroll", () => {
    const shell = /\.draftShell\.draftShellAnchored \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(shell).toContain("overflow: hidden");
    expect(shell).toContain("min-height: 0");
    const scroll = /\.draftScroll \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(scroll).toContain("overflow-y: auto");
    expect(scroll).toContain("overscroll-behavior: contain");
  });

  it("mobile compact tier keeps the 12px clearance", () => {
    // Every lockBar padding declaration anywhere in the file must carry the
    // 12px-over-safe-area floor (base, ≥640px row, ≤430px compact).
    const paddings = [...css.matchAll(/\.lockBar \{[^}]*?padding:([^;]*);/g)].map(
      (m) => m[1] ?? "",
    );
    expect(paddings.length).toBeGreaterThanOrEqual(2);
    for (const p of paddings) {
      if (p.includes("env(safe-area-inset-bottom")) {
        expect(p).toContain("calc(12px + env(safe-area-inset-bottom, 0px))");
      }
    }
  });
});

describe("mode-select sticky CTA contract", () => {
  it("keeps the mode dock above the scrollable cards", () => {
    const dock = block(".modeDock");
    expect(dock).toContain("position: sticky");
    expect(dock).toContain("z-index: 20");
    expect(dock).toContain("isolation: isolate");
    expect(dock).toContain("background: var(--s0)");
  });

  it("does not double-reserve the in-flow dock below the one-screen board", () => {
    const grid = block(".modeGridDaily");
    expect(grid).toContain("padding-block-end: 0");
    expect(grid).toContain("scroll-padding-block-end: 0");
    expect(grid).not.toContain("--mode-dock-reserve");
  });

  it("keeps taller Daily recovery docks in flow without a stale dock reserve", () => {
    const inFlowDock = block(".modeDockInFlow");
    const inFlowGrid = block(".modeGridDockInFlow");
    expect(inFlowDock).toContain("position: static");
    expect(inFlowGrid).toContain("padding-block-end: 0");
    expect(inFlowGrid).toContain("scroll-padding-block-end: 0");
    expect(modeSelectSource).toContain(
      'const dailyUnavailableSelected = mode === "daily" && dailyAvailability === "unavailable"',
    );
    expect(modeSelectSource).toContain(
      'dailyAvailability === "unavailable" || dailyAvailability === "timeout"',
    );
    expect(modeSelectSource).toContain('dailyRecoveryDockInFlow ? s.modeGridDockInFlow : ""');
    expect(modeSelectSource).toContain("${s.modeDock} ${s.modeDockInFlow}");
  });

  it("measures the two-action timeout recovery surface", () => {
    expect(responsiveHarnessSource).toContain('label: "mode-select-timeout"');
    expect(responsiveHarnessSource).toContain('name: "Retry Daily check"');
    expect(responsiveHarnessSource).toContain('name: "Play Classic instead"');
  });

  it("keeps the dock in flow on short landscape viewports", () => {
    const shortViewport = css.slice(css.indexOf("@media (max-height: 500px)"));
    expect(shortViewport).toContain(".modeDock");
    expect(shortViewport).toContain("position: static");
  });

  it("keeps the dock in flow on the retained 320px tier", () => {
    const narrowViewport = css.slice(css.indexOf("@media (max-width: 359px)"));
    expect(narrowViewport).toContain(".modeDock");
    expect(narrowViewport).toContain("position: static");
  });
});

describe("build stamp", () => {
  it("renders short SHA + date when VERCEL_GIT_COMMIT_SHA is present", () => {
    const stamp = getBuildStamp({ VERCEL_GIT_COMMIT_SHA: "abcdef0123456789" });
    expect(stamp).toMatch(/^abcdef0 · \d{4}-\d{2}-\d{2}$/);
  });

  it("honest-state: renders 'dev' when the env var is absent", () => {
    expect(getBuildStamp({})).toBe("dev");
  });
});
