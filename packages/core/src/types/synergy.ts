// Synergy layer of the wcdraft data contract (WS-0c depth layer).
//
// CARDINAL NAMING RULE: this is "Synergy" — OUR term and OUR formula. It is
// NOT and is not modeled on EA's "chemistry". Do not import that vocabulary.
//
// SHAPE OF THE SURFACE (THREE COMPONENTS):
//   (1) nation_clusters — concentration of same nation_id across the XI.
//   (2) linked_pairs    — for each FormationTemplate.adjacency edge, did the
//                          two slots' cards share nation_id?
//   (3) manager_link    — did the manager (if any) share nation_id with
//                          enough of the XI?
//
// The component WEIGHTS that fold into `overall` and `multiplier` are
// CALIBRATION: WS-B (the same as the position-compatibility curve). The
// SHAPE of the surface (these three components, their identities, the fact
// that the output multiplier is BOUNDED) is part of THIS contract.
//
// BOUNDED-MULTIPLIER INVARIANT: `SynergyResult.multiplier` is in a bounded
// numeric range (locked by WS-B golden, but the contract here promises
// "bounded" — see the field comment). The intent: a high-Synergy weak XI must
// never out-play a low-Synergy superstar XI. Synergy AMPLIFIES talent; it
// does not REPLACE it.

import type { SquadSlot } from "./draft.js";
import type { FormationTemplate } from "./formation.js";
import type { ManagerTournament } from "./manager.js";

// ─── COMPONENT TYPES ─────────────────────────────────────────────────────────

/**
 * One concentration of same-nation cards across the user XI (starters only,
 * not bench). Identity is the nation. `slot_ids` is the set of starter slot
 * ids whose card carries this nation_id, sorted lexicographically for
 * canonical equality.
 */
export interface NationCluster {
  nation_id: string;
  slot_ids: string[];
  /** Number of starter slots in this cluster — equals `slot_ids.length`. */
  size: number;
}

/**
 * One materialised result for a single FormationTemplate.adjacency edge: did
 * the two slots' cards share nation_id?
 *
 * Identity is `(slot_id_a, slot_id_b)` with `slot_id_a < slot_id_b`
 * lexicographically (mirrors `FormationTemplate.adjacency`'s edge
 * canonicalisation, so the two arrays can be aligned 1:1 by index).
 *
 * `linked === true` iff both slots are occupied AND share `nation_id`.
 * A vacant slot makes the edge `linked === false` (honest-state: an empty
 * slot cannot contribute Synergy).
 */
export interface LinkedPair {
  slot_id_a: string;
  slot_id_b: string;
  linked: boolean;
  /**
   * The shared nation_id when `linked === true`; `null` otherwise. Carried
   * for transparency / UI so the consumer can label which cluster the edge
   * contributes to.
   */
  nation_id: string | null;
}

// ─── RESULT ──────────────────────────────────────────────────────────────────

/**
 * Aggregate result of running the Synergy formula on a squad + formation +
 * (optional) manager.
 *
 * DETERMINISM INVARIANT: identical `(squad, formation, manager)` → identical
 * `SynergyResult`. The Synergy formula is PURE — no RNG, no I/O, no globals.
 * The `synergy-determinism` golden test locks this once.
 */
export interface SynergyResult {
  /**
   * Composite 0..100 Synergy score for UI display. Folded from the three
   * components using weights calibrated by WS-B (CALIBRATION: WS-B).
   */
  overall: number;
  /** Component (1): nation clusters across the XI (starters only). */
  nation_clusters: NationCluster[];
  /** Component (2): per-adjacency-edge link status (one entry per edge). */
  linked_pairs: LinkedPair[];
  /**
   * Component (3): manager link strength in [0, 1]. `0` when no manager is
   * drafted OR when the manager's nation_id is unrelated to the XI. Folding
   * formula calibrated by WS-B.
   */
  manager_link: number;
  /**
   * BOUNDED Synergy multiplier applied to aggregated team strength in WS-B.
   * The exact bounds are part of WS-B calibration but the contract promises:
   *   - multiplier > 0
   *   - multiplier is BOUNDED (i.e. a high-Synergy weak XI cannot out-play
   *     a low-Synergy superstar XI).
   *   - identical inputs → identical multiplier (deterministic).
   * The `synergy-determinism` golden test enforces (1)+(3); the
   * `team-strength-bounded` golden test (lands WS-B) enforces (2).
   */
  multiplier: number;
}

// ─── FUNCTION SIGNATURE ──────────────────────────────────────────────────────

/**
 * Compute the Synergy result for a fully or partially-filled squad against a
 * formation template + optional manager card. PURE: no RNG / I/O / globals.
 *
 * INPUTS:
 *  - `squad` — the full SquadSlot[] (starters + bench). The Synergy formula
 *    consumes STARTERS ONLY; bench cards do not contribute. The signature
 *    accepts the full array so consumers don't pre-filter and miscount.
 *  - `formation` — the locked FormationTemplate. Its `adjacency` edges drive
 *    `linked_pairs` 1:1 by index.
 *  - `manager` — the drafted ManagerTournament, or `null` when no manager has
 *    been picked yet. When `null`, `manager_link` is `0`.
 *  - `nationByCardId` — OPTIONAL card_id → nation_id lookup. `SquadSlot` carries
 *    no `nation_id`, but the nation-cluster / linked-pair / manager-link
 *    components all need a per-card nation. When omitted (or a card is missing
 *    from the map), that card's nation is UNKNOWN → it joins no cluster and
 *    links nothing (honest-state: an unknown nation cannot manufacture
 *    Synergy). Real wiring of the nation map is the data/draft-engine
 *    responsibility.
 *
 * OUTPUT: `SynergyResult` with the three components materialised and the
 * folded `overall` + bounded `multiplier`.
 *
 * The formula itself is `CALIBRATION: WS-B`. This file ships only the type +
 * function signature; the runtime binding lives in `api/synergy.ts`.
 */
export type ComputeSynergyFn = (
  squad: readonly SquadSlot[],
  formation: FormationTemplate,
  manager: ManagerTournament | null,
  nationByCardId?: Readonly<Record<string, string>>,
) => SynergyResult;
