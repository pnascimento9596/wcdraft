"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import s from "./game.module.css";

type DraftMode = "classic" | "hidden";

const MODE_COPY: Record<
  DraftMode,
  {
    index: string;
    title: string;
    desc: string;
    preview: string;
    chips: readonly string[];
    cta: string;
    href: string;
  }
> = {
  classic: {
    index: "01",
    title: "Classic",
    desc: "Ratings, positions and stats all on the table — pure drafting skill on every rolled squad.",
    preview: "Visible ratings · live Synergy",
    chips: ["Ratings visible", "Full stat lines", "Live Synergy"],
    cta: "Start drafting",
    href: "/play/draft",
  },
  hidden: {
    index: "02",
    title: "Memory",
    desc: "Names, flags and years stay — ratings don't. Draft on what you remember; all reveals after you simulate.",
    preview: "Hidden ratings · post-run reveal",
    chips: ["Ratings hidden", "Names & years shown", "Same seeds"],
    cta: "Draft from memory",
    href: "/play/draft?mode=hidden",
  },
};

export function ModeSelect() {
  const router = useRouter();
  const [mode, setMode] = useState<DraftMode>("classic");
  const selected = MODE_COPY[mode];

  return (
    <>
      <div className={s.modeGrid} role="radiogroup" aria-label="Draft mode">
        {(Object.keys(MODE_COPY) as DraftMode[]).map((key) => {
          const item = MODE_COPY[key];
          const on = mode === key;
          return (
            <button
              key={key}
              type="button"
              className={`${s.modeCard} ${s.modeCardLive} ${on ? s.modeCardSelected : ""}`}
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
                  Live
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
          Continue with {selected.title} →
        </button>
      </div>
    </>
  );
}
