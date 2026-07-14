// Reference-standing tests — the FIT-06 honesty gates:
//   • the standing is computed only for records whose version anchors match
//     the shipped table (wrong population ⇒ null ⇒ line omitted);
//   • replay-stable: same record + same table ⇒ identical standing;
//   • wording: reference copy never reads as posted-field copy and vice
//     versa (no cross-contamination on any caption);
//   • captions: non-daily carries the reference standing; daily keeps the
//     posted-field rules and NEVER carries the reference line.

import { describe, expect, it } from "vitest";

import type { ScoreDistribution } from "@wcdraft/data/client";

import {
  REFERENCE_STANDING_EXPLAINER,
  referenceStandingForRecord,
  scoreDistributionMatchesVersions,
} from "../reference-standing";
import {
  buildShareCaption,
  buildShareIntentText,
  dailyStandingText,
  DAILY_STANDING_CLAIM_COPY,
  type ShareView,
} from "../share-adapters";
import type { RunRecordV1 } from "../run-record";
import type { RunRecordVersions } from "../versions";

// ── Fixtures ────────────────────────────────────────────────────────────────

const VERSIONS: RunRecordVersions = {
  schema_version: "runtime-data-2.9.0",
  dataset_version: "2026-07-01",
  rating_version: "wc-perf-6.6.0+proj-career-5.6.0",
  engine_version: "engine-2026.07.14-squad-depth",
  ruleset_version: "ruleset-2026.06.04",
  data_bundle_hash: "poolsha+scenariosha",
};

function makeDist(overrides: Partial<ScoreDistribution["anchors"]> = {}): ScoreDistribution {
  // Simple 101-entry table: q[p] = p - 20 (min −20, max 80), so beat(score)
  // is easy to reason about in assertions.
  return {
    schema_version: "score-distribution-1.0.0",
    _doc: "test fixture",
    anchors: {
      dataset_version: "2026-07-01",
      engine_version: "engine-2026.07.14-squad-depth",
      rating_version_historical: "wc-perf-6.6.0",
      rating_version_projected: "proj-career-5.6.0",
      ruleset_version: "ruleset-2026.06.04",
      draft_pool_sha256: "poolsha",
      scenario_2026_sha256: "scenariosha",
      ...overrides,
    },
    population: {
      policy: "strategicAutoDraft",
      seed_prefix: "test",
      runs: 2000,
      qualifying_runs: 1329,
      mean: 14.48,
      median: 9,
      p95: 62,
      min: -20,
      max: 80,
    },
    quantiles: Array.from({ length: 101 }, (_, p) => p - 20),
  };
}

function makeRecord(score: number, versions: RunRecordVersions = VERSIONS): RunRecordV1 {
  return {
    versions,
    simulation: { run: { score } },
  } as unknown as RunRecordV1;
}

// ── Anchor gating ───────────────────────────────────────────────────────────

describe("scoreDistributionMatchesVersions", () => {
  it("matches when every anchor lines up", () => {
    expect(scoreDistributionMatchesVersions(makeDist(), VERSIONS)).toBe(true);
  });

  it.each([
    ["dataset_version", { dataset_version: "2026-06-04" }],
    ["engine_version", { engine_version: "engine-old" }],
    ["rating version (historical)", { rating_version_historical: "wc-perf-6.5.0" }],
    ["rating version (projected)", { rating_version_projected: "proj-career-5.5.0" }],
    ["ruleset_version", { ruleset_version: "ruleset-old" }],
    ["draft pool sha", { draft_pool_sha256: "other" }],
    ["scenario sha", { scenario_2026_sha256: "other" }],
  ] as const)("rejects a %s mismatch (standing omitted, never wrong-population)", (_label, o) => {
    const dist = makeDist(o);
    expect(scoreDistributionMatchesVersions(dist, VERSIONS)).toBe(false);
    expect(referenceStandingForRecord(makeRecord(10), dist)).toBeNull();
  });
});

