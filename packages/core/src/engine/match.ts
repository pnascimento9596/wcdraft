// WS-B match engine — the deterministic, seeded core that turns two team
// strengths + lineups into a full `MatchResult` (scoreline + rich atomic
// `MatchEvent` stream + per-match lineup).
//
// DETERMINISM: every draw goes through the seeded `Rng` (cyrb128 + sfc32).
// No Date / Math.random / crypto / performance. No transcendental math — goal
// counts are drawn as a BINOMIAL over a fixed chance budget (see calibration),
// never a Knuth-Poisson sampler (which needs exp(-λ)).
//
// SAMPLING-POOL INVARIANT: any pool the engine draws from (scorer pool,
// shootout taker order) is CANONICALLY SORTED by `card_id` via `canonicalSortBy`
// before the draw, so insertion-order drift can never silently change a result.

import type { CardId } from "../types/identity.js";
import type { Position, MatchRound, MatchPhase, MatchPeriod } from "../types/primitives.js";
import type { TeamStrength } from "../types/rating.js";
import type {
  GoalEvent,
  MatchEvent,
  MatchLineupEntry,
  MatchResult,
  MatchTeamFacts,
  PenScoredEvent,
  ShootoutKick,
  ShootoutKickEvent,
} from "../types/sim.js";
import type { Team2026 } from "../types/tournament.js";
import { canonicalSortBy, createRng, deriveSubseed } from "../rng.js";
import type { Rng } from "../rng.js";
import type { UserXiSimView } from "../api/sim.js";
import { parseCardId } from "../types/identity.js";
import {
  CHANCE_OUTCOME,
  INCIDENT,
  MINUTES,
  SHOOTOUT,
  activeChances,
  activeLambda,
  clamp,
  lambdaDispersionMultiplier,
  lambdaForFour,
} from "./calibration.js";

// Display-only Skellam/Poisson-difference mass from the already-computed λs.
// The match sampler below remains the locked fixed-chance model and this block
// consumes no RNG, so goals/events/scores stay byte-identical.
const POISSON_MAX_GOALS_FOR_DISPLAY = 32;

function expPositiveFinite(value: number): number {
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 48; i += 1) {
    term *= value / i;
    sum += term;
  }
  return sum;
}

function expNegativeFinite(value: number): number {
  return 1 / expPositiveFinite(value);
}

function poissonGoalProbabilities(lambda: number): number[] {
  const safeLambda = Number.isFinite(lambda) && lambda > 0 ? lambda : 0;
  if (safeLambda === 0) return [1];

  const probabilities = [expNegativeFinite(safeLambda)];
  let current = probabilities[0]!;
  let total = current;
  for (let goals = 1; goals <= POISSON_MAX_GOALS_FOR_DISPLAY; goals += 1) {
    current *= safeLambda / goals;
    probabilities.push(current);
    total += current;
  }
  probabilities[probabilities.length - 1]! += clamp(1 - total, 0, 1);
  return probabilities;
}

function goalWinDrawMass(lambdaFor: number, lambdaAgainst: number): { win: number; draw: number } {
  const forMass = poissonGoalProbabilities(lambdaFor);
  const againstMass = poissonGoalProbabilities(lambdaAgainst);
  const maxGoals = Math.max(forMass.length, againstMass.length);
  let win = 0;
  let draw = 0;
  let againstLessThanCurrent = 0;
  for (let goalsFor = 0; goalsFor < maxGoals; goalsFor += 1) {
    const pFor = forMass[goalsFor] ?? 0;
    const pAgainst = againstMass[goalsFor] ?? 0;
    win += pFor * againstLessThanCurrent;
    draw += pFor * pAgainst;
    againstLessThanCurrent += pAgainst;
  }
  return { win, draw };
}

function roundProbability(value: number): number {
  return clamp(Number(value.toFixed(4)), 0, 1);
}

function preMatchWinProbabilityFromLambdas(
  lambdaUser: number,
  lambdaOpp: number,
  phase: MatchPhase,
): number {
  const regulation = goalWinDrawMass(lambdaUser, lambdaOpp);
  if (phase === "group") return roundProbability(regulation.win);

  const extraTime = goalWinDrawMass(
    lambdaUser * activeLambda().ET_FRACTION,
    lambdaOpp * activeLambda().ET_FRACTION,
  );
  const knockoutDrawWinShare = extraTime.win + extraTime.draw * 0.5;
  return roundProbability(regulation.win + regulation.draw * knockoutDrawWinShare);
}

// ─── INTERNAL MEMBER MODEL ────────────────────────────────────────────────────

/** One participant on the field/bench for a single match (either side). */
export interface SimMember {
  side: "user" | "opp";
  card_id: CardId;
  player_id: string;
  tournament_id: number;
  slot_id: string;
  position: Position;
  started: boolean;
  /** Weight for scorer/shooter selection (>0). */
  attackWeight: number;
  /** Weight for assist/key-pass selection (>0). */
  creativeWeight: number;
}

