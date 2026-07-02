"use client";

import { useEffect, useMemo, useState } from "react";
import { loadDataManifest } from "@wcdraft/data/client";

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
}: {
  summary: LocalProgressSummary;
  compact?: boolean;
  friendRun?: FriendRunContext | null;
  signedIn?: boolean;
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
  const streakLabel = summary.streakDays === null ? "—" : summary.streakDays.toString();
  const showSignInNudge =
    trigger !== null && checkedStorageKey === trigger.storageKey && dismissedKey !== trigger.storageKey;

  useEffect(() => {
    if (trigger === null || typeof window === "undefined") {
      setDismissedKey(null);
      setCheckedStorageKey(null);
      return;
    }
    setDismissedKey(window.localStorage.getItem(trigger.storageKey) === "1" ? trigger.storageKey : null);
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
      <div className={s.localProgressPrimary}>
        <span className={s.localProgressStreak}>{streakLabel}-DAY STREAK</span>
        <span className={s.localProgressCountdown} suppressHydrationWarning>
          NEXT DRAFT IN {countdown}
        </span>
      </div>
      {friendRun ? (
        <p className={s.localProgressFriend}>
          Friend&apos;s run: {friendRun.record ?? "—"} · {friendRun.score} pts — beat it
        </p>
      ) : null}
      <div className={s.localProgressBest}>
        <span>Today&apos;s best: {formatBestScore(summary.todayBest)}</span>
        <span>All-time best: {formatBestScore(summary.allTimeBest)}</span>
      </div>
      {showSignInNudge ? (
        <p className={s.localProgressNudge} role="status">
          <span>Keep your streak on every device — </span>
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

  useEffect(() => {
    let cancelled = false;
    if (shouldUseServerProgress(isSignedIn, authReady, targetDate)) {
      readServerProgressSummary(targetDate ?? undefined)
        .then((serverSummary) => {
          if (!cancelled) setSummary(serverSummary);
        })
        .catch(() => {
          if (!cancelled) setSummary(readSummary(versions, targetDate ?? undefined));
        });
    } else {
      setSummary(readSummary(versions, targetDate ?? undefined));
    }
    return () => {
      cancelled = true;
    };
  }, [authReady, isSignedIn, targetDate, versions]);

  return (
    <LocalProgressBand
      summary={summary}
      compact={compact}
      friendRun={friendRun}
      signedIn={isSignedIn}
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

  useEffect(() => {
    let cancelled = false;
    if (shouldUseServerProgress(isSignedIn, authReady, targetDate)) {
      readServerProgressSummary(targetDate ?? undefined)
        .then((serverSummary) => {
          if (!cancelled) setSummary(serverSummary);
        })
        .catch(() => {
          if (!cancelled)
            setSummary(buildLocalProgressSummary([], { targetDate: targetDate ?? undefined }));
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
      .catch(() => {
        if (!cancelled)
          setSummary(buildLocalProgressSummary([], { targetDate: targetDate ?? undefined }));
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, isSignedIn, targetDate]);

  return (
    <LocalProgressBand
      summary={summary}
      compact={compact}
      friendRun={friendRun}
      signedIn={isSignedIn}
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

async function readServerProgressSummary(targetDate?: string): Promise<LocalProgressSummary> {
  const response = await fetch("/api/account/runs?limit=1", {
    credentials: "include",
    headers: { Accept: "application/json" },
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
