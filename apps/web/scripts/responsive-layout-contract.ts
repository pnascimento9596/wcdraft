export const MIN_INTERACTION_TARGET_PX = 44;

/**
 * Only true text-flow links may sit below the standalone interaction floor.
 * Action links (history cards, navigation, buttons styled as links) are
 * intentionally absent so the browser harness adjudicates their full target.
 */
export const INLINE_TEXT_LINK_ALLOWLIST = [
  ".prose p a[href]",
  ".prose li a[href]",
  ".one-screen-disclosure a[href]",
] as const;

export type NarrowCollisionClass = "A" | "B";
export type NarrowCollisionTargetKind = "control" | "text";
export type NarrowCollisionSample =
  | "centroid"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type NarrowCollisionRawFinding = {
  readonly class: NarrowCollisionClass;
  readonly targetSelector: string;
  readonly targetName: string;
  readonly targetKind: NarrowCollisionTargetKind;
  readonly occluderSelector: string;
  readonly occluderName: string;
  readonly sample: NarrowCollisionSample;
  readonly point: { readonly x: number; readonly y: number };
  readonly targetRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly occluderRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly intersectionRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly scrollX: number;
  readonly scrollY: number;
  readonly nestedScrollerSelector: string | null;
  readonly nestedScrollTop: number | null;
  readonly targetPosition: string;
  readonly occluderPosition: string;
  readonly occluderZIndex: string;
  readonly occluderOpaqueBoxPaint: boolean;
  readonly sharedInteractiveAncestor: boolean;
  readonly sharedFormationRegion: boolean;
  readonly intentionalScrollShell: boolean;
};

export type NarrowCollisionFinding = NarrowCollisionRawFinding & {
  readonly disposition: "allowlisted" | "known-failure" | "unexpected";
  readonly ruleId: string | null;
};

type NarrowCollisionAllowlistPattern = {
  readonly id: string;
  readonly rationale: string;
  readonly matches: (finding: NarrowCollisionRawFinding) => boolean;
};

/**
 * Pattern-only exceptions. None reads a route or surface name. The patterns
 * describe reusable composition behavior and are deliberately narrower than
 * a selector-only skip.
 */
export const NARROW_COLLISION_ALLOWLIST_PATTERNS: readonly NarrowCollisionAllowlistPattern[] = [
  {
    id: "same-interactive-composition",
    rationale:
      "Non-box sibling paint inside one semantic control shares its hit target; opaque backgrounds, images, borders, and shadows remain blocking.",
    matches: (finding) => finding.sharedInteractiveAncestor && !finding.occluderOpaqueBoxPaint,
  },
  {
    id: "scrolling-under-app-shell",
    rationale:
      "After user-equivalent scrolling, in-flow content may pass beneath a semantic fixed or sticky app shell; pinned controls, arbitrary positioned layers, and initial-paint overlaps remain blocking.",
    matches: (finding) =>
      finding.intentionalScrollShell && !["fixed", "sticky"].includes(finding.targetPosition),
  },
] as const;

/** Exact deferrals only. Each entry must match the full route/cell/element fingerprint. */
export const NARROW_COLLISION_KNOWN_FAILURES: readonly string[] = [];

export const NARROW_COLLISION_PAGE_ROUTES = [
  "/",
  "/account",
  "/attribution",
  "/contact",
  "/how-to-play",
  "/leaderboard",
  "/play",
  "/play/daily",
  "/play/draft",
  "/play/history",
  "/play/results",
  "/play/review",
  "/play/share",
  "/privacy",
  "/settings",
  "/sign-in",
  "/sign-up",
] as const;

/**
 * Every App Router page is tied to at least one deterministic browser recipe.
 * Several recipes deliberately exercise deeper states of the same route, but
 * the route inventory remains the default-closed source of truth.
 */
export const NARROW_COLLISION_ROUTE_RECIPES = [
  { route: "/", surfaces: ["home"] },
  { route: "/account", surfaces: ["account"] },
  { route: "/attribution", surfaces: ["attribution"] },
  { route: "/contact", surfaces: ["contact"] },
  { route: "/how-to-play", surfaces: ["how-to-play"] },
  { route: "/leaderboard", surfaces: ["leaderboard"] },
  { route: "/play", surfaces: ["mode-select-available"] },
  { route: "/play/daily", surfaces: ["daily-spin"] },
  {
    route: "/play/draft",
    surfaces: ["spin-stage", "position-target", "classic-pick", "challenge-setup"],
  },
  { route: "/play/history", surfaces: ["history"] },
  { route: "/play/results", surfaces: ["results"] },
  { route: "/play/review", surfaces: ["team-sheet", "squad-review"] },
  { route: "/play/share", surfaces: ["share-author", "share-recipient"] },
  { route: "/privacy", surfaces: ["privacy"] },
  { route: "/settings", surfaces: ["settings"] },
  { route: "/sign-in", surfaces: ["sign-in"] },
  { route: "/sign-up", surfaces: ["sign-up"] },
] as const satisfies readonly {
  readonly route: (typeof NARROW_COLLISION_PAGE_ROUTES)[number];
  readonly surfaces: readonly string[];
}[];

