#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

import {
  activeSpin,
  buildDraftCatalog,
  createDraft,
  DraftTargetDeadEndError,
  ERA_PRESET_IDS,
  filterDraftDataset,
  isDraftComplete,
  pickManager,
  pickPlayer,
  selectDraftTarget,
  stepDraft,
  type DraftCatalog,
  type DraftDataset,
  type DraftFlow,
  type DraftState,
  type EraPresetId,
  type RatingBasis,
} from "../../core/src/index.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const SCRIPT_VERSION = "choose3-clustering-1.1.0";
const MEASUREMENT_DRAFTS = 1024;
const HOLDOUT_DRAFTS = 2048;
const PREFIXES = Object.freeze([256, 512, MEASUREMENT_DRAFTS, HOLDOUT_DRAFTS]);
const THRESHOLDS = Object.freeze([0, 1, 2]);
const BASES = Object.freeze(["career", "current"] as const);
const FLOWS = Object.freeze(["squad_first", "position_first"] as const);
const ESTIMATE_BASES = new Set(["career_stature_estimate", "baseline_anchor_estimate"]);
const PROVENANCE_CODES = Object.freeze({
  measured_performance: 0,
  baseline_anchor_estimate: 1,
  career_stature_estimate: 2,
} as const);
const BUNDLE_REL = "packages/data/src/generated/draft-pool.compact.json.br";
const MANIFEST_REL = "packages/data/src/generated/manifest.json";
const CORE_DRAFT_REL = "packages/core/src/draft.ts";
const WEB_DATA_REL = "apps/web/lib/game/data.ts";
const WEB_ADAPTER_REL = "apps/web/lib/game/adapters.ts";

type Position = "GK" | "DF" | "MF" | "FW";

interface RuntimeBasisRating {
  overall: number | null;
  attack: number | null;
  midfield: number | null;
  defense: number | null;
  goalkeeping: number | null;
  provenance: string;
  overall_basis: string;
}

interface RuntimeRating extends RuntimeBasisRating {
  card_id: string;
  basis_ratings: { current: RuntimeBasisRating };
}

interface RuntimePlayerCard {
  card_id: string;
  player_id: string;
  tournament_id: number;
  nation_id: string;
  eligible_positions: Position[];
  position_listed?: Position | null;
}

interface RuntimeManagerCard {
  manager_id: string;
  tournament_id: number;
  nation_id: string;
}

interface RuntimeBundle {
  player_cards: RuntimePlayerCard[];
  manager_cards: RuntimeManagerCard[];
  ratings: RuntimeRating[];
  tournaments: Record<string, { year: number; name: string }>;
}

interface ClusterCount {
  successes: number;
  total: number;
}

interface OfferObservation {
  draftOrdinal: number;
  candidateSeedIndex: number;
  pickIndex: number;
  cardinality: number;
  fullNumericTriple: boolean;
  all: boolean[];
  signalEligible: boolean[];
  signal: boolean[];
  estimateTied: boolean[];
  provenanceMasks: number[];
  engineUniquePositions: number;
  visibleUniquePositions: number;
  tuple: unknown[];
}

interface DraftObservation {
  candidateSeedIndex: number;
  managerPickIndex: number;
  managerTargetDeadEnds: number;
  offers: OfferObservation[];
}

interface CellRun {
  cellId: string;
  eraPreset: EraPresetId;
  ratingBasis: RatingBasis;
  draftFlow: DraftFlow;
  drafts: DraftObservation[];
  rejected: { candidate_seed_index: number; reason: string }[];
}

function absolute(rel: string): string {
  return path.join(REPO_ROOT, rel);
}

function read(rel: string): Buffer {
  return readFileSync(absolute(rel));
}

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function round(value: number, digits = 9): number {
  return Number(value.toFixed(digits));
}

function choose2(n: number): number {
  return n < 2 ? 0 : (n * (n - 1)) / 2;
}

function choose3(n: number): number {
  return n < 3 ? 0 : (n * (n - 1) * (n - 2)) / 6;
}

function isEstimate(basis: RuntimeBasisRating): boolean {
  return ESTIMATE_BASES.has(basis.overall_basis);
}

function provenanceCode(name: string): number {
  const code = PROVENANCE_CODES[name as keyof typeof PROVENANCE_CODES];
  if (code === undefined) throw new Error(`unregistered overall_basis provenance ${name}`);
  return code;
}

