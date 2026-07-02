// q-005 — surname-collision disambiguation (display-only).
//
// Both Cesare Maldini (P-34023, 1962) and Paolo Maldini (P-43222, 4 cards)
// render common_name "Maldini"; the MV2-12 audit flagged the Cesare card as
// reading like Paolo. The override map disambiguates colliding short names
// at index-build time; non-colliding names are untouched.
import { describe, expect, it } from "vitest";
import type { RuntimePlayerCard } from "@wcdraft/data";

import { buildDisplayNameOverrides } from "../data";

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
});
