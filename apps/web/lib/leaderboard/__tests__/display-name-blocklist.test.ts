// F-4 U5 — locks the blocklist MATCHING BEHAVIOR and curation invariants,
// not the list contents: terms may be added/removed without touching this
// file, as long as they obey the data file's curation rules.
//
//   - hygiene: every term must already be in matcher form (case-folded,
//     separator-stripped, ≥3 chars) — a term that isn't can NEVER match,
//     which would be a silent curation no-op
//   - behavior: exact reserved platform words plus abuse-stem substring checks
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
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  RESERVED_PUBLIC_NAMES,
  foldForBlocklist,
  validateDisplayName,
} from "../display-name";

const blocked = (raw: string) =>
  expect(validateDisplayName(raw), raw).toEqual({ ok: false, reason: "blocked_term" });
const ok = (raw: string) => expect(validateDisplayName(raw).ok, raw).toBe(true);

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

describe("matching behavior (reserved words + abuse stems)", () => {
  it("matches exact reserved words case-insensitively", () => {
    blocked("admin");
    blocked("ADMIN");
    blocked("api");
    blocked("mod");
    blocked("staff");
    blocked("WcDrAfT");
  });

  it("does not block reserved words when merely embedded", () => {
    ok("admin99");
    ok("modern");
  });

  it("matches original local abuse stems as substrings", () => {
    blocked("xxniggerxx");
    blocked("shitpost");
    blocked("hitler99");
  });

  it("strips underscores before reserved and abuse checks", () => {
    blocked("a_d_m_i_n");
    blocked("f_u_c_k");
    blocked("h_i_t_l_e_r99");
  });

  it("does not match names that merely share letters out of sequence", () => {
    ok("Benjamin");
    ok("Domino");
  });
});

describe("validation properties", () => {
  it("property: canonical allowed names round-trip and uppercase input normalizes", () => {
    for (let i = 0; i < 500; i += 1) {
      const suffix = i.toString(36).padStart(3, "0");
      const name = `user_${suffix}`;
      expect(validateDisplayName(name), name).toEqual({ ok: true, name });
      expect(validateDisplayName(name.toUpperCase()), name).toEqual({ ok: true, name });
    }
  });

  it("property: forbidden characters reject after length passes", () => {
    const forbidden = ["-", ".", " ", "/", "é", "\u200B", "\n"];
    for (const ch of forbidden) {
      for (let i = 0; i < 50; i += 1) {
        const raw = `user${ch}${i.toString(36).padStart(2, "0")}`;
        const result = validateDisplayName(raw);
        expect(result, JSON.stringify(raw)).toEqual({ ok: false, reason: "invalid_chars" });
      }
    }
  });

  it("property: length boundaries are exactly 3 through 20 code points", () => {
    for (let len = 0; len <= 25; len += 1) {
      const raw = "a".repeat(len);
      const result = validateDisplayName(raw);
      if (len < DISPLAY_NAME_MIN) {
        expect(result, `len=${len.toString()}`).toEqual({ ok: false, reason: "too_short" });
      } else if (len > DISPLAY_NAME_MAX) {
        expect(result, `len=${len.toString()}`).toEqual({ ok: false, reason: "too_long" });
      } else {
        expect(result, `len=${len.toString()}`).toEqual({ ok: true, name: raw });
      }
    }
  });

  it("property: reserved words and abuse stems cannot be bypassed with underscores", () => {
    for (const term of RESERVED_PUBLIC_NAMES) {
      blocked(term.toUpperCase());
      blocked(withUnderscores(term));
    }
    for (const term of [...BLOCKED_PROFANITY_TERMS, ...BLOCKED_SLUR_TERMS]) {
      blocked(`x${term}x`);
      blocked(`x${withUnderscores(term)}x`);
    }
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
    expect(validateDisplayName(name).ok, name).toBe(true);
  });
});

function withUnderscores(term: string): string {
  return [...term].join("_");
}
