// DECOUPLING GUARD #2 (canary) — `ws-core/decoupling-guards`.
//
// LOADED GUN #2 from the season-merge gate-2 adversarial review:
// `pickBest` in `./draft-policies.ts` breaks `strategicAutoDraft` ties by
// `overall` DESC then `card_id` ASC. `overall` is the DISPLAY-only Rating
// composite (see `core/src/types/rating.ts`: "the sim engine MUST NOT read
// this field"). The harness reads it under a tiebreak — that's TEST
// infrastructure, not the sim, so the contract is not literally violated.
// But the harness sits UNDER the λ-calibration chain: any future change to
// the display `overall` curve (rescaling, post-fit normalisation,
// stature-driven pooled curve, etc.) can FLIP a tie ordering, which
// re-orders the strategic pick sequence, which shifts the realism
// landings, which silently invalidates the λ fit basis WITHOUT the
// `realism.gate.test.ts` Wilson-band gate catching it (the landings shift
// AND the bands shift WITH them on the next re-fit/re-lock, so the gate
// passes against a moved target).
//
// LEAD-ARCHITECT DECISION (gate-2 report, 2026-06-09): do NOT change the
// pickBest tiebreak — any pick-flip drifts the locked realism landings and
// invalidates the λ basis. Instead, ADD THIS CANARY: lock the exact
// strategic-draft pick sequence for a small set of fixed seeds, so any
// future display-curve change that flips a tie ordering turns red loudly
// here instead of silently re-basing the realism norms.
//
// This is INTENTIONALLY a small fixed-seed lock — not a re-run of the
// 2000-seed realism ensemble. The point is to detect tie-ordering FLIPS
// on the cheapest possible signal: the deterministic pick sequence under
// canonical inputs. The number of seeds (5) is the smallest count that
// exercises a representative mix of (tournament, nation, slot-line)
// triples; raise N here only if a real flip slipped through.
//
// MUTATE-AND-FAIL: perturb the `overall` channel on any rating in the
// `DRAFT_POOL_BUNDLE.ratings` table that participates in a tie, OR change
// the `pickBest` ordering, and this canary turns red. See the report at
// the bottom of the test for the explicit failure shape.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildDraftCatalog,
  ERA_PRESET_IDS,
  type CreateDraftParams,
  type DraftFlow,
  type DraftState,
  type EraPresetId,
} from "@wcdraft/core";

import { DRAFT_POOL_BUNDLE, RUNTIME_DATA_MANIFEST } from "../../src/index.js";

import { buildPolicyContext, runAutoDraftPolicy } from "./draft-policies.js";
import { buildRealismDataset, DEFAULT_SEED_PREFIX } from "./realism.harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(HERE, "strategic-pick-canary-golden.json");

/** Number of seeds the canary locks. Small on purpose — see header. */
const N_SEEDS = 5;

const COMBINED_RATING_VERSION = `${RUNTIME_DATA_MANIFEST.rating_version_historical}+${RUNTIME_DATA_MANIFEST.rating_version_projected}`;

interface CanaryPick {
  /** Spin index 0..N. */
  spin: number;
  /** 'manager' on the manager-first spin, 'player' on every other. */
  picked_kind: "player" | "manager";
  /** Branded CardId for player picks; null for manager picks. */
  picked_card_id: string | null;
  /** Branded ManagerCardId for manager pick; null for player picks. */
  picked_manager_card_id: string | null;
  /** SquadSlot.slot_id the pick landed in; null for manager picks. */
  assigned_slot_id: string | null;
}

interface CanarySeedRecord {
  era_preset: EraPresetId;
  draft_flow: DraftFlow;
  seed_index: number;
  parent_seed: string;
  manager_card_id: string | null;
  picks: CanaryPick[];
}

interface CanaryGolden {
  $schema_doc: string;
  policy: "strategicAutoDraft";
  seed_prefix: string;
  formation_id: string;
  configuration_count: number;
  n_seeds: number;
  rating_version: string;
  engine_version: string;
  dataset_version: string;
  records: CanarySeedRecord[];
}

