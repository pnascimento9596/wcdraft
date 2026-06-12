import { describe, expect, it } from "vitest";
import { autoDraft } from "@wcdraft/core";

import { loadMarketingGameData, simulateDraft } from "../engine/game-data.ts";
import { buildTokenBodyFromDraft, encodeRunTokenV2, type RunTokenV2Body } from "../engine/token.ts";
import { runFromToken } from "../engine/run-from-token.ts";

// A real, deterministic run minted from the committed bundle. The token embeds
// the current version anchors, so this regenerates each run — never a brittle
// hardcoded record. The hard guarantees: the from-token result reproduces the
// direct sim exactly (faithful decode/replay/world-assembly), and honest-state
// fires on every off-nominal token.
function mintRun(seed: string) {
  const gd = loadMarketingGameData();
  const draft = autoDraft({
    run_id: "mkt-test",
    parent_seed: seed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Test XI",
    dataset_version: gd.versions.dataset_version,
    rating_version: gd.versions.rating_version,
    engine_version: gd.versions.engine_version,
    dataset: gd.draftDataset,
  });
  const direct = simulateDraft(gd, draft, seed);
  const body = buildTokenBodyFromDraft(draft, gd, seed);
  const token = encodeRunTokenV2(body);
  return { gd, draft, direct, body, token };
}

describe("runFromToken — real record from a share token", () => {
  it("reproduces the direct sim record exactly (token round-trip is faithful)", () => {
    const { gd, direct, token } = mintRun("wcdraft:mkt:test:1");
    const res = runFromToken(token, gd);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.record).toBe(direct.record);
    expect(res.summary.is_champion).toBe(direct.is_champion);
    expect(res.summary.goals_for).toBe(direct.aggregate.goals_for);
    expect(res.summary.goals_against).toBe(direct.aggregate.goals_against);
    expect(res.summary.wins).toBe(direct.wins);
    expect(res.summary.losses).toBe(direct.losses);
  });

  it("produces a well-formed, honest summary", () => {
    const { gd, token } = mintRun("wcdraft:mkt:test:2");
    const res = runFromToken(token, gd);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = res.summary;
    expect(s.record).toMatch(/^\d+-\d+(?:-\d+)?$/);
    expect(s.is_perfect_eight_zero).toBe(s.wins === 8 && s.draws === 0 && s.losses === 0);
    expect(s.stars.length).toBeLessThanOrEqual(3);
    // Stars are ranked by overall, descending (nulls last).
    const overalls = s.stars.map((x) => x.overall ?? -1);
    for (let i = 1; i < overalls.length; i += 1)
      expect(overalls[i - 1]!).toBeGreaterThanOrEqual(overalls[i]!);
    expect(["All-time", "Post-2000", "Post-2010", "Modern"]).toContain(s.era_label);
  });

  it("honest-state: a tampered token → malformed, never a fabricated stat", () => {
    const { gd, token } = mintRun("wcdraft:mkt:test:3");
    const tampered = token.slice(0, -4) + "ZZZZ";
    const res = runFromToken(tampered, gd);
    // Either the base64/JSON breaks (malformed) or replay can't reproduce it.
    expect(res.ok).toBe(false);
  });

  it("honest-state: a version-skewed token → version_skew (older/newer build angle)", () => {
    const { gd, body } = mintRun("wcdraft:mkt:test:4");
    const skewed: RunTokenV2Body = { v: 2, ...body, dv: "1999-01-01" };
    const token = encodeRunTokenV2({ ...skewed });
    const res = runFromToken(token, gd);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("version_skew");
  });

  it("honest-state: a newer-version (t3.) token → newer_version", () => {
    const res = runFromToken("t3.eyJ2IjozfQ", loadMarketingGameData());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("newer_version");
  });

  it("honest-state: foreign / non-token garbage → malformed", () => {
    const res = runFromToken("https://example.com/not-a-token", loadMarketingGameData());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("malformed");
  });
});
