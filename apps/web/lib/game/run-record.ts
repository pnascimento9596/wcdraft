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
//   - parent_seed is `wcdraft:run:v1:<run_id>:<formation_id>` so identical
//     local counter sequences produce identical drafts.
//   - createDraft can throw if the 17 drawn pairs contain no coach; we
//     advance the counter and retry up to 20 times before surfacing a
//     recoverable error to the UI.

import { createDraft, type DraftState } from "@wcdraft/core";

import type { GameData, RunRecordVersions } from "./data";
import {
  RunRecordError,
  StorageQuotaError,
  StorageUnavailableError,
} from "./errors";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const RUN_RECORD_SCHEMA_VERSION = 1 as const;

export interface RunRecordV1 {
  record_version: typeof RUN_RECORD_SCHEMA_VERSION;
  run_id: string;
  parent_seed: string;
  created_seq: number;
  updated_seq: number;
  versions: RunRecordVersions;
  draft: DraftState;
}

interface RunRecordIndexEntry {
  run_id: string;
  created_seq: number;
  updated_seq: number;
  versions: RunRecordVersions;
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

function buildParentSeed(run_id: string, formation_id: string): string {
  return `wcdraft:run:v1:${run_id}:${formation_id}`;
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
  mode?: "classic" | "hidden";
  team_name?: string;
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
    const parent_seed = buildParentSeed(run_id, params.formation_id);
    try {
      const draft = createDraft(gameData.catalog, {
        run_id,
        parent_seed,
        formation_id: params.formation_id,
        mode: params.mode ?? "classic",
        team_name: params.team_name ?? "Your XI",
        dataset_version: gameData.versions.dataset_version,
        rating_version: gameData.versions.rating_version,
        engine_version: gameData.versions.engine_version,
      });
      const record: RunRecordV1 = {
        record_version: RUN_RECORD_SCHEMA_VERSION,
        run_id,
        parent_seed,
        created_seq: seq,
        updated_seq: seq,
        versions: gameData.versions,
        draft,
      };
      const save = saveRunRecord(record);
      warnings.push(...save.warnings);
      return { record, persistence: save.persistence, warnings };
    } catch (err) {
      lastErr = err;
      // Retry on the specific "no coach in 17 spins" failure; surface anything
      // else immediately.
      if (
        err instanceof RangeError &&
        /none of the 17 drawn/i.test(err.message)
      ) {
        continue;
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
  let parsed: RunRecordV1;
  try {
    parsed = JSON.parse(raw) as RunRecordV1;
  } catch {
    evictRunRecord(storage, run_id);
    return { status: "invalid", record: null };
  }
  if (parsed.record_version !== RUN_RECORD_SCHEMA_VERSION || !parsed.draft) {
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
  while (nextIdx.entries.length > RUN_RECORD_CAP) {
    const drop = nextIdx.entries.shift()!;
    if (drop.run_id !== record.run_id) {
      storage.removeItem(recordKey(drop.run_id));
    }
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
