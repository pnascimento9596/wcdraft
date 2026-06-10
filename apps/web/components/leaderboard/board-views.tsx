// F-4 U4 — pure board view pieces (no "use client" directive: these are
// plain components consumed by the client container and string-rendered by
// tests; they hold no state and do no I/O).
//
// Honest-state: everything rendered comes verbatim from server rows; the
// empty board says so in words, never placeholder rows; draft_mode badges
// label the declared mode (honor-system — no policing language).

import type { BoardDraftModeFilter, BoardRowView } from "@/lib/leaderboard/board-view";
import { seasonLabel } from "@/lib/leaderboard/board-view";
import type { MyBoardPresence } from "@/lib/leaderboard/client";

import s from "./leaderboard.module.css";

export const BOARD_FILTERS: readonly { key: BoardDraftModeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "classic", label: "Classic" },
  { key: "hidden", label: "Memory" },
];

export function BoardHead({ currentSeasonKey }: { currentSeasonKey: string }) {
  return (
    <header className="page-head">
      <span className="eyebrow">Season {seasonLabel(currentSeasonKey)}</span>
      <h1 className="display">Leaderboard</h1>
      <p className="lede">
        Best verified run per manager this season. Finish a run and post it from your
        results screen.
      </p>
      <code className={s.seasonKey}>{currentSeasonKey}</code>
    </header>
  );
}

export function BoardToolbar({
  filter,
  onFilter,
}: {
  filter: BoardDraftModeFilter;
  onFilter: (f: BoardDraftModeFilter) => void;
}) {
  return (
    <div className={s.toolbar}>
      <div className={s.modeTabs} aria-label="Board mode">
        <span className={s.modeTab}>Casual</span>
        <span className={s.modeTabDark}>
          Ranked<span className={s.modeTabSoon}>soon</span>
        </span>
      </div>
      <div className="segmented" role="group" aria-label="Draft mode filter">
        {BOARD_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => onFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MeChip({ me }: { me: MyBoardPresence }) {
  return (
    <p className={s.meChip} data-testid="me-chip">
      <span>Your best this season:</span>
      <strong>{Number.isNaN(me.verifiedScore) ? "—" : me.verifiedScore} pts</strong>
      <span className={s.meChipRank}>{me.rank !== null ? `rank #${me.rank}` : "—"}</span>
    </p>
  );
}

export function BoardRows({
  rows,
  openKey,
  onToggle,
}: {
  rows: readonly BoardRowView[];
  openKey: string | null;
  onToggle: (key: string) => void;
}) {
  return (
    <ol className={s.rowList}>
      {rows.map((r) => {
        const isOpen = openKey === r.key;
        return (
          <li key={r.key} className={s.rowItem}>
            <button
              type="button"
              className={r.isMine ? `${s.row} ${s.rowMine}` : s.row}
              aria-expanded={isOpen}
              onClick={() => onToggle(r.key)}
              data-mine={r.isMine ? "true" : undefined}
            >
              <span className={r.rank <= 3 ? `${s.rowRank} ${s.rowRankTop}` : s.rowRank}>
                {r.rank}
              </span>
              <span className={s.rowMain}>
                <span className={s.rowName}>{r.displayName}</span>
                <span className={s.rowMeta}>
                  {r.isMine && <span className={`${s.badge} ${s.badgeYou}`}>You</span>}
                  <span
                    className={
                      r.draftMode === "hidden" ? `${s.badge} ${s.badgeHidden}` : s.badge
                    }
                  >
                    {r.draftMode === "hidden" ? "Memory" : "Classic"}
                  </span>
                  <span>{r.timeLabel}</span>
                </span>
              </span>
              <span className={s.rowScore}>
                {r.score}
                <span className={s.rowScoreUnit}>pts</span>
              </span>
            </button>
            {isOpen &&
              (r.breakdown !== null ? (
                <div className={s.breakdown}>
                  {r.breakdown.map((line, i) => (
                    <span key={i} className={s.breakdownLine}>
                      <span>{line.label}</span>
                      <span className={s.breakdownPts}>
                        {line.points > 0 ? `+${line.points}` : line.points}
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className={s.breakdownNone}>No breakdown recorded for this entry.</p>
              ))}
          </li>
        );
      })}
    </ol>
  );
}

export function EmptyBoard() {
  return (
    <div className={s.stateBox}>
      <p className={s.stateTitle}>No verified entries yet</p>
      <p>Finish a run and be the first manager on the board this season.</p>
    </div>
  );
}

export function BoardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={s.stateBox} role="alert">
      <p className={s.stateTitle}>Couldn&rsquo;t load the board</p>
      <p>
        The standings didn&rsquo;t come back from the server. Nothing is shown rather than
        something made up.
      </p>
      <button type="button" className="btn btn--ghost" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