const PERIOD_ORDER: Readonly<Record<MatchPeriod, number>> = {
  "1H": 0,
  "2H": 1,
  ET1: 2,
  ET2: 3,
  shootout: 4,
};

function periodForMinute(minute: number): MatchPeriod {
  if (minute <= 45) return "1H";
  if (minute <= 90) return "2H";
  if (minute <= 105) return "ET1";
  return "ET2";
}

/** Weighted pick over a canonically-sorted pool. Returns null for an empty pool. */
function weightedPick(
  pool: readonly SimMember[],
  weightOf: (m: SimMember) => number,
  rng: Rng,
): SimMember | null {
  if (pool.length === 0) return null;
  const sorted = canonicalSortBy(pool, (m) => [m.card_id as string]);
  let total = 0;
  for (const m of sorted) total += Math.max(weightOf(m), 1e-6);
  let r = rng.next() * total;
  for (const m of sorted) {
    r -= Math.max(weightOf(m), 1e-6);
    if (r < 0) return m;
  }
  return sorted[sorted.length - 1]!;
}

/** The keeper for a side = the started GK, else the first started member. */
function keeperOf(started: readonly SimMember[]): SimMember | null {
  const gk = started.find((m) => m.position === "GK");
  if (gk) return gk;
  return started[0] ?? null;
}

// ─── CHANCE GENERATION ────────────────────────────────────────────────────────

type ChanceKind = "goal" | "pen_goal" | "pen_miss" | "saved" | "off" | "foul" | "offside" | "open";

interface ChanceResult {
  side: "user" | "opp";
  minute: number;
  period: MatchPeriod;
  kind: ChanceKind;
  /** Primary actor (scorer / shooter / fouled attacker / offside player). */
  actor: SimMember | null;
  /** Assister for an open-play goal, when present. */
  assist: SimMember | null;
  /** Defending fouler for a `foul` chance. */
  fouler: SimMember | null;
  /** Defending keeper for `saved` / `pen_miss` chances. */
  keeper: SimMember | null;
  /** Card shown on a `foul` chance, if any. */
  card: "yellow" | "red" | null;
}

interface ChancePhaseParams {
  side: "user" | "opp";
  lambda: number;
  chanceCount: number;
  minuteLo: number;
  minuteHi: number;
  attackers: readonly SimMember[];
  creators: readonly SimMember[];
  defenders: readonly SimMember[];
  keeper: SimMember | null;
  structRng: Rng;
  eventRng: Rng;
}

function generateChances(p: ChancePhaseParams): ChanceResult[] {
  const out: ChanceResult[] = [];
  const span = p.minuteHi - p.minuteLo + 1;
  const pGoal = clamp(p.lambda / p.chanceCount, 0, activeChances().MAX_GOAL_PROB);
  for (let j = 0; j < p.chanceCount; j++) {
    const jitter = p.eventRng.next();
    let minute = p.minuteLo + Math.floor(((j + jitter) * span) / p.chanceCount);
    minute = clamp(minute, p.minuteLo, p.minuteHi);
    const period = periodForMinute(minute);

    const roll = p.structRng.next();
    let kind: ChanceKind;
    if (roll < pGoal) {
      // A goal-chance: small probability it is won + taken as a penalty.
      if (p.eventRng.next() < INCIDENT.PEN_FROM_CHANCE_PROB) {
        kind = p.eventRng.next() < INCIDENT.PEN_CONVERT_PROB ? "pen_goal" : "pen_miss";
      } else {
        kind = "goal";
      }
    } else {
      // Split the remaining (non-goal) mass.
      const u = (roll - pGoal) / Math.max(1 - pGoal, 1e-9);
      if (u < CHANCE_OUTCOME.SAVED_SHARE) kind = "saved";
      else if (u < CHANCE_OUTCOME.SAVED_SHARE + CHANCE_OUTCOME.OFF_TARGET_SHARE) kind = "off";
      else if (
        u <
        CHANCE_OUTCOME.SAVED_SHARE + CHANCE_OUTCOME.OFF_TARGET_SHARE + CHANCE_OUTCOME.FOUL_SHARE
      )
        kind = "foul";
      else if (
        u <
        CHANCE_OUTCOME.SAVED_SHARE +
          CHANCE_OUTCOME.OFF_TARGET_SHARE +
          CHANCE_OUTCOME.FOUL_SHARE +
          CHANCE_OUTCOME.OFFSIDE_SHARE
      )
        kind = "offside";
      else kind = "open";
    }

    const openPlayAttackers = p.attackers.filter((m) => m.position !== "GK");
    const actorPool =
      kind === "goal" && openPlayAttackers.length > 0 ? openPlayAttackers : p.attackers;
    const attacker = weightedPick(actorPool, (m) => m.attackWeight, p.eventRng);
    let assist: SimMember | null = null;
    if (kind === "goal" && p.eventRng.next() < INCIDENT.ASSIST_PROB) {
      const pool = p.creators.filter((m) => m.card_id !== (attacker?.card_id ?? ""));
      assist = weightedPick(pool, (m) => m.creativeWeight, p.eventRng);
    }
    let fouler: SimMember | null = null;
    let card: "yellow" | "red" | null = null;
    if (kind === "foul") {
      fouler = weightedPick(p.defenders, () => 1, p.eventRng);
      if (p.eventRng.next() < INCIDENT.YELLOW_FROM_FOUL_PROB) {
        card = p.eventRng.next() < INCIDENT.RED_FROM_CARD_PROB ? "red" : "yellow";
      }
    }
    const keeper = kind === "saved" || kind === "pen_miss" ? p.keeper : null;

    out.push({ side: p.side, minute, period, kind, actor: attacker, assist, fouler, keeper, card });
  }
  return out;
}

