// RunRecord persistence + version-anchor eviction.
//
// Storage policy:
//   - localStorage keyed by RUN_RECORD_PREFIX + run_id.
//   - A bounded index records run_ids + their version anchors so we can evict
//     stale ones on load without scanning blind.
//   - Quota / unavailable storage falls back to a module-level in-memory map
//     for the active tab. The UI shows a persistent "tab-only" warning; we
//     do NOT silently drop persistence.
//   - Eviction trigger: any version anchor in the loaded record differs from
//     the current manifest-derived versions.
//
// Determinism:
//   - run_id is a deterministic local counter: `run-v1-<base36-seq>`.
//   - parent_seed includes a per-run creation nonce plus the local run id and
//     formation. Replay still keys off token.ps, so shared tokens reproduce
//     byte-identically while cold visitors no longer collide on run #1.
//   - createDraft can throw if the 17 drawn pairs contain no coach; we
//     advance the counter and retry up to 20 times before surfacing a
//     recoverable error to the UI.

import {
  createDraft,
  DraftStateSchema,
  type DraftState,
  type DraftMode,
  type DraftFlow,
  type EraPresetId,
  type RatingBasis,
  type ManagerPresenceBand,
} from "@wcdraft/core";

import type { GameData, RunRecordVersions } from "./data";
import { getCatalogForEra } from "./data";
import { isDailyChallengeDate, isDailySeedForDate, type DailyChallenge } from "./daily";
import {
  RunRecordError,
  RunStoreCoordinationError,
  StorageQuotaError,
  StorageUnavailableError,
} from "./errors";
import { parsePersistedSimulation, type PersistedSimulation } from "./simulation-payload";
import { verifyTeamSheetArrangement, type TeamSheetArrangement } from "./team-sheet";
export type {
  PersistedKnockoutLadderMeta,
  PersistedKnockoutLadderRoundMeta,
  PersistedSimulation,
  SimulationTelemetry,
} from "./simulation-payload";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const RUN_RECORD_SCHEMA_VERSION = 1 as const;

/** Lifecycle status for the persisted run. */
export type RunRecordStatus = "ready" | "simulating" | "complete" | "failed";

export interface RankedAttemptRunMetadata {
  readonly attempt_id: string;
  readonly season_key: string;
  readonly parent_seed: string;
  readonly expires_at: string;
}

export interface RunRecordV1 {
  record_version: typeof RUN_RECORD_SCHEMA_VERSION;
  run_id: string;
  parent_seed: string;
  created_seq: number;
  updated_seq: number;
  versions: RunRecordVersions;
  draft: DraftState;
  /** Optional canonical sheet; absent means the immutable as-drafted assignment. */
  arrangement?: TeamSheetArrangement;
  /** Stable drafted-manager presence tier; absent on legacy/pre-simulation records. */
  manager_presence_band?: ManagerPresenceBand;
  /** Lifecycle status; older records without this field default to "ready". */
  status?: RunRecordStatus;
  /** Optional challenge metadata. Daily runs use a shared date-derived seed. */
  challenge?: DailyChallenge;
  /** Local marker for a server-issued ranked seed. Not included in share tokens. */
  ranked_attempt?: RankedAttemptRunMetadata;
  /** Local-only preservation flag; pinned records are not evicted by the recent-run cap. */
  pinned?: boolean;
  /** Persisted simulation result; present only when status === "complete". */
  simulation?: PersistedSimulation;
}

interface RunRecordIndexEntry {
  run_id: string;
  created_seq: number;
  updated_seq: number;
  versions: RunRecordVersions;
  pinned?: boolean;
}

interface RunRecordIndexV1 {
  record_version: typeof RUN_RECORD_SCHEMA_VERSION;
  entries: RunRecordIndexEntry[];
}

// ─── Keys ────────────────────────────────────────────────────────────────────

export const RUN_RECORD_PREFIX = "wcdraft:run-record:v1:" as const;
export const RUN_INDEX_KEY = "wcdraft:run-index:v1" as const;
export const RUN_COUNTER_KEY = "wcdraft:run-counter:v1" as const;

export const RUN_RECORD_CAP = 5 as const;
export const CREATE_RETRY_LIMIT = 20 as const;

const MAX_RUN_ID_CHARS = 128;
const MAX_PARENT_SEED_CHARS = 256;
const MAX_VERSION_ANCHOR_CHARS = 512;

// ─── Storage abstraction with in-memory fallback ─────────────────────────────

interface StorageBackend {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  /** True when running against the in-memory fallback (tab-only persistence). */
  isVolatile: boolean;
}

const memoryMap = new Map<string, string>();
const memoryBackend: StorageBackend = {
  getItem: (k) => (memoryMap.has(k) ? memoryMap.get(k)! : null),
  setItem: (k, v) => {
    memoryMap.set(k, v);
  },
  removeItem: (k) => {
    memoryMap.delete(k);
  },
  isVolatile: true,
};

let volatileMode = false;

interface RunMutationLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive"; signal?: AbortSignal },
    callback: () => T | PromiseLike<T>,
  ): Promise<T>;
}

let mutationLockManagerOverride: RunMutationLockManager | null | undefined;
let storeMutationTail = Promise.resolve();

export const RUN_STORE_LOCK_NAME = "wcdraft:run-store:v1" as const;
export const RUN_MUTATION_LOCK_UNAVAILABLE_WARNING =
  "This browser cannot safely coordinate saved-run changes. Update your browser to continue; existing runs remain readable." as const;

function getStorage(): StorageBackend {
  if (volatileMode) return memoryBackend;
  if (typeof window === "undefined") return memoryBackend;
  try {
    const ls = window.localStorage;
    if (!ls) return memoryBackend;
    // Probe — Safari private mode + restrictive iframes throw on set.
    const probe = "__wcdraft_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return {
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => ls.setItem(k, v),
      removeItem: (k) => ls.removeItem(k),
      isVolatile: false,
    };
  } catch {
    volatileMode = true;
    return memoryBackend;
  }
}

