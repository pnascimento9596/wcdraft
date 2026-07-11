// Reference standing — "Beat ~X% of reference drafts" — computed LOCALLY
// from the shipped score-distribution quantile table (no server call).
//
// HONESTY CONTRACT
//   • The standing is vs a REFERENCE POPULATION OF SIMULATED DRAFTS on this
//     engine — never vs players and never vs the daily posted field. It must
//     stay verbally distinct from the daily standing ("#N of M today ·
//     Top X% of today's field") on every surface.
//   • The table only describes scores produced by the exact engine + data it
//     was measured on. A record whose version anchors do not match the
//     table's anchors gets NO standing (null → line omitted), never a
//     wrong-population percentile.
//   • Same token + same bundle ⇒ same standing: the computation is pure and
//     the anchor check pins the population, so replays are stable.

import {
  loadScoreDistribution,
  referenceStanding,
  type ReferenceStanding,
  type ScoreDistribution,
} from "@wcdraft/data/client";

import type { RunRecordV1 } from "./run-record";
import type { RunRecordVersions } from "./versions";
import { loadGameData } from "./data";

/** One-line How-to-Play / a11y explainer, kept next to the computation. */
export const REFERENCE_STANDING_EXPLAINER =
  "Reference standing compares your score with a reference population of simulated drafts on this engine — not with other players." as const;

/**
 * The table applies to a run iff its anchors describe the exact version set
 * the run was simulated under (composeVersions conventions: combined
 * `historical+projected` rating version, `draftpool+scenario` bundle hash).
 */
export function scoreDistributionMatchesVersions(
  dist: ScoreDistribution,
  versions: RunRecordVersions,
): boolean {
  return (
    dist.anchors.dataset_version === versions.dataset_version &&
    dist.anchors.engine_version === versions.engine_version &&
    dist.anchors.ruleset_version === versions.ruleset_version &&
    `${dist.anchors.rating_version_historical}+${dist.anchors.rating_version_projected}` ===
      versions.rating_version &&
    `${dist.anchors.draft_pool_sha256}+${dist.anchors.scenario_2026_sha256}` ===
      versions.data_bundle_hash
  );
}

/**
 * Honest standing for a completed run, or null (omit the line) when the run
 * has no simulation, the table is unavailable, or the anchors do not match.
 */
export function referenceStandingForRecord(
  record: RunRecordV1,
  dist: ScoreDistribution | null,
): ReferenceStanding | null {
  if (dist === null || !record.simulation) return null;
  if (!scoreDistributionMatchesVersions(dist, record.versions)) return null;
  return referenceStanding(record.simulation.run.score, dist);
}

// ── Client-side loader (memoized; fail-soft to null) ────────────────────────

let cached: Promise<ScoreDistribution | null> | null = null;

/**
 * Load the shipped score-distribution once per session. Resolves to null on
 * any failure (older deployed data directory without the file, network
 * error, malformed payload) — callers omit the standing line, they never
 * retry-loop or fabricate.
 */
export function loadScoreDistributionOnce(): Promise<ScoreDistribution | null> {
  cached ??= loadGameData()
    .then(({ manifest }) => loadScoreDistribution({ manifest }))
    .catch((error: unknown) => {
      console.error("[reference-standing] score distribution unavailable", error);
      return null;
    });
  return cached;
}

/** Test hook: reset the memoized loader between tests. */
export function resetScoreDistributionCacheForTests(): void {
  cached = null;
}
