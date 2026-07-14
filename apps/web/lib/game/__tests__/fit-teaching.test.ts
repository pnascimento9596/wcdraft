import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { projectSlotContribution, type SlotPosition } from "@wcdraft/core";
import { DRAFT_POOL_BUNDLE } from "@wcdraft/data";
import { CandidateCard, ManagerCandidate } from "@/components/game/candidate-card";

import { buildGameDataIndexes } from "../data";
import { managerCardView, playerCardView } from "../adapters";
import {
  fitTeachingImpactForMode,
  projectFitTeachingImpact,
  resolveFitTeachingSlot,
  shouldShowFitTeaching,
  type FitTeachingImpact,
  type FitTeachingSlot,
} from "../fit-teaching";
import type { PlayerCardView } from "../view-models";

const indexes = buildGameDataIndexes(DRAFT_POOL_BUNDLE);
const firstPlayerId = DRAFT_POOL_BUNDLE.player_cards[0]!.card_id;
const firstManagerId = DRAFT_POOL_BUNDLE.manager_cards[0]!.manager_card_id;

function renderCandidate(card: PlayerCardView, impact: FitTeachingImpact | null): string {
  return renderToStaticMarkup(
    createElement(CandidateCard, {
      card,
      fitTeachingImpact: impact,
      selected: false,
      onSelect: () => {},
    }),
  );
}

describe("Season 2 S5 fit teaching — engine parity and display basis", () => {
  it.each(["career", "current"] as const)(
    "%s chips preserve projectSlotContribution ordering for one slot context",
    (basis) => {
      const rows = DRAFT_POOL_BUNDLE.player_cards.map((runtimeCard) => {
        const card = playerCardView(indexes, runtimeCard.card_id, { basis });
        const impact = projectFitTeachingImpact(card, "CM");
        expect(impact).not.toBeNull();
        const rating = {
          attack: card.rating.attack!,
          midfield: card.rating.midfield!,
          defense: card.rating.defense!,
          goalkeeping: card.rating.goalkeeping!,
        };
        const engine = projectSlotContribution({
          rating,
          eligible_positions: card.eligible_positions,
          slot_position: "CM",
        });
        expect(impact!.display_delta_tenths).toBe(Math.round((engine.weighted_channel * 10) / 11));
        return { engine: engine.weighted_channel, display: impact!.display_delta_tenths };
      });

      rows.sort((a, b) => a.engine - b.engine);
      for (let index = 1; index < rows.length; index += 1) {
        // Rounded display ties are honest; a stronger engine contribution may
        // never display below a weaker one.
        expect(rows[index]!.display).toBeGreaterThanOrEqual(rows[index - 1]!.display);
      }
    },
  );

  it("uses the adapter-resolved Career and Current channels without reaching around it", () => {
    const changed = DRAFT_POOL_BUNDLE.ratings.find((rating) =>
      (["attack", "midfield", "defense", "goalkeeping"] as const).some(
        (channel) => rating[channel] !== rating.basis_ratings.current[channel],
      ),
    );
    expect(changed).toBeDefined();

    const channel = (["attack", "midfield", "defense", "goalkeeping"] as const).find(
      (candidate) => changed![candidate] !== changed!.basis_ratings.current[candidate],
    )!;
    const slotByChannel: Record<typeof channel, SlotPosition> = {
      attack: "ST",
      midfield: "CM",
      defense: "CB",
      goalkeeping: "GK",
    };
    const career = playerCardView(indexes, changed!.card_id, { basis: "career" });
    const current = playerCardView(indexes, changed!.card_id, { basis: "current" });
    const careerImpact = projectFitTeachingImpact(career, slotByChannel[channel]);
    const currentImpact = projectFitTeachingImpact(current, slotByChannel[channel]);

    expect(careerImpact?.basis).toBe("career");
    expect(currentImpact?.basis).toBe("current");
    expect(career.rating[channel]).toBe(changed![channel]);
    expect(current.rating[channel]).toBe(changed!.basis_ratings.current[channel]);
    expect(careerImpact?.accessible_label).toContain("Career projection");
    expect(currentImpact?.accessible_label).toContain("Current projection");
  });

  it("renders off-natural position copy and the target line's established shape semantics", () => {
    const card: PlayerCardView = {
      ...playerCardView(indexes, firstPlayerId),
      position_listed: "DF",
      primary_position: "DF",
      eligible_positions: ["DF"],
    };
    const impact = projectFitTeachingImpact(card, "CM");
    expect(impact).toMatchObject({
      line: "MF",
      fit_tier: "reduced",
      fit_copy: "reduced fit",
      position_copy: "DF → CM",
    });

    const html = renderCandidate(card, impact);
    expect(html).toContain("data-fit-teaching-chip");
    expect(html).toContain("pre-Synergy");
    expect(html).toContain("DF → CM · reduced fit");
    expect(html).toContain("shapeDot_diamond");
    expect(html).toContain("before Synergy");
  });
});

