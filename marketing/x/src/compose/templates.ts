// Template families (q-007 §A.1). Four families, each drawing from the
// differentiator inventory through features.json hooks — rotating, never all
// crammed into one post. Every family includes at least one pure
// feature-forward variant; result/factoid/daily variants each carry exactly
// one rotating feature hook + a deep link. Every rendered string is gated by
// the banned-lexicon + feature-truth checks in the composer before it can be
// queued or posted.

import type { Feature } from "../features.ts";
import { DEEP_LINKS, shareUrl } from "../config.ts";
import type { RunSummary } from "../engine/run-from-token.ts";
import type { DailySpin, Factoid } from "../dataset/factoids.ts";

export type PostFamily = "feature_pitch" | "daily_challenge" | "result_spotlight" | "factoid";

export interface RenderedTemplate {
  text: string;
  /** Feature ids the text asserts — gated against features.json (must be live). */
  referenced_feature_ids: string[];
  deep_link: string;
  /** True when the variant leads with a feature claim (pure pitch). */
  feature_forward: boolean;
}

// ─── (d) feature_pitch — pure feature-forward ────────────────────────────────

export function renderFeaturePitch(
  primary: Feature,
  secondaryHook: string | null,
): RenderedTemplate {
  // One primary claim + at most one secondary hook — never the whole inventory.
  const tail = secondaryHook ? ` ${secondaryHook}` : "";
  return {
    text: `${primary.claim}${tail} ${DEEP_LINKS.play}`,
    referenced_feature_ids: [primary.id],
    deep_link: DEEP_LINKS.play,
    feature_forward: true,
  };
}

// ─── (a) daily_challenge ─────────────────────────────────────────────────────

interface DailyVariant {
  feature_forward: boolean;
  render: (spin: DailySpin, hook: FeatureHook) => string;
}

const DAILY_VARIANTS: DailyVariant[] = [
  {
    feature_forward: false,
    render: (spin, hook) =>
      `Today's spin: ${spin.nation_name} ${spin.year}. Who's your pick? ${hook.text} ${DEEP_LINKS.play}`,
  },
  {
    feature_forward: false,
    render: (spin, hook) =>
      `${spin.nation_name} ${spin.year} just rolled. One pick — who makes your all-time XI? ${hook.text} ${DEEP_LINKS.play}`,
  },
  {
    feature_forward: true,
    render: (spin, hook) =>
      `${hook.text} Today's seed: ${spin.nation_name} ${spin.year} — spin it and pick. ${DEEP_LINKS.play}`,
  },
];

export function renderDailyChallenge(
  spin: DailySpin,
  hook: FeatureHook,
  variantSeed: number,
): RenderedTemplate {
  const v = DAILY_VARIANTS[variantSeed % DAILY_VARIANTS.length]!;
  return {
    text: v.render(spin, hook),
    referenced_feature_ids: [hook.feature_id],
    deep_link: DEEP_LINKS.play,
    feature_forward: v.feature_forward,
  };
}

// ─── (b) result_spotlight — from a REAL share token's run ─────────────────────

/** Honest, dataset-true narrative for a run. Never embellished. */
export function runNarrative(s: RunSummary): string {
  if (s.is_perfect_eight_zero) return `went a perfect 8-0 and lifted the trophy`;
  if (s.is_champion) return `won it all — ${s.record}`;
  if (s.reached_round && s.reached_round.toLowerCase().includes("final"))
    return `reached the ${s.reached_round} (${s.record})`;
  if (s.wins > 0) return `finished ${s.record}, ${s.goals_for} for / ${s.goals_against} against`;
  return `bowed out ${s.record} — the bracket bit back`;
}

interface SpotlightVariant {
  feature_forward: boolean;
  render: (s: RunSummary, token: string, hook: FeatureHook) => string;
}

const SPOTLIGHT_VARIANTS: SpotlightVariant[] = [
  {
    feature_forward: false,
    render: (s, token, hook) =>
      `${s.team_name} ${runNarrative(s)}. ${hook.text} Replay the exact run: ${shareUrl(token)}`,
  },
  {
    feature_forward: false,
    render: (s, token, hook) => {
      // Position-neutral: stars[0] is the top-RATED starter, not necessarily a
      // forward — never imply a role the data doesn't assert.
      const star = s.stars[0]?.name ? `${s.stars[0].name} the standout. ` : "";
      return `${star}${s.team_name} ${runNarrative(s)}. ${hook.text} ${shareUrl(token)}`;
    },
  },
  {
    feature_forward: true,
    render: (s, token, hook) =>
      `${hook.text} ${s.team_name} ${runNarrative(s)} — same seed, same outcome, any browser: ${shareUrl(token)}`,
  },
];

export function renderResultSpotlight(
  s: RunSummary,
  token: string,
  hook: FeatureHook,
  variantSeed: number,
): RenderedTemplate {
  const v = SPOTLIGHT_VARIANTS[variantSeed % SPOTLIGHT_VARIANTS.length]!;
  return {
    text: v.render(s, token, hook),
    // The post asserts a simulated result → the calibrated-sim feature, plus the
    // rotating hook's feature. shareable_replays is implied by the replay link.
    referenced_feature_ids: Array.from(
      new Set([hook.feature_id, "calibrated_sim", "shareable_replays"]),
    ),
    deep_link: shareUrl(token),
    feature_forward: v.feature_forward,
  };
}

// ─── (c) factoid ─────────────────────────────────────────────────────────────

interface FactoidVariant {
  feature_forward: boolean;
  render: (f: Factoid, hook: FeatureHook) => string;
}

const FACTOID_VARIANTS: FactoidVariant[] = [
  {
    feature_forward: false,
    render: (f, hook) => `${f.text} ${hook.text} ${DEEP_LINKS.play}`,
  },
  {
    feature_forward: true,
    render: (f, hook) => `${hook.text} ${f.text} ${DEEP_LINKS.play}`,
  },
];

export function renderFactoid(
  f: Factoid,
  hook: FeatureHook,
  variantSeed: number,
): RenderedTemplate {
  const v = FACTOID_VARIANTS[variantSeed % FACTOID_VARIANTS.length]!;
  return {
    text: v.render(f, hook),
    referenced_feature_ids: [hook.feature_id],
    deep_link: DEEP_LINKS.play,
    feature_forward: v.feature_forward,
  };
}

// ─── Rotating feature hook ───────────────────────────────────────────────────

export interface FeatureHook {
  feature_id: string;
  text: string;
}
