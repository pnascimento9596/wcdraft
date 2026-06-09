// ENGINE-V2 E-2 — Manager flavor TRAITS (display-only).
//
// HARD RULES.
//   * Traits are FLAVOR LABELS only. They DO NOT feed any mechanic — not
//     Synergy, not team strength, not scoring, not persisted draft state.
//     The UI MUST NEVER claim a trait has a gameplay effect; the real shown
//     mechanic for managers stays the nation-synergy boost from
//     `computeSynergy()`.
//   * The taxonomy is ORIGINAL and generic-football-descriptive. It is NOT
//     modelled on any commercial football-game attribute schema.
//   * "Rating unavailable" remains on every manager surface; traits live
//     alongside it, never inside the rating slot.
//
// DETERMINISM.
//   * Curated map first (by `manager_id`, then by normalized name).
//   * Otherwise, two distinct trait ids are drawn deterministically from a
//     fixed-order taxonomy using `createRng(seed)` from `@wcdraft/core`.
//   * The seed is namespaced + versioned: `wcdraft:manager-traits:v1:<id>`.
//     Bumping the version would shift all derived traits; do not bump it
//     casually.
//   * Runtime derivation only — we DO NOT regenerate the 501-card manager
//     bundle for traits. No `engine_version` bump.

import { createRng } from "@wcdraft/core";

import type {
  ManagerTraitId,
  ManagerTraitSource,
  ManagerTraitView,
} from "./view-models";

/** Fixed-order taxonomy. The order is PART OF the deterministic output. */
const TAXONOMY: readonly ManagerTraitId[] = [
  "adaptive_plan",
  "attacking_license",
  "belief_builder",
  "compact_shape",
  "continuity_builder",
  "counter_tempo",
  "defensive_platform",
  "detail_planner",
  "dressing_room_calm",
  "emotional_spark",
  "finals_calm",
  "fluid_front_line",
  "global_organiser",
  "identity_builder",
  "knockout_calm",
  "positional_rotation",
  "possession_patience",
  "pressing_tone",
  "quick_assimilation",
  "quiet_authority",
  "rotation_trust",
  "set_piece_voice",
  "shape_innovator",
  "squad_balance",
  "squad_evolution",
  "steady_builder",
  "structure_first",
  "sweeper_view",
  "systems_teacher",
  "transition_patterns",
  "underdog_order",
  "wide_patterns",
  "youth_trust",
] as const;

/** Display labels — Title Case / sentence form. No mechanical wording. */
const LABELS: Readonly<Record<ManagerTraitId, string>> = {
  adaptive_plan: "Adaptive plan",
  attacking_license: "Attacking license",
  belief_builder: "Belief builder",
  compact_shape: "Compact shape",
  continuity_builder: "Continuity builder",
  counter_tempo: "Counter tempo",
  defensive_platform: "Defensive platform",
  detail_planner: "Detail planner",
  dressing_room_calm: "Dressing-room calm",
  emotional_spark: "Emotional spark",
  finals_calm: "Finals calm",
  fluid_front_line: "Fluid front line",
  global_organiser: "Global organiser",
  identity_builder: "Identity builder",
  knockout_calm: "Knockout calm",
  positional_rotation: "Positional rotation",
  possession_patience: "Possession patience",
  pressing_tone: "Pressing tone",
  quick_assimilation: "Quick assimilation",
  quiet_authority: "Quiet authority",
  rotation_trust: "Rotation trust",
  set_piece_voice: "Set-piece voice",
  shape_innovator: "Shape innovator",
  squad_balance: "Squad balance",
  squad_evolution: "Squad evolution",
  steady_builder: "Steady builder",
  structure_first: "Structure first",
  sweeper_view: "Sweeper view",
  systems_teacher: "Systems teacher",
  transition_patterns: "Transition patterns",
  underdog_order: "Underdog order",
  wide_patterns: "Wide patterns",
  youth_trust: "Youth trust",
};

/** Curated mapping by stable runtime `manager_id`. Empty by default; the
 *  named-curated map handles the human-readable canon. */
const CURATED_BY_ID: Readonly<Record<string, readonly [ManagerTraitId, ManagerTraitId]>> = {
  // M-311 = Carlos Alberto Parreira (per runtime data manifest).
  "M-311": ["global_organiser", "steady_builder"],
};

