export interface AccountRunRecordLike {
  readonly record: {
    readonly wins: number | null;
    readonly draws: number | null;
    readonly losses: number | null;
  };
}

export function formatAccountRunRecord(run: AccountRunRecordLike): string {
  const wins = run.record.wins === null ? "—" : run.record.wins.toString();
  const losses = run.record.losses === null ? "—" : run.record.losses.toString();
  const draws = run.record.draws === null ? "—" : run.record.draws.toString();
  return `${wins}-${losses}-${draws}`;
}
