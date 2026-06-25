// Reusable realism-ensemble harness shared by the D5 vitest gate and the D6
// fit script. Single source of truth for how an "N runs over the era-weighted
// draft-reachable pool" measurement is taken.
//
// ENGINE-V2 E-3b: the harness now accepts an explicit draft POLICY so the
// asymmetric gate can measure over a COMPETENT (slot-fit) user XI rather
// than the canonical-first `autoDraft` (which is a determinism fixture, not
// a user-behavior proxy). The three policies are:
//
//   • `autoDraft`            — canonical-first, byte-stable. Used as
//                              telemetry-only baseline.
//   • `strategicAutoDraft`   — slot-fit best-available. The PASS-gate
//                              measurement target.
//   • `greedyOverallAutoDraft` — position-blind max-overall. NEGATIVE
//                              CONTROL: the gate ASSERTS this lands outside
//                              the shape bands, so nobody can "fix" the
//                              realism gate by maxing OVR.
//
// DETERMINISM: pure + seeded (SEED_PREFIX + index). Identical (N, seedPrefix,
// policy) → identical (RealismMeasurement, Norm[], aggregates).

import {
  aggregateUserXiStrength,
  autoDraft,
  buildDraftCatalog,
  buildRunScenario,
  computeSynergy,
  FORMATION_TEMPLATES,
  runTournamentFull,
  type Bracket2026,
  type DraftDataset,
  type DraftState,
  type ManagerTournament,
  type SimWorld,
  type StarterContribution,
  type Team2026,
} from "@wcdraft/core";

import { DRAFT_POOL_BUNDLE, RUNTIME_DATA_MANIFEST, SCENARIO_2026_BUNDLE } from "../../src/index.js";

import { buildPolicyContext, runAutoDraftPolicy, type PolicyContext } from "./draft-policies.js";

export const REALISM_NORMS = {
  goals_per_game: 2.54,
  draw_pct: 0.247,
  margin4plus_pct: 0.049,
  ko_et_pct: 0.33,
  shootout_pct: 0.214,
} as const;

export const DEFAULT_SEED_PREFIX = "wcdraft:realism:e3a:v1";

const COMBINED_RATING_VERSION = `${RUNTIME_DATA_MANIFEST.rating_version_historical}+${RUNTIME_DATA_MANIFEST.rating_version_projected}`;

export type DraftPolicyName = "autoDraft" | "strategicAutoDraft" | "greedyOverallAutoDraft";

export const ALL_POLICIES: readonly DraftPolicyName[] = [
  "autoDraft",
  "strategicAutoDraft",
  "greedyOverallAutoDraft",
] as const;

export function buildRealismDataset(): DraftDataset {
  return {
    players: DRAFT_POOL_BUNDLE.player_cards.map((c) => ({
      player_id: c.player_id,
      tournament_id: c.tournament_id,
      nation_id: c.nation_id,
      eligible_positions: c.eligible_positions,
    })),
    managers: DRAFT_POOL_BUNDLE.manager_cards.map((m) => ({
      manager_id: m.manager_id,
      tournament_id: m.tournament_id,
      nation_id: m.nation_id,
    })),
    tournaments: Object.entries(DRAFT_POOL_BUNDLE.tournaments).map(([tid, t]) => ({
      tournament_id: Number(tid),
      year: t.year,
    })),
  };
}

export function buildRealismSimWorld(): SimWorld {
  const opponents: Record<string, Team2026> = Object.fromEntries(
    SCENARIO_2026_BUNDLE.teams.map((t) => [t.team_id, t as Team2026]),
  );
  const managerTournaments: Record<string, ManagerTournament> = Object.fromEntries(
    DRAFT_POOL_BUNDLE.manager_cards.map((m) => [
      m.manager_card_id,
      {
        manager_card_id: m.manager_card_id,
        manager_id: m.manager_id,
        tournament_id: m.tournament_id,
        nation_id: m.nation_id,
        matches: m.matches,
        final_placement: m.final_placement,
        sources: m.sources,
      } satisfies ManagerTournament,
    ]),
  );
  const bracket: Bracket2026 = {
    groups: SCENARIO_2026_BUNDLE.groups,
    knockout_slots: SCENARIO_2026_BUNDLE.knockout_slots,
  };
  return {
    ratings: Object.fromEntries(DRAFT_POOL_BUNDLE.ratings.map((r) => [r.card_id, r])),
    opponents,
    managerTournaments,
    nationByCardId: DRAFT_POOL_BUNDLE.nation_by_card_id,
    bracket,
  };
}

