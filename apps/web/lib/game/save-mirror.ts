// F-3.5 — best-effort server save mirror.
//
// After a successful local `setRunSimulation`, fire-and-forget a POST to
// /api/runs so the run also lands on the server. Anon callers save under
// their anon session; signed-in callers save under their user. The F-3
// anon→account claim re-keys anon runs to the user at sign-in time.
//
// HONEST-STATE contracts:
//   - The local save is the SOURCE OF TRUTH for the UI render. The mirror
//     runs AFTER local persist, never before — a network failure NEVER
//     loses a user's run.
//   - The mirror NEVER throws. All errors are swallowed (and reported via
//     onError if provided) so the post-sim UI flow can't break here.
//   - If the simulation isn't in the record yet, we skip the mirror
//     (summary would be a lie).
import { buildShareView } from "./share-adapters";
import { encodeRunToken, RunTokenError } from "./run-token";
import { ensureCsrfToken, patchJson, postJson } from "@/lib/auth/client";
import type { GameData } from "./data";
import type { RunRecordV1 } from "./run-record";
import type { SavedRunSummary } from "./saved-runs-store";

export interface SaveMirrorResult {
  readonly attempted: boolean;
  readonly ok: boolean;
  readonly status: number | null;
  readonly errorMessage: string | null;
}

const mirrorInFlight = new Set<string>();
const mirrorComplete = new Set<string>();

function mirrorKey(record: RunRecordV1): string {
  return `${record.run_id}:${record.updated_seq.toString()}`;
}

/**
 * Build the F-3.5 display-ready summary from a completed RunRecordV1.
 * Returns null when the record has no simulation (the share-view can't be
 * built) — honest-state: better to send no summary than a partial one.
 */
export function buildSavedRunSummary(
  gameData: GameData,
  record: RunRecordV1,
): SavedRunSummary | null {
  const simulation = record.simulation;
  if (!simulation) return null;
  const view = buildShareView(gameData, record);
  if (!view) return null;
  return {
    team_name: view.team_name,
    display_record: view.display_record,
    score: view.score,
    wins: simulation.run.wins,
    draws: simulation.run.draws,
    losses: simulation.run.losses,
    undefeated_regulation: simulation.run.undefeated_regulation,
    formation_name: view.formation_name,
    draft_mode: record.draft.mode,
    draft_order: record.draft.draft_flow,
    era_preset: record.draft.era_preset,
    rating_basis: record.draft.rating_basis,
    key_picks: view.stars.slice(0, 3).map((s) => ({
      name: s.name,
      nation_code: s.nation_code,
    })),
    is_champion: view.is_champion,
    is_perfect_eight_zero: view.is_perfect_eight_zero,
    reached_round: view.reached_round,
    matches_played: view.matches_played,
    challenge_date: view.challenge_date,
    seed: view.seed,
    created_seq: record.created_seq,
    updated_seq: record.updated_seq,
  };
}

/**
 * Mirror a completed run to the server. Caller MUST have already run the
 * local `setRunSimulation`; this only fires the server POST.
 */
export async function mirrorRunToServer(
  gameData: GameData,
  record: RunRecordV1,
): Promise<SaveMirrorResult> {
  const key = mirrorKey(record);
  if (mirrorInFlight.has(key) || mirrorComplete.has(key)) {
    return {
      attempted: false,
      ok: true,
      status: null,
      errorMessage: "mirror already in flight",
    };
  }
  mirrorInFlight.add(key);
  try {
    const summary = buildSavedRunSummary(gameData, record);
    if (!summary) {
      return {
        attempted: false,
        ok: false,
        status: null,
        errorMessage: "no simulation in record (skipping mirror)",
      };
    }
    let token: string;
    try {
      token = encodeRunToken(record);
    } catch (err) {
      const msg =
        err instanceof RunTokenError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return { attempted: false, ok: false, status: null, errorMessage: msg };
    }
    // CSRF + Origin via the auth helpers. ensureCsrfToken bootstraps an
    // anon session if needed.
    await ensureCsrfToken();
    const r = await postJson<{ idempotent?: boolean }>("/api/runs", {
      token,
      versionAnchors: record.versions,
      runId: record.run_id,
      parentSeed: record.parent_seed,
      summary,
      pinned: record.pinned === true,
    });
    if (r.ok) mirrorComplete.add(key);
    return {
      attempted: true,
      ok: r.ok,
      status: r.status,
      errorMessage: r.ok ? null : `HTTP ${r.status.toString()}`,
    };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      status: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    mirrorInFlight.delete(key);
  }
}

/** Best-effort mirror of the local preservation flag. Local state stays authoritative. */
export async function mirrorRunPinToServer(runId: string, pinned: boolean): Promise<void> {
  try {
    await ensureCsrfToken();
    await patchJson("/api/runs", { runId, pinned });
  } catch {
    // Pinning is already durable locally. The next full mirror can reconcile it.
  }
}
