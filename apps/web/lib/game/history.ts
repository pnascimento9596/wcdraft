// Local run history provider.
//
// Why a provider boundary now: Phase F adds server-backed `saved_runs` for
// signed-in users. The shape that powers the UI — `HistoryEntry` — is
// display-ready and does not leak `RunRecordV1`/localStorage details. A
// future `serverRunHistoryProvider` can satisfy the same interface by
// mapping server rows to `HistoryEntry`s without touching the UI.
//
// Replay/share links MUST be tokenized; we never emit a bare local `run-v1-*`
// id from history. This matches the gate-and-fallback invariant the share
// screen already enforces.

import type { GameData } from "./data";
import { listRunRecords, RUN_RECORD_CAP, type RunRecordV1 } from "./run-record";
import { encodeRunToken, RunTokenError } from "./run-token";
import { resultsHref, shareHref } from "./navigation";
import { buildShareView } from "./share-adapters";

// ─── Display-ready types ─────────────────────────────────────────────────────

export interface HistoryKeyPick {
  name: string;
  /** Three-letter nation code for the flag chip — never a kit/crest mark. */
  nation_code: string;
}

export interface HistoryEntry {
  /** Local-only id (never used to build replay URLs — token only). */
  run_id: string;
  team_name: string;
  /** "W-L" — same shape as `ShareView.display_record`. */
  display_record: string;
  formation_name: string;
  /** Up to 3 key picks; names + national flag codes only. */
  key_picks: HistoryKeyPick[];
  /** "Most recent", "Previous run", "Recent run #N". */
  recency_label: string;
  /** Run sequence label derived from stored counters (no wall-clock dates). */
  sequence_label: string;
  /** Run seed — useful for the seed-locked replay promise. */
  seed: string;
  /** True when the run finished a tournament (champions); null when a server summary is absent. */
  is_champion: boolean | null;
  /** Tokenized replay URL, or `null` when tokenization fails. */
  replay_href: string | null;
  /** Tokenized share URL, or `null` when tokenization fails. */
  share_href: string | null;
  /** Honest-state error when tokenization fails. */
  replay_error: string | null;
  created_seq: number;
  updated_seq: number;
}

export interface HistoryListResult {
  entries: HistoryEntry[];
  persistence: "durable" | "volatile";
  warnings: string[];
}

export interface RunHistoryProvider {
  listCompletedRuns(gameData: GameData): Promise<HistoryListResult>;
}

// ─── Local provider ──────────────────────────────────────────────────────────

function buildSequenceLabel(record: RunRecordV1): string {
  const { created_seq, run_id } = record;
  if (!Number.isFinite(created_seq)) return run_id;
  return `Run #${created_seq}`;
}

function buildRecencyLabel(index: number): string {
  if (index === 0) return "Most recent";
  if (index === 1) return "Previous run";
  return `Recent run #${index + 1}`;
}

function buildHistoryEntry(
  gameData: GameData,
  record: RunRecordV1,
  index: number,
): HistoryEntry | null {
  const view = buildShareView(gameData, record);
  if (!view) return null; // No simulation yet — not a completed run.

  let replay_href: string | null = null;
  let share_href: string | null = null;
  let replay_error: string | null = null;
  try {
    const token = encodeRunToken(record);
    replay_href = resultsHref(token);
    share_href = shareHref(token);
  } catch (err) {
    replay_error =
      err instanceof RunTokenError
        ? err.message
        : "Couldn't build a reproducible replay link for this run.";
  }

  return {
    run_id: record.run_id,
    team_name: view.team_name,
    display_record: view.display_record,
    formation_name: view.formation_name,
    key_picks: view.stars.map((s) => ({ name: s.name, nation_code: s.nation_code })),
    recency_label: buildRecencyLabel(index),
    sequence_label: buildSequenceLabel(record),
    seed: view.seed,
    is_champion: view.is_champion,
    replay_href,
    share_href,
    replay_error,
    created_seq: record.created_seq,
    updated_seq: record.updated_seq,
  };
}

export const localRunHistoryProvider: RunHistoryProvider = {
  async listCompletedRuns(gameData: GameData): Promise<HistoryListResult> {
    const list = listRunRecords(gameData.versions, { limit: RUN_RECORD_CAP });
    // A completed run is one with `simulation` attached — relying on
    // `status === "complete"` would silently drop older records whose
    // `status` field predates the lifecycle addition.
    const completed = list.records.filter((r) => !!r.simulation);
    const entries: HistoryEntry[] = [];
    for (let i = 0; i < completed.length; i += 1) {
      const entry = buildHistoryEntry(gameData, completed[i]!, i);
      if (entry) entries.push(entry);
    }
    return {
      entries,
      persistence: list.persistence,
      warnings: list.warnings,
    };
  },
};

/**
 * Convenience entry point that defaults to the local provider. When server-
 * backed `saved_runs` lands in Phase F, this is the single swap point: the
 * UI imports `listCompletedRunHistory`, not a specific provider.
 */
export function listCompletedRunHistory(
  gameData: GameData,
  provider: RunHistoryProvider = localRunHistoryProvider,
): Promise<HistoryListResult> {
  return provider.listCompletedRuns(gameData);
}
