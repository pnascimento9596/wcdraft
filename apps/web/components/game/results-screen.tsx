"use client";

import { useState } from "react";
import Link from "next/link";
import { RUN_MATCHES, RUN_SUMMARY, deriveBox, periodTag, type MatchBox } from "@/lib/mock";
import s from "./game.module.css";

function scoreLabel(m: MatchBox): { score: string; tag: string | null } {
  const u = m.reg[0] + (m.et ? m.et[0] : 0);
  const o = m.reg[1] + (m.et ? m.et[1] : 0);
  let tag: string | null = null;
  if (m.shootout) tag = `pens ${m.shootout.user}–${m.shootout.opp}`;
  else if (m.et) tag = "a.e.t.";
  return { score: `${u}–${o}`, tag };
}

export function ResultsScreen() {
  const r = RUN_SUMMARY;
  const [open, setOpen] = useState<string | null>(RUN_MATCHES[RUN_MATCHES.length - 1]?.match_id ?? null);

  return (
    <div className={s.results}>
      {/* ── Outcome header ────────────────────────────────────────────── */}
      <header className={`${s.panel} ${s.outcome}`}>
        <span className={s.eyebrowAccent}>{r.is_champion ? "Champions" : "Run complete"}</span>
        <div className={s.outcomeRecord}>
          <span className={s.outcomeBig}>{r.record}</span>
          <span className={s.outcomeWL}>W–L</span>
        </div>
        <div className={s.outcomeStats}>
          <div className={s.oStat}>
            <span className={s.oStatNum}>{r.goals_for}</span>
            <span className={s.oStatLabel}>scored</span>
          </div>
          <div className={s.oStat}>
            <span className={s.oStatNum}>{r.goals_against}</span>
            <span className={s.oStatLabel}>conceded</span>
          </div>
          <div className={s.oStat}>
            <span className={s.oStatNum}>{r.top_scorer?.goals ?? 0}</span>
            <span className={s.oStatLabel}>{r.top_scorer?.name ?? "top scorer"}</span>
          </div>
          <div className={s.oStat}>
            <span className={s.oStatNum}>{r.shootout_wins}</span>
            <span className={s.oStatLabel}>shootout wins</span>
          </div>
        </div>
        <div className={s.outcomeFlags}>
          {r.is_champion && <span className={s.flagGold}>Tournament won</span>}
          <span className={r.undefeated_regulation ? s.flagGood : s.flagMuted}>
            {r.undefeated_regulation ? "Undefeated in regulation" : "Undefeated — one shootout"}
          </span>
        </div>
      </header>

      {/* ── Narrative ─────────────────────────────────────────────────── */}
      <section className={`${s.panel} ${s.narrative}`}>
        <span className={s.narrativeMark} aria-hidden="true">
          &ldquo;
        </span>
        <p className={s.narrativeText}>{r.narrative}</p>
      </section>

      {/* ── Match-by-match ────────────────────────────────────────────── */}
      <section className={s.panel} aria-label="Match results">
        <div className={s.panelHead}>
          <h2 className={s.panelTitle}>The run · 8 matches</h2>
          <span className={s.panelMeta}>Box scores derived from the event log</span>
        </div>

        <ul className={s.matchList}>
          {RUN_MATCHES.map((m) => {
            const { score, tag } = scoreLabel(m);
            const isOpen = open === m.match_id;
            const box = deriveBox(m);
            return (
              <li key={m.match_id} className={s.matchItem}>
                <button
                  type="button"
                  className={s.matchRow}
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : m.match_id)}
                >
                  <span className={`${s.matchOutcome} ${m.outcome === "W" ? s.win : m.outcome === "L" ? s.loss : s.draw}`}>
                    {m.outcome}
                  </span>
                  <span className={s.matchRound}>{m.round_label}</span>
                  <span className={s.matchOpp}>vs {m.opponent}</span>
                  <span className={s.matchScore}>
                    {score}
                    {tag && <span className={s.matchTag}>{tag}</span>}
                  </span>
                  <span className={s.matchChevron} aria-hidden="true">
                    {isOpen ? "▾" : "▸"}
                  </span>
                </button>

                {isOpen && (
                  <div className={s.boxScore}>
                    <div className={s.boxCol}>
                      <span className={s.boxColHead}>Your XI</span>
                      {box.userGoals.length === 0 && <span className={s.boxNone}>No goals</span>}
                      {box.userGoals.map((g, i) => (
                        <span key={i} className={s.boxGoal}>
                          ⚽ {g.name} {g.minute}&rsquo;{periodTag(g.period)}
                          {g.detail && <span className={s.boxDetail}> · {g.detail}</span>}
                        </span>
                      ))}
                    </div>
                    <div className={s.boxCol}>
                      <span className={s.boxColHead}>{m.opponent}</span>
                      {box.oppGoals.length === 0 && <span className={s.boxNone}>No goals</span>}
                      {box.oppGoals.map((g, i) => (
                        <span key={i} className={s.boxGoal}>
                          ⚽ {g.name} {g.minute}&rsquo;{periodTag(g.period)}
                          {g.detail && <span className={s.boxDetail}> · {g.detail}</span>}
                        </span>
                      ))}
                    </div>

                    {(box.cards.length > 0 || box.subs.length > 0 || box.injuries.length > 0) && (
                      <div className={s.boxEvents}>
                        {box.cards.map((c, i) => (
                          <span key={`c${i}`} className={s.boxEvent}>
                            <span className={c.card === "red" ? s.cardRed : s.cardYellow} aria-hidden="true" />
                            {c.name} {c.minute}&rsquo; ({c.side === "user" ? "us" : m.opponent})
                          </span>
                        ))}
                        {box.subs.map((sub, i) => (
                          <span key={`s${i}`} className={s.boxEvent}>
                            🔁 {sub.name} for {sub.off} {sub.minute}&rsquo;
                          </span>
                        ))}
                        {box.injuries.map((inj, i) => (
                          <span key={`i${i}`} className={s.boxEvent}>
                            🩹 {inj.name} {inj.minute}&rsquo;{inj.ending ? " (out of tournament)" : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Seed + actions ────────────────────────────────────────────── */}
      <section className={`${s.panel} ${s.seedPanel}`}>
        <div className={s.seedRow}>
          <span className={s.seedLabel}>Seed</span>
          <code className={s.seedCode}>{r.seed}</code>
          <span className={s.seedNote}>Replays are seed-locked — identical every time.</span>
        </div>
        <div className={s.resultsActions}>
          <Link href="/play/share" className="btn btn--primary">
            Share this run →
          </Link>
          <Link href="/play" className="btn btn--ghost">
            New draft
          </Link>
        </div>
      </section>
    </div>
  );
}
