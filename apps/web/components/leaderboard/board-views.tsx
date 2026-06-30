// F-4 U4 — pure board view pieces (no "use client" directive: these are
// plain components consumed by the client container and string-rendered by
// tests; they hold no state and do no I/O).
//
// Honest-state: everything rendered comes verbatim from server rows; the
// empty board says so in words, never placeholder rows; draft_mode badges
// label the declared mode (honor-system — no policing language).

import type { BoardFilter, BoardRowView } from "@/lib/leaderboard/board-view";
import { seasonLabel } from "@/lib/leaderboard/board-view";
import { ManagerSlot } from "@/components/game/manager-slot";
import { MiniNationFlag } from "@/components/game/mini-nation-flag";
import { Pitch } from "@/components/game/pitch";
import { dailyDraftHref } from "@/lib/game/navigation";
import { formatNullableNumber } from "@/lib/game/view-models";
import type { MyBoardPresence } from "@/lib/leaderboard/client";
import type { LeaderboardLineupView } from "@/lib/leaderboard/lineup-view";
import Link from "next/link";
import {
  BOARD_DRAFT_MODES,
  BOARD_DRAFT_ORDERS,
  BOARD_ERAS,
  BOARD_LANES,
  BOARD_RATING_BASES,
  configLabel,
  draftModeLaneLabel,
  type BoardDraftOrder,
  type BoardEra,
  type BoardLane,
  type BoardRatingBasis,
} from "@/lib/leaderboard/config";

import s from "./leaderboard.module.css";
import gameS from "@/components/game/game.module.css";

export type BoardLineupPanelState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly lineup: LeaderboardLineupView }
  | { readonly phase: "error"; readonly message: string };

export function BoardHead({
  currentSeasonKey,
  filter,
}: {
  currentSeasonKey: string;
  filter?: BoardFilter;
}) {
  if (filter?.challenge === "daily") {
    const playHref = dailyDraftHref(null, filter.challengeDate);
    return (
      <header className="page-head">
        <span className="eyebrow">{filter.challengeDate ?? "Today"} Daily Draft</span>
        <h1 className="display">Daily Leaderboard</h1>
        <p className="lede">
          One shared sighted Classic draft for everyone today. Post anonymously; your best verified
          score for the day holds.
        </p>
        <p className="lede">A new shared draft drops every day at 00:00 UTC.</p>
        <p>
          <Link href={playHref} className="btn btn--primary">
            Play today&apos;s draft →
          </Link>
        </p>
      </header>
    );
  }
  return (
    <header className="page-head">
      <span className="eyebrow">Season {seasonLabel(currentSeasonKey)}</span>
      <h1 className="display">Leaderboard</h1>
      <p className="lede">
        Daily is the default board. Advanced boards keep sighted Classic and blind Memory runs in
        separate lanes.
      </p>
      <p className="lede">
        Filter by Lane, Draft order, Era and Rating basis. Ratings can update during a season;
        entries are stamped at submit time.
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
  const dailyDate = filter.challengeDate ?? new Date().toISOString().slice(0, 10);
  return (
    <div className={s.toolbar}>
      <div className={s.laneTabs} role="tablist" aria-label="Leaderboard view">
        <button
          type="button"
          role="tab"
          aria-selected={filter.challenge === "daily"}
          className={filter.challenge === "daily" ? `${s.laneTab} ${s.laneTabActive}` : s.laneTab}
          onClick={() =>
            update({
              challenge: "daily",
              challengeDate: dailyDate,
              lane: "casual",
              draftMode: "classic",
              draftOrder: "squad_first",
              era: "all_time",
              ratingBasis: "career",
            })
          }
        >
          Daily
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter.challenge === "season"}
          className={filter.challenge === "season" ? `${s.laneTab} ${s.laneTabActive}` : s.laneTab}
          onClick={() => update({ challenge: "season", challengeDate: null })}
        >
          Advanced
        </button>
      </div>
      {filter.challenge === "daily" ? (
        <p className={s.activeConfig}>
          <strong>Daily Draft</strong>
          <span>
            {filter.challengeDate ?? "Today"} · Sighted Classic / Squad First / Career / All-time
          </span>
        </p>
      ) : (
        <>
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
            <div className={s.filterMode} role="group" aria-label="Draft visibility lane">
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
            {filter.lane === "ranked" && (
              <em>
                {filter.draftMode === "hidden"
                  ? "Blind ranked lane · sign-in required"
                  : "Sighted ranked lane · sign-in required"}
              </em>
            )}
          </p>
        </>
      )}
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
  filter,
  openKey,
  lineups,
  onToggle,
}: {
  rows: readonly BoardRowView[];
  filter: BoardFilter;
  openKey: string | null;
  lineups: Readonly<Record<string, BoardLineupPanelState>>;
  onToggle: (key: string) => void;
}) {
  return (
    <ol className={s.rowList}>
      {rows.map((r) => {
        const isOpen = openKey === r.key;
        const daily = filter.challenge === "daily";
        return (
          <li key={r.key} className={s.rowItem}>
            <button
              type="button"
              className={r.isMine ? `${s.row} ${s.rowMine}` : s.row}
              aria-expanded={isOpen}
              aria-controls={isOpen ? `lineup-inspector-${r.key}` : undefined}
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
                    {draftModeLaneLabel(r.draftMode)}
                  </span>
                  <span>{r.timeLabel}</span>
                  {daily ? (
                    <span>
                      #{r.rank} of {r.fieldSize} today
                    </span>
                  ) : (
                    r.percentile !== null && <span>top {r.percentile}%</span>
                  )}
                </span>
              </span>
              <span className={daily ? `${s.rowScore} ${s.rowScoreDaily}` : s.rowScore}>
                {daily ? dailyStandingLabel(r) : r.score}
                <span className={s.rowScoreUnit}>{daily ? `${r.score} pts` : "pts"}</span>
              </span>
            </button>
            {isOpen && <LineupInspectorPanel row={r} state={lineups[r.key]} />}
          </li>
        );
      })}
    </ol>
  );
}

