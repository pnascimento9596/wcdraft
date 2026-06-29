// F-4 U2 — negative tests, one per threat (plan §8), plus pipeline-order and
// determinism locks for the pure validation core.
//
// Threat coverage map:
//   T1 fabricated pick  → "keystone" describe (roster-mate NOT in the spin's
//                          re-derived rolled_card_ids → ILLEGAL_PICK)
//   T2 tampered score   → SCORE_MISMATCH, claimed never persisted
//   T4 duplicate pick / manager twice → ILLEGAL_PICK at replay
//   T5 name abuse       → INVALID_NAME matrix
//   wrong season        → six anchor-flip cases, each rejected alone
//   oversize/malformed  → TOKEN_TOO_LARGE / INVALID_BODY / MALFORMED_TOKEN
//
// All tokens here are crafted from a real autoDraft origin over the committed
// bundles, then tampered at the JSON layer (the same trust boundary an
// attacker controls — tokens are unsigned by design).

import { describe, expect, it } from "vitest";

import {
  buildRunTokenBody,
  decodeRunToken,
  type RunTokenV1Body,
  type RunTokenV2Body,
} from "../../game/run-token";
import { dailyChallengeForDate, deriveDailySeed } from "../../game/daily";
import { DISPLAY_NAME_MAX, validateDisplayName } from "../display-name";
import { DEFAULT_LEADERBOARD_SEASON_ID } from "../season";
import {
  SUBMIT_ERROR_HTTP_STATUS,
  validateSubmission,
  type SubmissionBody,
  type ValidationData,
} from "../validate";
import {
  buildOriginRecord,
  buildServerGameData,
  encodeBody,
  expectedRunFor,
  serverScenarioBundle,
} from "./_harness";

// ─── Shared origin run (module-scope: one autoDraft + one sim) ──────────────

const data: ValidationData = {
  gameData: buildServerGameData(),
  scenario: serverScenarioBundle(),
};
const ORIGIN_SEED = "wcdraft:f4-u2:negatives:1";
const origin = buildOriginRecord(data.gameData, ORIGIN_SEED, "classic");
const originExpected = expectedRunFor(data.gameData, data.scenario, origin);
const originBody = (() => {
  // Round-trip through the PRODUCTION encoder so tampering starts from the
  // exact wire shape a real client emits.
  const decoded = decodeRunToken(encodeBody(buildRunTokenBody(origin)));
  if (!decoded) throw new Error("origin token failed to decode");
  return decoded;
})();
const originToken = encodeBody(originBody);

function tampered(mutate: (b: RunTokenV1Body) => void): string {
  const body = JSON.parse(JSON.stringify(originBody)) as RunTokenV1Body;
  mutate(body);
  return encodeBody(body);
}

function dailySubmission(date = "2026-06-29") {
  const challenge = dailyChallengeForDate(date);
  const record = {
    ...buildOriginRecord(data.gameData, challenge.seed, "classic", "Daily XI"),
    challenge,
  };
  const expected = expectedRunFor(data.gameData, data.scenario, record);
  return {
    challenge,
    record,
    expected,
    token: encodeBody(buildRunTokenBody(record)),
  };
}

function submit(overrides: Partial<SubmissionBody>) {
  return validateSubmission(
    {
      token: originToken,
      claimed_score: originExpected.score,
      draft_mode: "classic",
      display_name: "honest_player",
      ...overrides,
    },
    data,
  );
}

function rejectionCode(v: ReturnType<typeof validateSubmission>): string | null {
  return v.status === "rejected" ? v.code : null;
}

// ─── Step 1 — body shape + size guard (FIRST, before any decode work) ───────

describe("step 1 — shape + size guard", () => {
  it("rejects a non-string token (INVALID_BODY)", () => {
    expect(rejectionCode(submit({ token: 42 }))).toBe("INVALID_BODY");
    expect(rejectionCode(submit({ token: null }))).toBe("INVALID_BODY");
  });

  it("rejects an oversize token (> 8192 chars) with TOKEN_TOO_LARGE", () => {
    const oversize = "t1." + "A".repeat(8200);
    expect(rejectionCode(submit({ token: oversize }))).toBe("TOKEN_TOO_LARGE");
  });

  it("rejects a non-integer claimed_score (INVALID_BODY)", () => {
    expect(rejectionCode(submit({ claimed_score: 1.5 }))).toBe("INVALID_BODY");
    expect(rejectionCode(submit({ claimed_score: "12" }))).toBe("INVALID_BODY");
    expect(rejectionCode(submit({ claimed_score: Number.NaN }))).toBe("INVALID_BODY");
  });

  it("rejects a missing or unknown draft_mode (INVALID_BODY)", () => {
    expect(rejectionCode(submit({ draft_mode: undefined }))).toBe("INVALID_BODY");
    expect(rejectionCode(submit({ draft_mode: "all" }))).toBe("INVALID_BODY");
  });

  it("ORDER LOCK: size guard fires before name validation", () => {
    const oversize = "t1." + "A".repeat(8200);
    const v = submit({ token: oversize, display_name: "x" });
    expect(rejectionCode(v)).toBe("TOKEN_TOO_LARGE");
  });
});

