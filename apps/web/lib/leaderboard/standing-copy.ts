export const LEADERBOARD_PERCENTILE_MIN_FIELD_SIZE = 20;

export interface LeaderboardStanding {
  readonly rank: number | null;
  readonly percentile: number | null;
  readonly fieldSize: number;
}

export interface LeaderboardStandingCopyOptions {
  readonly fieldLabel: string;
  readonly percentileLabel: string;
}

interface ValidatedLeaderboardStanding {
  readonly rank: number | null;
  readonly percentile: number | null;
  readonly fieldSize: number;
}

const DEFAULT_OPTIONS: LeaderboardStandingCopyOptions = {
  fieldLabel: "this board",
  percentileLabel: "of this board",
};

function validateLeaderboardStanding(standing: LeaderboardStanding): ValidatedLeaderboardStanding {
  const fieldSize =
    Number.isSafeInteger(standing.fieldSize) && standing.fieldSize > 0 ? standing.fieldSize : 0;
  const positiveRank =
    Number.isSafeInteger(standing.rank) && standing.rank! > 0 ? standing.rank : null;
  const rank =
    positiveRank !== null && (fieldSize === 0 || positiveRank <= fieldSize) ? positiveRank : null;
  const percentile =
    rank !== null &&
    Number.isSafeInteger(standing.percentile) &&
    standing.percentile! >= 1 &&
    standing.percentile! <= 100
      ? standing.percentile
      : null;
  return { rank, percentile, fieldSize };
}

/**
 * Keep sparse-board copy literal. Percentiles become useful only once the
 * field reaches 20; below that boundary we show the exact rank and field size
 * and explain the shared-rank tie rule. A zero field or missing rank is kept
 * honest instead of producing an impossible `#x of 0` claim.
 */
export function leaderboardStandingText(
  standing: LeaderboardStanding,
  options: LeaderboardStandingCopyOptions = DEFAULT_OPTIONS,
): string {
  const { rank, percentile, fieldSize } = validateLeaderboardStanding(standing);

  if (rank === null) {
    return fieldSize > 0 ? `Field size ${fieldSize} · Rank pending` : "Rank pending";
  }
  if (fieldSize === 0) return `#${rank}`;
  const exact = `#${rank} of ${fieldSize} ${options.fieldLabel}`;
  if (fieldSize < LEADERBOARD_PERCENTILE_MIN_FIELD_SIZE) {
    return `${exact} · Ties share a rank`;
  }
  return percentile !== null ? `${exact} · Top ${percentile}% ${options.percentileLabel}` : exact;
}

export function dailyLeaderboardStandingText(standing: LeaderboardStanding): string {
  return leaderboardStandingText(standing, {
    fieldLabel: "today",
    percentileLabel: "of today's field",
  });
}

export function dailyLeaderboardStandingCompactText(standing: LeaderboardStanding): string {
  const { rank, percentile, fieldSize } = validateLeaderboardStanding(standing);
  if (rank === null) return "Rank pending";
  return fieldSize >= LEADERBOARD_PERCENTILE_MIN_FIELD_SIZE && percentile !== null
    ? `Top ${percentile}%`
    : `#${rank}`;
}
