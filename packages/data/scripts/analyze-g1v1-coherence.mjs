#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");

const INPUTS = Object.freeze({
  bundle: "packages/data/src/generated/draft-pool.compact.json.br",
  manifest: "packages/data/src/generated/manifest.json",
  curve: "etl/src/wcdraft_etl/display_curve.py",
  ratingComponents: "etl/src/wcdraft_etl/rating_components.py",
  careerEffective: "etl/output/manual-ratings-v4.5-effective.csv",
  careerResolution: "etl/output/manual-ratings-v4.5-resolution.csv",
  careerUnmatched: "etl/output/manual-ratings-v4.5-unmatched.csv",
  careerSummary: "etl/output/manual-ratings-v4.5-summary.json",
  currentEffective: "etl/output/manual-ratings-v4.4-effective.csv",
  currentSummary: "etl/output/manual-ratings-v4.4-summary.json",
});

const CHANNELS = Object.freeze(["attack", "midfield", "defense", "goalkeeping"]);
const BASIS_NAMES = Object.freeze(["career", "current"]);
const DRIFT_LIMIT = 1e-5;

function absolute(rel) {
  return path.join(REPO_ROOT, rel);
}

function read(rel) {
  return readFileSync(absolute(rel));
}

function json(rel) {
  return JSON.parse(read(rel).toString("utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/u, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error("unterminated quoted CSV field");
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((values, rowIndex) => {
    if (values.length !== header.length) {
      throw new Error(
        `CSV row ${rowIndex + 2} has ${values.length} fields; expected ${header.length}`,
      );
    }
    return Object.fromEntries(header.map((key, index) => [key, values[index]]));
  });
}

function parsePythonNumberMap(source, constantName) {
  const match = source.match(new RegExp(`^${constantName}\\s*=\\s*\\{([\\s\\S]*?)^\\}`, "mu"));
  if (!match) throw new Error(`cannot parse ${constantName}`);
  const entries = [...match[1].matchAll(/"([a-z_0-9]+)"\s*:\s*([0-9.]+)/gu)];
  return Object.fromEntries(entries.map((entry) => [entry[1], Number(entry[2])]));
}

function parseChannelSpread(source) {
  const block = source.match(/^CHANNEL_SPREAD[^=]*=\s*\{([\s\S]*?)^\}/mu);
  if (!block) throw new Error("cannot parse CHANNEL_SPREAD");
  const result = {};
  for (const match of block[1].matchAll(/"(FW|MF|DF|GK)"\s*:\s*\{([^}]+)\}/gu)) {
    result[match[1]] = Object.fromEntries(
      [...match[2].matchAll(/"([a-z]+)"\s*:\s*([0-9.]+)/gu)].map((entry) => [
        entry[1],
        Number(entry[2]),
      ]),
    );
  }
  if (Object.keys(result).length !== 4) throw new Error("incomplete CHANNEL_SPREAD parse");
  return result;
}

function roundPython(value) {
  // All materialized channel ties are non-negative. Python round uses ties-to-even.
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (Math.abs(fraction - 0.5) < Number.EPSILON * 8) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, sorted.length - 1);
  const fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    max: sorted.length ? sorted.at(-1) : null,
    p99: quantile(sorted, 0.99),
    p50: quantile(sorted, 0.5),
  };
}

function roundMetric(value) {
  return value === null ? null : Number(value.toFixed(9));
}

function roundedStats(values) {
  return Object.fromEntries(
    Object.entries(stats(values)).map(([key, value]) => [key, roundMetric(value)]),
  );
}

function displayValue(score, curve) {
  let value;
  if (score <= curve.raw_floor) value = 60;
  else if (score >= curve.raw_max) value = 99;
  else if (score <= curve.raw_median) {
    const t = (score - curve.raw_floor) / (curve.raw_median - curve.raw_floor);
    value = 60 + (73 - 60) * t ** 0.65;
  } else if (score <= curve.raw_p95) {
    const t = (score - curve.raw_median) / (curve.raw_p95 - curve.raw_median);
    value = 73 + (88 - 73) * t;
  } else {
    const t = (score - curve.raw_p95) / (curve.raw_max - curve.raw_p95);
    value = 88 + (99 - 88) * t ** 2;
  }
  return Math.max(60, Math.min(99, value));
}