function selectedBasis(rating: RuntimeRating, basis: RatingBasis): RuntimeBasisRating {
  return basis === "current" ? rating.basis_ratings.current : rating;
}

function clusterRatioInterval(clusters: readonly ClusterCount[]) {
  const successes = clusters.reduce((sum, cluster) => sum + cluster.successes, 0);
  const total = clusters.reduce((sum, cluster) => sum + cluster.total, 0);
  if (total === 0) {
    return {
      successes,
      total,
      rate: null,
      ci95: [null, null],
      half_width: null,
      method: "draft-cluster-robust-ratio-normal",
    };
  }
  const rate = successes / total;
  const m = clusters.length;
  const residualSquares = clusters.reduce((sum, cluster) => {
    const residual = cluster.successes - rate * cluster.total;
    return sum + residual * residual;
  }, 0);
  const variance = m > 1 ? (m / (m - 1)) * (residualSquares / (total * total)) : 0;
  const halfWidth = 1.959963984540054 * Math.sqrt(variance);
  return {
    successes,
    total,
    rate: round(rate),
    ci95: [round(Math.max(0, rate - halfWidth)), round(Math.min(1, rate + halfWidth))],
    half_width: round(halfWidth),
    method: "draft-cluster-robust-ratio-normal",
  };
}

function countForDraft(
  offers: readonly OfferObservation[],
  thresholdIndex: number,
  kind: "all" | "signal",
): ClusterCount {
  let successes = 0;
  let total = 0;
  for (const offer of offers) {
    if (kind === "all") {
      if (!offer.fullNumericTriple) continue;
      total += 1;
      if (offer.all[thresholdIndex]) successes += 1;
    } else {
      if (!offer.signalEligible[thresholdIndex]) continue;
      total += 1;
      if (offer.signal[thresholdIndex]) successes += 1;
    }
  }
  return { successes, total };
}

function summaryAtPrefix(cell: CellRun, prefix: number) {
  const drafts = cell.drafts.slice(0, prefix);
  return THRESHOLDS.map((threshold, thresholdIndex) => ({
    threshold,
    all: clusterRatioInterval(
      drafts.map((draft) => countForDraft(draft.offers, thresholdIndex, "all")),
    ),
    excluding_visible_estimate_candidates: clusterRatioInterval(
      drafts.map((draft) => countForDraft(draft.offers, thresholdIndex, "signal")),
    ),
  }));
}

function maxRateShift(
  cells: readonly CellRun[],
  fromPrefix: number,
  toPrefix: number,
): { all: number; signal: number } {
  let all = 0;
  let signal = 0;
  for (const cell of cells) {
    const before = summaryAtPrefix(cell, fromPrefix);
    const after = summaryAtPrefix(cell, toPrefix);
    for (let i = 0; i < THRESHOLDS.length; i += 1) {
      const beforeAll = before[i]!.all.rate;
      const afterAll = after[i]!.all.rate;
      const beforeSignal = before[i]!.excluding_visible_estimate_candidates.rate;
      const afterSignal = after[i]!.excluding_visible_estimate_candidates.rate;
      if (beforeAll !== null && afterAll !== null)
        all = Math.max(all, Math.abs(afterAll - beforeAll));
      if (beforeSignal !== null && afterSignal !== null) {
        signal = Math.max(signal, Math.abs(afterSignal - beforeSignal));
      }
    }
  }
  return { all: round(all), signal: round(signal) };
}

function buildDataset(bundle: RuntimeBundle): DraftDataset {
  // This is the exact narrow mapping used by apps/web/lib/game/data.ts::buildDraftDataset.
  // The core resolver selects the configured display basis from this dual-value input.
  const ratingByCardId = new Map(bundle.ratings.map((rating) => [rating.card_id, rating]));
  return {
    players: bundle.player_cards.map((card) => ({
      player_id: card.player_id,
      tournament_id: card.tournament_id,
      nation_id: card.nation_id,
      eligible_positions: card.eligible_positions,
      choice_overall: {
        career: ratingByCardId.get(card.card_id)?.overall ?? null,
        current: ratingByCardId.get(card.card_id)?.basis_ratings.current.overall ?? null,
      },
    })),
    managers: bundle.manager_cards.map((manager) => ({
      manager_id: manager.manager_id,
      tournament_id: manager.tournament_id,
      nation_id: manager.nation_id,
    })),
    tournaments: Object.entries(bundle.tournaments).map(([tournamentId, tournament]) => ({
      tournament_id: Number(tournamentId),
      year: tournament.year,
    })),
  };
}

