// SCORE-DISTRIBUTION GOLDEN + PROPERTY GATE (default lane — cheap).
//
// Locks the shipped reference score-distribution artifact
// (`src/generated/score-distribution.compact.json`) to the CURRENT engine +
// data anchors so it can never go stale relative to what ships:
//   1. anchors embedded in the artifact === current manifest values
//      (versions AND source-bundle sha256s);
//   2. the manifest carries a matching `bundles.score_distribution`
//      fingerprint for the on-disk bytes;
//   3. the population summary equals the asym-realism golden's pinned
//      `score_population` (same ensemble, same methodology — one source of
//      truth, no second distribution);
//   4. standing computed from the table is honest: monotone in score,
//      whole-percent, tails clamp to ~1% (never 0/100).
//
// The HEAVY lane (realism.gate.test.ts under WCDRAFT_REALISM_HEAVY=1)
// additionally re-derives the quantile table from a live N=2000 ensemble and
// asserts deep equality — proving the committed artifact is byte-faithful to
// the engine, not just consistently labelled.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  referenceBeatPercent,
  referenceStanding,
  RUNTIME_DATA_MANIFEST,
  SCORE_DISTRIBUTION_BUNDLE,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = join(HERE, "..", "src", "generated", "score-distribution.compact.json");

interface AsymGoldenScorePopulation {
  score_population: {
    runs: number;
    qualifyingRuns: number;
    mean: number;
    median: number;
    p95: number;
    min: number;
    max: number;
  };
}

const ASYM_GOLDEN: AsymGoldenScorePopulation = JSON.parse(
  readFileSync(join(HERE, "realism", "asym-realism-golden.json"), "utf-8"),
);

function requireArtifact() {
  expect(
    SCORE_DISTRIBUTION_BUNDLE,
    "score-distribution.compact.json must be committed (run build-score-distribution.mts)",
  ).not.toBeNull();
  return SCORE_DISTRIBUTION_BUNDLE!;
}

describe("score-distribution artifact", () => {
  it("is committed and anchored to the current manifest (versions + bundle sha256s)", () => {
    const dist = requireArtifact();
    expect(dist.anchors).toEqual({
      dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
      engine_version: RUNTIME_DATA_MANIFEST.engine_version,
      rating_version_historical: RUNTIME_DATA_MANIFEST.rating_version_historical,
      rating_version_projected: RUNTIME_DATA_MANIFEST.rating_version_projected,
      ruleset_version: RUNTIME_DATA_MANIFEST.ruleset_version,
      draft_pool_sha256: RUNTIME_DATA_MANIFEST.bundles.draft_pool.sha256,
      scenario_2026_sha256: RUNTIME_DATA_MANIFEST.bundles.scenario_2026.sha256,
    });
  });

  it("is fingerprinted by the manifest, matching the on-disk bytes", () => {
    const fingerprint = RUNTIME_DATA_MANIFEST.bundles.score_distribution;
    expect(
      fingerprint,
      "manifest.bundles.score_distribution must be stamped (run build:compact)",
    ).toBeDefined();
    const bytes = readFileSync(ARTIFACT_PATH);
    expect(fingerprint!.bytes).toBe(bytes.length);
    expect(fingerprint!.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(fingerprint!.path).toBe("score-distribution.compact.json");
  });

  it("pins the SAME population as the asym-realism golden (no second methodology)", () => {
    const dist = requireArtifact();
    const pinned = ASYM_GOLDEN.score_population;
    expect(dist.population.runs).toBe(pinned.runs);
    expect(dist.population.qualifying_runs).toBe(pinned.qualifyingRuns);
    expect(dist.population.mean).toBe(pinned.mean);
    expect(dist.population.median).toBe(pinned.median);
    expect(dist.population.p95).toBe(pinned.p95);
    expect(dist.population.min).toBe(pinned.min);
    expect(dist.population.max).toBe(pinned.max);
    expect(dist.population.policy).toBe("strategicAutoDraft");
  });

  it("has a coherent quantile table (101 nondecreasing ints, endpoints = min/max, q95 = p95)", () => {
    const dist = requireArtifact();
    expect(dist.quantiles).toHaveLength(101);
    for (let i = 1; i < dist.quantiles.length; i++) {
      expect(dist.quantiles[i]!).toBeGreaterThanOrEqual(dist.quantiles[i - 1]!);
      expect(Number.isInteger(dist.quantiles[i])).toBe(true);
    }
    expect(dist.quantiles[0]).toBe(dist.population.min);
    expect(dist.quantiles[100]).toBe(dist.population.max);
    expect(dist.quantiles[95]).toBe(dist.population.p95);
  });
});

describe("reference standing (property gate)", () => {
  it("is monotonically nondecreasing in score across the full range", () => {
    const dist = requireArtifact();
    let prev = -Infinity;
    for (let score = dist.population.min - 10; score <= dist.population.max + 10; score++) {
      const beat = referenceBeatPercent(score, dist);
      expect(beat).toBeGreaterThanOrEqual(prev);
      expect(Number.isInteger(beat)).toBe(true);
      expect(beat).toBeGreaterThanOrEqual(0);
      expect(beat).toBeLessThanOrEqual(100);
      prev = beat;
    }
  });

  it("clamps tails to ~1% bands and never renders 0% or 100%", () => {
    const dist = requireArtifact();
    expect(referenceStanding(dist.population.min - 100, dist).label).toBe(
      "Bottom ~1% of reference drafts",
    );
    expect(referenceStanding(dist.population.min, dist).label).toBe(
      "Bottom ~1% of reference drafts",
    );
    expect(referenceStanding(dist.population.max, dist).label).toBe("Top ~1% of reference drafts");
    expect(referenceStanding(dist.population.max + 100, dist).label).toBe(
      "Top ~1% of reference drafts",
    );
    for (let score = dist.population.min - 5; score <= dist.population.max + 5; score++) {
      const { label } = referenceStanding(score, dist);
      expect(label).not.toMatch(/~0%|~100%/u);
      expect(label).toMatch(
        /^(Beat ~\d{1,2}% of reference drafts|Top ~1% of reference drafts|Bottom ~1% of reference drafts)$/u,
      );
    }
  });

  it("is deterministic (replaying the same score yields the identical standing)", () => {
    const dist = requireArtifact();
    for (const score of [-24, -7, 0, 9, 14, 62, 84, 126]) {
      const a = referenceStanding(score, dist);
      const b = referenceStanding(score, dist);
      expect(a).toEqual(b);
    }
  });

  it("uses honest reference wording, never field/player wording", () => {
    const dist = requireArtifact();
    for (const score of [-24, -7, 0, 9, 14, 62, 84, 126]) {
      const { label } = referenceStanding(score, dist);
      expect(label).toContain("reference drafts");
      expect(label).not.toMatch(/field|player|today/iu);
    }
  });
});
