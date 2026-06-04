// `deriveNarrativeFacts` — the canonical, deterministic reducer from a
// RunResult + the underlying MatchResults to `NarrativeFacts`.
//
// EVENT-LOG-DRIVEN, NO GUESSING: hero / final-hero / villain / key-moments are
// all derived by reading the typed `MatchEvent` variants and `MatchResult`
// summary fields — never a stored derived flag, never a runtime model. The
// same `(run, matches)` always yields byte-identical facts.
//
// SEED LINEAGE: `narrative_seed = deriveSubseed(run.seed, "narrative")`. The
// reducer DERIVES it via that helper (never a fresh RNG); template selection
// later threads this exact sub-seed.
//
// HONEST-STATE: a fact with no source resolves to `null` — never invented.

import { deriveSubseed } from "../rng.js";
import type { MatchEvent, MatchResult } from "../types/sim.js";
import type { KeyMoment, NarrativeFacts } from "../types/narrative.js";
import type { RunResult } from "../types/run.js";

// ─── EVENT HELPERS ────────────────────────────────────────────────────────────

/** Scoring events carry a `score_after`; this set is the running-score spine. */
type ScoringEvent = Extract<MatchEvent, { type: "goal" | "own_goal" | "pen_scored" }>;

function isScoringEvent(e: MatchEvent): e is ScoringEvent {
  return e.type === "goal" || e.type === "own_goal" || e.type === "pen_scored";
}

/** The player credited with putting the ball in the net for a scoring event. */
function scorerOf(e: ScoringEvent): string {
  // All three scoring variants carry a `scorer_player_id` / `taker_player_id`.
  return e.type === "pen_scored" ? e.taker_player_id : e.scorer_player_id;
}

/** True iff this scoring event added to the USER's tally (incl. own goals the user benefited from). */
function benefitsUser(e: ScoringEvent): boolean {
  if (e.type === "own_goal") return e.beneficiary_side === "user";
  return e.side === "user";
}

/** Order rank for a `MatchPeriod`, so intra-match moments sort chronologically. */
const PERIOD_RANK: Record<string, number> = {
  "1H": 0,
  "2H": 1,
  ET1: 2,
  ET2: 3,
  shootout: 4,
};

// ─── TOP SCORER (run-wide + final-only) ───────────────────────────────────────

/**
 * Resolve the user-side top scorer across the supplied matches, using the
 * SAME contract as `resolveTopScorer`:
 *   eligible IFF side==='user' && type ∈ {goal, pen_scored}
 *   tiebreaks: most counting goals → fewest user minutes → lowest player_id.
 * Returns null when nobody on the user side scored a counting goal.
 *
 * Local to this module so the narrative layer never depends on the WS-B
 * `resolveTopScorer` runtime stub (which throws until WS-B lands).
 */
function userTopScorer(matches: readonly MatchResult[]): string | null {
  const goals = new Map<string, number>();
  for (const m of matches) {
    for (const e of m.events) {
      if (e.side !== "user") continue;
      if (e.type === "goal" || e.type === "pen_scored") {
        const pid = e.type === "pen_scored" ? e.taker_player_id : e.scorer_player_id;
        goals.set(pid, (goals.get(pid) ?? 0) + 1);
      }
    }
  }
  if (goals.size === 0) return null;

  // Minutes summed from the user-side lineup entries across the same matches.
  const minutes = new Map<string, number>();
  for (const m of matches) {
    for (const entry of m.lineup) {
      if (entry.side !== "user") continue;
      minutes.set(entry.player_id, (minutes.get(entry.player_id) ?? 0) + entry.minutes);
    }
  }

  let best: string | null = null;
  for (const [pid, g] of goals) {
    if (best === null) {
      best = pid;
      continue;
    }
    const bg = goals.get(best)!;
    if (g > bg) {
      best = pid;
      continue;
    }
    if (g < bg) continue;
    // Tie on goals → fewest minutes.
    const pm = minutes.get(pid) ?? 0;
    const bm = minutes.get(best) ?? 0;
    if (pm < bm) {
      best = pid;
      continue;
    }
    if (pm > bm) continue;
    // Tie on minutes → lowest player_id (code-point order).
    if (pid < best) best = pid;
  }
  return best;
}

