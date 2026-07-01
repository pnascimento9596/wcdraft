// Result-spotlight + inbound-reply fact extraction.
//
// Given a share token, produce the REAL run facts (record, champion, perfect
// 8-0, goals, top scorer, top-rated picks) by decoding → checking version
// agreement → replaying → simulating against the committed bundle. Honest-
// state is total: a malformed/foreign token, a newer-build token, a version-
// skewed token, or a replay failure NEVER yields a fabricated stat — it
// returns a typed reason the caller turns into the on-brand "made on an older
// build" angle (or simply skips the post). No invented results, ever.

import type { EraPresetId } from "@wcdraft/core";

import { loadMarketingGameData, simulateDraft, type MarketingGameData } from "./game-data.ts";
import {
  decodeRunToken,
  isNewerRunTokenVersion,
  reconstructDraftFromToken,
  tokenDraftConfig,
  versionsAgree,
} from "./token.ts";

export const ERA_LABELS: Record<EraPresetId, string> = {
  all_time: "All-time",
  post_2000: "Post-2000",
  post_2010: "Post-2010",
  modern: "Modern",
};

export interface RunStar {
  name: string;
  nation_code: string | null;
  overall: number | null;
}

export interface RunSummary {
  team_name: string;
  mode: "classic" | "hidden";
  era_label: string;
  formation_name: string;
  record: string;
  wins: number;
  draws: number;
  losses: number;
  is_champion: boolean;
  is_perfect_eight_zero: boolean;
  goals_for: number;
  goals_against: number;
  reached_round: string;
  top_scorer_name: string | null;
  stars: RunStar[];
}

export type RunFromTokenResult =
  | { ok: true; summary: RunSummary }
  | {
      ok: false;
      reason: "malformed" | "newer_version" | "version_skew" | "replay_failed";
      message: string;
    };

function shortName(gd: MarketingGameData, cardId: string): string | null {
  const c = gd.playerByCardId.get(cardId);
  if (!c) return null;
  const cn = c.common_name.trim();
  return cn.length > 0 ? cn : c.full_name;
}

function nationCodeForCard(gd: MarketingGameData, cardId: string): string | null {
  const c = gd.playerByCardId.get(cardId);
  if (!c) return null;
  return gd.nationById.get(c.nation_id)?.code ?? null;
}

/** Decode + replay + simulate a share token into real run facts, or an honest reason. */
export function runFromToken(
  token: string,
  gd: MarketingGameData = loadMarketingGameData(),
): RunFromTokenResult {
  if (isNewerRunTokenVersion(token)) {
    return {
      ok: false,
      reason: "newer_version",
      message: "token is from a newer build than this composer understands",
    };
  }
  const decoded = decodeRunToken(token);
  if (!decoded) {
    return { ok: false, reason: "malformed", message: "token is malformed, foreign, or tampered" };
  }
  if (decoded.md === "open") {
    return {
      ok: false,
      reason: "replay_failed",
      message: "Open Draft t4 tokens are not supported by the marketing composer",
    };
  }
  if (!versionsAgree(decoded, gd.versions)) {
    return {
      ok: false,
      reason: "version_skew",
      message:
        "token was made on a different wcdraft build — its result is not reproducible against the current dataset",
    };
  }
  let draft;
  let run;
  try {
    draft = reconstructDraftFromToken(decoded, gd);
    run = simulateDraft(gd, draft, decoded.ps);
  } catch (err) {
    return {
      ok: false,
      reason: "replay_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const config = tokenDraftConfig(decoded);

  // Top-rated starters (mirrors the share screen's "stars" ranking).
  const starters = draft.squad.filter((s) => s.is_starter && s.card_id !== null);
  const ranked = starters
    .map((s) => {
      const r = gd.ratingByCardId.get(s.card_id as string);
      return { cardId: s.card_id as string, overall: r?.overall ?? null };
    })
    .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1))
    .slice(0, 3);
  const stars: RunStar[] = ranked.map((x) => ({
    name: shortName(gd, x.cardId) ?? "Unknown",
    nation_code: nationCodeForCard(gd, x.cardId),
    overall: x.overall,
  }));

  // Top scorer — match the run's top_scorer_player_id to a squad card.
  let top_scorer_name: string | null = null;
  const tsPid = run.aggregate.top_scorer_player_id;
  if (tsPid) {
    const slot = draft.squad.find((s) => s.player_id === tsPid && s.card_id !== null);
    if (slot) top_scorer_name = shortName(gd, slot.card_id as string);
  }

  const formationName = decoded.fid; // FormationTemplate.name === formation_id in this build.

  const summary: RunSummary = {
    team_name: decoded.tn.trim().length > 0 ? decoded.tn.trim() : "Your XI",
    mode: decoded.md,
    era_label: ERA_LABELS[config.era_preset],
    formation_name: formationName,
    record: run.record,
    wins: run.wins,
    draws: run.draws,
    losses: run.losses,
    is_champion: run.is_champion,
    is_perfect_eight_zero: run.wins === 8 && run.draws === 0 && run.losses === 0,
    goals_for: run.aggregate.goals_for,
    goals_against: run.aggregate.goals_against,
    reached_round: run.reached_round,
    top_scorer_name,
    stars,
  };
  return { ok: true, summary };
}
