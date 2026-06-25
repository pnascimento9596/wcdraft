// I3.3 — group-stage table + qualification gate.
//
// Plays the three intra-opponent (Team2026 vs Team2026) games the user XI is
// NOT directly involved in, reduces them to summaries (`GroupOtherMatchSummary`
// — NEVER added to `RunResult.matches`), then builds the four-row standings
// table over the six total group results (3 user + 3 other), applies the
// tiebreaker chain (points → GD → GF → head-to-head points → head-to-head GD
// → seeded `"group_table"` draw-lots), and emits the qualification verdict
// using the best-third threshold approximating "8 of 12 thirds advance".
//
// DETERMINISM:
//   - Intra-opponent matches use `match_sim`/`event_gen` substreams with the
//     `group-other:N` scope (orthogonal to user matches' `match:N` scope).
//   - Draw-lots use a single `deriveSubseed(seed, "group_table")` RNG, drawn
//     once over the four canonically-sorted participant ids.
//   - The threshold + tiebreaker ordering land here AND in goldens — any
//     change must bump `ruleset_version`.

import { canonicalSortBy, createRng, deriveSubseed } from "../rng.js";
import type {
  GroupOtherMatchSummary,
  GroupQualification,
  GroupStageResult,
  GroupStanding,
} from "../types/group-stage.js";
import { USER_GROUP_PARTICIPANT_ID } from "../types/group-stage.js";
import type { GroupId } from "../types/primitives.js";
import type { MatchResult } from "../types/sim.js";
import type { Team2026 } from "../types/tournament.js";
import { membersFromTeam2026, simulateMatchCore, type SimMember } from "./match.js";

// ─── Best-third threshold (golden-locked at this ruleset version) ────────────
//
// Initial proposal from `docs/plans/wcdraft-integration-pass-2026-06-04.md`:
//   - points >= 4                       → qualify
//   - points === 3 AND goal_difference  → qualify
//     (specifically: GD >= 0)
//   - otherwise                          → eliminate
//
// Approximates "8 of 12 thirds advance" without simulating the other 11 groups.
// Revisitable via `ruleset_version` bump; changing this constant requires
// regenerating the I3.3/I3.5 goldens.
const BEST_THIRD_POINTS_HIGH = 4;
const BEST_THIRD_POINTS_BORDER = 3;
const BEST_THIRD_GD_BORDER = 0;

/**
 * Canonical pairing order for the three intra-opponent group matches.
 *
 * Given the three group opponents sorted ascending by `team_id`:
 *   - pair 0 → sorted[0] vs sorted[1]
 *   - pair 1 → sorted[0] vs sorted[2]
 *   - pair 2 → sorted[1] vs sorted[2]
 *
 * The `round` mapping (`G1`/`G2`/`G3`) is positional — these are not the same
 * fixtures that the user plays, but they share the round label for H2H lookup.
 */
const OTHER_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [1, 2],
];
const OTHER_ROUNDS: ReadonlyArray<"G1" | "G2" | "G3"> = ["G1", "G2", "G3"];

export interface SimulateOtherGroupMatchesInput {
  /** `DraftState.run_id`. */
  runId: string;
  /** Master run seed. */
  seed: string;
  /** Exactly three Team2026 opponents (user's group opponents). */
  groupOpponents: readonly Team2026[];
}

/**
 * Simulate the three Team2026-vs-Team2026 group matches the user is not part
 * of. Returns reduced summaries — full event logs are discarded; injuries are
 * NOT carried into the user's run (the MVP simulates the user's path only).
 */
