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

import { compareCodePointStrings, deriveSubseed } from "../rng.js";
import { resolveTopScorer } from "../engine/scoring.js";
import type { MatchEvent, MatchResult } from "../types/sim.js";
import type {
  KeyMoment,
  NarrativeFacts,
  NarrativeMatchMethod,
  NarrativeScenarioFamily,
  NarrativeScenarioSpotlight,
} from "../types/narrative.js";
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

const SCENARIO_PRIORITY: readonly NarrativeScenarioFamily[] = [
  "perfect_run_milestone",
  "shootout_drama",
  "extra_time_winner",
  "comeback_from_behind",
  "elimination_heartbreak",
  "late_winner",
  "hat_trick_hero",
  "demolition_margin_four",
  "keeper_penalty_save",
  "red_card_resilience",
  "penalty_miss_redemption",
  "bench_impact",
  "manager_masterstroke",
  "final_hero",
  "clean_sheet_masterclass",
  "defensive_wall",
  "midfield_control",
  "narrow_one_nil",
  "low_event_grind",
  "dominant_blowout",
  "multi_goal_hero",
  "early_breakthrough",
  "era_clash",
  "cross_era_matchup",
  "debut_tournament_core",
];

const SCENARIO_PRIORITY_INDEX = new Map(
  SCENARIO_PRIORITY.map((family, index) => [family, index] as const),
);

const ROUND_ORDER: Record<string, number> = {
  G1: 0,
  G2: 1,
  G3: 2,
  R32: 3,
  R16: 4,
  QF: 5,
  SF: 6,
  F: 7,
};

// ─── VILLAIN ──────────────────────────────────────────────────────────────────

interface VillainRow {
  player_id: string;
  goals: number;
  assists: number;
  /** Earliest involvement, for the tiebreak: [match_index, period_rank, minute]. */
  first: [number, number, number];
}

