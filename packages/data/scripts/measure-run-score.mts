// Deterministic run-score population measurement over a draft policy.
//
//   pnpm --filter @wcdraft/data exec tsx scripts/measure-run-score.mts 2000 strategicAutoDraft

import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";

import {
  ALL_POLICIES,
  DEFAULT_SEED_PREFIX,
  runRealismEnsembleForPolicy,
  summarizeScorePopulation,
  type DraftPolicyName,
} from "../test/realism/realism.harness.js";

const N = Number(process.argv[2] ?? 2000);
const POLICY_RAW = process.argv[3] ?? "strategicAutoDraft";
const SEED_PREFIX = process.env.WCDRAFT_REALISM_SEED_PREFIX ?? DEFAULT_SEED_PREFIX;

function isDraftPolicyName(value: string): value is DraftPolicyName {
  return (ALL_POLICIES as readonly string[]).includes(value);
}

if (!isDraftPolicyName(POLICY_RAW)) {
  throw new Error(`policy must be one of ${ALL_POLICIES.join(", ")}; got ${POLICY_RAW}`);
}
const POLICY = POLICY_RAW;

const t0 = performance.now();
const { measurement } = runRealismEnsembleForPolicy(POLICY, N, SEED_PREFIX);
const elapsedSeconds = (performance.now() - t0) / 1000;
const summary = summarizeScorePopulation(measurement);
const out = {
  policy: POLICY,
  seed_prefix: SEED_PREFIX,
  elapsed_seconds: elapsedSeconds,
  score_population: summary,
};

console.log(
  `[SCORE] policy=${POLICY} N=${summary.runs} qualifying=${summary.qualifyingRuns}/${N} ` +
    `mean=${summary.mean.toFixed(2)} median=${summary.median} p95=${summary.p95} ` +
    `min=${summary.min} max=${summary.max} elapsed=${elapsedSeconds.toFixed(1)}s`,
);

if (process.env.MEASURE_OUT) {
  writeFileSync(process.env.MEASURE_OUT, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log(`[SCORE] wrote ${process.env.MEASURE_OUT}`);
}