function pairwiseTie(values: readonly number[], threshold: number): boolean {
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (Math.abs(values[i]! - values[j]!) <= threshold) return true;
    }
  }
  return false;
}

function provenanceMask(
  values: readonly number[],
  ratings: readonly RuntimeBasisRating[],
  threshold: number,
): number {
  let mask = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (Math.abs(values[i]! - values[j]!) > threshold) continue;
      const left = ratings[i]!;
      const right = ratings[j]!;
      if (left.overall_basis !== right.overall_basis) mask |= 4;
      else if (isEstimate(left) && isEstimate(right)) mask |= 2;
      else mask |= 1;
    }
  }
  return mask;
}

function observeOffer(
  state: DraftState,
  bundleCardById: ReadonlyMap<string, RuntimePlayerCard>,
  ratingById: ReadonlyMap<string, RuntimeRating>,
  basis: RatingBasis,
  draftOrdinal: number,
  candidateSeedIndex: number,
): OfferObservation | null {
  const spin = activeSpin(state);
  if (!spin || spin.rolled_card_ids.length === 0) return null;
  const cardIds = spin.rolled_card_ids.map(String);
  const cards = cardIds.map((cardId) => {
    const card = bundleCardById.get(cardId);
    if (!card) throw new Error(`offer references missing player card ${cardId}`);
    return card;
  });
  const basisRatings = cardIds.map((cardId) => {
    const rating = ratingById.get(cardId);
    if (!rating) throw new Error(`offer references missing rating ${cardId}`);
    return selectedBasis(rating, basis);
  });
  const overalls = basisRatings.map((rating) => rating.overall);
  const numeric = overalls.every((overall): overall is number => typeof overall === "number");
  const fullNumericTriple = cardIds.length === 3 && numeric;
  const numericOveralls = numeric ? overalls : [];
  const sorted = fullNumericTriple ? [...numericOveralls].sort((a, b) => a - b) : [];
  const adjacentGaps = fullNumericTriple
    ? [sorted[1]! - sorted[0]!, sorted[2]! - sorted[1]!]
    : null;
  const spread = fullNumericTriple ? sorted[2]! - sorted[0]! : null;
  const all = THRESHOLDS.map((threshold) =>
    fullNumericTriple ? pairwiseTie(numericOveralls, threshold) : false,
  );
  const signalIndexes = basisRatings.flatMap((rating, index) =>
    isEstimate(rating) ? [] : [index],
  );
  const signalValues = signalIndexes.flatMap((index) => {
    const value = overalls[index];
    return typeof value === "number" ? [value] : [];
  });
  const signalEligible = THRESHOLDS.map(() => fullNumericTriple && signalValues.length >= 2);
  const signal = THRESHOLDS.map((threshold) =>
    fullNumericTriple && signalValues.length >= 2 ? pairwiseTie(signalValues, threshold) : false,
  );
  const estimateTied = THRESHOLDS.map((threshold) => {
    if (!fullNumericTriple) return false;
    for (let i = 0; i < numericOveralls.length; i += 1) {
      for (let j = i + 1; j < numericOveralls.length; j += 1) {
        if (
          Math.abs(numericOveralls[i]! - numericOveralls[j]!) <= threshold &&
          (isEstimate(basisRatings[i]!) || isEstimate(basisRatings[j]!))
        ) {
          return true;
        }
      }
    }
    return false;
  });
  const provenanceMasks = THRESHOLDS.map((threshold) =>
    fullNumericTriple ? provenanceMask(numericOveralls, basisRatings, threshold) : 0,
  );
  const enginePositions = cards.map((card) => card.eligible_positions[0] ?? "MF");
  const visiblePositions = cards.map(
    (card) => card.position_listed ?? card.eligible_positions[0] ?? "MF",
  );
  let tieMask = 0;
  all.forEach((tied, index) => {
    if (tied) tieMask |= 1 << index;
  });
  return {
    draftOrdinal,
    candidateSeedIndex,
    pickIndex: spin.index + 1,
    cardinality: cardIds.length,
    fullNumericTriple,
    all,
    signalEligible,
    signal,
    estimateTied,
    provenanceMasks,
    engineUniquePositions: new Set(enginePositions).size,
    visibleUniquePositions: new Set(visiblePositions).size,
    tuple: [
      draftOrdinal,
      spin.index + 1,
      cardIds,
      overalls,
      enginePositions,
      visiblePositions,
      basisRatings.map((rating) => provenanceCode(rating.overall_basis)),
      spread,
      adjacentGaps,
      fullNumericTriple ? tieMask : null,
      fullNumericTriple ? provenanceMasks : null,
    ],
  };
}

