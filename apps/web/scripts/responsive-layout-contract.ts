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

export type DevOverlaySuppression = {
  readonly suppression: "enabled" | "disabled";
  readonly nonceAttributeLength: number | null;
  readonly noncePropertyLength: number;
  readonly nonceSource: "property" | "missing";
  readonly styleNonceMatches: boolean;
  readonly styleSheetAttached: boolean;
  readonly portalState: "absent" | "hidden" | "visible";
  readonly visibleControlCount: number;
};

export type ResponsiveMetricForAdjudication = {
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
  readonly devOverlay: DevOverlaySuppression | null;
};

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
  if (metric.consoleErrors.length > 0) {
    failures.push(`${prefix}: console ${metric.consoleErrors.join(",")}`);
  }
  if (metric.devOverlay !== null) {
    const overlay = metric.devOverlay;
    const reasons: string[] = [];
    if (overlay.suppression === "disabled") {
      reasons.push("suppression disabled");
    } else {
      if (overlay.nonceSource !== "property" || overlay.noncePropertyLength === 0) {
        reasons.push("request nonce property missing");
      }
      if (!overlay.styleNonceMatches) reasons.push("style nonce mismatch");
      if (!overlay.styleSheetAttached) reasons.push("style sheet rejected");
    }
    if (overlay.portalState === "visible") reasons.push("Next portal visible");
    if (overlay.visibleControlCount > 0) {
      reasons.push(`${overlay.visibleControlCount.toString()} dev-tools controls visible`);
    }
    if (reasons.length > 0) {
      failures.push(
        `${prefix}: dev overlay suppression failed (${reasons.join(", ")}; attribute nonce length=${String(overlay.nonceAttributeLength)}, property nonce length=${overlay.noncePropertyLength.toString()})`,
      );
    }
  }
  return failures;
}
