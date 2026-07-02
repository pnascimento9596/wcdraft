// Builds the SHIPPED reference score-distribution artifact:
//   packages/data/src/generated/score-distribution.compact.json
//
//   pnpm --filter @wcdraft/data run build:score-distribution
//
// WHAT IT IS
//   A compact quantile table (nearest-rank percentile → score breakpoint,
//   q[0..100]) over the SAME deterministic strategicAutoDraft N=2000 score
//   population that `asym-realism-golden.json` pins (`score_population`).
//   The web results surface computes an honest LOCAL "Beat ~X% of reference
//   drafts" standing from this table — no server call, no new methodology.
//
// DETERMINISM / STALENESS
//   Pure + seeded (DEFAULT_SEED_PREFIX): identical engine + bundles ⇒
//   identical bytes. The artifact embeds the manifest anchors (dataset /
//   engine / rating / ruleset versions + source bundle sha256s) at
//   generation time; the cheap golden (`score-distribution.golden.test.ts`)
//   asserts those anchors equal the CURRENT manifest, so any engine or data
//   movement reds CI until this script is re-run. The heavy realism lane
//   (WCDRAFT_REALISM_HEAVY=1) re-derives the table from a live ensemble and
//   asserts deep equality.
//
// REGEN FLOW (engine/data change)
//   1. rebuild bundles: pnpm --filter @wcdraft/data run build:compact
//      (score_distribution manifest entry is omitted while the artifact is
//      stale/absent — build:compact warns but does not fail)
//   2. re-run this script
//   3. re-run build:compact so the manifest re-stamps the new fingerprint

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { RUNTIME_DATA_MANIFEST } from "../src/index.js";
import { SCORE_DISTRIBUTION_SCHEMA_VERSION, type ScoreDistribution } from "../src/types.js";
import {
  buildScoreQuantiles,
  DEFAULT_SEED_PREFIX,
  runRealismEnsembleForPolicy,
  summarizeScorePopulation,
} from "../test/realism/realism.harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, "..", "src", "generated", "score-distribution.compact.json");

const POLICY = "strategicAutoDraft" as const;
const N = 2000;

const t0 = performance.now();
const { measurement } = runRealismEnsembleForPolicy(POLICY, N, DEFAULT_SEED_PREFIX);
const summary = summarizeScorePopulation(measurement);
const quantiles = buildScoreQuantiles(measurement.scores);

const artifact: ScoreDistribution = {
  schema_version: SCORE_DISTRIBUTION_SCHEMA_VERSION,
  _doc: "Reference run-score distribution: nearest-rank percentile->score breakpoints (q[0..100]) over the deterministic strategicAutoDraft ensemble. Reference population of SIMULATED drafts on this engine - not human players. Regenerate via build-score-distribution.mts whenever the anchors move.",
  anchors: {
    dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
    engine_version: RUNTIME_DATA_MANIFEST.engine_version,
    rating_version_historical: RUNTIME_DATA_MANIFEST.rating_version_historical,
    rating_version_projected: RUNTIME_DATA_MANIFEST.rating_version_projected,
    ruleset_version: RUNTIME_DATA_MANIFEST.ruleset_version,
    draft_pool_sha256: RUNTIME_DATA_MANIFEST.bundles.draft_pool.sha256,
    scenario_2026_sha256: RUNTIME_DATA_MANIFEST.bundles.scenario_2026.sha256,
  },
  population: {
    policy: POLICY,
    seed_prefix: DEFAULT_SEED_PREFIX,
    runs: summary.runs,
    qualifying_runs: summary.qualifyingRuns,
    mean: summary.mean,
    median: summary.median,
    p95: summary.p95,
    min: summary.min,
    max: summary.max,
  },
  quantiles,
};

writeFileSync(OUT_PATH, JSON.stringify(artifact, null, 2) + "\n", "utf-8");
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log(
  `[SCORE-DIST] wrote ${OUT_PATH} (N=${summary.runs} qualifying=${summary.qualifyingRuns} ` +
    `median=${summary.median} p95=${summary.p95} min=${summary.min} max=${summary.max}) in ${elapsed}s`,
);
