"use client";

// Local history view — lists recent completed runs from `RunRecordV1`
// localStorage via the `RunHistoryProvider` boundary. Tap a card to re-open
// the deterministic results via the token replay path. NEVER
// links via a bare local `run-v1-*` id — that would violate the shared-URL
// contract enforced by `gate-and-fallback.test.ts`.

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { loadGameData, type GameData } from "@/lib/game/data";
import { describeGameError } from "@/lib/game/errors";
import { draftHref } from "@/lib/game/navigation";
import {
  listCompletedRunHistory,
  localRunHistoryProvider,
  type HistoryEntry,
  type RunHistoryProvider,
} from "@/lib/game/history";
import { createServerRunHistoryProvider } from "@/lib/game/server-history-provider";
import { useAuth } from "@/components/auth-context";

import s from "./game.module.css";

type Mode =
  | { kind: "loading" }
  | {
      kind: "ready";
      entries: HistoryEntry[];
      persistence: "durable" | "volatile";
      warnings: string[];
    }
  | { kind: "error"; title: string; message: string };

export function HistoryScreen() {
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const reqToken = useRef(0);
  // F-3.5 — provider swap. Signed-in users read the server-backed history
  // (saved_runs + the F-3 anon→account claim means runs saved BEFORE
  // sign-in show up after sign-in too). Anon / not-yet-ready callers stay
  // on the local provider so the experience is identical to pre-F-3.5.
  const { isSignedIn, ready: authReady } = useAuth();

  useEffect(() => {
    const myToken = ++reqToken.current;
    setMode({ kind: "loading" });
    // Wait until the auth state has resolved at least once so we don't
    // flicker the local list and then replace it.
    if (!authReady) return;
    void (async () => {
      try {
        const gd: GameData = await loadGameData();
        if (myToken !== reqToken.current) return;
        const provider: RunHistoryProvider = isSignedIn
          ? createServerRunHistoryProvider()
          : localRunHistoryProvider;
        const result = await listCompletedRunHistory(gd, provider);
        if (myToken !== reqToken.current) return;
        setMode({
          kind: "ready",
          entries: result.entries,
          persistence: result.persistence,
          warnings: result.warnings,
        });
      } catch (err) {
        if (myToken !== reqToken.current) return;
        const d = describeGameError(err);
        setMode({ kind: "error", title: d.title, message: d.message });
      }
    })();
  }, [authReady, isSignedIn]);

  if (mode.kind === "loading") {
    return (
      <div className={s.history}>
        <HistoryAppBar />
        <div className={s.loadingPanel} role="status">
          <p>Loading your run history…</p>
        </div>
      </div>
    );
  }

  if (mode.kind === "error") {
    return (
      <div className={s.history}>
        <HistoryAppBar />
        <div className={s.errorPanel} role="alert">
          <h2 className={s.errorTitle}>{mode.title}</h2>
          <p className={s.errorMessage}>{mode.message}</p>
          <Link href={draftHref(null)} className="btn btn--primary">
            Start a new draft
          </Link>
        </div>
      </div>
    );
  }

  if (mode.entries.length === 0) {
    return (
      <div className={s.history}>
        <HistoryAppBar />
        <header className="page-head">
          <span className="eyebrow">Run history</span>
          <h1 className="display">No completed runs yet</h1>
          <p className="page-head__note">
            Finish a draft and simulate the run to see it here. Signed-in users can open Account for
            the complete server history.
          </p>
        </header>
        {mode.persistence === "volatile" ? (
          <p className={s.historyWarn} role="status">
            History is available in this tab only because browser storage is unavailable.
          </p>
        ) : null}
        <div className={s.resultsActions}>
          {isSignedIn ? (
            <Link href="/account" className="btn btn--ghost">
              Account
            </Link>
          ) : null}
          <Link href={draftHref(null)} className="btn btn--primary">
            Draft Again
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={s.history}>
      <HistoryAppBar />
      <header className="page-head">
        <span className="eyebrow">Run history</span>
        <h1 className="display">Recent runs</h1>
        <p className="page-head__note">
          This shortcut shows the 5 most recent completed runs. Account is the complete server
          history for signed-in users.
        </p>
      </header>

      {mode.persistence === "volatile" ? (
        <p className={s.historyWarn} role="status">
          History is available in this tab only because browser storage is unavailable.
        </p>
      ) : null}

      <ul className={s.historyList}>
        {mode.entries.map((entry) => (
          <li key={entry.run_id}>
            <HistoryCard entry={entry} />
          </li>
        ))}
      </ul>

      <div className={s.resultsActions}>
        {isSignedIn ? (
          <Link href="/account" className="btn btn--ghost">
            View all in Account
          </Link>
        ) : null}
        <Link href={draftHref(null)} className="btn btn--primary">
          Draft Again
        </Link>
      </div>
    </div>
  );
}

function HistoryAppBar() {
  return (
    <header className={s.draftAppBar}>
      <div className={s.appBarBrand}>
        <Image src="/brand/wcdraft-mark.svg" alt="wcdraft" width={28} height={31} priority />
        <span className={s.appBarTitle}>History</span>
      </div>
    </header>
  );
}

function HistoryCard({ entry }: { entry: HistoryEntry }) {
  const ariaLabel = `View results for ${entry.team_name}, record ${entry.display_record}`;
  const recordClass = entry.is_champion
    ? `${s.historyRecord} ${s.historyRecordGold}`
    : s.historyRecord;
  const [seedCopied, setSeedCopied] = useState(false);

  async function copyFullSeed() {
    try {
      await navigator.clipboard.writeText(entry.seed);
      setSeedCopied(true);
      window.setTimeout(() => setSeedCopied(false), 2000);
    } catch {
      setSeedCopied(false);
    }
  }

  const meta = (
    <>
      <div className={s.historyMetaTop}>
        <span className={recordClass}>{entry.display_record}</span>
        <div className={s.historyMetaLines}>
          <span className={s.historyTeam}>{entry.team_name}</span>
          <span className={s.historyFormation}>
            {entry.formation_name}
            {entry.is_champion ? " · Champions" : ""}
          </span>
        </div>
      </div>
      {entry.key_picks.length > 0 ? (
        <ul className={s.historyPicks}>
          {entry.key_picks.map((p, i) => (
            <li key={`${entry.run_id}-pick-${i}`} className={s.historyPick}>
              <span className={s.historyPickNation}>{p.nation_code}</span>
              <span className={s.historyPickName}>{p.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={s.historyFootRow}>
        <span className={s.historyRecency}>{entry.recency_label}</span>
        <span className={s.historySequence}>{entry.sequence_label}</span>
        <code className={s.historySeed} title={entry.seed}>
          seed {shortSeed(entry.seed)}
        </code>
      </div>
    </>
  );

  if (entry.replay_href) {
    return (
      <article className={`${s.panel} ${s.historyCard}`} aria-label={ariaLabel}>
        {meta}
        <div className={s.historyActions}>
          <Link href={entry.replay_href} className={s.historyOpenHint}>
            Open results →
          </Link>
          <button type="button" className={s.historySeedCopy} onClick={copyFullSeed}>
            {seedCopied ? "Seed copied" : "Copy full seed"}
          </button>
          {entry.share_href ? <span className={s.historyShareHint}>Replay token</span> : null}
        </div>
      </article>
    );
  }

  return (
    <div
      className={`${s.panel} ${s.historyCard} ${s.historyCardDisabled}`}
      role="group"
      aria-disabled="true"
      aria-label={`${ariaLabel} (replay unavailable)`}
    >
      {meta}
      <p className={s.historyReplayError} role="alert">
        Replay link unavailable: {entry.replay_error ?? "unknown error"}
      </p>
    </div>
  );
}

function shortSeed(seed: string): string {
  if (seed.length <= 30) return seed;
  return `${seed.slice(0, 16)}...${seed.slice(-8)}`;
}
