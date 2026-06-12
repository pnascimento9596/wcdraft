// Draft state layer of the wcdraft data contract.
//
// THE 17-SPIN DRAFT (WS-0c depth layer revision; ENGINE-V2 E-1 sampling).
//
//   - Spins length is exactly 17.
//   - ENGINE-V2 E-1: Each spin is an INDEPENDENT, ERA-WEIGHTED, WITH-REPLACEMENT
//     weighted draw over ALL (tournament_id, nation_id) pairs in the catalog
//     (the same (T, N) MAY repeat across spins; pre-1998 tournaments aggregate
//     ≈10% of per-spin probability, modern 1998..2026 ≈90% with gentle recency
//     scaling). The old WS-0c pair-once rule is gone; global `player_id` dedup
//     is what stops the same human being drafted twice.
//     Whichever (T, N) is selected, the spin offers BOTH that squad's
//     un-picked player cards AND that team-year's coach as candidates. The
//     user picks exactly ONE entity per spin — a player OR the coach.
//   - ONE manager only: the coach may be taken on ANY single spin, but once
//     `manager_card_id` is set the coach is NO LONGER a selectable candidate
//     on later spins. A draft contains EXACTLY ONE manager pick across the 17
//     spins; a schema refinement enforces ≤1.
//   - The 16 OTHER spins yield player picks → 11 starters + 5 bench.
//   - The manager goes to a DEDICATED manager slot (`DraftState.manager_card_id`)
//     — NEVER a field/bench SquadSlot.
//
// LOCK-ON-PICK INVARIANT (WS-0c):
//   Each pick + assignment is committed and IMMUTABLE the moment it is
//   confirmed, before the next spin. There is no end-of-draft rearranging.
//   This raises difficulty + leaderboard competitiveness on purpose.
//   Enforcement:
//     - the spin `status` is append-only ('pending' → 'picked'; never the
//       reverse — there is no 'unpicked' state in the union);
//     - a `picked` spin's `picked_kind`, `picked_card_id`,
//       `picked_player_id`, `assigned_slot_id`, `picked_manager_card_id`
//       MUST NOT change once set (the schema's superRefine rejects any draft
//       where a 'picked' spin's fields are missing — but in-flight mutation
//       inside a process is the runtime's responsibility, which the
//       `lock-on-pick` golden test will assert against the WS-C draft engine).
//
// DETERMINISM INVARIANTS (unchanged from WS-0b unless noted):
//   - `draft_seed` is a STRING; PRNG is the existing cyrb128+sfc32. No
//     `Date`/`Math.random`/`crypto`/`performance` anywhere in the
//     seed → draft → sim → score → narrative chain.
//   - The pool MUST be CANONICALLY SORTED by (tournament_id, nation_id) BEFORE
//     the draw; the sort is the responsibility of the sampling code, but the
//     invariant is declared here so reviewers can spot drift.
//   - Each spin independently samples WITH REPLACEMENT from that sorted pool.
//     `(tournament_id, nation_id)` MAY repeat across the 17 spins.
//   - Global `player_id` dedup is the hard uniqueness guarantee: one human can
//     be picked at most once even when a team-year pair repeats.
//   - Each rolled roster MUST be canonically sorted by `card_id` before the
//     roster sample as well.
//   - Distinct seeded substreams: draft / match_sim / event_gen /
//     opponent_selection / narrative. The DraftState owns the draft substream;
//     the canonical sub-seed is `deriveSubseed(parent_seed, "draft")`.

import type { CardId } from "./identity.js";
import type { ManagerCardId } from "./manager.js";
import type { SlotPosition } from "./formation.js";
import type { DraftFlow, EraPresetId, RatingBasis } from "./draft-config.js";

/**
 * The two kinds of entity a user may take on a single spin. Discriminator for
 * the `Spin.picked_*` fields once `status === 'picked'`.
 *
 *   - 'player'  → `picked_card_id` + `picked_player_id` + `assigned_slot_id`
 *                 are set; `picked_manager_card_id` is null.
 *   - 'manager' → `picked_manager_card_id` is set; the player pick fields
 *                 (`picked_card_id`, `picked_player_id`, `assigned_slot_id`)
 *                 are all null. The manager goes to the DEDICATED dedicated
 *                 `DraftState.manager_card_id` slot, NEVER a SquadSlot.
 */
export type PickedKind = "player" | "manager";

