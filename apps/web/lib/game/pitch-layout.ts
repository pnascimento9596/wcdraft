// Pure render-layer anti-overlap for pitch chips.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// Pitch chips are absolute-positioned percentages of the pitch box, sourced
// from `/brand/formations.json` (the canonical layout) and never mutated by
// the UI. At narrow mobile viewports (360-430px) the chip MIN width and the
// chosen percentages collide on dense central stacks — most visibly:
//   - 5-3-2: GK (50,91) atop CB (50,81), and the midfield triangle
//     LCM (36,52) / CM (50,45) / RCM (64,52) where chip half-widths and
//     half-heights overlap.
//   - 3-5-2: same diamond midfield (LCM 36,57 / CM 50,46 / RCM 64,57).
//
// ── What this does ───────────────────────────────────────────────────────────
// Takes the canonical `FormationVisualSlot[]` and returns a copy with
// `x_pct` / `y_pct` nudged just enough to break overlaps at mobile chip
// dimensions. The JSON file is NEVER mutated and the iteration is
// deterministic (same input → same output, no randomness, no clock reads).
//
// ── How it works ─────────────────────────────────────────────────────────────
// Simultaneous-relaxation pairwise resolver:
//   1. Treat each chip as an AABB centered on (x_pct, y_pct) with fixed
//      half-extents in pitch-percent units.
//   2. For every pair, if their AABBs overlap, schedule a push along the
//      cheaper axis (smaller overlap) into per-slot delta buffers.
//   3. After each pass apply the AVERAGE delta per slot (so the central
//      chip in a 3-stack receives equal opposing pushes and stays put).
//   4. Repeat until no conflicts remain or a small pass cap is hit.
//   5. Clamp into the playable inset.
//
// This produces symmetric results for mirror pairs (LCM/RCM share a y, CM
// stays at x=50) and keeps the canonical center-of-mass of each cluster.
//
// ── Coupled invariants ───────────────────────────────────────────────────────
// The synergy overlay (`buildSynergySegments`) projects endpoints from
// `visualBySlot`, so callers MUST feed it the ADJUSTED slot map — never a
// mix of canonical chip coords and canonical line coords, or the lines
// will miss the chips by the nudge amount. `pitch.tsx` enforces this.

import type { FormationVisualSlot } from "./formation-layout";

/**
 * Chip half-width in pitch-percent units. EXACT under the container-query
 * sizing in `game.module.css`: `.squadStage .pitch .slot` is `width: 19cqw`
 * (19% of the pitch's inline size) → half-width 9.5%. No px clamps remain,
 * so this holds at every viewport width.
 */
const CHIP_HALF_W_PCT = 9.5;
/**
 * Chip half-height in pitch-percent units. EXACT under the container-query
 * sizing: chip `height: 14cqw` on a pitch with `aspect-ratio: 100 / 94`
 * → 14 / 0.94 = 14.89% of pitch height → half-height 7.45%. Rounded up a
 * touch for border/ring breathing room. The old 6.0 UNDERESTIMATED the
 * rendered chip (content-sized, ~15-16% tall), which is exactly why GK/CB
 * and ST/CAM stacks still collided at 360-430px.
 */
const CHIP_HALF_H_PCT = 7.5;
/** Visual breathing room between adjacent chip edges. */
const CHIP_GAP_PCT = 0.4;
/**
 * Clamp bound — allow chips to sit anywhere the canonical layout puts
 * them (canonical GK is at y=91, only 9% from the pitch bottom). Clamp
 * is here purely so a resolver nudge can't push a chip OFF the pitch;
 * it must not be tighter than the canonical positions or chips that
 * the resolver moved would snap back into overlap on the next render.
 */
const PITCH_EDGE_INSET_PCT = 0;
/**
 * Iteration cap. The averaged-delta scheme separates a residual overlap
 * geometrically (≈half per pass) when a middle chip is pinned by symmetric
 * neighbours, so a generous cap is needed to drive dense 3-stacks (5-3-2 /
 * 3-5-2 midfield diamonds at the taller half-height) below the collision
 * threshold. Still deterministic and trivially cheap (≤11 chips).
 */
const MAX_PASSES = 24;

interface Delta {
  dx: number;
  dy: number;
  count: number;
}

