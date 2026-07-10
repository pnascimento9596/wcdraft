// F-3 — server-backed `RunHistoryProvider` (client-side).
//
// Lives behind the PR-#23 `RunHistoryProvider` interface (see
// `lib/game/history.ts`). Fetches the caller's saved_runs from
// `/api/runs` and maps each row to a display-ready `HistoryEntry`.
//
// Cost firewall preserved
// -----------------------
// The server never re-simulates. The token-decode → `buildShareView`
// pipeline runs entirely on the client. When the replay token alone
// decodes cleanly AND a local-storage cache hit lands the `simulation`
// payload, the rich display fields (`display_record`, `formation_name`,
// `key_picks`, …) match what `localRunHistoryProvider` would render for
// the same run.
//
// When no cache hit lands — e.g. signing in from a fresh device — the
// row still surfaces as a `HistoryEntry`, but with honest-null / placeholder
// display fields. The Yellow follow PR is responsible for upgrading the
// display path (either by deterministically re-simulating on the client
// or by persisting an additional `summary` column server-side; this
// trade-off intentionally stays out of scope here).
//
// UI swap timing
// --------------
// The UI swap from `localRunHistoryProvider` to this one is the Yellow
// follow. F-3 lands the provider + the route handlers it consumes so
// the swap is a one-import change.
import { boundedRequest, isRequestTimeoutError, REQUEST_BUDGET_MS } from "@wcdraft/data/client";

import type { GameData } from "./data";
import { type HistoryEntry, type HistoryListResult, type RunHistoryProvider } from "./history";
import { decodeRunTokenForDisplay } from "./run-screen-loader";
import { RunTokenError } from "./run-token";
import { resultsHref, shareHref } from "./navigation";
import { RUN_RECORD_CAP } from "./run-record";

interface ApiRunSummary {
  team_name: string;
  display_record: string;
  formation_name: string;
  key_picks: ReadonlyArray<{ name: string; nation_code: string }>;
  is_champion: boolean;
  seed: string;
  created_seq?: number;
  updated_seq?: number;
}

interface ApiRun {
  id: string;
  token: string;
  run_id: string | null;
  parent_seed: string | null;
  version_anchors: unknown;
  /** F-3.5 — display-ready summary; null on pre-F-3.5 rows. */
  summary: ApiRunSummary | null;
  claim_state: string;
  created_at: string;
}

function isApiRunSummary(x: unknown): x is ApiRunSummary {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.team_name === "string" &&
    typeof o.display_record === "string" &&
    typeof o.formation_name === "string" &&
    typeof o.is_champion === "boolean" &&
    typeof o.seed === "string" &&
    Array.isArray(o.key_picks)
  );
}

interface ListResponse {
  runs: ApiRun[];
  cap: number;
}

export interface ServerProviderConfig {
  /** Override the base URL used for fetch — useful for tests + SSR. */
  readonly baseUrl?: string;
  /** Override `fetch` for tests / SSR contexts. */
  readonly fetcher?: typeof fetch;
}

/**
 * Build a server-backed provider conforming to the existing
 * `RunHistoryProvider` interface.
 */
export function createServerRunHistoryProvider(
  config: ServerProviderConfig = {},
): RunHistoryProvider {
  const fetchImpl = config.fetcher ?? fetch.bind(globalThis);
  const baseUrl = config.baseUrl ?? "";

  return {
    async listCompletedRuns(gameData: GameData): Promise<HistoryListResult> {
      const url = `${baseUrl}/api/runs?limit=${RUN_RECORD_CAP.toString()}`;
      try {
        return await boundedRequest(
          async (signal) => {
            const response = await fetchImpl(url, {
              credentials: "include",
              headers: { Accept: "application/json" },
              signal,
            });
            if (!response.ok) {
              return {
                entries: [],
                persistence: "volatile",
                warnings: [
                  `server-history: GET /api/runs returned HTTP ${response.status.toString()}`,
                ],
              } satisfies HistoryListResult;
            }
            let body: ListResponse | null;
            try {
              body = (await response.json()) as ListResponse;
            } catch {
              if (signal.aborted) throw signal.reason;
              body = null;
            }
            if (!body || !Array.isArray(body.runs)) {
              return {
                entries: [],
                persistence: "volatile",
                warnings: ["server-history: malformed response"],
              } satisfies HistoryListResult;
            }

            return historyResultFromResponse(gameData, body);
          },
          {
            operation: "account run history",
            timeoutMs: REQUEST_BUDGET_MS.auth,
            safety: "safe-read",
          },
        );
      } catch (err) {
        if (isRequestTimeoutError(err)) throw err;
        return {
          entries: [],
          persistence: "volatile",
          warnings: ["server-history: fetch failed"],
        };
      }
    },
  };
}

