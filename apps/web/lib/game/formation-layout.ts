// Visual layout adapter — bridges `/public/brand/formations.json` to the
// core `FORMATION_TEMPLATES` slot ids.
//
// Why this exists: the JSON carries human-friendly display labels (CB, LST,
// RST, …) that DO NOT line up 1:1 with core slot ids (e.g. 4-4-2.LF/RF,
// 3-5-2.LF/RF). The JSON's ORDER does match `template.slots[i]`, so we pair
// by index and key coordinates by the canonical `slot_id`. Components must
// NEVER index this JSON by label text — always by slot id.

import { FORMATION_TEMPLATES } from "@wcdraft/core";

/** The four formations offered in the I2 formation-select gate. */
export const I2_FORMATION_IDS = ["4-3-3", "4-2-3-1", "4-4-2", "3-5-2"] as const;
export type I2FormationId = (typeof I2_FORMATION_IDS)[number];

/** Display category for the SVG block on the formation-select card. */
export type FormationVisualLine = "gk" | "def" | "mid" | "fwd";

export interface FormationVisualSlot {
  /** Canonical `FormationTemplate.slots[i].slot_id`. */
  slot_id: string;
  /** Display label from the brand JSON (NOT used as identity). */
  display_label: string;
  /** Coarse line for shape glyph + colour family on the mini-pitch. */
  visual_line: FormationVisualLine;
  /** 0..100, X coordinate on the pitch. */
  x_pct: number;
  /** 0..100, Y coordinate on the pitch (attack-top: 10..91, GK at 91). */
  y_pct: number;
}

type RawFormationRow = readonly [string, FormationVisualLine, number, number];
type RawFormationsJson = Record<string, ReadonlyArray<RawFormationRow>>;

// The JSON is small (~1KB), a single static import keeps the pitch render
// synchronous and avoids a fetch hop.
import rawFormations from "../../public/brand/formations.json" with { type: "json" };
const FORMATION_ROWS = rawFormations as unknown as RawFormationsJson;

const VISUAL_CACHE = new Map<string, FormationVisualSlot[]>();

/**
 * Returns the visual layout for the given formation, keyed by core slot id.
 * Throws if the formation is not one of the I2 four or if the brand JSON
 * row count drifts from the core template (a hard fail rather than a
 * silent mis-layout).
 */
export function getFormationVisualSlots(formation_id: string): FormationVisualSlot[] {
  const cached = VISUAL_CACHE.get(formation_id);
  if (cached) return cached;

  if (!isI2FormationId(formation_id)) {
    throw new RangeError(
      `getFormationVisualSlots: "${formation_id}" is not one of the I2 formations (4-3-3, 4-2-3-1, 4-4-2, 3-5-2)`,
    );
  }
  const template = FORMATION_TEMPLATES[formation_id];
  if (!template) {
    throw new RangeError(
      `getFormationVisualSlots: core has no FORMATION_TEMPLATES entry for "${formation_id}"`,
    );
  }
  const rows = FORMATION_ROWS[formation_id];
  if (!rows) {
    throw new RangeError(
      `getFormationVisualSlots: /brand/formations.json has no entry for "${formation_id}"`,
    );
  }
  if (rows.length !== template.slots.length) {
    throw new RangeError(
      `getFormationVisualSlots: row-count drift on "${formation_id}" — JSON ${rows.length} vs template ${template.slots.length}`,
    );
  }

  const out: FormationVisualSlot[] = rows.map((row, i) => {
    const [label, visual_line, x_pct, y_pct] = row;
    const slot = template.slots[i]!;
    return { slot_id: slot.slot_id, display_label: label, visual_line, x_pct, y_pct };
  });
  VISUAL_CACHE.set(formation_id, out);
  return out;
}

export function isI2FormationId(id: string): id is I2FormationId {
  return (I2_FORMATION_IDS as readonly string[]).includes(id);
}