function displayScore(score, curve, estimate = false) {
  let value = roundPython(displayValue(score, curve));
  if (estimate) value = Math.max(66, Math.min(73, value));
  return value;
}

function inverseDisplay(display, curve) {
  if (display <= 60) return curve.raw_floor;
  if (display >= 99) return curve.raw_max;
  if (display <= 73) {
    const t = (display - 60) / (73 - 60);
    return curve.raw_floor + (curve.raw_median - curve.raw_floor) * t ** (1 / 0.65);
  }
  if (display <= 88) {
    const t = (display - 73) / (88 - 73);
    return curve.raw_median + (curve.raw_p95 - curve.raw_median) * t;
  }
  const t = (display - 88) / (99 - 88);
  return curve.raw_p95 + (curve.raw_max - curve.raw_p95) * t ** (1 / 2);
}

function runtimeCardId(sourceCardId) {
  return sourceCardId.replace(/:WC-(\d{4})$/u, ":$1");
}

function targetMap(rows) {
  return new Map(
    rows.map((row) => [runtimeCardId(row.card_id), Number(row.effective_final_rating)]),
  );
}

function expectedChannel(score, spread, floorChannel) {
  return Math.max(0, Math.min(100, roundPython(score * spread + floorChannel * (1 - spread))));
}