export const NARROW_COLLISION_SURFACE_GROUPS = [
  ["home", "mode-select-available", "daily-spin", "spin-stage", "position-target", "classic-pick"],
  ["team-sheet", "squad-review", "results", "share-author", "share-recipient"],
  ["challenge-setup", "history", "leaderboard", "account", "sign-in", "sign-up"],
  ["settings", "how-to-play", "privacy", "contact", "attribution"],
] as const;

export const NARROW_COLLISION_ENGINES = ["chromium", "webkit"] as const;
export type NarrowCollisionEngine = (typeof NARROW_COLLISION_ENGINES)[number];

export function parseNarrowCollisionEngines(value: string | undefined): NarrowCollisionEngine[] {
  const tokens = (value ?? NARROW_COLLISION_ENGINES.join(","))
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    throw new Error("collision engine filter must name at least one engine");
  }
  const invalid = tokens.filter(
    (token) => !(NARROW_COLLISION_ENGINES as readonly string[]).includes(token),
  );
  if (invalid.length > 0) {
    throw new Error(
      `invalid collision engines: ${invalid.join(", ")}; expected chromium or webkit`,
    );
  }
  if (new Set(tokens).size !== tokens.length) {
    throw new Error("collision engine filter contains duplicate engines");
  }
  return tokens as NarrowCollisionEngine[];
}

export function parseNarrowCollisionGroups(
  value: string | undefined,
  groupCount: number,
): ReadonlySet<number> {
  const tokens = (value ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const groups = new Set(tokens.map(Number));
  for (const group of groups) {
    if (!Number.isInteger(group) || group < 1 || group > groupCount) {
      throw new Error(
        `invalid collision group ${String(group)}; expected integers from 1 through ${groupCount.toString()}`,
      );
    }
  }
  return groups;
}

export function expectedNarrowCollisionMetrics(input: {
  readonly groups: readonly (readonly string[])[];
  readonly engines: number;
  readonly viewports: number;
  readonly themes: number;
}): number {
  const surfaceCount = input.groups.reduce((sum, surfaces) => sum + surfaces.length, 0);
  return surfaceCount * input.engines * input.viewports * input.themes;
}

export function narrowCollisionMetricIdentityFailures(
  expected: readonly string[],
  actual: readonly string[],
): string[] {
  const failures: string[] = [];
  const counts = new Map<string, number>();
  for (const key of actual) counts.set(key, (counts.get(key) ?? 0) + 1);
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([key]) => key);
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((key) => !actualSet.has(key));
  const unexpected = actual.filter((key) => !expectedSet.has(key));
  if (duplicates.length > 0) failures.push(`duplicate cells: ${duplicates.join(", ")}`);
  if (missing.length > 0) failures.push(`missing cells: ${missing.join(", ")}`);
  if (unexpected.length > 0) failures.push(`unexpected cells: ${unexpected.join(", ")}`);
  return failures;
}

export function narrowCollisionFingerprint(input: {
  readonly surface: string;
  readonly viewport: string;
  readonly theme: string;
  readonly engine: string;
  readonly finding: NarrowCollisionRawFinding;
}): string {
  const finding = input.finding;
  return [
    input.surface,
    input.viewport,
    input.theme,
    input.engine,
    finding.class,
    finding.targetKind,
    finding.targetSelector,
    finding.targetName,
    finding.occluderSelector,
    finding.occluderName,
  ].join("|");
}

export function adjudicateNarrowCollision(input: {
  readonly surface: string;
  readonly viewport: string;
  readonly theme: string;
  readonly engine: string;
  readonly finding: NarrowCollisionRawFinding;
}): NarrowCollisionFinding {
  const pattern = NARROW_COLLISION_ALLOWLIST_PATTERNS.find(({ matches }) => matches(input.finding));
  if (pattern) {
    return { ...input.finding, disposition: "allowlisted", ruleId: pattern.id };
  }
  const fingerprint = narrowCollisionFingerprint(input);
  if (NARROW_COLLISION_KNOWN_FAILURES.includes(fingerprint)) {
    return { ...input.finding, disposition: "known-failure", ruleId: fingerprint };
  }
  return { ...input.finding, disposition: "unexpected", ruleId: null };
}