/**
 * Opposition villain for the provided match set: most goals against → most
 * assists → earliest involvement → lowest player_id. Narrative callers pass
 * the defining match when prose is about that match, so the named opponent
 * cannot drift from the sentence's match reference.
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

function matchMethod(m: MatchResult): NarrativeMatchMethod {
  if (m.shootout !== null) return "penalties";
  if (m.user_goals_et !== null || m.opp_goals_et !== null) return "extra_time";
  return "regulation";
}

function userMargin(m: MatchResult): number {
  const tg = totalGoals(m);
  return tg.user - tg.opp;
}

function userFeaturedIds(m: MatchResult): Set<string> {
  return new Set(m.lineup.filter((entry) => entry.side === "user").map((entry) => entry.player_id));
}

function userLineup(m: MatchResult): MatchResult["lineup"] {
  return m.lineup.filter((entry) => entry.side === "user");
}

function userStarted(m: MatchResult): MatchResult["lineup"] {
  return userLineup(m).filter((entry) => entry.started);
}

function sortLineup(a: MatchResult["lineup"][number], b: MatchResult["lineup"][number]): number {
  return b.minutes - a.minutes || compareCodePointStrings(a.player_id, b.player_id);
}

function startedByPosition(
  m: MatchResult,
  position: "GK" | "DF" | "MF" | "FW",
): MatchResult["lineup"] {
  return userStarted(m)
    .filter((entry) => entry.position === position)
    .sort(sortLineup);
}

function userGoalCounts(m: MatchResult): Map<string, number> {
  const featured = userFeaturedIds(m);
  const counts = new Map<string, number>();
  for (const e of m.events) {
    if (e.side !== "user") continue;
    if (e.type === "goal" && featured.has(e.scorer_player_id)) {
      counts.set(e.scorer_player_id, (counts.get(e.scorer_player_id) ?? 0) + 1);
    } else if (e.type === "pen_scored" && featured.has(e.taker_player_id)) {
      counts.set(e.taker_player_id, (counts.get(e.taker_player_id) ?? 0) + 1);
    }
  }
  return counts;
}

function topUserScorerInMatch(
  m: MatchResult,
  minGoals: number,
  maxGoals = Number.POSITIVE_INFINITY,
): { player_id: string; goals: number } | null {
  const counts = userGoalCounts(m);
  let best: { player_id: string; goals: number } | null = null;
  for (const [player_id, goals] of counts) {
    if (goals < minGoals || goals > maxGoals) continue;
    if (
      best === null ||
      goals > best.goals ||
      (goals === best.goals && compareCodePointStrings(player_id, best.player_id) < 0)
    ) {
      best = { player_id, goals };
    }
  }
  return best;
}

function shotLikeEventCount(m: MatchResult): number {
  return m.events.filter(
    (e) =>
      e.type === "goal" ||
      e.type === "own_goal" ||
      e.type === "pen_scored" ||
      e.type === "pen_missed" ||
      e.type === "shot_on" ||
      e.type === "shot_off",
  ).length;
}

function firstUserScorer(m: MatchResult): string | null {
  const featured = userFeaturedIds(m);
  for (const e of m.events) {
    if (e.side !== "user") continue;
    if (e.type === "goal" && featured.has(e.scorer_player_id)) return e.scorer_player_id;
    if (e.type === "pen_scored" && featured.has(e.taker_player_id)) return e.taker_player_id;
  }
  return null;
}

function userPlayerFromMoment(
  moments: readonly KeyMoment[],
  family: KeyMoment["kind"],
): KeyMoment | null {
  for (let i = moments.length - 1; i >= 0; i -= 1) {
    const mo = moments[i]!;
    if (mo.kind === family) return mo;
  }
  return null;
}

function findMatch(matches: readonly MatchResult[], matchId: string | null): MatchResult | null {
  if (matchId === null) return null;
  return matches.find((m) => m.match_id === matchId) ?? null;
}

function lastUserShootoutTaker(m: MatchResult): string | null {
  const kicks = m.shootout?.sequence.length
    ? m.shootout.sequence
    : m.events.filter(
        (e): e is Extract<MatchEvent, { type: "shootout_kick" }> => e.type === "shootout_kick",
      );
  for (let i = kicks.length - 1; i >= 0; i -= 1) {
    const kick = kicks[i]!;
    if (kick.side === "user" && kick.taker_player_id !== null) return kick.taker_player_id;
  }
  return null;
}

function midfieldController(m: MatchResult): string | null {
  const midfielders = new Set(startedByPosition(m, "MF").map((entry) => entry.player_id));
  if (midfielders.size === 0) return null;
  const score = new Map<string, number>();
  for (const e of m.events) {
    if (e.type === "goal" && e.assist_player_id !== null && midfielders.has(e.assist_player_id)) {
      score.set(e.assist_player_id, (score.get(e.assist_player_id) ?? 0) + 3);
    } else if (e.type === "key_pass" && midfielders.has(e.player_id)) {
      score.set(e.player_id, (score.get(e.player_id) ?? 0) + 2);
    } else if (e.type === "goal" && midfielders.has(e.scorer_player_id)) {
      score.set(e.scorer_player_id, (score.get(e.scorer_player_id) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  for (const [player_id, value] of score) {
    if (
      best === null ||
      value > (score.get(best) ?? 0) ||
      (value === (score.get(best) ?? 0) && compareCodePointStrings(player_id, best) < 0)
    ) {
      best = player_id;
    }
  }
  return best;
}

function benchImpactPlayer(m: MatchResult): string | null {
  const subbedOn = new Set<string>();
  for (const e of m.events) {
    if (e.type === "sub" && e.side === "user") {
      subbedOn.add(e.in_player_id);
      continue;
    }
    if (subbedOn.size === 0 || e.side !== "user") continue;
    if (e.type === "goal") {
      if (subbedOn.has(e.scorer_player_id)) return e.scorer_player_id;
      if (e.assist_player_id !== null && subbedOn.has(e.assist_player_id))
        return e.assist_player_id;
    } else if (e.type === "pen_scored" && subbedOn.has(e.taker_player_id)) {
      return e.taker_player_id;
    } else if (e.type === "key_pass" && subbedOn.has(e.player_id)) {
      return e.player_id;
    }
  }
  return null;
}

function firstSubbedOnPlayer(m: MatchResult): string | null {
  for (const e of m.events) {
    if (e.type === "sub" && e.side === "user") return e.in_player_id;
  }
  return null;
}

function firstUserRed(m: MatchResult): string | null {
  const featured = userFeaturedIds(m);
  for (const e of m.events) {
    if (e.type === "red" && e.side === "user" && featured.has(e.player_id)) return e.player_id;
  }
  return null;
}

function penaltyMissRedemptionPlayer(m: MatchResult): string | null {
  const missed = new Set<string>();
  for (const e of m.events) {
    if (e.type === "pen_missed" && e.side === "user") {
      missed.add(e.taker_player_id);
      continue;
    }
    if (missed.size === 0 || e.side !== "user") continue;
    if (e.type === "goal" && missed.has(e.scorer_player_id)) return e.scorer_player_id;
    if (e.type === "pen_scored" && missed.has(e.taker_player_id)) return e.taker_player_id;
  }
  return m.outcome === "W" ? ([...missed].sort()[0] ?? null) : null;
}

function keeperPenaltySave(m: MatchResult): string | null {
  const featured = userFeaturedIds(m);
  for (const e of m.events) {
    if (
      e.type === "pen_missed" &&
      e.side === "opp" &&
      e.saved_by_player_id !== null &&
      featured.has(e.saved_by_player_id)
    ) {
      return e.saved_by_player_id;
    }
  }
  return null;
}

interface EraSpread {
  minYear: number;
  maxYear: number;
  minPlayerId: string;
  maxPlayerId: string;
  count2026: number;
}

export interface NarrativeFactsOptions {
  /**
   * Authoritative tournament_id -> calendar year lookup. Real runtime
   * tournament_ids are not guaranteed to be years; this map takes precedence
   * whenever present.
   */
  tournamentYears?: Readonly<Record<string, number>>;
}

