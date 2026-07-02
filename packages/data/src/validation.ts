import {
  DAILY_SEED_SALT_MAP_SCHEMA_VERSION,
  RUNTIME_DATA_SCHEMA_VERSION,
  SCORE_DISTRIBUTION_SCHEMA_VERSION,
  type DailySeedSaltMap,
  type DraftPoolBundle,
  type RuntimeDataManifest,
  type Scenario2026Bundle,
  type ScoreDistribution,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(label: string, path: string, message: string): never {
  throw new Error(`@wcdraft/data: malformed ${label} at ${path}: ${message}`);
}

function requireRecord(value: unknown, label: string, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(label, path, "expected object");
  return value;
}

function requireArray(value: unknown, label: string, path: string): unknown[] {
  if (!Array.isArray(value)) fail(label, path, "expected array");
  return value;
}

function requireString(value: unknown, label: string, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(label, path, "expected non-empty string");
  }
  return value;
}

function requireNumber(value: unknown, label: string, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(label, path, "expected finite number");
  }
  return value;
}

function requireSchemaVersion(
  obj: Record<string, unknown>,
  label: string,
  path = "schema_version",
): void {
  const schemaVersion = requireString(obj.schema_version, label, path);
  if (schemaVersion !== RUNTIME_DATA_SCHEMA_VERSION) {
    fail(
      label,
      path,
      `schema_version mismatch: got "${schemaVersion}", expected "${RUNTIME_DATA_SCHEMA_VERSION}"`,
    );
  }
}

function requireFingerprint(value: unknown, label: string, path: string): void {
  const fp = requireRecord(value, label, path);
  requireString(fp.path, label, `${path}.path`);
  requireString(fp.sha256, label, `${path}.sha256`);
  requireNumber(fp.bytes, label, `${path}.bytes`);
  requireNumber(fp.bytes_gzip, label, `${path}.bytes_gzip`);
  requireNumber(fp.bytes_brotli, label, `${path}.bytes_brotli`);
}

export function parseRuntimeDataManifest(value: unknown): RuntimeDataManifest {
  const label = "runtime manifest";
  const obj = requireRecord(value, label, "$");
  requireSchemaVersion(obj, label);
  requireString(obj.dataset_version, label, "dataset_version");
  requireString(obj.rating_version_historical, label, "rating_version_historical");
  requireString(obj.rating_version_projected, label, "rating_version_projected");
  requireString(obj.engine_version, label, "engine_version");
  requireString(obj.ruleset_version, label, "ruleset_version");

  const bundles = requireRecord(obj.bundles, label, "bundles");
  requireFingerprint(bundles.draft_pool, label, "bundles.draft_pool");
  requireFingerprint(bundles.scenario_2026, label, "bundles.scenario_2026");
  // OPTIONAL: manifests built before the score-distribution artifact existed
  // (and mid-regeneration builds) legitimately omit this entry; consumers
  // degrade to "standing unknown" (omit the line), never fabricate.
  if (bundles.score_distribution !== undefined) {
    requireFingerprint(bundles.score_distribution, label, "bundles.score_distribution");
  }
  if (bundles.daily_seed_salt_map !== undefined) {
    requireFingerprint(bundles.daily_seed_salt_map, label, "bundles.daily_seed_salt_map");
  }

  const counts = requireRecord(obj.counts, label, "counts");
  for (const key of [
    "player_cards",
    "manager_cards",
    "ratings",
    "teams",
    "knockout_slots",
    "baseline_anchor_estimate",
    "career_stature_estimate",
    "legend",
  ]) {
    requireNumber(counts[key], label, `counts.${key}`);
  }
  requireRecord(obj.attribution, label, "attribution");
  return obj as unknown as RuntimeDataManifest;
}

export function parseDraftPoolBundle(value: unknown): DraftPoolBundle {
  const label = "draft pool bundle";
  const obj = requireRecord(value, label, "$");
  requireSchemaVersion(obj, label);
  const playerCards = requireArray(obj.player_cards, label, "player_cards");
  const managerCards = requireArray(obj.manager_cards, label, "manager_cards");
  const ratings = requireArray(obj.ratings, label, "ratings");
  if (playerCards.length === 0) fail(label, "player_cards", "expected at least one card");
  if (managerCards.length === 0) fail(label, "manager_cards", "expected at least one manager");
  if (ratings.length === 0) fail(label, "ratings", "expected at least one rating");
  requireRecord(obj.nation_by_card_id, label, "nation_by_card_id");
  requireRecord(obj.nation_by_manager_card_id, label, "nation_by_manager_card_id");
  requireRecord(obj.tournaments, label, "tournaments");
  requireRecord(obj.nations, label, "nations");
  return obj as unknown as DraftPoolBundle;
}

