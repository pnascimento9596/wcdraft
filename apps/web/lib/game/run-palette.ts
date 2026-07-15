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
    bg: "#0f100e",
    bgPanel: "#1a1d19",
    bgSunken: "#0e0e0c",
    field: "#1f6a47",
    fieldInk: "#ebe6da",
    ink: "#ebe6da",
    inkStrong: "#ebe6da",
    inkSoft: "#96968a",
    inkFaint: "#8a8b7f",
    accent: "#3f9268",
    accentText: "#3fa268",
    accentStrong: "#37805b",
    accentInk: "#05130c",
    gold: "#d4a94e",
    goldStrong: "#b69143",
    provenance: {
      historical: "#35c2d6",
      projected: "#94a1f2",
      estimate: "#f0913f",
      legend: "#d4a94e",
      masked: "#7b867f",
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
