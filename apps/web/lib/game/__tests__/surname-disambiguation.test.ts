// q-005 — surname-collision disambiguation (display-only).
//
// Both Cesare Maldini (P-34023, 1962) and Paolo Maldini (P-43222, 4 cards)
// render common_name "Maldini"; the MV2-12 audit flagged the Cesare card as
// reading like Paolo. The override map disambiguates colliding short names
// at index-build time; non-colliding names are untouched.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DRAFT_POOL_BUNDLE, type RuntimePlayerCard } from "@wcdraft/data";

import { buildDisplayNameOverrides } from "../data";

function sortedEntries(overrides: ReadonlyMap<string, string>): [string, string][] {
  return [...overrides.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

let seq = 0;
function card(
  over: Partial<Omit<RuntimePlayerCard, "card_id">> & { card_id?: string },
): RuntimePlayerCard {
  seq += 1;
  return {
    card_id: over.card_id ?? `C-${String(seq)}`,
    player_id: over.player_id ?? `P-${String(seq)}`,
    tournament_id: 1962,
    nation_id: "ITA",
    common_name: "",
    full_name: "",
    primary_position: "DF",
    eligible_positions: ["DF"],
    birth_date: null,
    position_listed: null,
    shirt_number: null,
    club_at_tournament: null,
    captain: null,
    coverage: 1,
    ...over,
  } as RuntimePlayerCard;
}

describe("buildDisplayNameOverrides (q-005)", () => {
  it("keeps the real-bundle override map byte-identical to the pre-O(n) baseline", () => {
    const overrides = buildDisplayNameOverrides(DRAFT_POOL_BUNDLE.player_cards);
    const entries = [...overrides.entries()];
    const serialized = JSON.stringify(entries);
    const canonicalEntries = sortedEntries(overrides);

    expect(DRAFT_POOL_BUNDLE.player_cards).toHaveLength(12_219);
    expect(entries).toHaveLength(3_681);
    expect(Buffer.byteLength(serialized)).toBe(113_071);
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      "553319c2dfee6307fa3f1823a3afe0c4d6075d7a4ec7d4bb030d1edcbb74cbbe",
    );
    expect(
      [0, 1, 17, 250, 500, 1_000, 1_500, 2_000, 2_500, 3_000, 3_500, 3_680].map(
        (index) => canonicalEntries[index],
      ),
    ).toEqual([
      ["P-00042:1954", "Miloš Milutinović"],
      ["P-00042:1958", "Miloš Milutinović"],
      ["P-00452:1958", "L. Allchurch"],
      ["P-07363:1986", "P. Markov"],
      ["P-14428:2014", "H. Almeida"],
      ["P-29660:1962", "Mario David"],
      ["P-43959:1998", "R. Lee"],
      ["P-57865:2022", "R. Jiménez"],
      ["P-73110:1998", "Hussein Abdulghani"],
      ["P-87003:2026", "N. Mendes"],
      ["P-W26-0236:2026", "E. Anderson"],
      ["P-W26-0867:2026", "Odeh Al-Fakhouri"],
    ]);
  });

  it("disambiguates the Maldini collision with given-name initials", () => {
    const overrides = buildDisplayNameOverrides([
      card({
        card_id: "C-cesare",
        player_id: "P-34023",
        common_name: "Maldini",
        full_name: "Cesare Maldini",
      }),
      card({
        card_id: "C-paolo-90",
        player_id: "P-43222",
        common_name: "Maldini",
        full_name: "Paolo Maldini",
      }),
      card({
        card_id: "C-paolo-94",
        player_id: "P-43222",
        common_name: "Maldini",
        full_name: "Paolo Maldini",
      }),
    ]);
    expect(overrides.get("C-cesare")).toBe("C. Maldini");
    expect(overrides.get("C-paolo-90")).toBe("P. Maldini");
    expect(overrides.get("C-paolo-94")).toBe("P. Maldini");
  });

  it("leaves non-colliding names alone (no override entry)", () => {
    const overrides = buildDisplayNameOverrides([
      card({ card_id: "C-1", common_name: "Pelé", full_name: "Edson Arantes do Nascimento" }),
      card({ card_id: "C-2", common_name: "Garrincha", full_name: "Manuel Francisco dos Santos" }),
    ]);
    expect(overrides.size).toBe(0);
  });

  it("same player with many cards is NOT a collision (year disambiguates era)", () => {
    const overrides = buildDisplayNameOverrides([
      card({
        card_id: "C-1",
        player_id: "P-1",
        common_name: "Maldini",
        full_name: "Paolo Maldini",
      }),
      card({
        card_id: "C-2",
        player_id: "P-1",
        common_name: "Maldini",
        full_name: "Paolo Maldini",
      }),
    ]);
    expect(overrides.size).toBe(0);
  });

  it("falls back to full name when the short name is not the surname token", () => {
    const overrides = buildDisplayNameOverrides([
      // Mononym-style common_name unrelated to the full name's last token —
      // the initial form doesn't apply, so the full name is used.
      card({
        card_id: "C-a",
        player_id: "P-a",
        common_name: "Ronaldo",
        full_name: "Ronaldo Luís Nazário de Lima",
      }),
      card({
        card_id: "C-b",
        player_id: "P-b",
        common_name: "Ronaldo",
        full_name: "Ronaldo de Assis Moreira",
      }),
    ]);
    expect(overrides.get("C-a")).toBe("Ronaldo Luís Nazário de Lima");
    expect(overrides.get("C-b")).toBe("Ronaldo de Assis Moreira");
  });

  it("scrubs source name sentinels before collision disambiguation", () => {
    const overrides = buildDisplayNameOverrides([
      card({
        card_id: "C-rodri-1962",
        player_id: "P-81323",
        common_name: "Rodri",
        full_name: "not applicable Rodri",
      }),
      card({
        card_id: "C-rodri-2022",
        player_id: "P-62341",
        common_name: "Rodri",
        full_name: "not applicable Rodri",
      }),
    ]);
    expect(overrides.get("C-rodri-1962")).toBe("Rodri");
    expect(overrides.get("C-rodri-2022")).toBe("Rodri");
  });

  it("escalates to full names when initial forms still collide across players", () => {
    const overrides = buildDisplayNameOverrides([
      card({ card_id: "C-a", player_id: "P-a", common_name: "Silva", full_name: "Carlos Silva" }),
      card({
        card_id: "C-b",
        player_id: "P-b",
        common_name: "Silva",
        full_name: "Cristiano Silva",
      }),
    ]);
    expect(overrides.get("C-a")).toBe("Carlos Silva");
    expect(overrides.get("C-b")).toBe("Cristiano Silva");
  });

  it("collision detection is case-insensitive and uses the full_name fallback", () => {
    const overrides = buildDisplayNameOverrides([
      card({ card_id: "C-a", player_id: "P-a", common_name: "", full_name: "Bruno Costa" }),
      card({
        card_id: "C-b",
        player_id: "P-b",
        common_name: "bruno costa",
        full_name: "Bruno Costa",
      }),
    ]);
    // Distinct players, identical names everywhere — both get an override
    // (the full name), and the card year remains the only separator.
    expect(overrides.size).toBe(2);
  });

  it("is independent of interleaved group and card ordering", () => {
    const cards = [
      card({ card_id: "C-a1", player_id: "P-a", common_name: "Lee", full_name: "Alex Lee" }),
      card({ card_id: "C-b1", player_id: "P-b", common_name: "Kim", full_name: "Bea Kim" }),
      card({ card_id: "C-c1", player_id: "P-c", common_name: "lee", full_name: "Chris Lee" }),
      card({ card_id: "C-d1", player_id: "P-d", common_name: "KIM", full_name: "Dana Kim" }),
      card({ card_id: "C-a2", player_id: "P-a", common_name: "Lee", full_name: "Alex Lee" }),
    ];

    expect(sortedEntries(buildDisplayNameOverrides(cards))).toEqual(
      sortedEntries(buildDisplayNameOverrides([...cards].reverse())),
    );
  });

  it("preserves the scrubbed empty-name fallback for distinct players", () => {
    const overrides = buildDisplayNameOverrides([
      card({ card_id: "C-a", player_id: "P-a", common_name: "not applicable", full_name: "" }),
      card({ card_id: "C-b", player_id: "P-b", common_name: "", full_name: "not applicable" }),
    ]);

    expect(sortedEntries(overrides)).toEqual([
      ["C-a", "—"],
      ["C-b", "—"],
    ]);
  });
});
