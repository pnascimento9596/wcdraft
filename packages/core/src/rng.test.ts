import { describe, it, expect } from "vitest";
import { createRng } from "./index.js";

// Behavioural / property tests for the RNG. The byte-for-byte golden
// determinism contract lives in rng.golden.test.ts (selected by path in CI).

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
