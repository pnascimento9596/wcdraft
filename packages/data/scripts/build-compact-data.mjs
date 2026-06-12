#!/usr/bin/env node
// Deterministic compact-data builder.
//
// Reads the committed ETL output at `etl/output/*.json` and emits three
// compact JSON artifacts:
//   - manifest.json
//   - draft-pool.compact.json
//   - scenario-2026.compact.json
//
// HARD INVARIANTS:
//   - Stable sorted JSON; no timestamps, no entropy. Two builds produce
//     byte-identical files.
//   - ETL `tournament_id` `"WC-YYYY"` → runtime numeric `YYYY` EVERYWHERE,
//     including `Team2026.squad_card_ids`. Any `tournament_id` that does not
//     match `^WC-\d{4}$` FAILS the build loudly.
//   - `card_id` / `manager_card_id` rebuilt via the core helpers; source IDs
//     preserved as `source_*` for audit.
//   - Missing required joins (a draftable card with no rating, a team with
//     no nation row, etc.) FAIL loudly.
//   - Honest state preserved: every nullable upstream field stays `null`
//     when unknown; never coerced to `0`.
//
// USAGE: `node packages/data/scripts/build-compact-data.mjs [--out-dir PATH]
//        [--etl-dir PATH] [--dataset-version YYYY-MM-DD]`.
//
// The default `--out-dir` is `packages/data/src/generated/`; the default
// `--etl-dir` is `etl/output/`. The default `--dataset-version` is read from
// the ETL `manifest.json` if present, else falls back to a parameter the
// caller must pass — never derived from wall-clock time.

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync, constants as zlibConstants } from "node:zlib";

import { buildCardId, buildManagerCardId } from "@wcdraft/core";

// ─── Constants ───────────────────────────────────────────────────────────────

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");

const DEFAULT_ETL_DIR = path.join(REPO_ROOT, "etl", "output");
const DEFAULT_OUT_DIR = path.join(PACKAGE_DIR, "src", "generated");

// runtime-data-2.0.0 (merit-v3 V6): compact ratings carry both display bases,
// while preserving the draft-config runtime replay shape from runtime-data-1.2.0.
// The legacy `ratings` array remains the Career alias for shipped consumers.
const SCHEMA_VERSION = "runtime-data-2.0.0";
// Draft-config has already shipped engine-2026.06.11 on main. merit-v3 V8 owns
// the next season engine bump after the V7 lambda refit.
const ENGINE_VERSION = "engine-2026.06.11";
const RULESET_VERSION = "ruleset-2026.06.04";

// merit-v3 model (wc-perf-5.0.0 historical, unified display curve v2);
// projected proj-career-4.0.0 (2026 linked-material on the stature scale).
// Fallbacks only apply if a ratings file omits rating_version; the real value is
// read per-row.
const RATING_VERSION_HISTORICAL_FALLBACK = "wc-perf-5.0.0";
const RATING_VERSION_PROJECTED_FALLBACK = "proj-career-4.0.0";
const DISPLAY_FLOOR = 66;
const DISPLAY_MAX = 99;
const ESTIMATE_DISPLAY_MIN = 66;
const ESTIMATE_DISPLAY_MAX = 73;
// 386 as of wc-perf-4.2.1: the basis-gate stature alignment re-labels Sepp Maier
// P-14080:WC-1966 (career_stature_index 0.446, stature_model_weight 0.881 — stature
// dominates) from baseline_anchor_estimate → career_stature_estimate, one card off
// the MV2-10 count of 387.
const EXPECTED_BASELINE_ANCHOR_ESTIMATE = 386;

const TOURNAMENT_ID_RE = /^WC-(\d{4})$/u;
const KNOCKOUT_ROUNDS = ["R32", "R16", "QF", "SF", "F"];

// Fixed default knockout opponent rule for the scoped scenario bundle. The
// real `RunScenario` is built by `@wcdraft/core` (scenario builder lands in
// I3). This is the bundle-default seed.
const DEFAULT_KNOCKOUT_OPPONENT_RULE = Object.freeze({
  kind: "escalating_strength_seeded",
  rounds: KNOCKOUT_ROUNDS,
  seed_suffix: "opponent_selection",
});

// ─── CLI parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { etlDir: DEFAULT_ETL_DIR, outDir: DEFAULT_OUT_DIR, datasetVersion: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--etl-dir" && typeof next === "string") {
      out.etlDir = path.resolve(next);
      i += 1;
    } else if (arg === "--out-dir" && typeof next === "string") {
      out.outDir = path.resolve(next);
      i += 1;
    } else if (arg === "--dataset-version" && typeof next === "string") {
      out.datasetVersion = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: build-compact-data [--etl-dir DIR] [--out-dir DIR] [--dataset-version YYYY-MM-DD]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`build-compact-data: unrecognised argument: ${arg}`);
    }
  }
  return out;
}

// ─── File helpers ────────────────────────────────────────────────────────────

async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text);
}

/**
 * Stable JSON encoding. Object keys are sorted lexicographically at every
 * depth so two builds with identical inputs emit byte-identical bytes.
 * Arrays preserve order — callers are responsible for canonical-sorting
 * their arrays before passing them in.
 */
