"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Spin } from "@wcdraft/core";

import type { GameDataIndexes } from "@/lib/game/data";
import {
  buildSlotRevealModel,
  type SlotRevealFace,
  type SlotRevealReel,
} from "@/lib/game/slot-reveal";

import s from "./hero-spin-demo.module.css";
import { flagSrcForSample, HERO_SPIN_SAMPLES, type HeroSpinSample } from "./hero-spin-samples";

type DemoPhase = "settled" | "spinning";

const TOTAL_PICKS = 17;
const FACE_H = 58;
const REEL_H = 104;
const CENTER_OFFSET = (REEL_H - FACE_H) / 2;
const START_INDEX = 1;

const REEL_TIMING: Record<SlotRevealReel["key"], { dur: string; delay: string }> = {
  left: { dur: "1.8s", delay: "0s" },
  right: { dur: "2.1s", delay: "0.06s" },
  center: { dur: "2.5s", delay: "0.12s" },
};

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

const SAMPLE_SPINS: readonly Spin[] = HERO_SPIN_SAMPLES.map((sample, index) => ({
  index,
  tournament_id: sample.tournamentId,
  nation_id: sample.nationId,
  rare: sample.year < 1998,
  draw_probability: sample.drawProbability,
  rolled_card_ids: [sample.card.cardId as Spin["rolled_card_ids"][number]],
  excluded_player_ids: [],
  rolled_manager_card_id: null,
  picked_kind: "player",
  picked_card_id: null,
  picked_player_id: null,
  assigned_slot_id: null,
  picked_manager_card_id: null,
  target_slot_id: null,
  status: "pending",
}));

const SAMPLE_INDEXES: GameDataIndexes = {
  playerByCardId: new Map(),
  managerByCardId: new Map(),
  ratingByCardId: new Map(),
  nationById: new Map(
    HERO_SPIN_SAMPLES.map((sample) => [
      sample.nationId,
      { canonical_name: sample.nationName, code: sample.nationCode },
    ]),
  ),
  tournamentById: new Map(
    HERO_SPIN_SAMPLES.map((sample) => [
      sample.tournamentId,
      { year: sample.year, name: String(sample.year) },
    ]),
  ),
  displayNameByCardId: new Map(),
};

export function HeroSpinLoop() {
  const [sampleIndex, setSampleIndex] = useState(0);
  const [phase, setPhase] = useState<DemoPhase>("settled");
  const sample = HERO_SPIN_SAMPLES[sampleIndex]!;

  const model = useMemo(
    () =>
      buildSlotRevealModel({
        activeSpin: SAMPLE_SPINS[sampleIndex]!,
        allSpins: SAMPLE_SPINS,
        indexes: SAMPLE_INDEXES,
        totalPicks: TOTAL_PICKS,
      }),
    [sampleIndex],
  );

  useEffect(() => {
    const spinTimer = window.setTimeout(() => setPhase("spinning"), 900);
    const settleTimer = window.setTimeout(() => setPhase("settled"), 3650);
    const advanceTimer = window.setTimeout(() => {
      setSampleIndex((current) => (current + 1) % HERO_SPIN_SAMPLES.length);
      setPhase("settled");
    }, 5400);

    return () => {
      window.clearTimeout(spinTimer);
      window.clearTimeout(settleTimer);
      window.clearTimeout(advanceTimer);
    };
  }, [sampleIndex]);

  const pickNum = String(sampleIndex + 1).padStart(2, "0");
  const drumVars: DrumVars = {
    "--reel-h": `${REEL_H}px`,
    "--face-h": `${FACE_H}px`,
  };

  return (
    <figure
      className={s.demo}
      data-hero-spin-loop
      data-spin-state={phase}
      aria-label={`Looping draft preview: the spin lands on ${sample.nationName} ${sample.year}, then reveals ${sample.card.fullName} at ${sample.card.position}.`}
    >
      <div className={s.statusBar}>
        <span className={s.pickBadge}>Pick {pickNum}</span>
        <span className={s.statusTitle}>Spin reveal</span>
      </div>

      <div className={s.drum} style={drumVars} aria-hidden="true">
        {model.reels.map((reel) => (
          <SpinReel key={`${sample.id}:${reel.key}:${phase}`} reel={reel} phase={phase} />
        ))}
      </div>

      <div className={s.resultRow}>
        <div className={s.resultCopy}>
          <span className={s.eyebrow}>{phase === "spinning" ? "Rolling" : "Spin result"}</span>
          <h2 className={s.resultName}>
            {model.result.nationName} {model.result.yearLabel}
          </h2>
          <p className={s.resultMeta}>
            {phase === "spinning"
              ? "Nation and year locking in."
              : `${sample.card.name} revealed · ${sample.card.club}`}
          </p>
        </div>
        <RevealedCard sample={sample} />
      </div>
    </figure>
  );
}

function SpinReel({ reel, phase }: { reel: SlotRevealReel; phase: DemoPhase }) {
  const strip = useMemo(() => buildSpinStrip(reel), [reel]);
  const isCenter = reel.key === "center";
  const windowClass = `${s.reelWindow} ${isCenter ? s.reelWindowCenter : s.reelWindowSide}`;

  if (phase === "spinning") {
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
        <div className={`${s.reelTrack} ${s.reelTrackSpinning}`} style={style}>
          {strip.map((face, i) => (
            <SpinFace key={`${face.key}:${i}`} face={face} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={windowClass}>
      <div className={s.reelTrack} style={{ transform: `translateY(${CENTER_OFFSET}px)` }}>
        <SpinFace face={reel.landingFace} />
      </div>
    </div>
  );
}

function SpinFace({ face }: { face: SlotRevealFace }) {
  return (
    <div className={s.face}>
      {face.flagSrc ? (
        <img
          src={face.flagSrc}
          alt=""
          className={s.faceFlag}
          loading="eager"
          decoding="async"
          draggable={false}
        />
      ) : (
        <span className={s.flagFallback}>{face.nationCode ?? face.nationId}</span>
      )}
      <span className={s.faceNation}>{face.nationName}</span>
      <span className={s.faceYear}>{face.yearLabel}</span>
    </div>
  );
}

function RevealedCard({ sample }: { sample: HeroSpinSample }) {
  const flagSrc = flagSrcForSample(sample);
  return (
    <div className={s.card} aria-hidden="true">
      {flagSrc ? (
        <img
          src={flagSrc}
          alt=""
          className={s.faceFlag}
          loading="eager"
          decoding="async"
          draggable={false}
        />
      ) : null}
      <span className={s.position}>{sample.card.position}</span>
      <span className={s.cardLabel}>{sample.nationCode}</span>
      <span className={s.cardOvr}>{sample.card.overall} OVR</span>
    </div>
  );
}

function buildSpinStrip(reel: SlotRevealReel): readonly SlotRevealFace[] {
  const decorative = reel.trackFaces.slice(0, -1);
  return [...decorative, ...decorative, reel.landingFace];
}
