import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getBuildStamp } from "../../build-stamp";

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

const css = readFileSync(
  fileURLToPath(new URL("../../../components/game/game.module.css", import.meta.url)),
  "utf8",
);

// The canonical lock-bar section (the later block wins the cascade over the
// shadowed legacy block earlier in the file).
const canonical = css.slice(css.indexOf("── In-shell lock bar"));

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

describe("build stamp", () => {
  it("renders short SHA + date when VERCEL_GIT_COMMIT_SHA is present", () => {
    const stamp = getBuildStamp({ VERCEL_GIT_COMMIT_SHA: "abcdef0123456789" });
    expect(stamp).toMatch(/^abcdef0 · \d{4}-\d{2}-\d{2}$/);
  });

  it("honest-state: renders 'dev' when the env var is absent", () => {
    expect(getBuildStamp({})).toBe("dev");
  });
});
