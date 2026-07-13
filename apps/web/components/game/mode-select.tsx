"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftMode } from "@wcdraft/core";
import { DRAFT_MODE_COPY } from "@/lib/game/mode-labels";
import { loadDailyAvailability } from "@/lib/game/data";
import { utcDateString } from "@/lib/game/daily";
import { isRuntimeDataTimeout } from "@/lib/game/errors";
import { DAILY_UNAVAILABLE_TITLE, DailyUnavailableNotice } from "./daily-unavailable-notice";
import { LocalProgressBandFromStorage } from "./local-progress-band";
import s from "./game.module.css";

type PlayMode = "daily" | DraftMode;
type DailyAvailabilityState = "checking" | "available" | "unavailable" | "timeout";
type DailyAvailability = {
  readonly date: string;
  readonly state: DailyAvailabilityState;
};

export const DAILY_DATE_CHECK_INTERVAL_MS = 60_000;

const MODE_COPY: Record<
  PlayMode,
  {
    index: string;
    title: string;
    tag: string;
    desc: string;
    preview: string;
    chips: readonly string[];
    cta: string;
    href: string;
    featured?: boolean;
    secondary?: boolean;
  }
> = {
  daily: {
    index: "00",
    title: "Today's Draft",
    tag: "Daily",
    desc: "One shared draft for everyone today — a new one drops daily at 00:00 UTC.",
    preview: "DAILY",
    chips: ["Same draft", "Beat today"],
    cta: "Play daily",
    href: "/play/daily",
    featured: true,
  },
  classic: {
    index: "01",
    title: DRAFT_MODE_COPY.classic.label,
    // Short tags/chips so 360–390px cards do not clip mid-phrase (Q5 craft).
    tag: "Ranked · casual default",
    desc: DRAFT_MODE_COPY.classic.description,
    preview: "CLASSIC · RANKED · CASUAL DEFAULT",
    chips: ["3 choices", "Ranked-capable", "Synergy"],
    cta: "Start drafting",
    href: "/play/draft",
  },
  open: {
    index: "02",
    title: DRAFT_MODE_COPY.open.label,
    tag: "Casual",
    desc: DRAFT_MODE_COPY.open.description,
    preview: "OPEN · CASUAL",
    chips: ["Full roster", "Casual", "Shareable"],
    cta: "Open draft",
    href: "/play/draft?mode=open",
  },
  hidden: {
    index: "03",
    title: DRAFT_MODE_COPY.hidden.label,
    tag: "Ranked · casual default",
    desc: DRAFT_MODE_COPY.hidden.description,
    preview: "MEMORY · RANKED · CASUAL DEFAULT",
    chips: ["Ratings hidden", "3 choices", "Ranked-capable"],
    cta: "Draft from memory",
    href: "/play/draft?mode=hidden",
    secondary: true,
  },
  open_hidden: {
    index: "04",
    title: DRAFT_MODE_COPY.open_hidden.label,
    tag: "Casual",
    desc: DRAFT_MODE_COPY.open_hidden.description,
    preview: "BLIND OPEN · CASUAL",
    chips: ["Full roster", "Ratings hidden", "Shareable"],
    cta: "Blind Open",
    href: "/play/draft?mode=open_hidden",
    secondary: true,
  },
};