export function simulateOtherGroupMatches(
  input: SimulateOtherGroupMatchesInput,
): GroupOtherMatchSummary[] {
  const { runId, seed, groupOpponents } = input;
  if (groupOpponents.length !== 3) {
    throw new RangeError(
      `simulateOtherGroupMatches expected 3 group opponents, got ${groupOpponents.length}`,
    );
  }
  const sorted = canonicalSortBy(groupOpponents, (t) => [t.team_id]);
  const summaries: GroupOtherMatchSummary[] = [];
  for (let i = 0; i < OTHER_PAIRS.length; i++) {
    const [ai, bi] = OTHER_PAIRS[i]!;
    const a = sorted[ai]!;
    const b = sorted[bi]!;
    const matchId = `${runId}.group-other.${i}`;
    const structRng = createRng(deriveSubseed(seed, "match_sim", `group-other:${i}`));
    const eventRng = createRng(deriveSubseed(seed, "event_gen", `group-other:${i}`));

    // Team A occupies the sim "user" side; Team B occupies the "opp" side.
    // Slot ids in `membersFromTeam2026(_, side)` are side-prefixed so the two
    // teams never collide in the internal lineup buffer.
    const userMembers: SimMember[] = membersFromTeam2026(a, "user");
    const oppMembers: SimMember[] = membersFromTeam2026(b, "opp");

    const result = simulateMatchCore({
      matchId,
      matchIndex: i,
      round: OTHER_ROUNDS[i]!,
      phase: "group",
      opponentTeamId: b.team_id,
      userMembers,
      oppMembers,
      userStrength: a.aggregate_rating,
      oppStrength: b.aggregate_rating,
      structRng,
      eventRng,
    });

    const team_a_goals = result.user_goals;
    const team_b_goals = result.opp_goals;
    const outcome: "A" | "D" | "B" =
      team_a_goals > team_b_goals ? "A" : team_a_goals < team_b_goals ? "B" : "D";

    summaries.push({
      other_match_index: i,
      match_id: matchId,
      round: OTHER_ROUNDS[i]!,
      team_a_id: a.team_id,
      team_b_id: b.team_id,
      team_a_goals,
      team_b_goals,
      outcome,
    });
  }
  return summaries;
}

// ─── Standings + tiebreakers ─────────────────────────────────────────────────

interface BaseStats {
  participant_id: string;
  kind: "user" | "team";
  team_id: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  draw_lots_rank: number;
}

interface MicroResult {
  /** Participants are `USER_GROUP_PARTICIPANT_ID` or `team_id`. */
  a: string;
  b: string;
  a_goals: number;
  b_goals: number;
}

/**
 * Compute deterministic seeded draw-lots ranks 1..4 for the four group
 * participants. Sourced from `deriveSubseed(seed, "group_table")` — a single
 * draw over the canonically-sorted participant ids — so the ranks are stable
 * across the run regardless of which standings tie.
 */
function computeDrawLotsRanks(
  seed: string,
  participantIds: readonly string[],
): Map<string, number> {
  const sorted = canonicalSortBy(participantIds, (id) => [id]);
  const rng = createRng(deriveSubseed(seed, "group_table"));
  // Fisher–Yates over a cloned array, using `rng.int`.
  const arr = [...sorted];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  const out = new Map<string, number>();
  for (let r = 0; r < arr.length; r++) out.set(arr[r]!, r + 1);
  return out;
}

function recordMicro(stats: BaseStats, gf: number, ga: number): void {
  stats.played += 1;
  stats.goals_for += gf;
  stats.goals_against += ga;
  stats.goal_difference = stats.goals_for - stats.goals_against;
  if (gf > ga) {
    stats.wins += 1;
    stats.points += 3;
  } else if (gf === ga) {
    stats.draws += 1;
    stats.points += 1;
  } else {
    stats.losses += 1;
  }
}

/**
 * Build the standings table over the six group fixtures, apply the full
 * tiebreaker chain, and assign final ranks 1..4.
 *
 * Tiebreaker chain (in order):
 *   1. points desc
 *   2. goal_difference desc
 *   3. goals_for desc
 *   4. head-to-head points among the STILL-TIED bucket
 *   5. head-to-head goal_difference among the same bucket
 *   6. draw_lots_rank asc (seeded `group_table` substream)
 */
