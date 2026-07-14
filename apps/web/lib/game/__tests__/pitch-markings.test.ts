// Pitch markings are presentation-only. This test keeps that contract narrow:
// the SVG layer may render, but slot coordinates must stay identical to the
// existing formation layout adapter + render-time anti-overlap pass.

import { describe, expect, it } from "vitest";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CardId, LinkedPair } from "@wcdraft/core";
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

function filledStarterViews(
  filled: Record<
    string,
    { name: string; nation_id: string; nation_name: string; nation_code: string }
  >,
): PitchSlotView[] {
  return starterViews().map((slot) => {
    const card = filled[slot.slot_id];
    if (!card) return slot;
    return {
      ...slot,
      card: {
        kind: "player",
        card_id: `${slot.slot_id}:card` as CardId,
        player_id: `${slot.slot_id}:player`,
        tournament_id: 1,
        year: 2026,
        name: card.name,
        full_name: card.name,
        nation_id: card.nation_id,
        nation_name: card.nation_name,
        nation_code: card.nation_code,
        shirt_number: null,
        position_listed: slot.line,
        primary_position: slot.line,
        eligible_positions: [slot.line],
        club_label: null,
        captain: null,
        rating: {
          overall: 80,
          attack: 80,
          midfield: 80,
          defense: 80,
          goalkeeping: 80,
          coverage: 1,
          provenance: "wc_performance",
          badge_kind: "historical",
          badge_label: "Historical",
          basis: "career",
        },
        basis_delta_label: null,
        stats: [],
      },
    };
  });
}

function renderedSlotCoords(html: string): Array<[number, number]> {
  return Array.from(html.matchAll(/style="left:([^%;]+)%;top:([^%]+)%"/g)).map((match) => [
    Number(match[1]),
    Number(match[2]),
  ]);
}

describe("Pitch markings", () => {
  it("renders the vertical marking layer below synergy and slot nodes", () => {
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
    expect(html).toContain('viewBox="0 0 100 150"');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain('data-mark="outer"');
    expect(html).toContain('data-mark="penalty-area"');
    expect(html).toContain('data-mark="goal-box"');
    expect(html).not.toContain('data-mark="corner-arcs"');
    expect(synergyAt).toBeGreaterThan(markingsAt);
    expect(firstSlotAt).toBeGreaterThan(synergyAt);
  });

  it("paints a live line for a linked same-nation adjacent pair", () => {
    const livePair: LinkedPair = {
      slot_id_a: "4-3-3.LW",
      slot_id_b: "4-3-3.ST",
      linked: true,
      nation_id: "T-03",
    };
    const html = renderToStaticMarkup(
      createElement(Pitch, {
        formationId: "4-3-3",
        starters: filledStarterViews({
          "4-3-3.LW": {
            name: "Left",
            nation_id: "T-03",
            nation_name: "Brazil",
            nation_code: "BRA",
          },
          "4-3-3.ST": {
            name: "Striker",
            nation_id: "T-03",
            nation_name: "Brazil",
            nation_code: "BRA",
          },
        }),
        linkedPairs: [livePair],
        showInactiveEdges: true,
      }),
    );

    expect(html).toContain('data-pitch-synergy="true"');
    expect(html).toContain("synergyLineLive");
    expect(html).not.toContain("synergyLineIdle");
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
    expect(html).toContain('viewBox="0 0 100 150"');
    expect(html).toContain('data-mark="center-circle"');
    expect(html).toContain('data-mark="penalty-area"');
  });
});
