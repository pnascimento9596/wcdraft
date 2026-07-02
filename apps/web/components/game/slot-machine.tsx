"use client";

// Standalone SPIN REVEAL stage — the centerpiece of the mobile draft flow.
//
// Display-only & deterministic:
//   - Receives a fully-resolved `SlotRevealModel` from `buildSlotRevealModel`.
//     The center reel ALWAYS lands on `model.result` (the engine outcome).
//     Flanking reels are decorative (real neighbour spins, never invented).
//   - The 2–3s spin animation is PRESENTATION ONLY. It injects NO randomness:
//     the visual strip simply repeats the deterministic neighbour faces and
//     ALWAYS ends on the predetermined landing face.
//   - `anim` is owned by the parent (`DraftBoard`). The parent drives the
//     idle → spinning → settled lifecycle and decides, per the user's
//     `prefers-reduced-motion`, whether to skip straight to `settled`.
//   - The reel area is `aria-hidden`; the SPIN RESULT line is the announced
//     source of truth.
//
// Tokens: emerald is `var(--ember)`, gold is `var(--gold)` — never re-hardcode
// the brand hexes. Naming is "Synergy" (never "Chemistry").

import { useMemo } from "react";
import type { CSSProperties } from "react";

import s from "./game.module.css";
import type { SlotRevealFace, SlotRevealModel, SlotRevealReel } from "@/lib/game/slot-reveal";

export type SpinAnimState = "idle" | "spinning" | "settled";

// Drum geometry — shared between the JS translate math and the CSS via inline
// custom properties so the two never drift.
const FACE_H = 84;
const REEL_H = 148;
const CENTER_OFFSET = (REEL_H - FACE_H) / 2;
const START_INDEX = 1;

interface ReelTiming {
  readonly dur: string;
  readonly delay: string;
}

// Classic slot cadence: reels stop left → right → CENTER last (the reveal).
// Center finishes at ~2.5s + delay, comfortably inside the 2–3s window and the
// signal we settle on.
const REEL_TIMING: Record<SlotRevealReel["key"], ReelTiming> = {
  left: { dur: "1.8s", delay: "0s" },
  right: { dur: "2.1s", delay: "0.06s" },
  center: { dur: "2.5s", delay: "0.12s" },
};
const LAST_SHIPPED_TOURNAMENT_YEAR = 2026;
const SPIN_ERA_RANGE_SPAN_YEARS = 11;

interface DrumVars extends CSSProperties {
  "--reel-h": string;
  "--face-h": string;
}

interface SpinVars extends CSSProperties {
  "--spin-from": string;
  "--spin-to": string;
  "--spin-dur": string;
  "--spin-delay": string;
}

/** Lengthen the deterministic track into a longer visual scroll strip. The
 *  decorative head is repeated; the strip ALWAYS ends on the landing face. */
function buildSpinStrip(reel: SlotRevealReel): readonly SlotRevealFace[] {
  const deco = reel.trackFaces.slice(0, -1);
  return [...deco, ...deco, reel.landingFace];
}

export interface SpinStageProps {
  readonly model: SlotRevealModel;
  readonly pickNumber: number;
  readonly totalPicks: number;
  readonly formationId: string;
  readonly modeLabel: string;
  readonly modeCue: string;
  readonly pickSpace: string;
  /** Engine-real running squad Synergy overall, or null when unavailable. */
  readonly synergyOverall: number | null;
  /** Engine-real bounded strength multiplier, or null when unavailable. */
  readonly synergyMultiplier: number | null;
  /** REAL candidate count for this spin. */
  readonly playerPoolCount: number;
  readonly anim: SpinAnimState;
  readonly onSpin: () => void;
  readonly onSettle: () => void;
  readonly onSkip: () => void;
  readonly onReveal: () => void;
  readonly canSkip: boolean;
  readonly showSkipHint: boolean;
}