// ─── Step 2 — malformed tokens ───────────────────────────────────────────────

describe("step 2 — malformed tokens (MALFORMED_TOKEN)", () => {
  it("rejects a truncated token", () => {
    expect(rejectionCode(submit({ token: originToken.slice(0, 40) }))).toBe("MALFORMED_TOKEN");
  });

  it("rejects an empty payload", () => {
    expect(rejectionCode(submit({ token: "t1." }))).toBe("MALFORMED_TOKEN");
  });

  it("rejects a wrong pick count (16 and 18 picks)", () => {
    const t18 = tampered((b) => {
      b.pl.push({ k: "p", c: "fake", s: "fake" });
    });
    const t16 = tampered((b) => {
      b.pl.pop();
    });
    expect(rejectionCode(submit({ token: t18 }))).toBe("MALFORMED_TOKEN");
    expect(rejectionCode(submit({ token: t16 }))).toBe("MALFORMED_TOKEN");
  });

  it("rejects an unknown token version (v:3)", () => {
    const t = tampered((b) => {
      (b as { v: number }).v = 3;
    });
    expect(rejectionCode(submit({ token: t }))).toBe("MALFORMED_TOKEN");
  });

  it("rejects a future `t3.` wire prefix", () => {
    // The UI may show a nicer "newer version" notice, but the API contract is
    // simple: undecodable means MALFORMED_TOKEN.
    const t = "t3." + Buffer.from(JSON.stringify({ v: 3 }), "utf8").toString("base64url");
    expect(rejectionCode(submit({ token: t }))).toBe("MALFORMED_TOKEN");
  });

  it("rejects a wrong mode tag outside the enum (md:'ranked')", () => {
    const t = tampered((b) => {
      (b as { md: string }).md = "ranked";
    });
    expect(rejectionCode(submit({ token: t }))).toBe("MALFORMED_TOKEN");
  });
});

// ─── Step 3 — wrong season: the strict 6-anchor conjunction ─────────────────

describe("step 3 — WRONG_SEASON (each of the six anchors alone)", () => {
  const anchorCases = [
    ["sv", "schema_version"],
    ["dv", "dataset_version"],
    ["rv", "rating_version"],
    ["ev", "engine_version"],
    ["uv", "ruleset_version"],
    ["hv", "data_bundle_hash"],
  ] as const;

  for (const [field, anchor] of anchorCases) {
    it(`flipping ${anchor} (${field}) alone → WRONG_SEASON naming it`, () => {
      const t = tampered((b) => {
        (b as unknown as Record<string, string>)[field] = `${String(b[field])}-skewed`;
      });
      const v = submit({ token: t });
      expect(rejectionCode(v)).toBe("WRONG_SEASON");
      if (v.status === "rejected") {
        expect(v.mismatched_anchors).toEqual([anchor]);
      }
    });
  }

  it("ORDER LOCK: season check fires before name validation", () => {
    const t = tampered((b) => {
      b.ev = `${b.ev}-skewed`;
    });
    const v = submit({ token: t, display_name: "x" });
    expect(rejectionCode(v)).toBe("WRONG_SEASON");
  });
});

// ─── Step 5 — display names (T5) ─────────────────────────────────────────────

