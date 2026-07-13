import type { DraftState, SquadSlot } from "../types/draft.js";
import type { FormationTemplate, SlotPosition } from "../types/formation.js";
import { POSITION_COMPATIBILITY_FACTORS, slotPositionLine } from "../types/formation.js";
import type { ManagerRating, ManagerTournament } from "../types/manager.js";
import type { Position } from "../types/primitives.js";
import type { Rating, TeamStrength } from "../types/rating.js";
import type {
  AvailabilityFact,
  BenchActivationFact,
  MatchTeamFacts,
  SimWorld,
} from "../types/sim.js";
import type { SynergyResult } from "../types/synergy.js";
import { createRng, deriveSubseed } from "../rng.js";
import { INJURY } from "./calibration.js";
import { applyManagerTacticalAdjustment } from "./manager-tactics.js";
import { computeSynergy } from "./synergy.js";
import {
  aggregateActiveXiStrength,
  aggregateUserXiStrength,
  projectSlotContribution,
} from "./team-strength.js";
import type { StarterContribution } from "../api/team-strength.js";

export interface AvailabilityState {
  readonly absences: Map<string, TrackedAbsence>;
  minorEventCount: number;
}

export interface TrackedAbsence extends AvailabilityFact {
  /** Inclusive match index. Infinity represents tournament-ending. */
  unavailable_through: number;
}

export interface ActiveTeamResolution {
  activeSquad: SquadSlot[];
  facts: MatchTeamFacts;
}

export function createAvailabilityState(): AvailabilityState {
  return { absences: new Map(), minorEventCount: 0 };
}

/** Same or adjacent outfield family under the canonical compatibility matrix; GK is isolated. */
export function isHardFamilyEligible(eligible: readonly Position[], target: Position): boolean {
  if (eligible.length === 0) return false;
  if (target === "GK") return eligible.includes("GK");
  return eligible.some(
    (candidate) => candidate !== "GK" && POSITION_COMPATIBILITY_FACTORS[candidate][target] >= 0.75,
  );
}

function cardId(slot: SquadSlot): string {
  if (slot.card_id === null)
    throw new RangeError(`occupied squad slot ${slot.slot_id} has no card_id`);
  return slot.card_id as string;
}

function ratingFor(slot: SquadSlot, world: SimWorld): Rating {
  const rating = world.ratings[cardId(slot)];
  if (!rating)
    throw new RangeError(`SimWorld is missing a Rating for drafted card_id ${cardId(slot)}`);
  return rating;
}

export interface RankedReplacement {
  slot: SquadSlot;
  fit: number;
  internalScore: number;
  replacementScore: number;
}

function rankBenchReplacements(
  bench: readonly SquadSlot[],
  targetSlotPosition: SlotPosition,
  world: SimWorld,
): RankedReplacement[] {
  const target = slotPositionLine(targetSlotPosition);
  const ranked: RankedReplacement[] = [];
  for (const slot of bench) {
    if (slot.card_id === null) continue;
    const eligible = world.eligiblePositionsByCardId?.[slot.card_id as string];
    // Honest fail-closed: unknown eligibility never becomes a universal utility player.
    if (!eligible || !isHardFamilyEligible(eligible, target)) continue;
    const projection = projectSlotContribution({
      rating: ratingFor(slot, world),
      eligible_positions: eligible,
      slot_position: targetSlotPosition,
    });
    const fit = projection.compatibility;
    const internalScore = fit === 0 ? 0 : projection.weighted_channel / fit;
    ranked.push({ slot, fit, internalScore, replacementScore: projection.weighted_channel });
  }
  return ranked;
}

/** Deterministically choose the highest sim-internal score × target-slot fit. */
export function selectBestBenchReplacement(
  bench: readonly SquadSlot[],
  targetSlotPosition: SlotPosition,
  world: SimWorld,
): RankedReplacement | null {
  const ranked = rankBenchReplacements(bench, targetSlotPosition, world);
  ranked.sort(
    (a, b) =>
      b.replacementScore - a.replacementScore ||
      (cardId(a.slot) < cardId(b.slot) ? -1 : cardId(a.slot) > cardId(b.slot) ? 1 : 0),
  );
  return ranked[0] ?? null;
}

/**
 * Complete deterministic assignment for simultaneous absences.
 *
 * Priority is: fill the most slots, maximize total projected contribution,
 * then choose the lexicographically smallest card assignment for canonically
 * ordered slot ids. An unfilled slot sorts after every real card id, so the
 * final tie-break also prefers filling the earliest canonical slot.
 */
