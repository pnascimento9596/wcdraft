import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRng } from "./index.js";

// GOLDEN DETERMINISM CONTRACT.
//
// This file is selected BY PATH in CI (`vitest run src/rng.golden.test.ts`),
// not by a `-t` name filter — a name filter passes vacuously if a describe is
// renamed, silently dropping the gate. Combined with `passWithNoTests: false`
// (vitest.config.ts), CI FAILS if this file is missing or the sequence drifts.
//
// The fixture is RE-DERIVED here at runtime from the seed and compared to the
// committed recording — it is not self-comparing. Regenerate intentionally with
// `pnpm --filter @wcdraft/core run gen:golden` (only on a deliberate RNG change).
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
