import type { Metadata } from "next";
import Link from "next/link";
import s from "../../components/game/game.module.css";

export const metadata: Metadata = {
  title: "Choose a mode",
  description: "Pick a wcdraft game mode — Classic with ratings visible, or the hidden Memory mode.",
};

export default function ModeSelectPage() {
  return (
    <div className="container page">
      <header className="page-head">
        <span className="eyebrow">New draft</span>
        <h1 className="display">Choose your mode</h1>
        <p className="lede">
          Seventeen spins, one all-time XI. Pick how much the draft shows you before you commit.
        </p>
        <p className="page-head__note">
          Live on the real 1930–2026 pool. Draft, eight-match simulation and scoring all run in
          your browser.
        </p>
      </header>

      <div className={s.modeGrid}>
        {/* Classic — live */}
        <Link href="/play/draft" className={`${s.modeCard} ${s.modeCardLive}`}>
          <div className={s.modeCardTop}>
            <span className={s.modeTag}>Live</span>
            <span className={s.modeIndex}>01</span>
          </div>
          <h2 className={s.modeName}>Classic</h2>
          <p className={s.modeDesc}>
            Ratings, positions and stats are all on the table. Every rolled squad shows you exactly
            what you&rsquo;re choosing between — pure drafting skill.
          </p>
          <ul className={s.modeFeatures}>
            <li>Ratings visible</li>
            <li>Full stat lines &amp; awards</li>
            <li>Live Synergy preview</li>
          </ul>
          <span className={s.modeCta}>Start drafting →</span>
        </Link>

        {/* Memory — designed-in, disabled */}
        <div className={`${s.modeCard} ${s.modeCardSoon}`} aria-disabled="true">
          <div className={s.modeCardTop}>
            <span className={s.modeTagSoon}>Locked</span>
            <span className={s.modeIndex}>02</span>
          </div>
          <h2 className={s.modeName}>Memory</h2>
          <p className={s.modeDesc}>
            Identities are masked until you commit. No ratings, no names at roll time — you draft on
            instinct and what you remember of the tournament. A harder, purer test.
          </p>
          <ul className={s.modeFeatures}>
            <li>Cards hidden until picked</li>
            <li>No ratings at roll time</li>
            <li>Same seeds, same outcomes</li>
          </ul>
          <span className={s.modeCtaSoon}>Coming in a later update</span>
        </div>
      </div>
    </div>
  );
}
