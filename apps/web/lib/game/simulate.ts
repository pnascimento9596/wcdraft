// I3.7 — build a SimWorld from the compact runtime data and run the
// tournament deterministically.
//
// DESIGN
// ------
// `buildSimWorldInputs` assembles the inputs `@wcdraft/core` needs to run a
// tournament from the persisted draft + the compact runtime bundles. Every
// field is plain-JSON serialisable so the same payload can be posted to a
// Web Worker (see `sim.worker.ts`) without losing fidelity.
//
// `runSimulationSync` performs the actual simulation: builds the scenario
// (deterministic from `parent_seed`), runs `runTournamentFull`, and returns
// the `PersistedSimulation` shape the run-record persists. It is pure,
// synchronous, and free of browser entropy — usable from the main thread or
// the worker.
//
// `runSimulation` is the consumer-facing helper that prefers a Web Worker
// (avoids blocking the UI) and falls back to the synchronous main-thread
// path when worker construction is unavailable.
//
// DETERMINISM
// -----------
// All randomness flows from `parent_seed` via `deriveSubseed`. We never read
// `Date.now()` / `Math.random()` / `crypto` / `performance.now()` as inputs
// to the engine. Duration telemetry is captured *after* the deterministic
// run and never threads back into the engine.
//
// HONEST-STATE
// ------------
// Missing IDs / missing ratings are hard failures via `MissingRecordError`.
// No silent zeros, no fabricated cards.

import {
  buildRunScenario,
  runTournamentFull,
  type Bracket2026,
  type ManagerTournament,
  type Position,
  type Rating,
  type RunScenario,
  type SimWorld,
  type Team2026,
} from "@wcdraft/core";
import type { Scenario2026Bundle } from "@wcdraft/data";

import { managerTournamentFor } from "./adapters";
import type { GameData } from "./data";
import { MissingRecordError } from "./errors";
import { runWithSimulationWorker, SimulationWorkerBusyError } from "./sim-worker-client";
import { projectTeamSheetDraft } from "./team-sheet";
import type {
  PersistedKnockoutLadderMeta,
  PersistedKnockoutLadderRoundMeta,
  PersistedSimulation,
  RunRecordV1,
  SimulationTelemetry,
} from "./run-record";

// ─── SimWorld assembly ───────────────────────────────────────────────────────

/**
 * Resolved sim inputs the engine consumes. Every field is plain JSON, so the
 * payload survives `postMessage` to a worker without losing fidelity.
 */
export interface ResolvedSimInputs {
  /** Pre-resolved `SimWorld` (matches the engine's required 4th arg). */
  world: SimWorld;
  /** The 48 published 2026 teams, used to build the `RunScenario`. */
  teams: Team2026[];
  /** Real 2026 bracket — feeds the R32 constraint pass inside the engine. */
  bracket: Bracket2026;
}

/** Worker payload after deterministic scenario construction and clone pruning. */
export interface ResolvedWorkerSimInputs {
  /** Pre-resolved `SimWorld`, pruned to the worker-visible fields the run uses. */
  world: SimWorld;
  /** Deterministic scoped run path, built on the main thread before postMessage. */
  scenario: RunScenario;
}

/**
 * Build the resolved sim inputs from the loaded game data + scenario bundle +
 * persisted draft. Fails loudly on any missing rating / manager join.
 */
