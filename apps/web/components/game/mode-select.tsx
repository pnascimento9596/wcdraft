"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LocalProgressBandFromStorage } from "./local-progress-band";
import s from "./game.module.css";

type DraftMode = "classic" | "hidden";
type PlayMode = "daily" | DraftMode;

const MODE_COPY: Record<
  PlayMode,
  {
    index: string;
    title: string;
    tag: string;
    desc: string;
    preview: string;
    chips: readonly string[];
    cta: string;
    href: string;
    featured?: boolean;
  }
> = {
  daily: {
    index: "00",
    title: "Today's Draft",
    tag: "Daily",
    desc: "One shared draft for everyone today — a new one drops daily at 00:00 UTC.",
    preview: "Shared seed · daily board",
    chips: ["Same draft for everyone", "Beat today's field"],
    cta: "Play daily",
    href: "/play/daily",
    featured: true,
  },
  classic: {
    index: "01",
    title: "Classic",
    tag: "Live",
    desc: "Ratings, positions and stats all on the table — pure drafting skill on every rolled squad.",
    preview: "Visible ratings · live Synergy",
    chips: ["Ratings visible", "Full stat lines", "Live Synergy"],
    cta: "Start drafting",
    href: "/play/draft",
  },
  hidden: {
    index: "02",
    title: "Memory",
    tag: "Live",
    desc: "Names, flags and years stay — ratings don't. Draft on what you remember; all reveals after you simulate.",
    preview: "Hidden ratings · post-run reveal",
    chips: ["Ratings hidden", "Names & years shown", "Same seeds"],
    cta: "Draft from memory",
    href: "/play/draft?mode=hidden",
  },
};

export function ModeSelect() {
  const router = useRouter();
  const [mode, setMode] = useState<PlayMode>("daily");
  const selected = MODE_COPY[mode];

  return (
    <>
      <LocalProgressBandFromStorage compact />
      <div className={`${s.modeGrid} ${s.modeGridDaily}`} role="radiogroup" aria-label="Draft mode">
        {(Object.keys(MODE_COPY) as PlayMode[]).map((key) => {
          const item = MODE_COPY[key];
          const on = mode === key;
          return (
            <button
              key={key}
              type="button"
              className={[
                s.modeCard,
                s.modeCardLive,
                item.featured ? s.modeCardFeatured : "",
                on ? s.modeCardSelected : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="radio"
              aria-checked={on}
              onClick={() => setMode(key)}
            >
              <span className={s.modeIndex} aria-hidden="true">
                {item.index}
              </span>
              <span className={s.modeCardTop}>
                <span className={s.modeTag}>
                  <span className={s.modeTagDot} aria-hidden="true" />
                  {item.tag}
                </span>
                <span className={s.modeName}>{item.title}</span>
              </span>
              <span className={s.modeDesc}>{item.desc}</span>
              <span className={s.modePreview}>{item.preview}</span>
              <span className={s.modeFeatures}>
                {item.chips.map((chip) => (
                  <span key={chip} className={s.modeFeatureChip}>
                    <span className={s.modeFeatureDot} aria-hidden="true" />
                    {chip}
                  </span>
                ))}
              </span>
              <span className={s.modeCardBottom}>
                <span className={s.modeCta}>{item.cta} →</span>
                {on ? <span className={s.modeSelectedText}>Selected</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className={s.modeDock}>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => router.push(selected.href)}
        >
          {selected.featured ? selected.cta : `Continue with ${selected.title}`} →
        </button>
      </div>
    </>
  );
}
