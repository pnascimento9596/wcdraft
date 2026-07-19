import type { Page } from "playwright-core";

import type {
  NarrowCollisionRawFinding,
  NarrowCollisionSample,
} from "./responsive-layout-contract";

const CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
].join(",");

/**
 * Scan the complete document and each visible nested vertical scroller. This
 * is intentionally browser-derived: no route or component name participates
 * in collision discovery.
 */
export async function scanNarrowCollisions(
  page: Page,
): Promise<readonly NarrowCollisionRawFinding[]> {
  const controlSelector = CONTROL_SELECTOR;
  // tsx/esbuild names nested closures with this helper. Playwright serializes
  // the closure into the page, so provide the otherwise module-local helper.
  await page.evaluate("globalThis.__name = (target) => target;");
  return await page.evaluate(
    async ({ interactiveSelector }) => {
      type RectLike = { x: number; y: number; width: number; height: number };
      type SamplePoint = { label: NarrowCollisionSample; x: number; y: number };
      type Target = {
        owner: Element;
        kind: "control" | "text";
        name: string;
        selector: string;
        rect: DOMRect;
      };

      const findings: NarrowCollisionRawFinding[] = [];
      const seen = new Set<string>();
      const originalWindowScroll = { x: window.scrollX, y: window.scrollY };
      const originalScrollBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";

      const settleFrames = async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      };
      const rounds = (value: number) => Math.round(value * 100) / 100;
      const rectLike = (rect: DOMRect | RectLike): RectLike => ({
        x: rounds(rect.x),
        y: rounds(rect.y),
        width: rounds(rect.width),
        height: rounds(rect.height),
      });
      const composedParent = (element: Element): Element | null => {
        if (element.parentElement) return element.parentElement;
        const root = element.getRootNode();
        return root instanceof ShadowRoot ? root.host : null;
      };
      const alphaVisible = (color: string) => {
        const normalized = color.trim().toLowerCase();
        if (normalized === "transparent") return false;
        const legacyAlpha = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/u.exec(normalized)?.[1];
        if (legacyAlpha !== undefined) return Number(legacyAlpha) > 0;
        const modernAlpha = /^rgba?\([^/]+\/\s*([\d.]+)(%)?\s*\)$/u.exec(normalized);
        if (modernAlpha) {
          const alpha = Number(modernAlpha[1]);
          return modernAlpha[2] === "%" ? alpha > 0 : alpha > 0;
        }
        return true;
      };
      const elementPainted = (element: Element) => {
        let current: Element | null = element;
        while (current) {
          const style = getComputedStyle(current);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            Number(style.opacity) === 0 ||
            !["auto", "none"].includes(style.clip) ||
            style.clipPath !== "none"
          ) {
            return false;
          }
          current = composedParent(current);
        }
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < innerWidth &&
          rect.top < innerHeight
        );
      };
      const semanticTargetVisible = (element: Element) =>
        element.closest('[hidden], [inert], [aria-hidden="true"]') === null &&
        elementPainted(element);
      const stableSelector = (element: Element): string => {
        const root = element.getRootNode();
        if (root instanceof ShadowRoot) {
          const localSelector = (() => {
            if (element.id) return `#${CSS.escape(element.id)}`;
            for (const attr of ["data-collision-id", "aria-label", "role", "name"]) {
              const value = element.getAttribute(attr);
              if (value !== null) {
                return `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
              }
            }
            const parts: string[] = [];
            let current: Element | null = element;
            while (current && parts.length < 6) {
              const parent: Element | null = current.parentElement;
              const peers = parent
                ? [...parent.children].filter((peer) => peer.tagName === current!.tagName)
                : [];
              const suffix =
                peers.length > 1 ? `:nth-of-type(${(peers.indexOf(current) + 1).toString()})` : "";
              parts.unshift(`${current.tagName.toLowerCase()}${suffix}`);
              current = parent;
            }
            return parts.join(">");
          })();
          return `${stableSelector(root.host)}::shadow ${localSelector}`;
        }
        if (element.id) return `#${CSS.escape(element.id)}`;
        for (const attr of ["data-collision-id", "aria-label", "role", "name"]) {
          const value = element.getAttribute(attr);
          if (value !== null) {
            return `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
          }
        }
        const parts: string[] = [];
        let current: Element | null = element;
        while (current && current !== document.body && parts.length < 6) {
          const parent: Element | null = current.parentElement;
          const peers = parent
            ? [...parent.children].filter((peer) => peer.tagName === current!.tagName)
            : [];
          const suffix =
            peers.length > 1 ? `:nth-of-type(${(peers.indexOf(current) + 1).toString()})` : "";
          parts.unshift(`${current.tagName.toLowerCase()}${suffix}`);
          current = parent;
        }
        return `body>${parts.join(">")}`;
      };
      const semanticNameOf = (element: Element): string => {
        const normalize = (value: string | null | undefined) =>
          (value ?? "").replace(/\s+/gu, " ").trim();
        const labelledBy = element.getAttribute("aria-labelledby");
        const labelled = normalize(
          labelledBy
            ?.split(/\s+/u)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" "),
        );
        const labelable = element as HTMLInputElement;
        const nativeLabels =
          "labels" in labelable && labelable.labels
            ? normalize([...labelable.labels].map((label) => label.textContent ?? "").join(" "))
            : "";
        const inputValue =
          element instanceof HTMLInputElement &&
          ["button", "submit", "reset"].includes(element.type)
            ? element.value
            : "";
        return (
          labelled ||
          element.getAttribute("aria-label") ||
          nativeLabels ||
          element.getAttribute("alt") ||
          inputValue ||
          element.getAttribute("title") ||
          element.getAttribute("data-collision-id") ||
          element.getAttribute("name") ||
          element.textContent ||
          element.tagName
        )
          .replace(/\s+/gu, " ")
          .trim()
          .slice(0, 160);
      };
      const clipToViewport = (rect: DOMRect | RectLike): RectLike | null => {
        const left = Math.max(0, rect.x);
        const top = Math.max(0, rect.y);
        const right = Math.min(innerWidth, rect.x + rect.width);
        const bottom = Math.min(innerHeight, rect.y + rect.height);
        return right > left && bottom > top
          ? { x: left, y: top, width: right - left, height: bottom - top }
          : null;
      };
      const intersection = (
        leftRect: DOMRect | RectLike,
        rightRect: DOMRect | RectLike,
      ): RectLike | null => {
        const left = Math.max(0, leftRect.x, rightRect.x);
        const top = Math.max(0, leftRect.y, rightRect.y);
        const right = Math.min(
          innerWidth,
          leftRect.x + leftRect.width,
          rightRect.x + rightRect.width,
        );
        const bottom = Math.min(
          innerHeight,
          leftRect.y + leftRect.height,
          rightRect.y + rightRect.height,
        );
        return right > left && bottom > top
          ? { x: left, y: top, width: right - left, height: bottom - top }
          : null;
      };
      const visibleRect = (owner: Element, rect: DOMRect | RectLike): RectLike | null => {
        let clipped = clipToViewport(rect);
        if (!clipped) return null;
        for (let ancestor: Element | null = owner; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          const clipsX = style.overflowX !== "visible";
          const clipsY = style.overflowY !== "visible";
          if (!clipsX && !clipsY) continue;
          const ancestorRect = ancestor.getBoundingClientRect();
          const left: number = clipsX ? Math.max(clipped.x, ancestorRect.left) : clipped.x;
          const top: number = clipsY ? Math.max(clipped.y, ancestorRect.top) : clipped.y;
          const right: number = clipsX
            ? Math.min(clipped.x + clipped.width, ancestorRect.right)
            : clipped.x + clipped.width;
          const bottom: number = clipsY
            ? Math.min(clipped.y + clipped.height, ancestorRect.bottom)
            : clipped.y + clipped.height;
          if (right <= left || bottom <= top) return null;
          clipped = { x: left, y: top, width: right - left, height: bottom - top };
        }
        return clipped;
      };
      const samplePoints = (rect: RectLike): SamplePoint[] => {
        const insetX = Math.min(2, Math.max(0.25, rect.width / 4));
        const insetY = Math.min(2, Math.max(0.25, rect.height / 4));
        return [
          { label: "centroid", x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
          { label: "top-left", x: rect.x + insetX, y: rect.y + insetY },
          {
            label: "top-right",
            x: rect.x + rect.width - insetX,
            y: rect.y + insetY,
          },
          {
            label: "bottom-left",
            x: rect.x + insetX,
            y: rect.y + rect.height - insetY,
          },
          {
            label: "bottom-right",
            x: rect.x + rect.width - insetX,
            y: rect.y + rect.height - insetY,
          },
        ];
      };
      const hitAtPoint = (x: number, y: number): Element | null => {
        // WebKit can transiently return a node retained from the document that
        // existed before navigation. A foreign-document node cannot paint over
        // the current page, so continue through the current document's hit stack.
        const belongsToCurrentDocument = (candidate: Element | null): candidate is Element =>
          candidate !== null && candidate.ownerDocument === document;
        const descendOpenShadow = (initial: Element): Element => {
          const seen = new Set<Element>();
          let current = initial;
          while (current.shadowRoot && !seen.has(current)) {
            seen.add(current);
            const shadowRoot = current.shadowRoot as ShadowRoot & {
              elementFromPoint?: (pointX: number, pointY: number) => Element | null;
            };
            const nativeCandidate = shadowRoot.elementFromPoint?.(x, y) ?? null;
            const nativeNested = belongsToCurrentDocument(nativeCandidate) ? nativeCandidate : null;
            const nativeRect = nativeNested?.getBoundingClientRect();
            const nativeContainsPoint =
              nativeRect !== undefined &&
              x >= nativeRect.left &&
              x <= nativeRect.right &&
              y >= nativeRect.top &&
              y <= nativeRect.bottom;
            const geometricNested = [...shadowRoot.querySelectorAll<Element>("*")]
              .filter((candidate) => {
                const style = getComputedStyle(candidate);
                const rect = candidate.getBoundingClientRect();
                return (
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  style.visibility !== "collapse" &&
                  Number(style.opacity) !== 0 &&
                  style.pointerEvents !== "none" &&
                  x >= rect.left &&
                  x <= rect.right &&
                  y >= rect.top &&
                  y <= rect.bottom
                );
              })
              .at(-1);
            const nested = nativeContainsPoint ? nativeNested : (geometricNested ?? null);
            if (!nested || nested === current) break;
            current = nested;
          }
          return current;
        };
        const initialHit = document.elementFromPoint(x, y);
        const stackHits = () =>
          document
            .elementsFromPoint(x, y)
            .filter(belongsToCurrentDocument)
            .map(descendOpenShadow)
            .filter(belongsToCurrentDocument);
        return belongsToCurrentDocument(initialHit)
          ? descendOpenShadow(initialHit)
          : (stackHits()[0] ?? null);
      };
      const related = (owner: Element, hit: Element | null) =>
        hit !== null && (hit === owner || owner.contains(hit) || hit.contains(owner));
      const interactiveAncestor = (element: Element) => element.closest(interactiveSelector);
      const formationRegion = (element: Element) =>
        element.closest('[aria-label="Your formation"], [aria-label="Final XI"]');
      const relationshipFlags = (target: Element, occluder: Element) => {
        const targetInteractive = interactiveAncestor(target);
        const occluderInteractive = interactiveAncestor(occluder);
        const targetFormation = formationRegion(target);
        return {
          sharedInteractiveAncestor:
            targetInteractive !== null && targetInteractive === occluderInteractive,
          sharedFormationRegion:
            targetFormation !== null && targetFormation === formationRegion(occluder),
        };
      };
      const intentionalScrollShell = (
        occluder: Element,
        position: string,
        nestedScroller: HTMLElement | null,
      ) =>
        ["fixed", "sticky"].includes(position) &&
        (window.scrollY > 0 || (nestedScroller?.scrollTop ?? 0) > 0) &&
        occluder.closest('header, [role="banner"], [data-collision-scroll-shell="true"]') !== null;
      const occluderDetails = (hit: Element) => {
        let positionedLayer: Element | null = hit;
        while (positionedLayer && positionedLayer !== document.body) {
          const position = getComputedStyle(positionedLayer).position;
          if (position === "fixed" || position === "sticky") break;
          positionedLayer = composedParent(positionedLayer);
        }
        const style = getComputedStyle(positionedLayer ?? hit);
        return {
          element: hit,
          selector: stableSelector(hit),
          name: semanticNameOf(hit),
          position: style.position,
          zIndex: style.zIndex,
        };
      };
      const targets = (): Target[] => {
        const controls = [...document.querySelectorAll<Element>(interactiveSelector)]
          .filter(semanticTargetVisible)
          .map<Target>((owner) => ({
            owner,
            kind: "control",
            name: semanticNameOf(owner),
            selector: stableSelector(owner),
            rect: owner.getBoundingClientRect(),
          }));
        const textTargets: Target[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const text = node.textContent?.replace(/\s+/gu, " ").trim() ?? "";
            const owner = node.parentElement;
            if (!owner || text.length === 0 || !semanticTargetVisible(owner)) {
              return NodeFilter.FILTER_REJECT;
            }
            if (
              owner.closest(
                'script, style, noscript, svg, [hidden], [inert], [aria-hidden="true"], [data-collision-decorative="true"]',
              )
            ) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const owner = (node as Text).parentElement!;
          const range = document.createRange();
          range.selectNodeContents(node);
          const name = node.textContent!.replace(/\s+/gu, " ").trim().slice(0, 160);
          for (const rect of [...range.getClientRects()]) {
            if (rect.width <= 0 || rect.height <= 0 || visibleRect(owner, rect) === null) continue;
            textTargets.push({ owner, kind: "text", name, selector: stableSelector(owner), rect });
          }
          range.detach();
        }
        return [...controls, ...textTargets];
      };
      const opaqueBoxPaint = (candidate: Element) => {
        const style = getComputedStyle(candidate);
        const hasBackground =
          style.backgroundImage !== "none" || alphaVisible(style.backgroundColor);
        const hasBorder = ["Top", "Right", "Bottom", "Left"].some((side) => {
          const borderStyle = style[`border${side}Style` as keyof CSSStyleDeclaration];
          const borderWidth = style[`border${side}Width` as keyof CSSStyleDeclaration];
          const borderColor = style[`border${side}Color` as keyof CSSStyleDeclaration];
          return (
            borderStyle !== "none" &&
            Number.parseFloat(String(borderWidth)) > 0 &&
            alphaVisible(String(borderColor))
          );
        });
        return (
          hasBackground ||
          hasBorder ||
          style.boxShadow !== "none" ||
          ["IMG", "SVG", "CANVAS", "VIDEO"].includes(candidate.tagName)
        );
      };
      const paints = (candidate: HTMLElement) => {
        const style = getComputedStyle(candidate);
        const hasText = [...candidate.childNodes].some(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            (node.textContent?.trim().length ?? 0) > 0 &&
            alphaVisible(style.color),
        );
        return hasText || opaqueBoxPaint(candidate);
      };
      const pushFinding = (finding: NarrowCollisionRawFinding) => {
        const key = [
          finding.class,
          finding.targetKind,
          finding.targetSelector,
          finding.targetName,
          finding.occluderSelector,
          finding.occluderName,
        ].join("|");
        if (seen.has(key)) return;
        seen.add(key);
        findings.push(finding);
      };
      const scanCurrent = (nestedScroller: HTMLElement | null) => {
        const currentTargets = targets();
        const nestedScrollerSelector = nestedScroller ? stableSelector(nestedScroller) : null;
        for (const target of currentTargets) {
          const clipped = visibleRect(target.owner, target.rect);
          if (!clipped) continue;
          for (const point of samplePoints(clipped)) {
            const hit = hitAtPoint(point.x, point.y);
            if (related(target.owner, hit) || hit === null) continue;
            const occluder = occluderDetails(hit);
            const occluderRect = occluder.element.getBoundingClientRect();
            const overlap = intersection(clipped, occluderRect);
            if (!overlap) continue;
            pushFinding({
              class: "A",
              targetSelector: target.selector,
              targetName: target.name,
              targetKind: target.kind,
              occluderSelector: occluder.selector,
              occluderName: occluder.name,
              sample: point.label,
              point: { x: rounds(point.x), y: rounds(point.y) },
              targetRect: rectLike(target.rect),
              occluderRect: rectLike(occluderRect),
              intersectionRect: rectLike(overlap),
              scrollX: Math.round(window.scrollX),
              scrollY: Math.round(window.scrollY),
              nestedScrollerSelector,
              nestedScrollTop: nestedScroller ? Math.round(nestedScroller.scrollTop) : null,
              targetPosition: getComputedStyle(target.owner).position,
              occluderPosition: occluder.position,
              occluderZIndex: occluder.zIndex,
              occluderOpaqueBoxPaint: opaqueBoxPaint(occluder.element),
              intentionalScrollShell: intentionalScrollShell(
                occluder.element,
                occluder.position,
                nestedScroller,
              ),
              ...relationshipFlags(target.owner, occluder.element),
            });
          }
        }

        const pointerTransparentPaint = [
          ...document.querySelectorAll<HTMLElement>("body *"),
        ].filter(
          (candidate) =>
            elementPainted(candidate) &&
            getComputedStyle(candidate).pointerEvents === "none" &&
            paints(candidate),
        );
        for (const candidate of pointerTransparentPaint) {
          const candidateRect = candidate.getBoundingClientRect();
          const visibleCandidateRect = visibleRect(candidate, candidateRect);
          if (!visibleCandidateRect) continue;
          for (const target of currentTargets) {
            if (
              candidate === target.owner ||
              candidate.contains(target.owner) ||
              target.owner.contains(candidate)
            ) {
              continue;
            }
            const visibleTargetRect = visibleRect(target.owner, target.rect);
            if (!visibleTargetRect) continue;
            const overlap = intersection(visibleCandidateRect, visibleTargetRect);
            if (!overlap) continue;
            const previous = candidate.style.getPropertyValue("pointer-events");
            const priority = candidate.style.getPropertyPriority("pointer-events");
            candidate.style.setProperty("pointer-events", "auto", "important");
            try {
              for (const point of samplePoints(overlap)) {
                const hit = hitAtPoint(point.x, point.y);
                if (!related(candidate, hit)) continue;
                const style = getComputedStyle(candidate);
                pushFinding({
                  class: "B",
                  targetSelector: target.selector,
                  targetName: target.name,
                  targetKind: target.kind,
                  occluderSelector: stableSelector(candidate),
                  occluderName: semanticNameOf(candidate),
                  sample: point.label,
                  point: { x: rounds(point.x), y: rounds(point.y) },
                  targetRect: rectLike(target.rect),
                  occluderRect: rectLike(candidateRect),
                  intersectionRect: rectLike(overlap),
                  scrollX: Math.round(window.scrollX),
                  scrollY: Math.round(window.scrollY),
                  nestedScrollerSelector,
                  nestedScrollTop: nestedScroller ? Math.round(nestedScroller.scrollTop) : null,
                  targetPosition: getComputedStyle(target.owner).position,
                  occluderPosition: style.position,
                  occluderZIndex: style.zIndex,
                  occluderOpaqueBoxPaint: opaqueBoxPaint(candidate),
                  intentionalScrollShell: intentionalScrollShell(
                    candidate,
                    style.position,
                    nestedScroller,
                  ),
                  ...relationshipFlags(target.owner, candidate),
                });
                break;
              }
            } finally {
              if (previous) candidate.style.setProperty("pointer-events", previous, priority);
              else candidate.style.removeProperty("pointer-events");
            }
          }
        }
      };
      const positions = (maximum: number, viewport: number) => {
        if (maximum <= 0) return [0];
        const step = Math.max(1, Math.floor(viewport * 0.75));
        const values: number[] = [];
        for (let value = 0; value < maximum; value += step) values.push(value);
        values.push(maximum);
        return [...new Set(values)];
      };

      try {
        const maxWindowScroll = Math.max(
          0,
          document.documentElement.scrollHeight - document.documentElement.clientHeight,
        );
        for (const scrollY of positions(maxWindowScroll, innerHeight)) {
          window.scrollTo(0, scrollY);
          await settleFrames();
          scanCurrent(null);

          const nestedScrollers = [...document.querySelectorAll<HTMLElement>("body *")].filter(
            (element) => {
              const style = getComputedStyle(element);
              return (
                semanticTargetVisible(element) &&
                element.scrollHeight > element.clientHeight + 1 &&
                ["auto", "scroll"].includes(style.overflowY)
              );
            },
          );
          for (const scroller of nestedScrollers) {
            const originalScrollTop = scroller.scrollTop;
            const maximum = scroller.scrollHeight - scroller.clientHeight;
            for (const nestedScrollTop of positions(maximum, scroller.clientHeight)) {
              scroller.scrollTop = nestedScrollTop;
              await settleFrames();
              scanCurrent(scroller);
            }
            scroller.scrollTop = originalScrollTop;
          }
        }
      } finally {
        window.scrollTo(originalWindowScroll.x, originalWindowScroll.y);
        document.documentElement.style.scrollBehavior = originalScrollBehavior;
        await settleFrames();
      }
      return findings;
    },
    { interactiveSelector: controlSelector },
  );
}
