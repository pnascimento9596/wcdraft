// WS-B tournament orchestrator — plays the user XI's path through their
// 2026 group and the knockout ladder, and assembles a fully-derived
// RunResult.
//
// I3.3–I3.5 changes:
//   - User group: plays G1/G2/G3 first, then `simulateOtherGroupMatches`
//     produces three intra-opponent (Team2026 vs Team2026) summaries (NOT
//     added to `matches`). `buildGroupStageResult` computes the four-row
//     table + qualification verdict.
//   - Gate: if `group_stage.user_qualified === false`, the run stops at G3.
//   - Knockout ladder: `selectKnockoutLadderAfterGroup` runs AFTER the gate;
//     R32 is bracket-constrained from `world.bracket` when available, with
//     deterministic fallback to the global escalating pool.
//   - Narrative: `assembleRunResult` calls `buildNarrative` so
//     `RunResult.narrative` carries real `template_id` + `filled_text`.
//
// DETERMINISM: per-substream sub-seeds (`match_sim`/`event_gen` with
// `match:N`, `match_sim`/`event_gen` with `group-other:N`, `opponent_selection`,
// `group_table`, `narrative`) are derived from the run seed via
// `deriveSubseed`; no fresh RNG. Same (draft, scenario, seed, world, version
// anchors) → byte-identical `{ run, matches, group_stage, knockout_ladder_meta }`.
//
// SimWorld threading: `DraftState` carries no per-card Ratings and a
// `RunScenario` carries only opponent team_id strings. The engine consumes
// the resolved maps via a REQUIRED `world: SimWorld` 4th argument.

import type { DraftState } from "../types/draft.js";
import type { ManagerRating, ManagerTournament } from "../types/manager.js";
import type { TeamStrength } from "../types/rating.js";
import type { CardId } from "../types/identity.js";
import type { MatchPhase, MatchRound, KnockoutRound } from "../types/primitives.js";
import type { MatchLineupEntry, MatchResult, SimWorld } from "../types/sim.js";
import type { RoundResult, RunResult } from "../types/run.js";
import type { RunScenario, Team2026 } from "../types/tournament.js";
import type { GroupStageResult } from "../types/group-stage.js";
import type { RunTournamentFn } from "../api/sim.js";
import type { StarterContribution } from "../api/team-strength.js";
import { FORMATION_TEMPLATES, slotPositionLine } from "../types/formation.js";
import { createRng, deriveSubseed } from "../rng.js";
import { computeSynergy } from "./synergy.js";
import { aggregateUserXiStrength } from "./team-strength.js";
import {
  simulateMatchCore,
  membersFromTeam2026,
  stripInternal,
  tournamentEndingInjuries,
  type SimMember,
} from "./match.js";
import { buildNarrative } from "../narrative/select.js";
import { deriveUserPlayerRunStats } from "./stats.js";
import { computeScore, resolveTopScorer } from "./scoring.js";
import { DEFAULT_SCORING_CONFIG, INJURY } from "./calibration.js";
import { buildGroupStageResult, simulateOtherGroupMatches } from "./group-stage.js";
import { selectKnockoutLadderAfterGroup, type KnockoutLadderMeta } from "./opponent-selection.js";

const GROUP_ROUNDS: ReadonlyArray<"G1" | "G2" | "G3"> = ["G1", "G2", "G3"];

/** Below the fieldable floor → forfeit (safety valve; see calibration). */
export function isBelowFieldableFloor(availableCount: number): boolean {
  return availableCount < INJURY.FIELDABLE_FLOOR;
}

function strengthScalar(s: TeamStrength): number {
  return s.attack + s.midfield + s.defense + s.goalkeeping;
}
// `strengthScalar` is now used inside `engine/opponent-selection.ts`; the
// import-only reference here keeps the helper colocated for any future
// engine-side aggregation work.
void strengthScalar;

/** Build the user SimMembers (starters + bench) from the draft squad + ratings. */
function userMembersFromDraft(draft: DraftState, world: SimWorld): SimMember[] {
  const members: SimMember[] = [];
  for (const slot of draft.squad) {
    if (slot.card_id === null || slot.player_id === null || slot.tournament_id === null) continue;
    const rating = world.ratings[slot.card_id as string];
    members.push({
      side: "user",
      card_id: slot.card_id,
      player_id: slot.player_id,
      tournament_id: slot.tournament_id,
      slot_id: slot.slot_id,
      position: slotPositionLine(slot.slot_position),
      started: slot.is_starter,
      attackWeight: (rating?.attack ?? 50) + 1,
      creativeWeight: (rating?.midfield ?? 50) + 1,
    });
  }
  return members;
}

