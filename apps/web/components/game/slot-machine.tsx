"use client";

// Animated 3-reel slot-machine reveal for the draft flow.
//
// Display-only:
//   - Receives a fully-resolved `SlotRevealModel` from `buildSlotRevealModel`.
//   - The center reel ALWAYS lands on `model.result` (the deterministic engine
//     outcome). Flanking reels are decorative.
//   - All animation is CSS transforms + opacity. No layout thrash, no JS
//     timers, no `Math.random` / `Date.now` / `crypto`.
//   - `@media (prefers-reduced-motion: reduce)` in `game.module.css` snaps to
//     the final transform without spin.
//   - The reel area is `aria-hidden`; the result line below is the
//     announced source of truth.

import type { CSSProperties } from "react";

import s from "./game.module.css";
import type { SlotRevealFace, SlotRevealModel, SlotRevealReel } from "@/lib/game/slot-reveal";

interface ReelStyle extends CSSProperties {
  "--reel-duration": string;
  "--reel-delay": string;
  "--reel-track-len": string;
}

const REEL_TIMING: Record<SlotRevealReel["key"], { duration: string; delay: string }> = {
  left: { duration: "640ms", delay: "0ms" },
  center: { duration: "920ms", delay: "90ms" },
  right: { duration: "780ms", delay: "50ms" },
};

export interface SpinSlotMachineProps {
  readonly model: SlotRevealModel;
  readonly formationId: string;
  readonly playerPoolCount: number;
  /** Engine-real Synergy overall, or `null` when not available. */
  readonly synergyOverall: number | null;
  /** Anchor target for the primary CTA (e.g. `#draft-candidates`). */
  readonly candidateHref: string;
  /** Optional helper subline beneath the result. */
  readonly hint?: string;
}

export function SpinSlotMachine({
  model,
  formationId,
  playerPoolCount,
  synergyOverall,
  candidateHref,
  hint,
}: SpinSlotMachineProps) {
  // Use the result's key as the React key for the whole panel so the CSS
  // animation restarts whenever the active spin changes.
  return (
    <section
      key={model.result.key}
      className={`${s.panel} ${s.spinRevealPanel}`}
      aria-labelledby="spin-reveal-title"
    >
      <div className={s.spinRevealTop}>
        <span className={s.pickCounterBadge}>{model.pickLabel}</span>
        <span id="spin-reveal-title" className={s.spinRevealKicker}>
          Slot reveal
        </span>
      </div>

      <div className={s.slotMachine} aria-hidden="true">
        <span className={s.slotGuideTop} />
        <div className={s.slotReels}>
          {model.reels.map((reel) => (
            <SlotReel key={reel.key} reel={reel} />
          ))}
        </div>
        <span className={s.slotGuideBottom} />
      </div>

      <p className={s.spinResultLine} aria-live="polite">
        {model.resultLine}
      </p>

      {hint ? <p className={s.spinRevealHint}>{hint}</p> : null}

      <div className={s.spinStats} role="group" aria-label="Spin stats">
        <div className={s.spinStatTile}>
          <span className={s.spinStatLabel}>Player pool</span>
          <span className={s.spinStatValue}>{playerPoolCount}</span>
        </div>

        {synergyOverall !== null ? (
          <div className={s.spinStatTile}>
            <span className={s.spinStatLabel}>Synergy</span>
            <span className={s.spinStatValue}>{synergyOverall}</span>
          </div>
        ) : null}

        <div className={`${s.spinStatTile} ${s.formationChip}`}>
          <span className={s.spinStatLabel}>Formation</span>
          <span className={s.spinStatValue}>{formationId}</span>
        </div>
      </div>

      <a href={candidateHref} className={`btn btn--primary ${s.spinRevealCta}`}>
        View player pool →
      </a>
    </section>
  );
}

function SlotReel({ reel }: { reel: SlotRevealReel }) {
  const timing = REEL_TIMING[reel.key];
  const style: ReelStyle = {
    "--reel-duration": timing.duration,
    "--reel-delay": timing.delay,
    "--reel-track-len": String(reel.trackFaces.length),
  };
  const trackClass =
    reel.key === "center"
      ? `${s.slotReelTrack} ${s.slotReelTrackCenter}`
      : s.slotReelTrack;
  return (
    <div
      className={`${s.slotWindow}${reel.key === "center" ? ` ${s.slotWindowCenter}` : ""}`}
    >
      <div className={trackClass} style={style}>
        {reel.trackFaces.map((face, idx) => (
          <SlotFace
            key={`${face.key}:${idx}`}
            face={face}
            isLanding={idx === reel.trackFaces.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function SlotFace({ face, isLanding }: { face: SlotRevealFace; isLanding: boolean }) {
  return (
    <div className={`${s.slotFace}${isLanding ? ` ${s.slotFaceLanding}` : ""}`}>
      {face.flagSrc ? (
        <img
          src={face.flagSrc}
          alt=""
          className={s.slotFaceFlag}
          loading="eager"
          decoding="async"
          draggable={false}
        />
      ) : (
        <span className={s.slotFaceFallback}>
          {face.nationCode ?? face.nationId}
        </span>
      )}
      <div className={s.slotFaceText}>
        <span className={s.slotNation}>{face.nationName}</span>
        <span className={s.slotYear}>{face.yearLabel}</span>
      </div>
    </div>
  );
}
