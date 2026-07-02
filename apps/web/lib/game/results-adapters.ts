// I3.8 — adapters between the real RunResult / MatchResult shapes and the
// view-models the results screen renders.
//
// HONEST-STATE
// ------------
// The engine emits exactly the data the Poisson sim produces. We render
// only that data — never invent a goal scorer, a minute, or a stat. Where
// the engine has no value, the screen shows "—".
//
// SCORER NAME RESOLUTION
// ----------------------
// Real player names come from the draft pool (`gameData.indexes`). Opponent
// scorers (Team2026 players) are in the index when the 2026 card pool
// covers them; otherwise the UI shows "—" (honest-state — no fabricated name
// and no raw internal id leak).

import {
  buildNarrative,
  type DraftState,
  type MatchEvent,
  type MatchResult,
  type MatchRound,
  type NarrativeLabels,
  type RunResult,
} from "@wcdraft/core";
import type { Scenario2026Bundle } from "@wcdraft/data";

import type { GameData } from "./data";
import { managerCardView, playerCardView } from "./adapters";
import { displayNameFromNames } from "./display-names";
import { PERFECT_RUN_REFERENCE_LABEL } from "./local-progress";

// ─── Round labels ────────────────────────────────────────────────────────────

const ROUND_LABEL: Record<MatchRound, string> = {
  G1: "Group · M1",
  G2: "Group · M2",
  G3: "Group · M3",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  F: "Final",
};

export function roundLabel(round: MatchRound): string {
  return ROUND_LABEL[round];
}

function eliminationRoundLabel(round: MatchRound): string {
  return round === "G1" || round === "G2" || round === "G3" ? "the group" : roundLabel(round);
}

// ─── Scoreline ───────────────────────────────────────────────────────────────

export interface MatchScoreline {
  /** Regulation + ET (shootout never included). */
  user: number;
  opp: number;
  /** Display tag: "pens X–Y" when shootout, "a.e.t." when ET, else null. */
  tag: string | null;
}

export function matchScoreline(m: MatchResult): MatchScoreline {
  const user = m.user_goals + (m.user_goals_et ?? 0);
  const opp = m.opp_goals + (m.opp_goals_et ?? 0);
  let tag: string | null = null;
  if (m.shootout) {
    tag = `pens ${m.shootout.user}–${m.shootout.opp}`;
  } else if (m.user_goals_et !== null || m.opp_goals_et !== null) {
    tag = "a.e.t.";
  }
  return { user, opp, tag };
}

// ─── Opponent display ────────────────────────────────────────────────────────

export interface OpponentDisplay {
  team_id: string;
  /** Team display name; falls back to team_id when the scenario bundle lacks one. */
  name: string;
  nation_id: string | null;
  /** Three-letter code, when known. Used to render a national flag-shaped chip. */
  nation_code: string | null;
}

export function opponentDisplay(
  scenario: Scenario2026Bundle,
  gameData: GameData,
  team_id: string,
): OpponentDisplay {
  const team = scenario.teams.find((t) => t.team_id === team_id);
  const name =
    scenario.team_display_names[team_id] ??
    (team ? scenario.team_display_names[team.team_id] : null) ??
    team_id;
  const nation_id = team?.nation_id ?? null;
  let nation_code: string | null = null;
  if (nation_id) {
    const n = gameData.indexes.nationById.get(nation_id);
    if (n) nation_code = n.code ?? nation_id.toUpperCase();
  }
  return { team_id, name, nation_id, nation_code };
}

// ─── Scorer / player-name resolution ─────────────────────────────────────────

/**
 * Resolve a player display name from the draft pool indexes. The engine emits
 * player_id + card_id on every event; we look the card up to get the exact
 * card variant the user drafted. If the card is outside the 2026 draftable
 * pool (opponent depth players sometimes are, and the engine occasionally
 * emits events with no attributable player — e.g. own goals credited to the
 * benefiting side without a named opponent), we render "—" — honest-state.
 *
 * We NEVER render a raw player_id and NEVER fabricate a name. Rendering raw
 * ids in the UI leaks internal vocabulary and reads as gibberish to users;
 * the dash makes it unambiguous that the scorer is unresolved.
 */
