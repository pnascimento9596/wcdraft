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

  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
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
