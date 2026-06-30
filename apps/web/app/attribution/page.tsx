import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Attribution",
  description: "Data, source, and licensing attribution for wcdraft's football draft data.",
};

export default function AttributionPage() {
  return (
    <div className="container container--narrow page">
      <header className="page-head">
        <span className="eyebrow">Attribution</span>
        <h1 className="display">Data attribution</h1>
        <p className="lede">
          wcdraft uses openly licensed football data and keeps source credit visible in the app.
        </p>
      </header>

      <div className="prose">
        <h2>Fjelstul World Cup Database</h2>
        <p>
          Data: The Fjelstul World Cup Database © 2023 Joshua C. Fjelstul, Ph.D., licensed CC-BY-SA
          4.0 (
          <a href="https://github.com/jfjelstul/worldcup" target="_blank" rel="noopener noreferrer">
            github.com/jfjelstul/worldcup
          </a>
          ), modified.
        </p>

        <h2>Wikipedia</h2>
        <p>
          Selected squad, club, and tournament-reference facts are derived from Wikipedia pages
          licensed under Creative Commons Attribution-ShareAlike terms. wcdraft uses text/data
          references only; player photos, portraits, and likenesses are not used in the app or in
          marketing assets.
        </p>

        <h2>Club crests</h2>
        <p>
          A small audited set of club crest SVGs is sourced from Wikimedia Commons files whose
          metadata reports public-domain usage terms. Each file and source URL is listed in the
          repository club-crest manifest. Unmapped, ambiguous, and historical club rows use a
          generated monogram fallback instead of a guessed logo.
        </p>

        <h2>Independence</h2>
        <p>
          wcdraft is an independent fan-made project and is not affiliated with, endorsed by, or
          associated with any official competition, governing body, club, or player.
        </p>
      </div>
    </div>
  );
}
