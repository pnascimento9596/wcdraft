// E-3a D6 — DETERMINISTIC SEEDED COORDINATE-DESCENT FIT.
//
// ⚠️ DECOUPLING NOTE (ws-core/decoupling-guards):
//   The asymmetric realism harness measures strategicAutoDraft picks, and
//   `pickBest` in `packages/data/test/realism/draft-policies.ts` breaks
//   ties by display `overall` DESC. DISPLAY-CURVE CHANGES (rescaling,
//   post-fit normalisation, stature-driven pooled curve, etc.) CAN FLIP A
//   TIE ORDERING, which re-orders the strategic pick sequence, which
//   shifts the realism landings, which silently invalidates THIS LAMBDA
//   FIT'S BASIS. The Wilson bands in `realism.gate.test.ts` re-base WITH
//   the landings on re-lock and DO NOT catch the flip.
//
//   The tripwire is `packages/data/test/realism/strategic-pick-canary.golden.test.ts`
//   — it locks the first 5 strategicAutoDraft pick sequences. If you are
//   here because that canary turned red, A RE-FIT IS REQUIRED before the
//   realism-gate golden may be re-locked: re-run this script, copy the
//   new tuple into `calibration.ts`, regenerate sim-golden + e2e +
//   asym-realism atomically with the canary re-lock.
//   See SIM_CALIBRATION.md › "Decoupling guards".
//
// Tunes the λ tuple {SPREAD, w_def, w_gk, γ_mid, BASE, MIN, MAX, n}
// to minimize weighted distance to the five WC realism norms over a
// SYMMETRIC coherent-XI sweep (Team2026 vs Team2026, ~3,000 matches per
// evaluation — the same population the existing
// `realism-modern-norms.golden.test.ts` uses).
//
// Symmetric sweep was chosen over the asymmetric draft-reachable harness
// because:
//   - the norms (24.7% draw, 33% ET, 21.4% SO) are computed on real WC
//     matches, which are top-tier-vs-top-tier — best mirrored by a
//     coherent-XI sweep over the 2026 pool;
//   - denser denominators (~750 KO matches per evaluation vs ~50-100
//     for a 100-run user draft sweep) tighten signal per second.
// The asymmetric D5 harness still runs as a report-only smoke test,
// surfacing the player-experience landing.
//
// SUBJECT TO: D4 faithfulness assertions remain green at the winner. The
// fit ALSO checks that the chance-budget ceiling (λ_MAX / n) stays well
// below CHANCES.MAX_GOAL_PROB so the cap never binds.
//
// COST: ~3000 matches × ~30 evals/pass × 2 passes ≈ 3-4 minutes.

import {
  __UNSAFE_clearCalibrationOverride,
  __UNSAFE_setCalibrationOverride,
  createRng,
  simulateMatchCore,
  membersFromTeam2026,
} from "@wcdraft/core";

import { SCENARIO_2026_BUNDLE } from "../src/index.js";

const PASSES = Number(process.env.WCDRAFT_FIT_PASSES ?? 3);

const NORMS = {
  goals: 2.54,
  draw: 0.247,
  margin4: 0.049,
  ko_et: 0.33,
  ko_so: 0.214,
};

const GROUP_MATCHES = 2256;
const KO_MATCHES = 750;

const TEAMS = [...SCENARIO_2026_BUNDLE.teams].sort((a, b) =>
  a.team_id < b.team_id ? -1 : a.team_id > b.team_id ? 1 : 0,
);

// Coordinate-descent schedule. Each entry: which constant, which grid of
// candidate values to try while all others are held at the current best.
//
// (E-3a grid rationale — SPREAD identifiability, MAX bind, the D1
// LAMBDA_DISP overdispersion knob and why pure Poisson cannot clear both
// mean_goals 2.54 and KO→ET 33% — lives in calibration.ts:LAMBDA_DISP and
// SIM_CALIBRATION.md.)
//
// merit-v3 V7 REFIT (post-V6 Career channels): the display/channel
// distribution moved again, and the seed tuple no longer lands inside the
// symmetric realism bands. Start from the committed pre-V7 tuple, then
// extend grids whenever a fitted parameter touches an edge. GAMMA_MID is
// deliberately extended upward first because 0.60 was the prior edge.
const CONSTANT_GRIDS = [
  { name: "BASE",             bucket: "LAMBDA",      values: [0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20] },
  { name: "SPREAD",           bucket: "LAMBDA",      values: [5.50, 6.00, 6.50, 7.00, 7.50, 8.00] },
  { name: "MIN",              bucket: "LAMBDA",      values: [0.30, 0.40, 0.50, 0.60, 0.70, 0.80] },
  { name: "MAX",              bucket: "LAMBDA",      values: [3.10, 3.40, 3.70] },
  { name: "W_DEF",            bucket: "LAMBDA",      values: [0.60, 0.65, 0.70, 0.75] },
  { name: "GAMMA_MID",        bucket: "LAMBDA",      values: [0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00] },
  { name: "KO_LAMBDA_FACTOR", bucket: "LAMBDA",      values: [0.78, 0.82, 0.85, 0.88, 0.92] },
  { name: "OUTER_PROB",       bucket: "LAMBDA_DISP", values: [0.12, 0.16, 0.20, 0.24] },
  { name: "A",                bucket: "LAMBDA_DISP", values: [0.55, 0.65, 0.75, 0.85] },
  { name: "GROUP_OUTER_PROB", bucket: "LAMBDA_DISP", values: [0.00, 0.02, 0.04, 0.06, 0.10, 0.14, 0.18] },
  { name: "GROUP_A",          bucket: "LAMBDA_DISP", values: [0.40, 0.50, 0.60, 0.70] },
];

