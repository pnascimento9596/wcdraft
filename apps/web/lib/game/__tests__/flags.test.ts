// Flag mapping coverage test — pins the "no text fallback for real draft nations"
// requirement. Every nation_id that can surface in an active spin (via the
// real compact draft pool) MUST have an SVG mapping.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DRAFT_POOL_BUNDLE } from "@wcdraft/data";

import { allMappedNationIds, flagLabelForNation, flagSrcForNationId } from "../flags";

describe("flag asset coverage", () => {
  it("every draft-pool nation_id resolves to a flag svg", () => {
    const nationIds = new Set<string>();
    for (const card of DRAFT_POOL_BUNDLE.player_cards) {
      nationIds.add(card.nation_id);
    }
    for (const card of DRAFT_POOL_BUNDLE.manager_cards) {
      nationIds.add(card.nation_id);
    }

    const missing: string[] = [];
    for (const nid of nationIds) {
      if (flagSrcForNationId(nid) === null) missing.push(nid);
    }
    expect(missing).toEqual([]);
  });

  it("every mapped flag asset exists on disk under apps/web/public/flags", () => {
    const publicRoot = join(process.cwd(), "public", "flags");
    const missingFiles: string[] = [];
    for (const nid of allMappedNationIds()) {
      const src = flagSrcForNationId(nid);
      if (!src) {
        missingFiles.push(`${nid} (no mapping)`);
        continue;
      }
      // src looks like `/flags/T-03.svg` — strip the leading `/flags/`.
      const file = src.replace(/^\/flags\//, "");
      const abs = join(publicRoot, file);
      if (!existsSync(abs)) missingFiles.push(abs);
    }
    expect(missingFiles).toEqual([]);
  });
});

describe("historical substitute flag labels", () => {
  it.each([
    ["T-24", "East Germany", "1974", "Modern successor flag (Germany) shown for East Germany 1974"],
    [
      "T-67",
      "Serbia and Montenegro",
      "2006",
      "Modern successor flag (Serbia) shown for Serbia and Montenegro 2006",
    ],
    ["T-72", "Soviet Union", "1970", "Modern successor flag (Russia) shown for USSR 1970"],
    ["T-87", "Yugoslavia", "1990", "Modern successor flag (Serbia) shown for Yugoslavia 1990"],
    ["T-88", "Zaire", "1974", "Modern successor flag (DR Congo) shown for Zaire 1974"],
  ])("%s labels the modern successor honestly", (nationId, nationName, yearLabel, expected) => {
    expect(flagLabelForNation({ nationId, nationName, yearLabel })).toBe(expected);
  });

  it("keeps normal nation labels simple", () => {
    expect(flagLabelForNation({ nationId: "T-09", nationName: "Brazil", yearLabel: "1970" })).toBe(
      "Brazil flag",
    );
  });
});