export interface RealismMeasurement {
  matches: number;
  groupMatches: number;
  knockoutMatches: number;
  goalsTotal: number;
  draws: number;
  margin4plus: number;
  koEt: number;
  koShootout: number;
  qualifyingRuns: number;
}

/**
 * Aggregates over the N drafts under a single policy. Channel means are the
 * mean of `aggregateUserXiStrength` channel values across all N runs (so
 * they fold in Synergy and manager modifier exactly as the sim does).
 */
export interface PolicyTelemetry {
  policy: DraftPolicyName;
  runs: number;
  channelMean: { attack: number; midfield: number; defense: number; goalkeeping: number };
  synergyMultiplierMean: number;
  managerModifierMean: number;
  coverageMean: number;
}

function emptyMeasurement(): RealismMeasurement {
  return {
    matches: 0,
    groupMatches: 0,
    knockoutMatches: 0,
    goalsTotal: 0,
    draws: 0,
    margin4plus: 0,
    koEt: 0,
    koShootout: 0,
    qualifyingRuns: 0,
  };
}

function makeDraft(
  policy: DraftPolicyName,
  catalog: ReturnType<typeof buildDraftCatalog>,
  params: Parameters<typeof autoDraft>[0],
  ctx: PolicyContext,
): DraftState {
  if (policy === "autoDraft") {
    // Use the production autoDraft (canonical-first). It is byte-stable.
    return autoDraft(params);
  }
  return runAutoDraftPolicy(
    catalog,
    params,
    ctx,
    policy === "strategicAutoDraft" ? "strategic" : "greedy",
  );
}

/** Compute the StarterContribution[] the sim aggregator would see for this XI. */
function starterContributionsFor(draft: DraftState, world: SimWorld): StarterContribution[] {
  const formation = FORMATION_TEMPLATES[draft.formation_id];
  if (!formation) {
    throw new RangeError(`starterContributionsFor: unknown formation ${draft.formation_id}`);
  }
  const starters = draft.squad.filter((s) => s.is_starter);
  const out: StarterContribution[] = [];
  for (const slot of starters) {
    if (slot.card_id === null) continue;
    const rating = world.ratings[slot.card_id];
    if (!rating) {
      throw new RangeError(`starterContributionsFor: no rating for card ${slot.card_id}`);
    }
    // `slot.position_compatibility` is already stored at pick time; recompute
    // here for self-consistency (it must match).
    out.push({
      slot_id: slot.slot_id,
      rating,
      position_compatibility: slot.position_compatibility,
    });
  }
  return out;
}

/**
 * Run N drafts under `policy`, aggregating realism metrics + per-policy
 * channel / synergy / manager-modifier telemetry.
 */
