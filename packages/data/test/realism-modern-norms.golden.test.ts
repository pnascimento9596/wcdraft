// Realism control — SYMMETRIC nation-XI vs nation-XI sweep against modern-era
// (1998-2022) WC norms computed from the pinned upstream
// (github.com/jfjelstul/worldcup @ f41e9437). The fixture
// `test/fixtures/modern-wc-norms.json` carries those norms verbatim.
//
// DETERMINISM CONTRACT
//   • All RNG comes from `createRng` with explicit fixed seeds.
//   • Pair iteration order is fixed (canonical team_id sort).
//   • Sample sizes are pinned (2,256 group + 750 knockout matches).
//   • A fixed-input → byte-identical-output test would be 6,071 lines of
//     scoreboard if literally encoded; we lock the AGGREGATE metrics instead.
//
// CALIBRATION CONTRACT
//   Each metric is checked against a two-sided tolerance from the modern-era
//   norm. The tolerance reflects sample-size noise (binomial std error) PLUS
//   the structural gap between a symmetric coherent-XI sweep and a real-WC
//   sample (mixed group seeding, knockout bracket dynamics). The pinned bands
//   make the gap CONSTANT and committed — never re-introduced silently.
//
// SCOPE
//   This is the realism gate the reviewer asked for: it executes in CI on
//   every PR, so any future λ / channel / aggregate change is forced to keep
//   the symmetric control in band or land a justified band update.

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRng } from "@wcdraft/core";
import { simulateMatchCore, membersFromTeam2026 } from "@wcdraft/core";
import { SCENARIO_2026_BUNDLE } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const NORMS = JSON.parse(
  readFileSync(join(HERE, "fixtures", "modern-wc-norms.json"), "utf-8"),
) as {
  era: string;
  upstream_commit: string;
  matches_total: number;
  mean_goals_per_match_regulation: number;
  group_stage_draw_rate: number;
  regulation_margin_ge_4: number;
  knockout_extra_time_rate: number;
  knockout_shootout_rate: number;
};

const GROUP_MATCHES = 2256;
const KO_MATCHES = 750;

// D5-TIGHT BANDS — committed in the E-3a refit. Each band is the modern-era
// WC norm ± 2·sqrt(p(1-p)/N) (binomial sample-noise std-err × 2) at the
// sample sizes USED IN THIS HARNESS (group N=2256, KO N=750, total N=3006
// for `mean_goals` and `margin ≥ 4`). The previous loose bands were a
// structural placeholder; the refit (BASE/SPREAD/W_DEF/γ_mid + KO_LAMBDA_FACTOR
// + per-phase λ dispersion in `calibration.ts`) lands all 5 metrics
// STRICTLY INSIDE these tight bands, so any future engine drift that moves
// a metric outside ANY tight band fails CI — the realism gate is no longer
// toothless.
//
// HOW THE PHASE SPLIT MAKES BOTH `group_draw` (24.7%) AND `KO → ET` (33%)
// ACHIEVABLE on the SAME team pool: the modern-era norms encode that real
// WC group matches and KO matches come from DIFFERENT populations (group
// includes weak vs strong; KO is between qualifying teams) — the engine
// mirrors that two-population reality via (a) `LAMBDA.KO_LAMBDA_FACTOR`
// (KO regulation goals run lower than group) and (b) phase-specific
// dispersion in `LAMBDA_DISP` (KO uses larger A; group uses smaller A only
// to lift `margin ≥ 4` into band). See `calibration.ts:LAMBDA_DISP` for
// the full contract and SIM_CALIBRATION.md for the landing report.
const BANDS = {
  mean_goals:  { lo: 2.478,  hi: 2.594  }, // norm 2.54   ± ~0.058 (N=3006)
  group_draw:  { lo: 0.2288, hi: 0.2652 }, // norm 0.247  ± 0.0182 (N=2256)
  margin_ge_4: { lo: 0.0412, hi: 0.0570 }, // norm 0.049  ± 0.0079 (N=3006)
  ko_et:       { lo: 0.2961, hi: 0.3648 }, // norm 0.330  ± 0.0343 (N=750)
  ko_shootout: { lo: 0.1843, hi: 0.2443 }, // norm 0.214  ± 0.0299 (N=750)
} as const;

const teams = [...SCENARIO_2026_BUNDLE.teams].sort((a, b) =>
  a.team_id < b.team_id ? -1 : a.team_id > b.team_id ? 1 : 0,
);
const N = teams.length;

