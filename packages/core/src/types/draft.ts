// Draft state layer of the wcdraft data contract.
//
// THE 16-SPIN DRAFT — the user is dealt 16 rolls; each roll is a
// (tournament, nation) pair from the global pool, AFTER global player_id
// dedup. The user picks one card per spin and assigns it to a starter / bench
// squad slot. Hard gate to mark a run "ready": 11 starters assigned (bodies
// present). Legal-XI rules (GK presence, position eligibility) are SOFT —
// they're WARNINGS that drive sim penalties, never blocks.
//
// DETERMINISM INVARIANTS (enforced downstream by the sampling code; documented
// here on the types they apply to):
//   - `draft_seed` is a STRING; PRNG is the existing cyrb128+sfc32. No
//     `Date`/`Math.random`/`crypto`/`performance` anywhere in the
//     seed → draft → sim → score → narrative chain.
//   - The 16 (tournament_id, nation_id) pairs sample from a pool that MUST
//     be CANONICALLY SORTED by (tournament_id, nation_id) BEFORE the draw —
//     the sort is the responsibility of the sampling code, but the invariant
//     is declared here so reviewers can spot drift.
//   - Each rolled roster MUST be canonically sorted by `card_id` before the
//     roster sample as well.
//   - `(tournament_id, nation_id)` pairs are UNIQUE across the 16 spins.
//   - Distinct seeded substreams: draft / match_sim / event_gen /
//     opponent_selection / narrative. The DraftState owns the draft substream;
//     the canonical sub-seed is `deriveSubseed(parent_seed, "draft")`.

import type { CardId } from "./identity.js";
import type { Formation, Position } from "./primitives.js";

/**
 * One of the 16 wheel spins in a draft.
 *
 * INVARIANTS:
 *  - `(tournament_id, nation_id)` is UNIQUE across the 16 spins in a DraftState.
 *  - `rolled_card_ids` is the post-dedup candidate set surfaced to the user; it
 *    must be canonically sorted by card_id BEFORE the user-facing roll.
 *  - `excluded_player_ids` lists players already picked in earlier spins and
 *    therefore filtered out of this roll (one human = one card per draft).
 */
export interface Spin {
  /** Spin position 0..15 within the DraftState.spins array. */
  index: number;
  /** FK -> Tournament. */
  tournament_id: number;
  /** FK -> Nation. The (tournament_id, nation_id) pair is UNIQUE across all 16 spins. */
  nation_id: string;
  /**
   * Candidate cards AFTER global player_id dedup; canonically sorted by
   * `card_id` via `canonicalSortBy` BEFORE the user-facing roll. Branded
   * `CardId[]`.
   */
  rolled_card_ids: CardId[];
  /**
   * Player ids excluded from this roll because they were picked in earlier
   * spins. Schema-enforced: `excluded_player_ids` equals the ordered list of
   * `picked_player_id` from spins with `index < this.index`.
   */
  excluded_player_ids: string[];
  /** Final pick from `rolled_card_ids`; null until the user picks. */
  picked_card_id: CardId | null;
  /**
   * Denormalized convenience FK -> Player. Canonical pick remains the card; this
   * field exists so dedup updates don't have to re-resolve `card_id` → `player_id`.
   */
  picked_player_id: string | null;
  /** SquadSlot.slot_id the pick was placed into; null until placed. */
  assigned_slot_id: string | null;
  /** Lifecycle: 'pending' (not yet picked) → 'picked'. */
  status: "pending" | "picked";
}

/**
 * One starter (11) or bench (5) slot in the user's 16-card squad.
 *
 * `slot_valid` is SOFT: an out-of-position card sets it false and pushes a
 * warning, which translates into a sim penalty — it never blocks the run.
 */