/** Build the 11 StarterContribution rows for team-strength aggregation. */
function starterContributions(draft: DraftState, world: SimWorld): StarterContribution[] {
  const out: StarterContribution[] = [];
  for (const slot of draft.squad) {
    if (!slot.is_starter) continue;
    if (slot.card_id === null) continue;
    const rating = world.ratings[slot.card_id as string];
    if (!rating) {
      throw new RangeError(
        `SimWorld is missing a Rating for starter card_id ${slot.card_id as string}`,
      );
    }
    out.push({
      slot_id: slot.slot_id,
      rating,
      position_compatibility: slot.position_compatibility,
    });
  }
  return out;
}

/** Synthesize a forfeit MatchResult (0–N walkover loss) with no events. */
function makeForfeitMatch(
  matchId: string,
  matchIndex: number,
  round: MatchRound,
  phase: MatchPhase,
  opponentTeamId: string,
  availableUser: readonly SimMember[],
): MatchResult {
  const lineup: MatchLineupEntry[] = availableUser.map((m) => ({
    side: "user",
    card_id: m.card_id,
    player_id: m.player_id,
    tournament_id: m.tournament_id,
    slot_id: m.slot_id,
    position: m.position,
    started: m.started,
    minutes: 0,
  }));
  return {
    match_id: matchId,
    match_index: matchIndex,
    round,
    phase,
    opponent_team_id: opponentTeamId,
    user_goals: 0,
    opp_goals: INJURY.FORFEIT_OPP_GOALS,
    user_goals_et: null,
    opp_goals_et: null,
    shootout: null,
    outcome: "L",
    counts_as_run_win: false,
    advanced: false,
    lineup,
    events: [],
  };
}

/** Result of the engine-internal `runTournamentFull` orchestrator. */
export interface RunTournamentFullResult {
  run: RunResult;
  matches: MatchResult[];
  group_stage: GroupStageResult;
  knockout_ladder_meta: KnockoutLadderMeta;
}

/**
 * Run the full tournament path. Returns:
 *  - the ordered user `matches` (length 3 if eliminated in group, otherwise up
 *    to 8),
 *  - the derived `run: RunResult` (real narrative filled),
 *  - `group_stage: GroupStageResult` (the additive scoped group table), and
 *  - `knockout_ladder_meta: KnockoutLadderMeta` (per-round selection meta,
 *    empty `rounds` when eliminated in group).
 */
