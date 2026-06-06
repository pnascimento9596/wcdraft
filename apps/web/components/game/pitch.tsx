"use client";

import type { ReactNode } from "react";
import type { LinkedPair } from "@wcdraft/core";
import {
  compatTier,
  formatNullableNumber,
  positionShape,
  type PitchSlotView,
} from "@/lib/game/view-models";
import {
  getFormationVisualSlots,
  isSupportedFormationId,
  type FormationVisualSlot,
} from "@/lib/game/formation-layout";
import s from "./game.module.css";

export interface PitchProps {
  formationId: string;
  starters: PitchSlotView[];
  /**
   * Synergy adjacency edges from `computeSynergy(...).linked_pairs`. Each
   * entry maps 1:1 to a `FormationTemplate.adjacency` edge — never derive
   * lines from formation adjacency directly in the UI, and never invent
   * UI-only links from `PitchSlotView.card`. Omit to render no link layer
   * (back-compat for static callers).
   */
  linkedPairs?: readonly LinkedPair[] | null;
  /** Slot currently selected for assignment (draft screen). */
  selectedSlotId?: string | null;
  /** When placing a card, the compatibility per OPEN slot for badge preview. */
  previewCompat?: Record<string, number> | null;
  onSlotSelect?: (slotId: string) => void;
  /** Static display (review screen) hides interaction affordances. */
  interactive?: boolean;
}

const FALLBACK_LINE: Record<string, FormationVisualSlot["visual_line"]> = {
  GK: "gk",
  DF: "def",
  MF: "mid",
  FW: "fwd",
};

export function Pitch({
  formationId,
  starters,
  linkedPairs = null,
  selectedSlotId = null,
  previewCompat = null,
  onSlotSelect,
  interactive = false,
}: PitchProps) {
  const visualSlots: FormationVisualSlot[] = isSupportedFormationId(formationId)
    ? getFormationVisualSlots(formationId)
    : starters.map((sl, i) => ({
        slot_id: sl.slot_id,
        display_label: sl.slot_position,
        visual_line: FALLBACK_LINE[sl.line]!,
        position_line: sl.line,
        x_pct: 10 + (i % 5) * 20,
        y_pct: 10 + Math.floor(i / 5) * 20,
      }));
  const visualBySlot = new Map(visualSlots.map((v) => [v.slot_id, v]));

  const segments = buildLinkSegments(linkedPairs, visualBySlot);
  const hasLiveLink = segments.some((seg) => seg.linked);

  return (
    <div className={s.pitch} role="group" aria-label="Formation pitch">
      <div className={s.pitchFrame} aria-hidden="true">
        <span className={s.pitchHalfway} />
        <span className={s.pitchCircle} />
        <span className={s.pitchBoxTop} />
        <span className={s.pitchBoxBottom} />
      </div>
      {segments.length > 0 ? (
        <svg
          className={s.pitchSynergyLayer}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {segments
            .filter((seg) => !seg.linked)
            .map((seg) => (
              <line
                key={seg.key}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                className={s.synergyLineIdle}
              />
            ))}
          {segments
            .filter((seg) => seg.linked)
            .map((seg) => (
              <line
                key={seg.key}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                className={s.synergyLineLive}
              />
            ))}
        </svg>
      ) : null}
      {linkedPairs ? (
        <span className={s.pitchSynergyLegend} aria-label="Synergy link legend">
          <span className={s.pitchSynergyLegendDot} aria-hidden="true" />
          Synergy {hasLiveLink ? "live" : "links"}
        </span>
      ) : null}
      {starters.map((slot) => {
        const v = visualBySlot.get(slot.slot_id);
        if (!v) return null;
        return (
          <SlotChip
            key={slot.slot_id}
            slot={slot}
            x={v.x_pct}
            y={v.y_pct}
            selected={slot.slot_id === selectedSlotId}
            previewCompat={previewCompat?.[slot.slot_id]}
            interactive={interactive}
            onSelect={onSlotSelect}
          />
        );
      })}
    </div>
  );
}

interface SynergySegment {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  linked: boolean;
}

function buildLinkSegments(
  pairs: readonly LinkedPair[] | null | undefined,
  visualBySlot: Map<string, FormationVisualSlot>,
): SynergySegment[] {
  if (!pairs || pairs.length === 0) return [];
  const out: SynergySegment[] = [];
  for (const p of pairs) {
    const a = visualBySlot.get(p.slot_id_a);
    const b = visualBySlot.get(p.slot_id_b);
    if (!a || !b) continue;
    out.push({
      key: `${p.slot_id_a}|${p.slot_id_b}`,
      x1: a.x_pct,
      y1: a.y_pct,
      x2: b.x_pct,
      y2: b.y_pct,
      linked: p.linked,
    });
  }
  return out;
}

function SlotChip({
  slot,
  x,
  y,
  selected,
  previewCompat,
  interactive,
  onSelect,
}: {
  slot: PitchSlotView;
  x: number;
  y: number;
  selected: boolean;
  previewCompat: number | undefined;
  interactive: boolean;
  onSelect?: (slotId: string) => void;
}) {
  const filled = !!slot.card;
  const tier = filled ? compatTier(slot.position_compatibility) : null;
  const previewTier = previewCompat != null ? compatTier(previewCompat) : null;
  const shape = positionShape(slot.line);

  const classes = [s.slot, s[`slotShape_${shape}`]!];
  if (filled) classes.push(s.slotFilled, s.slotLocked);
  else classes.push(s.slotEmpty);
  if (selected) classes.push(s.slotSelected);
  if (tier) classes.push(s[`tier_${tier}`]!);
  if (previewTier) classes.push(s.slotPreview, s[`tierPreview_${previewTier}`]!);

  const label = filled
    ? `${slot.slot_position} — ${slot.card!.name} (locked)`
    : `${slot.slot_position} — empty slot`;

  const shapeMarker = (
    <span
      className={`${s.slotShapeMarker} ${s[`slotShapeMarker_${shape}`]!}`}
      aria-hidden="true"
    />
  );

  const content: ReactNode = filled ? (
    <>
      <span className={s.slotHead}>
        {shapeMarker}
        <span className={s.slotPos}>{slot.slot_position}</span>
      </span>
      <span className={s.slotName}>{slot.card!.name}</span>
      <span className={s.slotMeta}>
        <span className={s.slotRating}>{formatNullableNumber(slot.card!.rating.overall)}</span>
      </span>
    </>
  ) : (
    <>
      <span className={s.slotHead}>
        {shapeMarker}
        <span className={s.slotPos}>{slot.slot_position}</span>
      </span>
      <span className={s.slotEmptyLabel}>
        {previewCompat != null ? `${Math.round(previewCompat * 100)}%` : "Empty"}
      </span>
    </>
  );

  const style = { left: `${x}%`, top: `${y}%` } as const;

  if (!interactive || filled) {
    return (
      <div className={classes.join(" ")} aria-label={label} style={style}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={classes.join(" ")}
      aria-pressed={selected}
      aria-label={label}
      onClick={() => onSelect?.(slot.slot_id)}
      style={style}
    >
      {content}
    </button>
  );
}
