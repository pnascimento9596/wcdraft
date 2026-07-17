import type { DevOverlaySuppression } from "./responsive-layout-contract";

export type DevOverlaySuppressionArgs = {
  readonly css: string;
  readonly requestedSuppression: "enabled" | "disabled";
};

/**
 * Suppress only a structurally verified Next.js App Router overlay group.
 *
 * This function is deliberately self-contained because Playwright serializes
 * it into the page. The request nonce remains the authorization signal for
 * harness CSS. The exact wrapper/direct-child relationship comes from the
 * installed Next runtime and prevents an arbitrary product custom element
 * from receiving dev-overlay treatment merely because it uses the
 * `nextjs-portal` tag name.
 */
export function suppressDevOverlayInDocument({
  css,
  requestedSuppression,
}: DevOverlaySuppressionArgs): DevOverlaySuppression {
  const nonceElement = document.querySelector<HTMLScriptElement | HTMLStyleElement>(
    "script[nonce], style[nonce]",
  );
  const nonceAttributeLength = nonceElement?.getAttribute("nonce")?.length ?? null;
  const requestNonce = nonceElement?.nonce ?? "";
  let styleNonceMatches = false;
  let styleSheetAttached = false;
  if (requestedSuppression === "enabled" && requestNonce) {
    const style = document.createElement("style");
    style.nonce = requestNonce;
    style.dataset.wcdraftResponsiveHarness = "dev-overlay";
    style.textContent = css;
    document.head.append(style);
    styleNonceMatches = style.nonce === requestNonce;
    styleSheetAttached = style.sheet !== null;
  }

  type DevPortalRegistryGlobal = typeof globalThis & {
    __wcdraftNextDevPortalHosts?: WeakMap<Element, HTMLElement>;
  };
  const registryGlobal = globalThis as DevPortalRegistryGlobal;
  const devPortalHosts =
    registryGlobal.__wcdraftNextDevPortalHosts ?? new WeakMap<Element, HTMLElement>();
  registryGlobal.__wcdraftNextDevPortalHosts = devPortalHosts;

  const overlayRoots = Array.from(
    document.querySelectorAll<HTMLElement>('body > script[data-nextjs-dev-overlay="true"]'),
  );
  const portals = Array.from(document.querySelectorAll<HTMLElement>("nextjs-portal"));
  const directPortals = overlayRoots.flatMap((root) =>
    Array.from(root.children).filter(
      (child): child is HTMLElement => child.tagName.toLowerCase() === "nextjs-portal",
    ),
  );
  const verifiedPortal =
    overlayRoots.length === 1 && portals.length === 1 && directPortals.length === 1
      ? directPortals[0]!
      : null;
  const portalProvenance: DevOverlaySuppression["portalProvenance"] =
    overlayRoots.length === 0 && portals.length === 0
      ? "absent"
      : verifiedPortal
        ? "next-app-wrapper"
        : "unverified";
  if (verifiedPortal) {
    const portal = verifiedPortal;
    const pending: Element[] = [portal];
    for (let index = 0; index < pending.length; index += 1) {
      const element = pending[index]!;
      devPortalHosts.set(element, portal);
      if (element.shadowRoot) {
        pending.push(...element.shadowRoot.querySelectorAll<Element>("*"));
      }
    }
  }

  const overlayRootSuppressed = overlayRoots.some((root) => {
    const computed = getComputedStyle(root);
    return computed.display === "none" || Number(computed.opacity) === 0;
  });
  const visiblePortals = portals.filter((portal) => {
    const computed = getComputedStyle(portal);
    return (
      !(verifiedPortal === portal && overlayRootSuppressed) &&
      computed.display !== "none" &&
      Number(computed.opacity) !== 0
    );
  });
  const controls = portals.flatMap((portal) =>
    portal.shadowRoot
      ? Array.from(
          portal.shadowRoot.querySelectorAll(
            "[data-nextjs-dev-tools-button], [data-nextjs-dev-tools-panel], button, [role='button']",
          ),
        )
      : [],
  );
  const portalState: DevOverlaySuppression["portalState"] =
    portals.length === 0 ? "absent" : visiblePortals.length === 0 ? "hidden" : "visible";
  // WebKit can retain stale shadow-child rectangles when an ancestor overlay
  // group is hidden. Count controls only while a portal host remains paintable.
  const visibleControlCount =
    portalState === "visible"
      ? controls.filter((element) => {
          const rect = element.getBoundingClientRect();
          const computed = getComputedStyle(element);
          return (
            computed.display !== "none" &&
            computed.visibility !== "hidden" &&
            computed.opacity !== "0" &&
            rect.width > 0 &&
            rect.height > 0
          );
        }).length
      : 0;

  return {
    suppression: requestedSuppression,
    nonceAttributeLength,
    noncePropertyLength: requestNonce.length,
    nonceSource: requestNonce ? "property" : "missing",
    styleNonceMatches,
    styleSheetAttached,
    portalProvenance,
    portalState,
    visibleControlCount,
  };
}
