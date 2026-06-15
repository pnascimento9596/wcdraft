// Realistic pitch markings are presentation-only. This test keeps that contract
// narrow: the SVG layer may render, but slot coordinates must stay identical to
// the existing formation layout adapter + render-time anti-overlap pass.

import { describe, expect, it } from "vitest";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { LinkedPair } from "@wcdraft/core";
import { Pitch, PitchMarkings } from "@/components/game/pitch";
import type { PitchSlotView } from "../view-models";
import { getFormationVisualSlots } from "../formation-layout";
import { adjustPitchLayoutForRender } from "../pitch-layout";

function starterViews(formationId = "4-3-3"): PitchSlotView[] {
  return getFormationVisualSlots(formationId).map((slot) => ({
    slot_id: slot.slot_id,
    is_starter: true,
    slot_position: slot.display_label as PitchSlotView["slot_position"],
    line: slot.position_line,
    channel: "C",
    card: null,
    position_compatibility: 0,
    warnings: [],
  }));
}

function renderedSlotCoords(html: string): Array<[number, number]> {
  return Array.from(html.matchAll(/style="left:([^%;]+)%;top:([^%]+)%"/g)).map((match) => [
    Number(match[1]),
    Number(match[2]),
  ]);
}

describe("Pitch markings", () => {
  it("renders the realistic marking layer below synergy and slot nodes", () => {
    const inactivePair: LinkedPair = {
      slot_id_a: "4-3-3.LW",
      slot_id_b: "4-3-3.ST",
      linked: false,
      nation_id: null,
    };
    const html = renderToStaticMarkup(
      createElement(Pitch, {
        formationId: "4-3-3",
        starters: starterViews(),
        linkedPairs: [inactivePair],
        showInactiveEdges: true,
      }),
    );

    const markingsAt = html.indexOf('data-pitch-markings="full"');
    const synergyAt = html.indexOf('data-pitch-synergy="true"');
    const firstSlotAt = html.indexOf('aria-label="GK');

    expect(markingsAt).toBeGreaterThanOrEqual(0);
    expect(html).toContain('data-mark="touchline"');
    expect(html).toContain('data-mark="penalty-area"');
    expect(html).toContain('data-mark="six-yard-box"');
    expect(html).toContain('data-mark="corner-arcs"');
    expect(synergyAt).toBeGreaterThan(markingsAt);
    expect(firstSlotAt).toBeGreaterThan(synergyAt);
  });

  it("keeps rendered node coordinates unchanged", () => {
    const canonical = getFormationVisualSlots("4-3-3");
    const expected = adjustPitchLayoutForRender(canonical).map(
      (slot) => [slot.x_pct, slot.y_pct] as [number, number],
    );
    const html = renderToStaticMarkup(
      createElement(Pitch, {
        formationId: "4-3-3",
        starters: starterViews(),
      }),
    );
    const rendered = renderedSlotCoords(html);

    expect(rendered).toEqual(expected);
    expect(rendered).toMatchInlineSnapshot(`
      [
        [
          50,
          91.7,
        ],
        [
          14,
          71,
        ],
        [
          38,
          76.3,
        ],
        [
          62,
          76.3,
        ],
        [
          86,
          71,
        ],
        [
          50,
          55,
        ],
        [
          30,
          44,
        ],
        [
          70,
          44,
        ],
        [
          18,
          17,
        ],
        [
          50,
          11,
        ],
        [
          82,
          17,
        ],
      ]
    `);
  });

  it("exposes the same SVG layer in mini-pitch mode", () => {
    const html = renderToStaticMarkup(createElement(PitchMarkings, { variant: "mini" }));

    expect(html).toContain('data-pitch-markings="mini"');
    expect(html).toContain('data-mark="center-circle"');
    expect(html).toContain('data-mark="penalty-area"');
  });
});