function tournamentYear(tournament_id: number, options: NarrativeFactsOptions | undefined): number {
  const mapped = options?.tournamentYears?.[String(tournament_id)];
  if (typeof mapped === "number" && Number.isFinite(mapped)) return mapped;
  return tournament_id;
}

function eraSpread(
  matches: readonly MatchResult[],
  options: NarrativeFactsOptions | undefined,
): EraSpread | null {
  let minYear = Number.POSITIVE_INFINITY;
  let maxYear = Number.NEGATIVE_INFINITY;
  let minPlayerId = "";
  let maxPlayerId = "";
  const seen2026 = new Set<string>();
  for (const m of matches) {
    for (const entry of userStarted(m)) {
      const year = tournamentYear(entry.tournament_id, options);
      if (year < minYear) {
        minYear = year;
        minPlayerId = entry.player_id;
      }
      if (year > maxYear) {
        maxYear = year;
        maxPlayerId = entry.player_id;
      }
      if (year === 2026) seen2026.add(entry.player_id);
    }
  }
  if (!Number.isFinite(minYear) || !Number.isFinite(maxYear)) return null;
  return { minYear, maxYear, minPlayerId, maxPlayerId, count2026: seen2026.size };
}

function scenarioSpotlight(
  family: NarrativeScenarioFamily,
  match: MatchResult | null,
  overrides: Partial<NarrativeScenarioSpotlight> = {},
): NarrativeScenarioSpotlight {
  const score = match ? totalGoals(match) : null;
  const spotlight = {
    family,
    match_id: match?.match_id ?? null,
    round: match?.round ?? null,
    player_id: null,
    secondary_player_id: null,
    tertiary_player_id: null,
    opponent_team_id: match?.opponent_team_id ?? null,
    score,
    method: match ? matchMethod(match) : null,
    minute: null,
    goal_count: null,
    margin: match ? userMargin(match) : null,
    clean_sheets: null,
    era_min_year: null,
    era_max_year: null,
    ...overrides,
  };
  return constrainSpotlightPlayers(spotlight, match);
}