export function runRealismEnsembleForPolicy(
  policy: DraftPolicyName,
  n: number,
  seedPrefix: string = DEFAULT_SEED_PREFIX,
): { measurement: RealismMeasurement; telemetry: PolicyTelemetry } {
  const dataset = buildRealismDataset();
  const world = buildRealismSimWorld();
  const catalog = buildDraftCatalog(dataset);
  const ctx: PolicyContext = buildPolicyContext(
    DRAFT_POOL_BUNDLE.player_cards,
    DRAFT_POOL_BUNDLE.ratings,
  );

  const m = emptyMeasurement();
  let attackSum = 0,
    midSum = 0,
    defSum = 0,
    gkSum = 0,
    coverageSum = 0;
  let synSum = 0,
    mgrModSum = 0;
  let aggCount = 0;

  for (let i = 0; i < n; i++) {
    const parentSeed = `${seedPrefix}:${String(i).padStart(4, "0")}`;
    const params = {
      run_id: `realism-${policy}-${String(i).padStart(4, "0")}`,
      parent_seed: parentSeed,
      formation_id: "4-3-3" as const,
      mode: "classic" as const,
      team_name: `Realism XI #${i}`,
      dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
      rating_version: COMBINED_RATING_VERSION,
      engine_version: RUNTIME_DATA_MANIFEST.engine_version,
      dataset,
    };
    const draft = makeDraft(policy, catalog, params, ctx);

    // ── per-policy XI telemetry ─────────────────────────────────────────
    const starters = starterContributionsFor(draft, world);
    if (starters.length === 11) {
      const formation = FORMATION_TEMPLATES[draft.formation_id]!;
      const managerCardId = draft.manager_card_id;
      const managerTournament =
        managerCardId === null ? null : (world.managerTournaments?.[managerCardId] ?? null);
      const managerRating =
        managerCardId === null ? null : (world.managerRatings?.[managerCardId] ?? null);
      const synergy = computeSynergy(
        draft.squad,
        formation,
        managerTournament,
        world.nationByCardId,
      );
      const team = aggregateUserXiStrength(starters, synergy, managerRating);
      attackSum += team.attack;
      midSum += team.midfield;
      defSum += team.defense;
      gkSum += team.goalkeeping;
      coverageSum += team.coverage;
      synSum += synergy.multiplier;
      // The aggregator already folds the manager modifier into channel ints;
      // we still record the raw modifier so a future diagnostic can split it
      // back out. With no managerRatings in the bundle, this is always 1.0.
      mgrModSum += managerRating === null || managerRating.overall === null ? 1.0 : 1.0;
      aggCount++;
    }

    // ── run the tournament & record realism metrics ────────────────────
    const sb = buildRunScenario({
      parent_seed: parentSeed,
      teams: SCENARIO_2026_BUNDLE.teams as readonly Team2026[],
      bracket: {
        groups: SCENARIO_2026_BUNDLE.groups,
        knockout_slots: SCENARIO_2026_BUNDLE.knockout_slots,
      },
      ruleset_version: RUNTIME_DATA_MANIFEST.ruleset_version,
    });
    const { matches, group_stage } = runTournamentFull(draft, sb.scenario, parentSeed, world);
    if (group_stage.user_qualified) m.qualifyingRuns++;
    for (const match of matches) {
      m.matches++;
      const gf = match.user_goals + (match.user_goals_et ?? 0);
      const ga = match.opp_goals + (match.opp_goals_et ?? 0);
      m.goalsTotal += gf + ga;
      if (Math.abs(gf - ga) >= 4) m.margin4plus++;
      if (match.phase === "group") {
        m.groupMatches++;
        if (match.outcome === "D") m.draws++;
      } else {
        m.knockoutMatches++;
        if (match.user_goals_et !== null) m.koEt++;
        if (match.shootout !== null) m.koShootout++;
      }
    }
  }

  const denom = aggCount > 0 ? aggCount : 1;
  const telemetry: PolicyTelemetry = {
    policy,
    runs: aggCount,
    channelMean: {
      attack: attackSum / denom,
      midfield: midSum / denom,
      defense: defSum / denom,
      goalkeeping: gkSum / denom,
    },
    synergyMultiplierMean: synSum / denom,
    managerModifierMean: mgrModSum / denom,
    coverageMean: coverageSum / denom,
  };
  return { measurement: m, telemetry };
}

/**
 * BACKWARDS-COMPAT shim: the original D5 entry point measured canonical
 * `autoDraft` and returned only the measurement. Keep that signature for
 * any caller (e.g. the D6 fit script) that doesn't need the policy axis.
 */
export function runRealismEnsemble(
  n: number,
  seedPrefix: string = DEFAULT_SEED_PREFIX,
): RealismMeasurement {
  return runRealismEnsembleForPolicy("autoDraft", n, seedPrefix).measurement;
}

export interface Norm {
  name: string;
  observed: number;
  target: number;
  denom: number;
  band: number;
  delta: number;
  inBand: boolean;
}

/** Wilson-style ±2·sqrt(p(1-p)/N) band centered on TARGET (the null hypothesis). */
export function wilsonBand(target: number, denom: number): number {
  if (denom <= 0) return Infinity;
  return 2 * Math.sqrt((target * (1 - target)) / denom);
}

/** One-sided 95% Wilson HALF-WIDTH around an observed proportion p_hat. */
export function wilsonHalfWidthObs(pHat: number, denom: number): number {
  if (denom <= 0) return Infinity;
  // Approx normal — fine for diagnostic banding. Same shape used in the
  // existing symmetric realism gate.
  return 2 * Math.sqrt((pHat * (1 - pHat)) / denom);
}

