// E-3a D5 — REALISM PASS-GATE.
//
// Drives the production pipeline (real DRAFT_POOL_BUNDLE → autoDraft →
// buildRunScenario → runTournamentFull) over a deterministic, seeded
// ensemble of N runs and measures five WC realism norms across the
// resulting match population:
//
//   norm            target   denominator
//   ─────────────── ─────── ─────────────────────────────────────────
//   goals / game    2.54    every match in every run (group + KO)
//   draw %          24.7    group-stage matches only (KO can't draw)
//   margin ≥4 %      4.9    every match
//   KO → ET %       33      every knockout match the user PLAYED
//   shootout %      21.4    every knockout match the user PLAYED
//
// MODE GATE:
//   - DEFAULT (env unset): REPORT-ONLY. Logs `[REALISM]` lines, never fails.
//     This is the landed report-first mode while D6 calibrates the tuple.
//   - `WCDRAFT_REALISM_GATE=pass`: HARD-ASSERT each norm lies within a
//     Wilson-style ±2·sqrt(p(1-p)/N) tolerance band. The PR flips this to
//     the default once D6 lands the fitted tuple and norms come in-band.
//
// The harness body lives in `./realism.harness.ts` so the D6 fit script can
// drive the same measurement without duplicating world-building logic.

import { describe, it, expect } from "vitest";

import {
  DEFAULT_SEED_PREFIX,
  runRealismEnsemble,
  summarizeRealism,
} from "./realism.harness.js";

const N_RUNS = Number(process.env.WCDRAFT_REALISM_N ?? 200);
const SEED_PREFIX = process.env.WCDRAFT_REALISM_SEED_PREFIX ?? DEFAULT_SEED_PREFIX;
const GATE_MODE = process.env.WCDRAFT_REALISM_GATE === "pass" ? "pass" : "report";

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

describe(`D5 realism gate — ${GATE_MODE.toUpperCase()} mode, N=${N_RUNS}`, () => {
  it(`measures the five WC realism norms over the era-weighted draft-reachable population`, () => {
    const m = runRealismEnsemble(N_RUNS, SEED_PREFIX);
    const { norms } = summarizeRealism(m);

    const rows = [
      `[REALISM] N_runs=${N_RUNS}  qualifying=${m.qualifyingRuns}/${N_RUNS}  matches=${m.matches}  groups=${m.groupMatches}  KO=${m.knockoutMatches}`,
    ];
    for (const n of norms) {
      const observed = n.name === "goals/game" ? n.observed.toFixed(3) : fmtPct(n.observed);
      const target = n.name === "goals/game" ? n.target.toFixed(3) : fmtPct(n.target);
      const band = n.name === "goals/game" ? `±${n.band.toFixed(3)}` : `±${fmtPct(n.band)}`;
      const status = n.inBand ? "✓" : "✗";
      rows.push(
        `[REALISM] ${status} ${n.name.padEnd(14)} obs=${observed.padStart(8)} tgt=${target.padStart(8)} band=${band.padStart(10)} (N=${n.denom})`,
      );
    }
    console.log(rows.join("\n"));

    if (GATE_MODE === "pass") {
      for (const n of norms) {
        expect(
          n.inBand,
          `realism norm OUT OF BAND: ${n.name} observed=${n.observed.toFixed(4)} target=${n.target} band=±${n.band.toFixed(4)} (N=${n.denom})`,
        ).toBe(true);
      }
    } else {
      // Report-only: passes regardless.
      expect(norms.length).toBe(5);
    }
  }, 600_000);
});
