// ENGINE-V2 E-3b — TEST-ONLY draft policies for the asymmetric realism gate.
//
// CANONICAL `autoDraft` lives in `@wcdraft/core` (`packages/core/src/draft.ts`)
// and stays unchanged: it always picks `rolled_card_ids[0]` and feeds the
// first vacant slot. It is the byte-stable fixture every draft.golden test
// locks against. It is NOT a realistic proxy for how a competent human
// plays the actual draft loop — autoDraft is canonical-first, so on a
// projected-elite-2026 opponent population it lands as a coherent-elite
// vs. random-history match-up. The asymmetric realism harness historically
// measured `autoDraft` and reported an 11/200 / 16.64% margin≥4 / 0% KO→ET
// landing at SPREAD=6.5 (see
// `docs/investigations/engine-v2-asymmetric-realism-2026-06-07.md`).
//
// This file adds two TEST-ONLY alternative policies the realism harness can
// drive without changing any production engine bytes:
//
//   • `strategicAutoDraft` — slot-fit best-available. For each player spin
//     it scans `rolled_card_ids` and picks the one maximising
//     `positionCompatibility(eligible_positions, slot_position) ×
//      rating[channel_for_slot]`. This is the realistic proxy for a
//     COMPETENT human player and is the population the asymmetric realism
//     gate measures over.
//
//   • `greedyOverallAutoDraft` — position-blind max-overall. Used as a
//     NEGATIVE CONTROL to prove that "competent" must mean slot-fit-aware,
//     not just max display overall. The CI guard in the gate asserts this
//     policy lands OUTSIDE the realism shape bands.
//
// Both policies preserve `autoDraft`'s manager-first rule (take the first
// offered coach if none is drafted yet) and the squad-fill order (first
// vacant slot — starters before bench). The only difference is which
// candidate `card_id` from `active.rolled_card_ids` is fed into
// `pickPlayer`.
//
// DETERMINISM: identical (params, dataset, ctx) → byte-identical
// DraftState within a policy. The only randomness is the upstream
// (tournament, nation) draw, which is seeded.

import {
  activeSpin,
  buildCardId,
  buildDraftCatalog,
  createDraft,
  isDraftComplete,
  pickManager,
  pickPlayer,
  positionCompatibility,
  slotPositionLine,
  type CardId,
  type CreateDraftParams,
  type DraftCatalog,
  type DraftDataset,
  type DraftState,
  type Position,
  type SlotPosition,
} from "@wcdraft/core";

import type { RuntimePlayerCard, RuntimeRating } from "../../src/types.js";

/**
 * Per-card lookup the policies need to pick "best for this slot". Both maps
 * are keyed by canonical `CardId` (`buildCardId(player_id, tournament_id)`)
 * and are dense over the draft pool.
 */
export interface PolicyContext {
  /** card_id → eligible_positions (coarse Position[]). */
  readonly eligible: Map<CardId, readonly Position[]>;
  /** card_id → rating row (attack, midfield, defense, goalkeeping, overall). */
  readonly ratings: Map<CardId, RuntimeRating>;
}

/** Build the policy context once per harness invocation. */
export function buildPolicyContext(
  playerCards: readonly RuntimePlayerCard[],
  ratings: readonly RuntimeRating[],
): PolicyContext {
  const eligible = new Map<CardId, readonly Position[]>();
  for (const c of playerCards) {
    eligible.set(c.card_id, c.eligible_positions);
  }
  const rmap = new Map<CardId, RuntimeRating>();
  for (const r of ratings) rmap.set(r.card_id, r);
  return { eligible, ratings: rmap };
}

type Channel = "attack" | "midfield" | "defense" | "goalkeeping";

function channelForSlotLine(line: Position): Channel {
  switch (line) {
    case "GK":
      return "goalkeeping";
    case "DF":
      return "defense";
    case "MF":
      return "midfield";
    case "FW":
      return "attack";
  }
}

/** Score a single candidate card_id for a given slot under STRATEGIC slot-fit. */
function strategicScore(
  cardId: CardId,
  slotLine: Position,
  slotPositionFine: SlotPosition,
  ctx: PolicyContext,
): { primary: number; overall: number } {
  const eligible = ctx.eligible.get(cardId);
  const rating = ctx.ratings.get(cardId);
  if (eligible === undefined || rating === undefined) {
    // Honest fail: a card in `rolled_card_ids` must be in the draft pool.
    throw new RangeError(`strategicScore: missing context for card_id ${cardId}`);
  }
  const compat = positionCompatibility(eligible, slotPositionFine);
  const channel = channelForSlotLine(slotLine);
  const primary = compat * rating[channel];
  const overall = rating.overall ?? 0;
  return { primary, overall };
}

/** Pick the next first-vacant slot or return null if the squad is full. */
function firstVacantSlot(
  state: DraftState,
): { slot_id: string; slot_position: SlotPosition; line: Position } | null {
  const slot = state.squad.find((s) => s.card_id === null);
  if (!slot) return null;
  return {
    slot_id: slot.slot_id,
    slot_position: slot.slot_position,
    line: slotPositionLine(slot.slot_position),
  };
}

