import Image from "next/image";
import { isRankedDraftMode, type DraftMode } from "@wcdraft/core";

import { draftModeCue, draftModeShortLabel } from "@/lib/game/mode-labels";
import { TOTAL_SPINS } from "./constants";
import s from "../game.module.css";

export function DraftAppBar({
  spinNumber,
  progressPct,
  mode,
  daily,
  ranked,
  pickSpace,
  warning,
}: {
  spinNumber: number | null;
  progressPct: number;
  mode?: DraftMode;
  daily?: boolean;
  ranked?: boolean;
  pickSpace?: string;
  warning?: string | null;
}) {
  const modeLabel = daily
    ? "Daily"
    : mode === undefined
      ? null
      : mode === "open_hidden"
        ? "BLIND OPEN"
        : draftModeShortLabel(mode);
  const modeCue = daily
    ? "today's shared draft"
    : mode === undefined
      ? null
      : ranked && isRankedDraftMode(mode)
        ? "Ranked"
        : mode === "open_hidden"
          ? "CASUAL"
          : draftModeCue(mode);
  return (
    <header className={s.draftAppBar}>
      <div className={s.appBarBrand}>
        <Image src="/brand/wcdraft-mark.svg" alt="wcdraft" width={28} height={31} priority />
        <span className={s.appBarTitle}>Draft</span>
      </div>
      {modeLabel ? (
        <div className={s.appBarModeChip} aria-label={`Draft mode: ${modeLabel}`}>
          <span>{modeLabel}</span>
          <b>{modeCue}</b>
          {pickSpace ? <i>{pickSpace}</i> : null}
        </div>
      ) : null}
      {/* No counter until a draft actually exists (formation select /
          loading / error pass spinNumber=null) — a dash-counter on a
          screen with no draft reads as broken state. */}
      {spinNumber !== null ? (
        <div className={s.appBarMeter}>
          <div className={s.spinCounter}>
            <span className={s.spinCounterNum}>Spin {Math.min(spinNumber, TOTAL_SPINS)}</span>
            <span className={s.spinCounterTotal}>/ {TOTAL_SPINS}</span>
          </div>
          <div className={s.spinProgress} aria-hidden="true">
            <span
              className={s.spinProgressFill}
              style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
            />
          </div>
        </div>
      ) : null}
      {warning ? (
        <p className={s.persistenceWarn} role="status">
          {warning}
        </p>
      ) : null}
    </header>
  );
}