export function SpinStage({
  model,
  pickNumber,
  totalPicks,
  formationId,
  modeLabel,
  modeCue,
  pickSpace,
  synergyOverall,
  synergyMultiplier,
  playerPoolCount,
  anim,
  onSpin,
  onSettle,
  onSkip,
  onReveal,
  canSkip,
  showSkipHint,
}: SpinStageProps) {
  const [left, center, right] = model.reels;
  const settled = anim === "settled";
  const spinning = anim === "spinning";

  const result = model.result;
  // ENGINE-V2 E-2: rare flag comes from the engine spin via the slot-reveal
  // model — NOT recomputed from `year`. The `year` prop still drives the era
  // label below, but rarity is authoritative engine truth.
  const isRare = model.rare;
  const drawProbabilityLabel = model.drawProbabilityLabel;
  const pickNum = String(pickNumber).padStart(2, "0");
  const eraValue = spinEraRangeLabel(result.yearLabel);

  const tagline = settled
    ? `${result.nationName} ${result.yearLabel} is on the board — ${pickSpace.toLowerCase()} available.`
    : spinning
      ? "Rolling the drum…"
      : "Press spin to lock in a nation and World Cup year.";

  const ctaLabel = settled ? "Reveal choices →" : spinning ? "Spinning…" : "Spin";
  const onCta = settled ? onReveal : spinning ? undefined : onSpin;
  const skipActive = spinning && canSkip;

  const drumVars: DrumVars = {
    "--reel-h": `${REEL_H}px`,
    "--face-h": `${FACE_H}px`,
  };

  return (
    <section
      className={`${s.spinStage} ${settled && isRare ? s.spinRare : ""}`}
      aria-labelledby="spin-stage-title"
      tabIndex={skipActive ? 0 : undefined}
      onClick={skipActive ? onSkip : undefined}
      onKeyDown={(event) => {
        if (!skipActive) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSkip();
      }}
      data-skip-active={skipActive ? "true" : undefined}
    >
      {/* ── Status bar ───────────────────────────────────────────────── */}
      <div className={s.spinStatusBar}>
        <div className={s.spinPickBadge} aria-label={`Pick ${pickNumber} of ${totalPicks}`}>
          <span className={s.spinPickKicker}>Pick</span>
          <span className={s.spinPickNum}>{pickNum}</span>
          <span className={s.spinPickOf}>of {totalPicks}</span>
        </div>

        <span id="spin-stage-title" className={s.spinStatusTitle}>
          Spin reveal
        </span>

        <div className={s.spinStatusMeta}>
          <span className={s.spinStatusChip}>
            <span className={s.spinStatusChipLabel}>Mode</span>
            <span className={s.spinStatusChipValue}>
              {modeLabel} · {modeCue}
            </span>
          </span>
          <span className={s.spinStatusChip}>
            <span className={s.spinStatusChipLabel}>Formation</span>
            <span className={s.spinStatusChipValue}>{formationId}</span>
          </span>
          <span className={s.spinStatusChip}>
            <span className={s.spinStatusChipLabel}>Synergy</span>
            <span className={s.spinStatusChipValue}>
              {/* Display rounding only — the engine value stays fractional. */}
              {synergyOverall !== null ? Math.round(synergyOverall) : "—"}
            </span>
          </span>
        </div>
      </div>

      {/* ── Drum ─────────────────────────────────────────────────────── */}
      <span
        className={`${s.spinDrumLabel} ${showSkipHint && spinning ? s.spinDrumLabelWithHint : ""}`}
      >
        Spinning nation + era
        {showSkipHint && spinning ? <span className={s.spinSkipHint}>tap to skip</span> : null}
      </span>

      <div className={s.spinDrum} style={drumVars} aria-hidden="true">
        <span className={s.spinChevronTop} />
        <span className={s.spinPayline} />
        <div className={s.spinReels}>
          <SpinReel reel={left} anim={anim} />
          <SpinReel reel={center} anim={anim} onSettle={onSettle} />
          <SpinReel reel={right} anim={anim} />
        </div>
        <span className={s.spinChevronBottom} />
        <span className={s.spinShadeTop} />
        <span className={s.spinShadeBottom} />
      </div>

      {/* ── Result ───────────────────────────────────────────────────── */}
      <div className={s.spinResultBlock} aria-live="polite" aria-atomic="true">
        <span className={s.spinResultEyebrow}>Spin result</span>
        <h2 className={s.spinResultName}>
          {settled ? (
            <>
              <span className={s.spinResultNation}>{result.nationName}</span>{" "}
              <span className={s.spinResultYear}>{result.yearLabel}</span>
            </>
          ) : (
            <span className={s.spinResultPending}>{spinning ? "Spinning…" : "Ready to spin"}</span>
          )}
        </h2>
        <p className={s.spinResultTag}>{tagline}</p>
        {settled && isRare ? (
          <p className="visually-hidden">Rare pick. Draw probability {drawProbabilityLabel}.</p>
        ) : null}
      </div>

      {/* ── ENGINE-V2 E-2 — Rare-pick moment (additive) ──────────────── */}
      {settled && isRare ? (
        <div className={s.rareMoment} aria-hidden="true">
          <span className={s.rareMomentTitle}>RARE PICK!</span>
          <span className={s.rareMomentProbability}>Draw probability: {drawProbabilityLabel}</span>
        </div>
      ) : null}

      {/* ── Stat tiles ───────────────────────────────────────────────── */}
      <div className={s.spinTiles} role="group" aria-label="Spin details">
        <div className={`${s.spinTile} ${settled && isRare ? s.spinTileRare : ""}`}>
          <span className={s.spinTileLabel}>Era</span>
          <span className={s.spinTileValue}>{settled ? eraValue : "—"}</span>
        </div>
        <div className={s.spinTile}>
          <span className={s.spinTileLabel}>Choices</span>
          <span className={s.spinTileValue}>{settled ? playerPoolCount : "—"}</span>
        </div>
        <div className={s.spinTile}>
          <span className={s.spinTileLabel}>Strength</span>
          <span className={s.spinTileValue}>
            {settled && synergyMultiplier !== null ? `${synergyMultiplier.toFixed(2)}×` : "—"}
          </span>
        </div>
      </div>

      {/* ── CTA ──────────────────────────────────────────────────────── */}
      <button
        type="button"
        className={`btn btn--primary ${s.spinCta}`}
        onClick={onCta}
        disabled={spinning}
        aria-busy={spinning}
      >
        {ctaLabel}
      </button>
    </section>
  );
}