// ─── EVENT EMISSION ───────────────────────────────────────────────────────────

interface MatchBuildContext {
  matchId: string;
  events: MatchEvent[];
  seq: number;
}

function neutralTeamFacts(strength: TeamStrength): MatchTeamFacts {
  const synergy = {
    overall: 0,
    nation_clusters: [],
    linked_pairs: [],
    manager_link: 0,
    multiplier: 1,
  };
  return {
    base_strength: strength,
    active_strength: strength,
    base_synergy: synergy,
    active_synergy: synergy,
    unavailable: [],
    bench_activations: [],
    short_handed_slot_ids: [],
  };
}

function nextEventId(ctx: MatchBuildContext): string {
  return `${ctx.matchId}.e${ctx.seq++}`;
}

/** Emit the non-goal atomic events for a processed chance (goals handled in the chronological walk). */
function emitNonGoalChance(ctx: MatchBuildContext, c: ChanceResult): void {
  const base = { minute: c.minute, period: c.period, side: c.side } as const;
  switch (c.kind) {
    case "saved": {
      if (c.actor) {
        const shotId = nextEventId(ctx);
        ctx.events.push({
          ...base,
          event_id: shotId,
          type: "shot_on",
          card_id: c.actor.card_id,
          player_id: c.actor.player_id,
        });
        if (c.keeper) {
          ctx.events.push({
            minute: c.minute,
            period: c.period,
            side: c.side === "user" ? "opp" : "user",
            event_id: nextEventId(ctx),
            type: "save",
            keeper_card_id: c.keeper.card_id,
            keeper_player_id: c.keeper.player_id,
            shot_event_id: shotId,
          });
        }
      }
      break;
    }
    case "off": {
      if (c.actor) {
        ctx.events.push({
          ...base,
          event_id: nextEventId(ctx),
          type: "shot_off",
          card_id: c.actor.card_id,
          player_id: c.actor.player_id,
        });
      }
      break;
    }
    case "foul": {
      if (c.fouler && c.actor) {
        ctx.events.push({
          minute: c.minute,
          period: c.period,
          side: c.side === "user" ? "opp" : "user",
          event_id: nextEventId(ctx),
          type: "foul",
          committed_by_card_id: c.fouler.card_id,
          committed_by_player_id: c.fouler.player_id,
          suffered_by_card_id: c.actor.card_id,
          suffered_by_player_id: c.actor.player_id,
        });
        if (c.card === "yellow") {
          ctx.events.push({
            minute: c.minute,
            period: c.period,
            side: c.side === "user" ? "opp" : "user",
            event_id: nextEventId(ctx),
            type: "yellow",
            card_id: c.fouler.card_id,
            player_id: c.fouler.player_id,
          });
        } else if (c.card === "red") {
          ctx.events.push({
            minute: c.minute,
            period: c.period,
            side: c.side === "user" ? "opp" : "user",
            event_id: nextEventId(ctx),
            type: "red",
            card_id: c.fouler.card_id,
            player_id: c.fouler.player_id,
          });
        }
      }
      break;
    }
    case "offside": {
      if (c.actor) {
        ctx.events.push({
          ...base,
          event_id: nextEventId(ctx),
          type: "offside",
          card_id: c.actor.card_id,
          player_id: c.actor.player_id,
        });
      }
      break;
    }
    case "pen_miss": {
      if (c.actor) {
        ctx.events.push({
          ...base,
          event_id: nextEventId(ctx),
          type: "pen_won",
          won_by_card_id: c.actor.card_id,
          won_by_player_id: c.actor.player_id,
          conceded_by_card_id: c.fouler?.card_id ?? null,
          conceded_by_player_id: c.fouler?.player_id ?? null,
        });
        const onTarget = c.keeper !== null;
        ctx.events.push({
          ...base,
          event_id: nextEventId(ctx),
          type: "pen_missed",
          taker_card_id: c.actor.card_id,
          taker_player_id: c.actor.player_id,
          on_target: onTarget,
          saved_by_card_id: onTarget ? (c.keeper?.card_id ?? null) : null,
          saved_by_player_id: onTarget ? (c.keeper?.player_id ?? null) : null,
        });
      }
      break;
    }
    case "open": {
      // Uneventful build-up; log a key pass for a creator for box-score colour.
      if (c.actor) {
        ctx.events.push({
          ...base,
          event_id: nextEventId(ctx),
          type: "key_pass",
          card_id: c.actor.card_id,
          player_id: c.actor.player_id,
          for_event_id: null,
        });
      }
      break;
    }
    case "goal":
    case "pen_goal":
      // Handled in the chronological goal walk.
      break;
  }
}