describe("step 3b — per-config boards accept every legal config", () => {
  function submitRecord(
    record: typeof origin,
    draftMode: "classic" | "hidden" = record.draft.mode,
  ) {
    const token = encodeBody(buildRunTokenBody(record));
    const expected = expectedRunFor(data.gameData, data.scenario, record);
    return validateSubmission(
      {
        token,
        claimed_score: expected.score,
        draft_mode: draftMode,
        display_name: "config_player",
      },
      data,
    );
  }

  it("accepts rating_basis current and returns the persisted config", () => {
    const record = buildOriginRecord(
      data.gameData,
      `${ORIGIN_SEED}:current`,
      "classic",
      "Current XI",
      {
        ratingBasis: "current",
      },
    );
    const v = submitRecord(record);
    expect(v.status).toBe("accepted");
    if (v.status !== "accepted") return;
    expect(v.draft_order).toBe("squad_first");
    expect(v.era).toBe("all_time");
    expect(v.rating_basis).toBe("current");
  });

  it("accepts bounded era presets and returns the era id", () => {
    const record = buildOriginRecord(
      data.gameData,
      `${ORIGIN_SEED}:modern`,
      "classic",
      "Modern XI",
      {
        eraPreset: "modern",
      },
    );
    const v = submitRecord(record);
    expect(v.status).toBe("accepted");
    if (v.status !== "accepted") return;
    expect(v.era).toBe("modern");
  });

  it("accepts position_first tokens and returns draft_order", () => {
    const record = buildOriginRecord(data.gameData, `${ORIGIN_SEED}:pf`, "classic", "PF XI", {
      draftFlow: "position_first",
    });
    const v = submitRecord(record);
    expect(v.status).toBe("accepted");
    if (v.status !== "accepted") return;
    expect(v.draft_order).toBe("position_first");
  });

  it("a bad name on a legal non-canonical config still rejects before replay", () => {
    const record = buildOriginRecord(
      data.gameData,
      `${ORIGIN_SEED}:badname`,
      "classic",
      "Bad Name XI",
      {
        ratingBasis: "current",
      },
    );
    const token = encodeBody(buildRunTokenBody(record));
    const expected = expectedRunFor(data.gameData, data.scenario, record);
    expect(
      rejectionCode(
        validateSubmission(
          {
            token,
            claimed_score: expected.score,
            draft_mode: "classic",
            display_name: "x",
          },
          data,
        ),
      ),
    ).toBe("INVALID_NAME");
  });
});

describe("daily challenge contract", () => {
  it("accepts a canonical daily token only on the matching daily date", () => {
    const daily = dailySubmission();
    const v = validateSubmission(
      {
        token: daily.token,
        claimed_score: daily.expected.score,
        draft_mode: "classic",
        display_name: "daily_player",
        challenge: "daily",
        challenge_date: daily.challenge.date,
      },
      data,
    );
    expect(v.status).toBe("accepted");
    if (v.status !== "accepted") return;
    expect(v.challenge_type).toBe("daily");
    expect(v.challenge_date).toBe("2026-06-29");
    expect(v.token_body.ps).toBe(deriveDailySeed("2026-06-29"));
    expect(v.draft_order).toBe("squad_first");
    expect(v.era).toBe("all_time");
    expect(v.rating_basis).toBe("career");
  });

  it("rejects daily tokens posted to the season board", () => {
    const daily = dailySubmission();
    expect(
      rejectionCode(
        validateSubmission(
          {
            token: daily.token,
            claimed_score: daily.expected.score,
            draft_mode: "classic",
            display_name: "daily_player",
            challenge: "season",
          },
          data,
        ),
      ),
    ).toBe("INVALID_BODY");
  });

  it("rejects forged daily date/seed metadata before replay", () => {
    const daily = dailySubmission();
    const decoded = decodeRunToken(daily.token);
    expect(decoded?.v).toBe(2);
    const body = JSON.parse(JSON.stringify(decoded)) as RunTokenV2Body;
    body.ch = { k: "daily", d: "2026-06-30", s: daily.challenge.seed };
    const forged = encodeBody(body);

    expect(
      rejectionCode(
        validateSubmission(
          {
            token: forged,
            claimed_score: daily.expected.score,
            draft_mode: "classic",
            display_name: "daily_player",
            challenge: "daily",
            challenge_date: "2026-06-30",
          },
          data,
        ),
      ),
    ).toBe("INVALID_BODY");
  });

  it("still rejects illegal daily picks through the replay keystone", () => {
    const daily = dailySubmission();
    const decoded = decodeRunToken(daily.token);
    expect(decoded?.v).toBe(2);
    const body = JSON.parse(JSON.stringify(decoded)) as RunTokenV2Body;
    const picks = body.pl
      .map((p, i) => ({ p, i }))
      .filter((x): x is { p: { k: "p"; c: string; s: string }; i: number } => x.p.k === "p");
    const [first, , , second] = picks;
    body.pl[second!.i] = { ...second!.p, c: first!.p.c };

    expect(
      rejectionCode(
        validateSubmission(
          {
            token: encodeBody(body),
            claimed_score: daily.expected.score,
            draft_mode: "classic",
            display_name: "daily_player",
            challenge: "daily",
            challenge_date: daily.challenge.date,
          },
          data,
        ),
      ),
    ).toBe("ILLEGAL_PICK");
  });

  it("rejects non-canonical daily configs", () => {
    const challenge = dailyChallengeForDate("2026-06-29");
    const record = {
      ...buildOriginRecord(data.gameData, challenge.seed, "classic", "Daily XI", {
        ratingBasis: "current",
      }),
      challenge,
    };
    const expected = expectedRunFor(data.gameData, data.scenario, record);
    expect(
      rejectionCode(
        validateSubmission(
          {
            token: encodeBody(buildRunTokenBody(record)),
            claimed_score: expected.score,
            draft_mode: "classic",
            display_name: "daily_player",
            challenge: "daily",
            challenge_date: challenge.date,
          },
          data,
        ),
      ),
    ).toBe("INVALID_BODY");
  });

  it("rejects a valid same-seed daily token built for a non-canonical formation", () => {
    const challenge = dailyChallengeForDate("2026-06-29");
    const record = {
      ...buildOriginRecord(data.gameData, challenge.seed, "classic", "Daily XI", {
        formationId: "4-2-3-1",
      }),
      challenge,
    };
    const expected = expectedRunFor(data.gameData, data.scenario, record);

    expect(
      rejectionCode(
        validateSubmission(
          {
            token: encodeBody(buildRunTokenBody(record)),
            claimed_score: expected.score,
            draft_mode: "classic",
            display_name: "daily_player",
            challenge: "daily",
            challenge_date: challenge.date,
          },
          data,
        ),
      ),
    ).toBe("INVALID_BODY");
  });
});