/** Test seam — drop the in-memory fallback between specs. */
export function _resetVolatileStorageForTests(): void {
  memoryMap.clear();
  volatileMode = false;
  mutationLockManagerOverride = undefined;
  storeMutationTail = Promise.resolve();
}

/** Test seam for deterministic independent-agent lock scheduling. */
export function _setRunMutationLockManagerForTests(manager: RunMutationLockManager | null): void {
  mutationLockManagerOverride = manager;
}

function getRunMutationLockManager(): RunMutationLockManager | null {
  if (mutationLockManagerOverride !== undefined) return mutationLockManagerOverride;
  if (typeof navigator === "undefined") return null;
  try {
    const locks = navigator.locks as RunMutationLockManager | undefined;
    return locks && typeof locks.request === "function" ? locks : null;
  } catch {
    return null;
  }
}

async function withRunStoreLock<T>(
  unavailable: () => T,
  mutation: () => T,
  signal?: AbortSignal,
): Promise<T> {
  return withStoreMutationQueue(
    unavailable,
    async () => {
      if (getStorage().isVolatile) return mutation();

      const manager = getRunMutationLockManager();
      if (!manager) return unavailable();
      let outcome: { kind: "value"; value: T } | { kind: "mutation-error"; error: unknown };
      try {
        outcome = await manager.request(RUN_STORE_LOCK_NAME, { mode: "exclusive", signal }, () => {
          try {
            // Storage may become volatile while this queue turn waits for
            // or holds the Web Lock. The page queue already owns request
            // order, so execute once without entering another queue.
            return { kind: "value" as const, value: mutation() };
          } catch (error) {
            return { kind: "mutation-error" as const, error };
          }
        });
      } catch {
        // The lock callback captures mutation failures as values, so a
        // request rejection means the durable Web Lock was not established.
        return unavailable();
      }
      if (outcome.kind === "mutation-error") throw outcome.error;
      return outcome.value;
    },
    signal,
  );
}

async function withStoreMutationQueue<T>(
  unavailable: () => T,
  operation: () => T | PromiseLike<T>,
  signal?: AbortSignal,
): Promise<T> {
  const previous = storeMutationTail;
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  storeMutationTail = current;
  await previous.catch(() => undefined);
  try {
    if (signal?.aborted) return unavailable();
    return await operation();
  } finally {
    release();
    if (storeMutationTail === current) storeMutationTail = Promise.resolve();
  }
}

/**
 * True iff the run-record store is running against the in-memory fallback
 * (tab-only persistence). Probes the backing store with the same guard used
 * by `getStorage`. Read this on a resume path so the volatile-storage warning
 * survives URL changes (e.g. the formation-lock `router.replace` that would
 * otherwise wipe a per-call warning before the spin stage renders).
 */
export function isStorageVolatile(): boolean {
  return getStorage().isVolatile;
}

// ─── Counter / id / seed ─────────────────────────────────────────────────────

function nextCounter(storage: StorageBackend): number {
  const raw = storage.getItem(RUN_COUNTER_KEY);
  const prev = raw ? Number.parseInt(raw, 10) : 0;
  const next = Number.isFinite(prev) && prev >= 0 ? prev + 1 : 1;
  try {
    storage.setItem(RUN_COUNTER_KEY, String(next));
  } catch (err) {
    if (isQuotaError(err)) {
      volatileMode = true;
      memoryBackend.setItem(RUN_COUNTER_KEY, String(next));
    } else {
      throw err;
    }
  }
  return next;
}

function buildRunId(seq: number): string {
  return `run-v1-${seq.toString(36)}`;
}