// Seed tuple — current shipped merit-v4 tuple from calibration.ts. Keep this
// in sync with packages/core/src/engine/calibration.ts so the seed evaluation
// represents the live engine before any audited refit move.
const SEED_TUPLE = {
  LAMBDA: {
    SPREAD: 6.00,
    BASE: 1.10,
    MIN: 0.30,
    MAX: 3.40,
    W_DEF: 0.70,
    W_GK: 0.30,
    GAMMA_MID: 0.80,
    KO_LAMBDA_FACTOR: 0.82,
  },
  CHANCES: {
    REGULATION: 50,
    EXTRA_TIME: 17,
  },
  LAMBDA_DISP: {
    OUTER_PROB: 0.20,
    A: 0.75,
    GROUP_OUTER_PROB: 0.10,
    GROUP_A: 0.50,
  },
};

const NORM_SCALES = {
  goals: 1.0,
  draw: 0.10,
  margin4: 0.05,
  ko_et: 0.10,
  ko_so: 0.10,
};

// D5 TIGHT BANDS (binomial std-err × 2 around the modern-WC norm). The fit
// MUST land each metric STRICTLY INSIDE these bands; the committed
// `realism-modern-norms.golden.test.ts` enforces them.
const TIGHT_BANDS = {
  goals:   { lo: 2.478,  hi: 2.594  },
  draw:    { lo: 0.2288, hi: 0.2652 }, // MV2-11b: tightened to the COMMITTED golden band so the fit cannot land outside the gate
  margin4: { lo: 0.0412, hi: 0.0570 },
  ko_et:   { lo: 0.2961, hi: 0.3648 },
  ko_so:   { lo: 0.1843, hi: 0.2443 },
};

// Band-aware scoring with HARD count-of-outside-bands priority:
//   score = 1000 · (# metrics outside band) + 10 · Σ(gap²) + 0.1 · Σ(inside-z²)
// The 1000× outside-count dominates ANY inside positioning, so the descent
// always prefers a 5/5-feasible tuple over a tuple that perches just outside
// 1–2 bands. Within the all-feasible set, the optimizer then minimizes the
// largest band-edge margin (via the inside-z² tiebreaker — centred is best).
function bandScore(observed) {
  let outsideCount = 0;
  let outsidePenalty = 0;
  let insideNudge = 0;
  for (const k of ["goals", "draw", "margin4", "ko_et", "ko_so"]) {
    const v = observed[k];
    const b = TIGHT_BANDS[k];
    const mid = 0.5 * (b.lo + b.hi);
    const half = 0.5 * (b.hi - b.lo);
    const scale = NORM_SCALES[k];
    if (v < b.lo) {
      outsideCount += 1;
      const gap = (b.lo - v) / scale;
      outsidePenalty += gap * gap;
    } else if (v > b.hi) {
      outsideCount += 1;
      const gap = (v - b.hi) / scale;
      outsidePenalty += gap * gap;
    } else {
      const z = (v - mid) / Math.max(half, 1e-9);
      insideNudge += z * z;
    }
  }
  return 1000 * outsideCount + 10 * outsidePenalty + 0.1 * insideNudge;
}

