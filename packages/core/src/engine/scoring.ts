// WS-B scoring + top-scorer derivation.
//
//  - `computeScore(run, cfg)` is SELF-CONTAINED over RunResult + ScoringConfig
//    (never reaches back into raw MatchResult[]); `score === Σ breakdown.points`
//    is enforced byte-for-byte so the leaderboard tally is reproducible.
//  - `resolveTopScorer(matches)` derives eligibility from the typed MatchEvent
//    union (no stored flag), with the documented tiebreaks.

import type { MatchResult } from "../types/sim.js";
import type { RunResult } from "../types/run.js";
import type { ScoreComponent, ScoringConfig } from "../types/scoring.js";
import type { ComputeScoreFn, ResolveTopScorerFn } from "../api/scoring.js";

/** Sum a numeric field across every player's run totals. */
function sumTotals(run: RunResult, field: keyof RunResult["player_stats"][number]["totals"]): number {
  let n = 0;
  for (const ps of run.player_stats) n += ps.totals[field];
  return n;
}

export const computeScore: ComputeScoreFn = (run, cfg: ScoringConfig) => {
  const gf = run.aggregate.goals_for;
  const ga = run.aggregate.goals_against;

  // Round-progression: sum the multiplier for each round the user advanced
  // into (group rounds carry a small multiplier; knockout rounds escalate).
  let roundProgressionRaw = 0;
  for (const r of run.round_results) {
    roundProgressionRaw += cfg.round_progression_multipliers[r.round] ?? 0;
  }

  const components: Array<Omit<ScoreComponent, "points">> = [
    { label: "Goals scored", raw: gf, weight: cfg.goal_points },
    { label: "Goal difference", raw: gf - ga, weight: cfg.goal_difference_weight },
    { label: "Clean sheets", raw: run.aggregate.clean_sheets, weight: cfg.clean_sheet_bonus },
    { label: "Round progression", raw: roundProgressionRaw, weight: 1 },
    {
      label: "Undefeated regulation",
      raw: run.undefeated_regulation ? 1 : 0,
      weight: cfg.undefeated_bonus,
    },
    { label: "Goals conceded", raw: ga, weight: cfg.conceded_penalty },
    { label: "Yellow cards", raw: sumTotals(run, "yellows"), weight: cfg.yellow_penalty },
    { label: "Red cards", raw: sumTotals(run, "reds"), weight: cfg.red_penalty },
    { label: "Fouls committed", raw: sumTotals(run, "fouls_committed"), weight: cfg.foul_penalty },
    { label: "Offsides", raw: sumTotals(run, "offsides"), weight: cfg.offside_penalty },
    { label: "Missed penalties", raw: sumTotals(run, "pens_missed"), weight: cfg.missed_pen_penalty },
  ];

  const breakdown: ScoreComponent[] = components.map((c) => ({
    ...c,
    // `|| 0` normalises a `-0` product (e.g. raw 0 × negative weight) to `+0`
    // so the value round-trips through JSON byte-identically (JSON has no -0)
    // and `Object.is`-based golden comparisons stay stable. `raw*weight === points`
    // still holds (=== treats -0 and 0 as equal), so the schema invariant passes.
    points: c.raw * c.weight || 0,
  }));
  const score = breakdown.reduce((acc, c) => acc + c.points, 0);
  return { score, breakdown };
};

// ─── TOP SCORER ────────────────────────────────────────────────────────────────

interface TsRow {
  player_id: string;
  goals: number;
  minutes: number;
}

export const resolveTopScorer: ResolveTopScorerFn = (matches: readonly MatchResult[]) => {
  const goalsByPlayer = new Map<string, number>();
  const minutesByPlayer = new Map<string, number>();

  for (const m of matches) {
    // Counting goals: user-side goal + pen_scored only.
    for (const e of m.events) {
      if (e.side !== "user") continue;
      if (e.type === "goal") {
        goalsByPlayer.set(e.scorer_player_id, (goalsByPlayer.get(e.scorer_player_id) ?? 0) + 1);
      } else if (e.type === "pen_scored") {
        goalsByPlayer.set(e.taker_player_id, (goalsByPlayer.get(e.taker_player_id) ?? 0) + 1);
      }
      // own_goal, shootout_kick, pen_missed never count.
    }
    // Minutes summed from user-side lineup entries across the run.
    for (const entry of m.lineup) {
      if (entry.side !== "user") continue;
      minutesByPlayer.set(
        entry.player_id,
        (minutesByPlayer.get(entry.player_id) ?? 0) + entry.minutes,
      );
    }
  }

  const rows: TsRow[] = [];
  for (const [player_id, goals] of goalsByPlayer) {
    if (goals <= 0) continue;
    rows.push({ player_id, goals, minutes: minutesByPlayer.get(player_id) ?? 0 });
  }
  if (rows.length === 0) return null;

  rows.sort((a, b) => {
    if (a.goals !== b.goals) return b.goals - a.goals; // most goals
    if (a.minutes !== b.minutes) return a.minutes - b.minutes; // fewest minutes
    return a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0; // lowest id
  });
  return rows[0]!.player_id;
};
