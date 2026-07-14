import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FactualRecap } from "@/components/game/factual-recap";
import type { GameData } from "../data";
import { buildFactualRecap, deriveBox, type FactualRecapView } from "../results-adapters";
import type { RunRecordV1 } from "../run-record";
import type { MatchResult } from "@wcdraft/core";

function view(overrides: Partial<FactualRecapView> = {}): FactualRecapView {
  return {
    finalMatchLabel: "Final",
    lineStrengths: {
      attack: "78.4",
      midfield: "81.2",
      defense: "76.9",
      goalkeeping: "84.0",
    },
    belowNaturalFit: { count: 0, starters: [] },
    synergy: {
      multiplier: "×1.041",
      nationLines: [{ nation: "Brazil", starters: 4 }],
    },
    manager: {
      presence: "Present · +1 tier",
      link: "Full link · +2 tier",
      tactical: "+3 applied · ×1.020",
    },
    activations: [],
    shortHandedMatches: [],
    ...overrides,
  };
}

function render(recap: FactualRecapView): string {
  return renderToStaticMarkup(createElement(FactualRecap, { view: recap }));
}

function visibleCopy(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

describe("factual recap render matrix", () => {
  it("renders honest empty channels for a zero-activation run", () => {
    const html = render(view());
    expect(html).toContain("No activations");
    expect(html).toContain("Short-handed matches");
    expect(html).not.toContain("Event log");
  });

  it("renders every activation with its factual line consequence and real event anchor", () => {
    const html = render(
      view({
        activations: [
          {
            matchId: "m0",
            matchLabel: "Group · M1",
            eventId: "availability:m0:0",
            incomingName: "Ronaldo",
            outgoingName: "Pelé",
            line: "Attack",
            contributionDelta: "−3.2",
          },
          {
            matchId: "m1",
            matchLabel: "Group · M2",
            eventId: "availability:m1:0",
            incomingName: "Cafu",
            outgoingName: "Carlos Alberto",
            line: "Defense",
            contributionDelta: "+0.7",
          },
        ],
      }),
    );
    expect(html).toContain("Ronaldo");
    expect(html).toContain("Attack slot contribution −3.2");
    expect(html).toContain("Defense slot contribution +0.7");
    expect(html).toContain('href="#event-m0-availability%3Am0%3A0"');
    expect(html.match(/Event log/g)).toHaveLength(2);
  });

  it("renders short-handed matches from their persisted availability entries", () => {
    const html = render(
      view({
        shortHandedMatches: [
          {
            matchId: "m2",
            matchLabel: "Group · M3",
            entries: [
              {
                eventId: "availability:m2:0",
                playerName: "Lev Yashin",
                line: "Goalkeeping",
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("Lev Yashin unavailable · Goalkeeping unfilled");
    expect(html).toContain('href="#event-m2-availability%3Am2%3A0"');
  });

  it("renders the reachable managerless factual tier without inventing a manager", () => {
    const html = render(
      view({
        manager: {
          presence: "No manager · +0 tier",
          link: "No link · +0 tier",
          tactical: "+0 applied · ×1.000",
        },
      }),
    );
    expect(html).toContain("No manager · +0 tier");
    expect(html).toContain("No link · +0 tier");
    expect(html).toContain("+0 applied · ×1.000");
  });

  it("keeps unavailable persisted channels honest", () => {
    const html = render(
      view({
        lineStrengths: null,
        belowNaturalFit: null,
        synergy: null,
        manager: null,
      }),
    );
    expect(visibleCopy(html)).toContain("Final line strength —");
    expect(visibleCopy(html)).toContain(
      "Below-natural-fit starters — · not recorded for this arranged XI",
    );
    expect(visibleCopy(html)).toContain("Synergy —");
    expect(visibleCopy(html)).toContain("Manager —");
  });
});

describe("factual recap copy and semantics", () => {
  it("locks the factual copy surface and excludes counterfactual language", () => {
    const copy = visibleCopy(
      render(
        view({
          belowNaturalFit: {
            count: 1,
            starters: [{ name: "Zico", slot: "LB", fit: "75%" }],
          },
        }),
      ),
    );
    expect(copy).toMatchInlineSnapshot(
      '"Persisted match facts Why it went this way Run-record facts · final match: Final Final line strength Attack 78.4 Midfield 81.2 Defense 76.9 Goalkeeping 84.0 Below-natural-fit starters 1 Zico LB · 75% fit Synergy ×1.041 Brazil 4 starters Manager Presence Present · +1 tier Nation link Full link · +2 tier Tactical band +3 applied · ×1.020 Bench activations No activations Short-handed matches —"',
    );
    expect(copy).not.toMatch(/would have|could have|should have|cost you|won you/i);
  });

  it("uses a labelled region, ordered headings, definitions, and named links", () => {
    const html = render(
      view({
        activations: [
          {
            matchId: "m0",
            matchLabel: "Group · M1",
            eventId: "availability:m0:0",
            incomingName: "Ronaldo",
            outgoingName: "Pelé",
            line: "Attack",
            contributionDelta: "−3.2",
          },
        ],
      }),
    );
    expect(html).toContain('aria-labelledby="factual-recap-title"');
    expect(html).toContain('<h2 id="factual-recap-title"');
    expect(html.match(/<h3/g)).toHaveLength(6);
    expect(html).toContain("<dl");
    expect(html).toContain(">Event log</a>");
    expect(html).not.toMatch(/<div[^>]+onClick/);
  });
});

describe("factual recap persisted-fact adapter", () => {
  const gameData = {
    indexes: {
      playerByCardId: new Map([
        ["out-card", { common_name: "Pelé", full_name: "Edson Arantes" }],
        ["in-card", { common_name: "Ronaldo", full_name: "Ronaldo Nazário" }],
      ]),
      nationById: new Map([["BRA", { canonical_name: "Brazil", code: "BRA" }]]),
    },
  } as unknown as GameData;
  const record = {
    draft: {
      squad: [
        {
          slot_id: "xi.lb",
          slot_position: "LB",
          is_starter: true,
          card_id: "out-card",
          player_id: "pele",
          position_compatibility: 0.75,
        },
      ],
    },
  } as unknown as Pick<RunRecordV1, "draft" | "arrangement">;
  const match = {
    match_id: "m0",
    match_index: 0,
    round: "G1",
    team_facts: {
      active_strength: {
        attack: 70,
        midfield: 71,
        defense: 72,
        goalkeeping: 73,
        coverage: 1,
      },
      post_tactical_strength: {
        attack: 74.444,
        midfield: 75.555,
        defense: 76.666,
        goalkeeping: 77.777,
        coverage: 1,
      },
      tactical_applied_to_outcome: true,
      active_synergy: {
        multiplier: 1.04125,
        nation_clusters: [{ nation_id: "BRA", slot_ids: ["a", "b"], size: 2 }],
      },
      manager_present: true,
      manager_presence_band: 1,
      manager_link_band: 2,
      manager_tactical_band: 3,
      manager_tactical_multiplier: 1.02,
      bench_activations: [
        {
          out_card_id: "out-card",
          out_player_id: "pele",
          in_card_id: "in-card",
          in_player_id: "ronaldo",
          slot_id: "xi.lb",
          line: "DF",
          line_contribution_delta: -2.25,
        },
      ],
      short_handed_slot_ids: [],
    },
    events: [
      {
        type: "availability",
        event_id: "availability:m0:0",
        minute: 0,
        period: "1H",
        side: "user",
        card_id: "out-card",
        player_id: "pele",
        slot_id: "xi.lb",
        position: "DF",
        reason: "knock",
        duration_matches: 1,
        replacement_card_id: "in-card",
        replacement_player_id: "ronaldo",
        short_handed: false,
      },
    ],
  } as unknown as MatchResult;

  it("reads persisted strengths, tiers, clusters, fit, activations, and event ids", () => {
    const recap = buildFactualRecap(gameData, record, [match]);
    expect(recap).toMatchObject({
      finalMatchLabel: "Group · M1",
      lineStrengths: {
        attack: "74.4",
        midfield: "75.6",
        defense: "76.7",
        goalkeeping: "77.8",
      },
      belowNaturalFit: {
        count: 1,
        starters: [{ name: "Pelé", slot: "LB", fit: "75%" }],
      },
      synergy: {
        multiplier: "×1.041",
        nationLines: [{ nation: "Brazil", starters: 2 }],
      },
      manager: {
        presence: "Present · +1 tier",
        link: "Full link · +2 tier",
        tactical: "+3 applied · ×1.020",
      },
      activations: [
        {
          eventId: "availability:m0:0",
          incomingName: "Ronaldo",
          outgoingName: "Pelé",
          line: "Defense",
          contributionDelta: "−2.3",
        },
      ],
    });
  });

  it("projects persisted availability entries into the match event-log view", () => {
    expect(deriveBox(gameData, match).availability).toEqual([
      {
        eventId: "availability:m0:0",
        name: "Pelé",
        replacement: "Ronaldo",
      },
    ]);
  });

  it("does not recompute below-natural fit for a compact arranged sheet", () => {
    const recap = buildFactualRecap(gameData, { ...record, arrangement: ["out-card"] }, [match]);
    expect(recap.belowNaturalFit).toBeNull();
  });
});
