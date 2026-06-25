// I3.4 — knockout opponent selection (bracket-constrained R32 + escalating R16→F).
//
// Replaces the inlined `selectKnockoutLadder` previously in
// `engine/tournament.ts` with a small module that:
//   - applies the published `Bracket2026.knockout_slots` feed-source constraint
//     to the R32 opponent (only),
//   - falls back deterministically to the global escalating pool when the
//     constrained pool is empty / the bracket lookup fails (recording why),
//   - selects R16/QF/SF/F via the existing escalating-strength banding.
//
// DETERMINISM:
//   - A single RNG seeded with
//     `deriveSubseed(seed, "opponent_selection", rule.seed_suffix)` drives the
//     entire ladder (one `rng.int(...)` per round), so insertion-order drift
//     in `world.opponents` cannot change selection.
//   - Tiebreaks for multi-seat user/opposite R32 slots use lexicographic
//     ascending `slot_id`.
//   - Exclusions: scenario group opponents AND any team whose `group ===
//     scenario.user_group_id` (the user occupies that slot).
//   - R16/QF/SF/F bands use `roundIndex/roundCount` over the strength-sorted
//     pool, matching the prior behavior byte-stably.

import { canonicalSortBy, createRng, deriveSubseed, type Rng } from "../rng.js";
import type { GroupId, KnockoutRound } from "../types/primitives.js";
import type { TeamStrength } from "../types/rating.js";
import type { Bracket2026, RunScenario, Slot, SlotSource, Team2026 } from "../types/tournament.js";
import type { SimWorld } from "../types/sim.js";
import type { GroupStageResult } from "../types/group-stage.js";

/**
 * Per-round metadata explaining how the opponent was picked. Engine-level
 * surface only (not added to `types/index.ts`) — `runTournamentFull` returns
 * `knockout_ladder_meta` as a record-side ad-hoc shape per the plan.
 */
export interface KnockoutLadderRoundMeta {
  round: KnockoutRound;
  opponent_team_id: string;
  /** True only when R32 was selected from a real `best_third` / `group_position` feed. */
  bracket_constrained: boolean;
  /** True when the engine had to fall back to the global escalating pool. */
  fallback: boolean;
  fallback_reason: FallbackReason | null;
  /** R32 user seat (lex-min `slot_id`) if resolvable. */
  user_slot_id: string | null;
  /** Opposite seat in the same R32 match. */
  opposite_slot_id: string | null;
  /** Candidate `GroupId`s implied by the opposite seat's source. */
  candidate_group_ids: GroupId[];
}

export interface KnockoutLadderMeta {
  rounds: KnockoutLadderRoundMeta[];
}

export type FallbackReason =
  | "no_bracket"
  | "no_user_r32_slot"
  | "no_opposite_r32_slot"
  | "opposite_source_not_group_based"
  | "empty_constrained_pool";

export interface SelectKnockoutLadderInput {
  scenario: RunScenario;
  world: SimWorld;
  seed: string;
  groupStage: GroupStageResult;
}

export interface SelectKnockoutLadderOutput {
  ladder: Team2026[];
  meta: KnockoutLadderMeta;
}

const DEFAULT_LADDER: readonly KnockoutRound[] = ["R32", "R16", "QF", "SF", "F"] as const;

function strengthScalar(s: TeamStrength): number {
  return s.attack + s.midfield + s.defense + s.goalkeeping;
}

/**
 * Sort a candidate pool of Team2026 by `(strength asc, team_id)`. The
 * escalating banding logic consumes this canonical pool.
 */
function canonicalStrengthSort(pool: readonly Team2026[]): Team2026[] {
  return canonicalSortBy(pool, (t) => [strengthScalar(t.aggregate_rating), t.team_id]);
}

/**
 * Pick one Team2026 from `sortedPool` using the strength-band selector.
 *
 * The "escalating" effect comes from `roundIndex` walking up `roundCount`,
 * which slices the strength-sorted pool into rising bands. Already-used teams
 * are excluded — if the band is empty after exclusions, the fallback is "any
 * unused candidate", preserving determinism for tiny pools.
 */
function pickEscalating(
  sortedPool: readonly Team2026[],
  roundIndex: number,
  roundCount: number,
  rng: Rng,
  usedTeamIds: ReadonlySet<string>,
): Team2026 {
  const lo = Math.floor((roundIndex * sortedPool.length) / roundCount);
  const hi = Math.floor(((roundIndex + 1) * sortedPool.length) / roundCount);
  const band = sortedPool
    .slice(lo, Math.max(hi, lo + 1))
    .filter((t) => !usedTeamIds.has(t.team_id));
  const candidates = band.length > 0 ? band : sortedPool.filter((t) => !usedTeamIds.has(t.team_id));
  if (candidates.length === 0) {
    throw new RangeError(
      `opponent selection exhausted: round ${roundIndex} cannot find any unused candidate`,
    );
  }
  return candidates[rng.int(candidates.length)]!;
}

