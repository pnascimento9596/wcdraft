// E-3a D6 — DETERMINISTIC SEEDED COORDINATE-DESCENT FIT.
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

const PASSES = Number(process.env.WCDRAFT_FIT_PASSES ?? 2);

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
const CONSTANT_GRIDS = [
  { name: "BASE",       bucket: "LAMBDA",  values: [0.85, 0.95, 1.05, 1.15, 1.25, 1.40] },
  { name: "SPREAD",     bucket: "LAMBDA",  values: [1.5, 2.0, 2.5, 3.0, 3.5, 4.0] },
  { name: "MIN",        bucket: "LAMBDA",  values: [0.30, 0.45, 0.60, 0.75] },
  { name: "MAX",        bucket: "LAMBDA",  values: [2.40, 2.80, 3.10, 3.40] },
  { name: "W_DEF",      bucket: "LAMBDA",  values: [0.55, 0.65, 0.70, 0.80] },
  { name: "GAMMA_MID",  bucket: "LAMBDA",  values: [0.10, 0.20, 0.30, 0.45] },
  { name: "REGULATION", bucket: "CHANCES", values: [24, 32, 40, 50] },
];

// Seed tuple (E-3a starting point post-D1+D2).
const SEED_TUPLE = {
  LAMBDA: {
    SPREAD: 4.0,
    BASE: 1.25,
    MIN: 0.30,
    MAX: 3.40,
    W_DEF: 0.70,
    W_GK: 0.30,
    GAMMA_MID: 0.25,
  },
  CHANCES: {
    REGULATION: 50,
    EXTRA_TIME: 17,
  },
};

const NORM_SCALES = {
  goals: 1.0,
  draw: 0.10,
  margin4: 0.05,
  ko_et: 0.10,
  ko_so: 0.10,
};

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

  __UNSAFE_setCalibrationOverride({ LAMBDA: lambda, CHANCES: chances });
  let m;
  try {
    m = runSweep();
  } finally {
    __UNSAFE_clearCalibrationOverride();
  }

  let score = 0;
  for (const k of ["goals", "draw", "margin4", "ko_et", "ko_so"]) {
    const z = (m[k] - NORMS[k]) / NORM_SCALES[k];
    score += z * z;
  }
  return { score, m, lambdaApplied: lambda, chancesApplied: chances };
}

function describeTuple(t) {
  const L = t.LAMBDA, C = t.CHANCES;
  return `SPREAD=${L.SPREAD} BASE=${L.BASE} MIN=${L.MIN} MAX=${L.MAX} W_DEF=${L.W_DEF}/W_GK=${(1 - L.W_DEF).toFixed(2)} γ_mid=${L.GAMMA_MID} n=${C.REGULATION}`;
}

function clone(t) { return { LAMBDA: { ...t.LAMBDA }, CHANCES: { ...t.CHANCES } }; }
function fmtPct(x) { return (100 * x).toFixed(2) + "%"; }
function fmtNorms(m) {
  return `goals=${m.goals.toFixed(3)} draw=${fmtPct(m.draw)} m4=${fmtPct(m.margin4)} ET=${fmtPct(m.ko_et)} SO=${fmtPct(m.ko_so)}`;
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
console.log(`[FIT WINNER]   CHANCES.REGULATION= ${best.CHANCES.REGULATION}`);
console.log(`[FIT WINNER]   CHANCES.EXTRA_TIME= ${Math.max(1, Math.round((best.CHANCES.REGULATION * 30) / 90))}`);
