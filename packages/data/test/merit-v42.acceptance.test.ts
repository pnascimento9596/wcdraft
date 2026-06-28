import { describe, expect, it } from "vitest";

import {
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  RUNTIME_DATA_SCHEMA_VERSION,
  SCENARIO_2026_BUNDLE,
} from "../src/index.js";
import type { RuntimePlayerCard, RuntimeRating } from "../src/types.js";

const ratingByCardId = new Map(DRAFT_POOL_BUNDLE.ratings.map((r) => [r.card_id, r]));
const cardByCardId = new Map(DRAFT_POOL_BUNDLE.player_cards.map((c) => [c.card_id, c]));
const teamByName = new Map(
  SCENARIO_2026_BUNDLE.teams.map((team) => [
    SCENARIO_2026_BUNDLE.team_display_names[team.team_id],
    team,
  ]),
);

function asCardId(cardId: string): RuntimeRating["card_id"] {
  return cardId as RuntimeRating["card_id"];
}

function rating(cardId: string): RuntimeRating {
  const value = ratingByCardId.get(asCardId(cardId));
  if (!value) throw new Error(`missing rating for ${cardId}`);
  return value;
}

function card(cardId: string): RuntimePlayerCard {
  const value = cardByCardId.get(asCardId(cardId));
  if (!value) throw new Error(`missing player card for ${cardId}`);
  return value;
}

function component(row: RuntimeRating, signal: string): unknown {
  return row.components?.find((c) => c.signal === signal)?.value;
}

function hasManualOverride(row: RuntimeRating): boolean {
  // merit-v4.3 pinned the career (default) basis via `manual_rating_override`;
  // merit-v4.4 pins the CURRENT basis via `manual_current_rating_override`. Both
  // are owner pins and are exempt from the non-manual de-clustering invariant.
  return (
    component(row, "manual_rating_override") !== undefined ||
    component(row, "manual_current_rating_override") !== undefined
  );
}

function squadRatings(teamName: string): Array<{ card: RuntimePlayerCard; rating: RuntimeRating }> {
  const team = teamByName.get(teamName);
  if (!team) throw new Error(`missing 2026 team ${teamName}`);
  return team.squad_card_ids
    .map((cardId) => ({ card: card(cardId), rating: rating(cardId) }))
    .sort((a, b) => (b.rating.overall ?? -1) - (a.rating.overall ?? -1));
}

function isMaterialHeadroom(row: RuntimeRating): boolean {
  return (
    row.overall_basis === "career_stature_estimate" ||
    Number(component(row, "stature_model_weight") ?? 0) >= 0.5
  );
}

function isEliteGated(row: RuntimeRating): boolean {
  return (
    hasManualOverride(row) ||
    row.legend ||
    isMaterialHeadroom(row) ||
    Number(component(row, "award_headroom") ?? 0) > 0 ||
    Number(component(row, "award_score") ?? 0) > 0
  );
}

function currentRating(cardId: string): RuntimeRating {
  return rating(cardId).basis_ratings.current as RuntimeRating;
}

function maxDuplicateOverall(rows: RuntimeRating[]): number {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.overall ?? -1, (counts.get(row.overall ?? -1) ?? 0) + 1);
  return Math.max(...counts.values());
}

