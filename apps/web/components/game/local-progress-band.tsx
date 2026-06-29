"use client";

import { useEffect, useState } from "react";
import { loadDataManifest } from "@wcdraft/data/client";

import {
  buildLocalProgressSummary,
  formatBestScore,
  formatUtcCountdown,
  millisecondsUntilNextUtcMidnight,
  type LocalProgressSummary,
} from "@/lib/game/local-progress";
import { listRunRecords } from "@/lib/game/run-record";
import { composeVersions, type RunRecordVersions } from "@/lib/game/versions";

import s from "./game.module.css";

const EMPTY_SUMMARY: LocalProgressSummary = {
  targetDate: "",
  streakDays: 0,
  todayBest: null,
  allTimeBest: null,
};

export function LocalProgressBand({
  summary,
  compact = false,
}: {
  summary: LocalProgressSummary;
  compact?: boolean;
}) {
  const countdown = useUtcCountdown();
  const className = compact
    ? `${s.localProgressBand} ${s.localProgressBandCompact}`
    : s.localProgressBand;
  return (
    <section className={className} aria-label="Daily progress">
      <div className={s.localProgressPrimary}>
        <span className={s.localProgressStreak}>{summary.streakDays}-DAY STREAK</span>
        <span className={s.localProgressCountdown}>NEXT DRAFT IN {countdown}</span>
      </div>
      <div className={s.localProgressBest}>
        <span>Today&apos;s best: {formatBestScore(summary.todayBest)}</span>
        <span>All-time best: {formatBestScore(summary.allTimeBest)}</span>
      </div>
    </section>
  );
}

export function LocalProgressBandWithVersions({
  versions,
  targetDate,
  compact = false,
}: {
  versions: RunRecordVersions;
  targetDate?: string | null;
  compact?: boolean;
}) {
  const [summary, setSummary] = useState<LocalProgressSummary>(() =>
    readSummary(versions, targetDate ?? undefined),
  );

  useEffect(() => {
    setSummary(readSummary(versions, targetDate ?? undefined));
  }, [versions, targetDate]);

  return <LocalProgressBand summary={summary} compact={compact} />;
}

export function LocalProgressBandFromStorage({
  targetDate,
  compact = false,
}: {
  targetDate?: string | null;
  compact?: boolean;
}) {
  const [summary, setSummary] = useState<LocalProgressSummary>(EMPTY_SUMMARY);

  useEffect(() => {
    let cancelled = false;
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
  }, [targetDate]);

  return <LocalProgressBand summary={summary} compact={compact} />;
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
