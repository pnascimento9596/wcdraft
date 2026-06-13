import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How to Play",
  description:
    "How wcdraft works: seventeen spins, one XI and a manager, the real 2026 bracket, eight matches, the two modes, your setup choices, and how runs rank and share.",
};

export default function HowToPlayPage() {
  return (
    <div className="container container--narrow page">
      <header className="page-head">
        <span className="eyebrow">The rules</span>
        <h1 className="display">How to play</h1>
        <p className="lede">
          Seventeen spins build one all-time World Cup XI. Each spin lands a national team from a
          single tournament year; you take one entity from it, lock the shape you committed to up
          front, then send your side into the real 2026 bracket. Win all eight and you finish a
          perfect run.
        </p>
      </header>

      <section className="steps">
        <article className="step">
          <span className="step__num">01</span>
          <h3>The spin</h3>
          <p>
            Every spin pairs a nation with one World Cup year — Peru 2018, Hungary 1954, Brazil
            1970. That single squad is your pool for the pick that follows; the era you choose at
            setup decides which years can come up.
          </p>
        </article>

        <article className="step">
          <span className="step__num">02</span>
          <h3>One pick</h3>
          <p>
            Take one entity from the rolled squad — a player, or that nation&rsquo;s manager. Across
            your seventeen spins you draft sixteen players and exactly one manager; you decide which
            spin to spend on the manager. Once a manager is in, later spins offer players only.
          </p>
        </article>

        <article className="step">
          <span className="step__num">03</span>
          <h3>Your formation</h3>
          <p>
            Lock a formation before the first spin — it is fixed for the rest of the draft. Eleven
            starters and five on the bench make up your sixteen-player squad; each pick locks to its
            slot the moment you place it.
          </p>
        </article>

        <article className="step">
          <span className="step__num">04</span>
          <h3>Positions &amp; synergy</h3>
          <p>
            Players settle into the positions they can cover, and shared nationality builds synergy:
            starters from the same country reinforce one another, and a manager links to his
            countrymen in the XI. Synergy lifts how the side performs in the simulation.
          </p>
        </article>
      </section>

      <div className="prose">
        <hr />
        <h2>The eight-match run</h2>
        <p>
          When the squad is complete, wcdraft drops it into the real 2026 World Cup bracket and
          simulates the campaign: three group matches, then five knockout rounds through to the
          final — eight matches in all. Winning every one is a flawless <strong>8&ndash;0</strong>{" "}
          run. The same draft and the same seed always simulate to the same result.
        </p>

        <h2>Two ways to draft</h2>
        <p>
          <strong>Classic</strong> puts everything on the table — ratings, positions, stats and a
          live synergy preview as you build. <strong>Memory</strong> keeps the names, flags and
          years but hides every rating and synergy number until you simulate; you draft on what you
          remember, and the full picture is revealed afterwards. Both modes run on the same seeds,
          so a side drafted from memory and the same side drafted in the open play out identically.
        </p>

        <h2>Setting up</h2>
        <p>
          Before you lock a formation you can tune three things. <strong>Era</strong> narrows the
          spin pool to a span of tournaments — all-time, or the more recent windows.{" "}
          <strong>Draft order</strong> is either Squad First (spin a squad, then choose who fills
          which slot) or Position First (choose the slot to fill, then spin for it).{" "}
          <strong>Rating basis</strong> is Career (each card on its whole-career peak) or Current
          (the player at that tournament&rsquo;s strength, estimated where a career is still in
          progress); a Current run is marked with a chip and counts as casual.
        </p>

        <h2>Ranked &amp; casual</h2>
        <p>
          Only the canonical setup — Squad First, Career basis, all-time era — posts to the ranked
          leaderboard, in either Classic or Memory. Any other combination still plays in full and is
          still shareable; it just runs as a casual draft rather than a ranked one.
        </p>

        <h2>Sharing &amp; replays</h2>
        <p>
          Every run produces a share link that carries the seed, your seventeen picks and the build
          it was made on, so opening it replays your draft byte-for-byte from the seed. Open a link
          made on a different build and the page says so honestly rather than faking a matching
          result.
        </p>
      </div>
    </div>
  );
}