describe("step 5 — display-name rules (plan §5.1)", () => {
  it("rejects through the pipeline with INVALID_NAME + category, raw value not echoed", () => {
    const v = submit({ display_name: "bad-name" });
    expect(rejectionCode(v)).toBe("INVALID_NAME");
    if (v.status === "rejected") {
      expect(v.name_reason).toBe("invalid_chars");
      expect(v.reason).not.toContain("bad-name");
    }
  });

  it("category matrix (unit-level)", () => {
    const cases: Array<[unknown, string | null]> = [
      [42, "not_a_string"],
      ["ab", "too_short"],
      ["  ab  ", "too_short"], // trimmed before measuring
      ["x".repeat(DISPLAY_NAME_MAX + 1), "too_long"],
      ["http://example.com/x", "invalid_chars"], // URL — ':' and '/' excluded
      ["Zer\u200Bo One", "invalid_chars"], // zero-width space (escaped on purpose)
      ["Tab\tName", "invalid_chars"], // control char
      ["has space", "invalid_chars"],
      ["has.dots", "invalid_chars"],
      ["admin", "blocked_term"],
      ["api", "blocked_term"],
      ["mod", "blocked_term"],
      ["WcDrAfT", "blocked_term"], // reserved exact word, case-folded
      ["xxniggerxx", "blocked_term"], // original local abuse stem list
      ["abc", null],
      ["_leading", null],
      ["trailing_", null],
      ["muller_sao_10", null],
      ["jose10", null],
    ];
    for (const [raw, expected] of cases) {
      const r = validateDisplayName(raw);
      if (expected === null) {
        expect(r.ok, `expected OK for ${String(raw)}`).toBe(true);
      } else {
        expect(r.ok, `expected ${expected} for ${String(raw)}`).toBe(false);
        if (!r.ok) expect(r.reason).toBe(expected);
      }
    }
  });

  it("normalizes (trim + lowercase) and returns the persistable form", () => {
    const r = validateDisplayName("  Honest_Player  ");
    expect(r).toEqual({ ok: true, name: "honest_player" });
  });

  it("ORDER LOCK: name validation fires before the replay keystone", () => {
    // Token has BOTH a fabricated pick and a bad name → INVALID_NAME wins
    // (cheapest-rejection-first: no CPU-bound replay for a bad name).
    const t = tampered((b) => {
      const i = b.pl.findIndex((p) => p.k === "p");
      (b.pl[i] as { c: string }).c = "p99999_t1"; // garbage card
    });
    const v = submit({ token: t, display_name: "bad-name" });
    expect(rejectionCode(v)).toBe("INVALID_NAME");
  });
});