export function buildSimWorldInputs(
  gameData: GameData,
  scenario: Scenario2026Bundle,
  record: RunRecordV1,
): ResolvedSimInputs {
  const draft = record.draft;

  // Ratings for every card in the user squad (starter + bench). The engine
  // throws if a starter is missing a rating; bench cards may have ratings or
  // not, but we collect every available one for completeness.
  //
  // SELECTED BASIS: the engine consumes the channels for the run's recorded
  // `rating_basis`. `career` feeds the top-level RuntimeRating row (the Career
  // compatibility alias) UNCHANGED — byte-identical to before this seam
  // existed. `current` feeds `basis_ratings.current` (a Rating in its own
  // right), so a Current run actually simulates on the at-tournament strength,
  // not the career numbers the player saw masked behind a chip. Opponents are
  // the fixed 2026 field and are not re-rated by basis. This is NOT display-
  // only: the basis decision changes the sim inputs.
  const useCurrent = draft.rating_basis === "current";
  const ratings: Record<string, Rating> = {};
  const eligiblePositionsByCardId: Record<string, readonly Position[]> = {};
  for (const slot of draft.squad) {
    if (slot.card_id === null) continue;
    const cardId = slot.card_id as string;
    const r = gameData.indexes.ratingByCardId.get(cardId);
    if (!r) {
      throw new MissingRecordError("rating", cardId, `for drafted squad slot ${slot.slot_id}`);
    }
    ratings[cardId] = useCurrent ? r.basis_ratings.current : r;
    const card = gameData.indexes.playerByCardId.get(cardId);
    if (!card || card.eligible_positions.length === 0) {
      throw new MissingRecordError(
        "player_card",
        cardId,
        `eligibility for drafted squad slot ${slot.slot_id}`,
      );
    }
    eligiblePositionsByCardId[cardId] = card.eligible_positions;
  }

  // Opponents = every Team2026 in the scenario bundle (sim only walks the
  // user's path but the opponent ladder may pick from any non-group team).
  const opponents: Record<string, Team2026> = {};
  for (const t of scenario.teams) {
    opponents[t.team_id] = {
      team_id: t.team_id,
      nation_id: t.nation_id,
      group: t.group,
      group_slot: t.group_slot,
      squad_card_ids: t.squad_card_ids,
      aggregate_rating: t.aggregate_rating,
      squad_status: t.squad_status,
      rating_version: t.rating_version,
      sources: t.sources,
    } satisfies Team2026;
  }

  // Manager tournament — only when one was drafted. The engine reads
  // synergy on a per-card_id basis through this map.
  const managerTournaments: Record<string, ManagerTournament> = {};
  if (draft.manager_card_id !== null) {
    const mt = managerTournamentFor(gameData.indexes, draft.manager_card_id);
    managerTournaments[draft.manager_card_id as string] = mt;
  }

  const bracket: Bracket2026 = {
    groups: scenario.groups,
    knockout_slots: scenario.knockout_slots,
  };

  const tournamentYears: Record<string, number> = {};
  for (const [tournamentId, tournament] of gameData.indexes.tournamentById) {
    tournamentYears[String(tournamentId)] = tournament.year;
  }

  const world: SimWorld = {
    ratings,
    eligiblePositionsByCardId,
    opponents,
    managerTournaments,
    nationByCardId: gameData.nationByCardId,
    tournamentYears,
    bracket,
    // scoringConfig omitted — engine defaults to DEFAULT_SCORING_CONFIG.
  };

  return { world, teams: scenario.teams as Team2026[], bracket };
}

/**
 * Build the worker-specific payload. The synchronous path keeps the full local
 * inputs; only the structured-clone boundary is narrowed.
 */
export function buildWorkerSimInputs(
  gameData: GameData,
  scenarioBundle: Scenario2026Bundle,
  record: RunRecordV1,
): ResolvedWorkerSimInputs {
  const inputs = buildSimWorldInputs(gameData, scenarioBundle, record);
  const { scenario } = buildRunScenario({
    parent_seed: record.parent_seed,
    teams: inputs.teams,
    bracket: inputs.bracket,
    ruleset_version: record.versions.ruleset_version,
  });
  return {
    world: narrowWorldForWorker(inputs.world, record),
    scenario,
  };
}

function narrowWorldForWorker(world: SimWorld, record: RunRecordV1): SimWorld {
  const neededNationCardIds = new Set<string>();
  for (const slot of record.draft.squad) {
    if (slot.card_id !== null) neededNationCardIds.add(slot.card_id as string);
  }

  const nationByCardId: Record<string, string> = {};
  const eligiblePositionsByCardId: Record<string, readonly Position[]> = {};
  for (const cardId of neededNationCardIds) {
    const nation = world.nationByCardId?.[cardId];
    if (nation !== undefined) nationByCardId[cardId] = nation;
    const eligible = world.eligiblePositionsByCardId?.[cardId];
    if (eligible !== undefined) eligiblePositionsByCardId[cardId] = eligible;
  }

  return {
    ...world,
    nationByCardId,
    eligiblePositionsByCardId,
  };
}

// ─── Deterministic simulation ─────────────────────────────────────────────────

