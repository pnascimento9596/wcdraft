"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Position } from "@wcdraft/core";
import {
  DEFAULT_TEAM_NAME,
  XI_BENCH,
  XI_FORMATION,
  XI_MANAGER,
  XI_STARTERS,
  mockSynergy,
} from "@/lib/mock";
import { Pitch } from "./pitch";
import { SynergyPanel } from "./synergy-panel";
import s from "./game.module.css";

const LINES: { line: Position; label: string }[] = [
  { line: "GK", label: "Goalkeeper" },
  { line: "DF", label: "Defence" },
  { line: "MF", label: "Midfield" },
  { line: "FW", label: "Attack" },
];

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function ReviewScreen() {
  const [teamName, setTeamName] = useState(DEFAULT_TEAM_NAME);
  const synergy = useMemo(() => mockSynergy(XI_STARTERS, XI_FORMATION, XI_MANAGER), []);

  const lineRatings = useMemo(
    () =>
      LINES.map(({ line, label }) => {
        const cards = XI_STARTERS.filter((sl) => sl.line === line && sl.card).map((sl) => sl.card!);
        return {
          line,
          label,
          count: cards.length,
          overall: avg(cards.map((c) => c.rating.overall ?? 0)),
        };
      }).filter((l) => l.count > 0),
    [],
  );

  const squadAvg = useMemo(
    () => avg(XI_STARTERS.filter((sl) => sl.card).map((sl) => sl.card!.rating.overall ?? 0)),
    [],
  );

  return (
    <div className={s.review}>
      <header className="page-head">
        <span className="eyebrow">Squad review</span>
        <div className={s.teamNameRow}>
          <label className={s.teamNameLabel} htmlFor="team-name">
            Name your team
          </label>
          <input
            id="team-name"
            className={s.teamNameInput}
            value={teamName}
            maxLength={32}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder={DEFAULT_TEAM_NAME}
          />
        </div>
        <p className="page-head__note">Preview — illustrative XI on mock data.</p>
      </header>

      <div className={s.reviewGrid}>
        <section className={s.panel} aria-label="Final XI">
          <div className={s.panelHead}>
            <h2 className={s.panelTitle}>{XI_FORMATION.name}</h2>
            <span className={s.panelMeta}>Locked · no rearranging</span>
          </div>
          <Pitch starters={XI_STARTERS} lockedSlotIds={XI_STARTERS.map((sl) => sl.slot_id)} />

          <div className={s.bench}>
            <span className={s.benchLabel}>Bench</span>
            <div className={s.benchSlots}>
              {XI_BENCH.map((b) => (
                <div key={b.slot_id} className={`${s.benchSlot} ${s.benchFilled}`}>
                  <span className={s.slotPos}>{b.slot_position}</span>
                  <span className={s.slotName}>{b.card?.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={s.mgrSlot}>
            <span className={s.benchLabel}>Manager</span>
            <span className={s.mgrFilled}>
              {XI_MANAGER.name} · {XI_MANAGER.nation_name} · {XI_MANAGER.year}
              <span className={s.mgrRating}>{XI_MANAGER.rating.overall} OVR</span>
            </span>
          </div>
        </section>

        <section className={s.reviewSide}>
          <div className={s.panel}>
            <div className={s.panelHead}>
              <h2 className={s.panelTitle}>Rating by line</h2>
              <span className={s.squadAvg}>{squadAvg} OVR</span>
            </div>
            <div className={s.lineRatings}>
              {lineRatings.map((l) => (
                <div key={l.line} className={s.lineRow}>
                  <span className={s.lineName}>{l.label}</span>
                  <span className={s.lineTrack}>
                    <span className={s.lineFill} style={{ width: `${l.overall}%` }} />
                  </span>
                  <span className={s.lineVal}>{l.overall}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={s.panel}>
            <SynergyPanel result={synergy} />
          </div>

          <div className={`${s.panel} ${s.simPanel}`}>
            <p className={s.simNote}>
              Eight matches stand between <b>{teamName || DEFAULT_TEAM_NAME}</b> and a perfect run.
            </p>
            <Link href="/play/results" className="btn btn--primary">
              Simulate the run →
            </Link>
            <Link href="/play/draft" className="btn btn--ghost">
              Back to draft
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
