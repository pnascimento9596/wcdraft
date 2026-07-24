"use client";

import { useEffect, useMemo, useState } from "react";
import {
  boundedRequest,
  isRequestTimeoutError,
  loadDataManifest,
  REQUEST_BUDGET_MS,
} from "@wcdraft/data/client";

import { useAuth } from "@/components/auth-context";
import {
  buildLocalProgressSummary,
  dailySignInNudgeTrigger,
  formatBestScore,
  formatUtcCountdown,
  millisecondsUntilNextUtcMidnight,
  type LocalProgressSummary,
} from "@/lib/game/local-progress";
import { utcDateString } from "@/lib/game/daily";
import { listRunRecords } from "@/lib/game/run-record";
import { composeVersions, type RunRecordVersions } from "@/lib/game/versions";

import s from "./game.module.css";

const EMPTY_SUMMARY: LocalProgressSummary = {
  targetDate: "",
  streakDays: null,
  todayBest: null,
  allTimeBest: null,
  completedRunCount: 0,
  todaySetPersonalBest: false,
};

export interface FriendRunContext {
  readonly score: number;
  readonly record: string | null;
}

export function LocalProgressBand({
  summary,
  compact = false,
  friendRun = null,
  signedIn = false,
  timedOut = false,
  onRetry,
}: {
  summary: LocalProgressSummary;
  compact?: boolean;
  friendRun?: FriendRunContext | null;
  signedIn?: boolean;
  timedOut?: boolean;
  onRetry?: () => void;
}) {
  const countdown = useUtcCountdown();
  const trigger = useMemo(
    () => dailySignInNudgeTrigger(summary, { signedIn }),
    [summary, signedIn],
  );
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [checkedStorageKey, setCheckedStorageKey] = useState<string | null>(null);
  const className = compact
    ? `${s.localProgressBand} ${s.localProgressBandCompact}`
    : s.localProgressBand;
  // Null streak is absence, not zero: avoid chrome around "—" that reads as a
  // broken number. Real 0 still renders as 0.
  const hasStreak = summary.streakDays !== null;
  const streakLabel = hasStreak ? summary.streakDays!.toString() : null;
  const showSignInNudge =
    trigger !== null &&
    checkedStorageKey === trigger.storageKey &&
    dismissedKey !== trigger.storageKey;

  useEffect(() => {
    if (trigger === null || typeof window === "undefined") {
      setDismissedKey(null);
      setCheckedStorageKey(null);
      return;
    }
    setDismissedKey(
      window.localStorage.getItem(trigger.storageKey) === "1" ? trigger.storageKey : null,
    );
    setCheckedStorageKey(trigger.storageKey);
  }, [trigger]);

  function dismissSignInNudge() {
    if (trigger === null || typeof window === "undefined") return;
    window.localStorage.setItem(trigger.storageKey, "1");
    setDismissedKey(trigger.storageKey);
    setCheckedStorageKey(trigger.storageKey);
  }

  return (
    <section className={className} aria-label="Daily progress">
      <div className={s.localProgressRow}>
        {hasStreak ? (
          <span aria-label={`${streakLabel} day streak`}>Streak {streakLabel}</span>
        ) : (
          <span aria-label="No streak yet">No streak yet</span>
        )}
        <span aria-label={`Today's best ${formatBestScore(summary.todayBest)}`}>
          Today {formatBestScore(summary.todayBest)}
        </span>
        <span aria-label={`All-time best ${formatBestScore(summary.allTimeBest)}`}>
          All-time {formatBestScore(summary.allTimeBest)}
        </span>
        <span
          className={s.localProgressCountdown}
          aria-label={`Next draft in ${countdown}`}
          suppressHydrationWarning
        >
          {countdown}
        </span>
      </div>
      {friendRun ? (
        <p className={s.localProgressFriend}>
          Friend&apos;s run: {friendRun.record ?? "—"} · {friendRun.score} pts to beat
        </p>
      ) : null}
      {timedOut && onRetry ? (
        <p className={s.localProgressNudge} role="alert">
          <span>Progress took too long to load. </span>
          <button type="button" onClick={onRetry}>
            Retry progress
          </button>
          <a href="/play/history">Open history instead</a>
        </p>
      ) : null}
      {showSignInNudge ? (
        <p className={s.localProgressNudge} role="status">
          <span>Keep your streak on every device. </span>
          <a href="/sign-in">sign in.</a>
          <button type="button" onClick={dismissSignInNudge} aria-label="Dismiss sign-in nudge">
            Dismiss
          </button>
        </p>
      ) : null}
    </section>
  );
}

