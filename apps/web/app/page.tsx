import Link from "next/link";

export default function HomePage() {
  return (
    <section className="hero">
      {/* Chalk pitch markings — decorative, original line-art (no marks). */}
      <svg
        className="hero__pitch"
        viewBox="0 0 1200 600"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <g fill="none" stroke="currentColor" strokeWidth="2" opacity="0.7">
          <line x1="600" y1="-40" x2="600" y2="640" />
          <circle cx="600" cy="300" r="120" />
          <circle cx="600" cy="300" r="5" fill="currentColor" />
          <rect x="-60" y="160" width="200" height="280" />
          <rect x="-60" y="240" width="90" height="120" />
          <rect x="1060" y="160" width="200" height="280" />
          <rect x="1170" y="240" width="90" height="120" />
        </g>
      </svg>

      <div className="container hero__inner reveal">
        <span className="eyebrow">An independent football drafting game</span>
        <h1 className="display">
          Draft your
          <br />
          all-time <span className="accent">XI.</span>
        </h1>
        <p className="lede hero__sub">
          Spin a random national team and a tournament year. Pick one footballer per spin. Lock your
          formation, build a squad across eight matches, and chase the perfect run.
        </p>

        <div className="btn-row">
          <Link href="/play" className="btn btn--primary">
            Play
          </Link>
          <Link href="/how-to-play" className="btn btn--ghost">
            How to play
          </Link>
        </div>

        <div className="hero__meta">
          <div className="stat">
            <span className="stat__num">
              17 <span className="accent">picks</span>
            </span>
            <span className="stat__label">11 starters · 5 subs · 1 manager</span>
          </div>
          <div className="stat">
            <span className="stat__num">8</span>
            <span className="stat__label">match run</span>
          </div>
          <div className="stat">
            <span className="stat__num">
              8<span className="gold">–</span>0
            </span>
            <span className="stat__label">a perfect run</span>
          </div>
        </div>

        <p className="hero__live">
          Live now on real football data from 1930–2022 plus 2026. The deterministic draft
          engine, the match simulator, and real scoring all run in your browser.
        </p>
      </div>
    </section>
  );
}