export type ResponsiveMetricForAdjudication = {
  readonly engine?: string;
  readonly surface: string;
  readonly viewport: string;
  readonly theme: string;
  readonly shellRule: boolean;
  readonly noScrollGate: "pass" | "fail" | "n-a";
  readonly primaryActionInViewport: boolean | null;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly maxScrollWidth: number;
  readonly clientWidth: number;
  readonly horizontalOverflow: boolean;
  readonly modeDockInitialClearance: number | null;
  readonly modeDockTerminalClearance: number | null;
  readonly navWraps: readonly string[];
  readonly smallTargets: readonly string[];
  readonly axeViolations: readonly string[];
  readonly consoleErrors: readonly string[];
  readonly collisionFindings?: readonly NarrowCollisionFinding[];
};

const WEBKIT_REPORT_ONLY_DIAGNOSTICS = new Set([
  "[Report Only] Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.",
  "The Content Security Policy directive 'frame-ancestors' is ignored when delivered in a report-only policy.",
]);

const CROSS_ENGINE_REPORT_ONLY_DIAGNOSTICS = new Set([
  "The Content Security Policy directive 'upgrade-insecure-requests' is ignored when delivered in a report-only policy.",
]);

/** Exact browser diagnostics that do not represent an enforced page failure. */
export function isExpectedBrowserDiagnostic(engine: string, message: string): boolean {
  return (
    CROSS_ENGINE_REPORT_ONLY_DIAGNOSTICS.has(message) ||
    (engine === "webkit" && WEBKIT_REPORT_ONLY_DIAGNOSTICS.has(message))
  );
}

export function isRetryableCollisionNavigationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes(
      "Execution context was destroyed, most likely because of a navigation",
    ) ||
      error.message.includes("responsive measurement raced document navigation"))
  );
}

/** Signals that make a collision scan itself fail or become unreliable. */
export function narrowCollisionMetricFailures(metric: ResponsiveMetricForAdjudication): string[] {
  const engine = metric.engine ? ` ${metric.engine}` : "";
  const prefix = `${metric.surface} ${metric.viewport} ${metric.theme}${engine}`;
  const failures = metric.consoleErrors.map((error) => `${prefix}: console ${error}`);
  const unexpectedCollisions = (metric.collisionFindings ?? []).filter(
    (finding) => finding.disposition === "unexpected",
  );
  for (const finding of unexpectedCollisions) {
    failures.push(
      `${prefix}: collision ${finding.class} ${finding.targetKind} ${finding.targetSelector} (${finding.targetName}) under ${finding.occluderSelector} (${finding.occluderName}) at ${finding.sample}`,
    );
  }
  return failures;
}

export function responsiveMetricFailures(metric: ResponsiveMetricForAdjudication): string[] {
  const prefix = `${metric.surface} ${metric.viewport} ${metric.theme}`;
  const failures: string[] = [];
  if (metric.shellRule && metric.noScrollGate === "fail") {
    const action =
      metric.primaryActionInViewport === true
        ? "primary visible"
        : `primary ${String(metric.primaryActionInViewport)}`;
    failures.push(
      `${prefix}: shell scroll ${metric.scrollHeight.toString()}/${metric.clientHeight.toString()}; ${action}`,
    );
  }
  if (metric.horizontalOverflow) {
    failures.push(
      `${prefix}: horizontal overflow ${metric.maxScrollWidth.toString()}/${metric.clientWidth.toString()}`,
    );
  }
  if (metric.surface.startsWith("mode-select")) {
    if (metric.modeDockInitialClearance === null) {
      failures.push(`${prefix}: mode dock initial clearance unavailable`);
    } else if (metric.modeDockInitialClearance < 0) {
      failures.push(
        `${prefix}: mode dock overlaps cards at initial paint by ${Math.abs(metric.modeDockInitialClearance).toString()}px`,
      );
    }
    if (metric.modeDockTerminalClearance === null) {
      failures.push(`${prefix}: mode dock terminal clearance unavailable`);
    } else if (metric.modeDockTerminalClearance < 0) {
      failures.push(
        `${prefix}: mode dock overlaps cards at terminal scroll by ${Math.abs(metric.modeDockTerminalClearance).toString()}px`,
      );
    }
  }
  if (metric.smallTargets.length > 0) {
    const targetPreview = metric.smallTargets.slice(0, 12);
    const remaining = metric.smallTargets.length - targetPreview.length;
    failures.push(
      `${prefix}: targets below ${MIN_INTERACTION_TARGET_PX.toString()}px ${targetPreview.join(",")}${remaining > 0 ? ` (+${remaining.toString()} more)` : ""}`,
    );
  }
  if (metric.axeViolations.length > 0) {
    failures.push(`${prefix}: axe ${metric.axeViolations.join(",")}`);
  }
  if (metric.navWraps.length > 0) {
    failures.push(`${prefix}: nav wraps ${metric.navWraps.join(",")}`);
  }
  failures.push(...narrowCollisionMetricFailures(metric));
  return failures;
}