export function parseScoreDistribution(value: unknown): ScoreDistribution {
  const label = "score distribution";
  const obj = requireRecord(value, label, "$");
  const schemaVersion = requireString(obj.schema_version, label, "schema_version");
  if (schemaVersion !== SCORE_DISTRIBUTION_SCHEMA_VERSION) {
    fail(
      label,
      "schema_version",
      `schema_version mismatch: got "${schemaVersion}", expected "${SCORE_DISTRIBUTION_SCHEMA_VERSION}"`,
    );
  }
  const anchors = requireRecord(obj.anchors, label, "anchors");
  for (const key of [
    "dataset_version",
    "engine_version",
    "rating_version_historical",
    "rating_version_projected",
    "ruleset_version",
    "draft_pool_sha256",
    "scenario_2026_sha256",
  ]) {
    requireString(anchors[key], label, `anchors.${key}`);
  }
  const population = requireRecord(obj.population, label, "population");
  requireString(population.policy, label, "population.policy");
  requireString(population.seed_prefix, label, "population.seed_prefix");
  for (const key of ["runs", "qualifying_runs", "mean", "median", "p95", "min", "max"]) {
    requireNumber(population[key], label, `population.${key}`);
  }
  const quantiles = requireArray(obj.quantiles, label, "quantiles");
  if (quantiles.length !== 101) {
    fail(label, "quantiles", `expected 101 breakpoints, got ${quantiles.length}`);
  }
  let prev = -Infinity;
  for (let i = 0; i < quantiles.length; i++) {
    const q = requireNumber(quantiles[i], label, `quantiles[${i}]`);
    if (!Number.isInteger(q)) fail(label, `quantiles[${i}]`, "expected integer score");
    if (q < prev) fail(label, `quantiles[${i}]`, "expected nondecreasing breakpoints");
    prev = q;
  }
  return obj as unknown as ScoreDistribution;
}

function requireDateString(value: unknown, label: string, path: string): string {
  const date = requireString(value, label, path);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    fail(label, path, "expected UTC date YYYY-MM-DD");
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    fail(label, path, "expected valid UTC calendar date");
  }
  return date;
}

function requireInteger(value: unknown, label: string, path: string): number {
  const n = requireNumber(value, label, path);
  if (!Number.isSafeInteger(n)) fail(label, path, "expected safe integer");
  return n;
}

function requireNonNegativeInteger(value: unknown, label: string, path: string): number {
  const n = requireInteger(value, label, path);
  if (n < 0) fail(label, path, "expected non-negative integer");
  return n;
}

