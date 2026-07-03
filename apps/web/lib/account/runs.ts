import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { leaderboardEntries, savedRuns, users, type Db, type SavedRun } from "@wcdraft/db";

import { resultsHref } from "@/lib/game/navigation";
import type { SavedRunSummary } from "@/lib/game/saved-runs-store";
import { BOARD_DRAFT_ORDERS, BOARD_ERAS, BOARD_RATING_BASES } from "@/lib/leaderboard/config";
import { utcDateString } from "@/lib/game/daily";
import { dailyStreakFromDates } from "@/lib/game/local-progress";
import { draftModeLabel } from "@/lib/game/mode-labels";

export interface AccountIdentity {
  readonly userId: string;
  readonly email: string | null;
  readonly username: string | null;
  readonly hasPassword: boolean;
  readonly emailVerified: boolean;
}

export interface AccountRun {
  readonly id: string;
  readonly createdAt: string;
  readonly resultHref: string;
  readonly token: string;
  readonly postedToLeaderboard: boolean;
  readonly teamName: string;
  readonly score: number | null;
  readonly displayRecord: string;
  readonly record: {
    readonly wins: number | null;
    readonly draws: number | null;
    readonly losses: number | null;
  };
  readonly perfectRun: boolean;
  readonly undefeated: boolean | null;
  readonly formation: string;
  readonly configLabel: string;
  readonly modeLabel: string;
  readonly draftOrderLabel: string;
  readonly eraLabel: string;
  readonly ratingBasisLabel: string;
  readonly keyPicks: ReadonlyArray<{ readonly name: string; readonly nationCode: string }>;
  readonly nationMix: string;
  readonly seed: string;
}

export interface AccountStats {
  readonly totalRuns: number;
  readonly scoredRuns: number;
  readonly bestScore: number | null;
  readonly averageScore: number | null;
  readonly perfectRunCount: number;
  readonly qualifyingRate: number | null;
  readonly undefeatedRate: number | null;
  readonly dailyStreakDays: number;
  readonly todayBest: number | null;
  readonly personalBest: number | null;
}

export interface AccountRunsPage {
  readonly identity: AccountIdentity;
  readonly runs: AccountRun[];
  readonly stats: AccountStats;
  readonly page: {
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
    readonly hasMore: boolean;
  };
}

export interface AccountRunsPageOptions {
  readonly limit?: number;
  readonly offset?: number;
  /** Epoch milliseconds. Matches the auth-lib `now: () => number` convention. */
  readonly now?: () => number;
}

export async function readAccountIdentity(db: Db, userId: string): Promise<AccountIdentity | null> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      username: users.username,
      passwordHash: users.passwordHash,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.userId,
    email: row.email,
    username: row.username,
    hasPassword: row.passwordHash !== null,
    emailVerified: row.emailVerifiedAt !== null,
  };
}

export async function readAccountRunsPage(
  db: Db,
  userId: string,
  opts: AccountRunsPageOptions = {},
): Promise<AccountRunsPage> {
  const identity = await readAccountIdentity(db, userId);
  if (!identity) {
    throw new Error("readAccountRunsPage: user row missing");
  }
  const limit = clampInt(opts.limit ?? 25, 1, 50);
  const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(savedRuns)
    .where(eq(savedRuns.ownerUserId, userId));
  const total = Number(totalRows[0]?.count ?? 0);
  const rows = await db
    .select()
    .from(savedRuns)
    .where(eq(savedRuns.ownerUserId, userId))
    .orderBy(desc(savedRuns.createdAt), desc(savedRuns.id))
    .limit(limit)
    .offset(offset);

  const allRows = await db
    .select()
    .from(savedRuns)
    .where(eq(savedRuns.ownerUserId, userId))
    .orderBy(desc(savedRuns.createdAt), desc(savedRuns.id));
  const postedTokens = await postedLeaderboardTokens(
    db,
    userId,
    rows.map((r) => r.token),
  );

  return {
    identity,
    runs: rows.map((row) => toAccountRun(row, postedTokens.has(row.token))),
    stats: buildStats(allRows, opts.now ? utcDateString(opts.now()) : utcDateString()),
    page: {
      limit,
      offset,
      total,
      hasMore: offset + rows.length < total,
    },
  };
}

async function postedLeaderboardTokens(
  db: Db,
  userId: string,
  tokens: string[],
): Promise<Set<string>> {
  if (tokens.length === 0) return new Set();
  const rows = await db
    .select({ token: leaderboardEntries.token })
    .from(leaderboardEntries)
    .where(
      and(
        eq(leaderboardEntries.userId, userId),
        inArray(leaderboardEntries.token, tokens),
        isNull(leaderboardEntries.hiddenAt),
      ),
    );
  return new Set(rows.map((row) => row.token));
}

