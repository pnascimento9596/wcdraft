/**
 * Regenerate the golden RNG fixture.
 *
 * Run with Node's native TS support (no build step required):
 *   node --experimental-strip-types packages/core/scripts/generate-golden.ts
 *
 * This writes test/fixtures/rng-golden.json. The committed fixture is the
 * recorded contract; the golden test (src/rng.test.ts) only READS it. Only
 * regenerate intentionally when the RNG algorithm is deliberately changed —
 * a diff here means the deterministic sequence changed.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRng } from "../src/rng.ts";

const SEED = "wcdraft/ws0/golden-seed-v1";
const COUNT = 16;
const PICK_ITEMS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"] as const;
const INT_MAX = 100;

// Each sequence uses a FRESH generator seeded identically, so every sequence is
// independently reproducible from the seed alone.
function sequence<T>(fn: (rng: ReturnType<typeof createRng>) => T): T[] {
  const rng = createRng(SEED);
  return Array.from({ length: COUNT }, () => fn(rng));
}

const fixture = {
  _comment:
    "GOLDEN FIXTURE — recorded deterministic output of @wcdraft/core createRng. Do not hand-edit; regenerate via scripts/generate-golden.ts only when the RNG algorithm intentionally changes.",
  seed: SEED,
  count: COUNT,
  next: sequence((rng) => rng.next()),
  int: {
    maxExclusive: INT_MAX,
    values: sequence((rng) => rng.int(INT_MAX)),
  },
  pick: {
    items: PICK_ITEMS,
    values: sequence((rng) => rng.pick(PICK_ITEMS)),
  },
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "test", "fixtures", "rng-golden.json");
writeFileSync(outPath, JSON.stringify(fixture, null, 2) + "\n");
console.log(`wrote ${outPath}`);
