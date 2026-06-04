import { describe, it, expect } from "vitest";
import { canonicalSortBy, canonicalSortStrings, createRng, deriveSubseed } from "./index.js";

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

describe("deriveSubseed", () => {
  it("is deterministic: same (runSeed, substream, scopeId) → same output", () => {
    const a = deriveSubseed("run.fixture.seed.1", "match_sim", "match:0");
    const b = deriveSubseed("run.fixture.seed.1", "match_sim", "match:0");
    expect(a).toBe(b);
  });

  it("different substreams produce different sub-seeds", () => {
    const draft = deriveSubseed("seed-x", "draft");
    const sim = deriveSubseed("seed-x", "match_sim");
    const narr = deriveSubseed("seed-x", "narrative");
    expect(draft).not.toBe(sim);
    expect(sim).not.toBe(narr);
    expect(draft).not.toBe(narr);
  });

  it("different scopes within the same substream produce different sub-seeds", () => {
    const m0 = deriveSubseed("seed-x", "match_sim", "match:0");
    const m1 = deriveSubseed("seed-x", "match_sim", "match:1");
    expect(m0).not.toBe(m1);
  });

  it("an explicit empty-string scope differs from omitted scope", () => {
    // scopeId of '' would throw — but a non-empty string should differ from
    // the no-scope case.
    const noScope = deriveSubseed("seed-x", "match_sim");
    const scoped = deriveSubseed("seed-x", "match_sim", "match:0");
    expect(noScope).not.toBe(scoped);
  });

  it("rejects empty/whitespace runSeed", () => {
    expect(() => deriveSubseed("", "draft")).toThrow(RangeError);
    expect(() => deriveSubseed("   ", "draft")).toThrow(RangeError);
  });

  it("rejects empty/whitespace scopeId when provided", () => {
    expect(() => deriveSubseed("seed-x", "draft", "")).toThrow(RangeError);
    expect(() => deriveSubseed("seed-x", "draft", "  ")).toThrow(RangeError);
  });

  it("output format is `wcdraft:<substream>:v1:<32 hex chars>`", () => {
    const s = deriveSubseed("seed-x", "draft");
    expect(s).toMatch(/^wcdraft:draft:v1:[0-9a-f]{32}$/);
  });

  it("matches the locked golden sub-seeds (regression gate)", () => {
    // GOLDEN: capturing the deriveSubseed algorithm here so any drift in the
    // hash-mix or output format fails the test deterministically. Rebake only
    // alongside an intentional engine_version bump.
    expect(deriveSubseed("run.fixture.seed.1", "draft")).toBe(
      "wcdraft:draft:v1:83e2173f77829f88def755f0772c54d8",
    );
    expect(deriveSubseed("run.fixture.seed.1", "match_sim", "match:0")).toBe(
      "wcdraft:match_sim:v1:5d1c7a2740827ee26f36c31bf1a5f4f5",
    );
    expect(deriveSubseed("run.fixture.seed.1", "narrative")).toBe(
      "wcdraft:narrative:v1:f119a4104ee7391ac8cef676e7c1937c",
    );
    expect(deriveSubseed("run.fixture.seed.1", "opponent_selection", "scenario:s.1")).toBe(
      "wcdraft:opponent_selection:v1:01c4357bd36d973ae6507f425ff8207d",
    );
    expect(deriveSubseed("run.fixture.seed.1", "event_gen", "match:0")).toBe(
      "wcdraft:event_gen:v1:47bcbe76bb9ec922f0a134a093313044",
    );
  });

  it("the derived sub-seed is usable as a createRng seed", () => {
    const sub = deriveSubseed("run.fixture.seed.1", "match_sim", "match:0");
    const rngA = createRng(sub);
    const rngB = createRng(sub);
    expect(rngA.next()).toBe(rngB.next());
  });
});

describe("canonicalSortBy / canonicalSortStrings", () => {
  it("does not mutate the input array", () => {
    const input = [3, 1, 2];
    const out = canonicalSortBy(input, (n) => [n]);
    expect(input).toEqual([3, 1, 2]);
    expect(out).toEqual([1, 2, 3]);
  });

  it("sorts by number primarily, then by string code point", () => {
    const items = [
      { tournament_id: 1954, nation_id: "hun" },
      { tournament_id: 1954, nation_id: "esp" },
      { tournament_id: 1930, nation_id: "uru" },
    ];
    const out = canonicalSortBy(items, (t) => [t.tournament_id, t.nation_id]);
    expect(out.map((t) => `${t.tournament_id}:${t.nation_id}`)).toEqual([
      "1930:uru",
      "1954:esp",
      "1954:hun",
    ]);
  });

  it("is stable for ties on the supplied keys", () => {
    const items = [
      { id: "a", n: 1 },
      { id: "b", n: 1 },
      { id: "c", n: 1 },
    ];
    const out = canonicalSortBy(items, (x) => [x.n]);
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("compares strings by code point — never via localeCompare", () => {
    // 'Z' (0x5A) < 'a' (0x61) by code point, but localeCompare would invert.
    const out = canonicalSortStrings(["a", "Z"]);
    expect(out).toEqual(["Z", "a"]);
  });
});
