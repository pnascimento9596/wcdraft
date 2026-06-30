import { computeSynergy, FORMATION_TEMPLATES } from "@wcdraft/core";

import { managerCardView, managerTournamentFor, pitchSlotViews } from "../game/adapters";
import { sha256Hex } from "../auth/tokens";
import { verifyRunTokenForOg } from "../game/run-og-server";
import { formationName } from "../game/share-adapters";
import { lineStrengthViews, squadAverageOverall } from "../game/adapters";
import type { ValidationData } from "./validate";
import type { LeaderboardLineupView } from "./lineup-view";

export type LineupInspectorRejectionReason =
  | "MALFORMED_TOKEN"
  | "UNSUPPORTED_TOKEN"
  | "DIFFERENT_BUILD"
  | "ILLEGAL_PICK"
  | "SIM_FAILURE";

export type LineupInspectorDecision =
  | {
      readonly status: "accepted";
      readonly cacheKey: string;
      readonly view: LeaderboardLineupView;
      readonly cacheHit: boolean;
    }
  | {
      readonly status: "rejected";
      readonly reason: LineupInspectorRejectionReason;
    };

const LINEUP_CACHE_MAX_ENTRIES = 512;
const lineupCache = new Map<string, LeaderboardLineupView>();

export function readCachedLineupInspector(
  token: string,
  data: ValidationData,
): { readonly cacheKey: string; readonly view: LeaderboardLineupView } | null {
  const cacheKey = lineupCacheKey(token, data);
  const cached = lineupCache.get(cacheKey);
  if (!cached) return null;
  lineupCache.delete(cacheKey);
  lineupCache.set(cacheKey, cached);
  return { cacheKey, view: cached };
}

export function deriveAndCacheLineupInspector(
  token: string,
  data: ValidationData,
): LineupInspectorDecision {
  const cached = readCachedLineupInspector(token, data);
  if (cached) {
    return { status: "accepted", cacheKey: cached.cacheKey, view: cached.view, cacheHit: true };
  }

  const verified = verifyRunTokenForOg(token, data);
  if (verified.status !== "accepted") {
    return { status: "rejected", reason: rejectionReason(verified.reason) };
  }

  const view = buildLeaderboardLineupView(data, verified);
  const cacheKey = lineupCacheKey(token, data);
  lineupCache.set(cacheKey, view);
  while (lineupCache.size > LINEUP_CACHE_MAX_ENTRIES) {
    const oldest = lineupCache.keys().next().value;
    if (!oldest) break;
    lineupCache.delete(oldest);
  }
  return { status: "accepted", cacheKey, view, cacheHit: false };
}

export function resetLineupInspectorCacheForTests(): void {
  lineupCache.clear();
}

type AcceptedOgVerification = Extract<
  ReturnType<typeof verifyRunTokenForOg>,
  { status: "accepted" }
>;

export function buildLeaderboardLineupView(
  data: ValidationData,
  verified: AcceptedOgVerification,
): LeaderboardLineupView {
  const draft = verified.draft;
  const formation = FORMATION_TEMPLATES[draft.formation_id];
  if (!formation) throw new Error(`leaderboard lineup: unknown formation ${draft.formation_id}`);
  const basis = draft.rating_basis;
  const { starters, bench } = pitchSlotViews(data.gameData.indexes, draft, { basis });
  const manager = draft.manager_card_id
    ? managerCardView(data.gameData.indexes, draft.manager_card_id)
    : null;
  const managerTournament = draft.manager_card_id
    ? managerTournamentFor(data.gameData.indexes, draft.manager_card_id)
    : null;
  const synergy = computeSynergy(
    draft.squad,
    formation,
    managerTournament,
    data.gameData.nationByCardId,
  );

  return {
    team_name: verified.model.team_name,
    mode_label: verified.model.mode_label,
    formation: {
      id: draft.formation_id,
      name: formationName(draft),
    },
    badges: verified.model.badges,
    result: {
      score: verified.run.score,
      score_label: `${verified.run.score} pts`,
      record: `${verified.run.wins}-${verified.run.losses}`,
      wins: verified.run.wins,
      losses: verified.run.losses,
      matches_played: verified.matches.length,
      goals_for: verified.run.aggregate.goals_for,
      goals_against: verified.run.aggregate.goals_against,
      reached_round: verified.run.reached_round,
      is_champion: verified.run.is_champion,
      shootout_wins: verified.run.shootout_wins,
    },
    starters,
    bench,
    manager,
    linked_pairs: synergy.linked_pairs,
    line_strengths: lineStrengthViews(data.gameData.indexes, draft, { basis }),
    squad_average: squadAverageOverall(data.gameData.indexes, draft, { basis }),
  };
}

function lineupCacheKey(token: string, data: ValidationData): string {
  const versions = data.gameData.versions;
  const bundleHash = versions.data_bundle_hash
    .split("+")
    .map((part) => part.slice(0, 12))
    .join(".");
  const versionKey = [
    versions.schema_version,
    versions.dataset_version,
    versions.rating_version,
    versions.engine_version,
    versions.ruleset_version,
    bundleHash,
  ]
    .join(".")
    .replace(/[^A-Za-z0-9_.-]/gu, "-")
    .slice(0, 160);
  return `lineup:${versionKey}:${sha256Hex(token)}`;
}

function rejectionReason(
  reason: Exclude<ReturnType<typeof verifyRunTokenForOg>, { status: "accepted" }>["reason"],
): LineupInspectorRejectionReason {
  switch (reason) {
    case "MALFORMED":
      return "MALFORMED_TOKEN";
    case "UNSUPPORTED_VERSION":
      return "UNSUPPORTED_TOKEN";
    case "WRONG_SEASON":
      return "DIFFERENT_BUILD";
    case "ILLEGAL_PICK":
      return "ILLEGAL_PICK";
    case "SIM_FAILURE":
      return "SIM_FAILURE";
  }
}