export function resolveScorerName(
  gameData: GameData,
  player_id: string | null,
  card_id: string | null,
): string {
  void player_id; // accepted for API parity; never rendered.
  if (card_id) {
    const c = gameData.indexes.playerByCardId.get(card_id);
    if (c) {
      return displayNameFromNames(c.common_name, c.full_name);
    }
  }
  return "—";
}

// ─── Top scorer view ─────────────────────────────────────────────────────────

export interface TopScorerView {
  player_id: string;
  name: string;
  goals: number;
  /**
   * Nation of the drafted card that scored — resolved the same way the
   * starters/bench flags are (card → nation_id → nation record). Stays NULL
   * when the scorer's card is outside the draftable pool or the nation has no
   * record, so the UI renders the established no-flag fallback (never a wrong
   * flag). Honest-state.
   */
  nation_id: string | null;
  nation_code: string | null;
  nation_name: string | null;
}

/**
 * Resolve the run top scorer from `RunResult.aggregate.top_scorer_player_id`.
 * Goal count is computed deterministically from the user-side event log —
 * the engine derives top_scorer_player_id from the same events, so the two
 * agree.
 */
export function topScorerView(
  gameData: GameData,
  run: RunResult,
  matches: readonly MatchResult[],
): TopScorerView | null {
  const pid = run.aggregate.top_scorer_player_id;
  if (!pid) return null;
  let goals = 0;
  let cardId: string | null = null;
  for (const m of matches) {
    for (const e of m.events) {
      if (e.side !== "user") continue;
      if (e.type === "goal" && e.scorer_player_id === pid) {
        goals += 1;
        cardId = e.scorer_card_id as string;
      } else if (e.type === "pen_scored" && e.taker_player_id === pid) {
        goals += 1;
        cardId = e.taker_card_id as string;
      }
    }
  }
  // Resolve the scorer's nation from the drafted card (same path as the
  // starters/bench mini-flags). Absent card or nation → null → no-flag
  // fallback at the render site; never a guessed flag.
  let nation_id: string | null = cardId ? (gameData.nationByCardId[cardId] ?? null) : null;
  let nation_code: string | null = null;
  let nation_name: string | null = null;
  if (nation_id) {
    const n = gameData.indexes.nationById.get(nation_id);
    if (n) {
      nation_code = n.code ?? nation_id.toUpperCase();
      nation_name = n.canonical_name;
    } else {
      // nation_id with no record — drop it so we don't render an unlabeled chip.
      nation_id = null;
    }
  }
  return {
    player_id: pid,
    name: resolveScorerName(gameData, pid, cardId),
    goals,
    nation_id,
    nation_code,
    nation_name,
  };
}

// ─── Box-score derivation from the atomic event log ──────────────────────────

export type Period = "1H" | "2H" | "ET1" | "ET2" | "shootout";

export interface BoxGoalLine {
  side: "user" | "opp";
  name: string;
  minute: number;
  period: Period;
  detail: string | null;
}

export interface BoxCardLine {
  side: "user" | "opp";
  name: string;
  minute: number;
  period: Period;
  card: "yellow" | "red";
}

export interface BoxSubLine {
  side: "user" | "opp";
  name: string;
  off: string;
  minute: number;
  period: Period;
}

export interface BoxInjuryLine {
  side: "user" | "opp";
  name: string;
  minute: number;
  period: Period;
  ending: boolean;
}

export interface DerivedBox {
  userGoals: BoxGoalLine[];
  oppGoals: BoxGoalLine[];
  cards: BoxCardLine[];
  subs: BoxSubLine[];
  injuries: BoxInjuryLine[];
}

/**
 * Build the rendered box score from the typed event log. Same shape the mock
 * `deriveBox` produced, but every line is derived from real
 * `MatchEvent[]` — no authored fields.
 */
