// Season 2 S3 — deterministic squad-depth counterfactual calibration gate.
//
// Default gate (binding):
//   pnpm --filter @wcdraft/data exec tsx scripts/measure-squad-depth-calibration.mts
//
// Diagnostic override (never the CI gate):
//   WCDRAFT_SQUAD_DEPTH_N=200 WCDRAFT_SQUAD_DEPTH_REPORT=1 \
//     pnpm --filter @wcdraft/data exec tsx scripts/measure-squad-depth-calibration.mts
//
// PREREGISTRATION — frozen before tuning any production constant:
// Each baseline/counterfactual pair reuses the exact parent seed and completed
// draft. The counterfactuals consume no new production RNG stream:
//   - zero bench: clear only the five bench slots;
//   - no manager: clear only manager_card_id;
//   - XI runner-up: replace one starter with the second-ranked card from that
//     starter's actual offer, using the same policy ordering as the baseline.
// The XI perturbation never re-drafts, so later offers and the tournament RNG
// remain fixed. Final-score mean absolute delta is diagnostic and is always
// divided by all N runs.
//
// Bounded magnitude uses the λ-derived MatchResult.pre_match_win_probability,
// not final tournament score. A fixture enters that denominator only when the
// baseline and counterfactual expose the exact same match_index, round, phase,
// and opponent_team_id. These pairs reuse the scenario, parent seed,
// match-index RNG substreams, and availability substream. Baseline fixtures
// after path divergence are counted as excluded and are never compared with a
// different opponent. The denominator is every exact same-fixture pair across
// all N runs, including zero movement. Win probability is used because it is
// directly exposed from the λ path; expected points is not.
//
// Frozen strategic-policy gates at N=2000:
//   bench final-score sensitivity >=35%; activation 40-55%; paired per-match
//     mean |win-prob delta| <= 0.0500;
//   no-manager final-score sensitivity >=25%; paired per-match mean
//     |win-prob delta| <= 0.0150;
//   offer-faithful XI sensitivity strictly exceeds both; qualifying 64-68%;
//     mean score 14.0-15.0.

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import {
  autoDraft,
  buildDraftCatalog,
  buildRunScenario,
  positionCompatibility,
  runTournamentFull,
  type CardId,
  type DraftState,
  type MatchResult,
  type SquadSlot,
  type Team2026,
} from "@wcdraft/core";

import { DRAFT_POOL_BUNDLE, RUNTIME_DATA_MANIFEST, SCENARIO_2026_BUNDLE } from "../src/index.js";
import {
  buildPolicyContext,
  rankStrategicCandidatesForSlot,
  runAutoDraftPolicy,
  type PolicyContext,
} from "../test/realism/draft-policies.js";
import {
  ALL_POLICIES,
  DEFAULT_SEED_PREFIX,
  buildRealismDataset,
  buildRealismSimWorld,
  type DraftPolicyName,
} from "../test/realism/realism.harness.js";

const LOCKED_N = 2000;
const BENCH_MEAN_WIN_PROB_DELTA_MAX = 0.05;
const MANAGER_MEAN_WIN_PROB_DELTA_MAX = 0.015;
const N = Number(process.env.WCDRAFT_SQUAD_DEPTH_N ?? LOCKED_N);
const SEED_PREFIX = process.env.WCDRAFT_REALISM_SEED_PREFIX ?? DEFAULT_SEED_PREFIX;
const REPORT_ONLY = process.env.WCDRAFT_SQUAD_DEPTH_REPORT === "1";
const POLICY_FILTER = process.env.WCDRAFT_SQUAD_DEPTH_POLICY;

if (!Number.isSafeInteger(N) || N <= 0) throw new Error(`N must be a positive integer; got ${N}`);

function isPolicy(value: string): value is DraftPolicyName {
  return (ALL_POLICIES as readonly string[]).includes(value);
}
if (POLICY_FILTER !== undefined && !isPolicy(POLICY_FILTER)) {
  throw new Error(`WCDRAFT_SQUAD_DEPTH_POLICY must be one of ${ALL_POLICIES.join(", ")}`);
}
const POLICIES: readonly DraftPolicyName[] =
  POLICY_FILTER === undefined ? ALL_POLICIES : [POLICY_FILTER];

