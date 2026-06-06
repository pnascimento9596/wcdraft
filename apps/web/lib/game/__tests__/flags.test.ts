// Flag mapping coverage test — pins the "no text fallback for real draft nations"
// requirement. Every nation_id that can surface in an active spin (via the
// real compact draft pool) MUST have an SVG mapping.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DRAFT_POOL_BUNDLE } from "@wcdraft/data";

import { allMappedNationIds, flagSrcForNationId } from "../flags";

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