function runOne(homeIdx: number, awayIdx: number, n: number, round: "G1" | "R32") {
  const home = teams[homeIdx]!;
  const away = teams[awayIdx]!;
  const seed = `wcdraft:realism:${round}:${homeIdx}-${awayIdx}-${n}`;
  const structRng = createRng(seed);
  const eventRng = createRng(`${seed}:event`);
  return simulateMatchCore({
    matchId: `realism.${homeIdx}-${awayIdx}.${round}.${n}`,
    matchIndex: n,
    round,
    phase: round === "R32" ? "knockout" : "group",
    opponentTeamId: away.team_id,
    userMembers: membersFromTeam2026(home, "user"),
    oppMembers: membersFromTeam2026(away, "opp"),
    userStrength: home.aggregate_rating,
    oppStrength: away.aggregate_rating,
    structRng,
    eventRng,
  });
}

function sweep() {
  let groupMatches = 0,
    groupDraws = 0,
    koMatches = 0,
    koToEt = 0,
    koToShootout = 0,
    totalRegGoals = 0,
    blowoutCount4 = 0,
    totalMatches = 0;
  // Group sweep
  let n = 0;
  outerG: for (let h = 0; h < N; h++) {
    for (let a = 0; a < N; a++) {
      if (a === h) continue;
      const m = runOne(h, a, n++, "G1");
      const h_g = m.user_goals;
      const a_g = m.opp_goals;
      groupMatches += 1;
      totalMatches += 1;
      totalRegGoals += h_g + a_g;
      if (h_g === a_g) groupDraws += 1;
      if (Math.abs(h_g - a_g) >= 4) blowoutCount4 += 1;
      if (groupMatches >= GROUP_MATCHES) break outerG;
    }
  }
  // KO sweep
  let nk = 0;
  outerK: for (let h = 0; h < N; h++) {
    for (let a = 0; a < N; a++) {
      if (a === h) continue;
      const m = runOne(h, a, nk++, "R32");
      koMatches += 1;
      totalMatches += 1;
      const reg_h = m.user_goals;
      const reg_a = m.opp_goals;
      totalRegGoals += reg_h + reg_a;
      const et_h = m.user_goals_et ?? 0;
      const et_a = m.opp_goals_et ?? 0;
      if (m.user_goals_et !== null) koToEt += 1;
      if (m.shootout !== null) koToShootout += 1;
      const totalMargin = Math.abs(reg_h + et_h - (reg_a + et_a));
      if (totalMargin >= 4) blowoutCount4 += 1;
      if (koMatches >= KO_MATCHES) break outerK;
    }
  }
  return {
    matches: totalMatches,
    mean_goals: totalRegGoals / totalMatches,
    group_draw: groupDraws / groupMatches,
    margin_ge_4: blowoutCount4 / totalMatches,
    ko_et: koToEt / koMatches,
    ko_shootout: koToShootout / koMatches,
  };
}