const COMBINED_RATING_VERSION = `${RUNTIME_DATA_MANIFEST.rating_version_historical}+${RUNTIME_DATA_MANIFEST.rating_version_projected}`;

interface CounterfactualMetric {
  changed_runs: number;
  sensitivity: number;
  total_abs_delta: number;
  mean_abs_delta: number;
  mean_abs_delta_changed_runs: number;
  abs_delta_buckets: {
    one: number;
    two_to_three: number;
    four_to_seven: number;
    eight_plus: number;
  };
  per_match_win_probability: PairedMatchMagnitude;
}

interface PairedMatchMagnitude {
  baseline_exposure_matches: number;
  compared_same_fixture_matches: number;
  excluded_after_path_divergence: number;
  total_abs_delta: number;
  mean_abs_delta: number;
}

interface PolicyCalibrationRow {
  runs: number;
  qualifying_runs: number;
  qualifying_rate: number;
  mean_score: number;
  activation_runs: number;
  activation_rate: number;
  activation_events: number;
  activation_events_per_activated_run: number;
  manager_linked_runs: number;
  manager_linked_rate: number;
  tactical_band_runs: number;
  tactical_band_rate: number;
  zero_bench: CounterfactualMetric;
  no_manager: CounterfactualMetric;
  xi_runner_up: CounterfactualMetric;
}

interface DeltaAccumulator {
  changed: number;
  absolute: number;
  buckets: CounterfactualMetric["abs_delta_buckets"];
  magnitude: {
    baseline: number;
    compared: number;
    excluded: number;
    absolute: number;
  };
}

function addDelta(acc: DeltaAccumulator, baseline: number, counterfactual: number): void {
  const delta = Math.abs(baseline - counterfactual);
  if (delta !== 0) acc.changed++;
  acc.absolute += delta;
  if (delta === 1) acc.buckets.one++;
  else if (delta <= 3 && delta > 0) acc.buckets.two_to_three++;
  else if (delta <= 7 && delta > 0) acc.buckets.four_to_seven++;
  else if (delta >= 8) acc.buckets.eight_plus++;
}

function addPairedMatchMagnitude(
  acc: DeltaAccumulator,
  baseline: readonly MatchResult[],
  counterfactual: readonly MatchResult[],
): void {
  acc.magnitude.baseline += baseline.length;
  const counterfactualByIndex = new Map(counterfactual.map((match) => [match.match_index, match]));
  for (const source of baseline) {
    const candidate = counterfactualByIndex.get(source.match_index);
    if (
      candidate === undefined ||
      candidate.round !== source.round ||
      candidate.phase !== source.phase ||
      candidate.opponent_team_id !== source.opponent_team_id
    ) {
      acc.magnitude.excluded++;
      continue;
    }
    acc.magnitude.compared++;
    acc.magnitude.absolute += Math.abs(
      source.pre_match_win_probability - candidate.pre_match_win_probability,
    );
  }
}

function finishDelta(acc: DeltaAccumulator): CounterfactualMetric {
  return {
    changed_runs: acc.changed,
    sensitivity: acc.changed / N,
    total_abs_delta: acc.absolute,
    mean_abs_delta: acc.absolute / N,
    mean_abs_delta_changed_runs: acc.changed > 0 ? acc.absolute / acc.changed : 0,
    abs_delta_buckets: acc.buckets,
    per_match_win_probability: {
      baseline_exposure_matches: acc.magnitude.baseline,
      compared_same_fixture_matches: acc.magnitude.compared,
      excluded_after_path_divergence: acc.magnitude.excluded,
      total_abs_delta: acc.magnitude.absolute,
      mean_abs_delta:
        acc.magnitude.compared > 0 ? acc.magnitude.absolute / acc.magnitude.compared : 0,
    },
  };
}