function createRunNonce(): string {
  const cryptoImpl = globalThis.crypto;
  if (cryptoImpl?.randomUUID) return `rn-${cryptoImpl.randomUUID().replace(/-/gu, "")}`;
  if (cryptoImpl?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoImpl.getRandomValues(bytes);
    return `rn-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  return `rn-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}`;
}

function buildParentSeed(run_nonce: string, run_id: string, formation_id: string): string {
  return `wcdraft:run:v1:${run_nonce}:${run_id}:${formation_id}`;
}

// ─── Index helpers ───────────────────────────────────────────────────────────

function loadIndex(storage: StorageBackend): RunRecordIndexV1 {
  const raw = storage.getItem(RUN_INDEX_KEY);
  if (!raw) return { record_version: RUN_RECORD_SCHEMA_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(raw) as RunRecordIndexV1;
    if (parsed.record_version !== RUN_RECORD_SCHEMA_VERSION) {
      return { record_version: RUN_RECORD_SCHEMA_VERSION, entries: [] };
    }
    return parsed;
  } catch {
    return { record_version: RUN_RECORD_SCHEMA_VERSION, entries: [] };
  }
}

function saveIndex(storage: StorageBackend, idx: RunRecordIndexV1): void {
  storage.setItem(RUN_INDEX_KEY, JSON.stringify(idx));
}

function updateIndexEntry(idx: RunRecordIndexV1, rec: RunRecordV1): RunRecordIndexV1 {
  const entries = idx.entries.filter((e) => e.run_id !== rec.run_id);
  entries.push(indexEntryFromRecord(rec));
  entries.sort((a, b) => {
    if (a.updated_seq !== b.updated_seq) return a.updated_seq - b.updated_seq;
    if (a.created_seq !== b.created_seq) return a.created_seq - b.created_seq;
    return a.run_id.localeCompare(b.run_id);
  });
  return { record_version: RUN_RECORD_SCHEMA_VERSION, entries };
}

function indexEntryFromRecord(rec: RunRecordV1): RunRecordIndexEntry {
  return {
    run_id: rec.run_id,
    created_seq: rec.created_seq,
    updated_seq: rec.updated_seq,
    versions: rec.versions,
    ...(rec.pinned === true ? { pinned: true } : {}),
  };
}

function recordKey(run_id: string): string {
  return `${RUN_RECORD_PREFIX}${run_id}`;
}

// ─── Quota handling ──────────────────────────────────────────────────────────

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name;
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    /quota/i.test(err.message)
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface CreateRunRecordParams {
  formation_id: string;
  mode?: DraftMode;
  team_name?: string;
  /** Explicit parent seed. Daily drafts use this to bypass the per-device nonce. */
  parent_seed?: string;
  /** Optional challenge metadata persisted into the run token. */
  challenge?: DailyChallenge;
  /** Optional ranked-attempt metadata for server-issued ranked seeds. */
  ranked_attempt?: RankedAttemptRunMetadata;
  /**
   * DC-2 era preset (default `all_time` = today's pool). The draft is
   * created against the matching era-filtered catalog via `getCatalogForEra`.
   */
  era_preset?: EraPresetId;
  /** DC-3 draft flow (default `squad_first` = today's flow). */
  draft_flow?: DraftFlow;
  /**
   * Rating basis (default `career`). `current` re-rates the squad from
   * `basis_ratings.current` for both display and sim (selected-basis lane).
   */
  rating_basis?: RatingBasis;
}

export interface CreateRunRecordResult {
  record: RunRecordV1;
  persistence: "durable" | "volatile";
  warnings: string[];
}

export interface LoadRunRecordResult {
  status: "loaded" | "missing" | "stale" | "invalid";
  record: RunRecordV1 | null;
}

export interface SaveRunRecordResult {
  persistence: "durable" | "volatile";
  warnings: string[];
}

/**
 * Create a fresh `RunRecord` against the current `GameData` and persist it.
 * Deterministically derives `run_id` from a localStorage counter so identical
 * counter sequences reproduce the same draft.
 */
export function createNewRunRecord(
  gameData: GameData,
  params: CreateRunRecordParams,
): Promise<CreateRunRecordResult> {
  return withRunStoreLock(
    () => {
      throw new RunStoreCoordinationError(RUN_MUTATION_LOCK_UNAVAILABLE_WARNING);
    },
    () => createNewRunRecordUnlocked(gameData, params),
  );
}

function createNewRunRecordUnlocked(
  gameData: GameData,
  params: CreateRunRecordParams,
): CreateRunRecordResult {
  const storage = getStorage();
  const warnings: string[] = [];

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < CREATE_RETRY_LIMIT; attempt += 1) {
    const seq = nextCounter(storage);
    const run_id = buildRunId(seq);
    const parent_seed =
      params.parent_seed ?? buildParentSeed(createRunNonce(), run_id, params.formation_id);
    try {
      const era_preset = params.era_preset ?? "all_time";
      const draft = createDraft(getCatalogForEra(gameData, era_preset), {
        run_id,
        parent_seed,
        formation_id: params.formation_id,
        mode: params.mode ?? "classic",
        team_name: params.team_name ?? "Your XI",
        dataset_version: gameData.versions.dataset_version,
        rating_version: gameData.versions.rating_version,
        engine_version: gameData.versions.engine_version,
        era_preset,
        draft_flow: params.draft_flow ?? "squad_first",
        rating_basis: params.rating_basis ?? "career",
      });
      const record: RunRecordV1 = {
        record_version: RUN_RECORD_SCHEMA_VERSION,
        run_id,
        parent_seed,
        created_seq: seq,
        updated_seq: seq,
        versions: gameData.versions,
        draft,
        ...(params.challenge === undefined ? {} : { challenge: params.challenge }),
        ...(params.ranked_attempt === undefined ? {} : { ranked_attempt: params.ranked_attempt }),
      };
      const save = saveNewRunRecordUnlocked(record);
      warnings.push(...save.warnings);
      return { record, persistence: save.persistence, warnings };
    } catch (err) {
      lastErr = err;
      // Retry on the specific "no coach in 17 spins" failure; surface anything
      // else immediately. Explicit seeds (daily) are the contract; retrying
      // would silently change the shared puzzle.
      if (err instanceof RangeError && /none of the 17 drawn/i.test(err.message)) {
        if (params.parent_seed === undefined) continue;
      }
      throw err;
    }
  }
  throw new RunRecordError(
    `createNewRunRecord: ${CREATE_RETRY_LIMIT} attempts exhausted without finding a draftable seed: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/** Pure read. Stale/invalid cleanup is owned by the awaited store repair boundary. */
export function loadRunRecord(
  run_id: string,
  currentVersions: RunRecordVersions,
): LoadRunRecordResult {
  return loadRunRecordUnlocked(run_id, currentVersions, false);
}

function loadRunRecordUnlocked(
  run_id: string,
  currentVersions: RunRecordVersions,
  cleanupInvalidOrStale: boolean,
): LoadRunRecordResult {
  const storage = getStorage();
  const raw = storage.getItem(recordKey(run_id));
  if (!raw) return { status: "missing", record: null };
  const parsed = parseStoredRunRecord(raw, run_id);
  if (!parsed) {
    if (cleanupInvalidOrStale) evictRunRecordUnlocked(storage, run_id);
    return { status: "invalid", record: null };
  }
  if (!versionsMatch(parsed.versions, currentVersions)) {
    if (cleanupInvalidOrStale) evictRunRecordUnlocked(storage, run_id);
    return { status: "stale", record: null };
  }
  return { status: "loaded", record: parsed };
}

/**
 * Persist a newly-created authority. Existing records must use a serialized
 * mutation boundary; accepting them here would bypass cross-tab ownership.
 */
export function saveNewRunRecord(record: RunRecordV1): Promise<SaveRunRecordResult> {
  return withRunStoreLock(
    () => {
      throw new RunStoreCoordinationError(RUN_MUTATION_LOCK_UNAVAILABLE_WARNING);
    },
    () => saveNewRunRecordUnlocked(record),
  );
}

function saveNewRunRecordUnlocked(record: RunRecordV1): SaveRunRecordResult {
  const storage = getStorage();
  if (storage.getItem(recordKey(record.run_id)) !== null) {
    throw new RunRecordError(`Run ${record.run_id} already exists; use a locked mutation boundary`);
  }
  return saveRunRecordUnlocked(record);
}

/** Internal whole-record write; callers must already own the store-wide mutation lock. */
function saveRunRecordUnlocked(record: RunRecordV1): SaveRunRecordResult {
  const warnings: string[] = [];
  let storage = getStorage();
  const key = recordKey(record.run_id);
  const payload = JSON.stringify(record);
  try {
    storage.setItem(key, payload);
  } catch (err) {
    if (isQuotaError(err)) {
      // Try evicting oldest records and retry once before going volatile.
      const idx = loadIndex(storage);
      if (idx.entries.length > 0) {
        const oldest = idx.entries[0]!;
        if (oldest.run_id !== record.run_id) {
          evictRunRecordUnlocked(storage, oldest.run_id);
          try {
            storage.setItem(key, payload);
          } catch (retryErr) {
            if (isQuotaError(retryErr)) {
              storage = persistRecordInVolatileFallback(
                storage,
                key,
                payload,
                record.updated_seq,
                warnings,
              );
            } else {
              throw new StorageQuotaError(
                `Failed to persist run record after eviction retry: ${String(retryErr)}`,
              );
            }
          }
        } else {
          storage = persistRecordInVolatileFallback(
            storage,
            key,
            payload,
            record.updated_seq,
            warnings,
          );
        }
      } else {
        storage = persistRecordInVolatileFallback(
          storage,
          key,
          payload,
          record.updated_seq,
          warnings,
        );
      }
    } else {
      throw new StorageUnavailableError(`Failed to persist run record: ${String(err)}`);
    }
  }
  const idx = loadIndex(storage);
  const nextIdx = updateIndexEntry(idx, record);
  let unpinnedCount = nextIdx.entries.filter((entry) => entry.pinned !== true).length;
  while (unpinnedCount > RUN_RECORD_CAP) {
    const dropIndex = nextIdx.entries.findIndex(
      (entry) => entry.pinned !== true && entry.run_id !== record.run_id,
    );
    if (dropIndex === -1) break;
    const [drop] = nextIdx.entries.splice(dropIndex, 1);
    if (drop) storage.removeItem(recordKey(drop.run_id));
    unpinnedCount -= 1;
  }
  try {
    saveIndex(storage, nextIdx);
  } catch (err) {
    if (isQuotaError(err)) {
      warnings.push("index update failed under quota");
    } else {
      throw err;
    }
  }
  return { persistence: storage.isVolatile ? "volatile" : "durable", warnings };
}

function persistRecordInVolatileFallback(
  durableStorage: StorageBackend,
  key: string,
  payload: string,
  minimumCounter: number,
  warnings: string[],
): StorageBackend {
  const durableCounter = Number.parseInt(durableStorage.getItem(RUN_COUNTER_KEY) ?? "0", 10);
  const volatileCounter = Number.parseInt(memoryBackend.getItem(RUN_COUNTER_KEY) ?? "0", 10);
  const counter = Math.max(
    Number.isFinite(durableCounter) ? durableCounter : 0,
    Number.isFinite(volatileCounter) ? volatileCounter : 0,
    minimumCounter,
  );
  volatileMode = true;
  memoryBackend.setItem(RUN_COUNTER_KEY, counter.toString());
  memoryBackend.setItem(key, payload);
  warnings.push("storage quota exhausted: draft saved to this tab only");
  return memoryBackend;
}

export interface UpdateRunRecordResult {
  status: "updated" | "missing" | "stale" | "invalid" | "conflict";
  record: RunRecordV1 | null;
  persistence: "durable" | "volatile" | "none";
  warnings: string[];
}

function mutationLockUnavailableResult(): UpdateRunRecordResult {
  return {
    status: "conflict",
    record: null,
    persistence: "none",
    warnings: [RUN_MUTATION_LOCK_UNAVAILABLE_WARNING],
  };
}

/**
 * Persist an arrangement only while the run is pre-simulation.
 *
 * This read-modify-write boundary protects against both revisiting Review
 * after completion and another tab completing the run between render and
 * tap. A completed simulation is immutable evidence for its arrangement;
 * changing only `a` would pair a stale score with a different XI.
 */
export function setRunArrangement(
  run_id: string,
  currentVersions: RunRecordVersions,
  arrangement: TeamSheetArrangement,
): Promise<UpdateRunRecordResult> {
  return withRunStoreLock(mutationLockUnavailableResult, () =>
    setRunArrangementUnlocked(run_id, currentVersions, arrangement),
  );
}

function setRunArrangementUnlocked(
  run_id: string,
  currentVersions: RunRecordVersions,
  arrangement: TeamSheetArrangement,
): UpdateRunRecordResult {
  const loaded = loadRunRecordUnlocked(run_id, currentVersions, true);
  if (loaded.status !== "loaded" || !loaded.record) {
    const status = loaded.status as "missing" | "stale" | "invalid";
    return { status, record: null, persistence: "none", warnings: [] };
  }
  if (
    loaded.record.simulation !== undefined ||
    loaded.record.status === "simulating" ||
    loaded.record.status === "complete"
  ) {
    return {
      status: "conflict",
      record: loaded.record,
      persistence: "none",
      warnings: ["Team-sheet arrangement is locked during and after simulation."],
    };
  }
  const verified = verifyTeamSheetArrangement(loaded.record.draft, arrangement);
  const storage = getStorage();
  const next: RunRecordV1 = {
    ...loaded.record,
    updated_seq: nextCounter(storage),
    arrangement: verified,
  };
  const save = saveRunRecordUnlocked(next);
  return {
    status: "updated",
    record: next,
    persistence: save.persistence,
    warnings: save.warnings,
  };
}

/**
 * Persist a Review team name against the current authoritative record.
 *
 * The caller may be a delayed debounce from a stale React render, so this
 * boundary deliberately reloads storage and only replaces `draft.team_name`.
 * Arrangement and every other run fact come from the authoritative record.
 * Once simulation starts, even a pending debounce is rejected.
 */
export function setRunTeamName(
  run_id: string,
  currentVersions: RunRecordVersions,
  teamName: string,
): Promise<UpdateRunRecordResult> {
  return withRunStoreLock(mutationLockUnavailableResult, () =>
    setRunTeamNameUnlocked(run_id, currentVersions, teamName),
  );
}

function setRunTeamNameUnlocked(
  run_id: string,
  currentVersions: RunRecordVersions,
  teamName: string,
): UpdateRunRecordResult {
  const loaded = loadRunRecordUnlocked(run_id, currentVersions, true);
  if (loaded.status !== "loaded" || !loaded.record) {
    const status = loaded.status as "missing" | "stale" | "invalid";
    return { status, record: null, persistence: "none", warnings: [] };
  }
  const current = loaded.record;
  if (
    current.simulation !== undefined ||
    current.status === "simulating" ||
    current.status === "complete"
  ) {
    return {
      status: "conflict",
      record: current,
      persistence: "none",
      warnings: ["Team name is locked during and after simulation."],
    };
  }
  const nextTeamName = teamName.trim().slice(0, 32) || "Your XI";
  const storage = getStorage();
  if (nextTeamName === current.draft.team_name) {
    return {
      status: "updated",
      record: current,
      persistence: storage.isVolatile ? "volatile" : "durable",
      warnings: [],
    };
  }
  const next: RunRecordV1 = {
    ...current,
    updated_seq: nextCounter(storage),
    draft: { ...current.draft, team_name: nextTeamName },
  };
  const save = saveRunRecordUnlocked(next);
  return {
    status: "updated",
    record: next,
    persistence: save.persistence,
    warnings: save.warnings,
  };
}

export type BeginRunSimulationExpected = Pick<
  RunRecordV1,
  "updated_seq" | "status" | "arrangement"
>;

/**
 * Under the shared store mutation lock, compare the exact rendered
 * team-sheet revision and transition it to `simulating`. The returned record
 * is the only record the caller may simulate: it is the same arrangement that
 * now owns the lifecycle sequence.
 */
export function beginRunSimulation(
  run_id: string,
  currentVersions: RunRecordVersions,
  expected: BeginRunSimulationExpected,
  signal?: AbortSignal,
): Promise<SetSimulationResult> {
  return withRunStoreLock(
    mutationLockUnavailableResult,
    () => beginRunSimulationUnlocked(run_id, currentVersions, expected),
    signal,
  );
}

function beginRunSimulationUnlocked(
  run_id: string,
  currentVersions: RunRecordVersions,
  expected: BeginRunSimulationExpected,
): SetSimulationResult {
  const loaded = loadRunRecordUnlocked(run_id, currentVersions, true);
  if (loaded.status !== "loaded" || !loaded.record) {
    const status = loaded.status as "missing" | "stale" | "invalid";
    return { status, record: null, persistence: "none", warnings: [] };
  }
  const current = loaded.record;
  if (
    current.simulation !== undefined ||
    (current.status ?? "ready") !== (expected.status ?? "ready") ||
    current.updated_seq !== expected.updated_seq ||
    !sameArrangement(current.arrangement, expected.arrangement)
  ) {
    return {
      status: "conflict",
      record: current,
      persistence: "none",
      warnings: ["The team sheet changed before simulation could lock it."],
    };
  }
  const storage = getStorage();
  const next: RunRecordV1 = {
    ...current,
    updated_seq: nextCounter(storage),
    status: "simulating",
  };
  const save = saveRunRecordUnlocked(next);
  return {
    status: "updated",
    record: next,
    persistence: save.persistence,
    warnings: save.warnings,
  };
}

function sameArrangement(
  left: TeamSheetArrangement | undefined,
  right: TeamSheetArrangement | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((cardId, index) => cardId === right[index]);
}

/**
 * Apply a draft transition to the exact rendered ready revision while holding
 * the same store lock as Review and simulation lifecycle mutations.
 */
export type UpdateRunDraftExpected = Pick<RunRecordV1, "updated_seq" | "status">;

export function updateRunRecord(
  run_id: string,
  currentVersions: RunRecordVersions,
  expected: UpdateRunDraftExpected,
  updater: (current: RunRecordV1) => DraftState,
): Promise<UpdateRunRecordResult> {
  return withRunStoreLock(mutationLockUnavailableResult, () =>
    updateRunRecordUnlocked(run_id, currentVersions, expected, updater),
  );
}

function updateRunRecordUnlocked(
  run_id: string,
  currentVersions: RunRecordVersions,
  expected: UpdateRunDraftExpected,
  updater: (current: RunRecordV1) => DraftState,
): UpdateRunRecordResult {
  const loaded = loadRunRecordUnlocked(run_id, currentVersions, true);
  if (loaded.status !== "loaded" || !loaded.record) {
    const status = loaded.status as "missing" | "stale" | "invalid";
    return { status, record: null, persistence: "none", warnings: [] };
  }
  const current = loaded.record;
  if (
    current.simulation !== undefined ||
    current.status === "simulating" ||
    current.status === "complete" ||
    current.updated_seq !== expected.updated_seq ||
    (current.status ?? "ready") !== (expected.status ?? "ready")
  ) {
    return {
      status: "conflict",
      record: current,
      persistence: "none",
      warnings: ["The draft changed before this pick could lock it."],
    };
  }
  const storage = getStorage();
  const nextSeq = nextCounter(storage);
  const next: RunRecordV1 = {
    ...current,
    updated_seq: nextSeq,
    draft: updater(current),
  };
  const save = saveRunRecordUnlocked(next);
  return {
    status: "updated",
    record: next,
    persistence: save.persistence,
    warnings: save.warnings,
  };
}

/**
 * Attach a simulation payload to an existing record and persist. Bumps
 * `updated_seq` + flips `status` to `complete`. Returns the new record (with
 * persistence + warnings).
 *
 * If the record was evicted between the user's draft and their tap, the
 * caller gets a `null` record back and a `missing` status code.
 */
export interface SetSimulationResult {
  status: "updated" | "missing" | "stale" | "invalid" | "conflict";
  record: RunRecordV1 | null;
  persistence: "durable" | "volatile" | "none";
  warnings: string[];
}

export interface SimulationOwnership extends RunStatusOwnership {
  readonly status: "simulating";
}

export function setRunSimulation(
  run_id: string,
  currentVersions: RunRecordVersions,
  simulation: PersistedSimulation,
  ownership: SimulationOwnership,
  signal?: AbortSignal,
): Promise<SetSimulationResult> {
  return withRunStoreLock(
    mutationLockUnavailableResult,
    () => setRunSimulationUnlocked(run_id, currentVersions, simulation, ownership),
    signal,
  );
}

function setRunSimulationUnlocked(
  run_id: string,
  currentVersions: RunRecordVersions,
  simulation: PersistedSimulation,
  ownership: SimulationOwnership,
): SetSimulationResult {
  const loaded = loadRunRecordUnlocked(run_id, currentVersions, true);
  if (loaded.status !== "loaded" || !loaded.record) {
    const status = loaded.status as "missing" | "stale" | "invalid";
    return { status, record: null, persistence: "none", warnings: [] };
  }
  // The explicit nullish check is intentional: JavaScript callers can omit a
  // TypeScript-required argument. No result may persist without proving it
  // owns the exact `simulating` lifecycle sequence.
  if (!ownership || ownership.status !== "simulating" || !ownsRunStatus(loaded.record, ownership)) {
    return { status: "conflict", record: loaded.record, persistence: "none", warnings: [] };
  }
  const storage = getStorage();
  const nextSeq = nextCounter(storage);
  const managerPresenceBand: ManagerPresenceBand = loaded.record.draft.manager_card_id ? 1 : 0;
  if (
    simulation.matches.some(
      (match) => match.team_facts?.manager_presence_band !== managerPresenceBand,
    )
  ) {
    return { status: "invalid", record: loaded.record, persistence: "none", warnings: [] };
  }
  const next: RunRecordV1 = {
    ...loaded.record,
    updated_seq: nextSeq,
    status: "complete",
    manager_presence_band: managerPresenceBand,
    simulation,
  };
  const save = saveRunRecordUnlocked(next);
  return {
    status: "updated",
    record: next,
    persistence: save.persistence,
    warnings: save.warnings,
  };
}

export interface RunStatusOwnership {
  readonly status: RunRecordStatus;
  readonly updated_seq: number;
}

/** Update the lifecycle status (without changing other persisted fields). */
export function setRunStatus(
  run_id: string,
  currentVersions: RunRecordVersions,
  status: "ready",
  ownership: SimulationOwnership,
): Promise<SetSimulationResult> {
  return withRunStoreLock(mutationLockUnavailableResult, () =>
    setRunStatusUnlocked(run_id, currentVersions, status, ownership),
  );
}

function setRunStatusUnlocked(
  run_id: string,
  currentVersions: RunRecordVersions,
  status: "ready",
  ownership: SimulationOwnership,
): SetSimulationResult {
  const loaded = loadRunRecordUnlocked(run_id, currentVersions, true);
  if (loaded.status !== "loaded" || !loaded.record) {
    const s = loaded.status as "missing" | "stale" | "invalid";
    return { status: s, record: null, persistence: "none", warnings: [] };
  }
  if (!ownership || ownership.status !== "simulating" || !ownsRunStatus(loaded.record, ownership)) {
    return { status: "conflict", record: loaded.record, persistence: "none", warnings: [] };
  }
  // Cleanup can never remove an already-committed simulation payload.
  if (loaded.record.simulation !== undefined) {
    return { status: "conflict", record: loaded.record, persistence: "none", warnings: [] };
  }
  const storage = getStorage();
  const nextSeq = nextCounter(storage);
  const next: RunRecordV1 = {
    ...loaded.record,
    updated_seq: nextSeq,
    status,
  };
  const save = saveRunRecordUnlocked(next);
  return {
    status: "updated",
    record: next,
    persistence: save.persistence,
    warnings: save.warnings,
  };
}

function ownsRunStatus(record: RunRecordV1, ownership: RunStatusOwnership): boolean {
  return record.status === ownership.status && record.updated_seq === ownership.updated_seq;
}

export function setRunPinned(
  run_id: string,
  currentVersions: RunRecordVersions,
  pinned: boolean,
): Promise<SetSimulationResult> {
  return withRunStoreLock(mutationLockUnavailableResult, () =>
    setRunPinnedUnlocked(run_id, currentVersions, pinned),
  );
}

function setRunPinnedUnlocked(
  run_id: string,
  currentVersions: RunRecordVersions,
  pinned: boolean,
): SetSimulationResult {
  const loaded = loadRunRecordUnlocked(run_id, currentVersions, true);
  if (loaded.status !== "loaded" || !loaded.record) {
    const s = loaded.status as "missing" | "stale" | "invalid";
    return { status: s, record: null, persistence: "none", warnings: [] };
  }
  const storage = getStorage();
  const next: RunRecordV1 = {
    ...loaded.record,
    updated_seq: nextCounter(storage),
  };
  if (pinned) next.pinned = true;
  else delete next.pinned;
  const save = saveRunRecordUnlocked(next);
  return {
    status: "updated",
    record: next,
    persistence: save.persistence,
    warnings: save.warnings,
  };
}

// ─── Listing (history surface) ───────────────────────────────────────────────

export interface ListRunRecordsOptions {
  /** Cap the number of returned unpinned records (default: `RUN_RECORD_CAP`). Pinned records are included. */
  limit?: number;
}

export interface ListRunRecordsResult {
  /** Records that pass version match + JSON validation, ordered newest first. */
  records: RunRecordV1[];
  /** Whether storage is durable (localStorage) or volatile (in-memory). */
  persistence: "durable" | "volatile";
  /** Non-fatal warnings (e.g. evicted bad entries). Empty for clean storage. */
  warnings: string[];
}

/**
 * Return the persisted `RunRecordV1`s for the current `currentVersions`,
 * newest first. This render-safe read is pure; startup/history explicitly
 * await `evictStaleRunRecords` to perform store-wide cleanup under the lock.
 *
 * This is the foundation under `lib/game/history.ts` — the UI never touches
 * `RUN_RECORD_PREFIX`/`RUN_INDEX_KEY` directly.
 */
export function listRunRecords(
  currentVersions: RunRecordVersions,
  options: ListRunRecordsOptions = {},
): ListRunRecordsResult {
  const limit = Math.max(0, options.limit ?? RUN_RECORD_CAP);
  const storage = getStorage();
  const idx = loadIndex(storage);

  const candidates: RunRecordV1[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const entry of idx.entries) {
    if (seen.has(entry.run_id)) continue;
    seen.add(entry.run_id);
    const raw = storage.getItem(recordKey(entry.run_id));
    if (!raw) {
      warnings.push(`history: index entry '${entry.run_id}' had no stored record`);
      continue;
    }
    const parsed = parseStoredRunRecord(raw, entry.run_id);
    if (!parsed) {
      warnings.push(`history: ignored malformed record '${entry.run_id}' pending cleanup`);
      continue;
    }
    if (!versionsMatch(parsed.versions, currentVersions)) continue;
    candidates.push(parsed);
  }

  candidates.sort((a, b) => {
    if (b.updated_seq !== a.updated_seq) return b.updated_seq - a.updated_seq;
    if (b.created_seq !== a.created_seq) return b.created_seq - a.created_seq;
    return b.run_id.localeCompare(a.run_id);
  });

  const records: RunRecordV1[] = [];
  let unpinnedReturned = 0;
  for (const parsed of candidates) {
    if (parsed.pinned !== true && unpinnedReturned >= limit) {
      continue;
    }
    records.push(parsed);
    if (parsed.pinned !== true) unpinnedReturned += 1;
  }

  return {
    records,
    persistence: storage.isVolatile ? "volatile" : "durable",
    warnings,
  };
}

/** Repair malformed/missing/stale history while holding the store-wide lock. */
export function evictStaleRunRecords(currentVersions: RunRecordVersions): Promise<string[]> {
  return withRunStoreLock(
    () => [RUN_MUTATION_LOCK_UNAVAILABLE_WARNING],
    () => evictStaleRunRecordsUnlocked(currentVersions),
  );
}

function evictStaleRunRecordsUnlocked(currentVersions: RunRecordVersions): string[] {
  const storage = getStorage();
  const idx = loadIndex(storage);
  const repaired: RunRecordIndexEntry[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const entry of idx.entries) {
    if (seen.has(entry.run_id)) continue;
    seen.add(entry.run_id);
    const raw = storage.getItem(recordKey(entry.run_id));
    if (!raw) {
      warnings.push(`history: index entry '${entry.run_id}' had no stored record`);
      continue;
    }
    const record = parseStoredRunRecord(raw, entry.run_id);
    if (!record) {
      storage.removeItem(recordKey(entry.run_id));
      warnings.push(`history: evicted malformed record '${entry.run_id}'`);
      continue;
    }
    if (!versionsMatch(record.versions, currentVersions)) {
      storage.removeItem(recordKey(entry.run_id));
      continue;
    }
    repaired.push(indexEntryFromRecord(record));
  }
  repaired.sort((a, b) => {
    if (a.updated_seq !== b.updated_seq) return a.updated_seq - b.updated_seq;
    if (a.created_seq !== b.created_seq) return a.created_seq - b.created_seq;
    return a.run_id.localeCompare(b.run_id);
  });
  const next = { record_version: RUN_RECORD_SCHEMA_VERSION, entries: repaired } as const;
  if (JSON.stringify(next) !== JSON.stringify(idx)) {
    saveIndex(storage, next);
  }
  return warnings;
}

function evictRunRecordUnlocked(storage: StorageBackend, run_id: string): void {
  storage.removeItem(recordKey(run_id));
  const idx = loadIndex(storage);
  const next = idx.entries.filter((e) => e.run_id !== run_id);
  if (next.length !== idx.entries.length) {
    saveIndex(storage, { record_version: RUN_RECORD_SCHEMA_VERSION, entries: next });
  }
}

function parseStoredRunRecord(raw: string, expectedRunId: string): RunRecordV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = parseRunRecordValue(parsed);
  if (!record || record.run_id !== expectedRunId) return null;
  return record;
}