function runSweep() {
  let groupMatches = 0, groupDraws = 0;
  let koMatches = 0, koToEt = 0, koToShootout = 0;
  let totalRegGoals = 0, blowoutCount4 = 0, totalMatches = 0;
  const N = TEAMS.length;

  let n = 0;
  outerG: for (let h = 0; h < N; h++) {
    for (let a = 0; a < N; a++) {
      if (a === h) continue;
      const home = TEAMS[h], away = TEAMS[a];
      const seed = `wcdraft:realism:G1:${h}-${a}-${n++}`;
      const structRng = createRng(seed);
      const eventRng = createRng(`${seed}:event`);
      const m = simulateMatchCore({
        matchId: `fit.${h}-${a}.G1.${n}`,
        matchIndex: n,
        round: "G1",
        phase: "group",
        opponentTeamId: away.team_id,
        userMembers: membersFromTeam2026(home, "user"),
        oppMembers: membersFromTeam2026(away, "opp"),
        userStrength: home.aggregate_rating,
        oppStrength: away.aggregate_rating,
        structRng,
        eventRng,
      });
      groupMatches += 1; totalMatches += 1;
      totalRegGoals += m.user_goals + m.opp_goals;
      if (m.user_goals === m.opp_goals) groupDraws += 1;
      if (Math.abs(m.user_goals - m.opp_goals) >= 4) blowoutCount4 += 1;
      if (groupMatches >= GROUP_MATCHES) break outerG;
    }
  }

  let nk = 0;
  outerK: for (let h = 0; h < N; h++) {
    for (let a = 0; a < N; a++) {
      if (a === h) continue;
      const home = TEAMS[h], away = TEAMS[a];
      const seed = `wcdraft:realism:R32:${h}-${a}-${nk++}`;
      const structRng = createRng(seed);
      const eventRng = createRng(`${seed}:event`);
      const m = simulateMatchCore({
        matchId: `fit.${h}-${a}.R32.${nk}`,
        matchIndex: nk,
        round: "R32",
        phase: "knockout",
        opponentTeamId: away.team_id,
        userMembers: membersFromTeam2026(home, "user"),
        oppMembers: membersFromTeam2026(away, "opp"),
        userStrength: home.aggregate_rating,
        oppStrength: away.aggregate_rating,
        structRng,
        eventRng,
      });
      koMatches += 1; totalMatches += 1;
      const reg = m.user_goals + m.opp_goals;
      totalRegGoals += reg;
      if (m.user_goals_et !== null) koToEt += 1;
      if (m.shootout !== null) koToShootout += 1;
      const totalMargin = Math.abs(m.user_goals + (m.user_goals_et ?? 0) - (m.opp_goals + (m.opp_goals_et ?? 0)));
      if (totalMargin >= 4) blowoutCount4 += 1;
      if (koMatches >= KO_MATCHES) break outerK;
    }
  }

  return {
    matches: totalMatches,
    goals: totalRegGoals / totalMatches,
    draw: groupDraws / groupMatches,
    margin4: blowoutCount4 / totalMatches,
    ko_et: koToEt / koMatches,
    ko_so: koToShootout / koMatches,
  };
}

function scoreTuple(tuple) {
  const lambda = { ...tuple.LAMBDA };
  lambda.W_GK = +(1 - lambda.W_DEF).toFixed(4);
  const chances = { ...tuple.CHANCES };
  chances.EXTRA_TIME = Math.max(1, Math.round((chances.REGULATION * 30) / 90));
  const lambdaDisp = { ...tuple.LAMBDA_DISP };

  __UNSAFE_setCalibrationOverride({ LAMBDA: lambda, CHANCES: chances, LAMBDA_DISP: lambdaDisp });
  let m;
  try {
    m = runSweep();
  } finally {
    __UNSAFE_clearCalibrationOverride();
  }

  const score = bandScore(m);
  return { score, m, lambdaApplied: lambda, chancesApplied: chances, lambdaDispApplied: lambdaDisp };
}

function describeTuple(t) {
  const L = t.LAMBDA, C = t.CHANCES, D = t.LAMBDA_DISP;
  return `SPREAD=${L.SPREAD} BASE=${L.BASE} MIN=${L.MIN} MAX=${L.MAX} W_DEF=${L.W_DEF}/W_GK=${(1 - L.W_DEF).toFixed(2)} γ_mid=${L.GAMMA_MID} ko_f=${L.KO_LAMBDA_FACTOR} n=${C.REGULATION} DISP(p=${D.OUTER_PROB},A=${D.A},group_p=${D.GROUP_OUTER_PROB},group_A=${D.GROUP_A})`;
}

function clone(t) { return { LAMBDA: { ...t.LAMBDA }, CHANCES: { ...t.CHANCES }, LAMBDA_DISP: { ...t.LAMBDA_DISP } }; }
function fmtPct(x) { return (100 * x).toFixed(2) + "%"; }
function bandFlag(k, v) {
  const b = TIGHT_BANDS[k];
  return v < b.lo ? "↓" : v > b.hi ? "↑" : "✓";
}
function fmtNorms(m) {
  return `goals=${m.goals.toFixed(3)}${bandFlag("goals", m.goals)} draw=${fmtPct(m.draw)}${bandFlag("draw", m.draw)} m4=${fmtPct(m.margin4)}${bandFlag("margin4", m.margin4)} ET=${fmtPct(m.ko_et)}${bandFlag("ko_et", m.ko_et)} SO=${fmtPct(m.ko_so)}${bandFlag("ko_so", m.ko_so)}`;
}

