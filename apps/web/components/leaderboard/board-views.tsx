// F-4 U4 — pure board view pieces (no "use client" directive: these are
// plain components consumed by the client container and string-rendered by
// tests; they hold no state and do no I/O).
//
// Honest-state: everything rendered comes verbatim from server rows; the
// empty board says so in words, never placeholder rows; draft_mode badges
// label the declared mode (honor-system — no policing language).

import type { BoardFilter, BoardRowView } from "@/lib/leaderboard/board-view";
import { seasonDisplay } from "@/lib/leaderboard/board-view";
import { ManagerSlot } from "@/components/game/manager-slot";
import { MiniNationFlag } from "@/components/game/mini-nation-flag";
import { Pitch } from "@/components/game/pitch";
import { dailyDraftHref } from "@/lib/game/navigation";
import { formatNullableNumber } from "@/lib/game/view-models";
import type { MyBoardPresence } from "@/lib/leaderboard/client";
import type { LeaderboardLineupView } from "@/lib/leaderboard/lineup-view";
import {
  dailyLeaderboardStandingCompactText,
  dailyLeaderboardStandingText,
  leaderboardStandingText,
} from "@/lib/leaderboard/standing-copy";
import Link from "next/link";
import {
  ADVANCED_BOARD_CONFIG_OPTIONS,
  BOARD_LANE_OPEN_ENTRY_THRESHOLD,
  CANONICAL_SEASON_BOARD_FILTER,
  boardConfigKey,
  configLabel,
  draftModeLaneLabel,
  isCanonicalSeasonBoardFilter,
} from "@/lib/leaderboard/config";

import s from "./leaderboard.module.css";
import gameS from "@/components/game/game.module.css";

export type BoardLineupPanelState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly lineup: LeaderboardLineupView }
  | { readonly phase: "error"; readonly message: string };

export type AdvancedLaneSummary =
  | { readonly kind: "ready"; readonly count: number }
  | { readonly kind: "error" };

export function LeaderboardClosed() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Standings</span>
        <h1 className="display">Leaderboard is closed</h1>
        <p className="lede">Public boards and result posting are not open right now.</p>
      </header>
      <section className={s.stateBox} aria-labelledby="leaderboard-closed-title">
        <p className={s.stateTitle} id="leaderboard-closed-title">
          Your drafts still work
        </p>
        <p>
          Local runs and signed-in Account history are unaffected. When boards reopen, this page
          will show verified standings and posting rules.
        </p>
        <div className={s.stateActions}>
          <Link href="/play" className="btn btn--primary">
            Draft a team
          </Link>
          <Link href="/play/history" className="btn btn--ghost">
            View run history
          </Link>
        </div>
      </section>
    </>
  );
}