describe(`realism (symmetric coherent-XI sweep) vs modern-era WC norms — ${NORMS.era}`, () => {
  let m: ReturnType<typeof sweep>;
  beforeAll(() => {
    const t0 = Date.now();
    m = sweep();
    const dt = Date.now() - t0;
    const fmt = (v: number, n: number) => (v >= 0 ? "+" : "") + v.toFixed(n);
    const dGoals = m.mean_goals - NORMS.mean_goals_per_match_regulation;
    const dDraw = m.group_draw - NORMS.group_stage_draw_rate;
    const dM4 = m.margin_ge_4 - NORMS.regulation_margin_ge_4;
    const dEt = m.ko_et - NORMS.knockout_extra_time_rate;
    const dSo = m.ko_shootout - NORMS.knockout_shootout_rate;
    // Per-metric Δ (value − norm) — committed signal so reviewers see drift
    // explicitly, not just band pass/fail. Stderr surfaces it in the test
    // reporter; the per-metric it() titles below carry the same numbers in
    // human-readable form.
    process.stderr.write(
      `\n  REALISM SWEEP (${dt}ms, ${m.matches} matches) — value (Δ from modern WC norm):\n` +
      `    mean_goals      = ${m.mean_goals.toFixed(3)}   (${fmt(dGoals, 3)} vs norm ${NORMS.mean_goals_per_match_regulation.toFixed(2)})\n` +
      `    group_draw      = ${(100 * m.group_draw).toFixed(2)}%  (${fmt(100 * dDraw, 2)}pp vs norm ${(100 * NORMS.group_stage_draw_rate).toFixed(1)}%)\n` +
      `    margin_ge_4     = ${(100 * m.margin_ge_4).toFixed(2)}%  (${fmt(100 * dM4, 2)}pp vs norm ${(100 * NORMS.regulation_margin_ge_4).toFixed(1)}%)\n` +
      `    ko_et           = ${(100 * m.ko_et).toFixed(2)}%  (${fmt(100 * dEt, 2)}pp vs norm ${(100 * NORMS.knockout_extra_time_rate).toFixed(1)}%)\n` +
      `    ko_shootout     = ${(100 * m.ko_shootout).toFixed(2)}%  (${fmt(100 * dSo, 2)}pp vs norm ${(100 * NORMS.knockout_shootout_rate).toFixed(1)}%)\n`,
    );
  });

  // Each it() title shows VALUE, Δ from norm, and the test band — so a reader
  // can read the drift without expanding the test report. The committed
  // Δ values reflect the merit-v4 λ refit landing on the national-strength /
  // objective-club 2026 pool under engine-2026.06.13-merit-v4.
  it(`mean goals/match: 2.543 (Δ +0.008 vs norm 2.54, merit-v4 refit) — tight band [${BANDS.mean_goals.lo}, ${BANDS.mean_goals.hi}]`, () => {
    const delta = m.mean_goals - NORMS.mean_goals_per_match_regulation;
    expect(m.mean_goals).toBeGreaterThanOrEqual(BANDS.mean_goals.lo);
    expect(m.mean_goals).toBeLessThanOrEqual(BANDS.mean_goals.hi);
    // Sanity-cap the drift from the documented landing — anyone moving the
    // engine that pushes this by > 0.10 (≈ 2× the tight half-width) must
    // explicitly update both the committed Δ landing and the bands.
    expect(Math.abs(delta)).toBeLessThan(0.10);
  });

  it(`group draw rate: 24.82% (Δ +0.12pp vs norm 24.7%, merit-v4 refit) — tight band [${(100 * BANDS.group_draw.lo).toFixed(2)}%, ${(100 * BANDS.group_draw.hi).toFixed(2)}%]`, () => {
    const delta = m.group_draw - NORMS.group_stage_draw_rate;
    expect(m.group_draw).toBeGreaterThanOrEqual(BANDS.group_draw.lo);
    expect(m.group_draw).toBeLessThanOrEqual(BANDS.group_draw.hi);
    expect(Math.abs(delta)).toBeLessThan(0.025);
  });

  it(`margin ≥ 4: 4.86% (Δ −0.05pp vs norm 4.9%, merit-v4 refit — phase-split DISP) — tight band [${(100 * BANDS.margin_ge_4.lo).toFixed(2)}%, ${(100 * BANDS.margin_ge_4.hi).toFixed(2)}%]`, () => {
    const delta = m.margin_ge_4 - NORMS.regulation_margin_ge_4;
    expect(m.margin_ge_4).toBeGreaterThanOrEqual(BANDS.margin_ge_4.lo);
    expect(m.margin_ge_4).toBeLessThanOrEqual(BANDS.margin_ge_4.hi);
    expect(Math.abs(delta)).toBeLessThan(0.015);
  });

  it(`KO → ET: 34.00% (Δ +0.96pp vs norm 33.0%, merit-v4 refit) — tight band [${(100 * BANDS.ko_et.lo).toFixed(2)}%, ${(100 * BANDS.ko_et.hi).toFixed(2)}%]`, () => {
    const delta = m.ko_et - NORMS.knockout_extra_time_rate;
    expect(m.ko_et).toBeGreaterThanOrEqual(BANDS.ko_et.lo);
    expect(m.ko_et).toBeLessThanOrEqual(BANDS.ko_et.hi);
    expect(Math.abs(delta)).toBeLessThan(0.05);
  });

  it(`KO → shootout: 21.20% (Δ −0.23pp vs norm 21.4%, merit-v4 refit) — tight band [${(100 * BANDS.ko_shootout.lo).toFixed(2)}%, ${(100 * BANDS.ko_shootout.hi).toFixed(2)}%]`, () => {
    const delta = m.ko_shootout - NORMS.knockout_shootout_rate;
    expect(m.ko_shootout).toBeGreaterThanOrEqual(BANDS.ko_shootout.lo);
    expect(m.ko_shootout).toBeLessThanOrEqual(BANDS.ko_shootout.hi);
    expect(Math.abs(delta)).toBeLessThan(0.05);
  });
});