// ─── PUBLIC CORE ───────────────────────────────────────────────────────────────

export interface CoreMatchInput {
  matchId: string;
  matchIndex: number;
  round: MatchRound;
  phase: MatchPhase;
  opponentTeamId: string;
  userMembers: SimMember[];
  oppMembers: SimMember[];
  userStrength: TeamStrength;
  oppStrength: TeamStrength;
  /** Persisted active-XI facts. Tournament path supplies real S1 facts. */
  teamFacts?: MatchTeamFacts;
  /** Pre-match mechanical availability events, already canonically ordered. */
  preMatchEvents?: readonly MatchEvent[];
  /** Structure RNG (match_sim substream) — drives outcome-determining draws. */
  structRng: Rng;
  /** Event RNG (event_gen substream) — drives cosmetic attribution. */
  eventRng: Rng;
}

/**
 * The engine-internal result. It is exactly the public `MatchResult` PLUS the
 * tournament-ending injury stash the run loop needs to carry forward between
 * matches. That stash is NOT part of the public schema and must never reach a
 * serialized result; it rides on this internal type and is drained at the
 * public boundary by `stripInternal`. `MatchResult` itself declares no such
 * field, so the only way to read the stash is through this internal type via
 * `tournamentEndingInjuries` — never through a public result.
 */
export interface InternalMatchResult extends MatchResult {
  /**
   * Engine-only: `player_id`s whose injury ends their tournament this match.
   * Drained by `stripInternal` before the result crosses the public boundary.
   */
  readonly __injuredTournamentEnding: readonly string[];
}

/**
 * Simulate one full match. The user lineup may be smaller than 11 if the run
 * has accumulated tournament-ending injuries; the caller enforces the
 * fieldable floor / forfeit before calling here.
 *
 * Returns an `InternalMatchResult` — the caller drains the injury stash via
 * `tournamentEndingInjuries` and then strips it with `stripInternal` before the
 * result is exposed as a public `MatchResult`.
 */
