"use client";

// F-4 U4 — the /leaderboard board screen (stateful container).
//
// Owns fetch/state only; all rendering is delegated to the pure pieces in
// board-views.tsx so tests can string-render every state. Honest-state
// rules: rows/ranks/scores render ONLY server rows from GET /api/leaderboard
// (same-snapshot window ranks); a failed fetch is an error state, never an
// empty board; the "your entry" highlight appears only when /me resolves.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendBoardPage,
  boardRowViews,
  EMPTY_BOARD,
  type BoardAccumulator,
  type BoardDraftModeFilter,
} from "@/lib/leaderboard/board-view";
import {
  fetchBoardPage,
  fetchMyPresence,
  type MyBoardPresence,
} from "@/lib/leaderboard/client";

import {
  BoardError,
  BoardHead,
  BoardRows,
  BoardToolbar,
  EmptyBoard,
  MeChip,
} from "./board-views";
import s from "./leaderboard.module.css";

type LoadPhase = "loading" | "ready" | "error";

export function BoardScreen({ currentSeasonKey }: { currentSeasonKey: string }) {
  const [filter, setFilter] = useState<BoardDraftModeFilter>("all");
  const [acc, setAcc] = useState<BoardAccumulator>(EMPTY_BOARD);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [me, setMe] = useState<MyBoardPresence | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const reqSeq = useRef(0);

  const loadFirstPage = useCallback((draftMode: BoardDraftModeFilter) => {
    const seq = ++reqSeq.current;
    setPhase("loading");
    setAcc(EMPTY_BOARD);
    setOpenKey(null);
    void fetchBoardPage({ draftMode, cursor: null }).then((r) => {
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
    void fetchMyPresence().then(setMe);
  }, []);

  const loadMore = useCallback(() => {
    if (acc.nextCursor === null || loadingMore) return;
    const seq = reqSeq.current;
    setLoadingMore(true);
    void fetchBoardPage({ draftMode: filter, cursor: acc.nextCursor }).then((r) => {
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
        {phase === "ready" && rows.length === 0 && <EmptyBoard />}
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
