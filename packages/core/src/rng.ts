/**
 * Deterministic, platform-stable seeded PRNG — the SINGLE source of randomness
 * for wcdraft. No `Date`, `Math.random`, or `crypto` is used anywhere here, so
 * a given seed always yields a byte-identical sequence on every platform and
 * Node/JS-engine version.
 *
 * Algorithm (both from Jason Tarka / "bryc"'s well-documented public-domain
 * collection of fast pure-JS PRNGs):
 *   - cyrb128: hashes an arbitrary string into four 32-bit seed words.
 *   - sfc32  : "Small Fast Counter" generator, 128-bit state, 32-bit output.
 *
 * Reference: https://github.com/bryc/code/blob/master/jshash/PRNGs.md
 *
 * These are chosen specifically for reproducibility: all arithmetic is 32-bit
 * integer math via `Math.imul` and `>>> 0`, which is identical across engines.
 *
 * SCOPE NOTE: this is the ONE allowed source of entropy in `packages/core`.
 * `Math.random`, `Date.now`, `performance.now`, `crypto.getRandomValues`, and
 * `new Date()` are FORBIDDEN everywhere else in `packages/core/src` — enforced
 * by the ESLint determinism guard in the root flat config.
 */

/** Public contract for a seeded random generator. */
export interface Rng {
  /** Next float in the half-open interval [0, 1). */
  next(): number;
  /**
   * Next non-negative integer in [0, maxExclusive).
   * @throws RangeError if `maxExclusive` is not a positive safe integer.
   */
  int(maxExclusive: number): number;
  /**
   * Uniformly pick one element from a non-empty array.
   * @throws RangeError if `arr` is empty.
   */
  pick<T>(arr: readonly T[]): T;
}

/**
 * cyrb128 string hash → four 32-bit unsigned seed words.
 * Deterministic for a given input string.
 */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);

  // Canonical bryc final mix — the XOR folds are SEQUENTIAL and in-place:
  // each later word XORs against the ALREADY-updated h1. Do not collapse this
  // into a single return expression (that reuses the pre-update h1 and drifts
  // from the reference algorithm).
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;

  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * sfc32 generator factory. Returns a closure producing floats in [0, 1).
 * State is four 32-bit words.
 */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return function next(): number {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * Create a seeded RNG. The same seed always produces the same stream.
 *
 * A numeric seed is normalized to its decimal string form before hashing, so
 * `createRng(42)` and `createRng("42")` produce the same sequence by design.
 */
export function createRng(seed: string | number): Rng {
  const seedStr = typeof seed === "number" ? seed.toString() : seed;
  const [a, b, c, d] = cyrb128(seedStr);
  const next = sfc32(a, b, c, d);

  return {
    next,
    int(maxExclusive: number): number {
      if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(
          `int(maxExclusive) requires a positive safe integer, received: ${maxExclusive}`,
        );
      }
      // Multiply-and-floor (modulo-style) mapping. Unbiased rejection sampling
      // is deliberately skipped: the bias is < 1e-7 for maxExclusive < 2^20,
      // which is acceptable for game determinism and keeps the stream simple.
      return Math.floor(next() * maxExclusive);
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) {
        throw new RangeError("pick() requires a non-empty array");
      }
      const index = Math.floor(next() * arr.length);
      // Safe: 0 <= index < arr.length by construction.
      return arr[index]!;
    },
  };
}

// ─── SUBSTREAM SUB-SEED DERIVATION ────────────────────────────────────────────
//
// Every seed-consuming substream of the engine (draft / match-sim / event-gen /
// opponent-selection / narrative) MUST derive its working seed from the master
// run seed via `deriveSubseed`. This is the only sanctioned way to fork
// determinism — substreams must never instantiate a fresh PRNG with raw
// entropy. The derivation reuses the existing cyrb128 + sfc32 primitives so
// there is exactly ONE randomness algorithm in the engine.
//
// Sub-seed shape: `wcdraft:<substream>:v1:<32 hex chars>`. The version tag
// `v1` lets a future engine bump (and version anchor) deliberately rotate
// every persisted sub-seed without re-using the old format silently.

/**
 * Sanctioned substream names. Always lowercase, underscore-separated.
 *
 * Reserved-but-unused names: `"scenario"` (scenario builder; consumed by the
 * RunScenario builder work item) and `"group_table"` (deterministic draw-lots
 * tiebreak inside the group-stage qualification gate). The names are added
 * here so the contract is stable across the integration sequence; no new
 * entropy is introduced — only when a substream is actually `deriveSubseed`'d
 * is its sub-seed emitted.
 *
 * NOTE on variadic suffixes (e.g. `group-other:N`): suffix-style scopes such
 * as `match_sim/"match:0"` or `match_sim/"group-other:0"` ride on the existing
 * `scopeId` parameter of `deriveSubseed`. They do NOT need to be enumerated in
 * `SubstreamName` — `scopeId` already accepts any non-empty string. So a new
 * scope like `group-other:N` reuses an existing substream (`match_sim` or
 * `event_gen`) with the scope `"group-other:<N>"`.
 */
export type SubstreamName =
  | "draft"
  | "match_sim"
  | "event_gen"
  | "opponent_selection"
  | "narrative"
  | "scenario"
  | "group_table";

const SUBSTREAM_NAMES: readonly SubstreamName[] = [
  "draft",
  "match_sim",
  "event_gen",
  "opponent_selection",
  "narrative",
  "scenario",
  "group_table",
] as const;

const SUBSEED_VERSION = "v1";
const SUBSEED_DOMAIN = "wcdraft-subseed-v1";

