// q-001 item 1 — Synergy DISPLAY rounding at the seam.
//
// The live reveal surfaced a raw fractional Synergy (18.649350649350648).
// These probes string-render the display components with a fractional
// engine value and assert the rendered DOM carries the rounded integer —
// the engine value itself stays fractional (display-only formatting).

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SynergyResult } from "@wcdraft/core";

import { SynergyBar } from "@/components/game/synergy-bar";

const FRACTIONAL = 18.649350649350648;

function result(overall: number): SynergyResult {
  return {
    overall,
    multiplier: 1.0466,
    manager_link: 0,
    linked_pairs: [
      { a: "c1", b: "c2", linked: true, reason: "nation" },
    ],
  } as unknown as SynergyResult;
}

describe("synergy display rounding (display seam only)", () => {
  it("headline renders the rounded integer, never the raw float", () => {
    const html = renderToStaticMarkup(
      createElement(SynergyBar, { result: result(FRACTIONAL), active: true }),
    );
    expect(html).toContain(">19<");
    expect(html).not.toContain("18.649");
  });

  it("delta renders rounded; a delta that rounds to 0 hides", () => {
    const shown = renderToStaticMarkup(
      createElement(SynergyBar, {
        result: result(FRACTIONAL),
        delta: 2.3506493506493515,
        active: true,
      }),
    );
    expect(shown).toContain("▲ 2");
    expect(shown).toContain("Synergy up 2 points");
    expect(shown).not.toContain("2.35");

    const hidden = renderToStaticMarkup(
      createElement(SynergyBar, {
        result: result(FRACTIONAL),
        delta: 0.4,
        active: true,
      }),
    );
    expect(hidden).not.toContain("▲");
    expect(hidden).not.toContain("▼");
  });
});