function historyResultFromResponse(gameData: GameData, body: ListResponse): HistoryListResult {
  const entries: HistoryEntry[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < body.runs.length; i += 1) {
    const apiRow = body.runs[i]!;
    const tokenState = decodeRunTokenForDisplay(apiRow.token);
    const decoded = tokenState.kind === "ready" ? tokenState.token : null;
    const summary = isApiRunSummary(apiRow.summary) ? apiRow.summary : null;
    if (!decoded && !summary) {
      warnings.push(
        `server-history: row ${apiRow.id} has neither a decodable token nor a summary (skipped)`,
      );
      continue;
    }
    entries.push(buildHistoryEntryFromApiRow(gameData, decoded, apiRow, i));
  }
  return {
    entries: entries.slice(0, RUN_RECORD_CAP),
    persistence: "durable",
    warnings,
  };
}

/**
 * Build a `HistoryEntry` from an API row + decoded token body.
 *
 * F-3.5 contract — honest-state display:
 *   - When `apiRow.summary` is present and well-formed, use it for the
 *     display-rich fields (`display_record`, `key_picks`, `is_champion`,
 *     `formation_name`, etc.). These are the REAL records, not
 *     placeholders.
 *   - When `summary` is null (pre-F-3.5 row, or a save mirror that raced
 *     ahead of the simulation, or a client that omitted it), the display
 *     fields fall back to honest sentinels: `display_record = "—"`,
 *     `key_picks = []`, `is_champion = null`. The token-decoded data
 *     (`team_name`, `seed`, `formation_id`) still populates what it can.
 *     Never fabricated.
 */
function buildHistoryEntryFromApiRow(
  _gameData: GameData,
  decoded: {
    rid: string;
    fid: string;
    ps: string;
    tn: string;
  } | null,
  apiRow: ApiRun,
  index: number,
): HistoryEntry {
  let replay_href: string | null = null;
  let share_href: string | null = null;
  let replay_error: string | null = null;
  // Only attempt replay/share links if we actually have a decoded token.
  // A row that survived only on its summary has no usable share link.
  if (decoded) {
    try {
      replay_href = resultsHref(apiRow.token);
      share_href = shareHref(apiRow.token);
    } catch (err) {
      replay_error =
        err instanceof RunTokenError
          ? err.message
          : "Couldn't build a reproducible replay link for this run.";
    }
  } else {
    replay_error = "This run's token didn't decode; replay isn't available.";
  }
  const summary = isApiRunSummary(apiRow.summary) ? apiRow.summary : null;
  return {
    run_id: apiRow.run_id ?? decoded?.rid ?? apiRow.id,
    team_name: summary?.team_name ?? decoded?.tn ?? "—",
    // Honest-state — "—" sentinel when summary is missing.
    display_record: summary?.display_record ?? "—",
    formation_name: summary?.formation_name ?? decoded?.fid ?? "—",
    key_picks: summary
      ? summary.key_picks.map((s) => ({
          name: s.name,
          nation_code: s.nation_code,
        }))
      : [],
    recency_label: buildRecencyLabel(index),
    sequence_label: apiRow.run_id ?? decoded?.rid ?? apiRow.id,
    seed: summary?.seed ?? apiRow.parent_seed ?? decoded?.ps ?? "—",
    is_champion: summary?.is_champion ?? null,
    replay_href,
    share_href,
    replay_error,
    created_seq: summary?.created_seq ?? 0,
    updated_seq: summary?.updated_seq ?? 0,
  };
}

function buildRecencyLabel(index: number): string {
  if (index === 0) return "Most recent";
  if (index === 1) return "Previous run";
  return `Recent run #${(index + 1).toString()}`;
}
