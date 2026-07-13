// UNIT 1 — typed hidden-state seam for the match engine.
//
// `simulateMatchCore` carries an engine-only `__injuredTournamentEnding` stash
// the run loop drains between matches. That stash is NOT part of the public
// `MatchResult` schema and must never reach a serialized result. These tests
// pin the seam at two levels:
//   (a) COMPILE — a value typed as the public `MatchResult` cannot reach the
//       hidden field (`@ts-expect-error`); if anyone re-exposes it on the
//       public type the expectation goes stale and `pnpm typecheck` fails.
//   (b) RUNTIME — a serialized stripped result's key census is EXACTLY the
//       public contract; the un-stripped internal result still carries the
//       stash (so the strip is what removes it, not its mere absence).
//
// This is a pure type-boundary pin: it asserts NO numeric behavior, so it adds
// no golden surface and the sim's deterministic path is untouched.
import { describe, expect, it } from "vitest";

import type { Position, MatchRound } from "../types/primitives.js";
import type { TeamStrength } from "../types/rating.js";
import type { MatchResult } from "../types/sim.js";
import { createRng, deriveSubseed } from "../rng.js";
import { simulateMatchCore, stripInternal, tournamentEndingInjuries } from "./match.js";
import type { CoreMatchInput, InternalMatchResult, SimMember } from "./match.js";

// The exact, ordered public surface of `MatchResult`. Kept as a literal here
// (not derived) so a schema field add/remove forces a deliberate update of
// this census rather than silently passing.
const PUBLIC_MATCH_RESULT_KEYS = [
  "match_id",
  "match_index",
  "round",
  "phase",
  "opponent_team_id",
  "pre_match_win_probability",
  "team_facts",
  "user_goals",
  "opp_goals",
  "user_goals_et",
  "opp_goals_et",
  "shootout",
  "outcome",
  "counts_as_run_win",
  "advanced",
  "lineup",
  "events",
] as const;

const HIDDEN_KEY = "__injuredTournamentEnding";

/** Minimal 16-card 4-3-3 (+5 bench) for one side; weights are uniform-ish. */
function buildSide(side: "user" | "opp", strength: TeamStrength): SimMember[] {
  const STARTERS: Position[] = ["GK", "DF", "DF", "DF", "DF", "MF", "MF", "MF", "FW", "FW", "FW"];
  const members: SimMember[] = [];
  const prefix = side === "user" ? "u" : "o";
  for (let i = 0; i < 16; i++) {
    const started = i < 11;
    const pos: Position = started
      ? STARTERS[i]!
      : i === 11
        ? "GK"
        : i < 14
          ? "DF"
          : i === 14
            ? "MF"
            : "FW";
    members.push({
      side,
      card_id: `${prefix}_c${String(i).padStart(2, "0")}_t99` as SimMember["card_id"],
      player_id: `${prefix}p${String(i).padStart(2, "0")}`,
      tournament_id: 99,
      slot_id: started ? `${prefix}.starter.${i}` : `${prefix}.bench.${i - 11}`,
      position: pos,
      started,
      attackWeight: pos === "FW" ? strength.attack + 5 : pos === "MF" ? strength.midfield : 1,
      creativeWeight: pos === "MF" ? strength.midfield + 5 : 1,
    });
  }
  return members;
}

const STRONG: TeamStrength = {
  attack: 82,
  midfield: 80,
  defense: 78,
  goalkeeping: 79,
  coverage: 1,
};
const WEAK: TeamStrength = { attack: 58, midfield: 56, defense: 55, goalkeeping: 57, coverage: 1 };

/** A knockout input — most likely to populate ET/shootout + injury paths. */
function coreInput(label: string): CoreMatchInput {
  const round: MatchRound = "F";
  const seed = `hidden-seam:${label}`;
  return {
    matchId: `hidden.${label}`,
    matchIndex: 0,
    round,
    phase: "knockout",
    opponentTeamId: "HIDDEN-OPP",
    userMembers: buildSide("user", STRONG),
    oppMembers: buildSide("opp", WEAK),
    userStrength: STRONG,
    oppStrength: WEAK,
    structRng: createRng(deriveSubseed(seed, "match_sim", "match:0")),
    eventRng: createRng(deriveSubseed(seed, "event_gen", "match:0")),
  };
}

describe("match hidden-state seam — compile boundary", () => {
  it("the hidden stash is unreachable through the public MatchResult type", () => {
    // `simulateMatchCore` returns the internal type, which widens cleanly to
    // the public boundary type.
    const pub: MatchResult = simulateMatchCore(coreInput("compile"));

    // @ts-expect-error — `__injuredTournamentEnding` is NOT a member of the
    // public `MatchResult`; reading it through this type must not compile. If
    // someone re-exposes the field on `MatchResult`, this directive goes
    // unused and `tsc` fails the build.
    void pub.__injuredTournamentEnding;

    // The internal type, by contrast, exposes it as a typed `readonly string[]`.
    const internal: InternalMatchResult = simulateMatchCore(coreInput("compile"));
    const stash: readonly string[] = internal.__injuredTournamentEnding;
    expect(Array.isArray(stash)).toBe(true);
  });
});

describe("match hidden-state seam — runtime key census", () => {
  it("the un-stripped internal result carries the hidden stash", () => {
    const internal = simulateMatchCore(coreInput("internal"));
    expect(Object.keys(internal)).toContain(HIDDEN_KEY);
    expect(tournamentEndingInjuries(internal)).toBe(internal.__injuredTournamentEnding);
  });

  it("a stripped, serialized result's keys are EXACTLY the public contract", () => {
    const stripped = stripInternal(simulateMatchCore(coreInput("strip")));

    // Serialize the way a result actually crosses the wire — JSON drops any
    // non-enumerable trickery and proves the on-wire shape.
    const serialized = JSON.parse(JSON.stringify(stripped)) as Record<string, unknown>;
    const keys = Object.keys(serialized);

    expect(keys).not.toContain(HIDDEN_KEY);
    expect([...keys].sort()).toEqual([...PUBLIC_MATCH_RESULT_KEYS].sort());
    // Key ORDER is preserved across the strip (byte-identity of serialized form).
    expect(keys).toEqual([...PUBLIC_MATCH_RESULT_KEYS]);
  });

  it("strip is a pure projection: every public field survives byte-equal", () => {
    const internal = simulateMatchCore(coreInput("project"));
    const stripped = stripInternal(internal);
    const strippedRec = stripped as unknown as Record<string, unknown>;
    const internalRec = internal as unknown as Record<string, unknown>;
    for (const k of PUBLIC_MATCH_RESULT_KEYS) {
      expect(JSON.stringify(strippedRec[k])).toEqual(JSON.stringify(internalRec[k]));
    }
  });
});