export function simulateMatchCore(input: CoreMatchInput): InternalMatchResult {
  const {
    matchId,
    matchIndex,
    round,
    phase,
    opponentTeamId,
    userMembers,
    oppMembers,
    userStrength,
    oppStrength,
    teamFacts,
    preMatchEvents,
    structRng,
    eventRng,
  } = input;

  const userStarted = userMembers.filter((m) => m.started);
  const oppStarted = oppMembers.filter((m) => m.started);
  const userOutfield = userStarted.filter((m) => m.position !== "GK");
  const oppOutfield = oppStarted.filter((m) => m.position !== "GK");
  const userKeeper = keeperOf(userStarted);
  const oppKeeper = keeperOf(oppStarted);

  // E-3a four-channel λ map — see calibration.ts:lambdaForFour. Opponent's
  // DEFENSE + GOALKEEPING fold into a single defResist; MIDFIELD modulates as
  // a bounded multiplier. This is the SQUAD's four channels + Synergy (already
  // folded into TeamStrength upstream) driving λ legibly.
  //
  // Phase-dependent λ factor (E-3a refit, D1 path): knockout regulation
  // applies `LAMBDA.KO_LAMBDA_FACTOR` ≤ 1 to BOTH sides' λ. This models the
  // documented modern-WC phenomenon that KO regulation is cagier than the
  // group phase — without a phase split, the symmetric sweep cannot land
  // both `group_draw ≈ 24.7%` AND `KO → ET ≈ 33%` (they measure the same
  // statistic on the same teams). The favourite/underdog ordering survives
  // intact because both sides are scaled by the same factor (legibility
  // preserved; D4 monotonicity / elite-ceiling tests still pass).
  const phaseLambdaFactor = phase === "knockout" ? activeLambda().KO_LAMBDA_FACTOR : 1;
  const lambdaUserRaw = lambdaForFour(userStrength, oppStrength) * phaseLambdaFactor;
  const lambdaOppRaw = lambdaForFour(oppStrength, userStrength) * phaseLambdaFactor;

  // E-3a refit (D1) — phase-specific match-level λ dispersion. The helper
  // `lambdaDispersionMultiplier` consumes EXACTLY ONE seeded `structRng.next()`
  // and picks (OUTER_PROB, A) by phase:
  //   - knockout: strong dispersion (lifts KO → ET + shootout to the modern-WC norm)
  //   - group:    mild dispersion (lifts margin ≥ 4 into band without inflating group_draw)
  // The single rng draw means the rng sequence is invariant to the phase /
  // config; only the λ multiplier downstream differs. ε ∈ [1−A, 1+A], mean 1
  // exactly → goals/match mean preserved. Both sides scaled together →
  // favourite/underdog ordering preserved (faithfulness intact).
  const lambdaEpsilon = lambdaDispersionMultiplier(
    structRng,
    phase === "knockout" ? "knockout" : "group",
  );
  const lambdaUser = lambdaUserRaw * lambdaEpsilon;
  const lambdaOpp = lambdaOppRaw * lambdaEpsilon;
  const preMatchWinProbability = preMatchWinProbabilityFromLambdas(lambdaUser, lambdaOpp, phase);

  // ── Regulation chances ──
  const userReg = generateChances({
    side: "user",
    lambda: lambdaUser,
    chanceCount: activeChances().REGULATION,
    minuteLo: 1,
    minuteHi: 90,
    attackers: userOutfield.length ? userOutfield : userStarted,
    creators: userStarted,
    defenders: oppStarted,
    keeper: oppKeeper,
    structRng,
    eventRng,
  });
  const oppReg = generateChances({
    side: "opp",
    lambda: lambdaOpp,
    chanceCount: activeChances().REGULATION,
    minuteLo: 1,
    minuteHi: 90,
    attackers: oppOutfield.length ? oppOutfield : oppStarted,
    creators: oppStarted,
    defenders: userStarted,
    keeper: userKeeper,
    structRng,
    eventRng,
  });

  const isGoalKind = (k: ChanceKind): boolean => k === "goal" || k === "pen_goal";
  const userGoalsReg = userReg.filter((c) => isGoalKind(c.kind)).length;
  const oppGoalsReg = oppReg.filter((c) => isGoalKind(c.kind)).length;

  // ── Extra time + shootout (knockout only, when regulation level) ──
  let userGoalsEt: number | null = null;
  let oppGoalsEt: number | null = null;
  let etUser: ChanceResult[] = [];
  let etOpp: ChanceResult[] = [];
  let shootout: { user: number; opp: number; sequence: ShootoutKick[] } | null = null;
  const shootoutEvents: ShootoutKickEvent[] = [];

  const regTied = userGoalsReg === oppGoalsReg;
  if (phase === "knockout" && regTied) {
    etUser = generateChances({
      side: "user",
      lambda: lambdaUser * activeLambda().ET_FRACTION,
      chanceCount: activeChances().EXTRA_TIME,
      minuteLo: 91,
      minuteHi: 120,
      attackers: userOutfield.length ? userOutfield : userStarted,
      creators: userStarted,
      defenders: oppStarted,
      keeper: oppKeeper,
      structRng,
      eventRng,
    });
    etOpp = generateChances({
      side: "opp",
      lambda: lambdaOpp * activeLambda().ET_FRACTION,
      chanceCount: activeChances().EXTRA_TIME,
      minuteLo: 91,
      minuteHi: 120,
      attackers: oppOutfield.length ? oppOutfield : oppStarted,
      creators: oppStarted,
      defenders: userStarted,
      keeper: userKeeper,
      structRng,
      eventRng,
    });
    userGoalsEt = etUser.filter((c) => isGoalKind(c.kind)).length;
    oppGoalsEt = etOpp.filter((c) => isGoalKind(c.kind)).length;

    if (userGoalsReg + userGoalsEt === oppGoalsReg + oppGoalsEt) {
      shootout = runShootout(
        matchId,
        userStarted,
        oppStarted,
        userStrength,
        oppStrength,
        structRng,
        shootoutEvents,
      );
    }
  }

  // ── Chronological walk to emit goal events + score_after, and non-goal events ──
  const ctx: MatchBuildContext = { matchId, events: [...(preMatchEvents ?? [])], seq: 0 };
  const allChances = [...userReg, ...oppReg, ...etUser, ...etOpp];
  allChances.sort((a, b) => {
    const pa = PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period];
    if (pa !== 0) return pa;
    if (a.minute !== b.minute) return a.minute - b.minute;
    // Stable: user before opp on exact ties, then by attacker card_id.
    if (a.side !== b.side) return a.side === "user" ? -1 : 1;
    const ak = (a.actor?.card_id as string) ?? "";
    const bk = (b.actor?.card_id as string) ?? "";
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });

  let runUser = 0;
  let runOpp = 0;
  for (const c of allChances) {
    if (isGoalKind(c.kind)) {
      if (c.side === "user") runUser++;
      else runOpp++;
      const scoreAfter = { user: runUser, opp: runOpp };
      if (c.kind === "pen_goal") {
        if (c.actor) {
          ctx.events.push({
            minute: c.minute,
            period: c.period,
            side: c.side,
            event_id: nextEventId(ctx),
            type: "pen_won",
            won_by_card_id: c.actor.card_id,
            won_by_player_id: c.actor.player_id,
            conceded_by_card_id: null,
            conceded_by_player_id: null,
          });
          const pen: PenScoredEvent = {
            minute: c.minute,
            period: c.period,
            side: c.side,
            event_id: nextEventId(ctx),
            type: "pen_scored",
            taker_card_id: c.actor.card_id,
            taker_player_id: c.actor.player_id,
            score_after: scoreAfter,
          };
          ctx.events.push(pen);
        }
      } else {
        if (c.actor) {
          if (c.assist) {
            ctx.events.push({
              minute: c.minute,
              period: c.period,
              side: c.side,
              event_id: nextEventId(ctx),
              type: "key_pass",
              card_id: c.assist.card_id,
              player_id: c.assist.player_id,
              for_event_id: null,
            });
          }
          const goal: GoalEvent = {
            minute: c.minute,
            period: c.period,
            side: c.side,
            event_id: nextEventId(ctx),
            type: "goal",
            scorer_card_id: c.actor.card_id,
            scorer_player_id: c.actor.player_id,
            assist_card_id: c.assist?.card_id ?? null,
            assist_player_id: c.assist?.player_id ?? null,
            score_after: scoreAfter,
          };
          ctx.events.push(goal);
        }
      }
    } else {
      emitNonGoalChance(ctx, c);
    }
  }

  const matchLength = userGoalsEt !== null ? MINUTES.WITH_EXTRA_TIME : MINUTES.REGULATION;
  const injuredTournamentEnding: string[] = [];

  // ── Append shootout events last (period 'shootout'). ──
  for (const e of shootoutEvents) ctx.events.push(e);

  // ── Build lineup with minutes/flags. ──
  const lineup = buildLineup(matchId, userMembers, oppMembers, matchLength, ctx.events);

  // ── Resolve outcome. ──
  const { outcome, countsAsRunWin, advanced } = resolveOutcome(
    phase,
    userGoalsReg,
    oppGoalsReg,
    userGoalsEt,
    oppGoalsEt,
    shootout,
  );

  const result: InternalMatchResult = {
    match_id: matchId,
    match_index: matchIndex,
    round,
    phase,
    opponent_team_id: opponentTeamId,
    pre_match_win_probability: preMatchWinProbability,
    team_facts: teamFacts ?? neutralTeamFacts(userStrength),
    user_goals: userGoalsReg,
    opp_goals: oppGoalsReg,
    user_goals_et: userGoalsEt,
    opp_goals_et: oppGoalsEt,
    shootout,
    outcome,
    counts_as_run_win: countsAsRunWin,
    advanced,
    lineup,
    events: ctx.events,
    // Engine-internal stash: persistent injuries handed to the run loop, then
    // drained at the public boundary by `stripInternal`. Declared last so the
    // public key order (match_id…events) is identical after the strip.
    __injuredTournamentEnding: injuredTournamentEnding,
  };
  return result;
}