// ─── VILLAIN ──────────────────────────────────────────────────────────────────

interface VillainRow {
  player_id: string;
  goals: number;
  assists: number;
  /** Earliest involvement, for the tiebreak: [match_index, period_rank, minute]. */
  first: [number, number, number];
}

/**
 * Opposition villain — the opp player who did the user the most harm:
 * most goals against → most assists → earliest involvement → lowest player_id.
 * Null when no opp player scored or assisted.
 */
function resolveVillain(matches: readonly MatchResult[]): string | null {
  const rows = new Map<string, VillainRow>();

  const bump = (
    pid: string,
    kind: "goal" | "assist",
    match_index: number,
    period: string,
    minute: number,
  ): void => {
    let row = rows.get(pid);
    if (!row) {
      row = { player_id: pid, goals: 0, assists: 0, first: [Infinity, Infinity, Infinity] };
      rows.set(pid, row);
    }
    if (kind === "goal") row.goals += 1;
    else row.assists += 1;
    const here: [number, number, number] = [match_index, PERIOD_RANK[period] ?? 9, minute];
    if (
      here[0] < row.first[0] ||
      (here[0] === row.first[0] &&
        (here[1] < row.first[1] || (here[1] === row.first[1] && here[2] < row.first[2])))
    ) {
      row.first = here;
    }
  };

  for (const m of matches) {
    for (const e of m.events) {
      if (e.side !== "opp") continue;
      if (e.type === "goal") {
        bump(e.scorer_player_id, "goal", m.match_index, e.period, e.minute);
        if (e.assist_player_id !== null) {
          bump(e.assist_player_id, "assist", m.match_index, e.period, e.minute);
        }
      } else if (e.type === "pen_scored") {
        bump(e.taker_player_id, "goal", m.match_index, e.period, e.minute);
      }
      // own_goal on the opp side means a USER player scored into their own net;
      // that is not opposition "harm done", so it never feeds the villain.
    }
  }

  if (rows.size === 0) return null;

  let best: VillainRow | null = null;
  for (const row of rows.values()) {
    if (best === null || beatsVillain(row, best)) best = row;
  }
  return best!.player_id;
}

function beatsVillain(a: VillainRow, b: VillainRow): boolean {
  if (a.goals !== b.goals) return a.goals > b.goals;
  if (a.assists !== b.assists) return a.assists > b.assists;
  // Earliest involvement wins (compare the [match_index, period, minute] tuple).
  const [am, ap, amin] = a.first;
  const [bm, bp, bmin] = b.first;
  if (am !== bm) return am < bm;
  if (ap !== bp) return ap < bp;
  if (amin !== bmin) return amin < bmin;
  // Final deterministic tiebreak: lowest player_id.
  return a.player_id < b.player_id;
}

// ─── KEY MOMENTS ──────────────────────────────────────────────────────────────

/** A KeyMoment plus the owning match_index, for cross-match chronological sort. */
interface IndexedMoment {
  match_index: number;
  moment: KeyMoment;
}

function totalGoals(m: MatchResult): { user: number; opp: number } {
  return {
    user: m.user_goals + (m.user_goals_et ?? 0),
    opp: m.opp_goals + (m.opp_goals_et ?? 0),
  };
}

/**
 * Derive the dramatic moments for a single match from its event log + result.
 * Pure and deterministic; ordering inside the match is by (period, minute).
 */