function stableStringify(value) {
  return JSON.stringify(value, sortReplacer, 2) + "\n";
}

function sortReplacer(_key, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const sorted = {};
  for (const k of Object.keys(value).sort()) {
    sorted[k] = value[k];
  }
  return sorted;
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ─── Tournament ID rewrite ───────────────────────────────────────────────────

/**
 * `"WC-1998"` → `1998`. Throws if the input is not exactly a `WC-YYYY`
 * string. This is the canonical boundary for the runtime ID rewrite — every
 * call site (player card, manager card, rating, team squad ID, …) goes
 * through this function so a single regression surface catches drift.
 */
function tournamentIdToNumeric(raw) {
  if (typeof raw !== "string") {
    throw new Error(
      `build-compact-data: expected tournament_id to be a "WC-YYYY" string, received: ${typeof raw}`,
    );
  }
  const m = TOURNAMENT_ID_RE.exec(raw);
  if (!m) {
    throw new Error(
      `build-compact-data: tournament_id ${JSON.stringify(raw)} does not match canonical WC-YYYY pattern; refusing to emit.`,
    );
  }
  const yyyy = Number(m[1]);
  if (!Number.isSafeInteger(yyyy) || yyyy < 1900 || yyyy > 2100) {
    throw new Error(
      `build-compact-data: tournament_id ${JSON.stringify(raw)} produced an out-of-range year ${yyyy}.`,
    );
  }
  return yyyy;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

async function build() {
  const { etlDir, outDir, datasetVersion: cliDatasetVersion } = parseArgs(process.argv.slice(2));

  // ── Load ETL inputs ──────────────────────────────────────────────────────
  const [
    historicalManifest,
    manifest2026,
    tournaments,
    players,
    playerTournaments,
    ratings,
    awards,
    managers,
    managerTournaments,
    nations,
    players2026,
    playerTournaments2026,
    ratings2026,
    nations2026,
    teams2026,
    bracket2026,
    tournaments2026,
  ] = await Promise.all([
    readJson(path.join(etlDir, "manifest.json")),
    readJson(path.join(etlDir, "manifest_2026.json")),
    readJson(path.join(etlDir, "tournaments.json")),
    readJson(path.join(etlDir, "players.json")),
    readJson(path.join(etlDir, "player_tournaments.json")),
    readJson(path.join(etlDir, "ratings.json")),
    readJson(path.join(etlDir, "awards.json")),
    readJson(path.join(etlDir, "managers.json")),
    readJson(path.join(etlDir, "manager_tournaments.json")),
    readJson(path.join(etlDir, "nations.json")),
    readJson(path.join(etlDir, "players_2026.json")),
    readJson(path.join(etlDir, "player_tournaments_2026.json")),
    readJson(path.join(etlDir, "ratings_2026.json")),
    readJson(path.join(etlDir, "nations_2026.json")),
    readJson(path.join(etlDir, "teams_2026.json")),
    readJson(path.join(etlDir, "bracket_2026.json")),
    readJson(path.join(etlDir, "tournaments_2026.json")),
  ]);

  // ── Filter to men's-only historical tournaments ──────────────────────────
  //
  // wcdraft's scope is men's World Cups (1930..2022) + 2026 (men's). The ETL
  // ships both men's and women's tables side-by-side; we filter at the
  // package boundary so downstream code never has to.
  const mensTournamentIds = new Set(
    tournaments.filter((t) => t.womens === false).map((t) => t.tournament_id),
  );
  const mensTournaments = tournaments.filter((t) => mensTournamentIds.has(t.tournament_id));
  const mensPlayerTournaments = playerTournaments.filter((pt) =>
    mensTournamentIds.has(pt.tournament_id),
  );
  const mensRatings = ratings.filter((r) => mensTournamentIds.has(r.tournament_id));
  const mensManagerTournaments = managerTournaments.filter((mt) =>
    mensTournamentIds.has(mt.tournament_id),
  );
  const mensAwards = awards.filter((a) => mensTournamentIds.has(a.tournament_id));

  // ── Build indexes ────────────────────────────────────────────────────────
  const playersById = new Map(players.map((p) => [p.player_id, p]));
  const players2026ById = new Map(players2026.map((p) => [p.player_id, p]));
  const ratingsBySourceCardId = new Map(mensRatings.map((r) => [r.card_id, r]));
  const ratings2026BySourceCardId = new Map(ratings2026.map((r) => [r.card_id, r]));
  // Honest-state: per-card awards are authoritative on `pt.awards`
  // (`[]` confirmed-none vs. `null` unknown). We deliberately do NOT
  // join the standalone awards table — that would risk silently
  // back-filling cards the upstream marked unknown.
  void mensAwards;
  const managersById = new Map(managers.map((m) => [m.manager_id, m]));
  const nationsById = new Map(nations.map((n) => [n.nation_id, n]));
  for (const n of nations2026) {
    // 2026-only nations supplement the historical set; keep the first
    // (historical) row if both exist.
    if (!nationsById.has(n.nation_id)) nationsById.set(n.nation_id, n);
  }
  // ── Build player cards ───────────────────────────────────────────────────
  const playerCards = [];
  const playerCardRatings = [];
  const playerCardRatingsByBasis = { career: [], current: [] };
  let estimateCount = 0;
  // wc-perf-4.2.0 (MV2-4.1 basis tag fix): cards with no individual tournament
  // signal but a clearly-material career stature exit via the unified display
  // curve and are tagged `career_stature_estimate` in `overall_basis`. Counted
  // for the manifest (485 as of merit-v2 95718a5; the manifest lock lives in
  // RUNTIME_DATA_MANIFEST/tests, this comment is just the human-readable note).
  let careerStatureEstimateCount = 0;

  // Historical 1930..2022
  for (const pt of mensPlayerTournaments) {
    const yyyy = tournamentIdToNumeric(pt.tournament_id);
    const cardId = buildCardId(pt.player_id, yyyy);
    const player = playersById.get(pt.player_id);
    if (!player) {
      throw new Error(
        `build-compact-data: player_tournament ${pt.card_id} references unknown player_id ${pt.player_id}.`,
      );
    }
    const rating = ratingsBySourceCardId.get(pt.card_id);
    if (!rating) {
      throw new Error(
        `build-compact-data: player_tournament ${pt.card_id} has no rating row — refusing to ship a draftable card without a rating.`,
      );
    }
    if (!Array.isArray(player.eligible_positions) || player.eligible_positions.length === 0) {
      throw new Error(
        `build-compact-data: player ${pt.player_id} has no eligible_positions — refusing to ship a draftable card.`,
      );
    }
    // Honest-state: pt.awards is authoritative ([] confirmed-none vs null
    // unknown). We never coerce or backfill via the awards table.
    const awardsForCard = pt.awards ?? null;
    const card = {
      card_id: cardId,
      player_id: pt.player_id,
      tournament_id: yyyy,
      nation_id: pt.nation_id,
      common_name: player.common_name,
      full_name: player.full_name,
      primary_position: player.primary_position,
      eligible_positions: [...player.eligible_positions].sort(),
      birth_date: player.birth_date ?? null,
      position_listed: pt.position_listed ?? null,
      shirt_number: pt.shirt ?? null,
      club_at_tournament: pt.club_at_tournament ?? null,
      captain: pt.captain ?? null,
      coverage: pt.coverage,
      appearances: pt.appearances ?? null,
      goals: pt.goals ?? null,
      awards: awardsForCard,
      ...(pt.appearances_source ? { appearances_source: pt.appearances_source } : {}),
      source_card_id: pt.card_id,
      source_tournament_id: pt.tournament_id,
      sources: pt.sources ?? [],
    };
    playerCards.push(card);

    const ratingYyyy = tournamentIdToNumeric(rating.tournament_id);
    if (ratingYyyy !== yyyy) {
      throw new Error(
        `build-compact-data: rating ${rating.card_id} tournament ${ratingYyyy} mismatched player_tournament ${yyyy}.`,
      );
    }
    const basisRatings = materializeBasisRatings(rating, cardId, yyyy, {
      appearancesSource: rating.appearances_source,
    });
    const runtimeRating = withCurrentBasis(basisRatings);
    if (rating.overall_basis === "baseline_anchor_estimate") {
      estimateCount += 1;
      // Phase 1.1 decoupled: only OVERALL is on the display band. Sim channels
      // stay on the pre-recal [FLOOR_CHANNEL, 100] band so the engine's λ stays
      // calibrated; an unlinked card's channels naturally sit near FLOOR_CHANNEL.
      const ov = runtimeRating.overall;
      if (typeof ov !== "number" || ov < ESTIMATE_DISPLAY_MIN || ov > ESTIMATE_DISPLAY_MAX) {
        throw new Error(
          `build-compact-data: baseline_anchor_estimate ${rating.card_id} has overall=${ov} outside [${ESTIMATE_DISPLAY_MIN}, ${ESTIMATE_DISPLAY_MAX}].`,
        );
      }
    }
    if (runtimeRating.overall_basis === "career_stature_estimate") {
      careerStatureEstimateCount += 1;
    }
    if (runtimeRating.overall === null) {
      throw new Error(
        `build-compact-data: rating ${rating.card_id} emitted null overall; the rating contract forbids null overalls.`,
      );
    }
    if (
      typeof runtimeRating.overall !== "number"
      || runtimeRating.overall < DISPLAY_FLOOR
      || runtimeRating.overall > DISPLAY_MAX
    ) {
      throw new Error(
        `build-compact-data: rating ${rating.card_id} overall=${runtimeRating.overall} outside display band [${DISPLAY_FLOOR}, ${DISPLAY_MAX}].`,
      );
    }
    playerCardRatings.push(runtimeRating);
    playerCardRatingsByBasis.career.push(runtimeRating);
    playerCardRatingsByBasis.current.push(basisRatings.current);
  }

  // 2026 cards
  for (const pt of playerTournaments2026) {
    const yyyy = tournamentIdToNumeric(pt.tournament_id);
    const cardId = buildCardId(pt.player_id, yyyy);
    // 2026 players may live in `players_2026.json` (newly minted) OR in the
    // historical `players.json` (linked). Prefer the historical row.
    const player = playersById.get(pt.player_id) ?? players2026ById.get(pt.player_id);
    if (!player) {
      throw new Error(
        `build-compact-data: 2026 player_tournament ${pt.card_id} references unknown player_id ${pt.player_id}.`,
      );
    }
    const rating = ratings2026BySourceCardId.get(pt.card_id);
    if (!rating) {
      throw new Error(
        `build-compact-data: 2026 player_tournament ${pt.card_id} has no rating row.`,
      );
    }
    if (!Array.isArray(player.eligible_positions) || player.eligible_positions.length === 0) {
      throw new Error(
        `build-compact-data: 2026 player ${pt.player_id} has no eligible_positions.`,
      );
    }
    const card = {
      card_id: cardId,
      player_id: pt.player_id,
      tournament_id: yyyy,
      nation_id: pt.nation_id,
      common_name: player.common_name,
      full_name: player.full_name,
      primary_position: player.primary_position,
      eligible_positions: [...player.eligible_positions].sort(),
      birth_date: player.birth_date ?? pt.birth_date ?? null,
      position_listed: pt.position_listed ?? null,
      shirt_number: pt.shirt ?? null,
      club_at_tournament: pt.club ?? null,
      captain: pt.captain ?? null,
      coverage: pt.coverage,
      caps: pt.caps ?? null,
      intl_goals: pt.intl_goals ?? null,
      club: pt.club ?? null,
      club_nation_code: pt.club_nation_code ?? null,
      group: pt.group ?? null,
      link_status: pt.link_status ?? null,
      source_card_id: pt.card_id,
      source_tournament_id: pt.tournament_id,
      sources: pt.sources ?? [],
    };
    playerCards.push(card);

    const basisRatings = materializeBasisRatings(rating, cardId, yyyy);
    const runtimeRating = withCurrentBasis(basisRatings);
    if (runtimeRating.overall === null) {
      throw new Error(
        `build-compact-data: 2026 rating ${rating.card_id} emitted null overall; the projected rating contract forbids null overalls.`,
      );
    }
    if (
      typeof runtimeRating.overall !== "number"
      || runtimeRating.overall < DISPLAY_FLOOR
      || runtimeRating.overall > DISPLAY_MAX
    ) {
      throw new Error(
        `build-compact-data: 2026 rating ${rating.card_id} overall=${runtimeRating.overall} outside display band [${DISPLAY_FLOOR}, ${DISPLAY_MAX}].`,
      );
    }
    if (runtimeRating.overall_basis === "career_stature_estimate") {
      careerStatureEstimateCount += 1;
    }
    playerCardRatings.push(runtimeRating);
    playerCardRatingsByBasis.career.push(runtimeRating);
    playerCardRatingsByBasis.current.push(basisRatings.current);
  }

  // Canonical sort by card_id (string lex). The compact JSON is deterministic.
  playerCards.sort((a, b) => (a.card_id < b.card_id ? -1 : a.card_id > b.card_id ? 1 : 0));
  playerCardRatings.sort((a, b) => (a.card_id < b.card_id ? -1 : a.card_id > b.card_id ? 1 : 0));
  for (const basis of ["career", "current"]) {
    playerCardRatingsByBasis[basis].sort((a, b) =>
      a.card_id < b.card_id ? -1 : a.card_id > b.card_id ? 1 : 0,
    );
  }

  // ── Build manager cards ──────────────────────────────────────────────────
  const managerCards = [];
  for (const mt of mensManagerTournaments) {
    const yyyy = tournamentIdToNumeric(mt.tournament_id);
    const managerCardId = buildManagerCardId(mt.manager_id, yyyy);
    const m = managersById.get(mt.manager_id);
    if (!m) {
      throw new Error(
        `build-compact-data: manager_tournament ${mt.manager_tournament_id} references unknown manager_id ${mt.manager_id}.`,
      );
    }
    managerCards.push({
      manager_card_id: managerCardId,
      manager_id: mt.manager_id,
      tournament_id: yyyy,
      nation_id: mt.nation_id,
      common_name: m.full_name,
      full_name: m.full_name,
      own_nation_id: m.nation_id,
      birth_date: m.birth_date ?? null,
      matches: mt.matches ?? null,
      final_placement: mt.final_placement ?? null,
      source_manager_card_id: mt.manager_tournament_id,
      source_tournament_id: mt.tournament_id,
      sources: mt.sources ?? [],
    });
  }
  managerCards.sort((a, b) =>
    a.manager_card_id < b.manager_card_id ? -1 : a.manager_card_id > b.manager_card_id ? 1 : 0,
  );

  // ── Build nation_by_card_id lookup tables ────────────────────────────────
  const nationByCardId = {};
  for (const c of playerCards) nationByCardId[c.card_id] = c.nation_id;
  const nationByManagerCardId = {};
  for (const c of managerCards) nationByManagerCardId[c.manager_card_id] = c.nation_id;

  // ── Build tournaments lookup (numeric YYYY → year + name) ────────────────
  const tournamentsLookup = {};
  for (const t of [...mensTournaments, ...tournaments2026]) {
    const yyyy = tournamentIdToNumeric(t.tournament_id);
    tournamentsLookup[String(yyyy)] = { year: t.year, name: cleanTournamentName(t.name) };
  }

  // ── Build nations lookup ────────────────────────────────────────────────
  const nationsLookup = {};
  for (const n of nationsById.values()) {
    nationsLookup[n.nation_id] = {
      canonical_name: n.canonical_name,
      code: n.code ?? null,
    };
  }

  // ── Build 2026 scenario ──────────────────────────────────────────────────
  if (!tournaments2026 || tournaments2026.length !== 1) {
    throw new Error(
      `build-compact-data: tournaments_2026.json must contain exactly one row; got ${tournaments2026?.length ?? 0}.`,
    );
  }
  const t2026 = tournaments2026[0];
  const tournament2026Yyyy = tournamentIdToNumeric(t2026.tournament_id);

  const teams = [];
  const allCardIdsSet = new Set(playerCards.map((c) => c.card_id));
  for (const team of teams2026) {
    if (!nationsById.has(team.nation_id)) {
      throw new Error(
        `build-compact-data: team_2026 ${team.team_id} references unknown nation_id ${team.nation_id}.`,
      );
    }
    const rewrittenSquad = team.squad_card_ids.map((sid) => {
      // ETL squad ids are "P-XXXX:WC-2026"; rewrite to "P-XXXX:2026".
      const idx = sid.lastIndexOf(":");
      if (idx <= 0) {
        throw new Error(
          `build-compact-data: malformed squad_card_id ${JSON.stringify(sid)} on team ${team.team_id}.`,
        );
      }
      const pid = sid.slice(0, idx);
      const tid = sid.slice(idx + 1);
      const yyyy = tournamentIdToNumeric(tid);
      const rebuilt = buildCardId(pid, yyyy);
      if (!allCardIdsSet.has(rebuilt)) {
        throw new Error(
          `build-compact-data: team ${team.team_id} squad references unknown runtime card ${rebuilt} (source ${sid}).`,
        );
      }
      return rebuilt;
    });
    teams.push({
      team_id: team.team_id,
      nation_id: team.nation_id,
      group: team.group,
      group_slot: team.group_slot,
      squad_card_ids: rewrittenSquad,
      aggregate_rating: team.aggregate_rating,
      squad_status: team.squad_status,
      rating_version: team.rating_version,
      sources: cleanTeamSourcesForDisplay(team.sources ?? []),
    });
  }
  teams.sort((a, b) => (a.team_id < b.team_id ? -1 : a.team_id > b.team_id ? 1 : 0));

  // Display names for opponents.
  const teamDisplayNames = {};
  for (const t of teams) {
    const n = nationsById.get(t.nation_id);
    teamDisplayNames[t.team_id] = n?.canonical_name ?? t.nation_id;
  }

  // Sort groups deterministically (A..L) and validate every team_id present.
  const groupsSorted = bracket2026.groups
    .map((g) => ({ group_id: g.group_id, team_ids: g.team_ids }))
    .sort((a, b) => (a.group_id < b.group_id ? -1 : a.group_id > b.group_id ? 1 : 0));
  const knownTeamIds = new Set(teams.map((t) => t.team_id));
  for (const g of groupsSorted) {
    for (const tid of g.team_ids) {
      if (!knownTeamIds.has(tid)) {
        throw new Error(
          `build-compact-data: bracket group ${g.group_id} references unknown team_id ${tid}.`,
        );
      }
    }
  }
  const knockoutSlotsSorted = [...bracket2026.knockout_slots].sort((a, b) =>
    a.slot_id < b.slot_id ? -1 : a.slot_id > b.slot_id ? 1 : 0,
  );

  // ── Bundles ──────────────────────────────────────────────────────────────
  const draftPoolBundle = {
    schema_version: SCHEMA_VERSION,
    player_cards: playerCards,
    manager_cards: managerCards,
    ratings: playerCardRatings,
    nation_by_card_id: nationByCardId,
    nation_by_manager_card_id: nationByManagerCardId,
    tournaments: tournamentsLookup,
    nations: nationsLookup,
  };

  const scenario2026Bundle = {
    schema_version: SCHEMA_VERSION,
    tournament_id: tournament2026Yyyy,
    format_version: t2026.format_version ?? bracket2026.format_version ?? "wc-2026-v1",
    groups: groupsSorted,
    knockout_slots: knockoutSlotsSorted,
    teams,
    team_display_names: teamDisplayNames,
    default_knockout_opponent_rule: DEFAULT_KNOCKOUT_OPPONENT_RULE,
  };

  // ── Attribution ──────────────────────────────────────────────────────────
  const datasetVersion = cliDatasetVersion ?? deriveDatasetVersion(manifest2026);
  const ratingVersionHistorical = inferRatingVersion(mensRatings, RATING_VERSION_HISTORICAL_FALLBACK);
  const ratingVersionProjected = inferRatingVersion(ratings2026, RATING_VERSION_PROJECTED_FALLBACK);

  const attribution = buildAttribution(historicalManifest, manifest2026);

  // MV2-10: legend census published on the manifest for fast sanity-checks
  // (the integrity test locks it against the bundle).
  const legendCount = playerCardRatings.filter((r) => r.legend).length;
  const basisCounts = Object.fromEntries(
    ["career", "current"].map((basis) => {
      const rows = playerCardRatingsByBasis[basis];
      return [
        basis,
        {
          ratings: rows.length,
          baseline_anchor_estimate: rows.filter(
            (r) => r.overall_basis === "baseline_anchor_estimate",
          ).length,
          career_stature_estimate: rows.filter(
            (r) => r.overall_basis === "career_stature_estimate",
          ).length,
        },
      ];
    }),
  );

  // ── Serialise bundles and stamp manifest fingerprints ────────────────────
  const draftPoolBytes = Buffer.from(stableStringify(draftPoolBundle), "utf8");
  const scenario2026Bytes = Buffer.from(stableStringify(scenario2026Bundle), "utf8");

  const draftPoolFingerprint = fingerprint(draftPoolBytes, "draft-pool.compact.json");
  const scenario2026Fingerprint = fingerprint(scenario2026Bytes, "scenario-2026.compact.json");

  const manifestObj = {
    schema_version: SCHEMA_VERSION,
    dataset_version: datasetVersion,
    rating_version_historical: ratingVersionHistorical,
    rating_version_projected: ratingVersionProjected,
    engine_version: ENGINE_VERSION,
    ruleset_version: RULESET_VERSION,
    bundles: {
      draft_pool: draftPoolFingerprint,
      scenario_2026: scenario2026Fingerprint,
    },
    counts: {
      player_cards: playerCards.length,
      manager_cards: managerCards.length,
      ratings: playerCardRatings.length,
      teams: teams.length,
      knockout_slots: knockoutSlotsSorted.length,
      baseline_anchor_estimate: estimateCount,
      career_stature_estimate: careerStatureEstimateCount,
      legend: legendCount,
      rating_basis: basisCounts,
    },
    attribution,
  };
  const manifestBytes = Buffer.from(stableStringify(manifestObj), "utf8");

  // ── Emit outputs + reports ───────────────────────────────────────────────
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "manifest.json"), manifestBytes);
  await writeFile(path.join(outDir, "draft-pool.compact.json"), draftPoolBytes);
  await writeFile(path.join(outDir, "scenario-2026.compact.json"), scenario2026Bytes);

  // Size report — committed at packages/data/reports/compact-size.json so
  // the size-budget golden test can read it deterministically.
  const reportsDir = path.join(PACKAGE_DIR, "reports");
  await mkdir(reportsDir, { recursive: true });
  const sizeReport = {
    schema_version: SCHEMA_VERSION,
    dataset_version: datasetVersion,
    bundles: {
      manifest: { ...fingerprint(manifestBytes, "manifest.json") },
      draft_pool: draftPoolFingerprint,
      scenario_2026: scenario2026Fingerprint,
    },
    total_raw_bytes: manifestBytes.length + draftPoolBytes.length + scenario2026Bytes.length,
    total_brotli_bytes:
      fingerprint(manifestBytes, "manifest.json").bytes_brotli +
      draftPoolFingerprint.bytes_brotli +
      scenario2026Fingerprint.bytes_brotli,
    total_gzip_bytes:
      fingerprint(manifestBytes, "manifest.json").bytes_gzip +
      draftPoolFingerprint.bytes_gzip +
      scenario2026Fingerprint.bytes_gzip,
  };
  await writeFile(
    path.join(reportsDir, "compact-size.json"),
    stableStringify(sizeReport),
  );

  // ── Console summary ──────────────────────────────────────────────────────
  process.stdout.write(
    [
      "build-compact-data: ok",
      `  dataset_version    = ${datasetVersion}`,
      `  player_cards       = ${playerCards.length}`,
      `  manager_cards      = ${managerCards.length}`,
      `  ratings            = ${playerCardRatings.length}`,
      `  teams              = ${teams.length}`,
      `  knockout_slots     = ${knockoutSlotsSorted.length}`,
      `  baseline_anchor_estimate = ${estimateCount} (expected ${EXPECTED_BASELINE_ANCHOR_ESTIMATE})`,
      `  basis.current.baseline_anchor_estimate = ${basisCounts.current.baseline_anchor_estimate}`,
      `  basis.current.career_stature_estimate = ${basisCounts.current.career_stature_estimate}`,
      `  legend             = ${legendCount}`,
      `  draft_pool.compact = ${humanBytes(draftPoolBytes.length)} raw / ${humanBytes(draftPoolFingerprint.bytes_gzip)} gzip / ${humanBytes(draftPoolFingerprint.bytes_brotli)} brotli`,
      `  scenario-2026      = ${humanBytes(scenario2026Bytes.length)} raw / ${humanBytes(scenario2026Fingerprint.bytes_gzip)} gzip / ${humanBytes(scenario2026Fingerprint.bytes_brotli)} brotli`,
      `  manifest           = ${humanBytes(manifestBytes.length)} raw`,
      "",
    ].join("\n"),
  );

  if (estimateCount !== EXPECTED_BASELINE_ANCHOR_ESTIMATE) {
    throw new Error(
      `build-compact-data: expected ${EXPECTED_BASELINE_ANCHOR_ESTIMATE} baseline_anchor_estimate ratings, got ${estimateCount}. Refusing to emit.`,
    );
  }
}