// ─── Step 7 — THE KEYSTONE: draft legality via full replay (T1) ─────────────

/**
 * What "not offered" means here: a spin's re-derived candidate pool is the
 * FULL roster of its seed-drawn (tournament, nation) minus already-picked
 * players (verified empirically: rolled_card_ids length === roster length on
 * every spin of this origin). So a fabricated pick is necessarily a card from
 * a (T, N) the seed never rolled for that spin — exactly threat T1's "swap in
 * a legend the spin never offered".
 *
 * The rolled_card_ids membership check is the FIRST of the seed-derived
 * guards in `pickPlayer` (membership → tournament-match → roster lookup), so
 * the keystone tests assert its message contract ("not a candidate"), not
 * just the verdict code. MUTATE-AND-FAIL: loosening the membership check in
 * packages/core/src/draft.ts flips these tests red — the rejection then
 * surfaces from a later guard with a different message (or, for an in-roster
 * fabrication, not at all).
 */
function fabricatedPickToken(
  pickCard: (
    spin: { tournament_id: number; nation_id: string },
    pickedPlayerIds: ReadonlySet<string>,
  ) => { card_id: string } | undefined,
): { spinIndex: number; token: string } {
  const pickedPlayerIds = new Set(
    origin.draft.squad.flatMap((s) => (s.player_id ? [s.player_id] : [])),
  );
  const spin = [...origin.draft.spins]
    .sort((a, b) => a.index - b.index)
    .find((s) => s.picked_kind === "player");
  if (!spin) throw new Error("origin draft has no player pick");
  const fabricated = pickCard(spin, pickedPlayerIds);
  if (!fabricated) throw new Error("no fabricated card found — origin seed unusable");
  const token = tampered((b) => {
    (b.pl[spin.index] as { c: string }).c = fabricated.card_id;
  });
  return { spinIndex: spin.index, token };
}

/** Highest-overall card outside the spin's (T, N) — "a legend not offered". */
function legendOutsideSpin(
  spin: { tournament_id: number; nation_id: string },
  picked: ReadonlySet<string>,
): { card_id: string } | undefined {
  let best: { card_id: string; overall: number } | undefined;
  for (const c of data.gameData.draftPool.player_cards) {
    if (c.tournament_id === spin.tournament_id && c.nation_id === spin.nation_id) continue;
    if (picked.has(c.player_id)) continue;
    const overall = data.gameData.indexes.ratingByCardId.get(c.card_id)?.overall;
    if (overall === null || overall === undefined) continue;
    if (!best || overall > best.overall || (overall === best.overall && c.card_id < best.card_id)) {
      best = { card_id: c.card_id, overall };
    }
  }
  return best;
}

describe("step 7 — keystone: replay rejects picks outside rolled_card_ids", () => {
  it("T1 fabricated pick: a legend the spin never offered → ILLEGAL_PICK at that spin", () => {
    const { spinIndex, token } = fabricatedPickToken(legendOutsideSpin);
    const v = submit({ token });
    expect(rejectionCode(v)).toBe("ILLEGAL_PICK");
    if (v.status === "rejected") {
      // RunTokenError message contract: names the failing spin + the rolled
      // membership rejection from pickPlayer.
      expect(v.reason).toContain(`spin ${spinIndex}`);
      expect(v.reason).toContain("not a candidate");
    }
  });

  it("T1 variant: same tournament, different nation — membership still fires first", () => {
    const { spinIndex, token } = fabricatedPickToken((spin, picked) =>
      data.gameData.draftPool.player_cards.find(
        (c) =>
          c.tournament_id === spin.tournament_id &&
          c.nation_id !== spin.nation_id &&
          !picked.has(c.player_id),
      ),
    );
    const v = submit({ token });
    expect(rejectionCode(v)).toBe("ILLEGAL_PICK");
    if (v.status === "rejected") {
      expect(v.reason).toContain(`spin ${spinIndex}`);
      expect(v.reason).toContain("not a candidate");
    }
  });

  it("duplicate pick: the same card claimed on two spins → ILLEGAL_PICK", () => {
    const t = tampered((b) => {
      const picks = b.pl
        .map((p, i) => ({ p, i }))
        .filter((x): x is { p: { k: "p"; c: string; s: string }; i: number } => x.p.k === "p");
      const [first, , , second] = picks;
      (b.pl[second!.i] as { c: string }).c = first!.p.c;
    });
    expect(rejectionCode(submit({ token: t }))).toBe("ILLEGAL_PICK");
  });

  it("manager twice: a second {k:'m'} entry → ILLEGAL_PICK", () => {
    // Replace the first player pick with a manager pick; the original manager
    // entry stays, so the log claims two coaches. Whichever fails first
    // (no coach offered on that spin, or "already drafted") is a replay throw.
    const t = tampered((b) => {
      const pIdx = b.pl.findIndex((p) => p.k === "p");
      b.pl[pIdx] = { k: "m" };
    });
    expect(rejectionCode(submit({ token: t }))).toBe("ILLEGAL_PICK");
  });

  it("occupied slot: two picks claiming the same slot → ILLEGAL_PICK", () => {
    const t = tampered((b) => {
      const picks = b.pl
        .map((p, i) => ({ p, i }))
        .filter((x): x is { p: { k: "p"; c: string; s: string }; i: number } => x.p.k === "p");
      const [first, second] = picks;
      (b.pl[second!.i] as { s: string }).s = first!.p.s;
    });
    expect(rejectionCode(submit({ token: t }))).toBe("ILLEGAL_PICK");
  });
});

