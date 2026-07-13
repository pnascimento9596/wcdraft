import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { HeroSpinDemo } from "../components/home/hero-spin-demo";
import heroStyles from "../components/home/home-hero.module.css";
import { metadataBaseUrl, SITE_DESCRIPTION, SITE_NAME } from "../lib/site-metadata";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const base = metadataBaseUrl().toString();
  // Minimal, accurate structured data: a WebSite + a free, browser-based
  // VideoGame. Helps search engines understand the surface and enables richer
  // results. Additive only — no user input flows into this.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${base}#website`,
        url: base,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
      },
      {
        "@type": "VideoGame",
        "@id": `${base}#game`,
        name: SITE_NAME,
        url: base,
        description: SITE_DESCRIPTION,
        applicationCategory: "Game",
        genre: "Sports",
        operatingSystem: "Web browser",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    ],
  };
  return (
    <section className={`hero ${heroStyles.hero}`}>
      <script
        nonce={nonce}
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
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

      <div className={`container hero__inner reveal ${heroStyles.heroInner}`}>
        <div className={heroStyles.copy}>
          <span className="eyebrow">An independent football drafting game</span>
          <h1 className="display">
            Draft your
            <br />
            all-time <span className="accent">XI.</span>
          </h1>
          <p className="lede hero__sub">
            Spin a random national team and a tournament year. Pick one footballer per spin. Lock
            your formation, build a squad across eight matches, and chase the perfect run.
          </p>

          <div className={`btn-row ${heroStyles.actions}`}>
            <Link href="/play/daily" className="btn btn--primary btn--gold">
              Play today&apos;s draft
            </Link>
            <Link href="/play" className="btn btn--ghost">
              Play Classic
            </Link>
            <Link href="/how-to-play" className="btn btn--ghost">
              How to play
            </Link>
          </div>
          <p className="hero__daily">One shared draft for everyone today. A new one drops daily.</p>

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
            Live now on real football data from 1930–2026. The deterministic draft engine, the match
            simulator, and real scoring all run in your browser.
          </p>
        </div>

        <div className={heroStyles.visual}>
          <HeroSpinDemo />
        </div>
      </div>
    </section>
  );
}