const GOLDEN_DOC = [
  "DECOUPLING GUARD #2 — strategic-pick canary.",
  "Locks the exact strategicAutoDraft pick sequence for the first N_SEEDS",
  "seeds in every Career era preset and both draft flows. Trips when a",
  "display-curve or offer-tiering change (e.g. a",
  "stature-driven `overall` rescale) flips a `pickBest` tie ordering and",
  "silently invalidates the λ-calibration basis (the realism gate's Wilson",
  "bands shift with the landings on re-lock, so they do NOT catch the flip).",
  "Re-lock atomically with any intentional realism re-fit.",
].join(" ");

function extractCanaryPicks(state: DraftState): CanaryPick[] {
  // `runAutoDraftPolicy` drives the same WS-C engine the canonical autoDraft
  // uses; every Spin is `status: 'picked'` at draft completion.
  return state.spins.map((s) => ({
    spin: s.index,
    picked_kind: s.picked_kind,
    picked_card_id: s.picked_card_id as string | null,
    picked_manager_card_id: s.picked_manager_card_id as string | null,
    assigned_slot_id: s.assigned_slot_id,
  }));
}

function runCanary(): CanaryGolden {
  const dataset = buildRealismDataset();
  const ctx = buildPolicyContext(DRAFT_POOL_BUNDLE.player_cards, DRAFT_POOL_BUNDLE.ratings);

  const records: CanarySeedRecord[] = [];
  for (const era_preset of ERA_PRESET_IDS) {
    const catalog = buildDraftCatalog(dataset, era_preset);
    for (const draft_flow of ["squad_first", "position_first"] as const) {
      for (let i = 0; i < N_SEEDS; i++) {
        const parent_seed = `${DEFAULT_SEED_PREFIX}:${era_preset}:${draft_flow}:${String(i).padStart(4, "0")}`;
        const params: CreateDraftParams & { dataset: typeof dataset } = {
          run_id: `canary-strategicAutoDraft-${era_preset}-${draft_flow}-${String(i).padStart(4, "0")}`,
          parent_seed,
          formation_id: "4-3-3",
          mode: "classic",
          team_name: `Canary XI ${era_preset} ${draft_flow} #${i}`,
          dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
          rating_version: COMBINED_RATING_VERSION,
          engine_version: RUNTIME_DATA_MANIFEST.engine_version,
          era_preset,
          draft_flow,
          rating_basis: "career",
          dataset,
        };
        const state = runAutoDraftPolicy(catalog, params, ctx, "strategic");
        records.push({
          era_preset,
          draft_flow,
          seed_index: i,
          parent_seed,
          manager_card_id: state.manager_card_id as string | null,
          picks: extractCanaryPicks(state),
        });
      }
    }
  }

  return {
    $schema_doc: GOLDEN_DOC,
    policy: "strategicAutoDraft",
    seed_prefix: DEFAULT_SEED_PREFIX,
    formation_id: "4-3-3",
    configuration_count: ERA_PRESET_IDS.length * 2,
    n_seeds: N_SEEDS,
    rating_version: COMBINED_RATING_VERSION,
    engine_version: RUNTIME_DATA_MANIFEST.engine_version,
    dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
    records,
  };
}

const REGEN = process.env.WCDRAFT_CANARY_REGEN === "1";

describe("strategic-pick canary — locks pickBest tie-order under display `overall`", () => {
  it("first 5 strategicAutoDraft seeds in all 8 Career cells match byte-for-byte", () => {
    const computed = runCanary();

    if (REGEN) {
      writeFileSync(GOLDEN_PATH, JSON.stringify(computed, null, 2) + "\n", "utf8");
      // After regen, still assert against disk so a follow-up test run is green.
    }

    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as CanaryGolden;

    expect(
      computed,
      [
        "strategic-pick canary tripped — the strategicAutoDraft pick sequence",
        "diverged from the locked golden. THIS DOES NOT MEAN THE NEW PICKS ARE",
        "WRONG — it means a `pickBest` tie-order flipped, which would silently",
        "re-base the λ calibration basis under realism re-fit. Investigate which",
        "rating's `overall` changed (e.g. display-curve refit, stature rescale,",
        "ratings.json regen), confirm the realism landings need re-locking, then",
        "re-run this canary alongside the realism-gate re-lock with",
        "  WCDRAFT_CANARY_REGEN=1 pnpm --filter @wcdraft/data test --",
        "  packages/data/test/realism/strategic-pick-canary.golden.test.ts",
      ].join("\n"),
    ).toEqual(golden);
  });
});
