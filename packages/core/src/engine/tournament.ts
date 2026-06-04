// WS-B tournament orchestrator — plays the seeded 8-match path (3 group +
// R32→Final) for a draft + scenario and assembles a fully-derived RunResult.
//
// DETERMINISM: per-substream sub-seeds (match_sim / event_gen /
// opponent_selection / narrative) are derived from the run seed via
// `deriveSubseed`; no fresh RNG. Same (draft, scenario, seed, version anchors)
// → byte-identical RunResult.
//
// ─── CONTRACT-GAP NOTE (for review) ──────────────────────────────────────────
// `RunTournamentFn` is `(draft, scenario, seed)` but a `DraftState` carries no
// per-card Ratings and a `RunScenario` carries only opponent team_id STRINGS —
// neither the user-squad ratings, the opponent `Team2026` records, the manager
// rating, nor the per-card nation are threaded through the WS-0c signature.
// Until real-2026 ingestion + bracket wiring lands (a later lane), the engine
// needs those resolved inputs. We bridge with an OPTIONAL 4th param `world: SimWorld`
// — type-compatible with `RunTournamentFn` (an extra optional argument keeps the
// value assignable to the 3-arg type). The 3-arg form throws an honest error;
// callers (tests, WS-C/WS-D) pass an explicit `SimWorld`.

import type { DraftState } from "../types/draft.js";
import type { ManagerRating, ManagerTournament } from "../types/manager.js";
import type { Rating, TeamStrength } from "../types/rating.js";
import type { CardId } from "../types/identity.js";
import type { MatchPhase, MatchRound, KnockoutRound } from "../types/primitives.js";
import type { MatchLineupEntry, MatchResult } from "../types/sim.js";
import type { RoundResult, RunResult } from "../types/run.js";
import type { ScoringConfig } from "../types/scoring.js";
import type { RunScenario, Team2026 } from "../types/tournament.js";
import type { RunTournamentFn } from "../api/sim.js";
import type { StarterContribution } from "../api/team-strength.js";
import { FORMATION_TEMPLATES, slotPositionLine } from "../types/formation.js";
import { canonicalSortBy, createRng, deriveSubseed } from "../rng.js";
import { computeSynergy } from "./synergy.js";
import { aggregateUserXiStrength } from "./team-strength.js";
import {
  simulateMatchCore,
  membersFromTeam2026,
  stripInternal,
  tournamentEndingInjuries,
  type SimMember,
} from "./match.js";
import { deriveUserPlayerRunStats } from "./stats.js";
import { computeScore, resolveTopScorer } from "./scoring.js";
import { DEFAULT_SCORING_CONFIG, INJURY } from "./calibration.js";

/**
 * Resolved inputs the (draft, scenario, seed) signature does not thread through.
 * See the contract-gap note above. Real wiring is the real-2026 ingestion lane.
 */
export interface SimWorld {
  /** card_id → Rating for every card in the user squad (all 16). */
  ratings: Readonly<Record<string, Rating>>;
  /** team_id → Team2026 for every opponent reachable in the scenario. */
  opponents: Readonly<Record<string, Team2026>>;
  /** manager_card_id → ManagerRating, when a manager was drafted. */
  managerRatings?: Readonly<Record<string, ManagerRating>>;
  /** manager_card_id → ManagerTournament, for the Synergy manager link. */
  managerTournaments?: Readonly<Record<string, ManagerTournament>>;
  /** card_id → nation_id, for Synergy nation clustering. */
  nationByCardId?: Readonly<Record<string, string>>;
  /** Calibrated scoring config; defaults to DEFAULT_SCORING_CONFIG. */
  scoringConfig?: ScoringConfig;
}

const KNOCKOUT_LADDER: readonly KnockoutRound[] = ["R32", "R16", "QF", "SF", "F"];
const GROUP_ROUNDS: readonly MatchRound[] = ["G1", "G2", "G3"];

/** Below the fieldable floor → forfeit (safety valve; see calibration). */
export function isBelowFieldableFloor(availableCount: number): boolean {
  return availableCount < INJURY.FIELDABLE_FLOOR;
}

function strengthScalar(s: TeamStrength): number {
  return s.attack + s.midfield + s.defense + s.goalkeeping;
}

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

