// Tiny deterministic RNG for content selection. NOT a sim RNG — it only picks
// which template variant / feature hook / dataset row to surface, so the
// composer is a pure function of its seed. Same seed in → same post out,
// which is what makes the dry-run artifact a faithful preview of live output.

/** cyrb53 string hash → 53-bit number, stable across runs/platforms. */
export function hashSeed(str: string): number {
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** mulberry32 PRNG seeded from a string. */
export function makeRng(seed: string): () => number {
  let a = hashSeed(seed) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministically pick one element of a non-empty array from a seed. */
export function pick<T>(seed: string, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick: empty array");
  const idx = Math.floor(makeRng(seed)() * items.length) % items.length;
  return items[idx]!;
}

/** Deterministic integer in [0, n) from a seed. */
export function pickIndex(seed: string, n: number): number {
  if (n <= 0) return 0;
  return Math.floor(makeRng(seed)() * n) % n;
}