/** Extract the tournament-ending injuries stashed on a core result. */
export function tournamentEndingInjuries(m: InternalMatchResult): readonly string[] {
  return m.__injuredTournamentEnding;
}

/**
 * Narrow an internal result to the public `MatchResult` boundary: drop the
 * engine-internal injury stash so no hidden key is ever serialized. The
 * surviving keys are exactly the public schema, in the same order.
 */
export function stripInternal(m: InternalMatchResult): MatchResult {
  const { __injuredTournamentEnding, ...pub } = m;
  void __injuredTournamentEnding;
  return pub;
}

function resolveOutcome(
  phase: MatchPhase,
  userReg: number,
  oppReg: number,
  userEt: number | null,
  oppEt: number | null,
  shootout: { user: number; opp: number } | null,
): { outcome: "W" | "D" | "L"; countsAsRunWin: boolean; advanced: boolean } {
  if (phase === "group") {
    const outcome = userReg > oppReg ? "W" : userReg < oppReg ? "L" : "D";
    return { outcome, countsAsRunWin: outcome === "W", advanced: false };
  }
  // knockout
  if (shootout) {
    const outcome = shootout.user > shootout.opp ? "W" : "L";
    return { outcome, countsAsRunWin: outcome === "W", advanced: outcome === "W" };
  }
  const uFinal = userReg + (userEt ?? 0);
  const oFinal = oppReg + (oppEt ?? 0);
  const outcome = uFinal > oFinal ? "W" : "L";
  return { outcome, countsAsRunWin: outcome === "W", advanced: outcome === "W" };
}

// ─── SHOOTOUT ───────────────────────────────────────────────────────────────

function shootoutConvertProb(attack: number, defense: number): number {
  // Bounded around BASE so favourites can still lose (the variance floor).
  const edge = ((attack - defense) / 100) * SHOOTOUT.CONVERT_BAND;
  return clamp(
    SHOOTOUT.BASE_CONVERT_PROB + edge,
    SHOOTOUT.BASE_CONVERT_PROB - SHOOTOUT.CONVERT_BAND,
    SHOOTOUT.BASE_CONVERT_PROB + SHOOTOUT.CONVERT_BAND,
  );
}