export interface SquadSlot {
  slot_id: string;
  /** True for 11 starters, false for 5 bench slots. */
  is_starter: boolean;
  /** Formation position this slot represents (e.g. left-back is `DF`). */
  lineup_position: Position;
  /** Positions a card may be placed here from. Wider than `lineup_position` for utility slots. */
  allowed_positions: Position[];
  /**
   * Card placed here (PlayerTournament.card_id), or null if vacant. Branded
   * `CardId`. When non-null, `card_id`, `player_id`, and `tournament_id` MUST
   * be non-null together AND `card_id === buildCardId(player_id,
   * tournament_id)` — schema refinement enforces.
   */
  card_id: CardId | null;
  /** Denormalized FK -> Player for fast dedup checks. */
  player_id: string | null;
  /** Denormalized FK -> Tournament. Null iff the slot is vacant. */
  tournament_id: number | null;
  /**
   * False if the placed card's position is outside `allowed_positions`. SOFT
   * marker — drives sim penalties, never blocks the run.
   */
  slot_valid: boolean;
  /** Soft warnings (out-of-position, role mismatch, etc.). */
  validation_warnings: string[];
}

/**
 * Squad-level validation summary.
 *
 * HARD GATE for `DraftState.status = 'ready'`:
 *   `is_fieldable === true` (11 starters assigned — bodies present).
 *
 * Everything else (no GK, out-of-position starters) is SOFT: warnings that
 * generate sim penalties. The contract explicitly does NOT promote any of
 * these to hard blocks.
 */
export interface SquadValidation {
  /**
   * True iff all 11 starter slots have a card_id assigned. This is THE ONLY
   * gate on `status = 'ready'`.
   */
  is_fieldable: boolean;
  /**
   * True iff at least one starter is in the GK slot AND the card has GK in
   * its eligible positions. False is permitted (the sim applies an
   * outfielder-in-goal penalty).
   */
  has_goalkeeper: boolean;
  /** Aggregated soft warnings surfaced to the UI. */
  warnings: string[];
}

/**
 * The persisted draft state.
 *
 * All three version anchors (`dataset_version`, `rating_version`,
 * `engine_version`) are REQUIRED — together they let the leaderboard / replay
 * paths re-derive a RunResult deterministically.
 *
 * `mode = 'hidden'` is a DISPLAY-ONLY mask: it hides identities until pick-time,
 * but it MUST NOT change deal outcomes for a given seed. The sim engine has no
 * branch on mode.
 *
 * `engine_version` is a single semver covering RNG + sim + scoring + ruleset +
 * narrative — anything that could change a RunResult byte. Bump it together.
 */
export interface DraftState {
  run_id: string;
  /**
   * STRING seed (not number) — locks the seed domain across cyrb128 + sfc32 and
   * avoids float64 seed surprises. This is the DRAFT substream seed.
   */
  draft_seed: string;
  /**
   * Display mode for cards in the UI.
   *   - 'classic' → identities visible at roll time.
   *   - 'hidden'  → identities masked until pick. NEVER affects outcomes for
   *                  the same seed; purely a UI presentation toggle.
   */
  mode: "classic" | "hidden";
  /** Squad shape (e.g. '4-3-3'). */
  formation: Formation;
  /** User-named team (defaults to "Your XI"). */
  team_name: string;
  /** Always length 16; ordered by `Spin.index`. */
  spins: Spin[];
  /** 11 starters + 5 bench = 16 slots. */
  squad: SquadSlot[];
  /**
   * Lifecycle —
   *   'drafting'  → spins still being resolved.
   *   'ready'     → 11 starters assigned (is_fieldable true). Sim may run.
   *   'simulated' → a RunResult has been produced for this DraftState.
   */
  status: "drafting" | "ready" | "simulated";
  /**
   * Running global dedup set of picked player_ids. Schema-enforced: this
   * MUST equal the ordered-unique list of non-null `spins[*].picked_player_id`.
   */
  deduped_player_ids: string[];
  /** ETL dataset version anchor (one of the three replay anchors). */
  dataset_version: string;
  /** Rating-engine version anchor. */
  rating_version: string;
  /**
   * Single core-package semver covering RNG / sim / scoring / ruleset /
   * narrative. Bump as a unit on any byte-level change to RunResult.
   */
  engine_version: string;
}
