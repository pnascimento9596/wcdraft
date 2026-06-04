import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How to Play",
  description:
    "How wcdraft works: the spin, picking your XI, formations, positions and synergy, the 8-match run, scoring, and game modes.",
};

export default function HowToPlayPage() {
  return (
    <div className="container container--narrow page">
      <header className="page-head">
        <span className="eyebrow">The rules</span>
        <h1 className="display">How to play</h1>
        <p className="lede">
          A quick tour of the wcdraft loop. Final copy and exact numbers land alongside the game
          itself — the sections below are the scaffold.
        </p>
        <p className="page-head__note">
          Draft copy — mechanics shown are placeholders until finalised.
        </p>
      </header>

      <section className="steps">
        <article className="step">
          <span className="step__num">01</span>
          <h3>The Spin</h3>
          <p>
            Each turn spins up a random national team paired with a World Cup year. That combination
            is your pool for the pick that follows.
          </p>
        </article>

        <article className="step">
          <span className="step__num">02</span>
          <h3>Pick One</h3>
          <p>
            You choose a single player from each spin. Your 17th and final spin is for a manager
            rather than a player.
          </p>
        </article>

        <article className="step">
          <span className="step__num">03</span>
          <h3>Formation</h3>
          <p>
            Lock your formation before the very first spin. As the draft runs, each pick locks to
            its slot the moment you select it.
          </p>
        </article>

        <article className="step">
          <span className="step__num">04</span>
          <h3>Positions &amp; Synergy</h3>
          <p>
            Players slot into positions on your sheet, and how they fit together feeds into synergy.
            Exact scoring details are still being finalised.
          </p>
        </article>
      </section>

      <div className="prose">
        <hr />
        <h2>The 8-Match Run</h2>
        <p>
          A full run spans eight matches. A flawless campaign — winning every match — is a perfect{" "}
          <strong>8–0</strong> run. Match-by-match details will be documented here as they&rsquo;re
          locked in.
        </p>

        <h2>Scoring &amp; Leaderboard</h2>
        <p>
          Runs are scored and ranked on a leaderboard. The full scoring breakdown and how placements
          are calculated will be added before launch.
        </p>

        <h2>Game Modes</h2>
        <p>
          <strong>Classic</strong> is the standard mode described above. Additional modes are hidden
          for now and may be revealed in a later update.
        </p>

        <div className="callout">
          <p>
            This page is a scaffold. Nothing here invents mechanics that aren&rsquo;t settled —
            placeholder wording marks anything still in flux.
          </p>
        </div>
      </div>
    </div>
  );
}
