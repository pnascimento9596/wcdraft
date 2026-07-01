"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftMode } from "@wcdraft/core";
import { DRAFT_MODE_COPY } from "@/lib/game/mode-labels";
import { LocalProgressBandFromStorage } from "./local-progress-band";
import s from "./game.module.css";

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
    secondary?: boolean;
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
    title: DRAFT_MODE_COPY.classic.label,
    tag: "Ranked",
    desc: DRAFT_MODE_COPY.classic.description,
    preview: "Choose 1 of 3 · visible ratings",
    chips: ["3-player choice", "Ranked-capable", "Live Synergy"],
    cta: "Start drafting",
    href: "/play/draft",
  },
  open: {
    index: "02",
    title: DRAFT_MODE_COPY.open.label,
    tag: "Casual",
    desc: DRAFT_MODE_COPY.open.description,
    preview: "Full roster · no ranked board",
    chips: ["Full nation roster", "Casual only", "Shareable replay"],
    cta: "Open draft",
    href: "/play/draft?mode=open",
  },
  hidden: {
    index: "03",
    title: DRAFT_MODE_COPY.hidden.label,
    tag: "Blind",
    desc: DRAFT_MODE_COPY.hidden.description,
    preview: "Hidden ratings · post-run reveal",
    chips: ["Ratings hidden", "Choose 1 of 3", "Blind ranked lane"],
    cta: "Draft from memory",
    href: "/play/draft?mode=hidden",
    secondary: true,
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
                item.secondary ? s.modeCardSecondary : "",
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