function eventPlayerIds(e: MatchEvent): string[] {
  switch (e.type) {
    case "goal":
      return [e.scorer_player_id, e.assist_player_id].filter((id): id is string => id !== null);
    case "own_goal":
      return [e.scorer_player_id];
    case "pen_scored":
      return [e.taker_player_id];
    case "pen_missed":
      return [e.taker_player_id, e.saved_by_player_id].filter((id): id is string => id !== null);
    case "pen_won":
      return [e.won_by_player_id, e.conceded_by_player_id].filter(
        (id): id is string => id !== null,
      );
    case "shot_on":
    case "shot_off":
    case "key_pass":
    case "offside":
    case "yellow":
    case "red":
    case "injury":
      return [e.player_id];
    case "availability":
      return [e.player_id, e.replacement_player_id].filter((id): id is string => id !== null);
    case "save":
      return [e.keeper_player_id];
    case "foul":
      return [e.committed_by_player_id, e.suffered_by_player_id];
    case "sub":
      return [e.in_player_id, e.out_player_id];
    case "shootout_kick":
      return e.taker_player_id === null ? [] : [e.taker_player_id];
  }
}

function matchParticipantIds(match: MatchResult): Set<string> {
  const ids = new Set<string>();
  for (const entry of match.lineup) ids.add(entry.player_id);
  for (const event of match.events) {
    for (const id of eventPlayerIds(event)) ids.add(id);
  }
  return ids;
}

function playerInMatch(match: MatchResult | null, player_id: string | null): string | null {
  if (player_id === null || match === null) return player_id;
  return matchParticipantIds(match).has(player_id) ? player_id : null;
}

function constrainSpotlightPlayers(
  spotlight: NarrativeScenarioSpotlight,
  match: MatchResult | null,
): NarrativeScenarioSpotlight {
  if (match === null) return spotlight;
  return {
    ...spotlight,
    player_id: playerInMatch(match, spotlight.player_id),
    secondary_player_id: playerInMatch(match, spotlight.secondary_player_id),
    tertiary_player_id: playerInMatch(match, spotlight.tertiary_player_id),
  };
}

function latestMatchWithPlayers(
  matches: readonly MatchResult[],
  playerIds: readonly (string | null)[],
): MatchResult | null {
  const wanted = playerIds.filter((id): id is string => id !== null);
  if (wanted.length === 0) return null;
  return (
    [...matches].reverse().find((m) => {
      const participants = matchParticipantIds(m);
      return wanted.every((id) => participants.has(id));
    }) ?? null
  );
}

function roundRank(round: string | null): number {
  if (round === null) return -1;
  return ROUND_ORDER[round] ?? -1;
}

function compareScenario(a: NarrativeScenarioSpotlight, b: NarrativeScenarioSpotlight): number {
  const ap = SCENARIO_PRIORITY_INDEX.get(a.family) ?? 999;
  const bp = SCENARIO_PRIORITY_INDEX.get(b.family) ?? 999;
  if (ap !== bp) return ap - bp;
  const ar = roundRank(a.round);
  const br = roundRank(b.round);
  if (ar !== br) return br - ar;
  if ((a.margin ?? -999) !== (b.margin ?? -999)) return (b.margin ?? -999) - (a.margin ?? -999);
  return compareCodePointStrings(a.match_id ?? "", b.match_id ?? "");
}

