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
        {/* ws-ux/mobile-polish-2: subtitle + pool note merged into one line —
            the header must leave both mode cards visible in a ~390×664
            viewport with zero scroll. */}
        <p className="lede">
          Seventeen spins, one all-time XI — live on the real 1930–2026 pool, all in your browser.
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
            Ratings, positions and stats all on the table — pure drafting skill on every rolled
            squad.
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
            Names, flags and years stay — ratings don&rsquo;t. Draft on what you remember;
            everything reveals after you simulate.
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
