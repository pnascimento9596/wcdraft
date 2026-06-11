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
//   - Bundle census (diagnosis lock): club coverage today is 2026-only.
//     When the MV2-12b backfill regen lands, the census assertions below are
//     EXPECTED to flip and must be updated with the new real counts.

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

  it("bundle census lock — club is 2026-only today (flips at MV2-12b backfill)", () => {
    const withClub = DRAFT_POOL_BUNDLE.player_cards.filter(
      (c) => (c.club_at_tournament ?? c.club) != null,
    );
    expect(DRAFT_POOL_BUNDLE.player_cards.length).toBe(12219);
    expect(withClub.length).toBe(1246);
    expect(withClub.every((c) => idx.tournamentById.get(c.tournament_id)?.year === 2026)).toBe(
      true,
    );
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