function parseRunRecordValue(value: unknown): RunRecordV1 | null {
  if (!isPlainObject(value)) return null;
  if (value.record_version !== RUN_RECORD_SCHEMA_VERSION) return null;
  const run_id = boundedString(value.run_id, MAX_RUN_ID_CHARS);
  const parent_seed = boundedString(value.parent_seed, MAX_PARENT_SEED_CHARS);
  const created_seq = nonNegativeSafeInteger(value.created_seq);
  const updated_seq = nonNegativeSafeInteger(value.updated_seq);
  const versions = parseRunRecordVersions(value.versions);
  const draft = DraftStateSchema.safeParse(value.draft);
  const status = parseRunRecordStatus(value.status);
  if (
    run_id === null ||
    parent_seed === null ||
    created_seq === null ||
    updated_seq === null ||
    updated_seq < created_seq ||
    versions === null ||
    !draft.success ||
    status === "invalid"
  ) {
    return null;
  }

  let arrangement: TeamSheetArrangement | undefined;
  if (value.arrangement !== undefined) {
    if (
      !Array.isArray(value.arrangement) ||
      !value.arrangement.every((entry) => typeof entry === "string")
    ) {
      return null;
    }
    try {
      arrangement = verifyTeamSheetArrangement(draft.data, value.arrangement);
    } catch {
      return null;
    }
  }

  let simulation: PersistedSimulation | undefined;
  if (value.simulation !== undefined) {
    const parsedSimulation = parsePersistedSimulation(value.simulation);
    if (parsedSimulation === null) return null;
    simulation = parsedSimulation;
  }
  if (status === "complete" && simulation === undefined) return null;
  if (simulation !== undefined && status !== "complete") return null;
  const managerPresenceBand =
    value.manager_presence_band === undefined
      ? undefined
      : value.manager_presence_band === 0 || value.manager_presence_band === 1
        ? value.manager_presence_band
        : "invalid";
  if (managerPresenceBand === "invalid") return null;
  if (
    managerPresenceBand !== undefined &&
    (managerPresenceBand !== (draft.data.manager_card_id ? 1 : 0) ||
      simulation?.matches.some(
        (match) => match.team_facts?.manager_presence_band !== managerPresenceBand,
      ))
  ) {
    return null;
  }

  const challenge = parseRunChallenge(value.challenge, parent_seed);
  if (challenge === "invalid") return null;
  const rankedAttempt = parseRankedAttempt(value.ranked_attempt, parent_seed);
  if (rankedAttempt === "invalid") return null;
  const pinned = parseOptionalBoolean(value.pinned);
  if (pinned === "invalid") return null;

  return {
    record_version: RUN_RECORD_SCHEMA_VERSION,
    run_id,
    parent_seed,
    created_seq,
    updated_seq,
    versions,
    draft: draft.data,
    ...(arrangement === undefined ? {} : { arrangement }),
    ...(managerPresenceBand === undefined ? {} : { manager_presence_band: managerPresenceBand }),
    ...(status === undefined ? {} : { status }),
    ...(challenge === undefined ? {} : { challenge }),
    ...(rankedAttempt === undefined ? {} : { ranked_attempt: rankedAttempt }),
    ...(pinned === undefined ? {} : { pinned }),
    ...(simulation === undefined ? {} : { simulation }),
  };
}