function momentsForMatch(m: MatchResult): IndexedMoment[] {
  const out: KeyMoment[] = [];
  const push = (mo: KeyMoment): void => {
    out.push(mo);
  };

  const scoring = m.events.filter(isScoringEvent);

  // Walk the running score to detect early leads, equalisers, and the decisive
  // go-ahead goal. `prev` is the score BEFORE the current goal applies.
  let prev = { user: 0, opp: 0 };
  let everBehind = false;
  for (const e of scoring) {
    const sa = e.score_after;
    const wasBehind = prev.opp > prev.user;
    if (sa.opp > sa.user) everBehind = true;
    if (benefitsUser(e)) {
      if (e.period === "1H" && e.minute <= 15 && sa.user === 1 && sa.opp === 0) {
        push(makeMoment(m, "early_lead", e, sa));
      }
      if (wasBehind && sa.user === sa.opp) {
        push(makeMoment(m, "equalizer", e, sa));
      }
    }
    prev = { user: sa.user, opp: sa.opp };
  }

  const tg = totalGoals(m);
  const wonInPlay = m.outcome === "W" && m.shootout === null;

  // Decisive go-ahead goal: the LAST user goal that put the user a single goal
  // ahead and was never pegged back (only meaningful for an in-play win).
  if (wonInPlay) {
    const winner = decisiveGoAhead(scoring);
    if (winner) {
      const sa = winner.score_after;
      if (winner.period === "2H" && winner.minute >= 90) {
        push(makeMoment(m, "stoppage_winner", winner, sa));
      } else if (
        (winner.period === "2H" && winner.minute >= 75) ||
        winner.period === "ET1" ||
        winner.period === "ET2"
      ) {
        push(makeMoment(m, "late_winner", winner, sa));
      }
    }
  }

  // Comeback: trailed at some point and still won (in-play or via shootout).
  if (everBehind && m.outcome === "W") {
    push(teamMoment(m, "comeback_win", { user: tg.user, opp: tg.opp }));
  }

  // Emphatic win by three-plus goals.
  if (m.outcome === "W" && tg.user - tg.opp >= 3) {
    push(teamMoment(m, "thrashing", { user: tg.user, opp: tg.opp }));
  }

  // Shootouts.
  if (m.shootout !== null) {
    const score = { user: m.shootout.user, opp: m.shootout.opp };
    if (m.outcome === "W") push(teamMoment(m, "shootout_win", score, "shootout", 0));
    else if (m.outcome === "L") push(teamMoment(m, "shootout_loss", score, "shootout", 0));
  }

  // A knockout loss settled in normal/extra time is a shock exit.
  if (m.outcome === "L" && m.phase === "knockout" && m.shootout === null) {
    push(teamMoment(m, "shock_loss", { user: tg.user, opp: tg.opp }));
  }

  // Discrete card / spot-kick drama.
  for (const e of m.events) {
    if (e.type === "red") {
      push({
        kind: "red_card_swing",
        match_id: m.match_id,
        round: m.round,
        period: e.period === "shootout" ? "shootout" : e.period,
        minute: e.minute,
        player_id: e.player_id,
        secondary_player_id: null,
        score_after: null,
      });
    } else if (e.type === "pen_missed" && e.side === "user") {
      push({
        kind: "missed_penalty",
        match_id: m.match_id,
        round: m.round,
        period: e.period === "shootout" ? "shootout" : e.period,
        minute: e.minute,
        player_id: e.taker_player_id,
        secondary_player_id: null,
        score_after: null,
      });
    }
  }

  // Sort chronologically within the match, then by a stable kind order.
  out.sort((a, b) => momentSortKey(a) - momentSortKey(b) || a.kind.localeCompare(b.kind));
  return out.map((moment) => ({ match_index: m.match_index, moment }));
}

function momentSortKey(mo: KeyMoment): number {
  return (PERIOD_RANK[mo.period] ?? 9) * 1000 + mo.minute;
}