/**
 * Returns a copy of `slots` with `x_pct` / `y_pct` adjusted so no two
 * chips overlap when rendered at mobile chip dimensions. Pure, fully
 * deterministic. The input array and its elements are never mutated.
 */
export function adjustPitchLayoutForRender(
  slots: readonly FormationVisualSlot[],
): FormationVisualSlot[] {
  const out: FormationVisualSlot[] = slots.map((s) => ({ ...s }));
  const halfW = CHIP_HALF_W_PCT;
  const halfH = CHIP_HALF_H_PCT;
  const gap = CHIP_GAP_PCT;

  // Clamp bounds -- generous on purpose (PITCH_EDGE_INSET_PCT = 0): chips
  // may overlap the visual touchline by their half-extents, and the bound
  // must never be tighter than a canonical position or the clamp re-creates
  // the overlap the resolver just fixed.
  const minX = PITCH_EDGE_INSET_PCT + halfW;
  const maxX = 100 - PITCH_EDGE_INSET_PCT - halfW;
  const minY = PITCH_EDGE_INSET_PCT + halfH;
  const maxY = 100 - PITCH_EDGE_INSET_PCT - halfH;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const deltas: Delta[] = out.map(() => ({ dx: 0, dy: 0, count: 0 }));
    let conflicts = 0;

    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        const dx = b.x_pct - a.x_pct;
        const dy = b.y_pct - a.y_pct;
        const overlapX = 2 * halfW + gap - Math.abs(dx);
        const overlapY = 2 * halfH + gap - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          // Push along the cheaper axis. On an exact tie, prefer X (lateral
          // moves disturb the formation silhouette less than vertical ones).
          if (overlapX <= overlapY) {
            // dx === 0 → tie-break to the right so the second chip moves
            // right and the first moves left, preserving the column
            // average. Deterministic ordering by `i < j` keeps the
            // direction stable across renders.
            const dir = dx === 0 ? 1 : Math.sign(dx);
            const push = overlapX / 2;
            deltas[i]!.dx -= dir * push;
            deltas[j]!.dx += dir * push;
          } else {
            const dir = dy === 0 ? 1 : Math.sign(dy);
            const push = overlapY / 2;
            deltas[i]!.dy -= dir * push;
            deltas[j]!.dy += dir * push;
          }
          deltas[i]!.count++;
          deltas[j]!.count++;
          conflicts++;
        }
      }
    }

    if (conflicts === 0) break;

    // Apply AVERAGE delta per slot. This is the symmetry trick: in a
    // 3-stack, the middle chip receives equal opposing pushes from its
    // two neighbours and ends up moving by 0 — the two outer chips
    // absorb the total separation. Mirror pairs (e.g. LCM/RCM at the
    // same y) stay mirrored.
    //
    // Clamp INSIDE the pass (not just once at the end): a chip pinned to
    // the pitch edge (canonical GK at y=91 sits ~1.5% from the bottom
    // bound) loses its share of the separation to the clamp, and the
    // NEXT pass must see the clamped position so the remaining overlap
    // is pushed onto the unpinned neighbour. With an end-only clamp the
    // GK/CB stack converged to a still-colliding pair.
    for (let i = 0; i < out.length; i++) {
      const d = deltas[i]!;
      if (d.count > 0) {
        out[i]!.x_pct = clamp(out[i]!.x_pct + d.dx / d.count, minX, maxX);
        out[i]!.y_pct = clamp(out[i]!.y_pct + d.dy / d.count, minY, maxY);
      }
    }
  }

  // Final safety clamp (no-op when the per-pass clamp already ran).
  for (const sl of out) {
    sl.x_pct = clamp(sl.x_pct, minX, maxX);
    sl.y_pct = clamp(sl.y_pct, minY, maxY);
  }

  return out;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Exposed for unit tests. Two chips "collide" when their AABBs (using
 * the same dimensions as the resolver) overlap.
 */
export function chipsCollide(
  a: { x_pct: number; y_pct: number },
  b: { x_pct: number; y_pct: number },
): boolean {
  return (
    Math.abs(b.x_pct - a.x_pct) < 2 * CHIP_HALF_W_PCT &&
    Math.abs(b.y_pct - a.y_pct) < 2 * CHIP_HALF_H_PCT
  );
}