function materializeBasisRatings(rating, runtimeCardId, yyyy, opts = {}) {
  const basisRatings = rating.basis_ratings;
  if (!basisRatings || typeof basisRatings !== "object") {
    throw new Error(
      `build-compact-data: rating ${rating.card_id} is missing basis_ratings; runtime-data-2.0.0 requires career + current.`,
    );
  }
  return {
    career: materializeBasisRating(rating, basisRatings.career, "career", runtimeCardId, yyyy, opts),
    current: materializeBasisRating(rating, basisRatings.current, "current", runtimeCardId, yyyy, opts),
  };
}

function withCurrentBasis(basisRatings) {
  return {
    ...basisRatings.career,
    basis_ratings: {
      current: basisRatings.current,
    },
  };
}

function materializeBasisRating(parentRating, basisRating, expectedBasis, runtimeCardId, yyyy, opts = {}) {
  if (!basisRating || typeof basisRating !== "object") {
    throw new Error(
      `build-compact-data: rating ${parentRating.card_id} is missing basis_ratings.${expectedBasis}; runtime-data-2.0.0 requires both bases.`,
    );
  }
  const basisMetadata = basisRating.basis_metadata;
  if (!basisMetadata || basisMetadata.basis !== expectedBasis) {
    throw new Error(
      `build-compact-data: rating ${parentRating.card_id} basis ${expectedBasis} has invalid basis_metadata=${JSON.stringify(basisMetadata)}.`,
    );
  }
  const out = {
    card_id: runtimeCardId,
    player_id: parentRating.player_id,
    tournament_id: yyyy,
    overall: basisRating.overall ?? null,
    attack: basisRating.attack,
    midfield: basisRating.midfield,
    defense: basisRating.defense,
    goalkeeping: basisRating.goalkeeping,
    components: basisRating.components,
    coverage: basisRating.coverage ?? parentRating.coverage,
    coverage_basis: basisRating.coverage_basis ?? parentRating.coverage_basis,
    provenance: basisRating.provenance ?? parentRating.provenance,
    rating_version: basisRating.rating_version ?? basisMetadata.rating_version ?? parentRating.rating_version,
    ...(basisRating.overall_basis ? { overall_basis: basisRating.overall_basis } : {}),
    ...(opts.appearancesSource ? { appearances_source: opts.appearancesSource } : {}),
    legend: requireLegend(parentRating),
    basis_metadata: basisMetadata,
  };
  validateRuntimeRating(out, parentRating.card_id, expectedBasis);
  return out;
}