export function assignBenchReplacements(
  absentStarters: readonly SquadSlot[],
  bench: readonly SquadSlot[],
  world: SimWorld,
): ReadonlyMap<string, RankedReplacement> {
  const starters = absentStarters
    .slice()
    .sort((a, b) => (a.slot_id < b.slot_id ? -1 : a.slot_id > b.slot_id ? 1 : 0));
  const candidates = starters.map((starter) =>
    rankBenchReplacements(bench, starter.slot_position, world).sort((a, b) =>
      cardId(a.slot) < cardId(b.slot) ? -1 : cardId(a.slot) > cardId(b.slot) ? 1 : 0,
    ),
  );
  let best:
    | {
        filled: number;
        score: number;
        cardIds: string[];
        assignments: Map<string, RankedReplacement>;
      }
    | undefined;

  const isCanonicalBefore = (left: readonly string[], right: readonly string[]): boolean => {
    for (let index = 0; index < left.length; index++) {
      if (left[index] === right[index]) continue;
      return left[index]! < right[index]!;
    }
    return false;
  };
  const visit = (
    index: number,
    usedCardIds: Set<string>,
    assignments: Map<string, RankedReplacement>,
    score: number,
    cardIds: string[],
  ): void => {
    if (index === starters.length) {
      const candidate = { filled: assignments.size, score, cardIds: cardIds.slice(), assignments };
      if (
        !best ||
        candidate.filled > best.filled ||
        (candidate.filled === best.filled && candidate.score > best.score) ||
        (candidate.filled === best.filled &&
          candidate.score === best.score &&
          isCanonicalBefore(candidate.cardIds, best.cardIds))
      ) {
        best = { ...candidate, assignments: new Map(assignments) };
      }
      return;
    }

    const starter = starters[index]!;
    for (const replacement of candidates[index]!) {
      const replacementCardId = cardId(replacement.slot);
      if (usedCardIds.has(replacementCardId)) continue;
      usedCardIds.add(replacementCardId);
      assignments.set(starter.slot_id, replacement);
      cardIds.push(replacementCardId);
      visit(index + 1, usedCardIds, assignments, score + replacement.replacementScore, cardIds);
      cardIds.pop();
      assignments.delete(starter.slot_id);
      usedCardIds.delete(replacementCardId);
    }
    cardIds.push("\uffff");
    visit(index + 1, usedCardIds, assignments, score, cardIds);
    cardIds.pop();
  };

  visit(0, new Set(), new Map(), 0, []);
  return best?.assignments ?? new Map();
}

/** Draw at most one new absence for this match from the isolated availability stream. */
export function drawAvailabilityForMatch(
  draft: DraftState,
  seed: string,
  matchIndex: number,
  state: AvailabilityState,
): void {
  for (const [playerId, absence] of state.absences) {
    if (absence.unavailable_through < matchIndex) state.absences.delete(playerId);
  }
  const rng = createRng(deriveSubseed(seed, "availability", `match:${matchIndex}`));
  if (rng.next() >= INJURY.AVAILABILITY_EVENT_PROB) return;

  const candidates = draft.squad
    .filter(
      (slot) =>
        slot.is_starter &&
        slot.card_id !== null &&
        slot.player_id !== null &&
        !state.absences.has(slot.player_id),
    )
    .sort((a, b) => (a.slot_id < b.slot_id ? -1 : a.slot_id > b.slot_id ? 1 : 0));
  if (candidates.length === 0) return;

  const tournamentEnding = rng.next() < INJURY.TOURNAMENT_ENDING_PROB;
  if (!tournamentEnding && state.minorEventCount >= INJURY.MAX_MINOR_EVENTS_PER_RUN) return;
  const slot = candidates[rng.int(candidates.length)]!;
  const reason = tournamentEnding
    ? "tournament_injury"
    : rng.next() < INJURY.MINOR_KNOCK_PROB
      ? "knock"
      : "suspension";
  const duration: 1 | 2 | null = tournamentEnding
    ? null
    : rng.next() < INJURY.MINOR_TWO_MATCH_PROB
      ? 2
      : 1;
  if (!tournamentEnding) state.minorEventCount++;
  state.absences.set(slot.player_id!, {
    card_id: slot.card_id!,
    player_id: slot.player_id!,
    slot_id: slot.slot_id,
    position: slotPositionLine(slot.slot_position),
    reason,
    duration_matches: duration,
    unavailable_through: duration === null ? Number.POSITIVE_INFINITY : matchIndex + duration - 1,
  });
}

function contribution(
  slot: SquadSlot,
  world: SimWorld,
  replacementMultiplier = 1,
): StarterContribution {
  if (!(replacementMultiplier > 0 && replacementMultiplier <= 1)) {
    throw new RangeError("replacement contribution multiplier must be in (0, 1]");
  }
  const source = ratingFor(slot, world);
  const rating =
    replacementMultiplier === 1
      ? source
      : {
          ...source,
          attack: source.attack * replacementMultiplier,
          midfield: source.midfield * replacementMultiplier,
          defense: source.defense * replacementMultiplier,
          goalkeeping: source.goalkeeping * replacementMultiplier,
        };
  return {
    slot_id: slot.slot_id,
    rating,
    position_compatibility: slot.position_compatibility,
  };
}