/** Find slots matching a predicate, lexicographically sorted by `slot_id`. */
function findSlotsSortedByLex(slots: readonly Slot[], pred: (slot: Slot) => boolean): Slot[] {
  return canonicalSortBy(slots.filter(pred), (s) => [s.slot_id]);
}

/**
 * Identify the user XI's R32 user seat — the `Slot` whose `source` resolves to
 * the user. Rank 1/2 → `group_position` feed for the user group; rank 3 →
 * `best_third` feed whose `candidate_groups` contain the user group.
 *
 * When multiple R32 seats match (e.g. several best-third seats whose
 * candidate_groups overlap the user group), pick the lex-min `slot_id`.
 */
function findUserR32Slot(
  bracket: Bracket2026,
  scenario: RunScenario,
  groupStage: GroupStageResult,
): Slot | null {
  const r32Slots = bracket.knockout_slots.filter((s) => s.round === "R32");
  const userRank = groupStage.user_rank;
  if (userRank === 1 || userRank === 2) {
    const matches = findSlotsSortedByLex(
      r32Slots,
      (s) =>
        s.source.kind === "group_position" &&
        s.source.group_id === scenario.user_group_id &&
        s.source.position === userRank,
    );
    return matches[0] ?? null;
  }
  if (userRank === 3 && groupStage.user_qualified) {
    const matches = findSlotsSortedByLex(
      r32Slots,
      (s) =>
        s.source.kind === "best_third" &&
        s.source.candidate_groups.includes(scenario.user_group_id),
    );
    return matches[0] ?? null;
  }
  return null;
}

/**
 * Find the opposite seat in the user's R32 match.
 *
 * The opposite seat is another R32 `Slot` sharing the same `match_id` as the
 * user's seat (but with a different `slot_id`). Lex-min tiebreak when several
 * opposite seats exist (defensive — published 2026 brackets pair exactly two
 * seats per `match_id`).
 */
function findOppositeR32Slot(bracket: Bracket2026, userSlot: Slot): Slot | null {
  if (!userSlot.match_id) return null;
  const matches = findSlotsSortedByLex(
    bracket.knockout_slots,
    (s) => s.round === "R32" && s.match_id === userSlot.match_id && s.slot_id !== userSlot.slot_id,
  );
  return matches[0] ?? null;
}

/** Extract candidate group ids from a slot source. Returns null on `match_winner`. */
function candidateGroupsForSource(source: SlotSource): GroupId[] | null {
  if (source.kind === "group_position") return [source.group_id];
  if (source.kind === "best_third") return canonicalSortBy(source.candidate_groups, (g) => [g]);
  // `match_winner` — unsupported for R32; the engine must fall back.
  return null;
}

/**
 * Public entry: select the full knockout ladder.
 *
 * R32 is bracket-constrained when `world.bracket` is supplied and the user
 * qualified out of the group; the rest of the ladder uses the existing
 * escalating-strength selector over the global (excluding-group) pool.
 */
