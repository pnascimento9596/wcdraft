// F-4 U5 — locks the blocklist MATCHING BEHAVIOR and curation invariants,
// not the list contents: terms may be added/removed without touching this
// file, as long as they obey the data file's curation rules.
//
//   - hygiene: every term must already be in matcher form (case-folded,
//     separator-stripped, ≥3 chars) — a term that isn't can NEVER match,
//     which would be a silent curation no-op
//   - behavior: case-fold + separator-strip + substring, proven via the two
//     permanent impersonation sentinels ("admin", "wcdraft")
//   - false-positive guards: the data file's DELIBERATE EXCLUSIONS stay
//     excluded — these break only if someone adds a term colliding with a
//     real-world (football-heavy) name, exactly the regression we fear

import { describe, expect, it } from "vitest";

import {
  BLOCKED_IMPERSONATION_TERMS,
  BLOCKED_PROFANITY_TERMS,
  BLOCKED_SLUR_TERMS,
  DISPLAY_NAME_BLOCKLIST,
} from "../display-name-blocklist";
import { foldForBlocklist, validateDisplayName } from "../display-name";

describe("blocklist hygiene (matcher-form invariants, content-agnostic)", () => {
  it("every term is already case-folded and separator-stripped", () => {
    for (const term of DISPLAY_NAME_BLOCKLIST) {
      expect(term, `"${term}" is not in matcher form`).toBe(foldForBlocklist(term));
    }
  });

  it("every term is ≥3 chars (shorter terms over-block via substring match)", () => {
    for (const term of DISPLAY_NAME_BLOCKLIST) {
      expect(term.length, `"${term}" too short`).toBeGreaterThanOrEqual(3);
    }
  });

  it("no duplicates within or across categories", () => {
    expect(new Set(DISPLAY_NAME_BLOCKLIST).size).toBe(DISPLAY_NAME_BLOCKLIST.length);
  });

  it("the flat list is exactly the three categories concatenated", () => {
    expect(DISPLAY_NAME_BLOCKLIST).toEqual([
      ...BLOCKED_IMPERSONATION_TERMS,
      ...BLOCKED_PROFANITY_TERMS,
      ...BLOCKED_SLUR_TERMS,
    ]);
  });
});

describe("matching behavior (via permanent impersonation sentinels)", () => {
  const blocked = (raw: string) =>
    expect(validateDisplayName(raw), raw).toEqual({ ok: false, reason: "blocked_term" });
  const ok = (raw: string) => expect(validateDisplayName(raw).ok, raw).toBe(true);

  it("matches exact, embedded, case-varied, and separator-spaced forms", () => {
    blocked("admin");
    blocked("xXadminXx");
    blocked("ADMIN99");
    blocked("A.d_m-i n9"); // separator-stripped fold defeats spacing tricks
    blocked("WcDrAfT Team");
    blocked("w_c_d_r_a_f_t");
  });

  it("does not match names that merely share letters out of sequence", () => {
    ok("Benjamin");
    ok("Domino");
  });
});

describe("false-positive guards (deliberate exclusions stay excluded)", () => {
  // Real-world (mostly football) names the curation rules protect. If one of
  // these starts failing, a newly added term collides with real users —
  // re-read the curation rules in display-name-blocklist.ts before shipping.
  const PROTECTED_NAMES = [
    "Modric", // would be hit by "mod"
    "Nazir", // would be hit by "nazi"
    "Benazir", // would be hit by "nazi"
    "Slutsky", // would be hit by "slut"
    "Hitchcock", // would be hit by "cock"
    "Alcock", // would be hit by "cock"
    "Dickson", // would be hit by "dick"
    "Hassan", // would be hit by "ass"
    "Sampedro", // near-miss for "pedo"
  ];

  it.each(PROTECTED_NAMES)("%s remains a valid display name", (name: string) => {
    expect(validateDisplayName(name)).toEqual({ ok: true, name });
  });
});
