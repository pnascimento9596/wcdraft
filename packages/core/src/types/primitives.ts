// Shared primitive types used across the wcdraft data contract.
//
// HONEST-STATE RULE (applies project-wide): every nullable field uses `T | null`
// — `null` means UNKNOWN / UNAVAILABLE, while an empty array `[]` means
// CONFIRMED EMPTY. Missing data is NEVER coerced to 0, false, or "".
//
// SCOPE: this file owns the small, leaf-level vocabulary (positions, awards,
// formations, group/slot ids, source citations). Larger entities live in
// sibling type modules and import from here.

/** On-pitch positional bucket. Sim engine bucketizes around these four. */
export type Position = "GK" | "DF" | "MF" | "FW";

/**
 * Controlled award vocabulary for tournament-level honours.
 *
 * Historical award sets vary by tournament era; `Award.description` carries the
 * raw label so ETL can record (e.g.) "Adidas Golden Ball" verbatim while still
 * mapping to a canonical bucket here.
 */
export type AwardType =
  | "golden_ball"
  | "silver_ball"
  | "bronze_ball"
  | "golden_boot"
  | "silver_boot"
  | "bronze_boot"
  | "golden_glove"
  | "best_young_player"
  | "all_tournament_team"
  | "fair_play";

export interface Award {
  /** Canonical award bucket (controlled vocabulary). */
  award_type: AwardType;
  /** Original award label as recorded by the source, or null when unknown. */
  description: string | null;
}

/**
 * Squad formation. Open template literal so tactically uncommon shapes
 * (e.g. '3-1-4-2') type-check without needing a finite enum update.
 */
export type Formation = `${number}-${number}-${number}` | `${number}-${number}-${number}-${number}`;

/** Group identifier for the 2026 12-group structure (A..L). */
export type GroupId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L";

/** Knockout round labels (single-elimination ladder from R32 to Final). */
export type KnockoutRound = "R32" | "R16" | "QF" | "SF" | "F";

/** Match-round superset including the three group-stage games and knockout ladder. */
export type MatchRound = "G1" | "G2" | "G3" | KnockoutRound;

/** Phase superset for downstream filtering. */
export type MatchPhase = "group" | "knockout";

/**
 * Period of play inside a single match — used with MatchEvent.minute so that
 * (e.g.) an 89' goal in ET2 isn't conflated with 89' in 2H.
 */
export type MatchPeriod = "1H" | "2H" | "ET1" | "ET2" | "shootout";

/** Twelve canonical group ids for the 2026 format; exported for downstream use. */
export const GROUP_IDS: readonly GroupId[] = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
] as const;

/**
 * Citation back to a source for one or more fields on the owning record.
 * The shape is additive: ETL can attach many SourceRefs to a record without
 * losing field-level provenance.
 */
export interface SourceRef {
  /** Free-form identifier of the source (publisher, repo, dataset name, URL). */
  source: string;
  /** Source category — drives auditing weight and reviewer routing. */
  source_type: "fjelstul" | "wikipedia" | "rsssf" | "other";
  /** Human-readable citation string (suitable for footnotes). */
  citation: string;
  /** ISO-8601 retrieval date (YYYY-MM-DD), or null when unknown. */
  retrieved_date: string | null;
  /**
   * Specific field name on the owning record this citation supports, or null
   * when the citation covers the whole record.
   */
  field: string | null;
  /** Confidence in [0,1], or null when not assessed. */
  confidence: number | null;
}