// ─── Steps 8–9 — score authority (T2) ────────────────────────────────────────

describe("step 9 — SCORE_MISMATCH (T2 tampered score)", () => {
  it("claimed_score off by one → SCORE_MISMATCH naming both numbers", () => {
    const v = submit({ claimed_score: originExpected.score + 1 });
    expect(rejectionCode(v)).toBe("SCORE_MISMATCH");
    if (v.status === "rejected") {
      expect(v.reason).toContain(String(originExpected.score + 1));
      expect(v.reason).toContain(String(originExpected.score));
    }
  });
});

// ─── Acceptance + mode-tag semantics + determinism ──────────────────────────

describe("acceptance contract", () => {
  it("the honest origin run is ACCEPTED with canonical fields", () => {
    const v = submit({ display_name: "  Honest_Player  " });
    expect(v.status).toBe("accepted");
    if (v.status !== "accepted") return;
    expect(v.verified_score).toBe(originExpected.score);
    expect(v.season_key).toBe(DEFAULT_LEADERBOARD_SEASON_ID);
    expect(v.draft_mode).toBe("classic");
    expect(v.draft_order).toBe("squad_first");
    expect(v.era).toBe("all_time");
    expect(v.rating_basis).toBe("career");
    expect(v.display_alias).toBe("honest_player"); // normalized, not raw
    expect(v.token_body.ps).toBe(ORIGIN_SEED);
  });

  it("hidden mode remains re-sim/display-only when the requested lane matches", () => {
    // `md` never feeds spin derivation or the sim — the blind seam is display
    // only. A token that declares Memory must target the Memory lane, but the
    // replay and score path stay mode-agnostic.
    const t = tampered((b) => {
      b.md = "hidden";
    });
    const v = submit({ token: t, draft_mode: "hidden" });
    expect(v.status).toBe("accepted");
    if (v.status !== "accepted") return;
    expect(v.draft_mode).toBe("hidden");
    expect(v.verified_score).toBe(originExpected.score);
  });

  it("cross-lane mismatch rejects before replay persistence", () => {
    expect(rejectionCode(submit({ draft_mode: "hidden" }))).toBe("INVALID_BODY");
    const hiddenToken = tampered((b) => {
      b.md = "hidden";
    });
    expect(rejectionCode(submit({ token: hiddenToken, draft_mode: "classic" }))).toBe(
      "INVALID_BODY",
    );
  });

  it("rejected verdicts are deterministic too (two runs, deep-equal)", () => {
    const { token } = fabricatedPickToken(legendOutsideSpin);
    const a = submit({ token });
    const b = submit({ token });
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
  });
});

// ─── Seam lock: the HTTP map the route (U3) will consume ────────────────────

describe("U3 seam — SUBMIT_ERROR_HTTP_STATUS", () => {
  it("maps every code to the plan §2 status", () => {
    expect(SUBMIT_ERROR_HTTP_STATUS).toEqual({
      INVALID_BODY: 400,
      TOKEN_TOO_LARGE: 400,
      MALFORMED_TOKEN: 400,
      WRONG_SEASON: 409,
      AUTH_REQUIRED: 401,
      CSRF_FAILED: 403,
      INVALID_NAME: 422,
      RATE_LIMITED: 429,
      BAD_ATTEMPT: 403,
      ILLEGAL_PICK: 422,
      SIM_FAILURE: 500,
      SCORE_MISMATCH: 422,
    });
  });
});