describe("Season 2 S5 fit teaching — context and mode boundaries", () => {
  const card: PlayerCardView = {
    ...playerCardView(indexes, firstPlayerId),
    card_id: firstPlayerId,
    eligible_positions: ["DF"],
  };
  const slots: FitTeachingSlot[] = [
    { slot_id: "starter.lb", slot_position: "LB", is_starter: true },
    { slot_id: "starter.cm", slot_position: "CM", is_starter: true },
    { slot_id: "bench.0", slot_position: "ST", is_starter: false },
  ];

  it("uses default, locked-target, and selected-slot contexts in that precedence order", () => {
    expect(
      resolveFitTeachingSlot(card, slots, slots, {
        selected_card_id: null,
        selected_slot_id: null,
        locked_target_id: null,
      })?.slot_id,
    ).toBe("starter.lb");

    expect(
      resolveFitTeachingSlot(card, slots, slots, {
        selected_card_id: null,
        selected_slot_id: null,
        locked_target_id: "starter.cm",
      })?.slot_id,
    ).toBe("starter.cm");

    expect(
      resolveFitTeachingSlot(card, slots, slots, {
        selected_card_id: card.card_id,
        selected_slot_id: "starter.lb",
        locked_target_id: "starter.cm",
      })?.slot_id,
    ).toBe("starter.lb");
  });

  it.each([
    { label: "Classic", mode: "classic" as const, daily: false },
    { label: "Open Draft", mode: "open" as const, daily: false },
    { label: "Daily", mode: "classic" as const, daily: true },
  ])("renders the chip in $label", ({ mode, daily }) => {
    expect(shouldShowFitTeaching(mode, daily)).toBe(true);
    const impact = fitTeachingImpactForMode({
      mode,
      daily,
      card,
      slot_position: "LB",
    });
    expect(renderCandidate(card, impact)).toContain("data-fit-teaching-chip");
  });

  it.each([
    { label: "Memory", mode: "hidden" as const },
    { label: "Blind Open", mode: "open_hidden" as const },
  ])("renders no chip in $label", ({ mode }) => {
    const blinded = playerCardView(indexes, firstPlayerId, {
      basis: "career",
      blindRatings: true,
    });
    expect(shouldShowFitTeaching(mode, false)).toBe(false);
    const impact = fitTeachingImpactForMode({
      mode,
      daily: false,
      card: blinded,
      slot_position: "LB",
    });
    expect(impact).toBeNull();
    expect(renderCandidate(blinded, impact)).not.toContain("data-fit-teaching-chip");
  });

  it("never fabricates a strength chip for a manager candidate", () => {
    const html = renderToStaticMarkup(
      createElement(ManagerCandidate, {
        manager: managerCardView(indexes, firstManagerId),
        selected: false,
        onSelect: () => {},
      }),
    );
    expect(html).not.toContain("data-fit-teaching-chip");
    expect(html).not.toContain("pre-Synergy");
  });
});