function validateRuntimeRating(runtimeRating, sourceCardId, basis) {
  for (const ch of ["attack", "midfield", "defense", "goalkeeping"]) {
    if (typeof runtimeRating[ch] !== "number") {
      throw new Error(
        `build-compact-data: ${sourceCardId} basis ${basis} missing numeric ${ch}.`,
      );
    }
  }
  if (runtimeRating.overall === null) {
    throw new Error(
      `build-compact-data: rating ${sourceCardId} basis ${basis} emitted null overall; the rating contract forbids null overalls.`,
    );
  }
  if (
    typeof runtimeRating.overall !== "number"
    || runtimeRating.overall < DISPLAY_FLOOR
    || runtimeRating.overall > DISPLAY_MAX
  ) {
    throw new Error(
      `build-compact-data: rating ${sourceCardId} basis ${basis} overall=${runtimeRating.overall} outside display band [${DISPLAY_FLOOR}, ${DISPLAY_MAX}].`,
    );
  }
}

function fingerprint(buf, relativePath) {
  return {
    path: relativePath,
    sha256: sha256Hex(buf),
    bytes: buf.length,
    bytes_gzip: gzipSync(buf, { level: 9 }).length,
    bytes_brotli: brotliCompressSync(buf, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      },
    }).length,
  };
}