describe("merit-v4.6 ratings-coverage acceptance probes", () => {
  it("bumps every shipped replay/data/version anchor for the merit-v4.6 season", () => {
    expect(RUNTIME_DATA_SCHEMA_VERSION).toBe("runtime-data-2.8.0");
    expect(DRAFT_POOL_BUNDLE.schema_version).toBe("runtime-data-2.8.0");
    expect(SCENARIO_2026_BUNDLE.schema_version).toBe("runtime-data-2.8.0");
    expect(RUNTIME_DATA_MANIFEST.schema_version).toBe("runtime-data-2.8.0");
    expect(RUNTIME_DATA_MANIFEST.rating_version_historical).toBe("wc-perf-6.6.0");
    expect(RUNTIME_DATA_MANIFEST.rating_version_projected).toBe("proj-career-5.6.0");
    expect(RUNTIME_DATA_MANIFEST.engine_version).toBe("engine-2026.06.28-merit-v4.6");
  });

  it("keeps the pre-registered elite European anchors unchanged", () => {
    expect(rating("P-63927:2022").overall).toBe(90); // Gareth Bale
    expect(rating("P-80105:2002").overall).toBe(90); // Zlatan Ibrahimovic
    expect(rating("P-80105:2006").overall).toBe(90); // Zlatan Ibrahimovic
    expect(rating("P-W26-0477:2026").overall).toBe(92); // Erling Haaland
  });

  it("keeps Son in the elite 2026 band", () => {
    const son = rating("P-77335:2026");
    expect(son.overall).toBeGreaterThanOrEqual(88);
    expect(isMaterialHeadroom(son)).toBe(true);
  });

  it("makes Salem Al-Dawsari a clear Saudi standout without lifting journeymen", () => {
    const saudi = squadRatings("Saudi Arabia");
    const [top, runnerUp] = saudi;
    expect(top?.card.card_id).toBe("P-70583:2026");
    expect(top?.rating.overall).toBeGreaterThanOrEqual(84);
    expect((top?.rating.overall ?? 0) - (runnerUp?.rating.overall ?? 0)).toBeGreaterThanOrEqual(3);
    expect(isMaterialHeadroom(rating("P-70583:2026"))).toBe(true);

    const journeymanControls = [
      "P-10907:2026", // Nasser Al-Dawsari
      "P-W26-0561:2026", // Abdullah Al-Hamdan
      "P-W26-0570:2026", // Musab Al-Juwayr
      "P-35320:2026", // Cristian Roldan
      "P-W26-0747:2026", // Maximilian Arfsten
    ];
    for (const cardId of journeymanControls) {
      const row = rating(cardId);
      expect(
        row.overall,
        `${cardId} should remain outside the elevated standout band`,
      ).toBeLessThan(83);
      expect(isMaterialHeadroom(row), `${cardId} should stay raw/current-path`).toBe(false);
    }
  });

  it("adds material headroom standouts for the targeted AFC and CONCACAF zero-headroom squads", () => {
    const expectedStandouts = new Map<string, string>([
      ["Mexico", "P-57865:2026"],
      ["Canada", "P-46358:2026"],
      ["United States", "P-11737:2026"],
      ["Haiti", "P-W26-0291:2026"],
      ["Panama", "P-W26-0500:2026"],
      ["Qatar", "P-47319:2026"],
      ["Australia", "P-10244:2026"],
      ["Japan", "P-26303:2026"],
      ["Iran", "P-85860:2026"],
      ["Saudi Arabia", "P-70583:2026"],
      ["Iraq", "P-W26-0332:2026"],
      ["Uzbekistan", "P-W26-0876:2026"],
    ]);

    for (const [teamName, expectedCardId] of expectedStandouts) {
      const squad = squadRatings(teamName);
      const material = squad.filter(({ rating: row }) => isMaterialHeadroom(row));
      expect(material.length, `${teamName} material-headroom count`).toBeGreaterThanOrEqual(1);

      const standout = squad.find(({ card }) => card.card_id === expectedCardId);
      expect(standout, `${teamName} named standout ${expectedCardId}`).toBeDefined();
      expect(
        isMaterialHeadroom(standout!.rating),
        `${teamName} named standout ${expectedCardId} should be material`,
      ).toBe(true);
      expect(
        standout!.rating.overall,
        `${teamName} named standout ${expectedCardId} should be visibly separated`,
      ).toBeGreaterThanOrEqual(82);
    }
  });

  it("keeps 90-plus ratings rare and stature gated", () => {
    const eliteRows = DRAFT_POOL_BUNDLE.ratings.filter((row) => (row.overall ?? 0) >= 90);
    expect(eliteRows.length / DRAFT_POOL_BUNDLE.ratings.length).toBeLessThanOrEqual(0.03);
    for (const row of eliteRows) {
      expect(
        isEliteGated(row),
        `${row.card_id} 90+ row should be manual-pinned, legend, material-stature, or honor gated`,
      ).toBe(true);
    }
  });

  it("declusters the owner-reported CAF weak-squad raw-only plateaus", () => {
    const squads = [
      ["Ghana 2022", "2022", "Ghana"],
      ["Morocco 2022", "2022", "Morocco"],
      ["Tunisia 2022", "2022", "Tunisia"],
      ["Ghana 2026", "2026", "Ghana"],
      ["Ivory Coast 2026", "2026", "Ivory Coast"],
      ["South Africa 2026", "2026", "South Africa"],
      ["Tunisia 2026", "2026", "Tunisia"],
    ] as const;

    for (const [label, tournament, nation] of squads) {
      const rows = DRAFT_POOL_BUNDLE.player_cards
        .filter((c) => c.tournament_id === Number(tournament) && c.nation_id)
        .filter((c) => {
          const teamName =
            tournament === "2026"
              ? SCENARIO_2026_BUNDLE.team_display_names[
                  SCENARIO_2026_BUNDLE.teams.find((team) => team.squad_card_ids.includes(c.card_id))
                    ?.team_id ?? ""
                ]
              : undefined;
          if (tournament === "2026") return teamName === nation;
          return DRAFT_POOL_BUNDLE.nations[c.nation_id]?.canonical_name === nation;
        })
        .map((c) => currentRating(c.card_id));

      const nonManualRows = rows.filter((row) => !hasManualOverride(row));

      expect(rows.length, `${label} rows`).toBeGreaterThanOrEqual(23);
      expect(
        maxDuplicateOverall(nonManualRows),
        `${label} max duplicate non-manual current OVR`,
      ).toBeLessThan(5);
      for (const row of rows) {
        expect(
          component(row, "factual_context_score"),
          `${label} ${row.card_id} factual context`,
        ).not.toBeUndefined();
      }
    }
  });
});
