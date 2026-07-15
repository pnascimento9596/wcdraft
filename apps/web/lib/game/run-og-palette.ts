import { RUN_SURFACE_PALETTE, rgba } from "./run-palette";

const T = RUN_SURFACE_PALETTE.dark;

export const RUN_OG_PALETTE = {
  pageBg: T.bg,
  text: T.fieldInk,
  textStrong: T.inkStrong,
  muted: T.inkSoft,
  mutedTeal: T.inkFaint,
  aqua: T.accent,
  aquaLine: rgba(T.accent, 0.38),
  aquaSoftLine: rgba(T.accent, 0.28),
  aquaWash: rgba(T.accent, 0.07),
  fieldLine: rgba(T.accent, 0.45),
  fieldLineSoft: rgba(T.accent, 0.24),
  fieldMidline: rgba(T.accent, 0.26),
  gold: T.gold,
  goldSoft: T.gold,
  goldLine: rgba(T.gold, 0.48),
  goldWash: rgba(T.gold, 0.08),
  pitch: T.field,
  panel: rgba(T.bgPanel, 0.9),
  chip: rgba(T.bgSunken, 0.86),
  frameLine: rgba(T.ink, 0.22),
  chipLine: rgba(T.ink, 0.28),
  provenance: T.provenance,
  washGradient: `linear-gradient(135deg, ${rgba(T.accent, 0.22)}, ${rgba(T.bg, 0.18)} 36%, ${rgba(T.gold, 0.18)})`,
} as const;
