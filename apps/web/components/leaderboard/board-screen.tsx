"use client";

// F-4 U4 — the /leaderboard board screen (stateful container).
//
// Owns fetch/state only; all rendering is delegated to the pure pieces in
// board-views.tsx so tests can string-render every state. Honest-state
// rules: rows/ranks/scores render ONLY server rows from GET /api/leaderboard
// (same-snapshot window ranks); a failed fetch is an error state, never an
// empty board; the "your entry" highlight appears only when /me resolves.

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth-context";
import { utcDateString, isDailyChallengeDate } from "@/lib/game/daily";
import {
  appendBoardPage,
  boardRowViews,
  EMPTY_BOARD,
  type BoardAccumulator,
  type BoardFilter,
} from "@/lib/leaderboard/board-view";
import {
  fetchBoardPage,
  fetchLeaderboardLineup,
  fetchMyPresence,
  type MyBoardPresence,
} from "@/lib/leaderboard/client";
import {
  DEFAULT_BOARD_FILTER,
  DEFAULT_DAILY_BOARD_FILTER,
  ADVANCED_BOARD_CONFIG_OPTIONS,
  isBoardDraftMode,
  isBoardDraftOrder,
  isBoardEra,
  isBoardLane,
  isBoardRatingBasis,
} from "@/lib/leaderboard/config";

import {
  BoardError,
  BoardHead,
  BoardRows,
  BoardToolbar,
  EmptyBoard,
  MeChip,
  type BoardLineupPanelState,
} from "./board-views";
import s from "./leaderboard.module.css";

type LoadPhase = "loading" | "ready" | "error" | "timeout";
type AdvancedLaneSummary =
  | { readonly kind: "ready"; readonly count: number }
  | { readonly kind: "error" };

const ADVANCED_SUMMARY_LIMIT = 1;
const NO_ARCHIVED_SEASONS: readonly string[] = Object.freeze([]);
const NO_ADVANCED_SUMMARIES: Readonly<Record<string, AdvancedLaneSummary>> = Object.freeze({});