function LineupInspectorPanel({
  row,
  state,
}: {
  row: BoardRowView;
  state: BoardLineupPanelState | undefined;
}) {
  return (
    <div
      id={`lineup-inspector-${row.key}`}
      className={s.inspector}
      role="region"
      aria-label={`Lineup inspector for ${row.displayName}`}
    >
      {state === undefined || state.phase === "loading" ? (
        <div className={s.inspectorState} role="status" aria-live="polite">
          <span className={s.inspectorSkeleton} aria-hidden="true" />
          <span>Replaying the verified run…</span>
        </div>
      ) : state.phase === "error" ? (
        <div className={s.inspectorState} role="alert">
          <strong>Lineup unavailable</strong>
          <span>{state.message}</span>
        </div>
      ) : (
        <LineupView lineup={state.lineup} />
      )}
      <ScoreBreakdown lines={row.breakdown} />
    </div>
  );
}

function LineupView({ lineup }: { lineup: LeaderboardLineupView }) {
  return (
    <div className={s.lineupView}>
      <div className={s.lineupSummary}>
        <div className={s.lineupIdentity}>
          <span className={s.inspectorEyebrow}>{lineup.mode_label}</span>
          <h2>{lineup.team_name}</h2>
          <span>{lineup.formation.name}</span>
        </div>
        <div className={s.resultPill} aria-label={`Verified score ${lineup.result.score} points`}>
          <strong>{lineup.result.score}</strong>
          <span>
            {lineup.result.record} · {lineup.result.matches_played} matches
          </span>
        </div>
      </div>

      {lineup.badges.length > 0 ? (
        <div className={s.lineupBadges} aria-label="Run config">
          {lineup.badges.map((badge) => (
            <span key={badge.axis} className={s.badge}>
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className={gameS.squadStage}>
        <Pitch
          formationId={lineup.formation.id}
          starters={[...lineup.starters]}
          linkedPairs={lineup.linked_pairs}
          showInactiveEdges
        />
        <ManagerSlot manager={lineup.manager} />
      </div>

      <div className={gameS.bench}>
        <span className={gameS.benchLabel}>Bench</span>
        <div className={gameS.benchSlots}>
          {lineup.bench.map((b) => (
            <div
              key={b.slot_id}
              className={`${gameS.benchSlot} ${b.card ? gameS.benchFilled : ""} ${
                b.card ? gameS.slotLocked : ""
              }`}
            >
              <span className={gameS.benchSlotTop}>
                <span className={gameS.slotPos}>{b.slot_position}</span>
                {b.card ? (
                  <MiniNationFlag
                    nationId={b.card.nation_id}
                    nationName={b.card.nation_name}
                    nationCode={b.card.nation_code}
                    className={gameS.benchMiniFlag}
                  />
                ) : null}
              </span>
              <span className={gameS.slotName}>{b.card ? b.card.name : "—"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={s.lineupMetrics}>
        <span className={s.squadAverage}>
          <strong>{formatNullableNumber(lineup.squad_average)}</strong>
          <span>XI OVR</span>
        </span>
        {lineup.line_strengths.map((line) => (
          <span key={line.line} className={s.lineMetric}>
            <span>{line.label}</span>
            <strong>{formatNullableNumber(line.value)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function ScoreBreakdown({ lines }: { lines: BoardRowView["breakdown"] }) {
  return lines !== null ? (
    <div className={s.breakdown} aria-label="Verified score breakdown">
      {lines.map((line, i) => (
        <span key={i} className={s.breakdownLine}>
          <span>{line.label}</span>
          <span className={s.breakdownPts}>{line.points > 0 ? `+${line.points}` : line.points}</span>
        </span>
      ))}
    </div>
  ) : (
    <p className={s.breakdownNone}>No breakdown recorded for this entry.</p>
  );
}

export function EmptyBoard({ filter }: { filter: BoardFilter }) {
  const playHref =
    filter.challenge === "daily"
      ? dailyDraftHref(null, filter.challengeDate)
      : dailyDraftHref(null);
  return (
    <div className={s.stateBox}>
      <p className={s.stateTitle}>
        {filter.challenge === "daily" ? "No daily runs yet" : "No runs yet for this board"}
      </p>
      <p>
        {filter.challenge === "daily"
          ? "Be the first to post a verified score for today's shared draft."
          : filter.lane === "ranked"
            ? `${draftModeLaneLabel(filter.draftMode)} ranked runs for this exact config will appear here after server verification.`
            : `${draftModeLaneLabel(filter.draftMode)} casual runs for this exact config will appear here after server verification.`}
      </p>
      {filter.challenge === "daily" ? (
        <Link href={playHref} className="btn btn--primary">
          Play today&apos;s draft →
        </Link>
      ) : (
        <Link href={playHref} className="btn btn--ghost">
          Daily is where today&apos;s field is → Play today&apos;s draft
        </Link>
      )}
    </div>
  );
}

function dailyStandingLabel(row: BoardRowView): string {
  return row.percentile !== null ? `Top ${row.percentile}%` : `#${row.rank}`;
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
