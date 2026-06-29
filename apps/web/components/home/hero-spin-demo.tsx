"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import s from "./hero-spin-demo.module.css";
import { flagSrcForSample, HERO_SPIN_SAMPLES, type HeroSpinSample } from "./hero-spin-samples";

const HeroSpinLoop = dynamic(() => import("./hero-spin-loop").then((m) => m.HeroSpinLoop), {
  ssr: false,
  loading: () => <HeroSpinPoster sample={HERO_SPIN_SAMPLES[0]!} />,
});

export function HeroSpinDemo() {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <div className={s.demoShell} data-hero-spin-demo>
      {prefersReducedMotion === false ? (
        <HeroSpinLoop />
      ) : (
        <HeroSpinPoster
          sample={HERO_SPIN_SAMPLES[0]!}
          reducedMotion={prefersReducedMotion === true}
        />
      )}
    </div>
  );
}

export function HeroSpinPoster({
  sample,
  reducedMotion = false,
}: {
  sample: HeroSpinSample;
  reducedMotion?: boolean;
}) {
  const flagSrc = flagSrcForSample(sample);
  return (
    <figure
      className={s.poster}
      data-hero-spin-poster
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-label={`Draft preview: ${sample.nationName} ${sample.year}, ${sample.card.fullName} at ${sample.card.position}.`}
    >
      <div className={s.posterTop}>
        <span className={s.posterBadge}>Pick 01</span>
        <span className={s.posterTitle}>Drafted card</span>
      </div>
      <div className={s.posterPitch} aria-hidden="true">
        <div className={s.posterCard}>
          {flagSrc ? (
            <img
              src={flagSrc}
              alt=""
              className={s.posterFlag}
              loading="eager"
              decoding="async"
              draggable={false}
            />
          ) : (
            <span className={s.flagFallback}>{sample.nationCode}</span>
          )}
          <div className={s.posterBody}>
            <h2 className={s.posterName}>{sample.card.name}</h2>
            <p className={s.posterMeta}>
              {sample.nationName} {sample.year} · {sample.card.club}
            </p>
          </div>
          <span className={s.posterPosition}>{sample.card.position}</span>
        </div>
      </div>
    </figure>
  );
}

function usePrefersReducedMotion(): boolean | null {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
}