/**
 * One of the 17 wheel spins in a draft.
 *
 * INVARIANTS:
 *  - `(tournament_id, nation_id)` MAY repeat across spins (ENGINE-V2 E-1
 *    with-replacement weighted sampling — the WS-0c uniqueness invariant is
 *    GONE; global `player_id` dedup is what prevents drafting the same human
 *    twice).
 *  - `rolled_card_ids` is the post-dedup player candidate set surfaced to the
 *    user; it must be canonically sorted by card_id BEFORE the user-facing roll.
 *  - `rolled_manager_card_id` is THAT team-year's coach card if present in
 *    the dataset, otherwise `null`. After a prior spin has confirmed a
 *    manager pick (`DraftState.manager_card_id !== null`), `rolled_manager_card_id`
 *    MUST be `null` on all subsequent spins (the coach is no longer a
 *    candidate).
 *  - `excluded_player_ids` lists players already picked in earlier spins and
 *    therefore filtered out of this roll (one human = one card per draft).
 *  - The `picked_*` fields obey the `picked_kind` discriminator described on
 *    `PickedKind`. Schema superRefine enforces.
 */
export interface Spin {
  /** Spin position 0..16 within the DraftState.spins array. */
  index: number;
  /** FK -> Tournament. */
  tournament_id: number;
  /**
   * FK -> Nation. (tournament_id, nation_id) MAY repeat across spins under
   * ENGINE-V2 E-1 with-replacement sampling.
   */
  nation_id: string;
  /**
   * ENGINE-V2 E-1 RARE EXPOSURE: `true` iff this spin's tournament year is
   * pre-1998. UI rendering (badges, copy) lands in E-2; E-1 only exposes the
   * field on the persisted Spin.
   */
  rare: boolean;
  /**
   * ENGINE-V2 E-1 RARE EXPOSURE: the EFFECTIVE probability this spin emits
   * the chosen (tournament_id, nation_id), in `[0, 1]`. Equals the base
   * weight of the selected (T, N) plus the weights of all contiguous DEPLETED
   * pairs the deterministic advance scanned past to reach it (so it is
   * `≥ base_weight`). Audit/display metadata only — NEVER fed back into
   * sampling. Stored as a JS number rounded to 12 fractional digits via
   * `Number(p.toFixed(12))` so JSON-stringify produces a stable byte sequence.
   */
  draw_probability: number;
  /**
   * Candidate PLAYER cards AFTER global player_id dedup; canonically sorted
   * by `card_id` via `canonicalSortBy` BEFORE the user-facing roll. Branded
   * `CardId[]`.
   *
   * MAY be empty when every player in this (tournament, nation) pair has
   * already been picked AND the only remaining selectable on this spin is
   * the coach. In that case `rolled_manager_card_id` MUST be non-null AND
   * (if a manager has not yet been drafted) the user can only pick the
   * coach on this spin. The WS-C draft engine is responsible for keeping
   * the pool non-empty under normal play; the schema does NOT require length>=1.
   */
  rolled_card_ids: CardId[];
  /**
   * Player ids excluded from this roll because they were picked in earlier
   * spins. Schema-enforced: `excluded_player_ids` equals the ordered list of
   * `picked_player_id` from spins with `index < this.index` that picked a
   * player (manager-pick spins do not contribute to the dedup set).
   */
  excluded_player_ids: string[];
  /**
   * THAT team-year's coach card surfaced on this spin, or `null` when the
   * dataset has no manager for the (tournament, nation) pair OR when a
   * manager has already been drafted in an earlier spin (per the ONE-manager
   * rule). Branded `ManagerCardId`.
   */
  rolled_manager_card_id: ManagerCardId | null;
  /**
   * Discriminator for the picked entity once `status === 'picked'`. The
   * schema enforces the per-kind field coherence (see `PickedKind`).
   *
   * IMPORTANT: this field is meaningful ONLY when `status === 'picked'`.
   * For 'pending' spins the value is carried but ignored — by convention
   * the WS-C engine writes `'player'` on a fresh pending spin (a no-op
   * default that gets overwritten on pick).
   */
  picked_kind: PickedKind;
  /** Final PLAYER pick from `rolled_card_ids`; null when `picked_kind !== 'player'` or status is 'pending'. */
  picked_card_id: CardId | null;
  /**
   * Denormalized convenience FK -> Player. Canonical pick remains the card;
   * this field exists so dedup updates don't have to re-resolve `card_id`
   * → `player_id`. Null when `picked_kind !== 'player'` or status is 'pending'.
   */
  picked_player_id: string | null;
  /**
   * SquadSlot.slot_id the pick was placed into; null until placed, OR when
   * `picked_kind === 'manager'` (manager goes to `DraftState.manager_card_id`,
   * never a SquadSlot).
   */
  assigned_slot_id: string | null;
  /**
   * Final MANAGER pick, set iff `picked_kind === 'manager'` and `status ===
   * 'picked'`. MUST equal `rolled_manager_card_id` for the same spin (you
   * cannot pick a manager that wasn't on the wheel).
   */
  picked_manager_card_id: ManagerCardId | null;
  /**
   * DC-3 position-first — the target the user COMMITTED before this spin's
   * squad reveal: a SquadSlot.slot_id, the literal `"manager"`, or `null`.
   *
   *   - squad_first: ALWAYS null (the slot is chosen after the reveal and
   *     recorded in `assigned_slot_id` only — byte-compatible with pre-DC-3
   *     drafts modulo the field itself).
   *   - position_first: null only while `status === 'awaiting_slot'`; set
   *     and IMMUTABLE from the moment `selectDraftTarget` rolls the squad.
   *     A picked player spin's `assigned_slot_id` MUST equal it; a picked
   *     manager spin's target MUST be `"manager"`.
   */
  target_slot_id: string | null;
  /**
   * Lifecycle:
   *   squad_first:    'pending' → 'picked' (unchanged, append-only).
   *   position_first: 'awaiting_slot' → 'pending' → 'picked' (DC-3).
   *
   * 'awaiting_slot' is a PLACEHOLDER: the spin's (T, N) draw has NOT been
   * materialized (the commitment boundary is real — persisted state carries
   * no squad data the user hasn't earned by committing a target). Sentinel
   * shape: tournament_id 0, nation_id "", rare false, draw_probability 0,
   * empty candidate/exclusion lists, all pick fields null. Schema enforces.
   */
  status: "awaiting_slot" | "pending" | "picked";
}