function runShootout(
  matchId: string,
  userStarted: readonly SimMember[],
  oppStarted: readonly SimMember[],
  userStrength: TeamStrength,
  oppStrength: TeamStrength,
  rng: Rng,
  outEvents: ShootoutKickEvent[],
): { user: number; opp: number; sequence: ShootoutKick[] } {
  const userTakers = canonicalSortBy(userStarted, (m) => [m.card_id as string]);
  const oppTakers = canonicalSortBy(oppStarted, (m) => [m.card_id as string]);
  const pUser = shootoutConvertProb(userStrength.attack, oppStrength.defense);
  const pOpp = shootoutConvertProb(oppStrength.attack, userStrength.defense);

  const sequence: ShootoutKick[] = [];
  let userScore = 0;
  let oppScore = 0;
  let userKicks = 0;
  let oppKicks = 0;
  let idx = 0;
  let uti = 0;
  let oti = 0;

  const pushKick = (side: "user" | "opp", taker: SimMember | null, scored: boolean): void => {
    const kick: ShootoutKick = {
      index: idx,
      side,
      taker_card_id: taker?.card_id ?? null,
      taker_player_id: taker?.player_id ?? null,
      scored,
    };
    sequence.push(kick);
    outEvents.push({
      event_id: `${matchId}.so${idx}`,
      minute: 0,
      period: "shootout",
      side,
      type: "shootout_kick",
      index: idx,
      taker_card_id: kick.taker_card_id,
      taker_player_id: kick.taker_player_id,
      scored,
    });
    idx++;
  };

  // Best-of-five with early clinch.
  const REG = SHOOTOUT.REGULATION_KICKS_PER_SIDE;
  const clinched = (): boolean => {
    const userRemaining = REG - userKicks;
    const oppRemaining = REG - oppKicks;
    if (userScore > oppScore + oppRemaining) return true;
    if (oppScore > userScore + userRemaining) return true;
    return false;
  };
  while ((userKicks < REG || oppKicks < REG) && !clinched()) {
    if (userKicks <= oppKicks) {
      const taker = userTakers.length ? userTakers[uti++ % userTakers.length]! : null;
      const scored = rng.next() < pUser;
      if (scored) userScore++;
      userKicks++;
      pushKick("user", taker, scored);
    } else {
      const taker = oppTakers.length ? oppTakers[oti++ % oppTakers.length]! : null;
      const scored = rng.next() < pOpp;
      if (scored) oppScore++;
      oppKicks++;
      pushKick("opp", taker, scored);
    }
    if (clinched()) break;
  }

  // Sudden death — paired kicks until one side leads after equal kicks.
  let rounds = 0;
  while (userScore === oppScore && rounds < SHOOTOUT.MAX_SUDDEN_DEATH_ROUNDS) {
    const ut = userTakers.length ? userTakers[uti++ % userTakers.length]! : null;
    const us = rng.next() < pUser;
    if (us) userScore++;
    pushKick("user", ut, us);
    const ot = oppTakers.length ? oppTakers[oti++ % oppTakers.length]! : null;
    const os = rng.next() < pOpp;
    if (os) oppScore++;
    pushKick("opp", ot, os);
    rounds++;
  }
  // Deterministic tie-break guard (effectively unreachable within MAX rounds):
  // force ONE decisive pair (user scores, opp misses) so `outcome` is defined
  // AND `shootout.user`/`opp` stay equal to the scored-kick counts the schema
  // checks — never a bare counter bump that would desync the sequence.
  if (userScore === oppScore) {
    const ut = userTakers.length ? userTakers[uti % userTakers.length]! : null;
    pushKick("user", ut, true);
    userScore++;
    const ot = oppTakers.length ? oppTakers[oti % oppTakers.length]! : null;
    pushKick("opp", ot, false);
  }

  return { user: userScore, opp: oppScore, sequence };
}

// ─── LINEUP ─────────────────────────────────────────────────────────────────

function buildLineup(
  _matchId: string,
  userMembers: readonly SimMember[],
  oppMembers: readonly SimMember[],
  matchLength: number,
  events: readonly MatchEvent[],
): MatchLineupEntry[] {
  const subbedOn = new Set<string>();
  const subbedOff = new Set<string>();
  for (const e of events) {
    if (e.type === "sub" && e.side === "user") {
      subbedOn.add(e.in_player_id);
      subbedOff.add(e.out_player_id);
    }
  }

  const entries: MatchLineupEntry[] = [];
  const stamp = (m: SimMember): void => {
    let minutes: number;
    if (m.started) {
      minutes = subbedOff.has(m.player_id) ? MINUTES.SUB_OFF_DEFAULT : matchLength;
    } else {
      minutes = subbedOn.has(m.player_id) ? MINUTES.SUB_ON_DEFAULT : 0;
    }
    entries.push({
      side: m.side,
      card_id: m.card_id,
      player_id: m.player_id,
      tournament_id: m.tournament_id,
      slot_id: m.slot_id,
      position: m.position,
      started: m.started,
      minutes: clamp(minutes, 0, 130),
    });
  };
  for (const m of userMembers) stamp(m);
  for (const m of oppMembers) stamp(m);
  return entries;
}