function deriveScenarioSpotlights(
  run: RunResult,
  matches: readonly MatchResult[],
  keyMoments: readonly KeyMoment[],
  finalHero: string | null,
  options: NarrativeFactsOptions | undefined,
): NarrativeScenarioSpotlight[] {
  const out: NarrativeScenarioSpotlight[] = [];
  const seen = new Set<NarrativeScenarioFamily>();
  const add = (spotlight: NarrativeScenarioSpotlight | null): void => {
    if (spotlight === null || seen.has(spotlight.family)) return;
    seen.add(spotlight.family);
    out.push(spotlight);
  };

  const ordered = [...matches].sort((a, b) => a.match_index - b.match_index);
  const finalMatch = ordered.find((m) => m.round === "F") ?? null;
  const cleanSheets = ordered.filter((m) => totalGoals(m).opp === 0).length;

  if (
    run.is_champion &&
    run.undefeated_regulation &&
    run.wins === 8 &&
    run.draws === 0 &&
    run.losses === 0
  ) {
    add(
      scenarioSpotlight("perfect_run_milestone", finalMatch, {
        player_id: finalHero ?? run.aggregate.top_scorer_player_id,
        clean_sheets: cleanSheets,
      }),
    );
  }

  const shootout = [...ordered].reverse().find((m) => m.shootout !== null) ?? null;
  if (shootout) {
    add(
      scenarioSpotlight("shootout_drama", shootout, {
        player_id: lastUserShootoutTaker(shootout),
        score: shootout.shootout
          ? { user: shootout.shootout.user, opp: shootout.shootout.opp }
          : null,
        method: "penalties",
      }),
    );
  }

  const extraTimeWin =
    [...ordered]
      .reverse()
      .find((m) => m.outcome === "W" && m.shootout === null && matchMethod(m) === "extra_time") ??
    null;
  if (extraTimeWin) {
    const etMoment =
      keyMoments.find(
        (mo) =>
          mo.match_id === extraTimeWin.match_id &&
          (mo.kind === "late_winner" || mo.kind === "stoppage_winner") &&
          (mo.period === "ET1" || mo.period === "ET2"),
      ) ?? null;
    add(
      scenarioSpotlight("extra_time_winner", extraTimeWin, {
        player_id: etMoment?.player_id ?? firstUserScorer(extraTimeWin),
        minute: etMoment?.minute ?? null,
      }),
    );
  }

  const comeback = userPlayerFromMoment(keyMoments, "comeback_win");
  if (comeback) {
    const match = findMatch(ordered, comeback.match_id);
    add(
      scenarioSpotlight("comeback_from_behind", match, {
        player_id: match ? firstUserScorer(match) : null,
        minute: comeback.minute,
      }),
    );
  }

  const late =
    userPlayerFromMoment(keyMoments, "stoppage_winner") ??
    userPlayerFromMoment(keyMoments, "late_winner");
  if (late) {
    add(
      scenarioSpotlight("late_winner", findMatch(ordered, late.match_id), {
        player_id: late.player_id,
        minute: late.minute,
      }),
    );
  }

  const hat = [...ordered]
    .reverse()
    .map((m) => ({ match: m, scorer: topUserScorerInMatch(m, 3) }))
    .find((row) => row.scorer !== null);
  if (hat?.scorer) {
    add(
      scenarioSpotlight("hat_trick_hero", hat.match, {
        player_id: hat.scorer.player_id,
        goal_count: hat.scorer.goals,
      }),
    );
  }

  const demolition =
    [...ordered].reverse().find((m) => m.outcome === "W" && userMargin(m) >= 4) ?? null;
  if (demolition) add(scenarioSpotlight("demolition_margin_four", demolition));

  const keeperSave = [...ordered]
    .reverse()
    .map((m) => ({ match: m, keeper: keeperPenaltySave(m) }))
    .find((row) => row.keeper !== null);
  if (keeperSave?.keeper) {
    add(
      scenarioSpotlight("keeper_penalty_save", keeperSave.match, { player_id: keeperSave.keeper }),
    );
  }

  const redResilience = [...ordered]
    .reverse()
    .map((m) => ({ match: m, player: firstUserRed(m) }))
    .find((row) => row.player !== null && row.match.outcome === "W");
  if (redResilience?.player) {
    add(
      scenarioSpotlight("red_card_resilience", redResilience.match, {
        player_id: redResilience.player,
      }),
    );
  }

  const missRedemption = [...ordered]
    .reverse()
    .map((m) => ({ match: m, player: penaltyMissRedemptionPlayer(m) }))
    .find((row) => row.player !== null);
  if (missRedemption?.player) {
    add(
      scenarioSpotlight("penalty_miss_redemption", missRedemption.match, {
        player_id: missRedemption.player,
      }),
    );
  }

  const bench = [...ordered]
    .reverse()
    .map((m) => ({ match: m, player: benchImpactPlayer(m) }))
    .find((row) => row.player !== null);
  if (bench?.player)
    add(scenarioSpotlight("bench_impact", bench.match, { player_id: bench.player }));

  const managerSub = [...ordered]
    .reverse()
    .map((m) => ({ match: m, player: firstSubbedOnPlayer(m) }))
    .find((row) => row.player !== null && row.match.outcome === "W");
  if (managerSub?.player) {
    add(
      scenarioSpotlight("manager_masterstroke", managerSub.match, { player_id: managerSub.player }),
    );
  }

  if (finalMatch && finalHero !== null) {
    const finalGoals = userGoalCounts(finalMatch).get(finalHero) ?? null;
    add(
      scenarioSpotlight("final_hero", finalMatch, {
        player_id: finalHero,
        goal_count: finalGoals,
      }),
    );
  }

  if (!run.is_champion && ordered.length > 0) {
    const exit = lastMatch(ordered);
    add(scenarioSpotlight("elimination_heartbreak", exit, { player_id: resolveVillain([exit]) }));
  }

  const clean =
    [...ordered].reverse().find((m) => totalGoals(m).opp === 0 && startedByPosition(m, "GK")[0]) ??
    null;
  if (clean) {
    add(
      scenarioSpotlight("clean_sheet_masterclass", clean, {
        player_id: startedByPosition(clean, "GK")[0]!.player_id,
        clean_sheets: cleanSheets,
      }),
    );
  }

  const defensive = [...ordered]
    .reverse()
    .map((m) => ({ match: m, defenders: startedByPosition(m, "DF") }))
    .find((row) => totalGoals(row.match).opp === 0 && row.defenders.length >= 2);
  if (defensive) {
    add(
      scenarioSpotlight("defensive_wall", defensive.match, {
        player_id: defensive.defenders[0]!.player_id,
        secondary_player_id: defensive.defenders[1]!.player_id,
        clean_sheets: cleanSheets,
      }),
    );
  }

  const midfield = [...ordered]
    .reverse()
    .map((m) => ({ match: m, player: midfieldController(m) }))
    .find((row) => row.player !== null && row.match.outcome === "W");
  if (midfield?.player) {
    add(scenarioSpotlight("midfield_control", midfield.match, { player_id: midfield.player }));
  }

  const oneNil =
    [...ordered]
      .reverse()
      .find((m) => m.outcome === "W" && totalGoals(m).user === 1 && totalGoals(m).opp === 0) ??
    null;
  if (oneNil)
    add(scenarioSpotlight("narrow_one_nil", oneNil, { player_id: firstUserScorer(oneNil) }));

  const grind =
    [...ordered]
      .reverse()
      .find(
        (m) =>
          m.outcome === "W" &&
          userMargin(m) === 1 &&
          totalGoals(m).user <= 2 &&
          shotLikeEventCount(m) <= 6,
      ) ?? null;
  if (grind)
    add(scenarioSpotlight("low_event_grind", grind, { player_id: firstUserScorer(grind) }));

  const blowout =
    [...ordered].reverse().find((m) => m.outcome === "W" && userMargin(m) === 3) ?? null;
  if (blowout)
    add(scenarioSpotlight("dominant_blowout", blowout, { player_id: firstUserScorer(blowout) }));

  const multi = [...ordered]
    .reverse()
    .map((m) => ({ match: m, scorer: topUserScorerInMatch(m, 2, 2) }))
    .find((row) => row.scorer !== null);
  if (multi?.scorer) {
    add(
      scenarioSpotlight("multi_goal_hero", multi.match, {
        player_id: multi.scorer.player_id,
        goal_count: multi.scorer.goals,
      }),
    );
  }

  const early = userPlayerFromMoment(keyMoments, "early_lead");
  if (early) {
    add(
      scenarioSpotlight("early_breakthrough", findMatch(ordered, early.match_id), {
        player_id: early.player_id,
        minute: early.minute,
      }),
    );
  }

  const spread = eraSpread(ordered, options);
  if (spread && spread.minYear <= 1970 && spread.maxYear >= 2018) {
    const eraMatch =
      latestMatchWithPlayers(ordered, [spread.minPlayerId, spread.maxPlayerId]) ??
      finalMatch ??
      lastMatch(ordered);
    add(
      scenarioSpotlight("era_clash", eraMatch, {
        player_id: spread.minPlayerId,
        secondary_player_id: spread.maxPlayerId,
        era_min_year: spread.minYear,
        era_max_year: spread.maxYear,
      }),
    );
  }

  if (
    spread &&
    spread.maxYear - spread.minYear >= 40 &&
    ordered.some((m) => m.phase === "knockout")
  ) {
    const crossEraMatch =
      latestMatchWithPlayers(ordered, [spread.minPlayerId, spread.maxPlayerId]) ??
      finalMatch ??
      lastMatch(ordered);
    add(
      scenarioSpotlight("cross_era_matchup", crossEraMatch, {
        player_id: spread.minPlayerId,
        secondary_player_id: spread.maxPlayerId,
        era_min_year: spread.minYear,
        era_max_year: spread.maxYear,
      }),
    );
  }

  if (spread && spread.count2026 >= 4) {
    const modern = ordered
      .flatMap((m) => userStarted(m))
      .filter((entry) => tournamentYear(entry.tournament_id, options) === 2026)
      .sort(sortLineup)[0];
    const modernMatch =
      latestMatchWithPlayers(ordered, [modern?.player_id ?? null]) ??
      finalMatch ??
      lastMatch(ordered);
    add(
      scenarioSpotlight("debut_tournament_core", modernMatch, {
        player_id: modern?.player_id ?? null,
        era_min_year: 2026,
        era_max_year: 2026,
      }),
    );
  }

  return out.sort(compareScenario);
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
  out.sort(
    (a, b) => momentSortKey(a) - momentSortKey(b) || compareCodePointStrings(a.kind, b.kind),
  );
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
    const held = scoring
      .slice(i + 1)
      .every((later) => later.score_after.user > later.score_after.opp);
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
export function deriveNarrativeFacts(
  run: RunResult,
  matches: MatchResult[],
  options?: NarrativeFactsOptions,
): NarrativeFacts {
  // Chronological match order (defensive — callers should already pass path order).
  const ordered = [...matches].sort((a, b) => a.match_index - b.match_index);

  const hero = resolveTopScorer(ordered);
  const finalMatch = ordered.find((m) => m.round === "F") ?? null;
  const finalHero = finalMatch ? resolveTopScorer([finalMatch]) : null;
  const definingMatch = run.is_champion
    ? finalMatch
    : ordered.length > 0
      ? lastMatch(ordered)
      : null;
  const villain = definingMatch ? resolveVillain([definingMatch]) : null;

  const keyMoments = ordered
    .flatMap(momentsForMatch)
    .sort(
      (a, b) =>
        a.match_index - b.match_index ||
        momentSortKey(a.moment) - momentSortKey(b.moment) ||
        compareCodePointStrings(a.moment.kind, b.moment.kind),
    )
    .map((im) => im.moment);

  const eliminatedIn = run.is_champion
    ? null
    : ordered.length > 0
      ? lastMatch(ordered).match_id
      : null;
  const scenarioSpotlights = deriveScenarioSpotlights(run, ordered, keyMoments, finalHero, options);

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
    scenario_spotlights: scenarioSpotlights,
    narrative_seed: deriveSubseed(run.seed, "narrative"),
  };
}
