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
import {
  appendBoardPage,
  boardRowViews,
  EMPTY_BOARD,
  type BoardAccumulator,
  type BoardFilter,
} from "@/lib/leaderboard/board-view";
import { fetchBoardPage, fetchMyPresence, type MyBoardPresence } from "@/lib/leaderboard/client";
import {
  DEFAULT_BOARD_FILTER,
  isBoardDraftMode,
  isBoardDraftOrder,
  isBoardEra,
  isBoardLane,
  isBoardRatingBasis,
} from "@/lib/leaderboard/config";

import { BoardError, BoardHead, BoardRows, BoardToolbar, EmptyBoard, MeChip } from "./board-views";
import s from "./leaderboard.module.css";

type LoadPhase = "loading" | "ready" | "error";

export function BoardScreen({ currentSeasonKey }: { currentSeasonKey: string }) {
  const auth = useAuth();
  const [filter, setFilter] = useState<BoardFilter>(DEFAULT_BOARD_FILTER);
  const [acc, setAcc] = useState<BoardAccumulator>(EMPTY_BOARD);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [me, setMe] = useState<MyBoardPresence | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setFilter(filterFromSearch(new URLSearchParams(window.location.search)));
  }, []);

  const loadFirstPage = useCallback((nextFilter: BoardFilter) => {
    const seq = ++reqSeq.current;
    setPhase("loading");
    setAcc(EMPTY_BOARD);
    setOpenKey(null);
    void fetchBoardPage({ filter: nextFilter, cursor: null }).then((r) => {
      if (seq !== reqSeq.current) return;
      if (!r.ok) {
        setPhase("error");
        return;
      }
      setNowMs(Date.now());
      setAcc(appendBoardPage(EMPTY_BOARD, r.page));
      setPhase("ready");
    });
  }, []);

  useEffect(() => {
    loadFirstPage(filter);
  }, [filter, loadFirstPage]);

  // Your-entry highlight — anonymous session or account; absent when
  // unresolvable (no session / dark / transport failure).
  useEffect(() => {
    let cancelled = false;
    setMe(null);
    if (!auth.ready || auth.session === null) {
      return () => {
        cancelled = true;
      };
    }
    void fetchMyPresence({ filter }).then((presence) => {
      if (!cancelled) setMe(presence);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.ready, auth.session, filter]);

  const loadMore = useCallback(() => {
    if (acc.nextCursor === null || loadingMore) return;
    const seq = reqSeq.current;
    setLoadingMore(true);
    void fetchBoardPage({ filter, cursor: acc.nextCursor }).then((r) => {
      setLoadingMore(false);
      if (seq !== reqSeq.current) return;
      // A failed load-more keeps the loaded rows and the button; honest no-op.
      if (!r.ok) return;
      setAcc((prev) => appendBoardPage(prev, r.page));
    });
  }, [acc.nextCursor, filter, loadingMore]);

  const rows = boardRowViews(acc.entries, {
    nowMs: nowMs ?? 0,
    myEntryId: me?.bestEntryId ?? null,
  });

  return (
    <div className={s.boardShell}>
      <BoardHead currentSeasonKey={currentSeasonKey} />
      <BoardToolbar filter={filter} onFilter={setFilter} />
      {me !== null && <MeChip me={me} />}

      <section className={s.panel} aria-label="Leaderboard standings">
        {phase === "loading" && (
          <div className={s.stateBox} role="status">
            <p>Loading the board…</p>
          </div>
        )}
        {phase === "error" && <BoardError onRetry={() => loadFirstPage(filter)} />}
        {phase === "ready" && rows.length === 0 && <EmptyBoard filter={filter} />}
        {phase === "ready" && rows.length > 0 && (
          <BoardRows
            rows={rows}
            openKey={openKey}
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
  return {
    lane: isBoardLane(lane) ? lane : DEFAULT_BOARD_FILTER.lane,
    draftMode: isBoardDraftMode(draftMode) ? draftMode : DEFAULT_BOARD_FILTER.draftMode,
    draftOrder: isBoardDraftOrder(draftOrder) ? draftOrder : DEFAULT_BOARD_FILTER.draftOrder,
    era: isBoardEra(era) ? era : DEFAULT_BOARD_FILTER.era,
    ratingBasis: isBoardRatingBasis(ratingBasis) ? ratingBasis : DEFAULT_BOARD_FILTER.ratingBasis,
  };
}