export function LocalProgressBandWithVersions({
  versions,
  targetDate,
  compact = false,
  friendRun = null,
}: {
  versions: RunRecordVersions;
  targetDate?: string | null;
  compact?: boolean;
  friendRun?: FriendRunContext | null;
}) {
  const { isSignedIn, ready: authReady } = useAuth();
  const [summary, setSummary] = useState<LocalProgressSummary>(() =>
    readSummary(versions, targetDate ?? undefined),
  );
  const [timedOut, setTimedOut] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTimedOut(false);
    if (shouldUseServerProgress(isSignedIn, authReady, targetDate)) {
      readServerProgressSummary(targetDate ?? undefined)
        .then((serverSummary) => {
          if (!cancelled) setSummary(serverSummary);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setTimedOut(isRequestTimeoutError(error));
            setSummary(readSummary(versions, targetDate ?? undefined));
          }
        });
    } else {
      setSummary(readSummary(versions, targetDate ?? undefined));
    }
    return () => {
      cancelled = true;
    };
  }, [authReady, isSignedIn, retryNonce, targetDate, versions]);

  return (
    <LocalProgressBand
      summary={summary}
      compact={compact}
      friendRun={friendRun}
      signedIn={isSignedIn}
      timedOut={timedOut}
      onRetry={() => setRetryNonce((value) => value + 1)}
    />
  );
}

export function LocalProgressBandFromStorage({
  targetDate,
  compact = false,
  friendRun = null,
}: {
  targetDate?: string | null;
  compact?: boolean;
  friendRun?: FriendRunContext | null;
}) {
  const { isSignedIn, ready: authReady } = useAuth();
  const [summary, setSummary] = useState<LocalProgressSummary>(EMPTY_SUMMARY);
  const [timedOut, setTimedOut] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTimedOut(false);
    if (shouldUseServerProgress(isSignedIn, authReady, targetDate)) {
      readServerProgressSummary(targetDate ?? undefined)
        .then((serverSummary) => {
          if (!cancelled) setSummary(serverSummary);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setTimedOut(isRequestTimeoutError(error));
            setSummary(buildLocalProgressSummary([], { targetDate: targetDate ?? undefined }));
          }
        });
      return () => {
        cancelled = true;
      };
    }
    loadDataManifest()
      .then((manifest) => {
        if (cancelled) return;
        const versions = composeVersions(manifest);
        setSummary(readSummary(versions, targetDate ?? undefined));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTimedOut(isRequestTimeoutError(error));
          setSummary(buildLocalProgressSummary([], { targetDate: targetDate ?? undefined }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, isSignedIn, retryNonce, targetDate]);

  return (
    <LocalProgressBand
      summary={summary}
      compact={compact}
      friendRun={friendRun}
      signedIn={isSignedIn}
      timedOut={timedOut}
      onRetry={() => setRetryNonce((value) => value + 1)}
    />
  );
}

interface AccountStatsResponse {
  readonly stats?: {
    readonly dailyStreakDays?: number;
    readonly todayBest?: number | null;
    readonly personalBest?: number | null;
  };
}

function shouldUseServerProgress(
  isSignedIn: boolean,
  authReady: boolean,
  targetDate: string | null | undefined,
): boolean {
  if (!authReady || !isSignedIn) return false;
  return !targetDate || targetDate === utcDateString();
}

export async function readServerProgressSummary(
  targetDate?: string,
  fetcher: typeof fetch = fetch.bind(globalThis),
): Promise<LocalProgressSummary> {
  return boundedRequest(
    async (signal) => {
      const response = await fetcher("/api/account/runs?limit=1", {
        credentials: "include",
        headers: { Accept: "application/json" },
        signal,
      });
      if (!response.ok) throw new Error(`account stats HTTP ${response.status.toString()}`);
      const body = (await response.json()) as AccountStatsResponse;
      const stats = body.stats;
      return {
        targetDate: targetDate ?? utcDateString(),
        streakDays: finiteNumber(stats?.dailyStreakDays),
        todayBest: finiteNumber(stats?.todayBest),
        allTimeBest: finiteNumber(stats?.personalBest),
        completedRunCount: undefined,
        todaySetPersonalBest:
          finiteNumber(stats?.todayBest) !== null &&
          finiteNumber(stats?.personalBest) !== null &&
          finiteNumber(stats?.todayBest) === finiteNumber(stats?.personalBest),
      };
    },
    {
      operation: "account progress",
      timeoutMs: REQUEST_BUDGET_MS.auth,
      safety: "safe-read",
    },
  );
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readSummary(versions: RunRecordVersions, targetDate?: string): LocalProgressSummary {
  const list = listRunRecords(versions, { limit: Number.POSITIVE_INFINITY });
  return buildLocalProgressSummary(list.records, { targetDate });
}

function useUtcCountdown(): string {
  const [label, setLabel] = useState(() => formatUtcCountdown(millisecondsUntilNextUtcMidnight()));

  useEffect(() => {
    const update = () => setLabel(formatUtcCountdown(millisecondsUntilNextUtcMidnight()));
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, []);

  return label;
}
