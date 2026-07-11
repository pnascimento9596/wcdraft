import {
  GroupIdSchema,
  GroupStageResultSchema,
  KnockoutRoundSchema,
  MatchResultSchema,
  RunResultSchema,
  type GroupStageResult,
  type KnockoutRound,
  type MatchResult,
  type RunResult,
  type RunScenario,
} from "@wcdraft/core";

/** JSON-shaped per-round opponent-selection metadata retained for replay audit. */
export interface PersistedKnockoutLadderRoundMeta {
  round: string;
  opponent_team_id: string;
  bracket_constrained: boolean;
  fallback: boolean;
  fallback_reason: string | null;
  user_slot_id: string | null;
  opposite_slot_id: string | null;
  candidate_group_ids: string[];
}

export interface PersistedKnockoutLadderMeta {
  rounds: PersistedKnockoutLadderRoundMeta[];
}

/**
 * Deterministic persisted simulation subset. Wall-clock telemetry deliberately
 * lives outside this payload so identical inputs remain byte-identical.
 */
export interface PersistedSimulation {
  scenario: RunScenario;
  run: RunResult;
  matches: MatchResult[];
  group_stage: GroupStageResult;
  knockout_ladder_meta: PersistedKnockoutLadderMeta;
}

/** Non-deterministic telemetry sibling that is never persisted into the run payload. */
export interface SimulationTelemetry {
  duration_ms: number | null;
}

const MAX_VERSION_ANCHOR_CHARS = 512;
const MAX_PARENT_SEED_CHARS = 256;
const MAX_SIM_MATCHES = 8;
const MIN_SIM_MATCHES = 3;
const MAX_KNOCKOUT_META_ROUNDS = 5;
const MAX_CANDIDATE_GROUP_IDS = 8;
const INVALID_NULLABLE_STRING = Symbol("invalid-nullable-string");

export function parsePersistedSimulation(value: unknown): PersistedSimulation | null {
  if (!isPlainObject(value)) return null;
  const scenario = parseRunScenario(value.scenario);
  const run = RunResultSchema.safeParse(value.run);
  const matches = parseMatches(value.matches);
  const groupStage = GroupStageResultSchema.safeParse(value.group_stage);
  const knockout = parseKnockoutMeta(value.knockout_ladder_meta);
  if (scenario === null || !run.success || matches === null || !groupStage.success || !knockout) {
    return null;
  }
  return {
    scenario,
    run: run.data,
    matches,
    group_stage: groupStage.data,
    knockout_ladder_meta: knockout,
  };
}

function parseRunScenario(value: unknown): RunScenario | null {
  if (!isPlainObject(value)) return null;
  const scenario_id = boundedString(value.scenario_id, 128);
  const group = GroupIdSchema.safeParse(value.user_group_id);
  const groupOpponents = parseStringArray(value.group_opponent_team_ids, 3, 3, 128);
  const rule = parseKnockoutOpponentRule(value.knockout_opponent_rule);
  const ruleset_version = boundedString(value.ruleset_version, MAX_VERSION_ANCHOR_CHARS);
  const scenario_seed = boundedString(value.scenario_seed, MAX_PARENT_SEED_CHARS);
  if (
    scenario_id === null ||
    !group.success ||
    groupOpponents === null ||
    rule === null ||
    ruleset_version === null ||
    scenario_seed === null
  ) {
    return null;
  }
  return {
    scenario_id,
    user_group_id: group.data,
    group_opponent_team_ids: groupOpponents,
    knockout_opponent_rule: rule,
    ruleset_version,
    scenario_seed,
  };
}

function parseKnockoutOpponentRule(value: unknown): RunScenario["knockout_opponent_rule"] | null {
  if (!isPlainObject(value) || value.kind !== "escalating_strength_seeded") return null;
  if (!Array.isArray(value.rounds) || value.rounds.length === 0 || value.rounds.length > 5) {
    return null;
  }
  const rounds: KnockoutRound[] = [];
  for (const round of value.rounds) {
    const parsed = KnockoutRoundSchema.safeParse(round);
    if (!parsed.success) return null;
    rounds.push(parsed.data);
  }
  const seed_suffix = boundedString(value.seed_suffix, 128);
  return seed_suffix === null ? null : { kind: "escalating_strength_seeded", rounds, seed_suffix };
}

function parseMatches(value: unknown): MatchResult[] | null {
  if (!Array.isArray(value) || value.length < MIN_SIM_MATCHES || value.length > MAX_SIM_MATCHES) {
    return null;
  }
  const matches: MatchResult[] = [];
  for (const match of value) {
    const parsed = MatchResultSchema.safeParse(match);
    if (!parsed.success) return null;
    matches.push(parsed.data);
  }
  return matches;
}

function parseKnockoutMeta(value: unknown): PersistedKnockoutLadderMeta | null {
  if (!isPlainObject(value) || !Array.isArray(value.rounds)) return null;
  if (value.rounds.length > MAX_KNOCKOUT_META_ROUNDS) return null;
  const rounds: PersistedKnockoutLadderRoundMeta[] = [];
  for (const round of value.rounds) {
    const parsed = parseKnockoutRoundMeta(round);
    if (parsed === null) return null;
    rounds.push(parsed);
  }
  return { rounds };
}

function parseKnockoutRoundMeta(value: unknown): PersistedKnockoutLadderRoundMeta | null {
  if (!isPlainObject(value)) return null;
  const round = boundedString(value.round, 16);
  const opponent_team_id = boundedString(value.opponent_team_id, 128);
  const fallback_reason = nullableBoundedString(value.fallback_reason, 256);
  const user_slot_id = nullableBoundedString(value.user_slot_id, 64);
  const opposite_slot_id = nullableBoundedString(value.opposite_slot_id, 64);
  const candidate_group_ids = parseStringArray(
    value.candidate_group_ids,
    0,
    MAX_CANDIDATE_GROUP_IDS,
    16,
  );
  if (
    round === null ||
    opponent_team_id === null ||
    typeof value.bracket_constrained !== "boolean" ||
    typeof value.fallback !== "boolean" ||
    fallback_reason === INVALID_NULLABLE_STRING ||
    user_slot_id === INVALID_NULLABLE_STRING ||
    opposite_slot_id === INVALID_NULLABLE_STRING ||
    candidate_group_ids === null
  ) {
    return null;
  }
  return {
    round,
    opponent_team_id,
    bracket_constrained: value.bracket_constrained,
    fallback: value.fallback,
    fallback_reason,
    user_slot_id,
    opposite_slot_id,
    candidate_group_ids,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maxChars: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxChars ? value : null;
}

function nullableBoundedString(
  value: unknown,
  maxChars: number,
): string | null | typeof INVALID_NULLABLE_STRING {
  if (value === null) return null;
  return boundedString(value, maxChars) ?? INVALID_NULLABLE_STRING;
}

function parseStringArray(
  value: unknown,
  minLength: number,
  maxLength: number,
  maxChars: number,
): string[] | null {
  if (!Array.isArray(value) || value.length < minLength || value.length > maxLength) return null;
  const out: string[] = [];
  for (const item of value) {
    const parsed = boundedString(item, maxChars);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}
