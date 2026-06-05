"use client";

import type { ReactNode } from "react";
import {
  compatTier,
  formatNullableNumber,
  positionShape,
  type PitchSlotView,
} from "@/lib/game/view-models";
import {
  getFormationVisualSlots,
  isI2FormationId,
  type FormationVisualSlot,
} from "@/lib/game/formation-layout";
import s from "./game.module.css";

export interface PitchProps {
  formationId: string;
  starters: PitchSlotView[];
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
  selectedSlotId = null,
  previewCompat = null,
  onSlotSelect,
  interactive = false,
}: PitchProps) {
  // Visual coords come from /brand/formations.json keyed by core slot_id.
  // If we somehow render a non-I2 formation we fall back to a coarse grid
  // rather than crash the page (real I2 entries always pass through).
  const visualSlots = isI2FormationId(formationId)
    ? getFormationVisualSlots(formationId)
    : starters.map((sl, i) => ({
        slot_id: sl.slot_id,
        display_label: sl.slot_position,
        visual_line: FALLBACK_LINE[sl.line]!,
        x_pct: 10 + (i % 5) * 20,
        y_pct: 10 + Math.floor(i / 5) * 20,
      }));
  const visualBySlot = new Map(visualSlots.map((v) => [v.slot_id, v]));

  return (
    <div className={s.pitch} role="group" aria-label="Formation pitch">
      <div className={s.pitchFrame} aria-hidden="true">
        <span className={s.pitchHalfway} />
        <span className={s.pitchCircle} />
        <span className={s.pitchBoxTop} />
        <span className={s.pitchBoxBottom} />
      </div>
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

  const content: ReactNode = filled ? (
    <>
      <span className={s.slotPos}>{slot.slot_position}</span>
      <span className={s.slotName}>{slot.card!.name}</span>
      <span className={s.slotMeta}>
        <span className={s.slotRating}>{formatNullableNumber(slot.card!.rating.overall)}</span>
      </span>
    </>
  ) : (
    <>
      <span className={s.slotPos}>{slot.slot_position}</span>
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
