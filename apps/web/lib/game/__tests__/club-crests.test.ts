import { existsSync } from "node:fs";
import { join } from "node:path";

import { DRAFT_POOL_BUNDLE } from "@wcdraft/data";
import { describe, expect, it } from "vitest";

import {
  allClubCrestManifestEntries,
  clubInitials,
  normalizeClubString,
  resolveClubCrest,
} from "../club-crests";

describe("club crest resolver", () => {
  it("normalizes only safe string-shape differences before exact matching", () => {
    expect(normalizeClubString("  F.C. Bayern München  ")).toBe("bayern munchen");
    expect(normalizeClubString("A.C. Milan")).toBe("milan");
    expect(normalizeClubString("Brighton & Hove Albion")).toBe("brighton and hove albion");
  });

  it("resolves exact audited 2026 clubs to real crest assets", () => {
    expect(resolveClubCrest("Bayern Munich", 2026)).toMatchObject({
      kind: "crest",
      src: "/clubs/bayern-munich.svg",
      canonicalClubKey: "fc-bayern-munich",
    });
    expect(resolveClubCrest("Inter Milan", 2026)).toMatchObject({
      kind: "crest",
      src: "/clubs/inter-milan.svg",
      canonicalClubKey: "inter-milan",
    });
  });

  it("keeps known ambiguous names on monogram fallback", () => {
    for (const club of ["Athletic", "Racing", "Nacional", "America", "Real", "Universidad"]) {
      expect(resolveClubCrest(club, 2026)).toMatchObject({
        kind: "monogram",
        reason: "ambiguous",
      });
    }
  });

  it("keeps historical cards on monogram fallback even when the current entity is mapped", () => {
    expect(resolveClubCrest("Juventus", 1982)).toMatchObject({
      kind: "monogram",
      reason: "historical",
    });
  });

  it("uses stable fallback initials and tones", () => {
    const a = resolveClubCrest("Crystal Palace", 2026);
    const b = resolveClubCrest("Crystal Palace", 2026);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      kind: "monogram",
      initials: "CP",
      reason: "unmapped",
    });
    expect(clubInitials("Al Ahly")).toBe("AA");
  });

  it("every manifest asset exists under public/clubs", () => {
    const publicRoot = join(process.cwd(), "public", "clubs");
    const missing = allClubCrestManifestEntries()
      .map((entry) => entry.crest_asset_ref.replace(/^\/clubs\//u, ""))
      .filter((asset) => !existsSync(join(publicRoot, asset)));
    expect(missing).toEqual([]);
  });

  it("coverage is reproducible from the manifest and current draft pool", () => {
    const rows = DRAFT_POOL_BUNDLE.player_cards.filter(
      (card) => card.club_at_tournament ?? card.club,
    );
    const resolved = rows.filter((card) => {
      const club = card.club_at_tournament ?? card.club;
      return resolveClubCrest(club, card.tournament_id)?.kind === "crest";
    });
    const projected2026 = rows.filter((card) => card.tournament_id === 2026);
    const projected2026Resolved = projected2026.filter((card) => {
      const club = card.club_at_tournament ?? card.club;
      return resolveClubCrest(club, card.tournament_id)?.kind === "crest";
    });

    expect(rows.length).toBe(12203);
    expect(resolved.length).toBe(84);
    expect(projected2026.length).toBe(1246);
    expect(projected2026Resolved.length).toBe(84);
  });
});