/** Curated mapping by NORMALIZED (NFD + ascii-fold + lowercase) full name.
 *  Two distinct trait ids per canonical manager. */
const CURATED_BY_NAME: Readonly<Record<string, readonly [ManagerTraitId, ManagerTraitId]>> = {
  "vittorio pozzo": ["continuity_builder", "finals_calm"],
  "sepp herberger": ["adaptive_plan", "belief_builder"],
  "alf ramsey": ["shape_innovator", "compact_shape"],
  "mario zagallo": ["fluid_front_line", "dressing_room_calm"],
  "rinus michels": ["positional_rotation", "pressing_tone"],
  "helmut schon": ["systems_teacher", "possession_patience"],
  "cesar luis menotti": ["attacking_license", "identity_builder"],
  "carlos bilardo": ["detail_planner", "knockout_calm"],
  "franz beckenbauer": ["sweeper_view", "dressing_room_calm"],
  "bora milutinovic": ["quick_assimilation", "adaptive_plan"],
  "aime jacquet": ["defensive_platform", "squad_balance"],
  "luiz felipe scolari": ["set_piece_voice", "emotional_spark"],
  "marcello lippi": ["rotation_trust", "finals_calm"],
  "carlos alberto parreira": ["global_organiser", "steady_builder"],
  "guus hiddink": ["underdog_order", "adaptive_plan"],
  "louis van gaal": ["structure_first", "youth_trust"],
  "joachim low": ["transition_patterns", "squad_evolution"],
  "vicente del bosque": ["possession_patience", "quiet_authority"],
  "didier deschamps": ["compact_shape", "dressing_room_calm"],
  "tele santana": ["attacking_license", "fluid_front_line"],
};

/** NFD-fold to ASCII lowercase, collapse non-alphanumerics to single spaces. */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function view(id: ManagerTraitId, source: ManagerTraitSource): ManagerTraitView {
  return { id, label: LABELS[id], source };
}

export interface ManagerTraitsInput {
  readonly manager_id: string;
  readonly full_name: string;
  readonly common_name?: string | null;
}

/**
 * Resolve exactly TWO deterministic flavor traits for a manager.
 * Resolution order:
 *   1. Curated by `manager_id`.
 *   2. Curated by normalized `full_name`.
 *   3. Curated by normalized `common_name` (if provided).
 *   4. Deterministic fallback seeded from `manager_id`.
 */
export function managerTraitsFor(
  input: ManagerTraitsInput,
): readonly [ManagerTraitView, ManagerTraitView] {
  // (1) curated by manager_id.
  const byId = CURATED_BY_ID[input.manager_id];
  if (byId) {
    return [view(byId[0], "curated"), view(byId[1], "curated")];
  }

  // (2) curated by normalized full_name.
  const fullKey = normalizeName(input.full_name);
  const byFull = CURATED_BY_NAME[fullKey];
  if (byFull) {
    return [view(byFull[0], "curated"), view(byFull[1], "curated")];
  }

  // (3) curated by normalized common_name.
  if (input.common_name) {
    const commonKey = normalizeName(input.common_name);
    if (commonKey && commonKey !== fullKey) {
      const byCommon = CURATED_BY_NAME[commonKey];
      if (byCommon) {
        return [view(byCommon[0], "curated"), view(byCommon[1], "curated")];
      }
    }
  }

  // (4) seeded deterministic fallback.
  return deriveFallback(input.manager_id);
}

/** Deterministic two-trait draw from the taxonomy, seeded by manager_id. */
function deriveFallback(
  manager_id: string,
): readonly [ManagerTraitView, ManagerTraitView] {
  // Empty/whitespace manager_id is not expected at runtime (schema
  // guarantees non-empty), but stay honest if it ever sneaks in.
  const seed = `wcdraft:manager-traits:v1:${manager_id || "unknown"}`;
  const rng = createRng(seed);
  const pool: ManagerTraitId[] = [...TAXONOMY];
  const firstIdx = rng.int(pool.length);
  const first = pool.splice(firstIdx, 1)[0]!;
  const secondIdx = rng.int(pool.length);
  const second = pool.splice(secondIdx, 1)[0]!;
  return [view(first, "derived"), view(second, "derived")];
}

/** Test/diagnostic helper: full taxonomy in canonical order. */
export const _MANAGER_TRAIT_TAXONOMY: readonly ManagerTraitId[] = TAXONOMY;
