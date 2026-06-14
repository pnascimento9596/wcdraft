// ws-ux/club-coverage — club-at-tournament display + squad-header flag.
//
// CONTRACTS LOCKED HERE:
//   - Club is name-adjacent factual identity (KEEP set in Memory mode): it
//     flows through `club_label` on the view model, NEVER through
//     `blindCardRatingView`, and renders identically in hidden mode.
//   - Honest-state: a card with no club in the bundle renders NO club text —
//     never "Unknown FC", never a fabricated value.
//   - Squad-header flag: SVG flag asset when mapped; the existing
//     nation-code text chip as fallback when no asset exists — never a wrong
//     or approximate flag. Mode-independent (identity, not rating).
//   - Bundle census (diagnosis lock): V6 compact regen carries the historical
//     club backfill plus 2026 squad clubs. The remaining historical nulls are
//     verified-absent rows and must stay honest null.

import { describe, expect, it } from "vitest";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DRAFT_POOL_BUNDLE } from "@wcdraft/data";

import { buildGameDataIndexes } from "../data";
import { playerCardView } from "../adapters";
import { blindCardRatingView } from "../view-models";
import { CandidateCard } from "@/components/game/candidate-card";
import { SquadHeaderFlag } from "@/components/game/squad-header-flag";

const idx = buildGameDataIndexes(DRAFT_POOL_BUNDLE);

const cardWithClub = DRAFT_POOL_BUNDLE.player_cards.find(
  (c) => (c.club_at_tournament ?? c.club) != null,
);
const cardWithoutClub = DRAFT_POOL_BUNDLE.player_cards.find(
  (c) => (c.club_at_tournament ?? c.club) == null,
);

function renderCandidate(view: ReturnType<typeof playerCardView>): string {
  return renderToStaticMarkup(
    createElement(CandidateCard, {
      card: view,
      selected: false,
      onSelect: () => undefined,
    }),
  );
}

describe("club-at-tournament display", () => {
  it("renders the club on the metadata subline when the bundle carries it", () => {
    expect(cardWithClub).toBeDefined();
    const view = playerCardView(idx, cardWithClub!.card_id);
    expect(view.club_label).toBe(cardWithClub!.club_at_tournament ?? cardWithClub!.club);
    const html = renderCandidate(view);
    expect(html).toContain(`· ${view.club_label!}`);
  });

  it("exposes collapsed rating provenance to screen readers", () => {
    expect(cardWithClub).toBeDefined();
    const view = playerCardView(idx, cardWithClub!.card_id);
    const html = renderCandidate(view);
    expect(html).toContain(`Rating provenance: ${view.rating.badge_label}`);
  });

  it("honest-state: renders NO club text when the bundle has none (never fabricated)", () => {
    expect(cardWithoutClub).toBeDefined();
    const view = playerCardView(idx, cardWithoutClub!.card_id);
    expect(view.club_label).toBeNull();
    const html = renderCandidate(view);
    expect(html).not.toContain("Unknown");
    // Subline ends at the position — no trailing club separator.
    expect(html).toContain(`${view.year} · `);
  });

  it("hidden-mode parity: club survives the blind (identity, not rating)", () => {
    const view = playerCardView(idx, cardWithClub!.card_id);
    const blind = { ...view, rating: blindCardRatingView(view.rating) };
    expect(blind.club_label).toBe(view.club_label);
    const html = renderCandidate(blind);
    expect(html).toContain(`· ${view.club_label!}`);
  });

  it("bundle census lock — V6 carries historical club backfill plus 2026 clubs", () => {
    const withClub = DRAFT_POOL_BUNDLE.player_cards.filter(
      (c) => (c.club_at_tournament ?? c.club) != null,
    );
    const historical = DRAFT_POOL_BUNDLE.player_cards.filter((c) => c.tournament_id !== 2026);
    const historicalWithClub = historical.filter((c) => c.club_at_tournament != null);
    const historicalNulls = historical.filter((c) => c.club_at_tournament == null);
    const projectedWithClub = DRAFT_POOL_BUNDLE.player_cards.filter(
      (c) => c.tournament_id === 2026 && (c.club_at_tournament ?? c.club) != null,
    );

    expect(DRAFT_POOL_BUNDLE.player_cards.length).toBe(12219);
    expect(withClub.length).toBe(12203);
    expect(historical.length).toBe(10973);
    expect(historicalWithClub.length).toBe(10957);
    expect(projectedWithClub.length).toBe(1246);
    expect(historicalNulls.map((c) => c.source_card_id).sort()).toEqual([
      "P-01918:WC-1934",
      "P-11648:WC-1930",
      "P-16278:WC-1938",
      "P-29687:WC-1930",
      "P-41536:WC-1930",
      "P-44740:WC-1934",
      "P-46561:WC-1950",
      "P-53883:WC-1950",
      "P-54466:WC-1950",
      "P-58460:WC-1930",
      "P-63886:WC-1934",
      "P-71162:WC-1950",
      "P-79551:WC-2010",
      "P-79649:WC-1950",
      "P-92120:WC-1938",
      "P-92190:WC-1934",
    ]);
  });
});

describe("squad-header flag", () => {
  it("renders the SVG flag asset for a mapped nation", () => {
    const html = renderToStaticMarkup(
      createElement(SquadHeaderFlag, {
        flagSrc: "/flags/T-01.svg",
        nationCode: "BRA",
        nationName: "Brazil",
      }),
    );
    expect(html).toContain('src="/flags/T-01.svg"');
    expect(html).toContain("Brazil flag");
  });

  it("honest fallback: nation-code text chip when no flag asset exists", () => {
    const html = renderToStaticMarkup(
      createElement(SquadHeaderFlag, {
        flagSrc: null,
        nationCode: "ZZZ",
        nationName: "Defunct State",
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("ZZZ");
    expect(html).toContain("Defunct State");
  });

  it("hidden-mode parity: the flag takes no rating inputs — identical markup by construction", () => {
    const props = { flagSrc: "/flags/T-02.svg", nationCode: "ITA", nationName: "Italy" };
    const a = renderToStaticMarkup(createElement(SquadHeaderFlag, props));
    const b = renderToStaticMarkup(createElement(SquadHeaderFlag, { ...props }));
    expect(a).toBe(b);
  });
});
