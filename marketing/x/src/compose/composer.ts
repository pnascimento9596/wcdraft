// The composer: deterministic, seeded assembly of a publishable Post from a
// template family. Every produced post passes THREE gates before it can leave
// this module: banned-lexicon (lexicon.ts), feature-truth (features.ts), and
// the X length limit. A post that references a non-live feature, trips a
// terminology guardrail, or overflows 280 chars is never returned — it throws,
// or (for result-spotlights against a skewed/foreign token) returns an honest
// skip with a reason. No fabricated results, no false feature claims.

import { createHash } from "node:crypto";

import { assertFeatureTruth, liveFeatures, type Feature } from "../features.ts";
import { assertClean } from "../lexicon.ts";
import { X_MAX_POST_LEN, TCO_LINK_LEN } from "../config.ts";
import { makeRng, pickIndex } from "./rng.ts";
import {
  renderDailyChallenge,
  renderFactoid,
  renderFeaturePitch,
  renderResultSpotlight,
  type FeatureHook,
  type PostFamily,
  type RenderedTemplate,
} from "./templates.ts";
import { pickDailySpin, pickEraFactoid, pickLegendFactoid } from "../dataset/factoids.ts";
import { runFromToken, type RunSummary } from "../engine/run-from-token.ts";
import { loadMarketingGameData, type MarketingGameData } from "../engine/game-data.ts";

export interface Post {
  id: string;
  family: PostFamily;
  text: string;
  referenced_feature_ids: string[];
  deep_link: string;
  feature_forward: boolean;
  content_hash: string;
}

export type ComposeResult =
  | { ok: true; post: Post }
  | { ok: false; reason: string; detail: string };

/** Effective X length: a wrapped t.co link counts as TCO_LINK_LEN regardless of its real length. */
export function effectiveLength(text: string, deepLink: string): number {
  if (deepLink && text.includes(deepLink)) {
    return text.length - deepLink.length + TCO_LINK_LEN;
  }
  return text.length;
}

/** Pick a live feature + one of its hooks, deterministically, optionally excluding ids. */
export function pickFeatureHook(seed: string, exclude: readonly string[] = []): FeatureHook {
  const pool = liveFeatures().filter((f) => f.hooks.length > 0 && !exclude.includes(f.id));
  const usable = pool.length > 0 ? pool : liveFeatures().filter((f) => f.hooks.length > 0);
  const f = usable[pickIndex(`hook:${seed}`, usable.length)]!;
  const hook = f.hooks[pickIndex(`hooktext:${seed}`, f.hooks.length)]!;
  return { feature_id: f.id, text: hook };
}

function finalize(family: PostFamily, r: RenderedTemplate, context: string): Post {
  assertClean(r.text, context);
  assertFeatureTruth(r.referenced_feature_ids, context);
  const eff = effectiveLength(r.text, r.deep_link);
  if (eff > X_MAX_POST_LEN) {
    throw new PostTooLongError(`${context}: post is ${eff} chars (limit ${X_MAX_POST_LEN})`);
  }
  const content_hash = createHash("sha256").update(r.text.trim()).digest("hex");
  return {
    id: `${family}-${content_hash.slice(0, 12)}`,
    family,
    text: r.text,
    referenced_feature_ids: r.referenced_feature_ids,
    deep_link: r.deep_link,
    feature_forward: r.feature_forward,
    content_hash,
  };
}

export class PostTooLongError extends Error {}

/**
 * Render → validate with bounded retry. A dataset-derived string (player name,
 * nation) could in principle trip the lexicon or overflow length; we re-seed
 * and try a different selection rather than emit a violating post. After
 * `maxTries` clean failures we surface the problem instead of forcing a post.
 */
function withRetry(
  family: PostFamily,
  build: (seed: string) => RenderedTemplate,
  seed: string,
  maxTries = 8,
): Post {
  let lastErr: unknown;
  for (let i = 0; i < maxTries; i += 1) {
    const trySeed = i === 0 ? seed : `${seed}:r${i}`;
    try {
      return finalize(family, build(trySeed), `${family}@${trySeed}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `composer could not produce a clean ${family} post after ${maxTries} tries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

// ─── Family composers ────────────────────────────────────────────────────────

export function composeFeaturePitch(seed: string): Post {
  return withRetry(
    "feature_pitch",
    (s) => {
      const live = liveFeatures();
      const primary: Feature = live[pickIndex(`pitch:${s}`, live.length)]!;
      // Optional secondary hook from a DIFFERENT feature (never crams everything).
      const others = live.filter((f) => f.id !== primary.id && f.hooks.length > 0);
      const includeSecondary = makeRng(`sec:${s}`)() > 0.5 && others.length > 0;
      const secondaryHook = includeSecondary
        ? others[pickIndex(`secpick:${s}`, others.length)]!.hooks[0]!
        : null;
      return renderFeaturePitch(primary, secondaryHook);
    },
    seed,
  );
}

export function composeDailyChallenge(
  seed: string,
  gd: MarketingGameData = loadMarketingGameData(),
): Post {
  return withRetry(
    "daily_challenge",
    (s) => {
      const spin = pickDailySpin(s, gd);
      const hook = pickFeatureHook(s);
      return renderDailyChallenge(spin, hook, pickIndex(`var:${s}`, 3));
    },
    seed,
  );
}

export function composeFactoid(
  seed: string,
  gd: MarketingGameData = loadMarketingGameData(),
): Post {
  return withRetry(
    "factoid",
    (s) => {
      const useLegend = makeRng(`kind:${s}`)() > 0.5;
      const f = useLegend ? pickLegendFactoid(s, gd) : pickEraFactoid(s, gd);
      const hook = pickFeatureHook(s);
      return renderFactoid(f, hook, pickIndex(`var:${s}`, 2));
    },
    seed,
  );
}

/**
 * Result-spotlight from a REAL share token. Honest-state: a foreign / skewed /
 * newer-build / unreplayable token yields an explicit skip (never a fabricated
 * result). The caller decides whether to drop the post or use the "older
 * build" angle.
 */
export function composeResultSpotlight(
  seed: string,
  token: string,
  gd: MarketingGameData = loadMarketingGameData(),
): ComposeResult {
  const run = runFromToken(token, gd);
  if (!run.ok) {
    return { ok: false, reason: run.reason, detail: run.message };
  }
  try {
    const post = withRetry(
      "result_spotlight",
      (s) => {
        const summary: RunSummary = run.summary;
        // Exclude the implied feature ids from the rotating hook so the hook adds
        // a DIFFERENT differentiator than the sim/replay the post already carries.
        const hook = pickFeatureHook(s, ["calibrated_sim", "shareable_replays"]);
        return renderResultSpotlight(summary, token, hook, pickIndex(`var:${s}`, 3));
      },
      seed,
    );
    return { ok: true, post };
  } catch (err) {
    return {
      ok: false,
      reason: "render_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