export function resolveActiveTeam(params: {
  draft: DraftState;
  formation: FormationTemplate;
  world: SimWorld;
  state: AvailabilityState;
  managerTournament: ManagerTournament | null;
  managerRating: ManagerRating | null;
  baseSynergy: SynergyResult;
  baseStrength: TeamStrength;
}): ActiveTeamResolution {
  const {
    draft,
    formation,
    world,
    state,
    managerTournament,
    managerRating,
    baseSynergy,
    baseStrength,
  } = params;
  const absentByPlayer = state.absences;
  const starters = draft.squad
    .filter((slot) => slot.is_starter && slot.card_id !== null && slot.player_id !== null)
    .sort((a, b) => (a.slot_id < b.slot_id ? -1 : a.slot_id > b.slot_id ? 1 : 0));
  const bench = draft.squad.filter((slot) => !slot.is_starter && slot.card_id !== null);
  const absentStarters = starters.filter((starter) => absentByPlayer.has(starter.player_id!));
  const replacements = assignBenchReplacements(absentStarters, bench, world);
  const usedBench = new Set(
    [...replacements.values()].map((replacement) => cardId(replacement.slot)),
  );
  const activeStarters: SquadSlot[] = [];
  const activations: BenchActivationFact[] = [];
  const shortHandedSlotIds: string[] = [];

  for (const starter of starters) {
    const absence = absentByPlayer.get(starter.player_id!);
    if (!absence) {
      activeStarters.push(starter);
      continue;
    }
    const replacement = replacements.get(starter.slot_id);
    if (!replacement) {
      shortHandedSlotIds.push(starter.slot_id);
      continue;
    }
    activeStarters.push({
      ...replacement.slot,
      slot_id: starter.slot_id,
      is_starter: true,
      slot_position: starter.slot_position,
      position_compatibility: replacement.fit,
    });
    const starterEligibility = world.eligiblePositionsByCardId?.[starter.card_id as string];
    if (!starterEligibility) {
      throw new RangeError(
        `SimWorld is missing eligible positions for active starter ${starter.card_id as string}`,
      );
    }
    const outgoingProjection = projectSlotContribution({
      rating: ratingFor(starter, world),
      eligible_positions: starterEligibility,
      slot_position: starter.slot_position,
    });
    const outgoingScore = outgoingProjection.weighted_channel;
    const replacementMultiplier = INJURY.BENCH_REPLACEMENT_CONTRIBUTION_MULTIPLIER;
    const effectiveReplacementScore =
      replacement.internalScore * replacement.fit * replacementMultiplier;
    activations.push({
      out_card_id: starter.card_id!,
      out_player_id: starter.player_id!,
      in_card_id: replacement.slot.card_id!,
      in_player_id: replacement.slot.player_id!,
      slot_id: starter.slot_id,
      line: outgoingProjection.line,
      fit: replacement.fit,
      internal_score: replacement.internalScore,
      replacement_contribution_multiplier: replacementMultiplier,
      replacement_score: effectiveReplacementScore,
      outgoing_score: outgoingScore,
      line_contribution_delta: effectiveReplacementScore - outgoingScore,
    });
  }

  const unusedBench = bench.filter((slot) => !usedBench.has(cardId(slot)));
  const activeSquad = [...activeStarters, ...unusedBench];
  const activeSynergy = computeSynergy(
    activeSquad,
    formation,
    managerTournament,
    world.nationByCardId,
  );
  const activeStrength =
    activeStarters.length === 11
      ? aggregateUserXiStrength(
          activeStarters.map((slot) =>
            contribution(
              slot,
              world,
              replacements.has(slot.slot_id)
                ? INJURY.BENCH_REPLACEMENT_CONTRIBUTION_MULTIPLIER
                : 1,
            ),
          ),
          activeSynergy,
          managerRating,
        )
      : aggregateActiveXiStrength(
          activeStarters.map((slot) =>
            contribution(
              slot,
              world,
              replacements.has(slot.slot_id)
                ? INJURY.BENCH_REPLACEMENT_CONTRIBUTION_MULTIPLIER
                : 1,
            ),
          ),
          activeSynergy,
          managerRating,
          INJURY.SHORT_HANDED_STRENGTH_MULTIPLIER,
        );
  const unavailable = [...absentByPlayer.values()]
    .sort((a, b) => (a.slot_id < b.slot_id ? -1 : a.slot_id > b.slot_id ? 1 : 0))
    .map((absence) => {
      const fact: AvailabilityFact = {
        card_id: absence.card_id,
        player_id: absence.player_id,
        slot_id: absence.slot_id,
        position: absence.position,
        reason: absence.reason,
        duration_matches: absence.duration_matches,
      };
      return fact;
    });
  return {
    activeSquad,
    facts: {
      base_strength: baseStrength,
      active_strength: activeStrength,
      // Availability resolution precedes the match outcome. The match engine
      // replaces these neutral facts when it actually applies the S2 seam;
      // forfeits retain them and therefore never claim a tactical effect.
      ...applyManagerTacticalAdjustment(
        activeStrength,
        draft.manager_card_id !== null,
        activeSynergy.manager_link,
        false,
      ),
      base_synergy: baseSynergy,
      active_synergy: activeSynergy,
      unavailable,
      bench_activations: activations,
      short_handed_slot_ids: shortHandedSlotIds,
    },
  };
}