export function runTournamentFull(
  draft: DraftState,
  scenario: RunScenario,
  seed: string,
  world: SimWorld,
): RunTournamentFullResult {
  const formation = FORMATION_TEMPLATES[draft.formation_id];
  if (!formation) {
    throw new RangeError(`unknown formation_id ${draft.formation_id} (not in FORMATION_TEMPLATES)`);
  }

  // ── User strength (constant across the run). ──
  const starters = starterContributions(draft, world);
  if (starters.length !== 11) {
    throw new RangeError(`draft is not fieldable: ${starters.length}/11 starters assigned`);
  }
  const managerTournament: ManagerTournament | null = draft.manager_card_id
    ? (world.managerTournaments?.[draft.manager_card_id as string] ?? null)
    : null;
  const managerRating: ManagerRating | null = draft.manager_card_id
    ? (world.managerRatings?.[draft.manager_card_id as string] ?? null)
    : null;
  const synergy = computeSynergy(draft.squad, formation, managerTournament, world.nationByCardId);
  const userStrength = aggregateUserXiStrength(starters, synergy, managerRating);

  // The core consumes draft-derived members directly (real slot positions),
  // never the distilled UserXiSimView — runTournament has the richer source.
  const baseUserMembers = userMembersFromDraft(draft, world);

  // ── Resolve group opponents. ──
  const groupOpponents: Team2026[] = scenario.group_opponent_team_ids.map((tid) => {
    const t = world.opponents[tid];
    if (!t) throw new RangeError(`SimWorld is missing group opponent team_id ${tid}`);
    return t;
  });
  if (groupOpponents.length !== 3) {
    throw new RangeError(`expected exactly 3 group opponents, got ${groupOpponents.length}`);
  }

  const matches: MatchResult[] = [];
  const injuredOut = new Set<string>();

  // ── Group stage: play G1/G2/G3. ──
  // The match-index space for `match:N` substream scopes spans the entire user
  // path: G1=0, G2=1, G3=2, R32=3, R16=4, QF=5, SF=6, F=7. We use the same
  // counter `idx` through the path so the existing per-match scopes stay
  // byte-stable for runs that qualify (idx 3..7 still align with R32..F).
  let idx = 0;
  for (let i = 0; i < GROUP_ROUNDS.length; i++) {
    const opponent = groupOpponents[i]!;
    const round = GROUP_ROUNDS[i]!;
    const matchId = `${draft.run_id}.m${idx}`;
    const available = baseUserMembers.filter((m) => !injuredOut.has(m.player_id));

    if (isBelowFieldableFloor(available.length)) {
      // Synthesize a forfeit for the remaining group match(es) so the table
      // always has exactly three user fixtures. Injuries do NOT regenerate.
      matches.push(makeForfeitMatch(matchId, idx, round, "group", opponent.team_id, available));
      idx++;
      continue;
    }

    const structRng = createRng(deriveSubseed(seed, "match_sim", `match:${idx}`));
    const eventRng = createRng(deriveSubseed(seed, "event_gen", `match:${idx}`));
    const core = simulateMatchCore({
      matchId,
      matchIndex: idx,
      round,
      phase: "group",
      opponentTeamId: opponent.team_id,
      userMembers: available,
      oppMembers: membersFromTeam2026(opponent),
      userStrength,
      oppStrength: opponent.aggregate_rating,
      structRng,
      eventRng,
    });
    for (const pid of tournamentEndingInjuries(core)) injuredOut.add(pid);
    matches.push(stripInternal(core));
    idx++;
  }

  // ── Group stage: intra-opponent matches + table. ──
  const otherSummaries = simulateOtherGroupMatches({
    runId: draft.run_id,
    seed,
    groupOpponents,
  });
  const group_stage = buildGroupStageResult({
    seed,
    group_id: scenario.user_group_id,
    user_matches: matches.slice(0, 3),
    other_matches: otherSummaries,
  });

  let knockout_ladder_meta: KnockoutLadderMeta;

  if (!group_stage.user_qualified) {
    // Eliminated in group: stop here. `assembleRunResult` will see only the
    // three group matches and reach `G3`.
    knockout_ladder_meta = { rounds: [] };
    const run = assembleRunResult(draft, scenario, seed, world, matches);
    return { run, matches, group_stage, knockout_ladder_meta };
  }

  // ── Knockouts: select the ladder AFTER qualification is known. ──
  const ladderResult = selectKnockoutLadderAfterGroup({
    scenario,
    world,
    seed,
    groupStage: group_stage,
  });
  knockout_ladder_meta = ladderResult.meta;

  const knockoutRounds: readonly KnockoutRound[] =
    scenario.knockout_opponent_rule.rounds.length > 0
      ? scenario.knockout_opponent_rule.rounds
      : ["R32", "R16", "QF", "SF", "F"];

  for (let k = 0; k < ladderResult.ladder.length; k++) {
    const opponent = ladderResult.ladder[k]!;
    const round = knockoutRounds[k]!;
    const matchId = `${draft.run_id}.m${idx}`;
    const available = baseUserMembers.filter((m) => !injuredOut.has(m.player_id));

    if (isBelowFieldableFloor(available.length)) {
      matches.push(makeForfeitMatch(matchId, idx, round, "knockout", opponent.team_id, available));
      break;
    }

    const structRng = createRng(deriveSubseed(seed, "match_sim", `match:${idx}`));
    const eventRng = createRng(deriveSubseed(seed, "event_gen", `match:${idx}`));
    const core = simulateMatchCore({
      matchId,
      matchIndex: idx,
      round,
      phase: "knockout",
      opponentTeamId: opponent.team_id,
      userMembers: available,
      oppMembers: membersFromTeam2026(opponent),
      userStrength,
      oppStrength: opponent.aggregate_rating,
      structRng,
      eventRng,
    });
    for (const pid of tournamentEndingInjuries(core)) injuredOut.add(pid);
    matches.push(stripInternal(core));
    idx++;

    if (core.outcome === "L") break;
  }

  const run = assembleRunResult(draft, scenario, seed, world, matches);
  return { run, matches, group_stage, knockout_ladder_meta };
}

