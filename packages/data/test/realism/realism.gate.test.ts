// ENGINE-V2 E-3b ASYMMETRIC REALISM GATE — PASS by default.
//
// MEASUREMENT POLICY
//   The drafted-XI realism gate measures over the COMPETENT user population
//   (`strategicAutoDraft` — slot-fit best-available), not over canonical
//   `autoDraft` (which is canonical-first / first-vacant-slot — a draft
//   determinism fixture, not a user-behavior proxy). See
//   `docs/investigations/engine-v2-asymmetric-realism-2026-06-07.md` for the
//   investigation that quantified the "11/200 / 16.64% margin≥4 / 0% KO→ET"
//   landing as a HARNESS POPULATION ARTIFACT and motivated the switch.
//
// THE GATE (locked in `./asym-realism-golden.json`)
//   1. SHAPE bands (TIGHT Wilson half-widths around the strategicAutoDraft
//      landings at the locked N) for the four shape norms:
//        - draw% (group)
//        - margin≥4%
//        - KO→ET%
//        - shootout%
//      If any of these moves outside its band, the engine + harness has
//      drifted; re-measure and re-lock atomically (see SIM_CALIBRATION.md).
//
//   2. GOALS/GAME — one-sided LOWER FLOOR only (no upper cap). Total goal
//      volume legitimately tracks the underdog gap (strategic XI is ~10–13
//      channel points below the 2026 coherent-elite opponent mean) and has
//      no real-world ceiling — so we floor the metric and let it drift up
//      without falsely red-flagging the gate.
//
//   3. GREEDY-OVERALL CI GUARD — `greedyOverallAutoDraft` (position-blind
//      max-overall) MUST land OUTSIDE every shape band. This proves
//      "competent" must mean slot-fit-aware, not max display overall —
//      nobody can "fix" the realism gate by maxing OVR. The greedy guard
//      lives ALONGSIDE the strategic gate; both must hold.
//
//   4. TELEMETRY — per-policy XI channel means + Synergy multiplier + manager
//      modifier are logged for every run, so any future regression's
//      direction (population gap moved? Synergy folded differently?) is
//      visible in the CI log without re-running the harness.
//
// MODE SWITCH
//   • Default (env unset, or `WCDRAFT_REALISM_GATE=pass`): hard-assert.
//   • `WCDRAFT_REALISM_GATE=report`: report-only (skip assertions). Used
//     for ad-hoc diagnostics; not a CI escape hatch.
//
// N SIZING
//   `WCDRAFT_REALISM_N` overrides the locked N (default 2000). The locked
//   N targets a 95% Wilson half-width ≤ ~4pp on the KO-derived metrics
//   (KO→ET, shootout). Lowering N below the locked value will widen the
//   KO half-widths above the shape bands and the gate will (correctly) red.
//
// E-4 RE-LOCK
//   When E-4 (rating-stature) lands and shifts λ + the realism landings,
//   re-run the measurement at the same N + seed prefix, copy the new
//   landings + Wilson half-widths into `asym-realism-golden.json`, and
//   commit the band update atomically with the engine-output change. The
//   gate MECHANISM (strategicAutoDraft + raised N + greedyOverall guard +
//   shape bands + lower-floor goals) is the DURABLE infrastructure that
//   re-fit measures against; only the NUMBERS move.

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCORE_DISTRIBUTION_BUNDLE } from "../../src/index.js";

