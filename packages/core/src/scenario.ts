// I3.2 — deterministic `RunScenario` builder.
//
// Builds a SCOPED `RunScenario` from the real 2026 inputs (Team2026[] +
// Bracket2026 + parent_seed + ruleset_version). The sim does NOT replay the
// other 47 teams — `RunScenario` only records the user XI's path: which group
// they slot into, which three real opponents they face there, and the knockout
// opponent-selection rule (escalating_strength_seeded for the MVP).
//
// DETERMINISM CONTRACT:
//   - All randomness flows through `deriveSubseed(parent_seed, "scenario")`
//     and a single seeded RNG instantiated from that sub-seed.
//   - The scenario's `scenario_seed` IS that sub-seed, so a server can replay
//     the scenario substream end-to-end from `parent_seed` alone.
//   - Inputs (`teams`, `bracket.groups`) are canonically sorted before any
//     draw, so insertion-order drift in upstream data cannot silently change
//     the picked group or replaced team.
//
// SCOPE / OPEN VARIANTS: the only `KnockoutOpponentRule.kind` the MVP emits
// here is `"escalating_strength_seeded"`. Bracket-constrained R32 selection
// (I3.4) is enforced INSIDE the engine using `SimWorld.bracket` and
// `GroupStageResult.user_rank` — the `RunScenario` shape is unchanged.

import { canonicalSortBy, createRng, deriveSubseed } from "./rng.js";
import type { Bracket2026, Group, RunScenario, Team2026 } from "./types/tournament.js";
import type { GroupId, KnockoutRound } from "./types/primitives.js";

/** The five knockout rounds the user's path walks through, in order. */
export const SCENARIO_KNOCKOUT_ROUNDS: readonly KnockoutRound[] = [
  "R32",
  "R16",
  "QF",
  "SF",
  "F",
] as const;

/** Seed-suffix string used inside the `escalating_strength_seeded` rule. */
export const SCENARIO_KNOCKOUT_SEED_SUFFIX = "opponent_selection" as const;

/** Required input bundle for `buildRunScenario`. */
export interface BuildRunScenarioParams {
  /** Master parent seed (RunResult.seed / DraftState.parent_seed). Non-empty. */
  parent_seed: string;
  /** All Team2026 rows; must include every team referenced by `bracket.groups`. */
  teams: readonly Team2026[];
  /** Real 2026 bracket — only `bracket.groups` is consumed here. */
  bracket: Bracket2026;
  /** Scoring / scenario ruleset version anchor (carried onto `RunScenario`). */
  ruleset_version: string;
}

/**
 * Side-channel metadata recording the deterministic choices the builder made
 * (group picked, real team replaced, etc.). Not persisted on `RunScenario`
 * itself — it's a builder-side audit trail used by the e2e golden and tests.
 */
export interface RunScenarioMeta {
  /** `deriveSubseed(parent_seed, "scenario")`. */
  scenario_seed: string;
  /** Group the user XI is slotted into. */
  user_group_id: GroupId;
  /** team_id of the real Team2026 the user XI replaces in that group. */
  replaced_team_id: string;
  /** All four original team_ids of the picked group, canonically sorted. */
  source_group_team_ids: string[];
  /** The three opponent team_ids (length 3, sorted ascending). */
  group_opponent_team_ids: string[];
}

export interface BuildRunScenarioResult {
  scenario: RunScenario;
  meta: RunScenarioMeta;
}

/** Validate uniqueness of `team_id` across the input team list. */
function assertUniqueTeams(teams: readonly Team2026[]): void {
  const seen = new Set<string>();
  for (const t of teams) {
    if (seen.has(t.team_id)) {
      throw new RangeError(
        `buildRunScenario: duplicate team_id "${t.team_id}" in input teams`,
      );
    }
    seen.add(t.team_id);
  }
}

/** Validate every group's team_ids resolves and the group has exactly 4 teams. */
function eligibleGroupsOrThrow(
  groups: readonly Group[],
  teamSet: ReadonlySet<string>,
): Group[] {
  const eligible: Group[] = [];
  for (const g of groups) {
    for (const tid of g.team_ids) {
      if (!teamSet.has(tid)) {
        throw new RangeError(
          `buildRunScenario: group "${g.group_id}" references unknown team_id "${tid}"`,
        );
      }
    }
    if (g.team_ids.length === 4) eligible.push(g);
  }
  if (eligible.length === 0) {
    throw new RangeError(
      "buildRunScenario: no eligible 4-team groups found in bracket",
    );
  }
  return eligible;
}

/**
 * Build a deterministic `RunScenario` (plus an audit `meta`) from the real
 * 2026 inputs. See module header for the determinism contract.
 *
 * @throws RangeError on empty `parent_seed`, duplicate team_ids, group with a
 *   missing referenced team_id, no eligible 4-team groups, or a degenerate
 *   opponent count after the replacement step.
 */
export function buildRunScenario(
  params: BuildRunScenarioParams,
): BuildRunScenarioResult {
  const { parent_seed, teams, bracket, ruleset_version } = params;

  // `deriveSubseed` already enforces non-empty parent_seed; we still gate the
  // ruleset_version + teams shape here so the error message is specific.
  if (typeof ruleset_version !== "string" || ruleset_version.length === 0) {
    throw new RangeError("buildRunScenario: ruleset_version must be a non-empty string");
  }
  if (!Array.isArray(teams) || teams.length === 0) {
    throw new RangeError("buildRunScenario: teams must be a non-empty array");
  }

  assertUniqueTeams(teams);
  const teamSet = new Set(teams.map((t) => t.team_id));
  const eligible = eligibleGroupsOrThrow(bracket.groups, teamSet);

  // Canonical pool ordering before any draw — every entropy step below works
  // off these sorted lists so input insertion-order cannot drift the result.
  const sortedGroups = canonicalSortBy(eligible, (g) => [g.group_id]);

  const scenario_seed = deriveSubseed(parent_seed, "scenario");
  const rng = createRng(scenario_seed);

  // Pick the user's group, then the real team the user XI replaces inside it.
  const userGroup = rng.pick(sortedGroups);
  const sortedGroupTeamIds = canonicalSortBy(userGroup.team_ids, (tid) => [tid]);
  const replaced_team_id = rng.pick(sortedGroupTeamIds);

  const group_opponent_team_ids = sortedGroupTeamIds.filter((tid) => tid !== replaced_team_id);
  if (group_opponent_team_ids.length !== 3) {
    throw new RangeError(
      `buildRunScenario: expected exactly 3 group opponents after replacement, got ${group_opponent_team_ids.length}`,
    );
  }

  const scenario: RunScenario = {
    scenario_id: `scenario:${scenario_seed}`,
    user_group_id: userGroup.group_id,
    group_opponent_team_ids,
    knockout_opponent_rule: {
      kind: "escalating_strength_seeded",
      rounds: [...SCENARIO_KNOCKOUT_ROUNDS],
      seed_suffix: SCENARIO_KNOCKOUT_SEED_SUFFIX,
    },
    ruleset_version,
    scenario_seed,
  };

  const meta: RunScenarioMeta = {
    scenario_seed,
    user_group_id: userGroup.group_id,
    replaced_team_id,
    source_group_team_ids: sortedGroupTeamIds,
    group_opponent_team_ids,
  };

  return { scenario, meta };
}