function main() {
  const manifestBytes = read(INPUTS.manifest);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const bundleBytes = read(INPUTS.bundle);
  const bundleRaw = brotliDecompressSync(bundleBytes);
  const bundle = JSON.parse(bundleRaw.toString("utf8"));
  const curveSource = read(INPUTS.curve).toString("utf8");
  const ratingComponentsSource = read(INPUTS.ratingComponents).toString("utf8");
  const curve = parsePythonNumberMap(curveSource, "FROZEN_UNIFIED_CURVE_V2_ANCHORS");
  const spreads = parseChannelSpread(ratingComponentsSource);
  const floorMatch = ratingComponentsSource.match(/FLOOR_CHANNEL\s*=.*#\s*([0-9]+)/u);
  if (!floorMatch) throw new Error("cannot parse FLOOR_CHANNEL");
  const floorChannel = Number(floorMatch[1]);

  const careerEffective = parseCsv(read(INPUTS.careerEffective).toString("utf8"));
  const careerResolution = parseCsv(read(INPUTS.careerResolution).toString("utf8"));
  const careerUnmatched = parseCsv(read(INPUTS.careerUnmatched).toString("utf8"));
  const currentEffective = parseCsv(read(INPUTS.currentEffective).toString("utf8"));
  const careerSummary = json(INPUTS.careerSummary);
  const currentSummary = json(INPUTS.currentSummary);
  const careerTargets = targetMap(careerEffective);
  const currentOnlyTargets = targetMap(currentEffective);
  const cards = new Map(bundle.player_cards.map((card) => [card.card_id, card]));

  const inverseResiduals = [];
  const inverseResidualRecords = [];
  const inverseResidualsByBasis = { career: [], current: [] };
  const continuousDisplayResiduals = [];
  const inverseRoundtripFailures = [];
  const baselineCappedObservations = [];
  const channelFailures = [];
  const overrideFailures = [];
  const overrideResiduals = [];
  const basisCounts = { career: 0, current: 0 };
  const provenance = {
    career_stature_estimate: {
      cards: new Set(),
      by_basis: { career: 0, current: 0 },
      observations: 0,
      channel_failures: 0,
      display_failures: 0,
    },
    baseline_anchor_estimate: {
      cards: new Set(),
      by_basis: { career: 0, current: 0 },
      observations: 0,
      channel_failures: 0,
      display_failures: 0,
    },
  };

  for (const rating of bundle.ratings) {
    const card = cards.get(rating.card_id);
    if (!card) throw new Error(`rating without card: ${rating.card_id}`);
    const bases = { career: rating, current: rating.basis_ratings?.current };
    for (const basisName of BASIS_NAMES) {
      const basis = bases[basisName];
      if (!basis) throw new Error(`missing ${basisName} basis: ${rating.card_id}`);
      basisCounts[basisName] += 1;
      const score = basis.basis_metadata?.score_0_100;
      if (!Number.isFinite(score))
        throw new Error(`missing internal score: ${rating.card_id}/${basisName}`);
      const estimateCapped = basis.overall_basis === "baseline_anchor_estimate";
      const expectedOverride =
        basisName === "career"
          ? careerTargets.get(rating.card_id)
          : (currentOnlyTargets.get(rating.card_id) ?? careerTargets.get(rating.card_id));
      const expectedDisplay = expectedOverride ?? displayScore(score, curve, estimateCapped);
      if (expectedDisplay !== basis.overall) {
        inverseRoundtripFailures.push({
          card_id: rating.card_id,
          basis: basisName,
          internal: score,
          overall: basis.overall,
          expected_overall: expectedDisplay,
        });
      }
      if (estimateCapped) {
        baselineCappedObservations.push({ card_id: rating.card_id, basis: basisName });
      } else {
        const residual = Math.abs(score - inverseDisplay(basis.overall, curve));
        inverseResiduals.push(residual);
        inverseResidualRecords.push({
          card_id: rating.card_id,
          basis: basisName,
          overall: basis.overall,
          internal: score,
          residual,
        });
        inverseResidualsByBasis[basisName].push(residual);
        if (expectedOverride === undefined || expectedOverride >= 60) {
          continuousDisplayResiduals.push(Math.abs(displayValue(score, curve) - basis.overall));
        }
      }

      for (const channel of CHANNELS) {
        const expected = expectedChannel(
          score,
          spreads[card.position_listed][channel],
          floorChannel,
        );
        if (basis[channel] !== expected) {
          channelFailures.push({
            card_id: rating.card_id,
            basis: basisName,
            channel,
            actual: basis[channel],
            expected,
            internal: score,
            overall: basis.overall,
          });
        }
      }

      if (Object.hasOwn(provenance, basis.overall_basis)) {
        const cohort = provenance[basis.overall_basis];
        cohort.cards.add(rating.card_id);
        cohort.by_basis[basisName] += 1;
        cohort.observations += 1;
        if (expectedDisplay !== basis.overall) cohort.display_failures += 1;
        cohort.channel_failures += channelFailures.filter(
          (failure) => failure.card_id === rating.card_id && failure.basis === basisName,
        ).length;
      }

      if (expectedOverride !== undefined) {
        const expectedInternal = inverseDisplay(expectedOverride, curve);
        const residual = Math.abs(score - expectedInternal);
        overrideResiduals.push(residual);
        const basisChannelFailures = channelFailures.filter(
          (failure) => failure.card_id === rating.card_id && failure.basis === basisName,
        );
        if (
          basis.overall !== expectedOverride ||
          residual > DRIFT_LIMIT ||
          basisChannelFailures.length > 0
        ) {
          overrideFailures.push({
            card_id: rating.card_id,
            basis: basisName,
            expected_display: expectedOverride,
            actual_display: basis.overall,
            expected_internal: roundMetric(expectedInternal),
            actual_internal: score,
            residual: roundMetric(residual),
            channel_failures: basisChannelFailures,
          });
        }
      }
    }
  }

  const careerResolutionCardIds = new Set(
    careerResolution.map((row) => runtimeCardId(row.card_id)),
  );
  const resolutionSourceLines = new Set(careerResolution.map((row) => row.source_line));
  const unmatchedResolvedSourceLineOverlap = careerUnmatched.filter((row) =>
    resolutionSourceLines.has(row.source_line),
  );
  const unmatchedForcedComponents = bundle.ratings.filter((rating) => {
    if (careerTargets.has(rating.card_id)) return false;
    return rating.components.some((component) => component.signal === "manual_rating_override");
  });

  const inputFingerprints = Object.fromEntries(
    Object.entries(INPUTS).map(([key, rel]) => {
      const bytes = read(rel);
      return [key, { path: rel, bytes: bytes.length, sha256: sha256(bytes) }];
    }),
  );

  const result = {
    verdict:
      overrideFailures.length === 0 &&
      channelFailures.length === 0 &&
      inverseRoundtripFailures.length === 0
        ? "RETIRE"
        : "ESCALATE",
    method: {
      population: "Every shipped runtime rating, Career and Current bases; no sampling.",
      inverse_residual_note:
        "Natural rows store integer display OVERALL, so score - curve^-1(integer OVERALL) includes expected display quantization. Exact >1e-5 drift adjudication applies to owner overrides, whose internal target is the curve inverse by contract. Baseline-anchor estimates are checked by capped forward round-trip because their [66,73] display cap is non-invertible.",
      drift_limit: DRIFT_LIMIT,
      curve,
      floor_channel: floorChannel,
      channel_spread: spreads,
    },
    anchors: {
      schema_version: manifest.schema_version,
      engine_version: manifest.engine_version,
      rating_version_historical: manifest.rating_version_historical,
      rating_version_projected: manifest.rating_version_projected,
      draft_pool: manifest.bundles.draft_pool,
    },
    population: {
      cards: bundle.ratings.length,
      player_cards: bundle.player_cards.length,
      basis_observations: basisCounts.career + basisCounts.current,
      basis_counts: basisCounts,
      career_override_source_rows: careerSummary.rows,
      career_override_resolved_rows: careerSummary.matched,
      career_override_unmatched_rows: careerSummary.unmatched,
      career_override_effective_cards: careerTargets.size,
      career_override_resolution_unique_cards: careerResolutionCardIds.size,
      current_only_override_source_rows: currentSummary.rows,
      current_only_override_resolved_rows: currentSummary.matched,
      current_only_override_effective_cards: currentOnlyTargets.size,
      manifest_career_stature_estimate_cards: manifest.counts.career_stature_estimate,
      manifest_baseline_anchor_estimate_cards: manifest.counts.baseline_anchor_estimate,
    },
    inversion_coherence: {
      quantized_residual_all_non_capped: roundedStats(inverseResiduals),
      quantized_residual_max_examples: inverseResidualRecords
        .sort(
          (a, b) =>
            b.residual - a.residual ||
            a.card_id.localeCompare(b.card_id) ||
            a.basis.localeCompare(b.basis),
        )
        .slice(0, 5)
        .map((row) => ({ ...row, residual: roundMetric(row.residual) })),
      quantized_residual_by_basis: {
        career: roundedStats(inverseResidualsByBasis.career),
        current: roundedStats(inverseResidualsByBasis.current),
      },
      forward_roundtrip_failures: inverseRoundtripFailures.length,
      continuous_display_residual_non_capped: roundedStats(continuousDisplayResiduals),
      baseline_capped_observations: baselineCappedObservations.length,
      override_exact_residual: roundedStats(overrideResiduals),
      override_residuals_over_1e_5: overrideResiduals.filter((value) => value > DRIFT_LIMIT).length,
    },
    channel_non_reshaping: {
      observations: (basisCounts.career + basisCounts.current) * CHANNELS.length,
      failures: channelFailures.length,
      examples: channelFailures.slice(0, 20),
    },
    override_authority: {
      career_observations: careerTargets.size,
      current_observations: new Set([...careerTargets.keys(), ...currentOnlyTargets.keys()]).size,
      total_observations:
        careerTargets.size + new Set([...careerTargets.keys(), ...currentOnlyTargets.keys()]).size,
      failures: overrideFailures.length,
      examples: overrideFailures.slice(0, 20),
    },
    honest_misses: {
      unmatched_rows: careerUnmatched.length,
      overlap_with_resolved_source_lines: unmatchedResolvedSourceLineOverlap.length,
      unexpected_manual_components_on_non_effective_cards: unmatchedForcedComponents.length,
    },
    estimate_provenance: Object.fromEntries(
      Object.entries(provenance).map(([key, value]) => [
        key,
        {
          cards: value.cards.size,
          observations_by_basis: value.by_basis,
          observations: value.observations,
          display_failures: value.display_failures,
          channel_failures: value.channel_failures,
          badge_contract:
            "apps/web/lib/game/view-models.ts::provenanceBadgeKind => estimate/orange hue",
        },
      ]),
    ),
    input_fingerprints: inputFingerprints,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
