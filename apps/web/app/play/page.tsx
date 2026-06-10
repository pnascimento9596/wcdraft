import type { Metadata } from "next";
import Link from "next/link";
import s from "../../components/game/game.module.css";

export const metadata: Metadata = {
  title: "Choose a mode",
  description: "Pick a wcdraft game mode — Classic with ratings visible, or the hidden Memory mode.",
};

export default function ModeSelectPage() {
  return (
    <div className="container page game-page game-page--mode">
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

        {/* Memory — live. Ratings blind until the post-Simulate reveal. */}
        <Link href="/play/draft?mode=hidden" className={`${s.modeCard} ${s.modeCardLive}`}>
          <div className={s.modeCardTop}>
            <span className={s.modeTag}>Live</span>
            <span className={s.modeIndex}>02</span>
          </div>
          <h2 className={s.modeName}>Memory</h2>
          <p className={s.modeDesc}>
            Names, flags and years stay on the table — ratings don&rsquo;t. You draft on what you
            remember of the player, not a visible OVR. Everything reveals after you simulate.
          </p>
          <ul className={s.modeFeatures}>
            <li>Ratings &amp; Synergy numbers hidden</li>
            <li>Names, flags &amp; years visible</li>
            <li>Same seeds, same outcomes</li>
          </ul>
          <span className={s.modeCta}>Draft from memory →</span>
        </Link>
      </div>
    </div>
  );
}
