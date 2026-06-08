// WS-B implementation of `computeSynergy` — OUR Synergy formula (NOT EA
// "chemistry"). Pure: no RNG, no I/O, no globals. Identical inputs →
// byte-identical SynergyResult. Locked by `synergy.golden.test.ts`.
//
// CALIBRATION: tune vs historical scorelines. The component WEIGHTS and the
// multiplier BAND live in `calibration.ts` (SYNERGY). The SHAPE of the surface
// (three components; bounded multiplier) is the WS-0c contract.
//
// ENGINE-V2 E-2 NATION-ONLY CONTRACT.
// All three Synergy components — clusters, linked pairs, manager link — are
// keyed on `nation_id` alone. Two starters from the same nation but different
// tournament years (e.g. Brazil 1970 + Brazil 2002) cluster and link
// identically to two starters from the same year. The manager link is a
// deterministic count-based function of same-nation starters in the XI,
// regardless of the manager's own tournament year. There is NO
// tournament-year gate anywhere in this file: `SquadSlot.tournament_id` and
// `ManagerTournament.tournament_id` are intentionally NOT read here.
//
// NATION MAP THREADING.
// `SquadSlot` carries NO `nation_id` (only card_id / player_id /
// tournament_id / slot fields), so nation clustering and the manager link
// need an external per-card nation lookup. The PUBLIC `ComputeSynergyFn`
// contract takes `nationByCardId?` as the 4th argument; this implementation
// mirrors it. When the map is absent or a card is missing from it, that
// card's nation is UNKNOWN → it joins no cluster and links nothing
// (honest-state: an unknown nation cannot manufacture Synergy).

import type { SquadSlot } from "../types/draft.js";
import type { FormationTemplate } from "../types/formation.js";
import type { ManagerTournament } from "../types/manager.js";
import type { LinkedPair, NationCluster, SynergyResult } from "../types/synergy.js";
import { SYNERGY, clamp } from "./calibration.js";

/** Map a starter SquadSlot to its nation_id, or null when unknown / vacant. */
function nationOf(
  slot: SquadSlot,
  nationByCardId: Readonly<Record<string, string>> | undefined,
): string | null {
  if (slot.card_id === null) return null;
  if (!nationByCardId) return null;
  return nationByCardId[slot.card_id as string] ?? null;
}

/**
 * Compute the Synergy result for a squad against a formation + optional manager.
 *
 * @param squad           full SquadSlot[] (starters + bench); STARTERS ONLY
 *                        contribute — bench composition is invisible.
 * @param formation       locked FormationTemplate; its `adjacency` edges drive
 *                        `linked_pairs` 1:1 by index.
 * @param manager         drafted ManagerTournament or null (null → manager_link 0).
 * @param nationByCardId  optional card_id → nation_id lookup (see contract-gap
 *                        note above). Absent ⇒ no nation is known ⇒ no clusters
 *                        / no links / manager_link 0.
 */
export function computeSynergy(
  squad: readonly SquadSlot[],
  formation: FormationTemplate,
  manager: ManagerTournament | null,
  nationByCardId?: Readonly<Record<string, string>>,
): SynergyResult {
  const starters = squad.filter((s) => s.is_starter);
  const STARTER_TARGET = formation.slots.length; // 11

  // Index starters by slot_id for O(1) edge lookup.
  const starterBySlot = new Map<string, SquadSlot>();
  for (const s of starters) starterBySlot.set(s.slot_id, s);

  // ── Component (1): nation clusters (size ≥ 2 = a real concentration). ──
  const slotsByNation = new Map<string, string[]>();
  for (const s of starters) {
    const nation = nationOf(s, nationByCardId);
    if (nation === null) continue;
    let arr = slotsByNation.get(nation);
    if (!arr) {
      arr = [];
      slotsByNation.set(nation, arr);
    }
    arr.push(s.slot_id);
  }
  const nation_clusters: NationCluster[] = [];
  for (const [nation_id, slot_ids] of slotsByNation) {
    if (slot_ids.length < 2) continue; // a lone national is not a cluster
    const sorted = [...slot_ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    nation_clusters.push({ nation_id, slot_ids: sorted, size: sorted.length });
  }
  nation_clusters.sort((a, b) => (a.nation_id < b.nation_id ? -1 : a.nation_id > b.nation_id ? 1 : 0));

  // ── Component (2): linked pairs, one per adjacency edge (1:1 by index). ──
  const linked_pairs: LinkedPair[] = formation.adjacency.map(([a, b]) => {
    const sa = starterBySlot.get(a);
    const sb = starterBySlot.get(b);
    const na = sa ? nationOf(sa, nationByCardId) : null;
    const nb = sb ? nationOf(sb, nationByCardId) : null;
    const linked = na !== null && nb !== null && na === nb;
    return { slot_id_a: a, slot_id_b: b, linked, nation_id: linked ? na : null };
  });

  // ── Component (3): manager link. ──
  let manager_link = 0;
  if (manager !== null && STARTER_TARGET > 0) {
    let shareCount = 0;
    for (const s of starters) {
      if (nationOf(s, nationByCardId) === manager.nation_id) shareCount++;
    }
    const fraction = shareCount / STARTER_TARGET;
    manager_link = clamp(fraction / SYNERGY.MANAGER_LINK_FULL_AT, 0, 1);
  }

  // ── Fold the three components into overall (0..100). ──
  const clusteredStarters = nation_clusters.reduce((acc, c) => acc + c.size, 0);
  const clusterComp01 = STARTER_TARGET > 0 ? clamp(clusteredStarters / STARTER_TARGET, 0, 1) : 0;
  const totalEdges = formation.adjacency.length;
  const linkedEdges = linked_pairs.reduce((acc, p) => acc + (p.linked ? 1 : 0), 0);
  const linkComp01 = totalEdges > 0 ? linkedEdges / totalEdges : 0;
  const cohesion01 = clamp(
    SYNERGY.CLUSTER_WEIGHT * clusterComp01 +
      SYNERGY.LINK_WEIGHT * linkComp01 +
      SYNERGY.MANAGER_WEIGHT * manager_link,
    0,
    1,
  );
  const overall = clamp(cohesion01 * 100, 0, 100);

  // ── Bounded multiplier: Synergy only ever AMPLIFIES, within a tight band. ──
  // multiplier ∈ [1, 1 + MULTIPLIER_BAND] — strictly positive, bounded, so a
  // high-Synergy weak XI can never out-aggregate a low-Synergy superstar XI.
  const multiplier = 1 + SYNERGY.MULTIPLIER_BAND * cohesion01;

  return { overall, nation_clusters, linked_pairs, manager_link, multiplier };
}