export function BoardScreen({
  currentSeasonKey,
  archivedSeasonKeys = NO_ARCHIVED_SEASONS,
}: {
  currentSeasonKey: string;
  archivedSeasonKeys?: readonly string[];
}) {
  const auth = useAuth();
  const [filter, setFilter] = useState<BoardFilter>({
    ...DEFAULT_DAILY_BOARD_FILTER,
    challengeDate: utcDateString(),
  });
  const [boardSeasonKey, setBoardSeasonKey] = useState(currentSeasonKey);
  const [acc, setAcc] = useState<BoardAccumulator>(EMPTY_BOARD);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [me, setMe] = useState<MyBoardPresence | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [lineups, setLineups] = useState<Record<string, BoardLineupPanelState>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedPhase, setAdvancedPhase] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [advancedSummaries, setAdvancedSummaries] =
    useState<Readonly<Record<string, AdvancedLaneSummary>>>(NO_ADVANCED_SUMMARIES);
  const reqSeq = useRef(0);
  const lineupSeq = useRef(0);
  const advancedReqSeq = useRef(0);
  const lineupsRef = useRef(lineups);

  useEffect(() => {
    lineupsRef.current = lineups;
  }, [lineups]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setFilter(filterFromSearch(params));
    const requestedSeason = params.get("season");
    setBoardSeasonKey(
      requestedSeason !== null && archivedSeasonKeys.includes(requestedSeason)
        ? requestedSeason
        : currentSeasonKey,
    );
  }, [archivedSeasonKeys, currentSeasonKey]);

  const seasonClosed = boardSeasonKey !== currentSeasonKey;

  const loadFirstPage = useCallback(
    (nextFilter: BoardFilter) => {
      const seq = ++reqSeq.current;
      lineupSeq.current += 1;
      setPhase("loading");
      setAcc(EMPTY_BOARD);
      setOpenKey(null);
      setLineups({});
      void fetchBoardPage({ filter: nextFilter, cursor: null, seasonKey: boardSeasonKey }).then(
        (r) => {
          if (seq !== reqSeq.current) return;
          if (!r.ok) {
            setPhase(r.reason === "timeout" ? "timeout" : "error");
            return;
          }
          setNowMs(Date.now());
          setAcc(appendBoardPage(EMPTY_BOARD, r.page));
          setPhase("ready");
        },
      );
    },
    [boardSeasonKey],
  );

  useEffect(() => {
    loadFirstPage(filter);
  }, [filter, loadFirstPage]);

  useEffect(() => {
    const seq = ++advancedReqSeq.current;
    let cancelled = false;
    if (!advancedOpen) {
      setAdvancedPhase("idle");
      setAdvancedSummaries(NO_ADVANCED_SUMMARIES);
      return;
    }
    setAdvancedPhase("loading");
    setAdvancedSummaries(NO_ADVANCED_SUMMARIES);
    void Promise.all(
      ADVANCED_BOARD_CONFIG_OPTIONS.map(async (option) => {
        const result = await fetchBoardPage({
          filter: option.filter,
          cursor: null,
          limit: ADVANCED_SUMMARY_LIMIT,
          seasonKey: boardSeasonKey,
        });
        if (!result.ok) return [option.key, { kind: "error" } as const] as const;
        const count = result.page.entries[0]?.field_size ?? 0;
        return [option.key, { kind: "ready", count } as const] as const;
      }),
    ).then((items) => {
      if (cancelled || seq !== advancedReqSeq.current) return;
      const next = Object.fromEntries(items);
      setAdvancedSummaries(next);
      setAdvancedPhase(items.some(([, summary]) => summary.kind === "error") ? "error" : "ready");
    });
    return () => {
      cancelled = true;
    };
  }, [advancedOpen, boardSeasonKey]);

  // Your-entry highlight — anonymous session or account; absent when
  // unresolvable (no session / dark / transport failure).
  useEffect(() => {
    let cancelled = false;
    setMe(null);
    if (seasonClosed || !auth.ready || auth.session === null) {
      return () => {
        cancelled = true;
      };
    }
    void fetchMyPresence({ filter, seasonKey: boardSeasonKey }).then((presence) => {
      if (!cancelled) setMe(presence);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.ready, auth.session, boardSeasonKey, filter, seasonClosed]);

  const loadMore = useCallback(() => {
    if (acc.nextCursor === null || loadingMore) return;
    const seq = reqSeq.current;
    setLoadingMore(true);
    void fetchBoardPage({ filter, cursor: acc.nextCursor, seasonKey: boardSeasonKey }).then((r) => {
      setLoadingMore(false);
      if (seq !== reqSeq.current) return;
      // A failed load-more keeps the loaded rows and the button; honest no-op.
      if (!r.ok) return;
      setAcc((prev) => appendBoardPage(prev, r.page));
    });
  }, [acc.nextCursor, boardSeasonKey, filter, loadingMore]);

  useEffect(() => {
    if (openKey === null) return;
    const key = openKey;
    if (lineupsRef.current[key]) return;
    const seq = lineupSeq.current;
    setLineups((prev) => {
      if (prev[key]) return prev;
      return { ...prev, [key]: { phase: "loading" } };
    });
    void fetchLeaderboardLineup(key).then((result) => {
      if (seq !== lineupSeq.current) return;
      setLineups((prev) => ({
        ...prev,
        [key]: result.ok
          ? { phase: "ready", lineup: result.lineup }
          : { phase: "error", message: result.message },
      }));
    });
  }, [openKey]);

  const rows = boardRowViews(acc.entries, {
    nowMs: nowMs ?? 0,
    myEntryId: me?.bestEntryId ?? null,
  });

  return (
    <div className={s.boardShell}>
      <BoardHead
        currentSeasonKey={currentSeasonKey}
        boardSeasonKey={boardSeasonKey}
        archivedSeasonKeys={archivedSeasonKeys}
        filter={filter}
        onSeasonChange={setBoardSeasonKey}
      />
      <BoardToolbar
        filter={filter}
        seasonClosed={seasonClosed}
        onFilter={setFilter}
        advancedOpen={advancedOpen}
        advancedPhase={advancedPhase}
        advancedSummaries={advancedSummaries}
        onAdvancedOpenChange={setAdvancedOpen}
      />
      {me !== null && <MeChip me={me} />}

      <section className={s.panel} aria-label="Leaderboard standings">
        {phase === "loading" && (
          <div className={s.stateBox} role="status">
            <p>Loading the board…</p>
          </div>
        )}
        {(phase === "error" || phase === "timeout") && (
          <BoardError timedOut={phase === "timeout"} onRetry={() => loadFirstPage(filter)} />
        )}
        {phase === "ready" && rows.length === 0 && (
          <EmptyBoard filter={filter} seasonClosed={seasonClosed} />
        )}
        {phase === "ready" && rows.length > 0 && (
          <BoardRows
            rows={rows}
            filter={filter}
            openKey={openKey}
            lineups={lineups}
            onToggle={(key) => setOpenKey((k) => (k === key ? null : key))}
          />
        )}
        {phase === "ready" && acc.nextCursor !== null && (
          <button
            type="button"
            className={`btn btn--ghost ${s.loadMore}`}
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </section>

      <p className={s.boardFoot}>
        Every score is verified by a server replay of the run before it lands here.
      </p>
    </div>
  );
}

function filterFromSearch(params: URLSearchParams): BoardFilter {
  const lane = params.get("mode");
  const draftMode = params.get("draft_mode");
  const draftOrder = params.get("draft_order");
  const era = params.get("era");
  const ratingBasis = params.get("rating_basis");
  const challenge = params.get("challenge");
  const requestedDate = params.get("date");
  const challengeDate = isDailyChallengeDate(requestedDate) ? requestedDate : utcDateString();
  if (challenge !== "season") {
    return { ...DEFAULT_DAILY_BOARD_FILTER, challengeDate };
  }
  return {
    challenge: "season",
    challengeDate: null,
    lane: isBoardLane(lane) ? lane : DEFAULT_BOARD_FILTER.lane,
    draftMode: isBoardDraftMode(draftMode) ? draftMode : DEFAULT_BOARD_FILTER.draftMode,
    draftOrder: isBoardDraftOrder(draftOrder) ? draftOrder : DEFAULT_BOARD_FILTER.draftOrder,
    era: isBoardEra(era) ? era : DEFAULT_BOARD_FILTER.era,
    ratingBasis: isBoardRatingBasis(ratingBasis) ? ratingBasis : DEFAULT_BOARD_FILTER.ratingBasis,
  };
}