function toHex32(word: number): string {
  // Force unsigned interpretation, then pad to 8 hex chars.
  return (word >>> 0).toString(16).padStart(8, "0");
}

function isSubstream(name: string): name is SubstreamName {
  return (SUBSTREAM_NAMES as readonly string[]).includes(name);
}

/**
 * Derive a deterministic sub-seed string for a named substream.
 *
 * @param runSeed   The master run seed (`RunResult.seed` / `DraftState.draft_seed`
 *                  pre-derivation parent). Must be non-empty.
 * @param substream One of the sanctioned `SubstreamName` values.
 * @param scopeId   Optional scope (e.g. `"match:0"`, `"scenario:<scenario_id>"`).
 *                  When provided, must be non-empty. Distinct scopes produce
 *                  distinct sub-seeds within the same substream.
 *
 * @returns A stable, opaque string suitable for `createRng(seed)`. Same input
 *          tuple → same output, byte-for-byte, across platforms and Node
 *          versions.
 *
 * @throws RangeError on empty/whitespace `runSeed` or empty/whitespace `scopeId`.
 *
 * IMPLEMENTATION NOTES:
 *  - Material is JSON-encoded as a tuple, which removes delimiter-collision
 *    ambiguity if a seed itself contains `:` or `|`.
 *  - The material is hashed via cyrb128 → sfc32 (same primitives as
 *    `createRng`), so this helper does NOT introduce a second random algorithm.
 *  - The first four uint32 outputs of sfc32 are concatenated as zero-padded
 *    hex to produce a 128-bit seed string.
 */
export function deriveSubseed(runSeed: string, substream: SubstreamName, scopeId?: string): string {
  if (typeof runSeed !== "string" || runSeed.trim().length === 0) {
    throw new RangeError("deriveSubseed requires a non-empty runSeed");
  }
  if (!isSubstream(substream)) {
    throw new RangeError(`deriveSubseed received unknown substream: ${substream}`);
  }
  if (scopeId !== undefined) {
    if (typeof scopeId !== "string" || scopeId.trim().length === 0) {
      throw new RangeError("deriveSubseed scopeId, when provided, must be non-empty");
    }
  }
  const material = JSON.stringify([SUBSEED_DOMAIN, runSeed, substream, scopeId ?? null]);
  const [a, b, c, d] = cyrb128(material);
  const stream = sfc32(a, b, c, d);
  // Reuse sfc32 to emit four uint32 outputs. The closure returns floats in
  // [0,1); multiply by 2^32 and `>>> 0` to recover the underlying uint32.
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    words.push((stream() * 4294967296) >>> 0);
  }
  return `wcdraft:${substream}:${SUBSEED_VERSION}:${words.map(toHex32).join("")}`;
}

// ─── CANONICAL SORT HELPER ────────────────────────────────────────────────────
//
// Sampling pools throughout the engine (draft (tournament,nation) pairs,
// rolled rosters, knockout opponent pools, shootout taker order, etc.) MUST
// be canonically sorted before any draw, otherwise insertion-order drift
// silently changes the draw without a seed change. `canonicalSortBy` is the
// one sanctioned ordering primitive — it compares numbers numerically and
// strings by code point (NOT locale), which is platform-stable.

/** A single key part for canonical ordering. Numbers compare numerically; strings compare by code point. */
export type CanonicalSortKey = string | number;

/**
 * Return a new array sorted lexicographically over the key parts produced by
 * `keyParts(item)`. Stable. Never mutates `items`.
 *
 * Callers must supply enough key parts to make ordering canonical for their
 * pool (e.g. `(t.tournament_id, t.nation_id)` for the draft (T,N) pool).
 *
 * Comparison rules:
 *  - Same-typed parts compare directly (`<` / `>`).
 *  - Mixed types (number vs string at the same index) order numbers BEFORE
 *    strings; this should be avoided by design but is defined for safety.
 */
export function canonicalSortBy<T>(
  items: readonly T[],
  keyParts: (item: T) => readonly CanonicalSortKey[],
): T[] {
  // Materialize keys once for an O(n log n · k) total comparison cost.
  const keyed = items.map((item, idx) => ({ item, idx, key: keyParts(item) }));
  keyed.sort((a, b) => {
    const ak = a.key;
    const bk = b.key;
    const len = Math.min(ak.length, bk.length);
    for (let i = 0; i < len; i++) {
      const av = ak[i]!;
      const bv = bk[i]!;
      const aIsNum = typeof av === "number";
      const bIsNum = typeof bv === "number";
      if (aIsNum && bIsNum) {
        if (av < bv) return -1;
        if (av > bv) return 1;
        continue;
      }
      if (aIsNum !== bIsNum) {
        // Numbers sort before strings — deterministic tiebreak for the
        // mixed-type case, which callers should generally avoid.
        return aIsNum ? -1 : 1;
      }
      // Both strings — compare by code-point order (NOT locale).
      const as = av as string;
      const bs = bv as string;
      if (as < bs) return -1;
      if (as > bs) return 1;
    }
    if (ak.length !== bk.length) return ak.length - bk.length;
    // Last-resort stable tiebreak.
    return a.idx - b.idx;
  });
  return keyed.map((entry) => entry.item);
}

/**
 * Convenience: canonical-sort a flat string array by code-point order.
 * Equivalent to `canonicalSortBy(items, (s) => [s])`.
 */
export function canonicalSortStrings(items: readonly string[]): string[] {
  return canonicalSortBy(items, (s) => [s]);
}
