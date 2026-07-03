import type { DraftMode } from "@wcdraft/core";

export interface DraftModeCopy {
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly cue: string;
  readonly pickSpace: string;
}

export const DRAFT_MODE_COPY: Readonly<Record<DraftMode, DraftModeCopy>> = Object.freeze({
  classic: Object.freeze({
    label: "Classic",
    shortLabel: "Classic",
    description: "Each spin offers up to 3 players from the drawn nation. Pick one.",
    cue: "Ranked-capable",
    pickSpace: "3-player choice",
  }),
  open: Object.freeze({
    label: "Open Draft",
    shortLabel: "Open",
    description: "Each spin draws a nation. Pick any available player from its full roster.",
    cue: "Casual, not ranked",
    pickSpace: "Full roster",
  }),
  open_hidden: Object.freeze({
    label: "Blind Open",
    shortLabel: "Blind Open",
    description: "Pick any player from the drawn nation, ratings hidden. Casual, not ranked.",
    cue: "Casual",
    pickSpace: "Full blind roster",
  }),
  hidden: Object.freeze({
    label: "Memory",
    shortLabel: "Memory",
    description: "Ratings and Synergy numbers stay hidden until the reveal.",
    cue: "Ranked-capable",
    pickSpace: "3-player choice",
  }),
});

export function draftModeLabel(mode: DraftMode): string {
  return DRAFT_MODE_COPY[mode].label;
}

export function draftModeShortLabel(mode: DraftMode): string {
  return DRAFT_MODE_COPY[mode].shortLabel;
}

export function draftModeCue(mode: DraftMode): string {
  return DRAFT_MODE_COPY[mode].cue;
}
