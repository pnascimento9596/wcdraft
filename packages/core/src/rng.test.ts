import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRng } from "./index.js";

// The committed golden fixture is the recorded determinism contract. This test
// only READS it; regenerate intentionally via `pnpm --filter @wcdraft/core gen:golden`.
const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "test", "fixtures", "rng-golden.json");

interface GoldenFixture {
  seed: string;
  count: number;
  next: number[];
  int: { maxExclusive: number; values: number[] };
  pick: { items: string[]; values: string[] };
}

const golden = JSON.parse(readFileSync(fixturePath, "utf8")) as GoldenFixture;

// Each sequence uses a fresh generator seeded identically — matching the
// generator script, so every sequence is independently reproducible.
function sequence<T>(fn: (rng: ReturnType<typeof createRng>) => T): T[] {
  const rng = createRng(golden.seed);
  return Array.from({ length: golden.count }, () => fn(rng));
}

describe("createRng golden determinism", () => {
  it("reproduces the recorded next() float sequence byte-for-byte", () => {
    expect(sequence((rng) => rng.next())).toEqual(golden.next);
  });

  it("reproduces the recorded int(maxExclusive) sequence", () => {
    expect(sequence((rng) => rng.int(golden.int.maxExclusive))).toEqual(golden.int.values);
  });

  it("reproduces the recorded pick() sequence", () => {
    expect(sequence((rng) => rng.pick(golden.pick.items))).toEqual(golden.pick.values);
  });
});

describe("createRng properties", () => {
  it("is fully deterministic: identical seeds yield identical streams", () => {
    const a = createRng("same-seed");
    const b = createRng("same-seed");
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("treats a numeric seed as its decimal string form", () => {
    const num = createRng(42);
    const str = createRng("42");
    expect(Array.from({ length: 20 }, () => num.next())).toEqual(
      Array.from({ length: 20 }, () => str.next()),
    );
  });

  it("different seeds diverge", () => {
    const a = createRng("seed-a");
    const b = createRng("seed-b");
    expect(a.next()).not.toEqual(b.next());
  });

  it("next() stays within [0, 1)", () => {
    const rng = createRng("range-check");
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int() stays within [0, maxExclusive)", () => {
    const rng = createRng("int-range");
    for (let i = 0; i < 10_000; i++) {
      const v = rng.int(7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it("int() rejects non-positive and non-integer bounds", () => {
    const rng = createRng("int-guard");
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(-1)).toThrow(RangeError);
    expect(() => rng.int(1.5)).toThrow(RangeError);
  });

  it("pick() returns a member and rejects empty arrays", () => {
    const rng = createRng("pick-guard");
    const items = ["x", "y", "z"] as const;
    expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});