export interface SimulationOptions {
  /**
   * When provided, used to measure wall-clock duration of the simulation.
   * Must not be passed *into* the engine. Defaults to `performance.now`
   * when available; falls back to `null` (no telemetry).
   */
  clock?: () => number;
}

/**
 * Result of a synchronous simulation. The `simulation` field is the
 * deterministic payload that's safe to persist + golden-compare; `telemetry`
 * carries the wall-clock duration outside of that determinism guarantee.
 */
export interface SyncSimulationResult {
  simulation: PersistedSimulation;
  telemetry: SimulationTelemetry;
}

/**
 * Run the tournament synchronously. Returns both:
 *   - `simulation`: the `PersistedSimulation` payload the run-record persists,
 *     byte-identical across runs with identical (`record.parent_seed`,
 *     `gameData`, `scenario`) inputs;
 *   - `telemetry`: wall-clock duration measured around the run, NOT covered
 *     by the determinism guarantee.
 */
export function runSimulationSync(
  gameData: GameData,
  scenario: Scenario2026Bundle,
  record: RunRecordV1,
  opts: SimulationOptions = {},
): SyncSimulationResult {
  const prepared = prepareTeamSheetRecord(gameData, record);
  const { world, teams, bracket } = buildSimWorldInputs(gameData, scenario, prepared);
  const clock = opts.clock ?? defaultClock();

  const t0 = clock ? clock() : null;

  const { scenario: runScenario, meta: scenarioMeta } = buildRunScenario({
    parent_seed: record.parent_seed,
    teams,
    bracket,
    ruleset_version: record.versions.ruleset_version,
  });
  void scenarioMeta; // scenario_seed already on `runScenario.scenario_seed`

  const result = runTournamentFull(prepared.draft, runScenario, prepared.parent_seed, world);

  const t1 = clock ? clock() : null;
  const duration_ms = t0 !== null && t1 !== null ? t1 - t0 : null;

  return {
    simulation: {
      scenario: runScenario,
      run: result.run,
      matches: result.matches,
      group_stage: result.group_stage,
      knockout_ladder_meta: toPersistedLadderMeta(result.knockout_ladder_meta),
    },
    telemetry: { duration_ms },
  };
}

/**
 * Map the engine's `KnockoutLadderMeta` (typed inside `engine/`) to the
 * JSON-shaped persisted form on the run-record. The two shapes are
 * structurally identical at the value level; we deep-copy through stringly-
 * typed enums so persisted records don't depend on engine-internal type
 * exports.
 */
function toPersistedLadderMeta(meta: {
  rounds: Array<{
    round: string;
    opponent_team_id: string;
    bracket_constrained: boolean;
    fallback: boolean;
    fallback_reason: string | null;
    user_slot_id: string | null;
    opposite_slot_id: string | null;
    candidate_group_ids: string[];
  }>;
}): PersistedKnockoutLadderMeta {
  return {
    rounds: meta.rounds.map<PersistedKnockoutLadderRoundMeta>((r) => ({
      round: r.round,
      opponent_team_id: r.opponent_team_id,
      bracket_constrained: r.bracket_constrained,
      fallback: r.fallback,
      fallback_reason: r.fallback_reason,
      user_slot_id: r.user_slot_id,
      opposite_slot_id: r.opposite_slot_id,
      candidate_group_ids: [...r.candidate_group_ids],
    })),
  };
}

function defaultClock(): (() => number) | null {
  // Browser: prefer high-res perf timer. Node tests: undefined → null.
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return () => performance.now();
  }
  return null;
}

// ─── Async helper (worker-preferred, main-thread fallback) ───────────────────

export interface RunSimulationResult {
  /** "worker" when the simulation executed off the main thread. */
  via: "worker" | "main";
  /** The deterministic payload; safe to persist via `setRunSimulation`. */
  simulation: PersistedSimulation;
  /** Wall-clock telemetry — NOT part of the determinism guarantee. */
  telemetry: SimulationTelemetry;
  /**
   * Non-fatal warning to surface to the user (e.g. "worker unavailable, ran
   * on main thread"). Null when nothing notable happened.
   */
  warning: string | null;
}

export interface RunSimulationOptions {
  signal?: AbortSignal;
  /** Test seam for the reusable worker client. */
  runWorker?: typeof runWithSimulationWorker;
}

