import type { RatingBadgeKind } from "./view-models";

type ShareSvgColorKey =
  | "bgStart"
  | "bgEnd"
  | "accentStart"
  | "accentEnd"
  | "goldStart"
  | "goldMid"
  | "goldEnd"
  | "text"
  | "muted";

export type ShareSvgColors = Record<ShareSvgColorKey, string>;

export const RUN_SURFACE_PALETTE = {
  dark: {
    bg: "#080809",
    bgPanel: "#161618",
    bgSunken: "#060608",
    field: "#1f6a47",
    fieldInk: "#f2ecdc",
    ink: "#edecf2",
    inkStrong: "#ffffff",
    inkSoft: "#9695a8",
    inkFaint: "#828195",
    accent: "#2ecf92",
    accentStrong: "#26b681",
    accentInk: "#06130d",
    gold: "#f5b62a",
    goldStrong: "#caa022",
    provenance: {
      historical: "#35c2d6",
      projected: "#94a1f2",
      estimate: "#f0913f",
      legend: "#f5b62a",
      masked: "#717c75",
    } satisfies Record<RatingBadgeKind, string>,
  },
} as const;

export const SHARE_SVG_COLOR_TOKENS: Record<ShareSvgColorKey, string> = {
  bgStart: "--field",
  bgEnd: "--accent-ink",
  accentStart: "--accent",
  accentEnd: "--accent-strong",
  goldStart: "--gold-strong",
  goldMid: "--gold",
  goldEnd: "--gold",
  text: "--field-ink",
  muted: "--ink-soft",
};

export const SHARE_SVG_COLOR_FALLBACKS: ShareSvgColors = {
  bgStart: RUN_SURFACE_PALETTE.dark.field,
  bgEnd: RUN_SURFACE_PALETTE.dark.accentInk,
  accentStart: RUN_SURFACE_PALETTE.dark.accent,
  accentEnd: RUN_SURFACE_PALETTE.dark.accentStrong,
  goldStart: RUN_SURFACE_PALETTE.dark.goldStrong,
  goldMid: RUN_SURFACE_PALETTE.dark.gold,
  goldEnd: RUN_SURFACE_PALETTE.dark.gold,
  text: RUN_SURFACE_PALETTE.dark.fieldInk,
  muted: RUN_SURFACE_PALETTE.dark.inkSoft,
};

export function rgba(hex: string, alpha: number): string {
  const value = hex.replace(/^#/u, "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