// ─── PUBLIC `simulateMatch` (UserXiSimView path) ───────────────────────────────

const CHANNEL_TO_POSITION: ReadonlyArray<[keyof TeamStrength, Position]> = [
  ["goalkeeping", "GK"],
  ["defense", "DF"],
  ["midfield", "MF"],
  ["attack", "FW"],
];

/** Infer a coarse position for a rating from its dominant channel. */
function positionFromRating(r: {
  attack: number;
  midfield: number;
  defense: number;
  goalkeeping: number;
}): Position {
  let best: Position = "MF";
  let bestVal = -1;
  for (const [ch, pos] of CHANNEL_TO_POSITION) {
    const v = r[ch as "attack" | "midfield" | "defense" | "goalkeeping"];
    if (v > bestVal) {
      bestVal = v;
      best = pos;
    }
  }
  return best;
}

/**
 * Build the user SimMembers from a distilled `UserXiSimView`. The view carries
 * no slot layout, so starters use the same deterministic coarse lineup template
 * as opponent teams; bench positions are inferred from each rating's dominant
 * channel.
 */
function membersFromView(view: UserXiSimView): SimMember[] {
  return view.squad_ratings.map((r, i) => {
    const parsed = parseCardId(r.card_id);
    const started = i < 11;
    return {
      side: "user",
      card_id: r.card_id,
      player_id: r.player_id,
      tournament_id: parsed?.tournament_id ?? r.tournament_id,
      slot_id: started ? `sim.starter.${i}` : `sim.bench.${i - 11}`,
      position: started ? OPP_TEMPLATE[i]! : positionFromRating(r),
      started,
      attackWeight: r.attack + 1,
      creativeWeight: r.midfield + 1,
    } satisfies SimMember;
  });
}

/** Coarse outfield template for an opponent squad with no per-card positions. */
const OPP_TEMPLATE: readonly Position[] = [
  "GK",
  "DF",
  "DF",
  "DF",
  "DF",
  "MF",
  "MF",
  "MF",
  "FW",
  "FW",
  "FW",
];

/**
 * Build SimMembers from a Team2026 squad (uniform scorer weights).
 *
 * `side` defaults to `"opp"` — the existing user-vs-opponent path is
 * byte-stable. For intra-group Team2026-vs-Team2026 simulation (I3.3), the
 * "home" team is materialized as `side: "user"`; slot ids are side-prefixed
 * so the two teams never collide in the lineup buffer.
 */
export function membersFromTeam2026(opponent: Team2026, side: "user" | "opp" = "opp"): SimMember[] {
  const sorted = canonicalSortBy(opponent.squad_card_ids, (c) => [c as string]);
  return sorted.map((card_id, i) => {
    const parsed = parseCardId(card_id);
    if (parsed === null) {
      throw new RangeError(
        `membersFromTeam2026: unparseable squad card_id ${card_id as string} for team_id ${opponent.team_id}`,
      );
    }
    const started = i < 11;
    const prefix = side === "user" ? "user" : "opp";
    return {
      side,
      card_id,
      player_id: parsed.player_id,
      tournament_id: parsed.tournament_id,
      slot_id: started ? `${prefix}.starter.${i}` : `${prefix}.bench.${i - 11}`,
      position: started ? OPP_TEMPLATE[i]! : "MF",
      started,
      attackWeight: 1,
      creativeWeight: 1,
    } satisfies SimMember;
  });
}

function phaseForRound(round: MatchRound): MatchPhase {
  return round === "G1" || round === "G2" || round === "G3" ? "group" : "knockout";
}

/**
 * Public `simulateMatch` — simulate one match from a distilled `UserXiSimView`
 * against a real `Team2026` opponent. See `api/sim.ts` for the contract.
 */
export function simulateMatchFromView(
  userTeam: UserXiSimView,
  opponent: Team2026,
  round: MatchRound,
  seed: string,
): MatchResult {
  const structRng = createRng(seed);
  const eventRng = createRng(deriveSubseed(seed, "event_gen"));
  const result = simulateMatchCore({
    matchId: `${opponent.team_id}.${round}`,
    matchIndex: 0,
    round,
    phase: phaseForRound(round),
    opponentTeamId: opponent.team_id,
    userMembers: membersFromView(userTeam),
    oppMembers: membersFromTeam2026(opponent),
    userStrength: userTeam.aggregate,
    oppStrength: opponent.aggregate_rating,
    structRng,
    eventRng,
  });
  return stripInternal(result);
}