function makeDraft(
  policy: DraftPolicyName,
  parentSeed: string,
  index: number,
  catalog: ReturnType<typeof buildDraftCatalog>,
  dataset: ReturnType<typeof buildRealismDataset>,
  ctx: PolicyContext,
): DraftState {
  const params = {
    run_id: `s3-calibration-${policy}-${String(index).padStart(4, "0")}`,
    parent_seed: parentSeed,
    formation_id: "4-3-3" as const,
    mode: "classic" as const,
    team_name: `S3 calibration ${policy} #${index}`,
    dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
    rating_version: COMBINED_RATING_VERSION,
    engine_version: RUNTIME_DATA_MANIFEST.engine_version,
    dataset,
  };
  return policy === "autoDraft"
    ? autoDraft(params)
    : runAutoDraftPolicy(
        catalog,
        params,
        ctx,
        policy === "strategicAutoDraft" ? "strategic" : "greedy",
      );
}

function clearSlot(slot: SquadSlot): SquadSlot {
  return {
    ...slot,
    card_id: null,
    player_id: null,
    tournament_id: null,
    position_compatibility: 0,
    validation_warnings: [],
  };
}

function withoutBench(draft: DraftState): DraftState {
  return {
    ...draft,
    squad: draft.squad.map((slot) => (slot.is_starter ? slot : clearSlot(slot))),
  };
}

function withoutManager(draft: DraftState): DraftState {
  return { ...draft, manager_card_id: null };
}