interface Scored {
  cardId: CardId;
  primary: number;
  overall: number;
}

/**
 * Tiebreak by overall DESC, then card_id ASC — deterministic.
 *
 * ⚠️ DECOUPLING NOTE (ws-core/decoupling-guards):
 *   This reads display `overall` to break ties. `overall` is the DISPLAY-only
 *   Rating composite (`packages/core/src/types/rating.ts`: "the sim engine
 *   MUST NOT read this field"). This is HARNESS code, not the sim, so the
 *   contract is not literally violated — but the harness sits UNDER the
 *   λ-calibration chain (see `packages/data/scripts/fit-calibration.mjs`).
 *   A future change to the display `overall` curve (rescaling, post-fit
 *   normalisation, stature-driven pooled curve, etc.) can FLIP a tie
 *   ordering here, re-order the strategic pick sequence, shift the realism
 *   landings, and silently invalidate the λ fit basis. The realism gate's
 *   Wilson bands re-base WITH the landings on re-lock, so they do NOT
 *   catch the flip.
 *
 *   DO NOT change this tiebreak — any pick-flip drifts the locked realism
 *   landings. The tripwire instead is
 *   `strategic-pick-canary.golden.test.ts`: it locks the first 5
 *   strategicAutoDraft pick sequences and turns red the moment a display-
 *   curve change flips any tie. If the canary trips, a λ re-fit is
 *   REQUIRED before the realism golden may be re-locked. See
 *   SIM_CALIBRATION.md › "Decoupling guards".
 */
function pickBest(candidates: readonly Scored[]): Scored {
  let best = candidates[0]!;
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (c.primary > best.primary) {
      best = c;
      continue;
    }
    if (c.primary < best.primary) continue;
    if (c.overall > best.overall) {
      best = c;
      continue;
    }
    if (c.overall < best.overall) continue;
    if (c.cardId < best.cardId) best = c;
  }
  return best;
}

/** Pick the next player card for the active spin under the chosen policy. */
function selectPlayerCard(
  state: DraftState,
  ctx: PolicyContext,
  mode: "strategic" | "greedy",
): { card_id: CardId; slot_id: string } {
  const active = activeSpin(state);
  if (!active) throw new RangeError("selectPlayerCard: no active spin");
  if (active.rolled_card_ids.length === 0) {
    throw new RangeError(
      `selectPlayerCard: spin ${active.index} has no player candidates`,
    );
  }
  const slot = firstVacantSlot(state);
  if (slot === null) {
    throw new RangeError(
      `selectPlayerCard: no vacant slot for a player at spin ${active.index}`,
    );
  }

  const scored: Scored[] = active.rolled_card_ids.map((cardId) => {
    if (mode === "strategic") {
      const s = strategicScore(cardId, slot.line, slot.slot_position, ctx);
      return { cardId, primary: s.primary, overall: s.overall };
    }
    // greedy: position-blind max overall. Ratings may have overall=null on a
    // tiny number of historical cards — treat null as 0 so they never win.
    const r = ctx.ratings.get(cardId);
    if (!r) throw new RangeError(`selectPlayerCard: missing rating for ${cardId}`);
    const ov = r.overall ?? 0;
    return { cardId, primary: ov, overall: ov };
  });
  const best = pickBest(scored);
  return { card_id: best.cardId, slot_id: slot.slot_id };
}

/**
 * Drive a draft to completion under the given policy. Same manager-first /
 * first-vacant-slot flow as canonical `stepDraft`; only the player-pick
 * selection within each spin's `rolled_card_ids` differs.
 */
export function runAutoDraftPolicy(
  catalog: DraftCatalog,
  params: CreateDraftParams,
  ctx: PolicyContext,
  mode: "strategic" | "greedy",
): DraftState {
  let state = createDraft(catalog, params);
  while (!isDraftComplete(state)) {
    const active = activeSpin(state);
    if (!active) throw new RangeError("runAutoDraftPolicy: complete with no active spin");
    const needManager = state.manager_card_id === null;
    if (needManager && active.rolled_manager_card_id !== null) {
      state = pickManager(catalog, state);
      continue;
    }
    const { card_id, slot_id } = selectPlayerCard(state, ctx, mode);
    state = pickPlayer(catalog, state, card_id, slot_id);
  }
  return state;
}

/** Convenience: build catalog + run policy. Mirrors `autoDraft` ergonomics. */
export function strategicAutoDraft(
  input: CreateDraftParams & { dataset: DraftDataset; ctx: PolicyContext },
): DraftState {
  const { dataset, ctx, ...params } = input;
  const catalog = buildDraftCatalog(dataset);
  return runAutoDraftPolicy(catalog, params, ctx, "strategic");
}

export function greedyOverallAutoDraft(
  input: CreateDraftParams & { dataset: DraftDataset; ctx: PolicyContext },
): DraftState {
  const { dataset, ctx, ...params } = input;
  const catalog = buildDraftCatalog(dataset);
  return runAutoDraftPolicy(catalog, params, ctx, "greedy");
}

export { buildCardId };
