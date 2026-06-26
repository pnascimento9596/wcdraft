import { describe, expect, it } from "vitest";
import {
  autoDraft,
  decodeRunToken as coreDecodeRunToken,
  isNewerRunTokenVersion as coreIsNewerRunTokenVersion,
  versionsAgree as coreVersionsAgree,
} from "@wcdraft/core";

import { loadMarketingGameData } from "../engine/game-data.ts";
import {
  buildTokenBodyFromDraft,
  decodeRunToken as marketingDecodeRunToken,
  encodeRunTokenV2,
  isNewerRunTokenVersion as marketingIsNewerRunTokenVersion,
  versionsAgree as marketingVersionsAgree,
  type RunTokenV2Body,
} from "../engine/token.ts";

function mintToken(seed: string, overrides: Partial<Omit<RunTokenV2Body, "v">> = {}) {
  const gd = loadMarketingGameData();
  const draft = autoDraft({
    run_id: "mkt-token-parity",
    parent_seed: seed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Parity XI",
    dataset_version: gd.versions.dataset_version,
    rating_version: gd.versions.rating_version,
    engine_version: gd.versions.engine_version,
    dataset: gd.draftDataset,
  });
  const body = { ...buildTokenBodyFromDraft(draft, gd, seed), ...overrides };
  return { gd, body, token: encodeRunTokenV2(body) };
}

describe("marketing token decoder parity", () => {
  it("decodes the same web t2 token body, including optional OG summary", () => {
    const { token } = mintToken("wcdraft:mkt:token-parity:1", {
      og: { w: 5, l: 3, mp: 8, gf: 14, ga: 9, rr: "QF", ch: false, sw: 1 },
    });

    const marketing = marketingDecodeRunToken(token);
    const core = coreDecodeRunToken(token);

    expect(marketing).toEqual(core);
    expect(marketing).toMatchObject({
      v: 2,
      og: { w: 5, l: 3, mp: 8, gf: 14, ga: 9, rr: "QF", ch: false, sw: 1 },
    });
  });

  it("handles version-skewed t2 tokens identically", () => {
    const { gd, body } = mintToken("wcdraft:mkt:token-parity:2");
    const skewed = encodeRunTokenV2({ ...body, dv: "1999-01-01" });

    const marketing = marketingDecodeRunToken(skewed);
    const core = coreDecodeRunToken(skewed);

    expect(marketing).toEqual(core);
    expect(marketing).not.toBeNull();
    expect(core).not.toBeNull();
    if (!marketing || !core) return;
    expect(marketingVersionsAgree(marketing, gd.versions)).toBe(false);
    expect(marketingVersionsAgree(marketing, gd.versions)).toBe(
      coreVersionsAgree(core, gd.versions),
    );
  });

  it("rejects malformed tokens and classifies newer tokens identically", () => {
    for (const value of ["", "not-a-token", "run-v1-abc123", "t1.", "t2.not-json"]) {
      expect(marketingDecodeRunToken(value)).toBeNull();
      expect(marketingDecodeRunToken(value)).toBe(coreDecodeRunToken(value));
      expect(marketingIsNewerRunTokenVersion(value)).toBe(coreIsNewerRunTokenVersion(value));
    }

    const newer = "t3.eyJ2IjozfQ";
    expect(marketingDecodeRunToken(newer)).toBeNull();
    expect(coreDecodeRunToken(newer)).toBeNull();
    expect(marketingIsNewerRunTokenVersion(newer)).toBe(true);
    expect(marketingIsNewerRunTokenVersion(newer)).toBe(coreIsNewerRunTokenVersion(newer));
  });
});