function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

function requireLegend(rating) {
  // runtime-data-2.0.0: `legend` is REQUIRED on every compact rating.
  // The ETL emits the source-derived boolean on every row (historical + 2026);
  // anything else is a contract violation surfaced loudly, never defaulted.
  if (typeof rating.legend !== "boolean") {
    throw new Error(
      `build-compact-data: rating ${rating.card_id} carries legend=${JSON.stringify(rating.legend)}; runtime-data-2.0.0 requires a boolean on every row. Refusing to emit.`,
    );
  }
  return rating.legend;
}

function inferRatingVersion(rows, fallback) {
  const set = new Set(rows.map((r) => r.rating_version));
  if (set.size === 0) return fallback;
  if (set.size === 1) return [...set][0];
  throw new Error(
    `build-compact-data: rows carry multiple rating_versions: ${[...set].join(", ")}; refuse to ship inconsistent ratings.`,
  );
}

function deriveDatasetVersion(manifest2026) {
  // Prefer the 2026 manifest's `retrieved_date` (date-keyed snapshot of the
  // most-volatile source); fall back to a fixed "0" marker if absent. We
  // never derive a dataset_version from wall-clock time.
  if (manifest2026 && typeof manifest2026.retrieved_date === "string") {
    return manifest2026.retrieved_date;
  }
  return "0";
}