export function BoardHead({
  currentSeasonKey,
  filter,
}: {
  currentSeasonKey: string;
  filter?: BoardFilter;
}) {
  const season = seasonDisplay(currentSeasonKey);
  if (filter?.challenge === "daily") {
    const playHref = dailyDraftHref(null, filter.challengeDate);
    return (
      <header className="page-head">
        <span className="eyebrow">{filter.challengeDate ?? "Today"} Daily Draft</span>
        <h1 className="display">Daily Leaderboard</h1>
        <p className="lede">
          One shared Classic draft for everyone today. Post anonymously; your best verified score
          for the day holds.
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
      <span className="eyebrow">Season · {season.label}</span>
      <h1 className="display">Leaderboard</h1>
      <p className="lede">
        Daily is the default board. Advanced boards keep Classic and Memory runs in separate lanes.
      </p>
      <p className="lede">
        Filter by Lane, Draft order, Era and Rating basis. Ratings can update during a season;
        entries are stamped at submit time.
      </p>
      <code className={s.seasonKey} title={season.rawKey}>
        {season.evidenceLabel}
      </code>
    </header>
  );
}

export function BoardToolbar({
  filter,
  onFilter,
  advancedOpen = false,
  advancedPhase = "idle",
  advancedSummaries = {},
  onAdvancedOpenChange,
}: {
  filter: BoardFilter;
  onFilter: (f: BoardFilter) => void;
  advancedOpen?: boolean;
  advancedPhase?: "idle" | "loading" | "ready" | "error";
  advancedSummaries?: Readonly<Record<string, AdvancedLaneSummary>>;
  onAdvancedOpenChange?: (open: boolean) => void;
}) {
  const update = (patch: Partial<BoardFilter>) => onFilter({ ...filter, ...patch });
  const dailyDate = filter.challengeDate ?? new Date().toISOString().slice(0, 10);
  const seasonActive = filter.challenge === "season" && isCanonicalSeasonBoardFilter(filter);
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
          aria-selected={seasonActive}
          className={seasonActive ? `${s.laneTab} ${s.laneTabActive}` : s.laneTab}
          onClick={() => onFilter({ ...CANONICAL_SEASON_BOARD_FILTER, challengeDate: null })}
        >
          Season
        </button>
      </div>
      {filter.challenge === "daily" ? (
        <p className={s.activeConfig}>
          <strong>Daily Draft</strong>
          <span>{filter.challengeDate ?? "Today"} · Classic / Squad First / Career / All-time</span>
        </p>
      ) : (
        <p className={s.activeConfig}>
          <strong>{filter.lane === "ranked" ? "Ranked Season" : "Casual Season"}</strong>
          <span>{configLabel(filter)}</span>
          {filter.lane === "ranked" && <em>Sign-in required to post ranked runs</em>}
        </p>
      )}
      <details
        className={s.advancedDisclosure}
        open={advancedOpen}
        onToggle={(event) => onAdvancedOpenChange?.(event.currentTarget.open)}
      >
        <summary className={s.advancedSummary}>Advanced</summary>
        <div className={s.advancedGrid} aria-label="Advanced season board lanes">
          {advancedPhase === "loading" || advancedPhase === "idle" ? (
            <p className={s.advancedState}>Checking which lanes are open…</p>
          ) : null}
          {advancedPhase === "error" ? (
            <p className={s.advancedState}>
              Some lane counts did not load. Unknown lanes stay closed until refreshed.
            </p>
          ) : null}
          {ADVANCED_BOARD_CONFIG_OPTIONS.map((option) => {
            const summary = advancedSummaries[option.key];
            const selected = filter.challenge === "season" && boardConfigKey(filter) === option.key;
            const count = summary?.kind === "ready" ? summary.count : 0;
            const open = count >= BOARD_LANE_OPEN_ENTRY_THRESHOLD;
            const unavailable = summary === undefined || summary.kind === "error" || !open;
            return (
              <button
                key={option.key}
                type="button"
                className={
                  selected
                    ? `${s.advancedLane} ${s.advancedLaneActive}`
                    : unavailable
                      ? `${s.advancedLane} ${s.advancedLaneClosed}`
                      : s.advancedLane
                }
                disabled={unavailable}
                aria-pressed={selected}
                onClick={() => onFilter(option.filter)}
              >
                <span>{option.label}</span>
                <em>
                  {summary?.kind === "ready"
                    ? open
                      ? `${count.toString()} runs`
                      : `opens at ${BOARD_LANE_OPEN_ENTRY_THRESHOLD.toString()} runs`
                    : `opens at ${BOARD_LANE_OPEN_ENTRY_THRESHOLD.toString()} runs`}
                </em>
              </button>
            );
          })}
        </div>
      </details>
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
                  <span>
                    {daily ? dailyLeaderboardStandingText(r) : leaderboardStandingText(r)}
                  </span>
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

      <div className={`${s.lineupSquad} ${gameS.squadStage}`}>
        <Pitch
          formationId={lineup.formation.id}
          starters={[...lineup.starters]}
          linkedPairs={lineup.linked_pairs}
          showInactiveEdges
        />
        <ManagerSlot manager={lineup.manager} />
      </div>

      <div className={`${s.lineupBench} ${gameS.bench}`}>
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
          <span className={s.breakdownPts}>
            {line.points > 0 ? `+${line.points}` : line.points}
          </span>
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
  return dailyLeaderboardStandingCompactText(row);
}

export function BoardError({
  timedOut = false,
  onRetry,
}: {
  timedOut?: boolean;
  onRetry: () => void;
}) {
  return (
    <div className={s.stateBox} role="alert">
      <p className={s.stateTitle}>
        {timedOut ? "The board took too long to load" : "Couldn’t load the board"}
      </p>
      <p>
        {timedOut
          ? "The standings request stopped after 12 seconds. It is safe to retry this read."
          : "The standings didn’t come back from the server. Nothing is shown rather than something made up."}
      </p>
      <div className={s.stateActions}>
        <button type="button" className="btn btn--ghost" onClick={onRetry}>
          {timedOut ? "Retry board" : "Try again"}
        </button>
        <Link href="/play" className="btn btn--ghost">
          Keep drafting
        </Link>
      </div>
    </div>
  );
}