export function selectKnockoutLadderAfterGroup(
  input: SelectKnockoutLadderInput,
): SelectKnockoutLadderOutput {
  const { scenario, world, seed, groupStage } = input;
  const rule = scenario.knockout_opponent_rule;
  const rounds = rule.rounds.length > 0 ? rule.rounds : [...DEFAULT_LADDER];

  // Exclusion set: group opponents + every team whose `group === user_group`.
  // This preserves the "user occupies one group seat" semantics without
  // having to thread `replaced_team_id` through the scenario.
  const excluded = new Set<string>(scenario.group_opponent_team_ids);
  const allOpponents = Object.values(world.opponents);
  for (const t of allOpponents) {
    if (t.group === scenario.user_group_id) excluded.add(t.team_id);
  }

  const globalPool = allOpponents.filter((t) => !excluded.has(t.team_id));
  const sortedGlobal = canonicalStrengthSort(globalPool);

  if (sortedGlobal.length < rounds.length) {
    throw new RangeError(
      `knockout pool too small: need ≥${rounds.length} candidates, have ${sortedGlobal.length}`,
    );
  }

  const rng = createRng(deriveSubseed(seed, "opponent_selection", rule.seed_suffix));
  const ladder: Team2026[] = [];
  const used = new Set<string>();
  const roundMetas: KnockoutLadderRoundMeta[] = [];

  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r]!;
    if (r === 0 && round === "R32") {
      const r32 = selectR32Opponent({
        scenario,
        world,
        groupStage,
        sortedGlobal,
        rng,
        used,
      });
      used.add(r32.team.team_id);
      ladder.push(r32.team);
      roundMetas.push({
        round: "R32",
        opponent_team_id: r32.team.team_id,
        bracket_constrained: r32.bracket_constrained,
        fallback: r32.fallback,
        fallback_reason: r32.fallback_reason,
        user_slot_id: r32.user_slot_id,
        opposite_slot_id: r32.opposite_slot_id,
        candidate_group_ids: r32.candidate_group_ids,
      });
      continue;
    }
    const team = pickEscalating(sortedGlobal, r, rounds.length, rng, used);
    used.add(team.team_id);
    ladder.push(team);
    roundMetas.push({
      round,
      opponent_team_id: team.team_id,
      bracket_constrained: false,
      fallback: false,
      fallback_reason: null,
      user_slot_id: null,
      opposite_slot_id: null,
      candidate_group_ids: [],
    });
  }

  return { ladder, meta: { rounds: roundMetas } };
}

interface R32SelectionResult {
  team: Team2026;
  bracket_constrained: boolean;
  fallback: boolean;
  fallback_reason: FallbackReason | null;
  user_slot_id: string | null;
  opposite_slot_id: string | null;
  candidate_group_ids: GroupId[];
}

interface R32SelectionInput {
  scenario: RunScenario;
  world: SimWorld;
  groupStage: GroupStageResult;
  sortedGlobal: readonly Team2026[];
  rng: Rng;
  used: ReadonlySet<string>;
}

/**
 * Bracket-constrained R32 selection. Falls back deterministically to the
 * global escalating pool when the bracket cannot be resolved or the
 * constrained pool is empty. R32 = roundIndex 0 over 5 rounds.
 */
function selectR32Opponent(input: R32SelectionInput): R32SelectionResult {
  const { scenario, world, groupStage, sortedGlobal, rng, used } = input;
  const bracket = world.bracket;
  const ROUND_COUNT = 5;

  const fallback = (
    reason: FallbackReason,
    user_slot_id: string | null = null,
    opposite_slot_id: string | null = null,
    candidate_group_ids: GroupId[] = [],
  ): R32SelectionResult => {
    const team = pickEscalating(sortedGlobal, 0, ROUND_COUNT, rng, used);
    return {
      team,
      bracket_constrained: false,
      fallback: true,
      fallback_reason: reason,
      user_slot_id,
      opposite_slot_id,
      candidate_group_ids,
    };
  };

  if (!bracket) return fallback("no_bracket");

  const userSlot = findUserR32Slot(bracket, scenario, groupStage);
  if (!userSlot) return fallback("no_user_r32_slot");

  const oppositeSlot = findOppositeR32Slot(bracket, userSlot);
  if (!oppositeSlot) {
    return fallback("no_opposite_r32_slot", userSlot.slot_id);
  }

  const candidateGroups = candidateGroupsForSource(oppositeSlot.source);
  if (candidateGroups === null) {
    return fallback("opposite_source_not_group_based", userSlot.slot_id, oppositeSlot.slot_id);
  }

  const candidateGroupSet = new Set<GroupId>(candidateGroups);
  const allOpponents = Object.values(world.opponents);
  const excluded = new Set<string>([...scenario.group_opponent_team_ids, ...used]);
  for (const t of allOpponents) {
    if (t.group === scenario.user_group_id) excluded.add(t.team_id);
  }
  const constrained = allOpponents.filter(
    (t) => candidateGroupSet.has(t.group) && !excluded.has(t.team_id),
  );
  const sortedConstrained = canonicalStrengthSort(constrained);
  if (sortedConstrained.length === 0) {
    return fallback(
      "empty_constrained_pool",
      userSlot.slot_id,
      oppositeSlot.slot_id,
      candidateGroups,
    );
  }

  // Single draw over the constrained pool, lex-canonical via strength sort.
  const pickIdx = rng.int(sortedConstrained.length);
  const team = sortedConstrained[pickIdx]!;
  return {
    team,
    bracket_constrained: true,
    fallback: false,
    fallback_reason: null,
    user_slot_id: userSlot.slot_id,
    opposite_slot_id: oppositeSlot.slot_id,
    candidate_group_ids: candidateGroups,
  };
}