/**
 * Run the tournament off the main thread when possible. Falls back to
 * `runSimulationSync` if the Worker constructor is missing or throws.
 *
 * The caller is responsible for surfacing the returned `warning` to the user
 * if non-null. We deliberately do NOT swallow it.
 */
export function runSimulation(
  gameData: GameData,
  scenario: Scenario2026Bundle,
  record: RunRecordV1,
  options: RunSimulationOptions = {},
): Promise<RunSimulationResult> {
  return runSimulationAsync(
    gameData,
    scenario,
    record,
    options.signal,
    options.runWorker ?? runWithSimulationWorker,
  );
}

async function runSimulationAsync(
  gameData: GameData,
  scenario: Scenario2026Bundle,
  record: RunRecordV1,
  signal?: AbortSignal,
  runWorker: typeof runWithSimulationWorker = runWithSimulationWorker,
): Promise<RunSimulationResult> {
  if (signal?.aborted) throw new DOMException("Simulation cancelled", "AbortError");
  const prepared = prepareTeamSheetRecord(gameData, record);
  const inputs = buildWorkerSimInputs(gameData, scenario, prepared);
  const input: Omit<WorkerInput, "request_id"> = {
    kind: "run",
    draft: prepared.draft,
    parent_seed: prepared.parent_seed,
    world: inputs.world,
    scenario: inputs.scenario,
  };
  try {
    const output = await runWorker(input, signal);
    return {
      via: "worker",
      simulation: output.simulation,
      telemetry: output.telemetry,
      warning: null,
    };
  } catch (error) {
    if (
      (error instanceof Error && error.name === "AbortError") ||
      error instanceof SimulationWorkerBusyError
    ) {
      throw error;
    }
    return runMainThread(
      gameData,
      scenario,
      prepared,
      `simulation worker failed (${error instanceof Error ? error.message : String(error)}); ran on main thread`,
      signal,
    );
  }
}

function prepareTeamSheetRecord(gameData: GameData, record: RunRecordV1): RunRecordV1 {
  if (record.arrangement === undefined) return record;
  const projected: RunRecordV1 = {
    ...record,
    draft: projectTeamSheetDraft(gameData, record),
  };
  delete projected.arrangement;
  return projected;
}

async function runMainThread(
  gameData: GameData,
  scenario: Scenario2026Bundle,
  record: RunRecordV1,
  warning: string | null,
  signal?: AbortSignal,
): Promise<RunSimulationResult> {
  // Yield to the event loop so the UI gets a paint before the work runs.
  await new Promise<void>((r) => setTimeout(r, 0));
  if (signal?.aborted) throw new DOMException("Simulation cancelled", "AbortError");
  const { simulation, telemetry } = runSimulationSync(gameData, scenario, record);
  if (signal?.aborted) throw new DOMException("Simulation cancelled", "AbortError");
  return { via: "main", simulation, telemetry, warning };
}

// ─── Worker message protocol ─────────────────────────────────────────────────

export interface WorkerInput {
  request_id: number;
  kind: "run";
  draft: RunRecordV1["draft"];
  parent_seed: string;
  world: SimWorld;
  scenario: RunScenario;
}

export type WorkerOutput =
  | {
      request_id: number;
      kind: "done";
      simulation: PersistedSimulation;
      telemetry: SimulationTelemetry;
    }
  | { request_id: number; kind: "error"; message: string; stack?: string };

/**
 * Worker-side entry point — called by `sim.worker.ts`. Exported so that path
 * can be unit-tested without spinning up a real Worker.
 */
export function handleWorkerInput(input: WorkerInput): WorkerOutput {
  try {
    const t0 =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : null;
    const result = runTournamentFull(input.draft, input.scenario, input.parent_seed, input.world);
    const t1 =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : null;
    return {
      request_id: input.request_id,
      kind: "done",
      simulation: {
        scenario: input.scenario,
        run: result.run,
        matches: result.matches,
        group_stage: result.group_stage,
        knockout_ladder_meta: toPersistedLadderMeta(result.knockout_ladder_meta),
      },
      telemetry: {
        duration_ms: t0 !== null && t1 !== null ? t1 - t0 : null,
      },
    };
  } catch (err) {
    return {
      request_id: input.request_id,
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
  }
}

export type { RunScenario };