function toAccountRun(row: SavedRun, postedToLeaderboard: boolean): AccountRun {
  const summary = isSavedRunSummary(row.summary) ? row.summary : null;
  const draftMode = summary?.draft_mode ?? null;
  const draftOrder = summary?.draft_order ?? null;
  const era = summary?.era_preset ?? null;
  const basis = summary?.rating_basis ?? null;
  const keyPicks = (summary?.key_picks ?? []).map((pick) => ({
    name: pick.name,
    nationCode: pick.nation_code,
  }));
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    resultHref: resultsHref(row.token),
    token: row.token,
    postedToLeaderboard,
    teamName: summary?.team_name ?? "—",
    score: numberOrNull(summary?.score),
    displayRecord: summary?.display_record ?? "—",
    record: {
      wins: numberOrNull(summary?.wins),
      draws: numberOrNull(summary?.draws),
      losses: numberOrNull(summary?.losses),
    },
    perfectRun: summary?.is_perfect_eight_zero === true,
    undefeated:
      typeof summary?.undefeated_regulation === "boolean" ? summary.undefeated_regulation : null,
    formation: summary?.formation_name ?? "—",
    configLabel: [
      accountDraftModeLabel(draftMode),
      labelFor(BOARD_DRAFT_ORDERS, draftOrder),
      labelFor(BOARD_RATING_BASES, basis),
      labelFor(BOARD_ERAS, era),
    ].join(" / "),
    modeLabel: accountDraftModeLabel(draftMode),
    draftOrderLabel: labelFor(BOARD_DRAFT_ORDERS, draftOrder),
    eraLabel: labelFor(BOARD_ERAS, era),
    ratingBasisLabel: labelFor(BOARD_RATING_BASES, basis),
    keyPicks,
    nationMix: nationMix(keyPicks),
    seed: summary?.seed ?? row.parentSeed ?? "—",
  };
}

function buildStats(rows: SavedRun[], today: string): AccountStats {
  const summaries = rows
    .map((row) => (isSavedRunSummary(row.summary) ? row.summary : null))
    .filter((summary): summary is SavedRunSummary => summary !== null);
  const scored = summaries
    .map((summary) => numberOrNull(summary.score))
    .filter((score): score is number => score !== null);
  const bestScore = scored.length > 0 ? Math.max(...scored) : null;
  const averageScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length)
      : null;
  const rateDenominator = summaries.length;
  const qualifying = summaries.filter(
    (summary) => summary.reached_round !== undefined && summary.reached_round !== "GS",
  ).length;
  const undefeated = summaries.filter((summary) => summary.undefeated_regulation === true).length;
  const dailyDates = new Set(
    summaries
      .map((summary) => summary.challenge_date)
      .filter((date): date is string => typeof date === "string"),
  );
  const todayScores = summaries
    .filter((summary) => summary.challenge_date === today)
    .map((summary) => numberOrNull(summary.score))
    .filter((score): score is number => score !== null);
  return {
    totalRuns: rows.length,
    scoredRuns: scored.length,
    bestScore,
    averageScore,
    perfectRunCount: summaries.filter((summary) => summary.is_perfect_eight_zero === true).length,
    qualifyingRate: rateDenominator > 0 ? qualifying / rateDenominator : null,
    undefeatedRate: rateDenominator > 0 ? undefeated / rateDenominator : null,
    dailyStreakDays: dailyStreakFromDates(dailyDates, today),
    todayBest: todayScores.length > 0 ? Math.max(...todayScores) : null,
    personalBest: bestScore,
  };
}

function isSavedRunSummary(value: unknown): value is SavedRunSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.team_name === "string" &&
    typeof row.display_record === "string" &&
    typeof row.formation_name === "string" &&
    Array.isArray(row.key_picks) &&
    typeof row.is_champion === "boolean" &&
    typeof row.seed === "string"
  );
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function labelFor<T extends string>(
  items: readonly { readonly key: T; readonly label: string }[],
  key: T | null,
): string {
  if (key === null) return "—";
  return items.find((item) => item.key === key)?.label ?? key;
}

function accountDraftModeLabel(mode: SavedRunSummary["draft_mode"] | null): string {
  return mode === null || mode === undefined ? "—" : draftModeLabel(mode);
}

function nationMix(picks: ReadonlyArray<{ readonly nationCode: string }>): string {
  const codes = Array.from(new Set(picks.map((pick) => pick.nationCode).filter(Boolean)));
  return codes.length > 0 ? codes.slice(0, 4).join(" / ") : "—";
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
