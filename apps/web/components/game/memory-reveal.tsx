"use client";

// Memory (hidden) mode — the post-Simulate REVEAL.
//
// A thin wrapper around the EXISTING squad surfaces (SynergyBar / Pitch /
// bench / ManagerSlot / rating-by-line) that shows the full blind set —
// OVRs, channels, legend gold, provenance hue, Synergy numerics — once the
// sim has run. It composes the same components the review screen uses (it
// does NOT overload SynergyBar with reveal behavior).
//
// Rendered ONLY for hidden-mode runs on the results screen — classic results
// are untouched. Auto-expands on mount; `prefers-reduced-motion` renders the
// final state instantly with no animation.

import { useEffect, useMemo, useState } from "react";
import { computeSynergy, FORMATION_TEMPLATES } from "@wcdraft/core";
import {
  lineStrengthViews,
  managerCardView,
  managerTournamentFor,
  pitchSlotViews,
  squadAverageOverall,
} from "@/lib/game/adapters";
import type { GameData } from "@/lib/game/data";
import type { RunRecordV1 } from "@/lib/game/run-record";
import { formatNullableNumber } from "@/lib/game/view-models";
import { Pitch } from "./pitch";
import { ManagerSlot } from "./manager-slot";
import { SynergyBar } from "./synergy-bar";
import s from "./game.module.css";

/** Read `prefers-reduced-motion` reactively (client-only). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function MemoryReveal({
  gameData,
  record,
}: {
  gameData: GameData;
  record: RunRecordV1;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const draft = record.draft;
  const formation = FORMATION_TEMPLATES[draft.formation_id]!;

  // Full (unblinded) views — the same adapters the classic surfaces use.
  const { starters, bench } = useMemo(
    () => pitchSlotViews(gameData.indexes, draft),
    [gameData, draft],
  );
  const manager = draft.manager_card_id
    ? managerCardView(gameData.indexes, draft.manager_card_id)
    : null;
  const managerTournament = draft.manager_card_id
    ? managerTournamentFor(gameData.indexes, draft.manager_card_id)
    : null;
  const synergy = useMemo(
    () =>
      computeSynergy(draft.squad, formation, managerTournament, gameData.nationByCardId),
    [draft.squad, formation, managerTournament, gameData.nationByCardId],
  );
  const lineRatings = useMemo(
    () => lineStrengthViews(gameData.indexes, draft),
    [gameData, draft],
  );
  const squadAvg = useMemo(
    () => squadAverageOverall(gameData.indexes, draft),
    [gameData, draft],
  );

  return (
    <section
      className={`${s.panel} ${s.memoryReveal} ${reducedMotion ? s.memoryRevealInstant : ""}`}
      aria-label="Memory mode reveal"
    >
      <div className={s.panelHead}>
        <h2 className={s.panelTitle}>The reveal</h2>
        <span className={s.panelMeta}>
          Memory mode — ratings &amp; Synergy, now on the table
        </span>
      </div>

      <SynergyBar result={synergy} active={true} />

      <div className={s.squadStage}>
        <Pitch
          formationId={draft.formation_id}
          starters={starters}
          linkedPairs={synergy.linked_pairs}
        />
        <ManagerSlot manager={manager} />
      </div>

      <div className={s.bench}>
        <span className={s.benchLabel}>Bench</span>
        <div className={s.benchSlots}>
          {bench.map((b) => (
            <div
              key={b.slot_id}
              className={`${s.benchSlot} ${b.card ? s.benchFilled : ""} ${
                b.card ? s.slotLocked : ""
              }`}
            >
              <span className={s.slotPos}>{b.slot_position}</span>
              <span className={s.slotName}>{b.card ? b.card.name : "Open"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={s.panelHead}>
        <h3 className={s.panelSubTitle}>Rating by line</h3>
        <span className={s.squadAvg}>{formatNullableNumber(squadAvg)} OVR</span>
      </div>
      <div className={s.lineRatings}>
        {lineRatings.map((l) => (
          <div key={l.line} className={s.lineRow}>
            <span className={s.lineName}>{l.label}</span>
            <span className={s.lineTrack}>
              <span className={s.lineFill} style={{ width: `${l.value}%` }} />
            </span>
            <span className={s.lineVal}>{l.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
