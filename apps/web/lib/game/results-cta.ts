/**
 * Results screen CTA hierarchy — structural, never outcome-sentiment based.
 *
 * Modes where a fresh run is immediately available → Draft Again primary.
 * Daily (one shared draft per day; Draft Again is degraded/secondary) → Share primary.
 */

export type ResultsCtaContext = {
  readonly isDaily: boolean;
};

export type ResultsPrimaryCta = "draft-again" | "share";

export function resultsPrimaryCta(ctx: ResultsCtaContext): ResultsPrimaryCta {
  return ctx.isDaily ? "share" : "draft-again";
}

/** Enumerate every results entry path the product ships for CTA tests. */
export const RESULTS_ENTRY_PATHS = [
  { id: "classic", isDaily: false, mode: "classic" },
  { id: "hidden", isDaily: false, mode: "hidden" },
  { id: "open", isDaily: false, mode: "open" },
  { id: "legends", isDaily: false, mode: "legends" },
  { id: "daily", isDaily: true, mode: "classic" },
  { id: "challenge-originated", isDaily: false, mode: "classic", friendChallenge: true },
] as const;
