import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import {
  INLINE_TEXT_LINK_ALLOWLIST,
  MIN_INTERACTION_TARGET_PX,
  NARROW_COLLISION_ALLOWLIST_PATTERNS,
  NARROW_COLLISION_KNOWN_FAILURES,
  NARROW_COLLISION_PAGE_ROUTES,
  NARROW_COLLISION_ROUTE_RECIPES,
  NARROW_COLLISION_SURFACE_GROUPS,
  adjudicateNarrowCollision,
  expectedNarrowCollisionMetrics,
  narrowCollisionMetricIdentityFailures,
  parseNarrowCollisionEngines,
  parseNarrowCollisionGroups,
  isExpectedBrowserDiagnostic,
  isRetryableCollisionNavigationError,
  responsiveMetricFailures,
  type NarrowCollisionRawFinding,
  type ResponsiveMetricForAdjudication,
} from "../../../scripts/responsive-layout-contract";
import { scanNarrowCollisions } from "../../../scripts/narrow-collision-scan";

const globalsCss = readFileSync(
  fileURLToPath(new URL("../../../app/globals.css", import.meta.url)),
  "utf8",
);
const responsiveHarness = readFileSync(
  fileURLToPath(new URL("../../../scripts/verify-responsive-layout-browser.mts", import.meta.url)),
  "utf8",
);
const appRoot = fileURLToPath(new URL("../../../app", import.meta.url));

