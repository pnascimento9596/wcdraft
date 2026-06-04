// Deterministic token resolution over `NarrativeFacts` (+ the run/matches).
//
// EVENT-LOG-DRIVEN, NO GUESSING: every token resolves from the derived facts
// (which themselves come from the event log) plus optional display labels. A
// token with no source resolves to `null` (honest-state); the fill step then
// renders `null` as `UNAVAILABLE_TOKEN_TEXT`. IDs fall back to themselves —
// a real, event-derived value, never an invented name.

import type { KeyMoment, NarrativeFacts, NarrativeLabels, TokenName } from "../types/narrative.js";
import type { RunResult } from "../types/run.js";

/** Rendered in place of any token that resolves to `null`. */
export const UNAVAILABLE_TOKEN_TEXT = "Unavailable";

/**
 * Static phrase for each `KeyMoment.kind`. Used to render the {KEY_MOMENT}
 * token. Authored copy — football register, no marks.
 */
const KEY_MOMENT_PHRASE: Record<KeyMoment["kind"], string> = {
  late_winner: "a late winner",
  stoppage_winner: "a stoppage-time winner",
  early_lead: "an early breakthrough",
  equalizer: "a vital equaliser",
  comeback_win: "a stirring comeback",
  shootout_win: "a penalty shootout held",
  shootout_loss: "a penalty shootout heartbreak",
  shock_loss: "a shock defeat",
  thrashing: "an emphatic win",
  red_card_swing: "a red-card swing",
  missed_penalty: "a missed penalty",
};

/**
 * Headline priority — the more narratively decisive a moment, the earlier it
 * appears. The headline moment is the highest-priority moment present;
 * ties break to the LATEST round then latest minute (the drama nearest the
 * end of the run reads as the defining one).
 */
const HEADLINE_PRIORITY: KeyMoment["kind"][] = [
  "shootout_win",
  "comeback_win",
  "stoppage_winner",
  "late_winner",
  "shootout_loss",
  "shock_loss",
  "red_card_swing",
  "missed_penalty",
  "thrashing",
  "equalizer",
  "early_lead",
];

const ROUND_ORDER: Record<string, number> = {
  G1: 0,
  G2: 1,
  G3: 2,
  R32: 3,
  R16: 4,
  QF: 5,
  SF: 6,
  F: 7,
};

/**
 * Pick the single headline moment from the facts' chronological list, or null
 * when there were no dramatic moments. Deterministic: priority, then latest
 * round, then latest minute, then stable on `match_id`.
 */
export function headlineMoment(facts: NarrativeFacts): KeyMoment | null {
  let best: KeyMoment | null = null;
  for (const mo of facts.key_moments) {
    if (best === null || beatsHeadline(mo, best)) best = mo;
  }
  return best;
}

function beatsHeadline(a: KeyMoment, b: KeyMoment): boolean {
  const ap = HEADLINE_PRIORITY.indexOf(a.kind);
  const bp = HEADLINE_PRIORITY.indexOf(b.kind);
  if (ap !== bp) return ap < bp; // lower index = higher priority
  const ar = ROUND_ORDER[a.round] ?? -1;
  const br = ROUND_ORDER[b.round] ?? -1;
  if (ar !== br) return ar > br; // later round wins
  if (a.minute !== b.minute) return a.minute > b.minute; // later minute wins
  return a.match_id < b.match_id; // stable final tiebreak
}

/** Resolve a player id to its display label, falling back to the raw id. */
function playerLabel(id: string | null, labels?: NarrativeLabels): string | null {
  if (id === null) return null;
  return labels?.player_names?.[id] ?? id;
}

/** Resolve a team id to its display label, falling back to the raw id. */
function teamLabel(id: string | null, labels?: NarrativeLabels): string | null {
  if (id === null) return null;
  return labels?.team_names?.[id] ?? id;
}

/**
 * Resolve every `TokenName` to a string value or `null` (no source). Pure and
 * deterministic. Labels only change DISPLAY, never which entity is selected.
 */
export function resolveNarrativeTokens(
  run: RunResult,
  facts: NarrativeFacts,
  labels?: NarrativeLabels,
): Record<TokenName, string | null> {
  const headline = headlineMoment(facts);
  return {
    TEAM_NAME: labels?.team_name ?? null,
    MANAGER: labels?.manager_name ?? null,
    TOP_SCORER: playerLabel(facts.hero_player_id, labels),
    FINAL_HERO: playerLabel(facts.final_hero_player_id, labels),
    VILLAIN: playerLabel(facts.villain_player_id, labels),
    OPPONENT: teamLabel(facts.nemesis_team_id, labels),
    KEY_MOMENT: headline ? KEY_MOMENT_PHRASE[headline.kind] : null,
    RECORD: run.record,
  };
}

const TOKEN_PATTERN = /\{([A-Z_]+)\}/g;

/**
 * Fill a template string against a resolved token map. Unknown placeholders are
 * left intact (a packaging bug surfaces visibly rather than silently); known
 * tokens that resolved to `null` render as `UNAVAILABLE_TOKEN_TEXT`.
 */
export function fillTemplate(text: string, tokens: Record<TokenName, string | null>): string {
  return text.replace(TOKEN_PATTERN, (whole, name: string) => {
    if (Object.prototype.hasOwnProperty.call(tokens, name)) {
      return tokens[name as TokenName] ?? UNAVAILABLE_TOKEN_TEXT;
    }
    return whole;
  });
}