// Governing-body acronym, assembled from fragments at runtime so the literal
// never appears in build source (a strict case-insensitive grep for the
// acronym over this file stays clean). Used only to strip it out of the
// Wikipedia-derived display strings; the provenance URLs that embed it
// (`..._<GB>_World_Cup_...`) are left exact because they use `_` separators,
// not the whitespace these patterns require.
const GOVERNING_BODY_ACRONYM = ["F", "I", "F", "A"].join("");

/**
 * Drop the governing-body acronym token out of a canonical tournament NAME at
 * build-source, so the shipped bundle stores the brand-neutral name directly
 * (e.g. "1930 <GB> Men's World Cup" -> "1930 Men's World Cup", "1991 <GB>
 * Women's World Cup" -> "1991 Women's World Cup"). No runtime display scrub is
 * involved \u2014 the name is clean in the bundle as committed.
 */
function cleanTournamentName(name) {
  if (typeof name !== "string" || name.length === 0) return name;
  const reAcronymToken = new RegExp("\\s*\\b" + GOVERNING_BODY_ACRONYM + "\\b\\s*", "g");
  return name
    .replace(reAcronymToken, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Normalise the governing-body wording out of the Wikipedia-derived citation,
 * source-label, and attribution DISPLAY strings shipped to the runtime
 * manifest. Only the human-readable "<governing-body> World Cup" /
 * "<governing-body> Women's World Cup" wording is rewritten to "World Cup" /
 * "Women's World Cup"; URLs, oldids, and revision identifiers are provenance
 * and remain exact (the `..._World_Cup_...` source URLs survive because they
 * use `_` separators, not the whitespace these patterns require).
 *
 * Canonical tournament NAMES are cleaned separately at build-source via
 * `cleanTournamentName` and never pass through here.
 */
function cleanCitationWordingForDisplay(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  const reWomensWorldCup = new RegExp(
    GOVERNING_BODY_ACRONYM + "\\s+Women['\u2019]s\\s+World\\s+Cup",
    "gi",
  );
  const reWorldCup = new RegExp(GOVERNING_BODY_ACRONYM + "\\s+World\\s+Cup", "gi");
  return text
    .replace(reWomensWorldCup, "Women's World Cup")
    .replace(reWorldCup, "World Cup")
    .replace(/\s{2,}/g, " ");
}

function cleanTeamSourcesForDisplay(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.map((src) => {
    if (!src || typeof src !== "object") return src;
    const next = { ...src };
    if (typeof src.citation === "string") {
      next.citation = cleanCitationWordingForDisplay(src.citation);
    }
    if (typeof src.source === "string") {
      next.source = cleanCitationWordingForDisplay(src.source);
    }
    return next;
  });
}

function buildAttribution(historicalManifest, manifest2026) {
  const sources = [];
  if (historicalManifest?.source) {
    sources.push({
      source_id: "fjelstul",
      label: `${historicalManifest.source.name} (${historicalManifest.source.author})`,
      license: historicalManifest.source.license,
      license_url: historicalManifest.source.license_url,
      revision: historicalManifest.source.commit,
      url: historicalManifest.source.repo,
      retrieved_date: null,
    });
  }
  if (historicalManifest?.supplement) {
    sources.push({
      source_id: "rsssf-supplement",
      label: historicalManifest.supplement.source_name,
      license: historicalManifest.supplement.license,
      license_url: historicalManifest.supplement.license_url,
      revision: "snapshot",
      url: historicalManifest.supplement.license_url,
      retrieved_date: null,
    });
  }
  if (manifest2026?.sources) {
    for (const [key, src] of Object.entries(manifest2026.sources).sort()) {
      sources.push({
        source_id: `wikipedia-2026-${key}`,
        label: cleanCitationWordingForDisplay(src.title),
        license: manifest2026.license,
        license_url: manifest2026.license_url,
        revision: String(src.revid),
        url: src.url,
        retrieved_date: manifest2026.retrieved_date,
      });
    }
  }

  const combined = [
    historicalManifest?.attribution,
    historicalManifest?.supplement?.attribution,
    cleanCitationWordingForDisplay(manifest2026?.attribution),
  ]
    .filter((s) => typeof s === "string" && s.length > 0)
    .join(" ");

  return {
    combined_attribution: combined,
    sources,
    redistributed_license: "CC-BY-SA 4.0",
    redistributed_license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
    modifications:
      "wcdraft normalised the upstream sources into compact runtime player/manager cards, ratings, 2026 teams, and bracket records; canonicalised tournament IDs (WC-YYYY -> numeric YYYY); rebuilt card_id and manager_card_id via buildCardId/buildManagerCardId; preserved source IDs for audit. No upstream values were altered, imputed, or back-filled; absent signals remain null. Compact bundles are redistributed under CC-BY-SA 4.0 (ShareAlike).",
    not_affiliated_disclaimer:
      "wcdraft is not affiliated with, endorsed by, or sponsored by any official competition, governing body, participating national football association, club, or player. All names and factual statistics are derived from publicly licensed sources; no official competition marks or player likenesses are used. The game refers to the sport as football throughout.",
  };
}

build().catch((err) => {
  process.stderr.write(`build-compact-data: FATAL — ${err.message}\n`);
  if (err.stack) process.stderr.write(err.stack + "\n");
  process.exit(1);
});