function firstVacantSlot(state: DraftState): string {
  const slot = state.squad.find((candidate) => candidate.card_id === null);
  if (!slot) throw new Error("position-first walk has no vacant player slot");
  return slot.slot_id;
}

function simulateDraft(
  catalog: DraftCatalog,
  bundleCardById: ReadonlyMap<string, RuntimePlayerCard>,
  ratingById: ReadonlyMap<string, RuntimeRating>,
  manifest: Record<string, string>,
  cellId: string,
  basis: RatingBasis,
  flow: DraftFlow,
  eraPreset: EraPresetId,
  draftOrdinal: number,
  candidateSeedIndex: number,
): DraftObservation {
  const parentSeed = `wcdraft:choose3-clustering:v1:${candidateSeedIndex.toString().padStart(6, "0")}`;
  let state = createDraft(catalog, {
    run_id: `clustering-${cellId}-${draftOrdinal.toString()}`,
    parent_seed: parentSeed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Measurement XI",
    dataset_version: manifest.dataset_version!,
    rating_version: `${manifest.rating_version_historical}+${manifest.rating_version_projected}`,
    engine_version: manifest.engine_version!,
    draft_flow: flow,
    rating_basis: basis,
    era_preset: eraPreset,
  });
  const offers: OfferObservation[] = [];
  let managerPickIndex = 0;
  let managerTargetDeadEnds = 0;
  while (!isDraftComplete(state)) {
    if (flow === "squad_first") {
      const observed = observeOffer(
        state,
        bundleCardById,
        ratingById,
        basis,
        draftOrdinal,
        candidateSeedIndex,
      );
      if (observed) offers.push(observed);
      const beforeManager = state.manager_card_id;
      const pickIndex = activeSpin(state)!.index + 1;
      state = stepDraft(catalog, state);
      if (beforeManager === null && state.manager_card_id !== null) managerPickIndex = pickIndex;
      continue;
    }

    if (state.manager_card_id === null) {
      try {
        const targeted = selectDraftTarget(catalog, state, "manager");
        managerPickIndex = activeSpin(targeted)!.index + 1;
        state = pickManager(catalog, targeted);
        continue;
      } catch (error) {
        if (!(error instanceof DraftTargetDeadEndError)) throw error;
        managerTargetDeadEnds += 1;
      }
    }
    state = selectDraftTarget(catalog, state, firstVacantSlot(state));
    const observed = observeOffer(
      state,
      bundleCardById,
      ratingById,
      basis,
      draftOrdinal,
      candidateSeedIndex,
    );
    if (observed) offers.push(observed);
    const spin = activeSpin(state)!;
    if (spin.rolled_card_ids.length === 0) {
      throw new Error(
        `position-first player target produced no candidates at spin ${spin.index + 1}`,
      );
    }
    state = pickPlayer(catalog, state, spin.rolled_card_ids[0]!);
  }
  if (managerPickIndex === 0 || state.manager_card_id === null) {
    throw new Error("completed draft has no manager pick");
  }
  return { candidateSeedIndex, managerPickIndex, managerTargetDeadEnds, offers };
}

