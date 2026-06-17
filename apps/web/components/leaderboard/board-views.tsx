// F-4 U4 — pure board view pieces (no "use client" directive: these are
// plain components consumed by the client container and string-rendered by
// tests; they hold no state and do no I/O).
//
// Honest-state: everything rendered comes verbatim from server rows; the
// empty board says so in words, never placeholder rows; draft_mode badges
// label the declared mode (honor-system — no policing language).

import type { BoardFilter, BoardRowView } from "@/lib/leaderboard/board-view";
import { seasonLabel } from "@/lib/leaderboard/board-view";
import type { MyBoardPresence } from "@/lib/leaderboard/client";
import {
  BOARD_DRAFT_MODES,
  BOARD_DRAFT_ORDERS,
  BOARD_ERAS,
  BOARD_LANES,
  BOARD_RATING_BASES,
  configLabel,
  type BoardDraftOrder,
  type BoardEra,
  type BoardLane,
  type BoardRatingBasis,
} from "@/lib/leaderboard/config";

import s from "./leaderboard.module.css";

export function BoardHead({ currentSeasonKey }: { currentSeasonKey: string }) {
  return (
    <header className="page-head">
      <span className="eyebrow">Season {seasonLabel(currentSeasonKey)}</span>
      <h1 className="display">Leaderboard</h1>
      <p className="lede">
        Each board is split by lane and draft config. Finish a run and post it from your results
        screen.
      </p>
      <code className={s.seasonKey}>{currentSeasonKey}</code>
    </header>
  );
}

export function BoardToolbar({
  filter,
  onFilter,
}: {
  filter: BoardFilter;
  onFilter: (f: BoardFilter) => void;
}) {
  const update = (patch: Partial<BoardFilter>) => onFilter({ ...filter, ...patch });
  return (
    <div className={s.toolbar}>
      <div className={s.laneTabs} role="tablist" aria-label="Leaderboard lane">
        {BOARD_LANES.map((lane) => (
          <button
            key={lane.key}
            type="button"
            role="tab"
            aria-selected={filter.lane === lane.key}
            className={filter.lane === lane.key ? `${s.laneTab} ${s.laneTabActive}` : s.laneTab}
            onClick={() => update({ lane: lane.key })}
          >
            {lane.label}
          </button>
        ))}
      </div>

      <div className={s.filterGrid} aria-label="Board filters">
        <div className={s.filterMode} role="group" aria-label="Mode">
          {BOARD_DRAFT_MODES.map((mode) => (
            <button
              key={mode.key}
              type="button"
              aria-pressed={filter.draftMode === mode.key}
              onClick={() => update({ draftMode: mode.key })}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <SelectFilter<BoardDraftOrder>
          label="Order"
          value={filter.draftOrder}
          options={BOARD_DRAFT_ORDERS}
          onChange={(draftOrder) => update({ draftOrder })}
        />
        <SelectFilter<BoardEra>
          label="Era"
          value={filter.era}
          options={BOARD_ERAS}
          onChange={(era) => update({ era })}
        />
        <SelectFilter<BoardRatingBasis>
          label="Basis"
          value={filter.ratingBasis}
          options={BOARD_RATING_BASES}
          onChange={(ratingBasis) => update({ ratingBasis })}
        />
      </div>

      <p className={s.activeConfig}>
        <strong>{filter.lane === "ranked" ? "Ranked" : "Casual"}</strong>
        <span>{configLabel(filter)}</span>
        {filter.lane === "ranked" && <em>Sign-in required to post</em>}
      </p>
    </div>
  );
}

function SelectFilter<T extends BoardLane | BoardDraftOrder | BoardEra | BoardRatingBasis>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { key: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className={s.selectFilter}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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
                    className={r.draftMode === "hidden" ? `${s.badge} ${s.badgeHidden}` : s.badge}
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

export function EmptyBoard({ filter }: { filter: BoardFilter }) {
  return (
    <div className={s.stateBox}>
      <p className={s.stateTitle}>No runs yet for this config</p>
      <p>
        {filter.lane === "ranked"
          ? "Signed-in ranked runs will appear here after server verification."
          : "Casual runs will appear here after server verification."}
      </p>
    </div>
  );
}

export function BoardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={s.stateBox} role="alert">
      <p className={s.stateTitle}>Couldn&rsquo;t load the board</p>
      <p>
        The standings didn&rsquo;t come back from the server. Nothing is shown rather than something
        made up.
      </p>
      <button type="button" className="btn btn--ghost" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