/** Find the last user go-ahead goal (level → ahead by one) that held to the end. */
function decisiveGoAhead(scoring: readonly ScoringEvent[]): ScoringEvent | null {
  let winner: ScoringEvent | null = null;
  for (let i = 0; i < scoring.length; i++) {
    const e = scoring[i]!;
    if (!benefitsUser(e)) continue;
    const sa = e.score_after;
    if (sa.user !== sa.opp + 1) continue; // must be the goal that took the lead by one
    // Held to the end iff every later goal still leaves the user ahead.
    const held = scoring.slice(i + 1).every((later) => later.score_after.user > later.score_after.opp);
    if (held) winner = e;
  }
  return winner;
}

function makeMoment(
  m: MatchResult,
  kind: KeyMoment["kind"],
  e: ScoringEvent,
  sa: { user: number; opp: number },
): KeyMoment {
  const assist = e.type === "goal" ? e.assist_player_id : null;
  return {
    kind,
    match_id: m.match_id,
    round: m.round,
    period: e.period === "shootout" ? "shootout" : e.period,
    minute: e.minute,
    player_id: scorerOf(e),
    secondary_player_id: assist,
    score_after: { user: sa.user, opp: sa.opp },
  };
}

function teamMoment(
  m: MatchResult,
  kind: KeyMoment["kind"],
  score: { user: number; opp: number },
  period: KeyMoment["period"] = "2H",
  minute = 90,
): KeyMoment {
  return {
    kind,
    match_id: m.match_id,
    round: m.round,
    period,
    minute,
    player_id: null,
    secondary_player_id: null,
    score_after: score,
  };
}

// ─── DEFINING-MATCH OPPONENT ──────────────────────────────────────────────────

/**
 * The opponent team most associated with the run's defining match: the final
 * opponent for any side that reached the final, otherwise the opponent in the
 * last match played (the elimination). Null when there are no matches.
 */
function nemesisTeamId(matches: readonly MatchResult[]): string | null {
  if (matches.length === 0) return null;
  const final = matches.find((m) => m.round === "F");
  if (final) return final.opponent_team_id;
  return lastMatch(matches).opponent_team_id;
}

function lastMatch(matches: readonly MatchResult[]): MatchResult {
  return matches.reduce((acc, m) => (m.match_index > acc.match_index ? m : acc));
}

// ─── PUBLIC REDUCER ────────────────────────────────────────────────────────────

/**
 * Derive `NarrativeFacts` from a run + its matches. See file header for the
 * determinism / honest-state / seed-lineage contracts.
 */
export function deriveNarrativeFacts(run: RunResult, matches: MatchResult[]): NarrativeFacts {
  // Chronological match order (defensive — callers should already pass path order).
  const ordered = [...matches].sort((a, b) => a.match_index - b.match_index);

  const hero = userTopScorer(ordered);
  const finalMatch = ordered.find((m) => m.round === "F") ?? null;
  const finalHero = finalMatch ? userTopScorer([finalMatch]) : null;
  const villain = resolveVillain(ordered);

  const keyMoments = ordered
    .flatMap(momentsForMatch)
    .sort(
      (a, b) =>
        a.match_index - b.match_index ||
        momentSortKey(a.moment) - momentSortKey(b.moment) ||
        a.moment.kind.localeCompare(b.moment.kind),
    )
    .map((im) => im.moment);

  const eliminatedIn = run.is_champion
    ? null
    : ordered.length > 0
      ? lastMatch(ordered).match_id
      : null;

  return {
    reached_round: run.reached_round,
    is_champion: run.is_champion,
    undefeated_regulation: run.undefeated_regulation,
    hero_player_id: hero,
    final_hero_player_id: finalHero,
    villain_player_id: villain,
    nemesis_team_id: nemesisTeamId(ordered),
    eliminated_in_match_id: eliminatedIn,
    key_moments: keyMoments,
    narrative_seed: deriveSubseed(run.seed, "narrative"),
  };
}