function runCell(
  catalog: DraftCatalog,
  bundleCardById: ReadonlyMap<string, RuntimePlayerCard>,
  ratingById: ReadonlyMap<string, RuntimeRating>,
  manifest: Record<string, string>,
  eraPreset: EraPresetId,
  ratingBasis: RatingBasis,
  draftFlow: DraftFlow,
): CellRun {
  const cellId = `${eraPreset}.${draftFlow}.${ratingBasis}`;
  const drafts: DraftObservation[] = [];
  const rejected: { candidate_seed_index: number; reason: string }[] = [];
  let candidateSeedIndex = 0;
  while (drafts.length < HOLDOUT_DRAFTS) {
    try {
      drafts.push(
        simulateDraft(
          catalog,
          bundleCardById,
          ratingById,
          manifest,
          cellId,
          ratingBasis,
          draftFlow,
          eraPreset,
          drafts.length,
          candidateSeedIndex,
        ),
      );
    } catch (error) {
      rejected.push({
        candidate_seed_index: candidateSeedIndex,
        reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
    candidateSeedIndex += 1;
    if (candidateSeedIndex > HOLDOUT_DRAFTS * 10) {
      throw new Error(`${cellId}: could not complete ${HOLDOUT_DRAFTS} drafts`);
    }
  }
  return { cellId, eraPreset, ratingBasis, draftFlow, drafts, rejected };
}

function exactPoolTieRate(histogram: ReadonlyMap<number, number>, threshold: number) {
  const entries = [...histogram.entries()].sort(([left], [right]) => left - right);
  const population = entries.reduce((sum, [, count]) => sum + count, 0);
  const denominator = choose3(population);
  let tied = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const [a, countA] = entries[i]!;
    for (let j = i; j < entries.length; j += 1) {
      const [b, countB] = entries[j]!;
      for (let k = j; k < entries.length; k += 1) {
        const [c, countC] = entries[k]!;
        let combinations: number;
        if (i === j && j === k) combinations = choose3(countA);
        else if (i === j) combinations = choose2(countA) * countC;
        else if (j === k) combinations = countA * choose2(countB);
        else combinations = countA * countB * countC;
        if (Math.min(b - a, c - b) <= threshold) tied += combinations;
      }
    }
  }
  return {
    tied_combinations: tied,
    total_combinations: denominator,
    rate: denominator === 0 ? null : round(tied / denominator),
  };
}

function poolViews(
  bundle: RuntimeBundle,
  dataset: DraftDataset,
  ratingById: ReadonlyMap<string, RuntimeRating>,
) {
  const cardByIdentity = new Map(
    bundle.player_cards.map((card) => [`${card.player_id}:${card.tournament_id}`, card]),
  );
  return ERA_PRESET_IDS.map((eraPreset) => {
    const filtered = filterDraftDataset(dataset, eraPreset);
    const cardIds = filtered.players.map((player) => {
      const card = cardByIdentity.get(`${player.player_id}:${player.tournament_id}`);
      if (!card) throw new Error(`filtered player missing runtime card ${player.player_id}`);
      return card.card_id;
    });
    const bases = Object.fromEntries(
      BASES.map((basis) => {
        const histogram = new Map<number, number>();
        const signalHistogram = new Map<number, number>();
        let estimateCards = 0;
        for (const cardId of cardIds) {
          const rating = ratingById.get(cardId);
          if (!rating) throw new Error(`pool references missing rating ${cardId}`);
          const selected = selectedBasis(rating, basis);
          if (typeof selected.overall !== "number") continue;
          histogram.set(selected.overall, (histogram.get(selected.overall) ?? 0) + 1);
          if (isEstimate(selected)) estimateCards += 1;
          else {
            signalHistogram.set(selected.overall, (signalHistogram.get(selected.overall) ?? 0) + 1);
          }
        }
        return [
          basis,
          {
            cards: cardIds.length,
            visible_estimate_cards: estimateCards,
            histogram: Object.fromEntries([...histogram.entries()].sort(([a], [b]) => a - b)),
            signal_only_histogram: Object.fromEntries(
              [...signalHistogram.entries()].sort(([a], [b]) => a - b),
            ),
            uniform_three_card_without_replacement: THRESHOLDS.map((threshold) => ({
              threshold,
              all: exactPoolTieRate(histogram, threshold),
              excluding_visible_estimate_cards: exactPoolTieRate(signalHistogram, threshold),
            })),
          },
        ];
      }),
    );
    return {
      era_preset: eraPreset,
      inclusive_years: [
        Math.min(...filtered.tournaments.map((tournament) => tournament.year)),
        Math.max(...filtered.tournaments.map((tournament) => tournament.year)),
      ],
      player_cards: filtered.players.length,
      manager_cards: filtered.managers.length,
      tournament_nation_pairs: buildDraftCatalog(dataset, eraPreset).pairs.length,
      bases,
    };
  });
}

function cellOutput(cell: CellRun) {
  const drafts = cell.drafts.slice(0, MEASUREMENT_DRAFTS);
  const offers = drafts.flatMap((draft) => draft.offers);
  const cardinalities = new Map<number, number>();
  const enginePositions = new Map<number, number>();
  const visiblePositions = new Map<number, number>();
  for (const offer of offers) {
    cardinalities.set(offer.cardinality, (cardinalities.get(offer.cardinality) ?? 0) + 1);
    if (offer.fullNumericTriple) {
      enginePositions.set(
        offer.engineUniquePositions,
        (enginePositions.get(offer.engineUniquePositions) ?? 0) + 1,
      );
      visiblePositions.set(
        offer.visibleUniquePositions,
        (visiblePositions.get(offer.visibleUniquePositions) ?? 0) + 1,
      );
    }
  }
  const tieRates = THRESHOLDS.map((threshold, thresholdIndex) => {
    const all = clusterRatioInterval(
      drafts.map((draft) => countForDraft(draft.offers, thresholdIndex, "all")),
    );
    const signal = clusterRatioInterval(
      drafts.map((draft) => countForDraft(draft.offers, thresholdIndex, "signal")),
    );
    const estimateTied = offers.filter(
      (offer) => offer.fullNumericTriple && offer.estimateTied[thresholdIndex],
    ).length;
    const masks = { same_non_estimate: 0, same_estimate: 0, cross_provenance: 0, mixed: 0 };
    for (const offer of offers) {
      if (!offer.fullNumericTriple || !offer.all[thresholdIndex]) continue;
      const mask = offer.provenanceMasks[thresholdIndex]!;
      if ((mask & (mask - 1)) !== 0) masks.mixed += 1;
      if ((mask & 1) !== 0) masks.same_non_estimate += 1;
      if ((mask & 2) !== 0) masks.same_estimate += 1;
      if ((mask & 4) !== 0) masks.cross_provenance += 1;
    }
    return {
      threshold,
      all,
      excluding_visible_estimate_candidates: signal,
      tied_offers_with_any_estimate_candidate_in_a_tied_pair: estimateTied,
      provenance_tie_offer_counts: masks,
    };
  });
  const byPick = Array.from({ length: 17 }, (_, index) => {
    const pickIndex = index + 1;
    return {
      pick_index: pickIndex,
      thresholds: THRESHOLDS.map((threshold, thresholdIndex) => ({
        threshold,
        all: clusterRatioInterval(
          drafts.map((draft) =>
            countForDraft(
              draft.offers.filter((offer) => offer.pickIndex === pickIndex),
              thresholdIndex,
              "all",
            ),
          ),
        ),
        excluding_visible_estimate_candidates: clusterRatioInterval(
          drafts.map((draft) =>
            countForDraft(
              draft.offers.filter((offer) => offer.pickIndex === pickIndex),
              thresholdIndex,
              "signal",
            ),
          ),
        ),
      })),
    };
  });
  return {
    cell_id: cell.cellId,
    era_preset: cell.eraPreset,
    rating_basis: cell.ratingBasis,
    draft_flow: cell.draftFlow,
    complete_drafts: drafts.length,
    candidate_seeds_examined_for_measurement: drafts.at(-1)!.candidateSeedIndex + 1,
    rejected_candidate_seeds_before_measurement_complete: cell.rejected.filter(
      (rejected) => rejected.candidate_seed_index <= drafts.at(-1)!.candidateSeedIndex,
    ),
    player_offer_count: offers.length,
    manager_pick_count: drafts.length,
    manager_only_spin_count: cell.draftFlow === "position_first" ? drafts.length : 0,
    offer_cardinality_counts: Object.fromEntries([...cardinalities.entries()].sort()),
    full_numeric_three_player_offers: offers.filter((offer) => offer.fullNumericTriple).length,
    engine_position_unique_count_histogram: Object.fromEntries(
      [...enginePositions.entries()].sort(),
    ),
    visible_position_unique_count_histogram: Object.fromEntries(
      [...visiblePositions.entries()].sort(),
    ),
    tie_rates: tieRates,
    by_pick_index: byPick,
    draft_records_schema: [
      "draft_ordinal",
      "candidate_seed_index",
      "manager_pick_index",
      "manager_target_dead_end_attempts",
    ],
    draft_records: drafts.map((draft, draftOrdinal) => [
      draftOrdinal,
      draft.candidateSeedIndex,
      draft.managerPickIndex,
      draft.managerTargetDeadEnds,
    ]),
    offer_records_schema: [
      "draft_ordinal",
      "pick_index_1_to_17",
      "card_ids_visible_order",
      "display_overalls_visible_order",
      "engine_position_buckets_eligible_positions_0",
      "visible_positions_position_listed_fallback_eligible_positions_0",
      "visible_overall_basis_provenance_codes",
      "spread_max_minus_min",
      "sorted_adjacent_gaps_low_mid_and_mid_high",
      "tie_threshold_bitmask_bit0_eq0_bit1_le1_bit2_le2",
      "provenance_tie_masks_by_threshold_bit1_same_non_estimate_bit2_same_estimate_bit4_cross",
    ],
    offer_records: offers.map((offer) => offer.tuple),
  };
}

function main() {
  const bundleCompressed = read(BUNDLE_REL);
  const bundleRaw = brotliDecompressSync(bundleCompressed);
  const bundle = JSON.parse(bundleRaw.toString("utf8")) as RuntimeBundle;
  const manifestBytes = read(MANIFEST_REL);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, string>;
  const dataset = buildDataset(bundle);
  const bundleCardById = new Map(bundle.player_cards.map((card) => [card.card_id, card]));
  const ratingById = new Map(bundle.ratings.map((rating) => [rating.card_id, rating]));

  const cells: CellRun[] = [];
  for (const eraPreset of ERA_PRESET_IDS) {
    const catalog = buildDraftCatalog(dataset, eraPreset);
    for (const draftFlow of FLOWS) {
      for (const ratingBasis of BASES) {
        cells.push(
          runCell(catalog, bundleCardById, ratingById, manifest, eraPreset, ratingBasis, draftFlow),
        );
      }
    }
  }

  const prefixSummaries = PREFIXES.map((prefix) => ({
    drafts_per_cell: prefix,
    cells: cells.map((cell) => ({
      cell_id: cell.cellId,
      tie_rates: summaryAtPrefix(cell, prefix),
    })),
  }));
  const shift512To1024 = maxRateShift(cells, 512, MEASUREMENT_DRAFTS);
  const shift1024To2048 = maxRateShift(cells, MEASUREMENT_DRAFTS, HOLDOUT_DRAFTS);
  let maxHalfWidth = 0;
  for (const cell of cells) {
    for (const threshold of summaryAtPrefix(cell, MEASUREMENT_DRAFTS)) {
      maxHalfWidth = Math.max(
        maxHalfWidth,
        threshold.all.half_width ?? 0,
        threshold.excluding_visible_estimate_candidates.half_width ?? 0,
      );
    }
  }
  const convergencePass =
    shift512To1024.all <= 0.01 &&
    shift512To1024.signal <= 0.01 &&
    shift1024To2048.all <= 0.01 &&
    shift1024To2048.signal <= 0.01 &&
    maxHalfWidth <= 0.015;
  if (!convergencePass) {
    throw new Error(
      `N=${MEASUREMENT_DRAFTS} convergence gate failed: ${JSON.stringify({ shift512To1024, shift1024To2048, maxHalfWidth })}`,
    );
  }

  const careerEstimateCount = bundle.ratings.filter((rating) => isEstimate(rating)).length;
  const currentEstimateCount = bundle.ratings.filter((rating) =>
    isEstimate(rating.basis_ratings.current),
  ).length;
  const positionFieldMismatches = bundle.player_cards.filter(
    (card) =>
      (card.position_listed ?? card.eligible_positions[0] ?? "MF") !==
      (card.eligible_positions[0] ?? "MF"),
  ).length;

  const output = {
    schema_version: SCRIPT_VERSION,
    measurement_date: "2026-07-18",
    method: {
      measurement_drafts_per_cell: MEASUREMENT_DRAFTS,
      holdout_drafts_per_cell: HOLDOUT_DRAFTS,
      cells: cells.length,
      complete_measurement_drafts: MEASUREMENT_DRAFTS * cells.length,
      fixed_parent_seed_template: "wcdraft:choose3-clustering:v1:<zero-padded candidate index>",
      formation_id: "4-3-3",
      mode: "classic",
      pick_policy: {
        squad_first: "packages/core/src/draft.ts::stepDraft (manager-first, else visible index 0)",
        position_first:
          "attempt manager target until its first coach-bearing draw; on honest dead-end target first vacant slot and pick visible index 0",
      },
      tie_definition:
        "a full numeric three-player offer is tied when at least one candidate pair differs by no more than the threshold",
      estimate_exclusion_definition:
        "remove candidates whose selected visible basis is career_stature_estimate or baseline_anchor_estimate; retain the offer denominator only when at least two non-estimate numeric candidates remain",
      confidence_interval:
        "95% draft-cluster-robust ratio normal interval; each complete 17-spin draft is one independent seed cluster",
      pool_baseline:
        "exact combinatorial probability for three cards drawn uniformly without replacement from the era-filtered display histogram; descriptive denominator, not a reconstruction of squad-weighted offer logic",
    },
    convergence: {
      gate: {
        max_absolute_rate_shift_each_doubling: 0.01,
        max_measurement_ci95_half_width: 0.015,
      },
      pass: convergencePass,
      max_absolute_rate_shift_512_to_1024: shift512To1024,
      max_absolute_rate_shift_1024_to_2048_holdout: shift1024To2048,
      max_ci95_half_width_at_1024: round(maxHalfWidth),
      prefixes: prefixSummaries,
    },
    inputs: {
      base_commit: "fc1748f4e4eaaa0994530c83db81582e82e7687c",
      bundle_path: BUNDLE_REL,
      bundle_compressed_bytes: bundleCompressed.length,
      bundle_compressed_sha256: sha256(bundleCompressed),
      bundle_decoded_bytes: bundleRaw.length,
      bundle_decoded_sha256: sha256(bundleRaw),
      manifest_path: MANIFEST_REL,
      manifest_sha256: sha256(manifestBytes),
      core_draft_path: CORE_DRAFT_REL,
      core_draft_sha256: sha256(read(CORE_DRAFT_REL)),
      web_dataset_mapping_path: WEB_DATA_REL,
      web_dataset_mapping_sha256: sha256(read(WEB_DATA_REL)),
      web_display_adapter_path: WEB_ADAPTER_REL,
      web_display_adapter_sha256: sha256(read(WEB_ADAPTER_REL)),
      schema_version: manifest.schema_version,
      dataset_version: manifest.dataset_version,
      rating_version_historical: manifest.rating_version_historical,
      rating_version_projected: manifest.rating_version_projected,
      engine_version: manifest.engine_version,
    },
    verified_population: {
      player_cards: bundle.player_cards.length,
      ratings: bundle.ratings.length,
      career_visible_estimate_cards: careerEstimateCount,
      current_visible_estimate_cards: currentEstimateCount,
      cards_where_engine_and_visible_position_fields_differ: positionFieldMismatches,
    },
    shipped_mechanics: {
      offer_construction:
        "calls buildDraftCatalog/createDraft/selectDraftTarget/pickPlayer/pickManager/stepDraft from packages/core/src; no tiering logic is reimplemented",
      tier_input:
        "selected-basis display overall through the core DraftPlayerCard.choice_overall resolver",
      visible_values: "selected basis: top-level Career alias or basis_ratings.current",
      candidate_frame:
        "era-weighted tournament-nation pair, then globally deduped remaining squad roster; not a flat draw from the era pool",
      soft_floor:
        "rank into eight buckets and retain tiers 0, 1, 2; tier 2 is the softened lower choice",
      daily:
        "same classic/squad_first/all_time/career createDraft path with a deterministic per-UTC-date parent seed and optional published salt",
    },
    offer_record_encoding: {
      visible_overall_basis_provenance_codes: PROVENANCE_CODES,
      provenance_mask_bits: {
        "1": "same exact non-estimate overall_basis in at least one tied pair",
        "2": "same exact estimate overall_basis in at least one tied pair",
        "4": "cross-overall_basis in at least one tied pair",
      },
      tie_mask_bits: { "1": "delta 0", "2": "delta <=1", "4": "delta <=2" },
    },
    pool_views: poolViews(bundle, dataset, ratingById),
    cells: cells.map(cellOutput),
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

main();
