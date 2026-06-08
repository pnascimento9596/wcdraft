// E-3b measurement driver — runs the asymmetric harness for all 3 policies
// at chosen N and prints per-policy realism norms + per-policy telemetry.

import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import {
  ALL_POLICIES,
  runRealismEnsembleForPolicy,
  summarizeRealism,
  wilsonHalfWidthObs,
  formatTelemetry,
  type DraftPolicyName,
} from "../test/realism/realism.harness.js";

const N = Number(process.argv[2] ?? 200);

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

interface OutRow {
  policy: DraftPolicyName;
  N: number;
  runs: number;
  qualifying: number;
  matches: number;
  groupMatches: number;
  knockoutMatches: number;
  norms: {
    name: string;
    observed: number;
    target: number;
    denom: number;
    halfAroundObs: number;
    deltaVsTarget: number;
  }[];
  telemetry: unknown;
}

const allOut: OutRow[] = [];

for (const policy of ALL_POLICIES) {
  const t0 = performance.now();
  const { measurement, telemetry } = runRealismEnsembleForPolicy(policy, N);
  const dt = (performance.now() - t0) / 1000;
  const { norms } = summarizeRealism(measurement);
  console.log(`\n=== POLICY ${policy}  N=${N}  elapsed=${dt.toFixed(1)}s ===`);
  console.log(
    `[REALISM] qualifying=${measurement.qualifyingRuns}/${N} matches=${measurement.matches} groups=${measurement.groupMatches} KO=${measurement.knockoutMatches}`,
  );
  const pol: OutRow = {
    policy,
    N,
    runs: N,
    qualifying: measurement.qualifyingRuns,
    matches: measurement.matches,
    groupMatches: measurement.groupMatches,
    knockoutMatches: measurement.knockoutMatches,
    norms: [],
    telemetry,
  };
  for (const n of norms) {
    const obs = n.name === "goals/game" ? n.observed.toFixed(3) : fmtPct(n.observed);
    const tgt = n.name === "goals/game" ? n.target.toFixed(3) : fmtPct(n.target);
    const halfObs =
      n.name === "goals/game"
        ? 2 * Math.sqrt(n.observed / Math.max(1, n.denom))
        : wilsonHalfWidthObs(n.observed, n.denom);
    const halfStr = n.name === "goals/game" ? halfObs.toFixed(3) : fmtPct(halfObs);
    const status = n.inBand ? "✓" : "✗";
    console.log(
      `[REALISM] ${status} ${n.name.padEnd(14)} obs=${String(obs).padStart(8)} tgt=${String(tgt).padStart(8)} half_around_obs=±${halfStr.padStart(8)} (N=${n.denom})`,
    );
    pol.norms.push({
      name: n.name,
      observed: n.observed,
      target: n.target,
      denom: n.denom,
      halfAroundObs: halfObs,
      deltaVsTarget: n.delta,
    });
  }
  console.log(formatTelemetry(telemetry));
  allOut.push(pol);
}

const outPath = process.env.MEASURE_OUT ?? `/tmp/wcdraft-e3b-measure-N${N}.json`;
writeFileSync(outPath, JSON.stringify(allOut, null, 2));
console.log(`\nWROTE ${outPath}`);
