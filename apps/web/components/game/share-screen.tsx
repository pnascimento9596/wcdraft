"use client";

import { useState } from "react";
import Link from "next/link";
import { RUN_SUMMARY, XI_FORMATION, XI_MANAGER, XI_STARTERS } from "@/lib/mock";
import s from "./game.module.css";

const HEADLINE = RUN_SUMMARY.is_champion ? "CHAMPIONS" : "RUN COMPLETE";

const SHARE_TEXT =
  `${RUN_SUMMARY.team_name} — ${HEADLINE} (${RUN_SUMMARY.record}) on wcdraft.\n` +
  `${RUN_SUMMARY.goals_for} scored, ${RUN_SUMMARY.goals_against} conceded · ` +
  `top scorer ${RUN_SUMMARY.top_scorer?.name ?? "—"} (${RUN_SUMMARY.top_scorer?.goals ?? 0}).\n` +
  `Seed ${RUN_SUMMARY.seed} — beat it.`;

export function ShareScreen() {
  const [copied, setCopied] = useState(false);
  // Star names for the card — the three top-rated starters.
  const stars = [...XI_STARTERS]
    .filter((sl) => sl.card)
    .sort((a, b) => (b.card!.rating.overall ?? 0) - (a.card!.rating.overall ?? 0))
    .slice(0, 3)
    .map((sl) => sl.card!.name);

  async function copy() {
    try {
      await navigator.clipboard.writeText(SHARE_TEXT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={s.share}>
      <header className="page-head">
        <span className="eyebrow">Share your run</span>
        <h1 className="display">The card</h1>
        <p className="page-head__note">Preview — generated from your mock run. No competition marks.</p>
      </header>

      {/* ── The shareable card ────────────────────────────────────────── */}
      <div className={s.shareCard} role="img" aria-label={`${RUN_SUMMARY.team_name} — ${HEADLINE}, record ${RUN_SUMMARY.record}`}>
        <div className={s.shareGrain} aria-hidden="true" />
        <div className={s.shareTop}>
          <span className={s.shareBrand}>
            wc<b>draft</b>
          </span>
          <span className={s.shareSeed}>{RUN_SUMMARY.seed}</span>
        </div>

        <div className={s.shareBody}>
          <span className={s.shareTeam}>{RUN_SUMMARY.team_name}</span>
          <span className={s.shareHeadline}>{HEADLINE}</span>
          <div className={s.shareRecord}>
            <span className={s.shareRecordNum}>{RUN_SUMMARY.record}</span>
            <span className={s.shareRecordLabel}>
              {XI_FORMATION.name} · mgr {XI_MANAGER.name}
            </span>
          </div>
        </div>

        <div className={s.shareStats}>
          <div className={s.shareStat}>
            <b>{RUN_SUMMARY.goals_for}</b>
            <span>scored</span>
          </div>
          <div className={s.shareStat}>
            <b>{RUN_SUMMARY.goals_against}</b>
            <span>conceded</span>
          </div>
          <div className={s.shareStat}>
            <b>{RUN_SUMMARY.top_scorer?.goals ?? 0}</b>
            <span>{RUN_SUMMARY.top_scorer?.name ?? "top scorer"}</span>
          </div>
        </div>

        <div className={s.shareStars}>{stars.join(" · ")}</div>
      </div>

      {/* ── Caption + actions ─────────────────────────────────────────── */}
      <div className={`${s.panel} ${s.sharePanel}`}>
        <p className={s.shareCaptionLabel}>Caption</p>
        <pre className={s.shareCaption}>{SHARE_TEXT}</pre>
        <div className={s.resultsActions}>
          <button type="button" className="btn btn--primary" onClick={copy}>
            {copied ? "Copied ✓" : "Copy caption"}
          </button>
          <Link href="/play/results" className="btn btn--ghost">
            Back to results
          </Link>
        </div>
        <p className={s.shareHint}>
          Image export and one-tap sharing arrive with the live game. Nothing here uses any official
          competition name, emblem, or trophy.
        </p>
      </div>
    </div>
  );
}
