// UI MOCK Synergy preview — NOT the calibrated engine.
//
// The real `computeSynergy` (api/synergy.ts) is a typed stub until WS-B locks
// the weights. For the WS-D draft screen we need a LIVE preview as the user
// places cards, so this computes a SynergyResult-shaped object from the same
// THREE components the contract defines — nation clusters, adjacency linked
// pairs, manager link — using the formation's materialised `adjacency` edge
// list. It is PURE and deterministic (no RNG / I/O), matching the contract's
// determinism invariant, but the fold weights here are illustrative stand-ins.
//
// "Synergy" is OUR term and OUR formula — not modelled on any other game.

import type { FormationTemplate, NationCluster, LinkedPair, SynergyResult } from "@wcdraft/core";
import type { ManagerCard, PitchSlot } from "./types";

/** Bounds for the mock multiplier — Synergy amplifies talent, never replaces it. */
const MULT_MIN = 0.92;
const MULT_MAX = 1.12;

/**
 * Compute a mock SynergyResult from the working XI (starter slots), the locked
 * formation, and the optional drafted manager. Starters only — bench never
 * contributes (mirrors the contract signature).
 */
export function mockSynergy(
  starters: readonly PitchSlot[],
  formation: FormationTemplate,
  manager: ManagerCard | null,
): SynergyResult {
  const bySlot = new Map<string, PitchSlot>();
  for (const s of starters) bySlot.set(s.slot_id, s);

  // (1) nation clusters across occupied starters (size >= 2).
  const byNation = new Map<string, string[]>();
  for (const s of starters) {
    if (!s.card) continue;
    const arr = byNation.get(s.card.nation_id) ?? [];
    arr.push(s.slot_id);
    byNation.set(s.card.nation_id, arr);
  }
  const nation_clusters: NationCluster[] = [...byNation.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([nation_id, ids]) => ({
      nation_id,
      slot_ids: [...ids].sort(),
      size: ids.length,
    }))
    .sort((a, b) => b.size - a.size || a.nation_id.localeCompare(b.nation_id));

  // (2) one LinkedPair per formation adjacency edge.
  const linked_pairs: LinkedPair[] = formation.adjacency.map(([a, b]) => {
    const ca = bySlot.get(a)?.card ?? null;
    const cb = bySlot.get(b)?.card ?? null;
    const linked = !!ca && !!cb && ca.nation_id === cb.nation_id;
    return {
      slot_id_a: a,
      slot_id_b: b,
      linked,
      nation_id: linked ? ca!.nation_id : null,
    };
  });

  // (3) manager link — fraction of occupied starters sharing the manager nation.
  const occupied = starters.filter((s) => s.card);
  let manager_link = 0;
  if (manager && occupied.length > 0) {
    const shared = occupied.filter((s) => s.card!.nation_id === manager.nation_id).length;
    manager_link = shared / occupied.length;
  }

  // Folded display score + bounded multiplier (illustrative weights).
  const linkedCount = linked_pairs.filter((p) => p.linked).length;
  const linkFraction = linked_pairs.length > 0 ? linkedCount / linked_pairs.length : 0;
  const clusterBonus = Math.min(1, nation_clusters.reduce((acc, c) => acc + (c.size - 1), 0) / 8);
  const raw = 0.55 * linkFraction + 0.25 * clusterBonus + 0.2 * manager_link;
  const overall = Math.round(raw * 100);
  const multiplier = MULT_MIN + (MULT_MAX - MULT_MIN) * raw;

  return { overall, nation_clusters, linked_pairs, manager_link, multiplier };
}
