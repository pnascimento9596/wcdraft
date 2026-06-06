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
  type Rating,
  type RunScenario,
  type SimWorld,
  type Team2026,
} from "@wcdraft/core";
import type { Scenario2026Bundle } from "@wcdraft/data";

import { managerTournamentFor } from "./adapters";
import type { GameData } from "./data";
import { MissingRecordError } from "./errors";
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
  const ratings: Record<string, Rating> = {};
  for (const slot of draft.squad) {
    if (slot.card_id === null) continue;
    const cardId = slot.card_id as string;
    const r = gameData.indexes.ratingByCardId.get(cardId);
    if (!r) {
      throw new MissingRecordError(
        "rating",
        cardId,
        `for drafted squad slot ${slot.slot_id}`,
      );
    }
    ratings[cardId] = r;
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

  const world: SimWorld = {
    ratings,
    opponents,
    managerTournaments,
    nationByCardId: gameData.nationByCardId,
    bracket,
    // scoringConfig omitted — engine defaults to DEFAULT_SCORING_CONFIG.
  };

  return { world, teams: scenario.teams as Team2026[], bracket };
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
  const { world, teams, bracket } = buildSimWorldInputs(gameData, scenario, record);
  const clock = opts.clock ?? defaultClock();

  const t0 = clock ? clock() : null;

  const { scenario: runScenario, meta: scenarioMeta } = buildRunScenario({
    parent_seed: record.parent_seed,
    teams,
    bracket,
    ruleset_version: record.versions.ruleset_version,
  });
  void scenarioMeta; // scenario_seed already on `runScenario.scenario_seed`

  const result = runTournamentFull(record.draft, runScenario, record.parent_seed, world);

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
): Promise<RunSimulationResult> {
  return new Promise<RunSimulationResult>((resolve, reject) => {
    // Decide if we can use a worker. SSR / Node test envs have no Worker.
    const canUseWorker =
      typeof window !== "undefined" && typeof Worker !== "undefined";
    if (!canUseWorker) {
      runMainThread(gameData, scenario, record, "worker unavailable in this environment")
        .then(resolve, reject);
      return;
    }

    let worker: Worker;
    try {
      worker = new Worker(new URL("./sim.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (err) {
      runMainThread(
        gameData,
        scenario,
        record,
        `simulation worker failed to spawn (${err instanceof Error ? err.message : String(err)}); ran on main thread`,
      )
        .then(resolve, reject);
      return;
    }

    let inputs: ResolvedSimInputs;
    try {
      inputs = buildSimWorldInputs(gameData, scenario, record);
    } catch (err) {
      worker.terminate();
      reject(err);
      return;
    }

    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
    };

    const onMessage = (ev: MessageEvent<WorkerOutput>) => {
      const data = ev.data;
      if (!data || typeof data !== "object") {
        cleanup();
        reject(new Error("sim worker returned a malformed message"));
        return;
      }
      if (data.kind === "done") {
        cleanup();
        resolve({
          via: "worker",
          simulation: data.simulation,
          telemetry: data.telemetry,
          warning: null,
        });
        return;
      }
      if (data.kind === "error") {
        cleanup();
        reject(new Error(`sim worker error: ${data.message}`));
        return;
      }
      cleanup();
      reject(new Error(`sim worker returned an unknown message kind`));
    };

    const onError = (ev: ErrorEvent) => {
      cleanup();
      // Fall back to main thread on worker spawn / runtime error.
      runMainThread(
        gameData,
        scenario,
        record,
        `simulation worker failed (${ev.message || "unknown error"}); ran on main thread`,
      )
        .then(resolve, reject);
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);

    const input: WorkerInput = {
      kind: "run",
      draft: record.draft,
      parent_seed: record.parent_seed,
      ruleset_version: record.versions.ruleset_version,
      world: inputs.world,
      teams: inputs.teams,
      bracket: inputs.bracket,
    };
    worker.postMessage(input);
  });
}

async function runMainThread(
  gameData: GameData,
  scenario: Scenario2026Bundle,
  record: RunRecordV1,
  warning: string | null,
): Promise<RunSimulationResult> {
  // Yield to the event loop so the UI gets a paint before the work runs.
  await new Promise<void>((r) => setTimeout(r, 0));
  const { simulation, telemetry } = runSimulationSync(gameData, scenario, record);
  return { via: "main", simulation, telemetry, warning };
}

// ─── Worker message protocol ─────────────────────────────────────────────────

export interface WorkerInput {
  kind: "run";
  draft: RunRecordV1["draft"];
  parent_seed: string;
  ruleset_version: string;
  world: SimWorld;
  teams: Team2026[];
  bracket: Bracket2026;
}

export type WorkerOutput =
  | { kind: "done"; simulation: PersistedSimulation; telemetry: SimulationTelemetry }
  | { kind: "error"; message: string; stack?: string };

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
    const { scenario, meta } = buildRunScenario({
      parent_seed: input.parent_seed,
      teams: input.teams,
      bracket: input.bracket,
      ruleset_version: input.ruleset_version,
    });
    void meta;
    const result = runTournamentFull(input.draft, scenario, input.parent_seed, input.world);
    const t1 =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : null;
    return {
      kind: "done",
      simulation: {
        scenario,
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
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
  }
}

export type { RunScenario };
