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
  GroupIdSchema,
  GroupStageResultSchema,
  KnockoutRoundSchema,
  MatchResultSchema,
  RunResultSchema,
  type DraftState,
  type MatchResult,
  type RunResult,
  type RunScenario,
  type GroupStageResult,
  type KnockoutRound,
  type DraftMode,
  type DraftFlow,
  type EraPresetId,
  type RatingBasis,
} from "@wcdraft/core";

import type { GameData, RunRecordVersions } from "./data";
import { getCatalogForEra } from "./data";
import { isDailyChallengeDate, isDailySeedForDate, type DailyChallenge } from "./daily";
import { RunRecordError, StorageQuotaError, StorageUnavailableError } from "./errors";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const RUN_RECORD_SCHEMA_VERSION = 1 as const;

/**
 * Per-round opponent-selection meta that `runTournamentFull` returns alongside
 * the run + matches. We persist it on the RunRecord verbatim for audit/replay;
 * the engine's `KnockoutLadderMeta` type is not exported through the public
 * barrel, so this is the JSON-shaped equivalent kept independent.
 */
export interface PersistedKnockoutLadderRoundMeta {
  round: string;
  opponent_team_id: string;
  bracket_constrained: boolean;
  fallback: boolean;
  fallback_reason: string | null;
  user_slot_id: string | null;
  opposite_slot_id: string | null;
  candidate_group_ids: string[];
}

export interface PersistedKnockoutLadderMeta {
  rounds: PersistedKnockoutLadderRoundMeta[];
}

/**
 * I3.7 — persisted simulation payload. Always written together as a single
 * unit; missing `simulation` means the run hasn't been simulated yet (the user
 * is still in draft/review).
 *
 * DETERMINISM CONTRACT — this payload IS the deterministic subset of a run:
 * re-running `runTournamentFull(draft, scenario, parent_seed, world)` with
 * byte-identical inputs reproduces every field here byte-for-byte. Wall-clock
 * telemetry (e.g. `duration_ms`) lives OUTSIDE this type — see
 * `SimulationTelemetry` — so it cannot accidentally diverge two otherwise-
 * identical runs.
 */
export interface PersistedSimulation {
  /** Resolved RunScenario from `buildRunScenario(parent_seed, ...)`. */
  scenario: RunScenario;
  /** Final scored run (carries seed, narrative, score_breakdown, etc). */
  run: RunResult;
  /** Per-match results — atomic event log per round. */
  matches: MatchResult[];
  /** Scoped 4-team group table + qualification verdict. */
  group_stage: GroupStageResult;
  /** Per-round R32 selection meta. */
  knockout_ladder_meta: PersistedKnockoutLadderMeta;
}

/**
 * Non-deterministic telemetry sibling to `PersistedSimulation`. Captured at
 * the simulation site and surfaced to callers; explicitly NOT part of the
 * persisted-payload byte-identity guarantee. Two byte-identical runs may
 * report different `duration_ms` values.
 */
export interface SimulationTelemetry {
  /** Wall-clock duration in milliseconds; null when no high-res clock is available. */
  duration_ms: number | null;
}

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
const MAX_SIM_MATCHES = 8;
const MIN_SIM_MATCHES = 3;
const MAX_KNOCKOUT_META_ROUNDS = 5;
const MAX_CANDIDATE_GROUP_IDS = 8;

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
  entries.push({
    run_id: rec.run_id,
    created_seq: rec.created_seq,
    updated_seq: rec.updated_seq,
    versions: rec.versions,
    ...(rec.pinned === true ? { pinned: true } : {}),
  });
  entries.sort((a, b) => a.updated_seq - b.updated_seq);
  return { record_version: RUN_RECORD_SCHEMA_VERSION, entries };
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
      const save = saveRunRecord(record);
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

/** Load a `RunRecord`. Stale on any version-anchor mismatch — the record is evicted. */
export function loadRunRecord(
  run_id: string,
  currentVersions: RunRecordVersions,
): LoadRunRecordResult {
  const storage = getStorage();
  const raw = storage.getItem(recordKey(run_id));
  if (!raw) return { status: "missing", record: null };
  const parsed = parseStoredRunRecord(raw, run_id);
  if (!parsed) {
    evictRunRecord(storage, run_id);
    return { status: "invalid", record: null };
  }
  if (!versionsMatch(parsed.versions, currentVersions)) {
    evictRunRecord(storage, run_id);
    return { status: "stale", record: null };
  }
  return { status: "loaded", record: parsed };
}