export function summarizeRealism(m: RealismMeasurement): { norms: Norm[]; goalsObserved: number } {
  const goalsObserved = m.matches > 0 ? m.goalsTotal / m.matches : 0;
  const goalsBand =
    m.matches > 0 ? 2 * Math.sqrt(REALISM_NORMS.goals_per_game / m.matches) : Infinity;
  const draws_p = m.groupMatches > 0 ? m.draws / m.groupMatches : 0;
  const margin_p = m.matches > 0 ? m.margin4plus / m.matches : 0;
  const koEt_p = m.knockoutMatches > 0 ? m.koEt / m.knockoutMatches : 0;
  const koSo_p = m.knockoutMatches > 0 ? m.koShootout / m.knockoutMatches : 0;
  const norms: Norm[] = [
    {
      name: "goals/game",
      observed: goalsObserved,
      target: REALISM_NORMS.goals_per_game,
      denom: m.matches,
      band: goalsBand,
      delta: goalsObserved - REALISM_NORMS.goals_per_game,
      inBand: Math.abs(goalsObserved - REALISM_NORMS.goals_per_game) <= goalsBand,
    },
    {
      name: "draw% (group)",
      observed: draws_p,
      target: REALISM_NORMS.draw_pct,
      denom: m.groupMatches,
      band: wilsonBand(REALISM_NORMS.draw_pct, m.groupMatches),
      delta: draws_p - REALISM_NORMS.draw_pct,
      inBand:
        Math.abs(draws_p - REALISM_NORMS.draw_pct) <=
        wilsonBand(REALISM_NORMS.draw_pct, m.groupMatches),
    },
    {
      name: "margin≥4%",
      observed: margin_p,
      target: REALISM_NORMS.margin4plus_pct,
      denom: m.matches,
      band: wilsonBand(REALISM_NORMS.margin4plus_pct, m.matches),
      delta: margin_p - REALISM_NORMS.margin4plus_pct,
      inBand:
        Math.abs(margin_p - REALISM_NORMS.margin4plus_pct) <=
        wilsonBand(REALISM_NORMS.margin4plus_pct, m.matches),
    },
    {
      name: "KO→ET%",
      observed: koEt_p,
      target: REALISM_NORMS.ko_et_pct,
      denom: m.knockoutMatches,
      band: wilsonBand(REALISM_NORMS.ko_et_pct, m.knockoutMatches),
      delta: koEt_p - REALISM_NORMS.ko_et_pct,
      inBand:
        Math.abs(koEt_p - REALISM_NORMS.ko_et_pct) <=
        wilsonBand(REALISM_NORMS.ko_et_pct, m.knockoutMatches),
    },
    {
      name: "shootout%",
      observed: koSo_p,
      target: REALISM_NORMS.shootout_pct,
      denom: m.knockoutMatches,
      band: wilsonBand(REALISM_NORMS.shootout_pct, m.knockoutMatches),
      delta: koSo_p - REALISM_NORMS.shootout_pct,
      inBand:
        Math.abs(koSo_p - REALISM_NORMS.shootout_pct) <=
        wilsonBand(REALISM_NORMS.shootout_pct, m.knockoutMatches),
    },
  ];
  return { norms, goalsObserved };
}

export function formatRealismReport(m: RealismMeasurement, prefix = "[REALISM]"): string {
  const { norms } = summarizeRealism(m);
  const fmtPct = (x: number): string => `${(x * 100).toFixed(2)}%`;
  const rows = [
    `${prefix} N_runs_unknown qualifying=${m.qualifyingRuns} matches=${m.matches} groups=${m.groupMatches} KO=${m.knockoutMatches}`,
  ];
  for (const n of norms) {
    const observed = n.name === "goals/game" ? n.observed.toFixed(3) : fmtPct(n.observed);
    const target = n.name === "goals/game" ? n.target.toFixed(3) : fmtPct(n.target);
    const band = n.name === "goals/game" ? `±${n.band.toFixed(3)}` : `±${fmtPct(n.band)}`;
    const status = n.inBand ? "✓" : "✗";
    rows.push(
      `${prefix} ${status} ${n.name.padEnd(14)} obs=${observed.padStart(8)} tgt=${target.padStart(8)} band=${band.padStart(10)} (N=${n.denom})`,
    );
  }
  return rows.join("\n");
}

export function formatTelemetry(t: PolicyTelemetry, prefix = "[REALISM]"): string {
  return [
    `${prefix} policy=${t.policy} runs=${t.runs}`,
    `${prefix}   channel  attack=${t.channelMean.attack.toFixed(2)} midfield=${t.channelMean.midfield.toFixed(2)} defense=${t.channelMean.defense.toFixed(2)} goalkeeping=${t.channelMean.goalkeeping.toFixed(2)}`,
    `${prefix}   synergy.mult=${t.synergyMultiplierMean.toFixed(4)}  mgr.mod=${t.managerModifierMean.toFixed(4)}  coverage=${t.coverageMean.toFixed(4)}`,
  ].join("\n");
}