describe("referenceStandingForRecord", () => {
  it("returns null without a table or without a simulation", () => {
    expect(referenceStandingForRecord(makeRecord(10), null)).toBeNull();
    const noSim = { versions: VERSIONS, simulation: null } as unknown as RunRecordV1;
    expect(referenceStandingForRecord(noSim, makeDist())).toBeNull();
  });

  it("is replay-stable: same record + same table ⇒ identical standing", () => {
    const dist = makeDist();
    const a = referenceStandingForRecord(makeRecord(14), dist);
    const b = referenceStandingForRecord(makeRecord(14), dist);
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });

  it("frames negative scores as a point on the curve, not a verdict", () => {
    const standing = referenceStandingForRecord(makeRecord(-7), makeDist());
    expect(standing!.label).toBe("Beat ~12% of reference drafts");
  });
});

// ── Wording distinctness (no cross-contamination) ──────────────────────────

describe("standing wording", () => {
  it("reference copy never reads as posted-field copy", () => {
    const dist = makeDist();
    for (const score of [-30, -7, 0, 9, 14, 62, 90]) {
      const label = referenceStandingForRecord(makeRecord(score), dist)!.label;
      expect(label).toContain("reference drafts");
      expect(label).not.toMatch(/field|today|#\d+ of/iu);
    }
    expect(REFERENCE_STANDING_EXPLAINER).toContain("simulated drafts");
    expect(REFERENCE_STANDING_EXPLAINER).toContain("not with other players");
  });

  it("posted-field copy never reads as reference copy", () => {
    expect(dailyStandingText({ rank: 2, percentile: 50, fieldSize: 12 })).not.toMatch(
      /reference/iu,
    );
    expect(DAILY_STANDING_CLAIM_COPY).not.toMatch(/reference/iu);
  });
});

// ── Caption rules ───────────────────────────────────────────────────────────

function makeView(overrides: Partial<ShareView> = {}): ShareView {
  return {
    team_name: "Auriverde XI",
    draft_mode: "classic",
    headline: "RUN COMPLETE",
    display_record: "4-2",
    is_champion: false,
    is_perfect_eight_zero: false,
    score: 14,
    goals_for: 10,
    goals_against: 7,
    formation_name: "4-3-3",
    manager: null,
    stars: [],
    top_scorer: null,
    narrative: "",
    seed: "wcdraft:run:v1:run-v1-k:4-3-3",
    reached_round: "QF",
    matches_played: 6,
    shootout_wins: 0,
    challenge_date: null,
    perfect_run_reference: "Max score: 108 — eight 1-0 wins, no bookings or missed pens",
    reveal: null,
    ...overrides,
  };
}

const URL = "https://wcdraft.app/play/share?run=t2.test";
const REFERENCE = { beat_percent: 57, tail: null, label: "Beat ~57% of reference drafts" } as const;

describe("caption rules", () => {
  it("non-daily captions carry the reference standing line", () => {
    const caption = buildShareCaption(makeView(), URL, { referenceStanding: REFERENCE });
    expect(caption).toContain("Beat ~57% of reference drafts");
    const intent = buildShareIntentText(makeView(), { referenceStanding: REFERENCE });
    expect(intent).toContain("Beat ~57% of reference drafts");
  });

  it("non-daily captions omit the line when the standing is unknown", () => {
    const caption = buildShareCaption(makeView(), URL, { referenceStanding: null });
    expect(caption).not.toMatch(/reference drafts/u);
  });

  it("daily captions NEVER carry the reference standing (posted-field rules only)", () => {
    const view = makeView({ challenge_date: "2026-07-01" });
    const withField = buildShareCaption(view, URL, {
      referenceStanding: REFERENCE,
      dailyStanding: { rank: 2, percentile: 50, fieldSize: 12 },
    });
    expect(withField).toContain("#2 of 12 today");
    expect(withField).not.toMatch(/reference drafts/u);
    const withoutField = buildShareCaption(view, URL, { referenceStanding: REFERENCE });
    expect(withoutField).not.toMatch(/reference drafts/u);
    expect(buildShareIntentText(view, { referenceStanding: REFERENCE })).not.toMatch(
      /reference drafts/u,
    );
  });
});