/** Persist a record. Best-effort durable; falls back to in-memory on quota / blocked storage. */
export function saveRunRecord(record: RunRecordV1): SaveRunRecordResult {
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
          evictRunRecord(storage, oldest.run_id);
          try {
            storage.setItem(key, payload);
          } catch (retryErr) {
            if (isQuotaError(retryErr)) {
              volatileMode = true;
              storage = memoryBackend;
              storage.setItem(key, payload);
              warnings.push("storage quota exhausted: draft saved to this tab only");
            } else {
              throw new StorageQuotaError(
                `Failed to persist run record after eviction retry: ${String(retryErr)}`,
              );
            }
          }
        } else {
          volatileMode = true;
          storage = memoryBackend;
          storage.setItem(key, payload);
          warnings.push("storage quota exhausted: draft saved to this tab only");
        }
      } else {
        volatileMode = true;
        storage = memoryBackend;
        storage.setItem(key, payload);
        warnings.push("storage quota exhausted: draft saved to this tab only");
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

export interface UpdateRunRecordResult {
  status: "updated" | "missing" | "stale" | "invalid";
  record: RunRecordV1 | null;
  persistence: "durable" | "volatile" | "none";
  warnings: string[];
}

/**
 * Read-modify-write the record. The updater returns the next `DraftState`; we
 * stamp `updated_seq` and persist.
 */
export function updateRunRecord(
  run_id: string,
  currentVersions: RunRecordVersions,
  updater: (current: RunRecordV1) => DraftState,
): UpdateRunRecordResult {
  const loaded = loadRunRecord(run_id, currentVersions);
  if (loaded.status !== "loaded" || !loaded.record) {
    const status = loaded.status as "missing" | "stale" | "invalid";
    return { status, record: null, persistence: "none", warnings: [] };
  }
  const storage = getStorage();
  const nextSeq = nextCounter(storage);
  const next: RunRecordV1 = {
    ...loaded.record,
    updated_seq: nextSeq,
    draft: updater(loaded.record),
  };
  const save = saveRunRecord(next);
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
  status: "updated" | "missing" | "stale" | "invalid";
  record: RunRecordV1 | null;
  persistence: "durable" | "volatile" | "none";
  warnings: string[];
}

export function setRunSimulation(
  run_id: string,
  currentVersions: RunRecordVersions,
  simulation: PersistedSimulation,
): SetSimulationResult {
  const loaded = loadRunRecord(run_id, currentVersions);
  if (loaded.status !== "loaded" || !loaded.record) {
    const status = loaded.status as "missing" | "stale" | "invalid";
    return { status, record: null, persistence: "none", warnings: [] };
  }
  const storage = getStorage();
  const nextSeq = nextCounter(storage);
  const next: RunRecordV1 = {
    ...loaded.record,
    updated_seq: nextSeq,
    status: "complete",
    simulation,
  };
  const save = saveRunRecord(next);
  return {
    status: "updated",
    record: next,
    persistence: save.persistence,
    warnings: save.warnings,
  };
}

/** Update the lifecycle status (without changing other persisted fields). */
export function setRunStatus(
  run_id: string,
  currentVersions: RunRecordVersions,
  status: RunRecordStatus,
): SetSimulationResult {
  const loaded = loadRunRecord(run_id, currentVersions);
  if (loaded.status !== "loaded" || !loaded.record) {
    const s = loaded.status as "missing" | "stale" | "invalid";
    return { status: s, record: null, persistence: "none", warnings: [] };
  }
  const storage = getStorage();
  const nextSeq = nextCounter(storage);
  const next: RunRecordV1 = {
    ...loaded.record,
    updated_seq: nextSeq,
    status,
  };
  const save = saveRunRecord(next);
  return {
    status: "updated",
    record: next,
    persistence: save.persistence,
    warnings: save.warnings,
  };
}

export function setRunPinned(
  run_id: string,
  currentVersions: RunRecordVersions,
  pinned: boolean,
): SetSimulationResult {
  const loaded = loadRunRecord(run_id, currentVersions);
  if (loaded.status !== "loaded" || !loaded.record) {
    const s = loaded.status as "missing" | "stale" | "invalid";
    return { status: s, record: null, persistence: "none", warnings: [] };
  }
  const next: RunRecordV1 = { ...loaded.record };
  if (pinned) next.pinned = true;
  else delete next.pinned;
  const save = saveRunRecord(next);
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
 * newest first. Mismatched-version or otherwise-invalid records are evicted
 * in-place (mirrors `loadRunRecord` honest-state behavior); the index is
 * repaired in a single pass so subsequent reads stay clean.
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

  // Newest first — `saveIndex` sorts ascending by `updated_seq`, so reverse.
  const sorted = [...idx.entries].sort((a, b) => {
    if (b.updated_seq !== a.updated_seq) return b.updated_seq - a.updated_seq;
    if (b.created_seq !== a.created_seq) return b.created_seq - a.created_seq;
    return b.run_id.localeCompare(a.run_id);
  });

  const records: RunRecordV1[] = [];
  let unpinnedReturned = 0;
  const warnings: string[] = [];
  const survivingIds = new Set<string>();
  let indexDirty = false;

  for (const entry of sorted) {
    const raw = storage.getItem(recordKey(entry.run_id));
    if (!raw) {
      indexDirty = true;
      warnings.push(`history: index entry '${entry.run_id}' had no stored record`);
      continue;
    }
    const parsed = parseStoredRunRecord(raw, entry.run_id);
    if (!parsed) {
      storage.removeItem(recordKey(entry.run_id));
      indexDirty = true;
      warnings.push(`history: evicted malformed record '${entry.run_id}'`);
      continue;
    }
    if (!versionsMatch(parsed.versions, currentVersions)) {
      storage.removeItem(recordKey(entry.run_id));
      indexDirty = true;
      continue;
    }
    if (parsed.pinned !== true && unpinnedReturned >= limit) {
      survivingIds.add(entry.run_id);
      continue;
    }
    records.push(parsed);
    if (parsed.pinned !== true) unpinnedReturned += 1;
    survivingIds.add(entry.run_id);
  }

  if (indexDirty) {
    const repaired: RunRecordIndexV1 = {
      record_version: RUN_RECORD_SCHEMA_VERSION,
      entries: idx.entries
        .filter((e) => survivingIds.has(e.run_id))
        .sort((a, b) => a.updated_seq - b.updated_seq),
    };
    try {
      saveIndex(storage, repaired);
    } catch {
      // Best-effort: a failure to write the repaired index just means the
      // next read repeats the cleanup. Do not surface as a user-facing error.
    }
  }

  return {
    records,
    persistence: storage.isVolatile ? "volatile" : "durable",
    warnings,
  };
}

/** Drop every record whose version anchors don't match `currentVersions`. */
export function evictStaleRunRecords(currentVersions: RunRecordVersions): void {
  const storage = getStorage();
  const idx = loadIndex(storage);
  const fresh: RunRecordIndexEntry[] = [];
  for (const entry of idx.entries) {
    if (versionsMatch(entry.versions, currentVersions)) {
      fresh.push(entry);
    } else {
      storage.removeItem(recordKey(entry.run_id));
    }
  }
  if (fresh.length !== idx.entries.length) {
    saveIndex(storage, { record_version: RUN_RECORD_SCHEMA_VERSION, entries: fresh });
  }
}

function evictRunRecord(storage: StorageBackend, run_id: string): void {
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

  let simulation: PersistedSimulation | undefined;
  if (value.simulation !== undefined) {
    const parsedSimulation = parsePersistedSimulation(value.simulation);
    if (parsedSimulation === null) return null;
    simulation = parsedSimulation;
  }
  if (status === "complete" && simulation === undefined) return null;
  if (simulation !== undefined && status !== "complete") return null;

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

function parsePersistedSimulation(value: unknown): PersistedSimulation | null {
  if (!isPlainObject(value)) return null;
  const scenario = parseRunScenario(value.scenario);
  const run = RunResultSchema.safeParse(value.run);
  const matches = parseMatches(value.matches);
  const groupStage = GroupStageResultSchema.safeParse(value.group_stage);
  const knockout = parseKnockoutMeta(value.knockout_ladder_meta);
  if (scenario === null || !run.success || matches === null || !groupStage.success || !knockout) {
    return null;
  }
  return {
    scenario,
    run: run.data,
    matches,
    group_stage: groupStage.data,
    knockout_ladder_meta: knockout,
  };
}

function parseRunScenario(value: unknown): RunScenario | null {
  if (!isPlainObject(value)) return null;
  const scenario_id = boundedString(value.scenario_id, 128);
  const group = GroupIdSchema.safeParse(value.user_group_id);
  const groupOpponents = parseStringArray(value.group_opponent_team_ids, 3, 3, 128);
  const rule = parseKnockoutOpponentRule(value.knockout_opponent_rule);
  const ruleset_version = boundedString(value.ruleset_version, MAX_VERSION_ANCHOR_CHARS);
  const scenario_seed = boundedString(value.scenario_seed, MAX_PARENT_SEED_CHARS);
  if (
    scenario_id === null ||
    !group.success ||
    groupOpponents === null ||
    rule === null ||
    ruleset_version === null ||
    scenario_seed === null
  ) {
    return null;
  }
  return {
    scenario_id,
    user_group_id: group.data,
    group_opponent_team_ids: groupOpponents,
    knockout_opponent_rule: rule,
    ruleset_version,
    scenario_seed,
  };
}

function parseKnockoutOpponentRule(value: unknown): RunScenario["knockout_opponent_rule"] | null {
  if (!isPlainObject(value)) return null;
  if (value.kind !== "escalating_strength_seeded") return null;
  if (!Array.isArray(value.rounds) || value.rounds.length === 0 || value.rounds.length > 5) {
    return null;
  }
  const rounds: KnockoutRound[] = [];
  for (const round of value.rounds) {
    const parsed = KnockoutRoundSchema.safeParse(round);
    if (!parsed.success) return null;
    rounds.push(parsed.data);
  }
  const seed_suffix = boundedString(value.seed_suffix, 128);
  if (seed_suffix === null) return null;
  return { kind: "escalating_strength_seeded", rounds, seed_suffix };
}

function parseMatches(value: unknown): MatchResult[] | null {
  if (!Array.isArray(value) || value.length < MIN_SIM_MATCHES || value.length > MAX_SIM_MATCHES) {
    return null;
  }
  const matches: MatchResult[] = [];
  for (const match of value) {
    const parsed = MatchResultSchema.safeParse(match);
    if (!parsed.success) return null;
    matches.push(parsed.data);
  }
  return matches;
}

function parseKnockoutMeta(value: unknown): PersistedKnockoutLadderMeta | null {
  if (!isPlainObject(value) || !Array.isArray(value.rounds)) return null;
  if (value.rounds.length > MAX_KNOCKOUT_META_ROUNDS) return null;
  const rounds: PersistedKnockoutLadderRoundMeta[] = [];
  for (const round of value.rounds) {
    const parsed = parseKnockoutRoundMeta(round);
    if (parsed === null) return null;
    rounds.push(parsed);
  }
  return { rounds };
}

function parseKnockoutRoundMeta(value: unknown): PersistedKnockoutLadderRoundMeta | null {
  if (!isPlainObject(value)) return null;
  const round = boundedString(value.round, 16);
  const opponent_team_id = boundedString(value.opponent_team_id, 128);
  const fallback_reason = nullableBoundedString(value.fallback_reason, 256);
  const user_slot_id = nullableBoundedString(value.user_slot_id, 64);
  const opposite_slot_id = nullableBoundedString(value.opposite_slot_id, 64);
  const candidate_group_ids = parseStringArray(
    value.candidate_group_ids,
    0,
    MAX_CANDIDATE_GROUP_IDS,
    16,
  );
  if (
    round === null ||
    opponent_team_id === null ||
    typeof value.bracket_constrained !== "boolean" ||
    typeof value.fallback !== "boolean" ||
    fallback_reason === INVALID_NULLABLE_STRING ||
    user_slot_id === INVALID_NULLABLE_STRING ||
    opposite_slot_id === INVALID_NULLABLE_STRING ||
    candidate_group_ids === null
  ) {
    return null;
  }
  return {
    round,
    opponent_team_id,
    bracket_constrained: value.bracket_constrained,
    fallback: value.fallback,
    fallback_reason,
    user_slot_id,
    opposite_slot_id,
    candidate_group_ids,
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

const INVALID_NULLABLE_STRING = Symbol("invalid-nullable-string");

function nullableBoundedString(
  value: unknown,
  maxChars: number,
): string | null | typeof INVALID_NULLABLE_STRING {
  if (value === null) return null;
  return boundedString(value, maxChars) ?? INVALID_NULLABLE_STRING;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseStringArray(
  value: unknown,
  minLength: number,
  maxLength: number,
  maxChars: number,
): string[] | null {
  if (!Array.isArray(value) || value.length < minLength || value.length > maxLength) return null;
  const out: string[] = [];
  for (const item of value) {
    const parsed = boundedString(item, maxChars);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
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