export function ModeSelect() {
  const router = useRouter();
  const [mode, setMode] = useState<PlayMode>("daily");
  const [daily, setDaily] = useState<DailyAvailability>(() => ({
    date: utcDateString(),
    state: "checking",
  }));
  const [dailyRetry, setDailyRetry] = useState(0);
  const dailyAvailability = daily.state;
  const selected = MODE_COPY[mode];
  const dailyUnavailableSelected = mode === "daily" && dailyAvailability === "unavailable";
  const dailyRecoveryDockInFlow =
    mode === "daily" && (dailyAvailability === "unavailable" || dailyAvailability === "timeout");

  const refreshUtcDate = useCallback(() => {
    const nextDate = utcDateString();
    setDaily((current) =>
      current.date === nextDate ? current : { date: nextDate, state: "checking" },
    );
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshUtcDate();
    };
    window.addEventListener("focus", refreshUtcDate);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(refreshUtcDate, DAILY_DATE_CHECK_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshUtcDate);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshUtcDate]);

  useEffect(() => {
    let active = true;
    const date = daily.date;
    setDaily((current) => (current.date === date ? { date, state: "checking" } : current));
    void loadDailyAvailability(date)
      .then((available) => {
        if (!active) return;
        setDaily((current) =>
          current.date === date
            ? { date, state: available ? "available" : "unavailable" }
            : current,
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDaily((current) =>
          current.date === date
            ? { date, state: isRuntimeDataTimeout(error) ? "timeout" : "unavailable" }
            : current,
        );
      });
    return () => {
      active = false;
    };
  }, [daily.date, dailyRetry]);

  return (
    <>
      <LocalProgressBandFromStorage compact />
      <div
        className={[
          s.modeGrid,
          s.modeGridDaily,
          dailyRecoveryDockInFlow ? s.modeGridDockInFlow : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="radiogroup"
        aria-label="Draft mode"
      >
        {(Object.keys(MODE_COPY) as PlayMode[]).map((key) => {
          const item = MODE_COPY[key];
          const on = mode === key;
          const checking = key === "daily" && dailyAvailability === "checking";
          const unavailable = key === "daily" && dailyAvailability === "unavailable";
          const timedOut = key === "daily" && dailyAvailability === "timeout";
          return (
            <button
              key={key}
              type="button"
              className={[
                s.modeCard,
                s.modeCardLive,
                item.featured ? s.modeCardFeatured : "",
                item.secondary ? s.modeCardSecondary : "",
                on ? s.modeCardSelected : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="radio"
              aria-checked={on}
              onClick={() => setMode(key)}
            >
              <span className={s.modeIndex} aria-hidden="true">
                {item.index}
              </span>
              <span className={s.modeCardTop}>
                <span className={s.modeTag}>
                  <span className={s.modeTagDot} aria-hidden="true" />
                  {item.tag}
                </span>
                <span className={s.modeName}>{item.title}</span>
              </span>
              <span className={s.modeDesc}>
                {timedOut
                  ? "Today's Daily check timed out. Retry it or play another mode."
                  : unavailable
                    ? DAILY_UNAVAILABLE_TITLE
                    : checking
                      ? "Checking today's Daily…"
                      : item.desc}
              </span>
              <span className={s.modePreview}>
                {timedOut
                  ? "DAILY · CHECK TIMED OUT"
                  : unavailable
                    ? "DAILY · PAUSED"
                    : checking
                      ? "DAILY · CHECKING"
                      : item.preview}
              </span>
              <span className={s.modeFeatures}>
                {(unavailable || checking || timedOut ? ["Other modes ready"] : item.chips).map(
                  (chip) => (
                    <span key={chip} className={s.modeFeatureChip}>
                      <span className={s.modeFeatureDot} aria-hidden="true" />
                      {chip}
                    </span>
                  ),
                )}
              </span>
              <span className={s.modeCardBottom}>
                <span className={s.modeCta}>
                  {timedOut
                    ? "Daily check timed out"
                    : unavailable
                      ? "Unavailable today"
                      : checking
                        ? "Checking availability"
                        : item.cta}
                  {unavailable || checking || timedOut ? "" : " →"}
                </span>
                {on ? <span className={s.modeSelectedText}>Selected</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      {mode === "daily" && dailyAvailability === "timeout" ? (
        <div className={`${s.modeDock} ${s.modeDockInFlow}`} role="alert">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setDailyRetry((value) => value + 1)}
          >
            Retry Daily check
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => router.push("/play/draft")}
          >
            Play Classic instead
          </button>
        </div>
      ) : dailyUnavailableSelected ? (
        <div className={`${s.modeDock} ${s.modeDockInFlow}`}>
          <DailyUnavailableNotice />
        </div>
      ) : mode === "daily" && dailyAvailability === "checking" ? (
        <div className={s.modeDock}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => router.push("/play/draft")}
          >
            Play Classic while we check →
          </button>
        </div>
      ) : (
        <div className={s.modeDock}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => router.push(selected.href)}
          >
            {selected.featured ? selected.cta : `Continue with ${selected.title}`} →
          </button>
        </div>
      )}
    </>
  );
}