export interface BuildGroupStageResultInput {
  seed: string;
  group_id: GroupId;
  /** The user's three G1/G2/G3 `MatchResult`s, in order. */
  user_matches: readonly MatchResult[];
  /** The three intra-opponent summaries. */
  other_matches: readonly GroupOtherMatchSummary[];
}

export function buildGroupStageResult(input: BuildGroupStageResultInput): GroupStageResult {
  const { seed, group_id, user_matches, other_matches } = input;

  if (user_matches.length !== 3) {
    throw new RangeError(
      `buildGroupStageResult expected 3 user matches, got ${user_matches.length}`,
    );
  }
  if (other_matches.length !== 3) {
    throw new RangeError(
      `buildGroupStageResult expected 3 other matches, got ${other_matches.length}`,
    );
  }
  for (const m of user_matches) {
    if (m.phase !== "group") {
      throw new RangeError(`user_matches must all be phase='group', got ${m.phase}`);
    }
    if (m.shootout !== null) {
      throw new RangeError(`user_matches must not have a shootout`);
    }
    if (m.user_goals_et !== null || m.opp_goals_et !== null) {
      throw new RangeError(`user_matches must not carry ET goals`);
    }
  }

  // Participant set: user + the three opponents the user played.
  const opponentTeamIds = user_matches.map((m) => m.opponent_team_id);
  const uniqOpp = new Set(opponentTeamIds);
  if (uniqOpp.size !== 3) {
    throw new RangeError("user_matches must reference three distinct opponent_team_ids");
  }
  // Verify other_matches stay inside the participant set.
  for (const om of other_matches) {
    if (!uniqOpp.has(om.team_a_id) || !uniqOpp.has(om.team_b_id)) {
      throw new RangeError(
        `other_match ${om.match_id} references a team outside the group participant set`,
      );
    }
  }

  const drawLots = computeDrawLotsRanks(seed, [USER_GROUP_PARTICIPANT_ID, ...opponentTeamIds]);

  // Initialize stats rows.
  const statsByPid = new Map<string, BaseStats>();
  const init = (participant_id: string, kind: "user" | "team", team_id: string | null): void => {
    statsByPid.set(participant_id, {
      participant_id,
      kind,
      team_id,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      goal_difference: 0,
      points: 0,
      draw_lots_rank: drawLots.get(participant_id)!,
    });
  };
  init(USER_GROUP_PARTICIPANT_ID, "user", null);
  for (const tid of opponentTeamIds) init(tid, "team", tid);

  // Apply user matches (user vs opponent).
  const microResults: MicroResult[] = [];
  for (const m of user_matches) {
    recordMicro(statsByPid.get(USER_GROUP_PARTICIPANT_ID)!, m.user_goals, m.opp_goals);
    recordMicro(statsByPid.get(m.opponent_team_id)!, m.opp_goals, m.user_goals);
    microResults.push({
      a: USER_GROUP_PARTICIPANT_ID,
      b: m.opponent_team_id,
      a_goals: m.user_goals,
      b_goals: m.opp_goals,
    });
  }
  // Apply other matches.
  for (const om of other_matches) {
    recordMicro(statsByPid.get(om.team_a_id)!, om.team_a_goals, om.team_b_goals);
    recordMicro(statsByPid.get(om.team_b_id)!, om.team_b_goals, om.team_a_goals);
    microResults.push({
      a: om.team_a_id,
      b: om.team_b_id,
      a_goals: om.team_a_goals,
      b_goals: om.team_b_goals,
    });
  }

  const allStats = [...statsByPid.values()];
  if (allStats.length !== 4) {
    throw new RangeError(`expected 4 participants, got ${allStats.length}`);
  }

  // Initial sort: global tuple (points, GD, GF) all descending.
  const initialSorted = [...allStats].sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    if (a.goal_difference !== b.goal_difference) return b.goal_difference - a.goal_difference;
    if (a.goals_for !== b.goals_for) return b.goals_for - a.goals_for;
    // Defer to tiebreaker pass below — same triple → same H2H bucket.
    return 0;
  });

  // Bucket entries sharing the same (points, GD, GF) triple, then resolve each
  // bucket independently via H2H + draw-lots.
  const buckets: BaseStats[][] = [];
  let currentBucket: BaseStats[] = [];
  let currentKey: string | null = null;
  for (const s of initialSorted) {
    const key = `${s.points}|${s.goal_difference}|${s.goals_for}`;
    if (currentKey === null || key !== currentKey) {
      if (currentBucket.length > 0) buckets.push(currentBucket);
      currentBucket = [s];
      currentKey = key;
    } else {
      currentBucket.push(s);
    }
  }
  if (currentBucket.length > 0) buckets.push(currentBucket);

  // Resolve each multi-entry bucket via H2H restricted to that bucket.
  const resolved: BaseStats[] = [];
  for (const bucket of buckets) {
    if (bucket.length === 1) {
      resolved.push(bucket[0]!);
      continue;
    }
    const bucketIds = new Set(bucket.map((s) => s.participant_id));
    // Compute H2H stats restricted to bucket.
    const h2h = new Map<string, { points: number; gd: number }>();
    for (const s of bucket) h2h.set(s.participant_id, { points: 0, gd: 0 });
    for (const mr of microResults) {
      if (!bucketIds.has(mr.a) || !bucketIds.has(mr.b)) continue;
      const aH = h2h.get(mr.a)!;
      const bH = h2h.get(mr.b)!;
      aH.gd += mr.a_goals - mr.b_goals;
      bH.gd += mr.b_goals - mr.a_goals;
      if (mr.a_goals > mr.b_goals) aH.points += 3;
      else if (mr.a_goals < mr.b_goals) bH.points += 3;
      else {
        aH.points += 1;
        bH.points += 1;
      }
    }
    const sortedBucket = [...bucket].sort((a, b) => {
      const ha = h2h.get(a.participant_id)!;
      const hb = h2h.get(b.participant_id)!;
      if (ha.points !== hb.points) return hb.points - ha.points;
      if (ha.gd !== hb.gd) return hb.gd - ha.gd;
      // Final tiebreak: seeded draw-lots, lower wins.
      return a.draw_lots_rank - b.draw_lots_rank;
    });
    for (const s of sortedBucket) resolved.push(s);
  }

  // Assign final ranks 1..4.
  const standings: GroupStanding[] = resolved.map((s, i) => ({
    rank: i + 1,
    participant_id: s.participant_id,
    kind: s.kind,
    team_id: s.team_id,
    played: s.played,
    wins: s.wins,
    draws: s.draws,
    losses: s.losses,
    goals_for: s.goals_for,
    goals_against: s.goals_against,
    goal_difference: s.goal_difference,
    points: s.points,
    draw_lots_rank: s.draw_lots_rank,
  }));

  const userStanding = standings.find((s) => s.kind === "user")!;
  const user_rank = userStanding.rank;

  let user_qualified: boolean;
  let qualification: GroupQualification;
  if (user_rank <= 2) {
    user_qualified = true;
    qualification = "top_two";
  } else if (user_rank === 3) {
    if (
      userStanding.points >= BEST_THIRD_POINTS_HIGH ||
      (userStanding.points === BEST_THIRD_POINTS_BORDER &&
        userStanding.goal_difference >= BEST_THIRD_GD_BORDER)
    ) {
      user_qualified = true;
      qualification = "best_third_threshold";
    } else {
      user_qualified = false;
      qualification = "eliminated";
    }
  } else {
    user_qualified = false;
    qualification = "eliminated";
  }

  return {
    group_id,
    standings,
    user_rank,
    user_qualified,
    qualification,
    other_matches: [...other_matches],
  };
}