function appPageRoutes(directory = appRoot, segments: string[] = []): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isFile() && entry.name === "page.tsx") {
      const routeSegments = segments.filter((segment) => !/^\(.+\)$/u.test(segment));
      return [routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`];
    }
    return entry.isDirectory()
      ? appPageRoutes(path.join(directory, entry.name), [...segments, entry.name])
      : [];
  });
}

function collision(overrides: Partial<NarrowCollisionRawFinding> = {}): NarrowCollisionRawFinding {
  return {
    class: "A",
    targetSelector: "button[aria-label=target]",
    targetName: "Target",
    targetKind: "control",
    occluderSelector: "div[aria-label=occluder]",
    occluderName: "Occluder",
    sample: "centroid",
    point: { x: 20, y: 20 },
    targetRect: { x: 10, y: 10, width: 44, height: 44 },
    occluderRect: { x: 20, y: 20, width: 44, height: 44 },
    intersectionRect: { x: 10, y: 10, width: 44, height: 44 },
    scrollX: 0,
    scrollY: 0,
    nestedScrollerSelector: null,
    nestedScrollTop: null,
    occluderPosition: "absolute",
    occluderZIndex: "2",
    sharedInteractiveAncestor: false,
    sharedFormationRegion: false,
    intentionalScrollShell: false,
    ...overrides,
  };
}

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
    expect(INLINE_TEXT_LINK_ALLOWLIST).toEqual([
      ".prose p a[href]",
      ".prose li a[href]",
      ".one-screen-disclosure a[href]",
    ]);
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

  it("keeps collision discovery default-closed over every App Router page", () => {
    expect([...NARROW_COLLISION_PAGE_ROUTES].sort()).toEqual(appPageRoutes().sort());
    expect(NARROW_COLLISION_ROUTE_RECIPES.map(({ route }) => route).sort()).toEqual(
      [...NARROW_COLLISION_PAGE_ROUTES].sort(),
    );
    const groupedSurfaces = NARROW_COLLISION_SURFACE_GROUPS.flat();
    const recipeSurfaces = NARROW_COLLISION_ROUTE_RECIPES.flatMap(({ surfaces }) => surfaces);
    expect(new Set(recipeSurfaces)).toEqual(new Set(groupedSurfaces));
    expect(recipeSurfaces).toHaveLength(groupedSurfaces.length);
  });

  it("runs every collision group by default and rejects invalid filters", () => {
    expect([...parseNarrowCollisionGroups(undefined, 4)]).toEqual([]);
    expect([...parseNarrowCollisionGroups("", 4)]).toEqual([]);
    expect([...parseNarrowCollisionGroups("2, 4", 4)]).toEqual([2, 4]);
    expect(() => parseNarrowCollisionGroups("0", 4)).toThrow("invalid collision group 0");
    expect(() => parseNarrowCollisionGroups("5", 4)).toThrow("invalid collision group 5");
    expect(() => parseNarrowCollisionGroups("one", 4)).toThrow("invalid collision group NaN");
  });

  it("fails closed on missing, unknown, and duplicate collision engines", () => {
    expect(parseNarrowCollisionEngines(undefined)).toEqual(["chromium", "webkit"]);
    expect(parseNarrowCollisionEngines("webkit")).toEqual(["webkit"]);
    expect(() => parseNarrowCollisionEngines("")).toThrow(
      "collision engine filter must name at least one engine",
    );
    expect(() => parseNarrowCollisionEngines("chromium,not-a-real-engine")).toThrow(
      "invalid collision engines: not-a-real-engine",
    );
    expect(() => parseNarrowCollisionEngines("webkit,webkit")).toThrow(
      "collision engine filter contains duplicate engines",
    );
  });

  it("fails closed on collision matrix cardinality", () => {
    expect(
      expectedNarrowCollisionMetrics({
        groups: NARROW_COLLISION_SURFACE_GROUPS,
        engines: 2,
        viewports: 3,
        themes: 2,
      }),
    ).toBe(264);
    expect(
      expectedNarrowCollisionMetrics({
        groups: [NARROW_COLLISION_SURFACE_GROUPS[0]],
        engines: 1,
        viewports: 3,
        themes: 2,
      }),
    ).toBe(36);
  });

  it("fails closed on missing, duplicate, and unexpected cell identities", () => {
    expect(
      narrowCollisionMetricIdentityFailures(
        ["home|320x568|light|chromium", "home|320x568|dark|chromium"],
        [
          "home|320x568|light|chromium",
          "home|320x568|light|chromium",
          "other|320x568|dark|chromium",
        ],
      ),
    ).toEqual([
      "duplicate cells: home|320x568|light|chromium",
      "missing cells: home|320x568|dark|chromium",
      "unexpected cells: other|320x568|dark|chromium",
    ]);
  });

  it("detects aria-hidden Class B paint and records native label names", async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
      await page.setContent(`
        <style>
          body { margin: 0; }
          #target { position: fixed; left: 20px; top: 20px; width: 100px; height: 50px; }
          #paint { position: fixed; left: 40px; top: 20px; width: 50px; height: 50px;
            pointer-events: none; z-index: 3; }
          #name-occluder { position: fixed; left: 20px; top: 100px; width: 100px; height: 50px;
            z-index: 3; }
          #team-name { position: fixed; left: 20px; top: 100px; width: 100px; height: 50px; }
        </style>
        <button id="target" aria-label="Target">Target</button>
        <span id="paint" aria-hidden="true">01</span>
        <label for="team-name">Team name</label>
        <input id="team-name" />
        <div id="name-occluder" aria-label="Occluder"></div>
      `);
      const findings = await scanNarrowCollisions(page);
      expect(
        findings.some(
          (finding) =>
            finding.class === "B" &&
            finding.targetSelector === "#target" &&
            finding.occluderSelector === "#paint",
        ),
      ).toBe(true);
      expect(
        findings.some(
          (finding) =>
            finding.class === "A" &&
            finding.targetSelector === "#team-name" &&
            finding.targetName === "Team name",
        ),
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("ignores only hidden Next portal shadow hits and preserves visible portal collisions", async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
      await page.setContent(`
        <style>
          body { margin: 0; }
          #target { position: fixed; left: 20px; top: 20px; width: 100px; height: 50px; }
          nextjs-portal { position: fixed; left: 20px; top: 20px; width: 100px; height: 50px;
            display: none; z-index: 9999; }
        </style>
        <button id="target" aria-label="Product target">Product target</button>
        <nextjs-portal></nextjs-portal>
      `);
      await page.evaluate(() => {
        const portal = document.querySelector<HTMLElement>("nextjs-portal")!;
        const shadow = portal.attachShadow({ mode: "open" });
        shadow.innerHTML = '<section><div id="dev-dot">·</div></section>';
        const dot = shadow.querySelector<HTMLElement>("#dev-dot")!;
        dot.getBoundingClientRect = () => new DOMRect(20, 20, 100, 50);
        document.elementFromPoint = () => dot;
      });

      expect(await scanNarrowCollisions(page)).toEqual([]);

      await page.locator("nextjs-portal").evaluate((portal) => {
        portal.style.display = "block";
      });
      expect(await scanNarrowCollisions(page)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            class: "A",
            targetSelector: "#target",
            occluderSelector: "body>nextjs-portal::shadow #dev-dot",
          }),
        ]),
      );
    } finally {
      await browser.close();
    }
  });

  it("filters only exact WebKit report-only CSP diagnostics", () => {
    const reportOnlyStyle =
      "[Report Only] Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";
    const reportOnlyFrame =
      "The Content Security Policy directive 'frame-ancestors' is ignored when delivered in a report-only policy.";
    expect(isExpectedBrowserDiagnostic("webkit", reportOnlyStyle)).toBe(true);
    expect(isExpectedBrowserDiagnostic("webkit", reportOnlyFrame)).toBe(true);
    expect(isExpectedBrowserDiagnostic("chromium", reportOnlyStyle)).toBe(false);
    expect(
      isExpectedBrowserDiagnostic(
        "webkit",
        "Refused to apply a stylesheet because it violates the Content Security Policy.",
      ),
    ).toBe(false);
  });

  it("retries only the exact navigation race at the collision scan boundary", () => {
    expect(
      isRetryableCollisionNavigationError(
        new Error(
          "page.evaluate: Execution context was destroyed, most likely because of a navigation",
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableCollisionNavigationError(
        new Error("page.evaluate: responsive measurement raced document navigation"),
      ),
    ).toBe(true);
    expect(isRetryableCollisionNavigationError(new Error("page crashed"))).toBe(false);
    expect(isRetryableCollisionNavigationError("Execution context was destroyed")).toBe(false);
  });

  it("uses only documented pattern exceptions and no known-failure blanket", () => {
    expect(
      NARROW_COLLISION_ALLOWLIST_PATTERNS.map(({ id, rationale }) => ({ id, rationale })),
    ).toEqual([
      {
        id: "same-interactive-composition",
        rationale:
          "Sibling paint layers inside one semantic control share its hit target; the control border box remains independently adjudicated.",
      },
      {
        id: "scrolling-under-app-shell",
        rationale:
          "After user-equivalent scrolling, content may pass beneath a semantic fixed or sticky app shell; arbitrary positioned layers and initial-paint overlaps remain blocking.",
      },
    ]);
    expect(NARROW_COLLISION_KNOWN_FAILURES).toEqual([]);
  });

  it("keeps unlisted collisions blocking and applies patterns independent of surface", () => {
    const unexpected = adjudicateNarrowCollision({
      surface: "any-surface",
      viewport: "320x568",
      theme: "dark",
      engine: "webkit",
      finding: collision(),
    });
    expect(unexpected.disposition).toBe("unexpected");
    expect(responsiveMetricFailures(metric({ collisionFindings: [unexpected] }))).toEqual([
      "history 1024x768 light: collision A control button[aria-label=target] (Target) under div[aria-label=occluder] (Occluder) at centroid",
    ]);

    for (const surface of ["draft-state", "legal-copy"]) {
      expect(
        adjudicateNarrowCollision({
          surface,
          viewport: "320x568",
          theme: "light",
          engine: "chromium",
          finding: collision({ sharedInteractiveAncestor: true }),
        }),
      ).toMatchObject({
        disposition: "allowlisted",
        ruleId: "same-interactive-composition",
      });
    }
  });

  it("never exempts overlaps merely because controls share a formation", () => {
    expect(
      adjudicateNarrowCollision({
        surface: "unrelated-name",
        viewport: "390x844",
        theme: "dark",
        engine: "webkit",
        finding: collision({ sharedFormationRegion: true, sample: "bottom-right" }),
      }).disposition,
    ).toBe("unexpected");
  });

  it("allows only measured scrolling under an app shell, never arbitrary fixed layers", () => {
    expect(
      adjudicateNarrowCollision({
        surface: "any-surface",
        viewport: "360x800",
        theme: "dark",
        engine: "chromium",
        finding: collision({ occluderPosition: "fixed" }),
      }).disposition,
    ).toBe("unexpected");
    expect(
      adjudicateNarrowCollision({
        surface: "any-surface",
        viewport: "360x800",
        theme: "dark",
        engine: "chromium",
        finding: collision({ occluderPosition: "sticky", intentionalScrollShell: true }),
      }),
    ).toMatchObject({ disposition: "allowlisted", ruleId: "scrolling-under-app-shell" });
  });
});