function orderedOffer(
  policy: DraftPolicyName,
  cardIds: readonly CardId[],
  slot: SquadSlot,
  ctx: PolicyContext,
): readonly CardId[] {
  if (policy === "autoDraft") return cardIds;
  if (policy === "strategicAutoDraft") {
    return rankStrategicCandidatesForSlot(cardIds, slot.slot_position, ctx).map(
      (row) => row.cardId,
    );
  }
  return cardIds.slice().sort((left, right) => {
    const leftOverall = ctx.ratings.get(left)?.overall ?? 0;
    const rightOverall = ctx.ratings.get(right)?.overall ?? 0;
    if (leftOverall !== rightOverall) return rightOverall - leftOverall;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * Replace exactly one XI pick with its actual offer runner-up. Starter spins
 * are scanned in original spin order; the first legal second choice is used.
 * A candidate already present elsewhere in the completed squad is skipped so
 * the controlled XI remains a valid 16-player identity set.
 */
function withXiRunnerUp(
  draft: DraftState,
  policy: DraftPolicyName,
  ctx: PolicyContext,
): DraftState {
  const slotById = new Map(draft.squad.map((slot) => [slot.slot_id, slot]));
  const draftedCardIds = new Set(
    draft.squad.flatMap((slot) => (slot.card_id === null ? [] : [slot.card_id as CardId])),
  );
  const draftedPlayerIds = new Set(
    draft.squad.flatMap((slot) => (slot.player_id === null ? [] : [slot.player_id])),
  );
  const cardById = new Map(DRAFT_POOL_BUNDLE.player_cards.map((card) => [card.card_id, card]));

  for (const spin of draft.spins) {
    if (spin.picked_kind !== "player" || spin.assigned_slot_id === null) continue;
    const slot = slotById.get(spin.assigned_slot_id);
    if (!slot?.is_starter || slot.card_id === null) continue;
    const ranked = orderedOffer(policy, spin.rolled_card_ids, slot, ctx);
    if (ranked.length < 2 || ranked[0] !== spin.picked_card_id) continue;
    const runnerUpId = ranked[1]!;
    const replacement = cardById.get(runnerUpId);
    if (!replacement) throw new Error(`missing runner-up player card ${runnerUpId}`);
    if (draftedCardIds.has(runnerUpId) || draftedPlayerIds.has(replacement.player_id)) continue;

    const compatibility = positionCompatibility(replacement.eligible_positions, slot.slot_position);
    if (!(compatibility > 0)) continue;

    const nextSlot: SquadSlot = {
      ...slot,
      card_id: replacement.card_id,
      player_id: replacement.player_id,
      tournament_id: replacement.tournament_id,
      position_compatibility: compatibility,
      validation_warnings: [],
    };
    return {
      ...draft,
      squad: draft.squad.map((candidate) =>
        candidate.slot_id === slot.slot_id ? nextSlot : candidate,
      ),
    };
  }
  throw new Error(`no legal XI offer runner-up found for ${draft.run_id}`);
}

function runPolicy(policy: DraftPolicyName): PolicyCalibrationRow {
  const dataset = buildRealismDataset();
  const catalog = buildDraftCatalog(dataset);
  const world = buildRealismSimWorld();
  const ctx = buildPolicyContext(DRAFT_POOL_BUNDLE.player_cards, DRAFT_POOL_BUNDLE.ratings);
  const emptyDelta = (): DeltaAccumulator => ({
    changed: 0,
    absolute: 0,
    buckets: { one: 0, two_to_three: 0, four_to_seven: 0, eight_plus: 0 },
    magnitude: { baseline: 0, compared: 0, excluded: 0, absolute: 0 },
  });
  const benchDelta = emptyDelta();
  const managerDelta = emptyDelta();
  const xiDelta = emptyDelta();
  let qualifyingRuns = 0;
  let activationRuns = 0;
  let activationEvents = 0;
  let managerLinkedRuns = 0;
  let tacticalBandRuns = 0;
  let scoreTotal = 0;

  for (let index = 0; index < N; index++) {
    const parentSeed = `${SEED_PREFIX}:${String(index).padStart(4, "0")}`;
    const draft = makeDraft(policy, parentSeed, index, catalog, dataset, ctx);
    const scenario = buildRunScenario({
      parent_seed: parentSeed,
      teams: SCENARIO_2026_BUNDLE.teams as readonly Team2026[],
      bracket: {
        groups: SCENARIO_2026_BUNDLE.groups,
        knockout_slots: SCENARIO_2026_BUNDLE.knockout_slots,
      },
      ruleset_version: RUNTIME_DATA_MANIFEST.ruleset_version,
    }).scenario;

    const baseline = runTournamentFull(draft, scenario, parentSeed, world);
    const zeroBench = runTournamentFull(withoutBench(draft), scenario, parentSeed, world);
    const noManager = runTournamentFull(withoutManager(draft), scenario, parentSeed, world);
    const xiRunnerUp = runTournamentFull(
      withXiRunnerUp(draft, policy, ctx),
      scenario,
      parentSeed,
      world,
    );

    scoreTotal += baseline.run.score;
    if (baseline.group_stage.user_qualified) qualifyingRuns++;
    const runActivationEvents = baseline.matches.reduce(
      (sum, match) => sum + (match.team_facts?.bench_activations.length ?? 0),
      0,
    );
    activationEvents += runActivationEvents;
    if (runActivationEvents > 0) {
      activationRuns++;
    }
    if (
      baseline.matches.some((match) => (match.team_facts?.active_synergy.manager_link ?? 0) > 0)
    ) {
      managerLinkedRuns++;
    }
    if (baseline.matches.some((match) => (match.team_facts?.manager_tactical_band ?? 0) > 0)) {
      tacticalBandRuns++;
    }
    addDelta(benchDelta, baseline.run.score, zeroBench.run.score);
    addDelta(managerDelta, baseline.run.score, noManager.run.score);
    addDelta(xiDelta, baseline.run.score, xiRunnerUp.run.score);
    addPairedMatchMagnitude(benchDelta, baseline.matches, zeroBench.matches);
    addPairedMatchMagnitude(managerDelta, baseline.matches, noManager.matches);
    addPairedMatchMagnitude(xiDelta, baseline.matches, xiRunnerUp.matches);
  }

  return {
    runs: N,
    qualifying_runs: qualifyingRuns,
    qualifying_rate: qualifyingRuns / N,
    mean_score: scoreTotal / N,
    activation_runs: activationRuns,
    activation_rate: activationRuns / N,
    activation_events: activationEvents,
    activation_events_per_activated_run: activationRuns > 0 ? activationEvents / activationRuns : 0,
    manager_linked_runs: managerLinkedRuns,
    manager_linked_rate: managerLinkedRuns / N,
    tactical_band_runs: tacticalBandRuns,
    tactical_band_rate: tacticalBandRuns / N,
    zero_bench: finishDelta(benchDelta),
    no_manager: finishDelta(managerDelta),
    xi_runner_up: finishDelta(xiDelta),
  };
}

function assertBindingTargets(row: PolicyCalibrationRow): void {
  assert.equal(N, LOCKED_N, `binding S3 gate requires N=${LOCKED_N}; got ${N}`);
  assert.equal(SEED_PREFIX, DEFAULT_SEED_PREFIX, "binding S3 gate requires the locked seed prefix");
  assert.ok(row.zero_bench.sensitivity >= 0.35, "bench sensitivity must be >= 35%");
  assert.ok(
    row.zero_bench.per_match_win_probability.mean_abs_delta <= BENCH_MEAN_WIN_PROB_DELTA_MAX,
    "bench paired per-match win-probability movement exceeds its preregistered bound",
  );
  assert.ok(
    row.activation_rate >= 0.4 && row.activation_rate <= 0.55,
    "bench activation rate must be within 40-55%",
  );
  assert.ok(row.no_manager.sensitivity >= 0.25, "manager sensitivity must be >=25%");
  assert.ok(
    row.no_manager.per_match_win_probability.mean_abs_delta <= MANAGER_MEAN_WIN_PROB_DELTA_MAX,
    "manager paired per-match win-probability movement exceeds its preregistered bound",
  );
  assert.ok(
    row.xi_runner_up.sensitivity > row.zero_bench.sensitivity,
    "XI runner-up sensitivity must exceed bench sensitivity",
  );
  assert.ok(
    row.xi_runner_up.sensitivity > row.no_manager.sensitivity,
    "XI runner-up sensitivity must exceed manager sensitivity",
  );
  assert.ok(
    row.qualifying_rate >= 0.64 && row.qualifying_rate <= 0.68,
    "strategic qualifying rate must be within 64-68%",
  );
  assert.ok(
    row.mean_score >= 14 && row.mean_score <= 15,
    "strategic mean score must be within 14.0-15.0",
  );
}

const startedAt = performance.now();
const rows = Object.fromEntries(POLICIES.map((policy) => [policy, runPolicy(policy)])) as Partial<
  Record<DraftPolicyName, PolicyCalibrationRow>
>;
const strategic = rows.strategicAutoDraft;
if (!REPORT_ONLY) {
  assert.ok(
    strategic !== undefined,
    "binding S3 gate must include the strategicAutoDraft policy row",
  );
  assertBindingTargets(strategic);
}

const output = {
  schema_version: "squad-depth-calibration-2.0.0",
  seed_prefix: SEED_PREFIX,
  runs_per_policy: N,
  mean_abs_delta_denominator: "all_runs",
  per_match_magnitude_definition:
    "mean absolute pre_match_win_probability movement over exact same match_index+round+phase+opponent pairs; post-divergence baseline fixtures excluded, never compared to a different opponent",
  per_match_magnitude_denominator: "all_exact_same_fixture_pairs_including_zero_movement",
  frozen_bounds: {
    bench_mean_abs_win_probability_delta_max: BENCH_MEAN_WIN_PROB_DELTA_MAX,
    manager_mean_abs_win_probability_delta_max: MANAGER_MEAN_WIN_PROB_DELTA_MAX,
  },
  xi_runner_up_definition:
    "first legal starter spin; replace selected policy winner with that actual offer's policy-ranked second card; completed board and tournament seed unchanged",
  zero_bench_definition:
    "clear the five bench slots while preserving the baseline XI, board, and tournament seed; availability draws remain paired",
  policies: rows,
};

console.log(JSON.stringify(output, null, 2));
console.log(
  `[S3-CALIBRATION] ${REPORT_ONLY ? "REPORT" : "PASS"} policies=${POLICIES.join(",")} N=${N} elapsed=${((performance.now() - startedAt) / 1000).toFixed(1)}s`,
);