export function parseDailySeedSaltMap(value: unknown): DailySeedSaltMap {
  const label = "daily seed salt map";
  const obj = requireRecord(value, label, "$");
  const schemaVersion = requireString(obj.schema_version, label, "schema_version");
  if (schemaVersion !== DAILY_SEED_SALT_MAP_SCHEMA_VERSION) {
    fail(
      label,
      "schema_version",
      `schema_version mismatch: got "${schemaVersion}", expected "${DAILY_SEED_SALT_MAP_SCHEMA_VERSION}"`,
    );
  }
  requireString(obj._doc, label, "_doc");

  const anchors = requireRecord(obj.anchors, label, "anchors");
  for (const key of [
    "dataset_version",
    "engine_version",
    "rating_version_historical",
    "rating_version_projected",
    "ruleset_version",
    "draft_pool_sha256",
    "scenario_2026_sha256",
  ]) {
    requireString(anchors[key], label, `anchors.${key}`);
  }

  const window = requireRecord(obj.window, label, "window");
  requireDateString(window.start_date, label, "window.start_date");
  const days = requireNonNegativeInteger(window.days, label, "window.days");
  if (days === 0) fail(label, "window.days", "expected at least one day");
  if (window.timezone !== "UTC") fail(label, "window.timezone", "expected UTC");

  if (obj.policy !== "greedyOverallAutoDraft") {
    fail(label, "policy", "expected greedyOverallAutoDraft");
  }

  const population = requireRecord(obj.population, label, "population");
  const runs = requireNonNegativeInteger(
    population.runs_per_candidate,
    label,
    "population.runs_per_candidate",
  );
  if (runs === 0) fail(label, "population.runs_per_candidate", "expected at least one run");
  const attempts = requireNonNegativeInteger(
    population.max_salt_attempts,
    label,
    "population.max_salt_attempts",
  );
  if (attempts < 1) fail(label, "population.max_salt_attempts", "expected at least one attempt");
  requireString(population.sample_seed_suffix, label, "population.sample_seed_suffix");

  const band = requireRecord(obj.degeneracy_band, label, "degeneracy_band");
  for (const key of [
    "easy_perfect_rate_gte",
    "easy_qualifying_rate_gte",
    "cruel_qualifying_rate_lte",
    "cruel_median_score_lte",
  ]) {
    requireNumber(band[key], label, `degeneracy_band.${key}`);
  }
  requireString(band.cruel_median_source, label, "degeneracy_band.cruel_median_source");

  const salts = requireRecord(obj.salts, label, "salts");
  const saltedDates = new Set<string>();
  for (const [date, salt] of Object.entries(salts)) {
    requireDateString(date, label, `salts.${date}`);
    const n = requireInteger(salt, label, `salts.${date}`);
    if (n < 2) fail(label, `salts.${date}`, "salted dates must use suffix >= 2");
    saltedDates.add(date);
  }

  const dates = requireArray(obj.dates, label, "dates");
  const seenDates = new Set<string>();
  for (const [idx, entryValue] of dates.entries()) {
    const path = `dates[${idx}]`;
    const entry = requireRecord(entryValue, label, path);
    const date = requireDateString(entry.date, label, `${path}.date`);
    if (seenDates.has(date)) fail(label, `${path}.date`, "duplicate date");
    seenDates.add(date);
    const salt = requireInteger(entry.salt, label, `${path}.salt`);
    if (salt !== 0 && salt < 2) fail(label, `${path}.salt`, "expected 0 or suffix >= 2");
    requireString(entry.seed, label, `${path}.seed`);
    requireString(entry.sample_seed_prefix, label, `${path}.sample_seed_prefix`);
    if (typeof entry.selected !== "boolean") fail(label, `${path}.selected`, "expected boolean");
    if (typeof entry.degenerate !== "boolean") {
      fail(label, `${path}.degenerate`, "expected boolean");
    }
    if (
      !["normal", "easy_perfect", "easy_qualifying", "cruel_qualifying", "cruel_median"].includes(
        String(entry.reason),
      )
    ) {
      fail(label, `${path}.reason`, "unexpected reason");
    }
    const entryRuns = requireNonNegativeInteger(entry.runs, label, `${path}.runs`);
    if (entryRuns !== runs) fail(label, `${path}.runs`, "must equal population.runs_per_candidate");
    for (const key of ["perfect_runs", "qualifying_runs", "exact_seed_score", "min", "max"]) {
      requireInteger(entry[key], label, `${path}.${key}`);
    }
    for (const key of ["perfect_rate", "qualifying_rate", "mean", "median"]) {
      requireNumber(entry[key], label, `${path}.${key}`);
    }
    if (typeof entry.exact_seed_qualified !== "boolean") {
      fail(label, `${path}.exact_seed_qualified`, "expected boolean");
    }
    if (typeof entry.exact_seed_perfect !== "boolean") {
      fail(label, `${path}.exact_seed_perfect`, "expected boolean");
    }
    const salted = salts[date];
    if (salted !== undefined && salted !== salt) {
      fail(label, `${path}.salt`, "does not match salts entry");
    }
    if (saltedDates.has(date) && entry.selected !== true) {
      fail(label, `${path}.selected`, "salted date must be selected");
    }
  }

  return obj as unknown as DailySeedSaltMap;
}

export function parseScenario2026Bundle(value: unknown): Scenario2026Bundle {
  const label = "scenario 2026 bundle";
  const obj = requireRecord(value, label, "$");
  requireSchemaVersion(obj, label);
  const tournamentId = requireNumber(obj.tournament_id, label, "tournament_id");
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    fail(label, "tournament_id", "expected positive integer");
  }
  requireString(obj.format_version, label, "format_version");
  const groups = requireArray(obj.groups, label, "groups");
  const knockoutSlots = requireArray(obj.knockout_slots, label, "knockout_slots");
  const teams = requireArray(obj.teams, label, "teams");
  if (groups.length === 0) fail(label, "groups", "expected at least one group");
  if (knockoutSlots.length === 0) fail(label, "knockout_slots", "expected at least one slot");
  if (teams.length === 0) fail(label, "teams", "expected at least one team");
  requireRecord(obj.team_display_names, label, "team_display_names");
  requireRecord(obj.default_knockout_opponent_rule, label, "default_knockout_opponent_rule");
  return obj as unknown as Scenario2026Bundle;
}
