// Synergy overlay segment builder — single source of truth for what the
// pitch SVG layer renders on top of the formation.
//
// CONTRACT (UX-COMPACT):
//   Render synergy links ONLY between FILLED slots that share actual
//   synergy (same nation). Zero links when slots are empty or share no
//   synergy.
//
// `LinkedPair.linked === true` already implies BOTH slots are filled AND
// share `nation_id` (see `packages/core/src/types/synergy.ts` — "linked
// === true iff both slots are occupied AND share nation_id"). So the
// filter is honest by construction: pass-through of `linked: true` rows
// is exactly "filled + same-nation". We still defensively drop any
// pair whose visual slot is unknown (formation drift), and any pair
// where either endpoint slot is NOT in the filled set passed in — that
// way an upstream contract regression cannot produce a phantom link.

import type { LinkedPair } from "@wcdraft/core";
import type { FormationVisualSlot } from "./formation-layout";

export interface SynergySegment {
  /** Stable key (`slot_id_a|slot_id_b`), suitable for React. */
  key: string;
  /** Normalized 0..100 viewBox coordinates. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Shared nation_id (always non-null for emitted segments). */
  nation_id: string;
}

/**
 * Build the list of SVG line segments to draw on the pitch synergy layer.
 *
 * @param pairs           - `SynergyResult.linked_pairs` from `computeSynergy`.
 * @param visualBySlot    - Coordinate lookup keyed by canonical slot_id.
 * @param filledSlotIds   - Set of slot_ids whose `card` is non-null. Used
 *                          as a defensive guard so we never draw to/from
 *                          an empty slot even if a future regression
 *                          flipped `linked: true` for a vacant edge.
 */
export function buildSynergySegments(
  pairs: readonly LinkedPair[] | null | undefined,
  visualBySlot: ReadonlyMap<string, FormationVisualSlot>,
  filledSlotIds: ReadonlySet<string>,
): SynergySegment[] {
  if (!pairs || pairs.length === 0) return [];
  const out: SynergySegment[] = [];
  for (const p of pairs) {
    if (!p.linked) continue;
    if (p.nation_id === null) continue; // contract: linked → nation_id non-null
    if (!filledSlotIds.has(p.slot_id_a)) continue;
    if (!filledSlotIds.has(p.slot_id_b)) continue;
    const a = visualBySlot.get(p.slot_id_a);
    const b = visualBySlot.get(p.slot_id_b);
    if (!a || !b) continue;
    out.push({
      key: `${p.slot_id_a}|${p.slot_id_b}`,
      x1: a.x_pct,
      y1: a.y_pct,
      x2: b.x_pct,
      y2: b.y_pct,
      nation_id: p.nation_id,
    });
  }
  return out;
}