function assembleRunResult(
  draft: DraftState,
  scenario: RunScenario,
  seed: string,
  world: SimWorld,
  matches: readonly MatchResult[],
): RunResult {
  const cfg = world.scoringConfig ?? DEFAULT_SCORING_CONFIG;

  const round_results: RoundResult[] = matches.map((m) => ({
    round: m.round,
    advanced: m.advanced,
    outcome: m.outcome,
    goals_for: m.user_goals + (m.user_goals_et ?? 0),
    goals_against: m.opp_goals + (m.opp_goals_et ?? 0),
  }));

  const wins = round_results.filter((r) => r.outcome === "W").length;
  const draws = round_results.filter((r) => r.outcome === "D").length;
  const losses = round_results.filter((r) => r.outcome === "L").length;
  const shootout_wins = matches.filter((m) => m.shootout !== null && m.outcome === "W").length;
  const shootout_losses = matches.filter((m) => m.shootout !== null && m.outcome === "L").length;
  const shootoutCount = matches.filter((m) => m.shootout !== null).length;

  const goals_for = round_results.reduce((a, r) => a + r.goals_for, 0);
  const goals_against = round_results.reduce((a, r) => a + r.goals_against, 0);
  const clean_sheets = round_results.filter((r) => r.goals_against === 0).length;

  const lastMatch = matches[matches.length - 1];
  const wonFinal = lastMatch?.round === "F" && lastMatch.outcome === "W";
  const is_champion = Boolean(wonFinal);
  const reached_round: MatchRound = lastMatch?.round ?? "G1";
  const eliminated_in_match_id = is_champion ? null : (lastMatch?.match_id ?? null);
  const undefeated_regulation = losses === 0 && shootoutCount === 0;

  const player_stats = deriveUserPlayerRunStats(
    matches,
    (card_id: CardId) => world.ratings[card_id as string]?.overall ?? null,
  );
  const top_scorer_player_id = resolveTopScorer(matches);

  // Assemble enough of the run for computeScore, then attach score + breakdown.
  // Narrative is filled below from the scored run + real EventLog.
  const partial: RunResult = {
    run_id: draft.run_id,
    scenario_id: scenario.scenario_id,
    dataset_version: draft.dataset_version,
    rating_version: draft.rating_version,
    engine_version: draft.engine_version,
    seed,
    reached_round,
    eliminated_in_match_id,
    is_champion,
    undefeated_regulation,
    record: `${wins}-${draws}-${losses}`,
    wins,
    draws,
    losses,
    shootout_wins,
    shootout_losses,
    round_results,
    aggregate: { goals_for, goals_against, clean_sheets, top_scorer_player_id },
    score: 0,
    score_breakdown: [],
    player_stats,
    narrative: {
      template_id: "pending",
      narrative_seed: deriveSubseed(seed, "narrative"),
      filled_text: "",
    },
  };

  const { score, breakdown } = computeScore(partial, cfg);
  const scoredRun: RunResult = { ...partial, score, score_breakdown: breakdown };
  // I3.5 — fill real narrative from the EventLog. The narrative engine
  // consumes the scored run + the underlying matches; selection is seeded by
  // `deriveSubseed(seed, "narrative")` (already on `scoredRun.narrative`).
  const narrative = buildNarrative(scoredRun, [...matches]);
  return { ...scoredRun, narrative };
}

/**
 * Public `runTournament` — see `api/sim.ts` for the 4-arg contract. The
 * `world: SimWorld` parameter is REQUIRED and threads the resolved sim inputs
 * (user ratings, Team2026 opponents, optional manager/nation maps, optional
 * scoring config, optional bracket) the (draft, scenario, seed) inputs alone
 * cannot provide. There is no runtime fallback.
 */
export const runTournament: RunTournamentFn = (
  draft: DraftState,
  scenario: RunScenario,
  seed: string,
  world: SimWorld,
): RunResult => {
  return runTournamentFull(draft, scenario, seed, world).run;
};