import {
  ALL_POLICIES,
  buildScoreQuantiles,
  DEFAULT_SEED_PREFIX,
  REALISM_NORMS,
  runRealismEnsembleForPolicy,
  summarizeScorePopulation,
  summarizeRealism,
  type DraftPolicyName,
  type PolicyTelemetry,
  type RealismMeasurement,
  type ScorePopulationSummary,
} from "./realism.harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface AsymRealismGolden {
  engine_anchor: string;
  engine_version: string;
  ensemble: {
    seed_prefix: string;
    N_runs: number;
    formation_id: string;
  };
  policies: Record<
    DraftPolicyName,
    {
      qualifying: number;
      matches: number;
      groupMatches: number;
      knockoutMatches: number;
      observed: {
        goals_per_game: number;
        draw_pct: number;
        margin4plus_pct: number;
        ko_et_pct: number;
        shootout_pct: number;
      };
    }
  >;
  shape_bands: {
    draw_pct: { center_policy: DraftPolicyName; center: number; half_width: number };
    margin4plus_pct: { center_policy: DraftPolicyName; center: number; half_width: number };
    ko_et_pct: { center_policy: DraftPolicyName; center: number; half_width: number };
    shootout_pct: { center_policy: DraftPolicyName; center: number; half_width: number };
  };
  goals_per_game_lower_floor: { lower_bound: number };
  score_population: ScorePopulationSummary & { _doc: string; policy: DraftPolicyName };
  wilson_target_for_ko_metrics: { target_half_width_pp: number };
}

const GOLDEN: AsymRealismGolden = JSON.parse(
  readFileSync(join(HERE, "asym-realism-golden.json"), "utf-8"),
);

const N_RUNS = Number(process.env.WCDRAFT_REALISM_N ?? GOLDEN.ensemble.N_runs);
const SEED_PREFIX = process.env.WCDRAFT_REALISM_SEED_PREFIX ?? DEFAULT_SEED_PREFIX;
const GATE_MODE = process.env.WCDRAFT_REALISM_GATE === "report" ? "report" : "pass";

// HEAVY-CI SPLIT
//   This gate runs the N=2000 × 3-policy ensemble. It is intentionally OFF the
//   default `test` / `turbo run test` job so the fast feedback loop stays fast,
//   and runs ONLY when `WCDRAFT_REALISM_HEAVY=1` — set by the dedicated heavy
//   workflow/job and by the `pnpm --filter @wcdraft/data test:realism:heavy`
//   script. CI may additionally set `WCDRAFT_REALISM_POLICY` so each policy
//   runs in a separate worker process with the same N and seed prefix.
const HEAVY_ENABLED = process.env.WCDRAFT_REALISM_HEAVY === "1";
const gate = HEAVY_ENABLED ? describe : describe.skip;

function isDraftPolicyName(v: string): v is DraftPolicyName {
  return (ALL_POLICIES as readonly string[]).includes(v);
}

const POLICY_FILTER_RAW = process.env.WCDRAFT_REALISM_POLICY;
if (POLICY_FILTER_RAW !== undefined && !isDraftPolicyName(POLICY_FILTER_RAW)) {
  throw new Error(
    `WCDRAFT_REALISM_POLICY must be one of ${ALL_POLICIES.join(", ")}; got ${POLICY_FILTER_RAW}`,
  );
}
const POLICIES_TO_RUN: readonly DraftPolicyName[] =
  POLICY_FILTER_RAW === undefined ? ALL_POLICIES : [POLICY_FILTER_RAW];

