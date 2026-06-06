// Visual layout adapter — bridges `/public/brand/formations.json` to the
// core `FORMATION_TEMPLATES` slot ids.
//
// Why this exists: the JSON carries human-friendly display labels (CB, LST,
// RST, …) that DO NOT line up 1:1 with core slot ids (e.g. 4-4-2.LF/RF,
// 3-5-2.LF/RF). The JSON's ORDER does match `template.slots[i]`, so we pair
// by index and key coordinates by the canonical `slot_id`. Components must
// NEVER index this JSON by label text — always by slot id.
//
// ── RED TRIPWIRE (ws-squad/formations-polish) ────────────────────────────────
// `SUPPORTED_FORMATION_IDS` is intentionally the SAME set the core ships
// templates for in `packages/core/src/types/formation.ts` (`FORMATION_TEMPLATES`).
// DO NOT add a JSON-only formation id here — `createDraft`, `validateSquad`,
// `computeSynergy`, and the formation-adjacency golden test all index into
// core `FORMATION_TEMPLATES[formation_id]`. A JSON-only id throws at draft
// creation, not at lock, and silently breaks Synergy adjacency.
//
// To add a brand-new formation (e.g. 4-1-2-1-2, 4-4-1-1, 4-5-1, 3-4-2-1,
// 5-4-1): land a Red-class change first that
//   1. extends `FORMATION_TEMPLATES` (+ any new `SLOT_POSITIONS` roles),
//   2. re-locks `formation-adjacency.golden.test.ts`,
//   3. re-locks `position-compatibility.golden.test.ts` if new roles,
//   4. re-locks `synergy.golden.test.ts` (adjacency size changes).
// THEN add the id here and the rows in `/brand/formations.json`.
// ─────────────────────────────────────────────────────────────────────────────

import type { Position } from "@wcdraft/core";
import { FORMATION_TEMPLATES, slotPositionLine } from "@wcdraft/core";

/**
 * Core-supported formation ids exposed in the web's formation-select gate.
 * The order here is the order shown on the card grid (familiar shapes first,
 * 3-back variants next, 5-back last so the visual change is gradual).
 */
export const SUPPORTED_FORMATION_IDS = [
  "4-3-3",
  "4-2-3-1",
  "4-4-2",
  "3-5-2",
  "3-4-3",
  "5-3-2",
] as const;
export type SupportedFormationId = (typeof SUPPORTED_FORMATION_IDS)[number];

/**
 * Description copy shown on each formation-select card. Voice: terse,
 * tactical, one or two declarative sentences. No marketing fluff.
 */
const FORMATION_BLURBS: Record<SupportedFormationId, string> = {
  "4-3-3": "Wide front three, single pivot. Press high, run wide.",
  "4-2-3-1": "Double pivot under a lone striker. Stable middle, late runners.",
  "4-4-2": "Two banks of four, strike pair. Classic, balanced, demanding.",
  "3-5-2": "Back three, wing-backs do the running. Numbers in midfield.",
  "3-4-3": "Back three behind a front three. Width everywhere, brave transitions.",
  "5-3-2": "Back five, midfield three, strike pair. Deep shell, quick counters.",
};

/** One entry per supported formation — drives the formation-select grid. */
export interface FormationOption {
  formation_id: SupportedFormationId;
  blurb: string;
}

export const SUPPORTED_FORMATION_OPTIONS: readonly FormationOption[] =
  SUPPORTED_FORMATION_IDS.map((fid) => ({
    formation_id: fid,
    blurb: FORMATION_BLURBS[fid],
  }));

/** Type guard for runtime widening (string → SupportedFormationId). */
export function isSupportedFormationId(id: string): id is SupportedFormationId {
  return (SUPPORTED_FORMATION_IDS as readonly string[]).includes(id);
}

// ── Back-compat aliases (kept until call-sites are renamed) ──────────────────
// Some callers still import `I2_FORMATION_IDS`/`I2FormationId`/`isI2FormationId`.
// We re-export the new identifiers under the old names so the rename can land
// incrementally without a flag-day. NEW code should import the SUPPORTED_* names.
export const I2_FORMATION_IDS = SUPPORTED_FORMATION_IDS;
export type I2FormationId = SupportedFormationId;
export const isI2FormationId = isSupportedFormationId;

// ── Visual slot ──────────────────────────────────────────────────────────────

/** Display category for the SVG block on the formation-select card. */
export type FormationVisualLine = "gk" | "def" | "mid" | "fwd";

export interface FormationVisualSlot {
  /** Canonical `FormationTemplate.slots[i].slot_id`. */
  slot_id: string;
  /** Display label from the brand JSON (NOT used as identity). */
  display_label: string;
  /**
   * Coarse line for COLOUR/category on the mini-pitch. This is the JSON's
   * presentation hint — e.g. a 3-5-2 wing-back is displayed in the midfield
   * BAND on the visual but is rendered with a DF shape (see `position_line`).
   */
  visual_line: FormationVisualLine;
  /**
   * Coarse position line derived from the CORE slot role, NOT the JSON.
   * Drives the position-by-shape encoding (GK square / DF triangle /
   * MF diamond / FW circle). This is the SHAPE truth.
   */
  position_line: Position;
  /** 0..100, X coordinate on the pitch. */
  x_pct: number;
  /** 0..100, Y coordinate on the pitch (attack-top: 10..91, GK at 91). */
  y_pct: number;
}

type RawFormationRow = readonly [string, FormationVisualLine, number, number];
type RawFormationsJson = Record<string, ReadonlyArray<RawFormationRow>>;

// The JSON is small (~2KB), a single static import keeps the pitch render
// synchronous and avoids a fetch hop.
import rawFormations from "../../public/brand/formations.json" with { type: "json" };
const FORMATION_ROWS = rawFormations as unknown as RawFormationsJson;

const VISUAL_CACHE = new Map<string, FormationVisualSlot[]>();

/**
 * Returns the visual layout for the given formation, keyed by core slot id.
 * Throws if the formation is not one of the supported ids or if the brand
 * JSON row count drifts from the core template (a hard fail rather than a
 * silent mis-layout).
 */
export function getFormationVisualSlots(formation_id: string): FormationVisualSlot[] {
  const cached = VISUAL_CACHE.get(formation_id);
  if (cached) return cached;

  if (!isSupportedFormationId(formation_id)) {
    throw new RangeError(
      `getFormationVisualSlots: "${formation_id}" is not one of the supported formations (${SUPPORTED_FORMATION_IDS.join(", ")})`,
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
    return {
      slot_id: slot.slot_id,
      display_label: label,
      visual_line,
      position_line: slotPositionLine(slot.slot_position),
      x_pct,
      y_pct,
    };
  });
  VISUAL_CACHE.set(formation_id, out);
  return out;
}
