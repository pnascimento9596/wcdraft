import type { Metadata } from "next";

import { ERA_PRESET_LABELS } from "@/lib/game/era-labels";

export const metadata: Metadata = {
  title: "How to Play",
  description:
    "How wcdraft works: draft modes, seventeen spins, one XI and manager, setup choices, the 2026 bracket run, leaderboard rules, and share replays.",
};

const POSITION_KEYS = [
  { label: "GK", name: "Goalkeepers", shape: "square" },
  { label: "DF", name: "Defenders", shape: "triangle" },
  { label: "MF", name: "Midfielders", shape: "diamond" },
  { label: "FW", name: "Forwards", shape: "circle" },
] as const;

const RATING_KEYS = [
  { label: "OVR", name: "Overall", tone: "solid" },
  { label: "SYN", name: "Synergy", tone: "accent" },
  { label: "DATA", name: "Card data coverage", tone: "muted" },
  { label: "FIT", name: "Slot fit", tone: "cool" },
  { label: "CUR", name: "Current basis", tone: "cool" },
  { label: "EST", name: "Estimated input", tone: "muted" },
] as const;

export default function HowToPlayPage() {
  return (
    <div className="container container--narrow page">
      <header className="page-head">
        <span className="eyebrow">Rules reference</span>
        <h1 className="display">How to play</h1>
        <p className="lede">
          Draft sixteen players and exactly one manager from seventeen spins, then run that squad
          through the 2026 bracket. Same seed, picks, data and rules always replay the same result.
        </p>
      </header>

      <section className="steps" aria-label="Draft flow">
        <article className="step">
          <span className="step__num">01</span>
          <h2>Spin</h2>
          <p>
            A spin lands on one national team from one tournament year. Era setup decides which
            tournament years can appear.
          </p>
        </article>

        <article className="step">
          <span className="step__num">02</span>
          <h2>Pick</h2>
          <p>
            Take one legal player choice, or spend the spin on a manager. Once your manager is
            drafted, later spins offer players only.
          </p>
        </article>

        <article className="step">
          <span className="step__num">03</span>
          <h2>Place</h2>
          <p>
            Your locked formation gives you eleven starters and five bench slots. Player picks lock
            to a slot as you place them.
          </p>
        </article>

        <article className="step">
          <span className="step__num">04</span>
          <h2>Simulate</h2>
          <p>
            The finished squad plays three group matches and five knockout rounds. A flawless run is
            <strong> 8-0</strong>.
          </p>
        </article>
      </section>

      <div className="prose">
        <hr />

        <h2>Draft modes</h2>
        <div className="mode-rules" aria-label="Draft mode comparison">
          <article>
            <span className="mode-rule__tag">Ranked-capable</span>
            <h3>Classic</h3>
            <p>
              Each spin shows up to three players from the rolled nation-year, plus its manager if
              you still need one. Ratings, positions and Synergy stay visible. This is the sighted
              choose-from-3 draft.
            </p>
          </article>

          <article>
            <span className="mode-rule__tag">Casual</span>
            <h3>Open Draft</h3>
            <p>
              Each spin draws a nation. You may pick any available player from that nation&apos;s
              era-filtered roster, deduped by player, or one of that nation&apos;s managers.
            </p>
          </article>

          <article>
            <span className="mode-rule__tag">Ranked-capable</span>
            <h3>Memory</h3>
            <p>
              The same choose-from-3 draft as Classic, but ratings and Synergy numbers stay hidden
              until after the simulation reveal. This is the blind draft.
            </p>
          </article>
        </div>

        <h2>Setup choices</h2>
        <dl className="def-list">
          <div className="def-row">
            <dt>Era</dt>
            <dd>
              Choose {ERA_PRESET_LABELS.all_time}, {ERA_PRESET_LABELS.post_2000},{" "}
              {ERA_PRESET_LABELS.post_2010}, or {ERA_PRESET_LABELS.modern}. Era changes the spin
              pool and the Open Draft roster.
            </dd>
          </div>
          <div className="def-row">
            <dt>Draft order</dt>
            <dd>
              Squad First spins before you choose a slot. Position First commits the slot before the
              spin.
            </dd>
          </div>
          <div className="def-row">
            <dt>Rating basis</dt>
            <dd>
              Career rates each card by whole-career stature. Current rates the player at that
              tournament&apos;s strength where the data supports it.
            </dd>
          </div>
          <div className="def-row">
            <dt>Line strength</dt>
            <dd>
              Rating by Line uses the sim&apos;s 0–100 line-strength channels; it is not the same
              number as a card&apos;s OVR.
            </dd>
          </div>
        </dl>

        <h2>Visual keys</h2>
        <div className="key-grid" aria-label="Position and rating keys">
          <section aria-label="Position shapes">
            <h3>Position shapes</h3>
            <ul className="shape-key">
              {POSITION_KEYS.map((item) => (
                <li key={item.label}>
                  <span
                    className={`shape-key__mark shape-key__mark--${item.shape}`}
                    aria-hidden="true"
                  />
                  <b>{item.label}</b>
                  <span>{item.name}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Rating swatches">
            <h3>Rating swatches</h3>
            <ul className="rating-key">
              {RATING_KEYS.map((item) => (
                <li key={item.label}>
                  <span className={`rating-key__swatch rating-key__swatch--${item.tone}`}>
                    {item.label}
                  </span>
                  <span>{item.name}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <p>
          Historical nations may show a modern successor flag when no accurate bundled asset is
          available; the flag title says so.
        </p>

        <h2>Rules that matter</h2>
        <ul>
          <li>One player can appear only once in your squad, even if they have multiple cards.</li>
          <li>You must finish with sixteen players and exactly one manager.</li>
          <li>
            Synergy rewards national links among starters and between the manager and XI. Team boost
            is the readable form of the underlying strength multiplier.
          </li>
          <li>Out-of-position picks are allowed, but the simulation penalizes poor fit.</li>
        </ul>

        <h2>Leaderboards</h2>
        <p>
          Classic and Memory can post to Casual or Ranked boards. Open Draft is casual-only and does
          not submit to ranked boards. Leaderboards are separated by lane, draft mode, draft order,
          era and rating basis.
        </p>

        <h2>Reference standing</h2>
        <p>
          Every finished run shows “Beat ~X% of reference drafts” — your score placed on a curve of
          simulated drafts run on this engine, not a ranking against other players. The Daily
          board’s “Top X% of today’s field” is the separate, posted-field standing.
        </p>

        <h2>Daily Draft</h2>
        <p>
          Daily Draft gives everyone the same Classic, Squad First, Career, All-time draft for the
          UTC day. A new shared draft opens at 00:00 UTC.
        </p>

        <h2>Sharing</h2>
        <p>
          Share links carry the seed, picks and version anchors. If the receiving site has different
          data or rules, it says so instead of faking a replay.
        </p>
      </div>
    </div>
  );
}
