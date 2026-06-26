import { describe, expect, it } from "vitest";
import { readGameCssSource } from "./game-css-source";

/**
 * ws-ux/mobile-content — CI-checkable contract for the draft-screen horizontal
 * overflow fix.
 *
 * Symptom (iPhone Safari, prod): the draft/pick screen rendered wider than the
 * visual viewport — formation title "4-3-3" clipped to "-3-3", flag half
 * off-screen, a horizontal scrollbar under the pitch. Root cause: `.candList`
 * is `display: grid` with no explicit columns, so the single track defaulted to
 * `auto`, whose minimum is the row's min-content. `.candRowName`/`.candRowSub`
 * are `white-space: nowrap`, so a long club line (e.g. "Vitória de Guimarães")
 * pushed that min-content past the viewport; the track refused to shrink and
 * the whole `.draftScroll` column scrolled horizontally (measured pre-fix at
 * 390×844: candRow 382.6px inside a 318px container, draftScroll scrollWidth
 * 402 vs clientWidth 356).
 *
 * Like tap-stability.test.ts, CI cannot lay out a real viewport, so the
 * behavioural proof (scrollWidth ≤ clientWidth at 390×844 and 360×800) lives in
 * the PR body as measurement output + before/after screenshots. What CI pins is
 * the CSS contract that makes the column collapsible: the regression back to a
 * bare `auto` grid track is a one-line diff this test must catch.
 */

const css = readGameCssSource();

function block(selector: string): string {
  // Match the FIRST declaration block for an exact selector at line start.
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{[^}]*\\}`);
  return re.exec(css)?.[0] ?? "";
}

describe("draft candidate list overflow contract", () => {
  it(".candList declares a collapsible single column (minmax(0, 1fr))", () => {
    const candList = block(".candList");
    expect(candList).toContain("display: grid");
    // The fix: without this the track is `auto` = min-content floor, which a
    // nowrap name/club line blows past → horizontal overflow.
    expect(candList).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it(".candRowMain can shrink (min-width: 0) so the ellipsis engages", () => {
    const main = block(".candRowMain");
    expect(main).toContain("min-width: 0");
  });

  it(".candRowName and .candRowSub clip with an ellipsis rather than widening the row", () => {
    for (const sel of [".candRowName", ".candRowSub"]) {
      const b = block(sel);
      expect(b, sel).toContain("white-space: nowrap");
      expect(b, sel).toContain("overflow: hidden");
      expect(b, sel).toContain("text-overflow: ellipsis");
    }
  });
});
