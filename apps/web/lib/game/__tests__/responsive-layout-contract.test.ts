import { describe, expect, it } from "vitest";

import {
  INLINE_TEXT_LINK_ALLOWLIST,
  MIN_INTERACTION_TARGET_PX,
  responsiveMetricFailures,
  type ResponsiveMetricForAdjudication,
} from "../../../scripts/responsive-layout-contract";

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
    modeDockClearance: null,
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

  it("fails strict adjudication when the sticky mode dock covers the last mode card", () => {
    expect(responsiveMetricFailures(metric({ modeDockClearance: -18 }))).toEqual([
      "history 1024x768 light: mode dock overlaps last card by 18px",
    ]);
    expect(responsiveMetricFailures(metric({ modeDockClearance: 0 }))).toEqual([]);
    expect(
      responsiveMetricFailures(metric({ surface: "mode-select", modeDockClearance: null })),
    ).toEqual(["mode-select 1024x768 light: mode dock clearance unavailable"]);
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
});