function parseRunChallenge(
  value: unknown,
  parentSeed: string,
): DailyChallenge | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return "invalid";
  if (value.kind !== "daily") return "invalid";
  const date = boundedString(value.date, 10);
  const seed = boundedString(value.seed, MAX_PARENT_SEED_CHARS);
  if (
    date === null ||
    seed === null ||
    !isDailyChallengeDate(date) ||
    seed !== parentSeed ||
    // Persisted local history can outlive the rolling publication window.
    // The shared seed validator consults dailyCoverageForDate first, then—only
    // because no current map is supplied here—allows bounded daily-v1 builder
    // syntax for historical records. This keeps honest old runs readable
    // without treating them as currently available for play or submission.
    !isDailySeedForDate(date, seed)
  ) {
    return "invalid";
  }
  return { kind: "daily", date, seed };
}

function parseRankedAttempt(
  value: unknown,
  parentSeed: string,
): RankedAttemptRunMetadata | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return "invalid";
  const attemptId = boundedString(value.attempt_id, 64);
  const seasonKey = boundedString(value.season_key, 256);
  const seed = boundedString(value.parent_seed, MAX_PARENT_SEED_CHARS);
  const expiresAt = boundedString(value.expires_at, 64);
  if (
    attemptId === null ||
    seasonKey === null ||
    seed === null ||
    seed !== parentSeed ||
    expiresAt === null ||
    Number.isNaN(Date.parse(expiresAt))
  ) {
    return "invalid";
  }
  return {
    attempt_id: attemptId,
    season_key: seasonKey,
    parent_seed: seed,
    expires_at: expiresAt,
  };
}

