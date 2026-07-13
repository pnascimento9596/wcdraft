import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  INLINE_TEXT_LINK_ALLOWLIST,
  MIN_INTERACTION_TARGET_PX,
  responsiveMetricFailures,
  type ResponsiveMetricForAdjudication,
} from "../../../scripts/responsive-layout-contract";

const globalsCss = readFileSync(
  fileURLToPath(new URL("../../../app/globals.css", import.meta.url)),
  "utf8",
);
const responsiveHarness = readFileSync(
  fileURLToPath(new URL("../../../scripts/verify-responsive-layout-browser.mts", import.meta.url)),
  "utf8",
);
const sharedGameCss = readFileSync(
  fileURLToPath(new URL("../../../components/game/game-styles/shared.module.css", import.meta.url)),
  "utf8",
);

function metric(
  overrides: Partial<ResponsiveMetricForAdjudication> = {},
): ResponsiveMetricForAdjudication {
  return {
    surface: "history",
    viewport: "1024x768",
    theme: "light",
    shellRule: false,
    noScrollGate: "n-a",
    primaryActionInViewport: true,
    scrollHeight: 768,
    clientHeight: 768,
    maxScrollWidth: 1024,
    clientWidth: 1024,
    horizontalOverflow: false,
    modeDockInitialClearance: null,
    modeDockTerminalClearance: null,
    navWraps: [],
    smallTargets: [],
    axeViolations: [],
    consoleErrors: [],
    devOverlay: null,
    ...overrides,
  };
}

describe("responsive layout contract", () => {
  it("keeps the standalone target floor at 44px", () => {
    expect(MIN_INTERACTION_TARGET_PX).toBe(44);
    expect(responsiveMetricFailures(metric({ smallTargets: ["Copy full seed 115x36"] }))).toEqual([
      "history 1024x768 light: targets below 44px Copy full seed 115x36",
    ]);
  });

  it("applies and measures the 44px floor on opened mobile navigation links", () => {
    const mobileLinkRule = /\.mobile-menu__link \{[^}]*\}/u.exec(globalsCss)?.[0] ?? "";
    expect(mobileLinkRule).toContain("min-height: 44px");
    expect(responsiveHarness).toContain('label: "mobile-menu-open"');
    expect(responsiveHarness).toContain('waitForLoadState("networkidle")');
    expect(responsiveHarness).toContain('getByRole("button", { name: "Open menu" }).click()');
  });

  it("allowlists only prose links that remain in text flow", () => {
    expect(INLINE_TEXT_LINK_ALLOWLIST).toEqual([".prose p a[href]", ".prose li a[href]"]);
  });

  it("keeps target failures additive with the existing strict gates", () => {
    expect(
      responsiveMetricFailures(
        metric({
          horizontalOverflow: true,
          maxScrollWidth: 1026,
          smallTargets: ["Retry preview 96x36"],
          consoleErrors: ["CSP blocked inline style"],
        }),
      ),
    ).toEqual([
      "history 1024x768 light: horizontal overflow 1026/1024",
      "history 1024x768 light: targets below 44px Retry preview 96x36",
      "history 1024x768 light: console CSP blocked inline style",
    ]);
  });

  it("fails strict adjudication when the mode dock covers any card at either checkpoint", () => {
    expect(
      responsiveMetricFailures(
        metric({
          surface: "mode-select-unavailable",
          modeDockInitialClearance: -18,
          modeDockTerminalClearance: -4,
        }),
      ),
    ).toEqual([
      "mode-select-unavailable 1024x768 light: mode dock overlaps cards at initial paint by 18px",
      "mode-select-unavailable 1024x768 light: mode dock overlaps cards at terminal scroll by 4px",
    ]);
    expect(
      responsiveMetricFailures(
        metric({
          surface: "mode-select-available",
          modeDockInitialClearance: 0,
          modeDockTerminalClearance: 0,
        }),
      ),
    ).toEqual([]);
    expect(
      responsiveMetricFailures(
        metric({
          surface: "mode-select-checking",
          modeDockInitialClearance: null,
          modeDockTerminalClearance: null,
        }),
      ),
    ).toEqual([
      "mode-select-checking 1024x768 light: mode dock initial clearance unavailable",
      "mode-select-checking 1024x768 light: mode dock terminal clearance unavailable",
    ]);
  });

  it("uses the DOM nonce property when CSP hides the nonce attribute", () => {
    expect(
      responsiveMetricFailures(
        metric({
          devOverlay: {
            suppression: "enabled",
            nonceAttributeLength: 0,
            noncePropertyLength: 22,
            nonceSource: "property",
            styleNonceMatches: true,
            styleSheetAttached: true,
            portalState: "hidden",
            visibleControlCount: 0,
          },
        }),
      ),
    ).toEqual([]);
  });

  it("fails strict adjudication when dev-overlay suppression is only attempted", () => {
    expect(
      responsiveMetricFailures(
        metric({
          devOverlay: {
            suppression: "enabled",
            nonceAttributeLength: 0,
            noncePropertyLength: 0,
            nonceSource: "missing",
            styleNonceMatches: false,
            styleSheetAttached: false,
            portalState: "visible",
            visibleControlCount: 1,
          },
        }),
      ),
    ).toEqual([
      "history 1024x768 light: dev overlay suppression failed (request nonce property missing, style nonce mismatch, style sheet rejected, Next portal visible, 1 dev-tools controls visible; attribute nonce length=0, property nonce length=0)",
    ]);
  });

  it("rejects a dev diagnostic opt-out even when no overlay geometry is visible", () => {
    expect(
      responsiveMetricFailures(
        metric({
          devOverlay: {
            suppression: "disabled",
            nonceAttributeLength: 0,
            noncePropertyLength: 22,
            nonceSource: "property",
            styleNonceMatches: false,
            styleSheetAttached: false,
            portalState: "absent",
            visibleControlCount: 0,
          },
        }),
      ),
    ).toEqual([
      "history 1024x768 light: dev overlay suppression failed (suppression disabled; attribute nonce length=0, property nonce length=22)",
    ]);
  });

  it("keeps null as the valid non-dev overlay sentinel", () => {
    expect(responsiveMetricFailures(metric({ devOverlay: null }))).toEqual([]);
  });

  it("reserves the compact mode pill track without narrowing the title below it", () => {
    const compactTopRule =
      /\.modeCard:not\(\.modeCardFeatured\) \.modeCardTop \{[^}]*\}/u.exec(sharedGameCss)?.[0] ??
      "";
    const compactTagRule =
      /\.modeCard:not\(\.modeCardFeatured\) \.modeTag \{[^}]*\}/u.exec(sharedGameCss)?.[0] ?? "";

    expect(compactTopRule).toContain("padding-right: 0");
    expect(compactTagRule).toContain("max-width: calc(100% - 40px)");
  });
});
