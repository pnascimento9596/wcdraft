// F-4 U5 — curated display-name blocklist. DATA ONLY: the matching mechanism
// (case-fold → separator-strip → substring) lives in display-name.ts and is
// locked by tests; this file is the list it consumes.
//
// CURATION RULES (how to add/remove a term):
//   1. Terms MUST be pre-normalized: lowercase, no separators (` _.-`) —
//      the matcher compares against a folded+stripped name, so a term that
//      isn't in that form can never match. A hygiene test enforces this.
//   2. Matching is SUBSTRING, so every term hits anything containing it.
//      Before adding a term, check it against common real-world surnames —
//      especially footballer names, given the audience. Severity rule:
//        - slurs stay even with known surname collisions (a slur visible on
//          an international board costs more than a rare rejected name);
//        - mere profanity/impersonation terms are dropped when they collide
//          with prominent real names.
//   3. Removals apply to NEW rows only — names are validated at write
//      (plan §5.5); retroactive sweeps are a manual script.
//
// DELIBERATE EXCLUSIONS (checked and rejected — do not re-add casually):
//   - "mod"   ⊂ Modrić            (impersonation value too low for the hit)
//   - "nazi"  ⊂ Nazir / Benazir   (real given names; "hitler" covers intent)
//   - "slut"  ⊂ Slutsky           (real football manager surname)
//   - "cock"  ⊂ Alcock/Hitchcock  (common English surnames)
//   - "dick"  ⊂ Dickson/Riddick   (common English surnames)
//   - "ass"   ⊂ Hassan/Passi      (far too short/common)
//
// KNOWN ACCEPTED FALSE POSITIVES (severity rule above):
//   - "kike"   ⊂ Kike (Spanish nickname for Enrique — Kike García et al.)
//   - "spic"   ⊂ Spicer
//   - "dyke"   ⊂ Dyke / Van Dyke (e.g. Greg Dyke, ex-FA chairman)
//   - "rapist" ⊂ therapist
//   - "shit"   ⊂ Shittu (accepted since U2)

/** Platform/staff impersonation terms (plan §5.1). */
export const BLOCKED_IMPERSONATION_TERMS: readonly string[] = [
  "admin",
  "moderator",
  "wcdraft",
  "official",
  "sysop",
  "staff",
  "support",
  "system",
];

/** Severe profanity (kept small on purpose — substring matching is blunt). */
export const BLOCKED_PROFANITY_TERMS: readonly string[] = [
  "fuck",
  "shit",
  "cunt",
  "bitch",
  "asshole",
  "whore",
];

/** Slurs + hate/abuse terms — severity rule: these stay despite known FPs. */
export const BLOCKED_SLUR_TERMS: readonly string[] = [
  "nigger",
  "nigga",
  "faggot",
  "kike",
  "spic",
  "chink",
  "wetback",
  "tranny",
  "paki",
  "coon",
  "gook",
  "dyke",
  "retard",
  "hitler",
  "pedo",
  "rapist",
];

/** The flat list the matcher consumes. */
export const DISPLAY_NAME_BLOCKLIST: readonly string[] = [
  ...BLOCKED_IMPERSONATION_TERMS,
  ...BLOCKED_PROFANITY_TERMS,
  ...BLOCKED_SLUR_TERMS,
];
