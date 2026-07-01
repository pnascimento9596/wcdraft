import Image from "next/image";
import type { DraftMode } from "@wcdraft/core";

import { draftModeCue, draftModeShortLabel } from "@/lib/game/mode-labels";
import { TOTAL_SPINS } from "./constants";
import s from "../game.module.css";

export function DraftAppBar({
  spinNumber,
  progressPct,
  mode,
  ranked,
  pickSpace,
  warning,
}: {
  spinNumber: number | null;
  progressPct: number;
  mode?: DraftMode;
  ranked?: boolean;
  pickSpace?: string;
  warning?: string | null;
}) {
  const modeCue =
    mode === undefined
      ? null
      : mode === "open"
        ? draftModeCue(mode)
        : ranked
          ? "Ranked"
          : draftModeCue(mode);
  return (
    <header className={s.draftAppBar}>
      <div className={s.appBarBrand}>
        <Image src="/brand/wcdraft-mark.svg" alt="wcdraft" width={28} height={31} priority />
        <span className={s.appBarTitle}>Draft</span>
      </div>
      {mode ? (
        <div className={s.appBarModeChip} aria-label={`Draft mode: ${draftModeShortLabel(mode)}`}>
          <span>{draftModeShortLabel(mode)}</span>
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
