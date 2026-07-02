// Pure reference-standing computation over the shipped score-distribution
// quantile table. Browser-safe (no node imports); shared by the web results /
// share surfaces and the data-package golden + property tests.
//
// HONESTY CONTRACT
//   The standing is measured against a REFERENCE POPULATION OF SIMULATED
//   DRAFTS on this engine (the deterministic strategicAutoDraft ensemble) —
//   never against human players or a posted field. Display copy built here
//   says "reference drafts" and must never be re-worded into field/player
//   language. The daily posted-field standing is a different concept with
//   different copy ("#N of M today · Top X% of today's field").

import type { ScoreDistribution } from "./types.js";

/**
 * Percentage of the reference population whose score is STRICTLY below
 * `score`, read conservatively off the quantile table: the largest whole
 * percentile p (0..100) whose breakpoint q[p] < score. Monotonically
 * nondecreasing in `score`; whole percent; never over-credits ties.
 */
export function referenceBeatPercent(score: number, dist: ScoreDistribution): number {
  const q = dist.quantiles;
  let beat = 0;
  for (let p = 0; p < q.length; p++) {
    if (q[p]! < score) beat = p;
    else break;
  }
  return beat;
}

/** Computed reference standing, ready for display. */
export interface ReferenceStanding {
  /** Raw conservative beat-percent in [0, 100] (uncapped, for tests). */
  beat_percent: number;
  /** Tail bucket: extreme standings clamp to ~1% bands, never 0%/100%. */
  tail: "top" | "bottom" | null;
  /** Full display line, e.g. "Beat ~72% of reference drafts". */
  label: string;
}

/**
 * Honest standing line for a completed run's score. Tails clamp to
 * "Top ~1%" / "Bottom ~1%" (never 0/100); everything else renders as
 * "Beat ~X% of reference drafts" with X a whole percent.
 */
export function referenceStanding(score: number, dist: ScoreDistribution): ReferenceStanding {
  const beat = referenceBeatPercent(score, dist);
  if (beat >= 99) {
    return { beat_percent: beat, tail: "top", label: "Top ~1% of reference drafts" };
  }
  if (beat <= 1) {
    return { beat_percent: beat, tail: "bottom", label: "Bottom ~1% of reference drafts" };
  }
  return {
    beat_percent: beat,
    tail: null,
    label: `Beat ~${beat}% of reference drafts`,
  };
}
