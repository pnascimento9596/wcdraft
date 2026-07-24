#!/usr/bin/env node
/**
 * Evidence-only: attribute compact draft-pool bundle bytes by field family,
 * with/without Rating.components, Career vs Current duplication.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { performance } from "node:perf_hooks";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BUNDLE = path.join(ROOT, "packages/data/src/generated/draft-pool.compact.json.br");
const PARSE_RUNS = 7;

const IDENTITY_PLAYER = new Set([
  "card_id",
  "player_id",
  "source_card_id",
  "source_tournament_id",
  "tournament_id",
  "nation_id",
]);
const IDENTITY_RATING = new Set(["card_id", "player_id", "tournament_id"]);
const PROVENANCE = new Set([
  "provenance",
  "overall_basis",
  "appearances_source",
  "coverage",
  "coverage_basis",
  "rating_version",
  "sources",
]);
const METADATA_PLAYER = new Set([
  "full_name",
  "common_name",
  "birth_date",
  "caps",
  "goals",
  "appearances",
  "captain",
  "shirt_number",
  "club_at_tournament",
  "club_nation_code",
  "eligible_positions",
  "position_listed",
  "primary_position",
  "awards",
]);
const CHANNELS = new Set(["attack", "midfield", "defense", "goalkeeping"]);
const OVERALL = new Set(["overall"]);
const COMPONENTS = new Set(["components"]);

type Family =
  | "identity"
  | "provenance"
  | "metadata"
  | "channels"
  | "overall"
  | "components"
  | "remainder";

function familyFor(key: string, context: "player" | "rating" | "other"): Family {
  if (COMPONENTS.has(key)) return "components";
  if (OVERALL.has(key)) return "overall";
  if (CHANNELS.has(key)) return "channels";
  if (PROVENANCE.has(key)) return "provenance";
  if (context === "player" && IDENTITY_PLAYER.has(key)) return "identity";
  if (context === "rating" && IDENTITY_RATING.has(key)) return "identity";
  if (context === "player" && METADATA_PLAYER.has(key)) return "metadata";
  if (key === "legend" || key === "basis_metadata") return "metadata";
  return "remainder";
}

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function brotliBytes(value: unknown): number {
  const buf = Buffer.from(JSON.stringify(value), "utf8");
  return brotliCompressSync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  }).length;
}

function emptyFamilies(): Record<Family, number> {
  return {
    identity: 0,
    provenance: 0,
    metadata: 0,
    channels: 0,
    overall: 0,
    components: 0,
    remainder: 0,
  };
}

function attributeObject(
  obj: Record<string, unknown>,
  context: "player" | "rating" | "other",
  into: Record<Family, number>,
): void {
  for (const [k, v] of Object.entries(obj)) {
    if (k === "basis_ratings") {
      // handled separately for Current
      continue;
    }
    into[familyFor(k, context)] += utf8Bytes({ [k]: v });
  }
}

function stripComponents(bundle: any): any {
  const clone = structuredClone(bundle);
  for (const r of clone.ratings) {
    delete r.components;
    if (r.basis_ratings?.current) delete r.basis_ratings.current.components;
  }
  return clone;
}

function measureParse(raw: Buffer, runs: number): { median_ms: number; samples_ms: number[] } {
  const samples: number[] = [];
  // warmup
  JSON.parse(raw.toString("utf8"));
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    JSON.parse(raw.toString("utf8"));
    samples.push(performance.now() - t0);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return { median_ms: median, samples_ms: samples };
}

function main(): void {
  const compressed = readFileSync(BUNDLE);
  const raw = brotliDecompressSync(compressed);
  const bundle = JSON.parse(raw.toString("utf8"));

  const career = emptyFamilies();
  const current = emptyFamilies();
  const playerFamilies = emptyFamilies();
  const otherTop: Record<string, number> = {};

  for (const p of bundle.player_cards as Record<string, unknown>[]) {
    attributeObject(p, "player", playerFamilies);
  }
  for (const r of bundle.ratings as any[]) {
    attributeObject(r, "rating", career);
    if (r.basis_ratings?.current) {
      attributeObject(r.basis_ratings.current as Record<string, unknown>, "rating", current);
    }
  }
  for (const key of Object.keys(bundle)) {
    if (key === "player_cards" || key === "ratings") continue;
    otherTop[key] = utf8Bytes(bundle[key]);
  }

  const withComponents = bundle;
  const without = stripComponents(bundle);
  const withJson = Buffer.from(JSON.stringify(withComponents), "utf8");
  const withoutJson = Buffer.from(JSON.stringify(without), "utf8");
  // Re-encode wire: recompress full JSON (fair apples-to-apples)
  const withBr = brotliCompressSync(withJson, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: withJson.length },
  });
  const withoutBr = brotliCompressSync(withoutJson, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: withoutJson.length,
    },
  });

  const parseWith = measureParse(withJson, PARSE_RUNS);
  const parseWithout = measureParse(withoutJson, PARSE_RUNS);

  // Duplication: fields present on both Career top-level and Current basis with equal values
  let dupDecoded = 0;
  let careerOnlyDecoded = 0;
  let currentOnlyDecoded = 0;
  const dupByFamily = emptyFamilies();
  for (const r of bundle.ratings as any[]) {
    const cur = r.basis_ratings?.current ?? {};
    const keys = new Set([...Object.keys(r), ...Object.keys(cur)]);
    for (const k of keys) {
      if (k === "basis_ratings" || k === "basis_metadata") continue;
      const hasC = Object.prototype.hasOwnProperty.call(r, k);
      const hasU = Object.prototype.hasOwnProperty.call(cur, k);
      if (hasC && hasU) {
        const same = JSON.stringify(r[k]) === JSON.stringify(cur[k]);
        const bytes = utf8Bytes({ [k]: cur[k] }); // bytes of the duplicated Current copy
        if (same) {
          dupDecoded += bytes;
          dupByFamily[familyFor(k, "rating")] += bytes;
        } else {
          currentOnlyDecoded += bytes; // diverged current value still current-specific
        }
      } else if (hasC) {
        careerOnlyDecoded += utf8Bytes({ [k]: r[k] });
      } else if (hasU) {
        currentOnlyDecoded += utf8Bytes({ [k]: cur[k] });
      }
    }
  }

  // Without components: recompute duplication excluding components keys
  let dupNoComp = 0;
  const dupByFamilyNoComp = emptyFamilies();
  for (const r of without.ratings as any[]) {
    const cur = r.basis_ratings?.current ?? {};
    const keys = new Set([...Object.keys(r), ...Object.keys(cur)]);
    for (const k of keys) {
      if (k === "basis_ratings" || k === "basis_metadata" || k === "components") continue;
      const hasC = Object.prototype.hasOwnProperty.call(r, k);
      const hasU = Object.prototype.hasOwnProperty.call(cur, k);
      if (hasC && hasU && JSON.stringify(r[k]) === JSON.stringify(cur[k])) {
        const bytes = utf8Bytes({ [k]: cur[k] });
        dupNoComp += bytes;
        dupByFamilyNoComp[familyFor(k, "rating")] += bytes;
      }
    }
  }

  const componentsCareerBytes = career.components;
  const componentsCurrentBytes = current.components;
  const componentsTotalDecoded = componentsCareerBytes + componentsCurrentBytes;

  const out = {
    schema_version: "bundle-field-attribution-1.0.0",
    measurement_date: new Date().toISOString().slice(0, 10),
    inputs: {
      bundle_path: "packages/data/src/generated/draft-pool.compact.json.br",
      shipped_compressed_bytes: compressed.length,
      shipped_decoded_bytes: raw.length,
      shipped_compressed_sha256: createHash("sha256").update(compressed).digest("hex"),
      shipped_decoded_sha256: createHash("sha256").update(raw).digest("hex"),
      ratings: bundle.ratings.length,
      player_cards: bundle.player_cards.length,
      parse_runs: PARSE_RUNS,
      host: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        // note: throttled mobile profile is a separate measurement if cgroup/cpulimit available
      },
    },
    preregistered_decision_rule: {
      drop_components_if:
        "≥15% reduction in decoded pool size OR ≥100 ms reduction in parse time on throttled mobile profile",
      schema_churn_cost_note:
        "runtime-data schema bump, manifest regen, retention rotation (current+2 prior), service-worker data-cache revision, full golden re-lock",
    },
    c2_components: {
      decoded_bytes_components_career: componentsCareerBytes,
      decoded_bytes_components_current: componentsCurrentBytes,
      decoded_bytes_components_total: componentsTotalDecoded,
      share_of_shipped_decoded_pool: componentsTotalDecoded / raw.length,
      full_json_roundtrip_decoded_with: withJson.length,
      full_json_roundtrip_decoded_without: withoutJson.length,
      decoded_delta_bytes: withJson.length - withoutJson.length,
      decoded_delta_share_of_with: (withJson.length - withoutJson.length) / withJson.length,
      brotli_q11_with: withBr.length,
      brotli_q11_without: withoutBr.length,
      brotli_delta_bytes: withBr.length - withoutBr.length,
      brotli_delta_share: (withBr.length - withoutBr.length) / withBr.length,
      parse_ms_with: parseWith,
      parse_ms_without: parseWithout,
      parse_median_delta_ms: parseWith.median_ms - parseWithout.median_ms,
      host_bar_decoded_15pct: (withJson.length - withoutJson.length) / withJson.length >= 0.15,
      host_bar_parse_100ms: parseWith.median_ms - parseWithout.median_ms >= 100,
    },
    c3_families: {
      note: "Family bytes are sum of JSON.stringify({key:value}) over each object; keys double-count JSON structural overhead per key. Relative comparison is valid; absolute sum exceeds decoded pool.",
      player_cards: playerFamilies,
      ratings_career_top_level: career,
      ratings_current_basis: current,
      other_top_level_keys: otherTop,
      duplication: {
        with_components: {
          duplicated_current_copy_decoded_bytes: dupDecoded,
          career_only_decoded_bytes: careerOnlyDecoded,
          current_diverged_or_only_decoded_bytes: currentOnlyDecoded,
          by_family: dupByFamily,
          duplication_ratio_of_current_bytes:
            dupDecoded / Math.max(1, Object.values(current).reduce((a, b) => a + b, 0)),
        },
        without_components: {
          duplicated_current_copy_decoded_bytes: dupNoComp,
          by_family: dupByFamilyNoComp,
        },
      },
      sequencing:
        "If C2 drops components, recompute C3 on the post-drop bundle before opening a delta-encoding Red lane; components are a large duplicated family and inflate Current duplication.",
    },
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main();
