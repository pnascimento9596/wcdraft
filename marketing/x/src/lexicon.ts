// Banned-lexicon + affiliation guard.
//
// Licensing/terminology guardrails (CLAUDE.md + Claude.ai project rules) are
// enforced mechanically on every rendered post BEFORE it can be queued or
// published:
//   - "Synergy" not "Chemistry"
//   - "football" not "soccer"
//   - "manager" not "coach"
//   - nominative "World Cup" only — no "FIFA" mark, no proprietary game ratings
//   - no claim of affiliation / endorsement / official status
//
// `assertClean` throws on any violation; the composer calls it on every post
// and the test-suite asserts it across every template family. A reviewer
// independently re-runs these checks against the dry-run artifact.

export interface LexiconViolation {
  term: string;
  reason: string;
  /** The matched substring, for the error message. */
  match: string;
}

interface BannedRule {
  /** Case-insensitive, global regex. Use \b boundaries to avoid false hits. */
  rx: RegExp;
  reason: string;
}

const BANNED: BannedRule[] = [
  { rx: /\bchemistry\b/giu, reason: 'use "Synergy", never "Chemistry"' },
  { rx: /\bsoccer\b/giu, reason: 'use "football", never "soccer"' },
  // "coach"/"coaches"/"coaching" — we say manager. (Avoids "coachable" etc. via
  // explicit alternation rather than a broad \bcoach\w* that could over-match.)
  { rx: /\bcoach(?:es|ing|ed)?\b/giu, reason: 'use "manager", never "coach"' },
  { rx: /\bf\.?i\.?f\.?a\b/giu, reason: 'no FIFA mark — "World Cup" is nominative-use only' },
  { rx: /\bpanini\b/giu, reason: "no third-party trading-card / sticker brand" },
  // Proprietary game-ratings families (licensing firewall).
  { rx: /\bfut\b/giu, reason: "no proprietary game-mode reference" },
  { rx: /\bultimate team\b/giu, reason: "no proprietary game-mode reference" },
];

// Affiliation / endorsement claims. wcdraft is fan-made and unaffiliated; the
// account bio carries the disclaimer and our copy must never imply otherwise.
const AFFILIATION: BannedRule[] = [
  { rx: /\bofficial(?:ly)?\b/giu, reason: "no 'official' — wcdraft is fan-made and unaffiliated" },
  { rx: /\bendors(?:e|ed|es|ement)\b/giu, reason: "no endorsement claim" },
  { rx: /\baffiliat(?:e|ed|ion)\b/giu, reason: "no affiliation claim" },
  { rx: /\bin partnership\b/giu, reason: "no partnership claim" },
  { rx: /\bsponsored by\b/giu, reason: "no sponsorship claim" },
];

const ALL_RULES: BannedRule[] = [...BANNED, ...AFFILIATION];

/** Return every lexicon/affiliation violation in `text` (empty = clean). */
export function checkLexicon(text: string): LexiconViolation[] {
  const out: LexiconViolation[] = [];
  for (const rule of ALL_RULES) {
    rule.rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.rx.exec(text)) !== null) {
      out.push({ term: rule.rx.source, reason: rule.reason, match: m[0] });
      if (m.index === rule.rx.lastIndex) rule.rx.lastIndex += 1; // zero-width guard
    }
  }
  return out;
}

/** Throw a precise error if `text` trips any banned-lexicon rule. */
export function assertClean(text: string, context: string): void {
  const violations = checkLexicon(text);
  if (violations.length > 0) {
    const lines = violations.map((v) => `  - "${v.match}": ${v.reason}`).join("\n");
    throw new Error(`lexicon violation in ${context}:\n${lines}\n  text: ${JSON.stringify(text)}`);
  }
}