export function deriveBox(gameData: GameData, m: MatchResult): DerivedBox {
  const out: DerivedBox = {
    userGoals: [],
    oppGoals: [],
    cards: [],
    subs: [],
    injuries: [],
  };
  for (const e of m.events) {
    const period = e.period as Period;
    if (e.type === "goal") {
      const name = resolveScorerName(gameData, e.scorer_player_id, e.scorer_card_id as string);
      const assist =
        e.assist_player_id !== null
          ? `assist ${resolveScorerName(gameData, e.assist_player_id, e.assist_card_id as string)}`
          : null;
      const line: BoxGoalLine = {
        side: e.side,
        name,
        minute: e.minute,
        period,
        detail: assist,
      };
      if (e.side === "user") out.userGoals.push(line);
      else out.oppGoals.push(line);
    } else if (e.type === "pen_scored") {
      const name = resolveScorerName(gameData, e.taker_player_id, e.taker_card_id as string);
      const line: BoxGoalLine = {
        side: e.side,
        name,
        minute: e.minute,
        period,
        detail: "pen",
      };
      if (e.side === "user") out.userGoals.push(line);
      else out.oppGoals.push(line);
    } else if (e.type === "own_goal") {
      const name = resolveScorerName(gameData, e.scorer_player_id, e.scorer_card_id as string);
      const line: BoxGoalLine = {
        side: e.side, // side benefiting
        name,
        minute: e.minute,
        period,
        detail: "OG",
      };
      if (e.side === "user") out.userGoals.push(line);
      else out.oppGoals.push(line);
    } else if (e.type === "yellow" || e.type === "red") {
      out.cards.push({
        side: e.side,
        name: resolveScorerName(gameData, e.player_id, e.card_id as string),
        minute: e.minute,
        period,
        card: e.type,
      });
    } else if (e.type === "sub") {
      out.subs.push({
        side: e.side,
        name: resolveScorerName(gameData, e.in_player_id, e.in_card_id as string),
        off: resolveScorerName(gameData, e.out_player_id, e.out_card_id as string),
        minute: e.minute,
        period,
      });
    } else if (e.type === "injury") {
      out.injuries.push({
        side: e.side,
        name: resolveScorerName(gameData, e.player_id, e.card_id as string),
        minute: e.minute,
        period,
        ending: e.tournament_ending,
      });
    }
    // Other event types (shot_on/off, save, key_pass, foul, offside, pen_won,
    // pen_missed, shootout_kick) are intentionally not rendered here — they
    // are not part of the per-match box-score display and surfacing them
    // would clutter the mobile view. The atomic log remains available on
    // `MatchResult.events` for any future per-line UI.
  }
  return out;
}

/** Human period tag shown next to the minute. */
export function periodTag(period: Period): string {
  switch (period) {
    case "1H":
    case "2H":
      return "";
    case "ET1":
    case "ET2":
      return " (ET)";
    case "shootout":
      return " (pens)";
  }
}

// ─── Run summary ─────────────────────────────────────────────────────────────

export interface RunSummaryView {
  team_name: string;
  outcome_headline: string;
  reached_round: MatchRound;
  is_champion: boolean;
  undefeated_regulation: boolean;
  /** "W-L" across the played matches (engine fills `RunResult.record` as W-D-L). */
  display_record: string;
  /** True iff a perfect 8 wins, 0 losses run — drives the gold treatment. */
  is_perfect_eight_zero: boolean;
  wins: number;
  draws: number;
  losses: number;
  shootout_wins: number;
  goals_for: number;
  goals_against: number;
  top_scorer: TopScorerView | null;
  seed: string;
  narrative: string;
  eliminated_in_group: boolean;
  matches_played: number;
  perfect_run_reference: string;
}

/**
 * Display labels for the narrative tokens — DISPLAY-ONLY. The engine's
 * narrative selection/seed is untouched; labels only swap how an already
 * selected entity id renders. Honest-state: ids the pool/scenario cannot
 * name keep the core fallback (raw id), never a fabricated name.
 */