function parseRunRecordVersions(value: unknown): RunRecordVersions | null {
  if (!isPlainObject(value)) return null;
  const schema_version = boundedString(value.schema_version, MAX_VERSION_ANCHOR_CHARS);
  const dataset_version = boundedString(value.dataset_version, MAX_VERSION_ANCHOR_CHARS);
  const rating_version = boundedString(value.rating_version, MAX_VERSION_ANCHOR_CHARS);
  const engine_version = boundedString(value.engine_version, MAX_VERSION_ANCHOR_CHARS);
  const ruleset_version = boundedString(value.ruleset_version, MAX_VERSION_ANCHOR_CHARS);
  const data_bundle_hash = boundedString(value.data_bundle_hash, MAX_VERSION_ANCHOR_CHARS);
  if (
    schema_version === null ||
    dataset_version === null ||
    rating_version === null ||
    engine_version === null ||
    ruleset_version === null ||
    data_bundle_hash === null
  ) {
    return null;
  }
  return {
    schema_version,
    dataset_version,
    rating_version,
    engine_version,
    ruleset_version,
    data_bundle_hash,
  };
}

function parseRunRecordStatus(value: unknown): RunRecordStatus | undefined | "invalid" {
  if (value === undefined) return undefined;
  return value === "ready" || value === "simulating" || value === "complete" || value === "failed"
    ? value
    : "invalid";
}

function parseOptionalBoolean(value: unknown): boolean | undefined | "invalid" {
  if (value === undefined) return undefined;
  return typeof value === "boolean" ? value : "invalid";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maxChars: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxChars ? value : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function versionsMatch(a: RunRecordVersions, b: RunRecordVersions): boolean {
  return (
    a.schema_version === b.schema_version &&
    a.dataset_version === b.dataset_version &&
    a.rating_version === b.rating_version &&
    a.engine_version === b.engine_version &&
    a.ruleset_version === b.ruleset_version &&
    a.data_bundle_hash === b.data_bundle_hash
  );
}