export function spinEraRangeLabel(yearLabel: string): string {
  if (!/^\d{4}$/u.test(yearLabel)) return `ERA ${yearLabel}`;
  const year = Number.parseInt(yearLabel, 10);
  const endYear = Math.min(year + SPIN_ERA_RANGE_SPAN_YEARS, LAST_SHIPPED_TOURNAMENT_YEAR);
  if (endYear <= year) return `ERA ${year.toString()}`;
  return `ERA ${year.toString()}–${String(endYear).slice(-2)}`;
}

export function skipSpinAnimState(anim: SpinAnimState, canSkip: boolean): SpinAnimState {
  return canSkip && anim === "spinning" ? "settled" : anim;
}

function SpinReel({
  reel,
  anim,
  onSettle,
}: {
  reel: SlotRevealReel;
  anim: SpinAnimState;
  onSettle?: () => void;
}) {
  const isCenter = reel.key === "center";
  const strip = useMemo(() => buildSpinStrip(reel), [reel]);
  const windowClass = `${s.spinReelWindow} ${
    isCenter ? s.spinReelWindowCenter : s.spinReelWindowSide
  }`;

  if (anim === "spinning") {
    const timing = REEL_TIMING[reel.key];
    const startOffset = CENTER_OFFSET - START_INDEX * FACE_H;
    const endOffset = CENTER_OFFSET - (strip.length - 1) * FACE_H;
    const style: SpinVars = {
      "--spin-from": `${startOffset}px`,
      "--spin-to": `${endOffset}px`,
      "--spin-dur": timing.dur,
      "--spin-delay": timing.delay,
    };
    return (
      <div className={windowClass}>
        <div
          className={`${s.spinReelTrack} ${s.spinReelTrackSpinning}`}
          style={style}
          onAnimationEnd={isCenter ? onSettle : undefined}
        >
          {strip.map((face, i) => (
            <SpinFace key={`${face.key}:${i}`} face={face} />
          ))}
        </div>
      </div>
    );
  }

  // idle | settled → a single face parked on the payline.
  return (
    <div className={windowClass}>
      <div className={s.spinReelTrack} style={{ transform: `translateY(${CENTER_OFFSET}px)` }}>
        {anim === "settled" ? (
          <SpinFace face={reel.landingFace} settled={isCenter} />
        ) : (
          <SpinFaceIdle center={isCenter} />
        )}
      </div>
    </div>
  );
}

function SpinFace({ face, settled = false }: { face: SlotRevealFace; settled?: boolean }) {
  return (
    <div className={`${s.spinFace} ${settled ? s.spinFaceSettled : ""}`}>
      {face.flagSrc ? (
        <img
          src={face.flagSrc}
          alt={face.flagLabel}
          title={face.flagLabel}
          className={s.spinFaceFlag}
          loading="eager"
          decoding="async"
          draggable={false}
        />
      ) : (
        <span className={s.spinFaceFlagFallback} aria-label={face.flagLabel} title={face.flagLabel}>
          {face.nationCode ?? face.nationId}
        </span>
      )}
      <span className={s.spinFaceNation}>{face.nationName}</span>
      <span className={s.spinFaceYear}>{face.yearLabel}</span>
    </div>
  );
}

function SpinFaceIdle({ center }: { center: boolean }) {
  return (
    <div className={`${s.spinFace} ${s.spinFaceIdle}`}>
      <span className={s.spinFaceGlyph}>{center ? "?" : "·"}</span>
      {center ? <span className={s.spinFaceNation}>Ready</span> : null}
    </div>
  );
}
