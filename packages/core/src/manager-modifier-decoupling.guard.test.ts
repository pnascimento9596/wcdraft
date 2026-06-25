// DECOUPLING GUARD — `ws-core/decoupling-guards`.
//
// LOADED GUN #1 from the season-merge gate-2 adversarial review:
// `managerModifier()` in `engine/team-strength.ts` USED TO scale the four
// sim channels by `ManagerRating.overall` — a field whose own contract
// (see `types/manager.ts`) is explicit: "the sim MUST NOT read this field."
// It was behaviorally inert against production runtime data — none ships a
// manager rating — but `sim-fixtures.ts` exercised the forbidden path with
// `overall: 80`, and any future runtime that DOES ship a manager rating
// would have silently coupled the sim to a display channel
// (curves, normalisation, display rescaling all flow through `overall`).
//
// THIS TEST is the loud-failure-tomorrow tripwire. Two complementary checks:
//
//   (1) STATIC — scan the core sim source (`engine/*.ts` + `api/*.ts`,
//       excluding tests + scripts + this file) and ASSERT no expression
//       reads `.overall` off a `manager`/`managerRating` identifier. The
//       `types/manager.ts` contract DECL still uses the name on the
//       interface — that file is the contract, not the sim, so it is
//       excluded from the scan.
//
//   (2) FUNCTIONAL — call `aggregateUserXiStrength` with a non-null
//       `ManagerRating` whose `overall` is far from the historical pivot
//       (PIVOT = 50, so `overall=99` would historically have hit the
//       upper modifier band of 1.10), and assert the output channel ints
//       are byte-equal to the `null`-manager case. Identity, no band.
//
// MUTATE-AND-FAIL contract: flip `managerModifier()` to read
// `manager.overall` and rerun this file — BOTH (1) and (2) must fail.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { aggregateUserXiStrength } from "./engine/team-strength.js";
import type { StarterContribution } from "./api/team-strength.js";
import { buildManagerCardId } from "./types/manager.js";
import type { ManagerRating } from "./types/manager.js";
import { buildCardId } from "./types/identity.js";
import type { Rating } from "./types/rating.js";
import type { SynergyResult } from "./types/synergy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── STATIC SCAN ──────────────────────────────────────────────────────────────

const SCAN_ROOTS = [path.join(__dirname, "engine"), path.join(__dirname, "api")];

/** Strip `//` line comments and block comments — the loosest read good
 *  enough to keep contract-doc mentions out of the scan. */
function stripComments(src: string): string {
  // Block comments first (greedy across newlines via [\s\S]).
  const withoutBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Then `//…` line comments.
  return withoutBlock.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function listTsFilesRecursive(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts")) continue;
      if (entry.endsWith(".test.ts")) continue;
      if (entry.endsWith(".d.ts")) continue;
      out.push(full);
    }
  }
  walk(root);
  return out;
}

describe("decoupling guard — no sim path may read ManagerRating.overall", () => {
  it("no `manager.overall` or `managerRating.overall` access in engine/* or api/*", () => {
    // Pattern: identifier `manager` (case-insensitive prefix `manager` ending
    // in `Rating` is also matched) followed by `.overall`, allowing optional
    // chaining. Examples that FAIL: `manager.overall`, `managerRating.overall`,
    // `manager?.overall`, `managerRating?.overall`.
    const FORBIDDEN = /\bmanager(?:Rating)?\??\.overall\b/i;

    const offenders: { file: string; line: number; text: string }[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of listTsFilesRecursive(root)) {
        const src = readFileSync(file, "utf8");
        const lines = stripComments(src).split("\n");
        lines.forEach((line, i) => {
          if (FORBIDDEN.test(line)) {
            offenders.push({ file, line: i + 1, text: line.trim() });
          }
        });
      }
    }

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `decoupling guard breached — re-introduced ManagerRating.overall read(s):\n${offenders
            .map((o) => `  ${path.relative(__dirname, o.file)}:${o.line}  ${o.text}`)
            .join(
              "\n",
            )}\n\nIf you genuinely need a sim-side manager signal, define a sim-legal\nfield on ManagerRating (NOT \`overall\`, which is display-only) and wire\nthat through engine/team-strength.ts instead.`,
    ).toEqual([]);
  });
});

// ─── FUNCTIONAL ASSERTION — IDENTITY FOR ARBITRARY ManagerRating ─────────────

const TID = 17;

function rating(channelValue: number): Rating {
  return {
    card_id: buildCardId(`p${channelValue}`, TID),
    player_id: `p${channelValue}`,
    tournament_id: TID,
    attack: channelValue,
    midfield: channelValue,
    defense: channelValue,
    goalkeeping: channelValue,
    overall: channelValue,
    coverage: 1,
    coverage_basis: "wc_signals",
    provenance: "wc_performance",
    components: [],
    rating_version: "guard-v1",
  } as unknown as Rating;
}

function starters(channelValue: number): readonly StarterContribution[] {
  return Array.from({ length: 11 }, (_, i) => ({
    slot_id: `s${i}`,
    rating: rating(channelValue),
    position_compatibility: 1,
  }));
}

function makeRating(overall: number | null): ManagerRating {
  return {
    manager_card_id: buildManagerCardId("mgr-guard", TID),
    manager_id: "mgr-guard",
    tournament_id: TID,
    overall,
    dimensions: {
      pedigree: overall ?? 50,
      experience: overall ?? 50,
    },
    components: [],
    coverage: 1,
    coverage_basis: "wc_signals",
    provenance: "wc_performance",
    rating_version: "guard-v1",
  };
}

const NEUTRAL_SYNERGY: SynergyResult = {
  overall: 0,
  nation_clusters: 0,
  linked_pairs: 0,
  manager_link: 0,
  multiplier: 1.0,
} as unknown as SynergyResult;

describe("decoupling guard — managerModifier is identity for every ManagerRating", () => {
  it("output channel ints are byte-equal across null / pivot / band-max / band-min managers", () => {
    const base = aggregateUserXiStrength(starters(60), NEUTRAL_SYNERGY, null);

    // Pre-fix behavior would have produced strictly DIFFERENT outputs at
    // overall ∈ {0, 99} (the band extremes) and an equal output at overall=50
    // (the pivot). After the fix, ALL of these must equal `base`.
    const cases: { label: string; overall: number | null }[] = [
      { label: "null", overall: null },
      { label: "pivot (50)", overall: 50 },
      { label: "band-min (0)", overall: 0 },
      { label: "band-max (99)", overall: 99 },
      { label: "off-pivot (80)", overall: 80 },
    ];
    for (const c of cases) {
      const out = aggregateUserXiStrength(starters(60), NEUTRAL_SYNERGY, makeRating(c.overall));
      expect(out, `managerModifier must be identity for ${c.label}`).toEqual(base);
    }
  });
});