export function buildNarrativeLabels(
  gameData: GameData,
  scenario: Scenario2026Bundle,
  draft: DraftState,
): NarrativeLabels {
  const player_names: Record<string, string> = {};
  const playerCards = [...gameData.indexes.playerByCardId.values()].sort((a, b) =>
    a.card_id.localeCompare(b.card_id),
  );
  for (const c of playerCards) {
    const view = playerCardView(gameData.indexes, c.card_id);
    if (view.name) player_names[c.player_id] = view.name;
  }
  const team_names: Record<string, string> = {};
  for (const t of scenario.teams) {
    const name = scenario.team_display_names[t.team_id];
    if (name) team_names[t.team_id] = name;
  }
  const managerCard = draft.manager_card_id
    ? managerCardView(gameData.indexes, draft.manager_card_id)
    : null;
  const manager_name = managerCard?.name ?? null;
  return { team_name: draft.team_name, manager_name, player_names, team_names };
}

export function buildRunSummary(
  gameData: GameData,
  team_name: string,
  run: RunResult,
  matches: readonly MatchResult[],
  eliminatedInGroup: boolean,
  labels?: NarrativeLabels,
): RunSummaryView {
  const display_record = `${run.wins}-${run.losses}`;
  const is_perfect_eight_zero =
    run.is_champion && run.wins === 8 && run.losses === 0 && matches.length === 8;
  return {
    team_name,
    outcome_headline: run.is_champion
      ? "Champion"
      : `Eliminated in ${eliminationRoundLabel(run.reached_round)}`,
    reached_round: run.reached_round,
    is_champion: run.is_champion,
    undefeated_regulation: run.undefeated_regulation,
    display_record,
    is_perfect_eight_zero,
    wins: run.wins,
    draws: run.draws,
    losses: run.losses,
    shootout_wins: run.shootout_wins,
    goals_for: run.aggregate.goals_for,
    goals_against: run.aggregate.goals_against,
    top_scorer: topScorerView(gameData, run, matches),
    seed: run.seed,
    // Display-only label pass: re-fill the SAME template/seed (selection is
    // deterministic from the run) with display names so the prose never
    // shows raw card ids or "Unavailable" for entities the pool can name.
    narrative: labels
      ? buildNarrative(run, [...matches], labels).filled_text
      : run.narrative.filled_text,
    eliminated_in_group: eliminatedInGroup,
    matches_played: matches.length,
    perfect_run_reference: PERFECT_RUN_REFERENCE_LABEL,
  };
}

// ─── Match list view ─────────────────────────────────────────────────────────

export interface MatchCardView {
  match_id: string;
  round: MatchRound;
  round_label: string;
  opponent: OpponentDisplay;
  scoreline: MatchScoreline;
  outcome: "W" | "D" | "L";
  win_probability_label: string;
  payoff_label: string;
}

export function matchCardViews(
  scenario: Scenario2026Bundle,
  gameData: GameData,
  matches: readonly MatchResult[],
): MatchCardView[] {
  return matches.map((m) => ({
    match_id: m.match_id,
    round: m.round,
    round_label: roundLabel(m.round),
    opponent: opponentDisplay(scenario, gameData, m.opponent_team_id),
    scoreline: matchScoreline(m),
    outcome: m.outcome,
    win_probability_label: formatWinProbability(m.pre_match_win_probability),
    payoff_label: matchPayoffLabel(m),
  }));
}

export function formatWinProbability(value: number): string {
  const bounded = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return `${Math.round(bounded * 100)}%`;
}

export function matchPayoffLabel(m: MatchResult): string {
  const pct = formatWinProbability(m.pre_match_win_probability);
  if (m.outcome === "W") {
    if (m.shootout) return `${pct} — won on penalties`;
    if (m.user_goals_et !== null || m.opp_goals_et !== null) return `${pct} — held after ET`;
    return `${pct} — ${m.pre_match_win_probability >= 0.5 ? "held" : "upset win"}`;
  }
  if (m.outcome === "L") {
    if (m.shootout) return `${pct} — lost on penalties`;
    if (m.user_goals_et !== null || m.opp_goals_et !== null) return `${pct} — lost after ET`;
    if (m.pre_match_win_probability >= 0.6) return `${pct} — unlucky loss`;
    if (m.pre_match_win_probability >= 0.45) return `${pct} — edged out`;
    return `${pct} — beaten`;
  }
  return `${pct} — shared points`;
}

/**
 * Map a `MatchEvent` over its variant types — used by the detail panel.
 * Kept here so consumers don't need to import the engine event union.
 */
export type RenderableEvent = MatchEvent;