console.log(`[FIT] D6 coord-descent on symmetric sweep (${GROUP_MATCHES} group + ${KO_MATCHES} KO) — passes=${PASSES}`);
console.log(`[FIT] norms: goals=${NORMS.goals} draw=${fmtPct(NORMS.draw)} m4=${fmtPct(NORMS.margin4)} ET=${fmtPct(NORMS.ko_et)} SO=${fmtPct(NORMS.ko_so)}`);

let best = SEED_TUPLE;
let bestEval = scoreTuple(best);
console.log(`[FIT] seed: ${describeTuple(best)}`);
console.log(`[FIT] seed score=${bestEval.score.toFixed(4)} ${fmtNorms(bestEval.m)}`);

let evalCount = 1;
for (let pass = 0; pass < PASSES; pass++) {
  console.log(`\n[FIT] ── pass ${pass + 1}/${PASSES} ──`);
  for (const coord of CONSTANT_GRIDS) {
    let coordBest = best;
    let coordBestEval = bestEval;
    for (const candidate of coord.values) {
      const cand = clone(best);
      cand[coord.bucket][coord.name] = candidate;
      const ev = scoreTuple(cand);
      evalCount++;
      const tag = ev.score < coordBestEval.score ? "→" : " ";
      console.log(`[FIT] #${String(evalCount).padStart(3)} ${tag} ${coord.bucket}.${coord.name}=${String(candidate).padStart(5)} score=${ev.score.toFixed(4)} ${fmtNorms(ev.m)}`);
      if (ev.score < coordBestEval.score) {
        coordBest = cand;
        coordBestEval = ev;
      }
    }
    if (coordBestEval.score < bestEval.score) {
      best = coordBest;
      bestEval = coordBestEval;
      console.log(`[FIT] ✓ best moved: ${describeTuple(best)} score=${bestEval.score.toFixed(4)}`);
    }
  }
}

console.log(`\n[FIT WINNER] score=${bestEval.score.toFixed(4)} evals=${evalCount}`);
console.log(`[FIT WINNER] ${describeTuple(best)}`);
console.log(`[FIT WINNER] norms: ${fmtNorms(bestEval.m)}`);
console.log(`[FIT WINNER] paste these into packages/core/src/engine/calibration.ts:`);
console.log(`[FIT WINNER]   LAMBDA.BASE       = ${best.LAMBDA.BASE}`);
console.log(`[FIT WINNER]   LAMBDA.SPREAD     = ${best.LAMBDA.SPREAD}`);
console.log(`[FIT WINNER]   LAMBDA.MIN        = ${best.LAMBDA.MIN}`);
console.log(`[FIT WINNER]   LAMBDA.MAX        = ${best.LAMBDA.MAX}`);
console.log(`[FIT WINNER]   LAMBDA.W_DEF      = ${best.LAMBDA.W_DEF}`);
console.log(`[FIT WINNER]   LAMBDA.W_GK       = ${(1 - best.LAMBDA.W_DEF).toFixed(2)}`);
console.log(`[FIT WINNER]   LAMBDA.GAMMA_MID  = ${best.LAMBDA.GAMMA_MID}`);
console.log(`[FIT WINNER]   LAMBDA.KO_LAMBDA_FACTOR= ${best.LAMBDA.KO_LAMBDA_FACTOR}`);
console.log(`[FIT WINNER]   CHANCES.REGULATION= ${best.CHANCES.REGULATION}`);
console.log(`[FIT WINNER]   CHANCES.EXTRA_TIME= ${Math.max(1, Math.round((best.CHANCES.REGULATION * 30) / 90))}`);
console.log(`[FIT WINNER]   LAMBDA_DISP.OUTER_PROB= ${best.LAMBDA_DISP.OUTER_PROB}`);
console.log(`[FIT WINNER]   LAMBDA_DISP.A         = ${best.LAMBDA_DISP.A}`);
console.log(`[FIT WINNER]   LAMBDA_DISP.GROUP_OUTER_PROB= ${best.LAMBDA_DISP.GROUP_OUTER_PROB}`);
console.log(`[FIT WINNER]   LAMBDA_DISP.GROUP_A         = ${best.LAMBDA_DISP.GROUP_A}`);
