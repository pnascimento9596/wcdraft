import { describe, expect, it } from "vitest";

import {
  _MANAGER_TRAIT_TAXONOMY,
  managerTraitsFor,
} from "@/lib/game/manager-traits";
import type { ManagerTraitView } from "@/lib/game/view-models";

// ENGINE-V2 E-2 — Manager flavor TRAITS contract.
//
// HARD GUARANTEES locked here:
//   * Exactly two distinct trait ids per manager.
//   * Determinism: same manager_id → identical traits (curated or derived).
//   * Curated mapping resolves by manager_id and by normalized full_name.
//   * Diacritic-fold + punctuation normalization works (Aimé Jacquet etc).
//   * Derived fallback ignores `full_name` — it depends only on `manager_id`.
//   * Labels contain NO mechanical language (no "boost", "bonus", "rating",
//     "modifier", "effect").

const BANNED_WORDS = [
  "boost",
  "bonus",
  "rating",
  "modifier",
  "buff",
  "effect",
  "stat",
  "ovr",
];

function expectFlavorOnly(traits: readonly ManagerTraitView[]) {
  for (const t of traits) {
    const label = t.label.toLowerCase();
    for (const w of BANNED_WORDS) {
      expect(label.includes(w)).toBe(false);
    }
  }
}

describe("managerTraitsFor — curated by manager_id", () => {
  it("M-311 (Carlos Alberto Parreira) maps to curated traits", () => {
    const t = managerTraitsFor({
      manager_id: "M-311",
      full_name: "Carlos Alberto Parreira",
    });
    expect(t).toHaveLength(2);
    expect(t[0].source).toBe("curated");
    expect(t[1].source).toBe("curated");
    expect(t[0].id).toBe("global_organiser");
    expect(t[1].id).toBe("steady_builder");
    expectFlavorOnly(t);
  });
});

describe("managerTraitsFor — curated by normalized full_name", () => {
  it("diacritic-folded names match (Aimé Jacquet → Aime Jacquet)", () => {
    const a = managerTraitsFor({
      manager_id: "unknown-x",
      full_name: "Aimé Jacquet",
    });
    const b = managerTraitsFor({
      manager_id: "unknown-x",
      full_name: "Aime Jacquet",
    });
    expect(a).toEqual(b);
    expect(a[0].source).toBe("curated");
    expect(a[0].id).toBe("defensive_platform");
    expect(a[1].id).toBe("squad_balance");
  });

  it("punctuation differences in canonical names are normalized away", () => {
    // "César Luis Menotti" curated key is "cesar luis menotti".
    const t = managerTraitsFor({
      manager_id: "any",
      full_name: "César-Luis  Menotti",
    });
    expect(t[0].source).toBe("curated");
    expect(t[0].id).toBe("attacking_license");
    expect(t[1].id).toBe("identity_builder");
  });
});

describe("managerTraitsFor — seeded fallback", () => {
  it("identical manager_id → identical derived traits", () => {
    const a = managerTraitsFor({
      manager_id: "M-9999",
      full_name: "Some Unknown Manager",
    });
    const b = managerTraitsFor({
      manager_id: "M-9999",
      full_name: "Some Unknown Manager",
    });
    expect(a).toEqual(b);
    expect(a[0].source).toBe("derived");
    expect(a[1].source).toBe("derived");
  });

  it("derivation depends only on manager_id (not full_name)", () => {
    const a = managerTraitsFor({
      manager_id: "M-7777",
      full_name: "Alpha",
    });
    const b = managerTraitsFor({
      manager_id: "M-7777",
      full_name: "Bravo",
    });
    expect(a).toEqual(b);
  });

  it("returns exactly two distinct trait ids", () => {
    const sampleIds = ["M-1", "M-2", "M-3", "M-42", "M-100", "M-501"];
    for (const manager_id of sampleIds) {
      const t = managerTraitsFor({ manager_id, full_name: "Anon" });
      expect(t).toHaveLength(2);
      expect(t[0].id).not.toBe(t[1].id);
      expectFlavorOnly(t);
    }
  });

  it("all derived trait ids belong to the closed taxonomy", () => {
    const taxonomySet = new Set<string>(_MANAGER_TRAIT_TAXONOMY);
    for (let i = 0; i < 50; i++) {
      const t = managerTraitsFor({
        manager_id: `M-stochastic-${i}`,
        full_name: "Random Name",
      });
      expect(taxonomySet.has(t[0].id)).toBe(true);
      expect(taxonomySet.has(t[1].id)).toBe(true);
    }
  });
});

describe("managerTraitsFor — labels are flavor (no mechanic claims)", () => {
  it("curated and derived labels never include mechanical words", () => {
    const t1 = managerTraitsFor({
      manager_id: "M-311",
      full_name: "Carlos Alberto Parreira",
    });
    const t2 = managerTraitsFor({
      manager_id: "M-zzz",
      full_name: "Random",
    });
    expectFlavorOnly(t1);
    expectFlavorOnly(t2);
  });
});
