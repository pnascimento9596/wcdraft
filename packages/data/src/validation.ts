import {
  RUNTIME_DATA_SCHEMA_VERSION,
  type DraftPoolBundle,
  type RuntimeDataManifest,
  type Scenario2026Bundle,
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