/**
 * One starter (11) or bench (5) slot in the user's 16-PLAYER squad.
 *
 * The drafted MANAGER does NOT live in a SquadSlot — see
 * `DraftState.manager_card_id`. Every SquadSlot is a PLAYER slot.
 *
 * SLOT POSITION (WS-0c): each slot carries the FINE `SlotPosition` from the
 * locked FormationTemplate (for starters; bench slots use a coarser fallback
 * declared by the WS-C draft engine — see `position_compatibility` below).
 *
 * POSITION COMPATIBILITY (WS-0c): the boolean `slot_valid` from the WS-0b
 * shape is GONE. It is replaced by a graduated `position_compatibility` in
 * `[0, 1]` (output of `positionCompatibility(card.eligible_positions, slot_position)`).
 * The slot is "occupied legally enough" at every compatibility — out-of-position
 * placement remains a SOFT signal (sim penalty), never a draft blocker.
 */
export interface SquadSlot {
  /**
   * Stable within a draft. For STARTERS, this is the FormationSlot.slot_id
   * from the locked FormationTemplate; for BENCH slots, the WS-C draft engine
   * mints stable bench slot ids of the form `bench.<index>`.
   */
  slot_id: string;
  /** True for 11 starters, false for 5 bench slots. */
  is_starter: boolean;
  /**
   * Fine slot position. For starters, this MUST equal the
   * FormationTemplate's FormationSlot.slot_position for `slot_id`. For bench
   * slots, the engine picks the broad slot_position the bench role represents
   * (e.g. "CM" or "ST"); the schema does NOT cross-validate bench positions
   * against a template since bench layout is engine-owned.
   */
  slot_position: SlotPosition;
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
   * Graduated 0..1 compatibility of the placed card with this slot's
   * `slot_position`, output of `positionCompatibility(eligible_positions,
   * slot_position)`. Vacant slots MUST carry `position_compatibility === 0`
   * (honest-state: an empty slot contributes nothing).
   * SOFT signal — drives the sim's out-of-position penalty; never a block.
   */
  position_compatibility: number;
  /** Soft warnings (out-of-position, role mismatch, etc.). */
  validation_warnings: string[];
}

/**
 * Squad-level validation summary.
 *
 * HARD GATE for `DraftState.status = 'ready'`:
 *   `is_fieldable === true` (11 starters assigned — bodies present).
 *
 * NOTE: the manager pick is MANDATORY in a complete draft (exactly one
 * manager across the 17 spins), but `is_fieldable` is unchanged from WS-0b
 * — bodies-in-the-XI is still the only hard gate; missing-manager surfaces
 * as a soft warning if the draft is somehow persisted with a manager still
 * absent. The DraftStateSchema does NOT let `status === 'simulated'` proceed
 * with a missing manager — see the DraftState comment.
 */
