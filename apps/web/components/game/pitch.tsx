"use client";

import type { ReactNode } from "react";
import type { Position } from "@wcdraft/core";
import type { PitchSlot } from "@/lib/mock";
import { compatTier } from "@/lib/mock";
import s from "./game.module.css";

/** Lines top → bottom on the rendered pitch (attack at the top). */
const LINE_ORDER: Position[] = ["FW", "MF", "DF", "GK"];
const CHANNEL_ORDER = { L: 0, C: 1, R: 2 } as const;

export interface PitchProps {
  starters: PitchSlot[];
  /** Slot currently selected for assignment (draft screen). */
  selectedSlotId?: string | null;
  /** Slots locked from earlier spins — cannot be reselected. */
  lockedSlotIds?: readonly string[];
  /** When placing a card, the compatibility per OPEN slot for badge preview. */
  previewCompat?: Record<string, number> | null;
  onSlotSelect?: (slotId: string) => void;
  /** Static display (review screen) hides interaction affordances. */
  interactive?: boolean;
}

export function Pitch({
  starters,
  selectedSlotId = null,
  lockedSlotIds = [],
  previewCompat = null,
  onSlotSelect,
  interactive = false,
}: PitchProps) {
  const byLine = LINE_ORDER.map((line) => ({
    line,
    slots: starters
      .filter((sl) => sl.line === line)
      .sort((a, b) => CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel]),
  })).filter((row) => row.slots.length > 0);

  return (
    <div className={s.pitch} role="group" aria-label="Formation pitch">
      <div className={s.pitchLines} aria-hidden="true">
        <span className={s.pitchHalfway} />
        <span className={s.pitchCircle} />
        <span className={s.pitchBoxTop} />
        <span className={s.pitchBoxBottom} />
      </div>
      {byLine.map((row) => (
        <div key={row.line} className={s.pitchRow}>
          {row.slots.map((slot) => (
            <SlotChip
              key={slot.slot_id}
              slot={slot}
              selected={slot.slot_id === selectedSlotId}
              locked={lockedSlotIds.includes(slot.slot_id)}
              previewCompat={previewCompat?.[slot.slot_id]}
              interactive={interactive}
              onSelect={onSlotSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SlotChip({
  slot,
  selected,
  locked,
  previewCompat,
  interactive,
  onSelect,
}: {
  slot: PitchSlot;
  selected: boolean;
  locked: boolean;
  previewCompat: number | undefined;
  interactive: boolean;
  onSelect?: (slotId: string) => void;
}) {
  const filled = !!slot.card;
  const tier = filled ? compatTier(slot.position_compatibility) : null;
  const previewTier = previewCompat != null ? compatTier(previewCompat) : null;

  const classes = [s.slot];
  if (filled) classes.push(s.slotFilled);
  else classes.push(s.slotEmpty);
  if (selected) classes.push(s.slotSelected);
  if (locked) classes.push(s.slotLocked);
  if (tier) classes.push(s[`tier_${tier}`]!);
  if (previewTier) classes.push(s.slotPreview, s[`tierPreview_${previewTier}`]!);

  const label = filled
    ? `${slot.slot_position} — ${slot.card!.name}${locked ? " (locked)" : ""}`
    : `${slot.slot_position} — empty slot`;

  const content: ReactNode = filled ? (
    <>
      <span className={s.slotPos}>{slot.slot_position}</span>
      <span className={s.slotName}>{slot.card!.name}</span>
      <span className={s.slotMeta}>
        <span className={s.slotRating}>{slot.card!.rating.overall ?? "—"}</span>
        {locked && (
          <span className={s.lockGlyph} aria-hidden="true">
            🔒
          </span>
        )}
      </span>
      {slot.warnings.length > 0 && <span className={s.slotWarn} aria-hidden="true" />}
    </>
  ) : (
    <>
      <span className={s.slotPos}>{slot.slot_position}</span>
      <span className={s.slotEmptyLabel}>
        {previewCompat != null ? `${Math.round(previewCompat * 100)}%` : "Empty"}
      </span>
    </>
  );

  if (!interactive) {
    return (
      <div className={classes.join(" ")} aria-label={label}>
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
      disabled={locked}
      onClick={() => onSelect?.(slot.slot_id)}
    >
      {content}
    </button>
  );
}