/** Select the escalating-strength knockout opponent ladder (R32→F). */
function selectKnockoutLadder(
  scenario: RunScenario,
  world: SimWorld,
  seed: string,
): Team2026[] {
  const rule = scenario.knockout_opponent_rule;
  const groupSet = new Set(scenario.group_opponent_team_ids);
  // Candidate pool: every known opponent not already a group opponent.
  const pool = Object.values(world.opponents).filter((t) => !groupSet.has(t.team_id));
  // DETERMINISM INVARIANT: sort the pool by (strength asc, team_id) before any
  // draw so insertion-order drift cannot change selection.
  const sorted = canonicalSortBy(pool, (t) => [strengthScalar(t.aggregate_rating), t.team_id]);
  const rounds = rule.rounds.length > 0 ? rule.rounds : KNOCKOUT_LADDER;
  const K = rounds.length;
  if (sorted.length < K) {
    throw new RangeError(
      `escalating_strength_seeded needs ≥${K} candidate opponents, pool has ${sorted.length}`,
    );
  }
  const rng = createRng(deriveSubseed(seed, "opponent_selection", rule.seed_suffix));
  // Partition the strength-sorted pool into K contiguous escalating bands; pick
  // one (seeded) from each band so each round's opponent is ≥ the previous.
  const ladder: Team2026[] = [];
  const used = new Set<string>();
  for (let r = 0; r < K; r++) {
    const lo = Math.floor((r * sorted.length) / K);
    const hi = Math.floor(((r + 1) * sorted.length) / K); // exclusive
    const band = sorted.slice(lo, Math.max(hi, lo + 1)).filter((t) => !used.has(t.team_id));
    const candidates = band.length > 0 ? band : sorted.filter((t) => !used.has(t.team_id));
    const pick = candidates[rng.int(candidates.length)]!;
    used.add(pick.team_id);
    ladder.push(pick);
  }
  return ladder;
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

interface PlannedMatch {
  round: MatchRound;
  phase: MatchPhase;
  opponent: Team2026;
}

/**
 * Run the full tournament path. Returns the ordered MatchResult[] AND the
 * derived RunResult. Exposed so the golden generator can persist BOTH the
 * event-bearing matches and the schema-clean RunResult.
 */
export function runTournamentFull(
  draft: DraftState,
  scenario: RunScenario,
  seed: string,
  world: SimWorld,
): { run: RunResult; matches: MatchResult[] } {
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

  // ── Plan the opponent path. ──
  const groupOpponents: Team2026[] = scenario.group_opponent_team_ids.map((tid) => {
    const t = world.opponents[tid];
    if (!t) throw new RangeError(`SimWorld is missing group opponent team_id ${tid}`);
    return t;
  });
  const knockoutLadder = selectKnockoutLadder(scenario, world, seed);

  const plan: PlannedMatch[] = [];
  for (let i = 0; i < GROUP_ROUNDS.length; i++) {
    plan.push({ round: GROUP_ROUNDS[i]!, phase: "group", opponent: groupOpponents[i]! });
  }
  for (let i = 0; i < knockoutLadder.length; i++) {
    plan.push({ round: KNOCKOUT_LADDER[i]!, phase: "knockout", opponent: knockoutLadder[i]! });
  }

  // ── Play the path. ──
  const matches: MatchResult[] = [];
  const injuredOut = new Set<string>();

  for (let idx = 0; idx < plan.length; idx++) {
    const p = plan[idx]!;
    const matchId = `${draft.run_id}.m${idx}`;
    const available = baseUserMembers.filter((m) => !injuredOut.has(m.player_id));

    if (isBelowFieldableFloor(available.length)) {
      // Forfeit the remaining path (safety valve).
      matches.push(makeForfeitMatch(matchId, idx, p.round, p.phase, p.opponent.team_id, available));
      break;
    }

    const structRng = createRng(deriveSubseed(seed, "match_sim", `match:${idx}`));
    const eventRng = createRng(deriveSubseed(seed, "event_gen", `match:${idx}`));
    const core = simulateMatchCore({
      matchId,
      matchIndex: idx,
      round: p.round,
      phase: p.phase,
      opponentTeamId: p.opponent.team_id,
      userMembers: available,
      oppMembers: membersFromTeam2026(p.opponent),
      userStrength,
      oppStrength: p.opponent.aggregate_rating,
      structRng,
      eventRng,
    });
    for (const pid of tournamentEndingInjuries(core)) injuredOut.add(pid);
    matches.push(stripInternal(core));

    // A knockout loss eliminates the user — stop the path here.
    if (p.phase === "knockout" && core.outcome === "L") break;
  }

  const run = assembleRunResult(draft, scenario, seed, world, matches);
  return { run, matches };
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
  return { ...partial, score, score_breakdown: breakdown };
}

/**
 * Public `runTournament` — see `api/sim.ts` for the contract. The 4th `world`
 * param bridges the (draft, scenario, seed) input gap (contract-gap note above);
 * it is required at runtime but optional in the type so this value stays
 * assignable to `RunTournamentFn`.
 */
export const runTournament: RunTournamentFn = (
  draft: DraftState,
  scenario: RunScenario,
  seed: string,
  world?: SimWorld,
): RunResult => {
  if (!world) {
    throw new Error(
      "runTournament requires a resolved SimWorld (user ratings + Team2026 opponents). " +
        "The (draft, scenario, seed) signature does not thread these yet — real-2026 " +
        "ingestion + bracket wiring is a later lane. Pass an explicit SimWorld 4th argument.",
    );
  }
  return runTournamentFull(draft, scenario, seed, world).run;
};