export interface SquadValidation {
  /**
   * True iff all 11 starter slots have a card_id assigned. This is THE ONLY
   * gate on `status = 'ready'`.
   */
  is_fieldable: boolean;
  /**
   * True iff at least one starter is in the GK slot AND the card has GK in
   * its eligible positions (i.e. `position_compatibility === 1` for that
   * starter). False is permitted (the sim applies an outfielder-in-goal
   * penalty).
   */
  has_goalkeeper: boolean;
  /** Aggregated soft warnings surfaced to the UI. */
  warnings: string[];
}

/**
 * The persisted draft state.
 *
 * VERSION ANCHORS: `dataset_version`, `rating_version`, `engine_version` are
 * REQUIRED — together they let the leaderboard / replay paths re-derive a
 * RunResult deterministically.
 *
 * `mode = 'hidden'` is a DISPLAY-ONLY mask: it hides identities until pick-time,
 * but it MUST NOT change deal outcomes for a given seed. The sim engine has no
 * branch on mode.
 *
 * `engine_version` is a single semver covering RNG + sim + scoring + ruleset +
 * narrative + (WS-0c) formation registry / Synergy / compatibility table /
 * manager rating shape — anything that could change a RunResult byte. Bump
 * it together.
 *
 * FORMATION LOCK (WS-0c): `formation_id` is locked at draft CREATION and is
 * IMMUTABLE for the lifetime of the DraftState. Any persisted draft whose
 * `formation_id` does not appear in `FORMATION_TEMPLATES` is rejected. The
 * starter SquadSlots' `slot_id`s MUST match the FormationTemplate.slots' ids
 * 1:1 — the schema enforces.
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
  /**
   * FK -> FormationTemplate. LOCKED at draft creation, IMMUTABLE thereafter.
   * Must resolve to a known formation in `FORMATION_TEMPLATES`. Schema
   * enforces.
   */
  formation_id: string;
  /** User-named team (defaults to "Your XI"). */
  team_name: string;
  /** Always length 17; ordered by `Spin.index`. */
  spins: Spin[];
  /** 11 starters + 5 bench = 16 PLAYER slots. The manager has its own slot below. */
  squad: SquadSlot[];
  /**
   * The drafted manager's card id, or `null` until a manager is taken.
   *
   *   - Exactly ONE of the 17 spins picks a manager in a complete draft.
   *   - Once non-null, no later spin may offer a coach (`rolled_manager_card_id`
   *     is null on all spins after the picking spin).
   *   - The manager NEVER occupies a SquadSlot — this is the manager's
   *     dedicated slot.
   */
  manager_card_id: ManagerCardId | null;
  /**
   * Lifecycle —
   *   'drafting'  → spins still being resolved.
   *   'ready'     → 11 starters assigned (is_fieldable true). Sim may run.
   *   'simulated' → a RunResult has been produced for this DraftState. At
   *                  this stage the manager pick MUST be present (a complete
   *                  draft has exactly one manager); the schema enforces.
   */
  status: "drafting" | "ready" | "simulated";
  /**
   * Running global dedup set of picked player_ids. Schema-enforced: this
   * MUST equal the ordered-unique list of non-null `spins[*].picked_player_id`
   * from PLAYER-pick spins (manager picks contribute no entry).
   */
  deduped_player_ids: string[];
  /** ETL dataset version anchor (one of the three replay anchors). */
  dataset_version: string;
  /** Rating-engine version anchor. */
  rating_version: string;
  /**
   * Single core-package semver covering RNG / sim / scoring / ruleset /
   * narrative / formation registry / Synergy formula / position-compatibility
   * curve / manager-rating shape. Bump as a unit on any byte-level change to
   * RunResult.
   */
  engine_version: string;
  /**
   * DC-1 config axes (plan §A/§G) — stored EXPLICITLY on the persisted draft
   * so token encode / replay never infer config from URL state. Defaults
   * (`squad_first` / `career` / `all_time`) are byte-for-byte today's shipped
   * behavior. LOCKED at draft creation, immutable thereafter.
   */
  draft_flow: DraftFlow;
  /**
   * Rating basis the run's ratings/sim channels are drawn from. `career` is
   * the only constructible value until the MV2-12b basis season; the field
   * exists now so the token schema never needs a second evolution.
   */
  rating_basis: RatingBasis;
  /**
   * Era preset bounding the spin pool's tournament years. The catalog the
   * draft samples from MUST be the matching era-filtered catalog
   * (`createDraft` cross-checks against the catalog's era stamp).
   */
  era_preset: EraPresetId;
}