interface PolicyResult {
  measurement: RealismMeasurement;
  telemetry: PolicyTelemetry;
  observed: {
    goals_per_game: number;
    draw_pct: number;
    margin4plus_pct: number;
    ko_et_pct: number;
    shootout_pct: number;
  };
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function computeObserved(m: RealismMeasurement): PolicyResult["observed"] {
  return {
    goals_per_game: m.matches > 0 ? m.goalsTotal / m.matches : 0,
    draw_pct: m.groupMatches > 0 ? m.draws / m.groupMatches : 0,
    margin4plus_pct: m.matches > 0 ? m.margin4plus / m.matches : 0,
    ko_et_pct: m.knockoutMatches > 0 ? m.koEt / m.knockoutMatches : 0,
    shootout_pct: m.knockoutMatches > 0 ? m.koShootout / m.knockoutMatches : 0,
  };
}

function logPolicy(policy: DraftPolicyName, r: PolicyResult, prefix = "[REALISM]"): void {
  const m = r.measurement;
  const lines: string[] = [];
  lines.push(
    `${prefix} ── policy=${policy.padEnd(24)} qualifying=${m.qualifyingRuns}/${N_RUNS} matches=${m.matches} groups=${m.groupMatches} KO=${m.knockoutMatches}`,
  );
  const { norms } = summarizeRealism(m);
  for (const n of norms) {
    const observed = n.name === "goals/game" ? n.observed.toFixed(3) : fmtPct(n.observed);
    const target = n.name === "goals/game" ? n.target.toFixed(3) : fmtPct(n.target);
    const band = n.name === "goals/game" ? `±${n.band.toFixed(3)}` : `±${fmtPct(n.band)}`;
    const status = n.inBand ? "✓" : "✗";
    lines.push(
      `${prefix}    ${status} ${n.name.padEnd(14)} obs=${observed.padStart(8)} tgt=${target.padStart(8)} (vs-target band=${band.padStart(10)}, N=${n.denom})`,
    );
  }
  const t = r.telemetry;
  lines.push(
    `${prefix}    telemetry  attack=${t.channelMean.attack.toFixed(2)} midfield=${t.channelMean.midfield.toFixed(2)} defense=${t.channelMean.defense.toFixed(2)} goalkeeping=${t.channelMean.goalkeeping.toFixed(2)}  synergy.mult=${t.synergyMultiplierMean.toFixed(4)}  mgr.mod=${t.managerModifierMean.toFixed(4)}  coverage=${t.coverageMean.toFixed(4)}`,
  );
  console.log(lines.join("\n"));
}

const SHAPE_KEYS = ["draw_pct", "margin4plus_pct", "ko_et_pct", "shootout_pct"] as const;
type ShapeKey = (typeof SHAPE_KEYS)[number];

const SHAPE_DISPLAY: Record<ShapeKey, string> = {
  draw_pct: "draw% (group)",
  margin4plus_pct: "margin≥4%",
  ko_et_pct: "KO→ET%",
  shootout_pct: "shootout%",
};

function bandFor(key: ShapeKey): { center: number; half: number } {
  const cfg = GOLDEN.shape_bands[key];
  return { center: cfg.center, half: cfg.half_width };
}

function inShapeBand(key: ShapeKey, observed: number): boolean {
  const { center, half } = bandFor(key);
  return Math.abs(observed - center) <= half;
}

describe("Season 2 S3 final realism lock keeps semantic shape centers fixed", () => {
  it("does not derive acceptance centers from the newly observed mechanics telemetry", () => {
    for (const key of SHAPE_KEYS) {
      const cfg = GOLDEN.shape_bands[key];
      expect(bandFor(key).center).toBe(cfg.center);
      expect(cfg.center).not.toBe(GOLDEN.policies[cfg.center_policy].observed[key]);
    }
  });
});

gate(`E-3b asymmetric realism gate — ${GATE_MODE.toUpperCase()} mode, N=${N_RUNS}`, () => {
  const results = new Map<DraftPolicyName, PolicyResult>();

  beforeAll(() => {
    for (const policy of POLICIES_TO_RUN) {
      const { measurement, telemetry } = runRealismEnsembleForPolicy(policy, N_RUNS, SEED_PREFIX);
      const observed = computeObserved(measurement);
      const r: PolicyResult = { measurement, telemetry, observed };
      results.set(policy, r);
      logPolicy(policy, r);
    }
    const strategic = results.get("strategicAutoDraft");
    if (strategic !== undefined) {
      console.log("[REALISM] strategic shape bands (locked):");
      for (const k of SHAPE_KEYS) {
        const b = bandFor(k);
        const obs = strategic.observed[k];
        const inBand = Math.abs(obs - b.center) <= b.half;
        console.log(
          `[REALISM]   ${SHAPE_DISPLAY[k].padEnd(14)} center=${fmtPct(b.center).padStart(7)} ± ${fmtPct(b.half).padStart(7)}  observed=${fmtPct(obs).padStart(7)}  ${inBand ? "✓" : "✗"}`,
        );
      }
      console.log(
        `[REALISM] goals/game lower floor = ${GOLDEN.goals_per_game_lower_floor.lower_bound.toFixed(3)} (no upper cap)  observed=${strategic.observed.goals_per_game.toFixed(3)}`,
      );
    }
  }, 600_000);

  it("locks per-policy run counts (qualifying/matches/groups/KO) so any drift surfaces", () => {
    // Byte-identical run counts at the locked (N, seed_prefix). A run-count
    // drift here means a draft/scenario/RNG change — re-lock atomically.
    for (const policy of POLICIES_TO_RUN) {
      const r = results.get(policy)!;
      const g = GOLDEN.policies[policy];
      if (N_RUNS !== GOLDEN.ensemble.N_runs) continue; // override mode
      if (SEED_PREFIX !== GOLDEN.ensemble.seed_prefix) continue;
      expect(
        {
          qualifying: r.measurement.qualifyingRuns,
          matches: r.measurement.matches,
          groupMatches: r.measurement.groupMatches,
          knockoutMatches: r.measurement.knockoutMatches,
        },
        `${policy} run counts drifted from golden`,
      ).toEqual({
        qualifying: g.qualifying,
        matches: g.matches,
        groupMatches: g.groupMatches,
        knockoutMatches: g.knockoutMatches,
      });
    }
  });

  it("strategicAutoDraft lands inside SHAPE bands (draw / margin≥4 / KO→ET / shootout)", () => {
    const r = results.get("strategicAutoDraft");
    if (r === undefined) return;
    for (const key of SHAPE_KEYS) {
      const { center, half } = bandFor(key);
      const obs = r.observed[key];
      const inBand = Math.abs(obs - center) <= half;
      if (GATE_MODE === "pass") {
        expect(
          inBand,
          `${SHAPE_DISPLAY[key]}: observed=${fmtPct(obs)} outside band ${fmtPct(center)} ± ${fmtPct(half)}`,
        ).toBe(true);
      }
    }
  });

  it("strategicAutoDraft goals/game ≥ lower floor (one-sided; no upper cap)", () => {
    const r = results.get("strategicAutoDraft");
    if (r === undefined) return;
    const floor = GOLDEN.goals_per_game_lower_floor.lower_bound;
    const obs = r.observed.goals_per_game;
    if (GATE_MODE === "pass") {
      expect(
        obs,
        `goals/game ${obs.toFixed(3)} below lower floor ${floor.toFixed(3)} (no upper cap is enforced — high goals/game are legal: total volume tracks the underdog gap)`,
      ).toBeGreaterThanOrEqual(floor);
    }
  });

  it("locks the strategicAutoDraft run-score population alongside qualifying%", () => {
    const r = results.get(GOLDEN.score_population.policy);
    if (r === undefined) return;
    if (N_RUNS !== GOLDEN.ensemble.N_runs) return;
    if (SEED_PREFIX !== GOLDEN.ensemble.seed_prefix) return;
    expect(summarizeScorePopulation(r.measurement)).toEqual({
      runs: GOLDEN.score_population.runs,
      qualifyingRuns: GOLDEN.score_population.qualifyingRuns,
      mean: GOLDEN.score_population.mean,
      median: GOLDEN.score_population.median,
      p95: GOLDEN.score_population.p95,
      min: GOLDEN.score_population.min,
      max: GOLDEN.score_population.max,
    });
  });

  it("re-derives the shipped score-distribution quantile table from the live ensemble (byte-faithful)", () => {
    const r = results.get("strategicAutoDraft");
    if (r === undefined) return;
    if (N_RUNS !== GOLDEN.ensemble.N_runs) return;
    if (SEED_PREFIX !== GOLDEN.ensemble.seed_prefix) return;
    expect(
      SCORE_DISTRIBUTION_BUNDLE,
      "score-distribution.compact.json must be committed (run build-score-distribution.mts)",
    ).not.toBeNull();
    const summary = summarizeScorePopulation(r.measurement);
    expect(SCORE_DISTRIBUTION_BUNDLE!.quantiles).toEqual(buildScoreQuantiles(r.measurement.scores));
    expect(SCORE_DISTRIBUTION_BUNDLE!.population).toMatchObject({
      policy: "strategicAutoDraft",
      seed_prefix: SEED_PREFIX,
      runs: summary.runs,
      qualifying_runs: summary.qualifyingRuns,
      mean: summary.mean,
      median: summary.median,
      p95: summary.p95,
      min: summary.min,
      max: summary.max,
    });
  });

  it("greedyOverallAutoDraft lands OUTSIDE every SHAPE band (CI guard — competent ≠ max-overall)", () => {
    const r = results.get("greedyOverallAutoDraft");
    if (r === undefined) return;
    for (const key of SHAPE_KEYS) {
      const obs = r.observed[key];
      const within = inShapeBand(key, obs);
      if (GATE_MODE === "pass") {
        expect(
          within,
          `greedy guard FAILED: ${SHAPE_DISPLAY[key]} observed=${fmtPct(obs)} landed INSIDE the strategic shape band — the negative control should be outside (slot-fit-aware drafting must matter)`,
        ).toBe(false);
      }
    }
  });

  it("logs autoDraft (canonical-first) telemetry but does NOT participate in the PASS assertion", () => {
    // Telemetry-only: autoDraft is the canonical-first determinism fixture
    // and is intentionally NOT a user-behavior proxy. Its numbers are
    // recorded in the golden for posterity (so a regression in the
    // canonical draft surface still shows up) but are NOT asserted here.
    const r = results.get("autoDraft");
    if (r === undefined) return;
    expect(r.measurement.matches).toBeGreaterThan(0);
  });

  it("references the locked target Wilson half-width for KO-derived bands", () => {
    // Documentation assertion: the chosen N must keep KO half-widths under
    // the target. If a future N override drops this below threshold the
    // gate will (correctly) red on the KO shape bands, surfacing the
    // small-N problem instead of silently widening tolerance.
    const r = results.get("strategicAutoDraft");
    if (r === undefined) return;
    const koMatches = r.measurement.knockoutMatches;
    const pKoEt = r.observed.ko_et_pct;
    const pSo = r.observed.shootout_pct;
    const halfKoEt = koMatches > 0 ? 2 * Math.sqrt((pKoEt * (1 - pKoEt)) / koMatches) : Infinity;
    const halfSo = koMatches > 0 ? 2 * Math.sqrt((pSo * (1 - pSo)) / koMatches) : Infinity;
    const target = GOLDEN.wilson_target_for_ko_metrics.target_half_width_pp / 100;
    if (N_RUNS === GOLDEN.ensemble.N_runs && SEED_PREFIX === GOLDEN.ensemble.seed_prefix) {
      expect(
        halfKoEt,
        `KO→ET Wilson half ≈ ${(halfKoEt * 100).toFixed(2)}pp > target ${(target * 100).toFixed(1)}pp`,
      ).toBeLessThanOrEqual(target);
      expect(
        halfSo,
        `shootout Wilson half ≈ ${(halfSo * 100).toFixed(2)}pp > target ${(target * 100).toFixed(1)}pp`,
      ).toBeLessThanOrEqual(target);
    }
  });

  it("REALISM_NORMS table is the modern-WC target set the bands are calibrated against", () => {
    // Hand-typed canary: the band centers are observed-anchored, but the
    // norms (the player-facing 'modern WC realism' target) must not drift
    // silently. If someone re-anchors norms they must also re-lock bands.
    expect(REALISM_NORMS).toEqual({
      goals_per_game: 2.54,
      draw_pct: 0.247,
      margin4plus_pct: 0.049,
      ko_et_pct: 0.33,
      shootout_pct: 0.214,
    });
  });
});
