// WS-C — the deterministic 17-spin DRAFT state machine.
//
// This is the runtime that fills the WS-0c draft contract declared in
// `types/draft.ts` + `schemas/draft.ts`. It is PURE and DETERMINISTIC: the only
// entropy is the seeded RNG (`createRng` over the `"draft"` substream sub-seed
// from `deriveSubseed`). No Date / Math.random / crypto anywhere — the
// determinism lint guard enforces this across `packages/core/src`.
//
// ─── THE 17 SPINS ────────────────────────────────────────────────────────────
//   - Each spin samples a UNIQUE (tournament_id, nation_id) pair WITHOUT
//     replacement from the valid pool. The pool is CANONICALLY SORTED by
//     (tournament_id, nation_id) BEFORE the draw (`canonicalSortBy`), so pool
//     insertion-order drift can never silently change a draw.
//   - The spin presents that squad's player cards (canonically sorted by
//     `card_id`, with every already-picked player_id filtered out GLOBALLY) AND
//     that team-year's coach as candidates. The user takes exactly ONE entity.
//   - PLAYER pick → assigned to a formation SquadSlot; `position_compatibility`
//     is computed via `positionCompatibility(eligible_positions, slot_position)`
//     and stored on the slot.
//   - MANAGER pick → goes to the dedicated `DraftState.manager_card_id` slot,
//     NEVER a SquadSlot. ≤1 manager across the run; once taken, no later spin
//     offers a coach.
//   - Net for a complete draft: 16 player picks (11 starters + 5 bench) + 1
//     manager = 17.
//
// ─── LOCK-ON-PICK ────────────────────────────────────────────────────────────
//   Each pick + assignment is committed IMMUTABLE the moment it is confirmed.
//   Picks happen in spin order (the active spin is always the lowest-index
//   pending spin). A resolved spin object and its occupied SquadSlot are
//   deep-FROZEN and carried by reference into every later state — so they
//   physically cannot change. Transitions are append-only and never mutate a
//   resolved spin; only later PENDING spins are re-rolled (their global dedup /
//   coach-availability changes as picks accumulate).
//
// ─── SOFT RULES ──────────────────────────────────────────────────────────────
//   no-GK and out-of-position are SOFT (low `position_compatibility` + a
//   `validation_warnings` entry + a later sim penalty) — NEVER a draft blocker.
//   The only HARD gate for `status = 'ready'` is 11 starters assigned.
//
// SCOPE: the draft engine consumes a narrow candidate view of the ingested
// `PlayerTournament` / `ManagerTournament` cards (`DraftPlayerCard` /
// `DraftManagerCard`). Real wiring maps those canonical records 1:1 onto these
// views; golden development runs against a synthetic fixture squad set so this
// lane does not block on data wiring (see `draft.fixture.ts`).

import { canonicalSortBy, createRng, deriveSubseed } from "./rng.js";
import { positionCompatibility } from "./api/compatibility.js";
import { buildCardId, parseCardId } from "./types/identity.js";
import { buildManagerCardId } from "./types/manager.js";
import { FORMATION_TEMPLATES, slotPositionLine } from "./types/formation.js";
import { DraftStateSchema } from "./schemas/draft.js";
import type { CardId } from "./types/identity.js";
import type { ManagerCardId } from "./types/manager.js";
import type { SlotPosition } from "./types/formation.js";
import type { Position } from "./types/primitives.js";
import type { DraftState, Spin, SquadSlot, SquadValidation } from "./types/draft.js";

// ─── CANDIDATE INPUT VIEWS ───────────────────────────────────────────────────

/**
 * The narrow per-card view the draft engine needs from a `PlayerTournament`.
 * `PlayerTournament` is structurally assignable to this — the engine reads
 * nothing else, and rebuilds `card_id` from `(player_id, tournament_id)` itself
 * so it never has to trust a denormalized id.
 */
export interface DraftPlayerCard {
  player_id: string;
  tournament_id: number;
  nation_id: string;
  /** Per-card coarse eligibility; MUST be non-empty (drives `positionCompatibility`). */
  eligible_positions: readonly Position[];
}

/**
 * The narrow per-card view the draft engine needs from a `ManagerTournament`
 * (the draftable coach for a given (tournament, nation)).
 */
export interface DraftManagerCard {
  manager_id: string;
  tournament_id: number;
  nation_id: string;
}

/** The candidate source for a draft: player cards + coach cards. */
export interface DraftDataset {
  players: readonly DraftPlayerCard[];
  managers: readonly DraftManagerCard[];
}

/**
 * Non-dataset parameters for a draft. `parent_seed` is the master RUN seed; the
 * engine derives the draft substream seed via `deriveSubseed(parent_seed,
 * "draft")` and stores it as `DraftState.draft_seed`.
 */
export interface CreateDraftParams {
  run_id: string;
  parent_seed: string;
  formation_id: string;
  mode?: "classic" | "hidden";
  team_name?: string;
  dataset_version: string;
  rating_version: string;
  engine_version: string;
}

// ─── CATALOG (indexed, canonically ordered candidate source) ─────────────────

/** One (tournament, nation) squad bucket — roster canonically sorted by card_id. */
interface TnEntry {
  tournament_id: number;
  nation_id: string;
  roster: readonly DraftPlayerCard[];
  coach: DraftManagerCard | null;
}

/**
 * The indexed candidate source. Built once via `buildDraftCatalog` and threaded
 * (unchanged) through every transition — it is the immutable catalog, distinct
 * from the mutable-by-copy `DraftState`.
 */
export interface DraftCatalog {
  /** Canonically sorted by (tournament_id, nation_id) — the draw pool. */
  readonly pairs: readonly TnEntry[];
  readonly byPair: ReadonlyMap<string, TnEntry>;
}

const SPIN_COUNT = 17;
const BENCH_COUNT = 5;

/**
 * Bench slot layout (engine-owned; the schema does NOT cross-validate bench
 * positions against a formation template). One backup per line plus midfield
 * depth — broad roles, stable ids `bench.0..bench.4`.
 */
const BENCH_LAYOUT: readonly SlotPosition[] = ["GK", "CB", "CM", "CM", "ST"];

function pairKey(tournament_id: number, nation_id: string): string {
  // Separator is U+0000, emitted in the return below via the 6-char escape
  // backslash-u-0000 (NEVER a literal NUL byte, which would make this source
  // file binary to git/diff tooling). A nation_id carries no control chars, so
  // a numeric tournament_id + U+0000 + nation_id cannot collide across pairs.
  return `${tournament_id}\u0000${nation_id}`;
}

/**
 * Index a dataset into the canonical draw catalog. Players are grouped by
 * (tournament, nation) and each roster is canonically sorted by `card_id`
 * BEFORE any draw. Coaches attach to their matching (tournament, nation) bucket;
 * a coach with no player squad in the dataset is ignored (no squad to spin on).
 */
export function buildDraftCatalog(dataset: DraftDataset): DraftCatalog {
  // Group players by (tournament, nation).
  const rosterGroups = new Map<string, DraftPlayerCard[]>();
  for (const card of dataset.players) {
    const key = pairKey(card.tournament_id, card.nation_id);
    let group = rosterGroups.get(key);
    if (!group) {
      group = [];
      rosterGroups.set(key, group);
    }
    group.push(card);
  }

  // Group coaches by (tournament, nation); if a bucket has more than one coach
  // (data anomaly), pick deterministically by lexicographically-least manager_id
  // so the catalog is stable regardless of input order.
  const coachGroups = new Map<string, DraftManagerCard[]>();
  for (const coach of dataset.managers) {
    const key = pairKey(coach.tournament_id, coach.nation_id);
    let group = coachGroups.get(key);
    if (!group) {
      group = [];
      coachGroups.set(key, group);
    }
    group.push(coach);
  }

  const byPair = new Map<string, TnEntry>();
  for (const [key, group] of rosterGroups) {
    const first = group[0]!;
    const roster = canonicalSortBy(group, (c) => [buildCardId(c.player_id, c.tournament_id)]);
    const coaches = coachGroups.get(key);
    let coach: DraftManagerCard | null = null;
    if (coaches && coaches.length > 0) {
      coach = canonicalSortBy(coaches, (c) => [c.manager_id])[0]!;
    }
    byPair.set(key, {
      tournament_id: first.tournament_id,
      nation_id: first.nation_id,
      roster,
      coach,
    });
  }

  const pairs = canonicalSortBy([...byPair.values()], (e) => [e.tournament_id, e.nation_id]);
  return { pairs, byPair };
}

// ─── IMMUTABILITY HELPERS (lock-on-pick) ─────────────────────────────────────

function freezeSpin(spin: Spin): Spin {
  Object.freeze(spin.rolled_card_ids);
  Object.freeze(spin.excluded_player_ids);
  return Object.freeze(spin);
}

function freezeSlot(slot: SquadSlot): SquadSlot {
  Object.freeze(slot.validation_warnings);
  return Object.freeze(slot);
}

// ─── SPIN ROLLING ────────────────────────────────────────────────────────────

/**
 * (Re)roll a PENDING spin's candidate fields from the current running state:
 * global player dedup (`priorPlayerPicks`, in pick order) and whether a manager
 * has already been taken (`managerPicked`). Resolved spins are never re-rolled.
 */
function rollPendingSpin(
  catalog: DraftCatalog,
  index: number,
  tournament_id: number,
  nation_id: string,
  priorPlayerPicks: readonly string[],
  managerPicked: boolean,
): Spin {
  const entry = catalog.byPair.get(pairKey(tournament_id, nation_id));
  if (!entry) {
    throw new RangeError(
      `draft engine: no catalog entry for (tournament ${tournament_id}, nation ${nation_id})`,
    );
  }
  const excluded = new Set(priorPlayerPicks);
  const rolled_card_ids: CardId[] = [];
  for (const card of entry.roster) {
    if (excluded.has(card.player_id)) continue;
    rolled_card_ids.push(buildCardId(card.player_id, card.tournament_id));
  }
  const rolled_manager_card_id: ManagerCardId | null =
    !managerPicked && entry.coach
      ? buildManagerCardId(entry.coach.manager_id, entry.coach.tournament_id)
      : null;
  return {
    index,
    tournament_id,
    nation_id,
    rolled_card_ids,
    excluded_player_ids: [...priorPlayerPicks],
    rolled_manager_card_id,
    // picked_kind is meaningful only once status === 'picked'; the contract's
    // convention is a no-op 'player' default on a fresh pending spin.
    picked_kind: "player",
    picked_card_id: null,
    picked_player_id: null,
    assigned_slot_id: null,
    picked_manager_card_id: null,
    status: "pending",
  };
}

/**
 * Refresh every PENDING spin from the resolved spins ahead of it. Resolved
 * spins (already frozen) pass through UNCHANGED by reference — lock-on-pick.
 * `priorPlayerPicks` accumulates in spin order (so each spin's
 * `excluded_player_ids` equals exactly the players picked before it) and the
 * `managerPicked` flag flips after the manager spin (so every later spin's
 * `rolled_manager_card_id` becomes null).
 */
function rebuildSpins(catalog: DraftCatalog, spins: readonly Spin[]): Spin[] {
  const priorPlayerPicks: string[] = [];
  let managerPicked = false;
  const out: Spin[] = [];
  for (const spin of spins) {
    if (spin.status === "picked") {
      out.push(spin);
      if (spin.picked_kind === "player" && spin.picked_player_id !== null) {
        priorPlayerPicks.push(spin.picked_player_id);
      } else if (spin.picked_kind === "manager") {
        managerPicked = true;
      }
      continue;
    }
    out.push(
      rollPendingSpin(
        catalog,
        spin.index,
        spin.tournament_id,
        spin.nation_id,
        priorPlayerPicks,
        managerPicked,
      ),
    );
  }
  return out;
}

// ─── SQUAD CONSTRUCTION ──────────────────────────────────────────────────────

function buildSquad(formation_id: string): SquadSlot[] {
  const template = FORMATION_TEMPLATES[formation_id];
  if (!template) {
    throw new RangeError(
      `createDraft: formation_id "${formation_id}" is not a known FormationTemplate`,
    );
  }
  const slots: SquadSlot[] = template.slots.map((fs) => ({
    slot_id: fs.slot_id,
    is_starter: true,
    slot_position: fs.slot_position,
    card_id: null,
    player_id: null,
    tournament_id: null,
    position_compatibility: 0,
    validation_warnings: [],
  }));
  for (let i = 0; i < BENCH_COUNT; i++) {
    slots.push({
      slot_id: `bench.${i}`,
      is_starter: false,
      slot_position: BENCH_LAYOUT[i]!,
      card_id: null,
      player_id: null,
      tournament_id: null,
      position_compatibility: 0,
      validation_warnings: [],
    });
  }
  return slots;
}

// ─── DRAW (without replacement, canonical pool) ──────────────────────────────

function drawPairs(
  rng: ReturnType<typeof createRng>,
  pairs: readonly TnEntry[],
  n: number,
): TnEntry[] {
  if (pairs.length < n) {
    throw new RangeError(
      `draft pool has only ${pairs.length} (tournament, nation) pairs; need ${n} unique spins`,
    );
  }
  // Draw WITHOUT replacement from the canonically-sorted pool. `splice` keeps
  // the surviving pool in canonical order between draws, so the procedure is
  // fully determined by the seed.
  const remaining = [...pairs];
  const drawn: TnEntry[] = [];
  for (let i = 0; i < n; i++) {
    const idx = rng.int(remaining.length);
    drawn.push(remaining.splice(idx, 1)[0]!);
  }
  return drawn;
}

// ─── STATUS + WARNINGS ───────────────────────────────────────────────────────

function computeStatus(_spins: readonly Spin[], squad: readonly SquadSlot[]): DraftState["status"] {
  // HARD GATE (WS-0c contract): 'ready' ⟺ all 11 starter slots assigned
  // (is_fieldable). This is the ONLY gate — it fires the moment the XI has
  // bodies, even with bench/manager spins still pending, because the sim only
  // needs the starting 11 ("sim may run"). The transition to 'simulated' is
  // WS-B's responsibility and is never set here.
  const startersFilled = squad.every((s) => !s.is_starter || s.card_id !== null);
  return startersFilled ? "ready" : "drafting";
}

function buildSlotWarnings(
  slot_position: SlotPosition,
  eligible: readonly Position[],
  compat: number,
): string[] {
  if (compat >= 1) return [];
  const elig = eligible.join("/");
  if (slotPositionLine(slot_position) === "GK" && !eligible.includes("GK")) {
    return [
      `outfielder in goal: ${elig} placed in GK slot (compatibility ${compat.toFixed(2)}; soft sim penalty)`,
    ];
  }
  return [`out-of-position: ${elig} in ${slot_position} slot (compatibility ${compat.toFixed(2)})`];
}

function dedupedFromSpins(spins: readonly Spin[]): string[] {
  const out: string[] = [];
  for (const s of spins) {
    if (s.status === "picked" && s.picked_kind === "player" && s.picked_player_id !== null) {
      out.push(s.picked_player_id);
    }
  }
  return out;
}

/**
 * Assemble the next DraftState from refreshed spins + squad, re-derive the
 * dedup set + status, VALIDATE against the persistence schema (honest failure
 * if the engine ever drifts from the contract), then deep-freeze and return.
 */
function finalize(
  prev: DraftState,
  spins: Spin[],
  squad: SquadSlot[],
  manager_card_id: ManagerCardId | null,
): DraftState {
  const next: DraftState = {
    run_id: prev.run_id,
    draft_seed: prev.draft_seed,
    mode: prev.mode,
    formation_id: prev.formation_id,
    team_name: prev.team_name,
    spins,
    squad,
    manager_card_id,
    status: computeStatus(spins, squad),
    deduped_player_ids: dedupedFromSpins(spins),
    dataset_version: prev.dataset_version,
    rating_version: prev.rating_version,
    engine_version: prev.engine_version,
  };
  const parsed = DraftStateSchema.safeParse(next);
  if (!parsed.success) {
    throw new Error(
      `draft engine produced a contract-invalid DraftState: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  Object.freeze(next.spins);
  Object.freeze(next.squad);
  Object.freeze(next.deduped_player_ids);
  return Object.freeze(next);
}

// ─── PUBLIC: CREATE ──────────────────────────────────────────────────────────

/**
 * Create a fresh draft. The formation is LOCKED here and immutable for the
 * lifetime of the draft. The 17 (tournament, nation) pairs are drawn WITHOUT
 * replacement from the canonical pool using the `"draft"` substream sub-seed.
 * All spins start PENDING; spin candidates reflect zero prior picks.
 */
export function createDraft(catalog: DraftCatalog, params: CreateDraftParams): DraftState {
  const draft_seed = deriveSubseed(params.parent_seed, "draft");
  const rng = createRng(draft_seed);
  const drawn = drawPairs(rng, catalog.pairs, SPIN_COUNT);
  const squad = buildSquad(params.formation_id);

  const spins: Spin[] = drawn.map((entry, index) =>
    rollPendingSpin(catalog, index, entry.tournament_id, entry.nation_id, [], false),
  );

  // A complete draft requires exactly one manager. If NONE of the 17 drawn
  // (tournament, nation) pairs carries a coach, the draft can never be
  // completed — fail honestly at creation rather than strand the user at spin
  // 17. (Coaches sit on a subset of pairs, so the draw could miss them all.)
  if (!spins.some((s) => s.rolled_manager_card_id !== null)) {
    throw new RangeError(
      "createDraft: none of the 17 drawn (tournament, nation) pairs offers a coach; a complete draft requires exactly one manager",
    );
  }

  const draft: DraftState = {
    run_id: params.run_id,
    draft_seed,
    mode: params.mode ?? "classic",
    formation_id: params.formation_id,
    team_name: params.team_name ?? "Your XI",
    spins,
    squad,
    manager_card_id: null,
    status: "drafting",
    deduped_player_ids: [],
    dataset_version: params.dataset_version,
    rating_version: params.rating_version,
    engine_version: params.engine_version,
  };
  const parsed = DraftStateSchema.safeParse(draft);
  if (!parsed.success) {
    throw new Error(
      `createDraft produced a contract-invalid DraftState: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  return draft;
}

// ─── PUBLIC: STATE QUERIES ───────────────────────────────────────────────────

/** The active spin = the lowest-index spin still `pending`, or null if complete. */
export function activeSpin(state: DraftState): Spin | null {
  return state.spins.find((s) => s.status === "pending") ?? null;
}

/** True once every spin is resolved (all 17 picked). */
export function isDraftComplete(state: DraftState): boolean {
  return state.spins.every((s) => s.status === "picked");
}

function firstVacantSlotId(state: DraftState): string | null {
  // Squad is stored [11 starters in template order, then 5 bench], so the
  // first vacant slot fills starters before bench — the hard 'ready' gate
  // (11 starters) is satisfied as early as possible.
  return state.squad.find((s) => s.card_id === null)?.slot_id ?? null;
}

// ─── PUBLIC: PICK TRANSITIONS (lock-on-pick) ─────────────────────────────────

/**
 * Confirm a PLAYER pick on the active spin and assign the card to a vacant
 * SquadSlot. `position_compatibility` is computed via `positionCompatibility`
 * and stored; out-of-position / outfielder-in-goal placements add a soft
 * warning but never block. The resolved spin + occupied slot are frozen
 * (lock-on-pick); later pending spins are re-rolled to drop the picked player
 * from their candidate pools.
 *
 * @throws RangeError if the draft is complete, the card is not a candidate on
 *   the active spin, the player is already drafted, the slot is unknown, or the
 *   slot is already occupied (an assigned slot is immutable).
 */
export function pickPlayer(catalog: DraftCatalog, state: DraftState, card_id: CardId): DraftState;
export function pickPlayer(
  catalog: DraftCatalog,
  state: DraftState,
  card_id: CardId,
  slot_id: string,
): DraftState;
export function pickPlayer(
  catalog: DraftCatalog,
  state: DraftState,
  card_id: CardId,
  slot_id?: string,
): DraftState {
  const active = activeSpin(state);
  if (!active) {
    throw new RangeError("pickPlayer: the draft has no pending spin (all 17 are resolved)");
  }
  if (!active.rolled_card_ids.includes(card_id)) {
    throw new RangeError(
      `pickPlayer: card ${card_id} is not a candidate on spin ${active.index}`,
    );
  }
  const parsed = parseCardId(card_id);
  if (!parsed) {
    throw new RangeError(`pickPlayer: card_id ${card_id} is not a well-formed CardId`);
  }
  if (parsed.tournament_id !== active.tournament_id) {
    throw new RangeError(
      `pickPlayer: card ${card_id} tournament does not match spin ${active.index}`,
    );
  }
  if (state.deduped_player_ids.includes(parsed.player_id)) {
    // Defensive: rolled candidates are already dedup-filtered; this can only
    // fire on a contract bug.
    throw new RangeError(`pickPlayer: player ${parsed.player_id} is already drafted (global dedup)`);
  }

  // STRAND GUARD: a complete draft needs exactly one manager. If none has been
  // drafted yet and NO later spin offers a coach, the active spin is the last
  // chance to take one — committing a player here would leave the draft
  // unrecoverable (a 17th player with no slot, no coach to draft). Reject the
  // player pick and force the manager now. (Pending spins after the active one
  // carry a non-null rolled_manager_card_id iff their (T,N) has a coach, since
  // no manager is drafted yet.)
  if (state.manager_card_id === null) {
    const laterCoachOffered = state.spins.some(
      (s) => s.index > active.index && s.rolled_manager_card_id !== null,
    );
    if (!laterCoachOffered) {
      throw new RangeError(
        `pickPlayer: no manager is drafted and no later spin offers a coach — the manager must be drafted on spin ${active.index} now; a player pick here would strand the draft`,
      );
    }
  }

  const entry = catalog.byPair.get(pairKey(active.tournament_id, active.nation_id));
  if (!entry) {
    throw new RangeError(
      `pickPlayer: no catalog entry for spin ${active.index} (tournament ${active.tournament_id}, nation ${active.nation_id})`,
    );
  }
  const pcard = entry.roster.find((c) => c.player_id === parsed.player_id);
  if (!pcard) {
    throw new RangeError(
      `pickPlayer: player ${parsed.player_id} is not in the (tournament ${active.tournament_id}, nation ${active.nation_id}) roster`,
    );
  }

  const targetSlotId = slot_id ?? firstVacantSlotId(state);
  if (targetSlotId === null) {
    throw new RangeError("pickPlayer: no vacant SquadSlot is available for this player");
  }
  const slot = state.squad.find((s) => s.slot_id === targetSlotId);
  if (!slot) {
    throw new RangeError(`pickPlayer: unknown slot_id ${targetSlotId}`);
  }
  if (slot.card_id !== null) {
    throw new RangeError(
      `pickPlayer: slot ${targetSlotId} is already occupied (lock-on-pick: an assigned slot is immutable)`,
    );
  }

  const compat = positionCompatibility(pcard.eligible_positions, slot.slot_position);
  const newCardId = buildCardId(parsed.player_id, active.tournament_id);
  const newSlot = freezeSlot({
    ...slot,
    card_id: newCardId,
    player_id: parsed.player_id,
    tournament_id: active.tournament_id,
    position_compatibility: compat,
    validation_warnings: buildSlotWarnings(slot.slot_position, pcard.eligible_positions, compat),
  });
  const squad = state.squad.map((s) => (s.slot_id === targetSlotId ? newSlot : s));

  const pickedSpin = freezeSpin({
    ...active,
    picked_kind: "player",
    picked_card_id: newCardId,
    picked_player_id: parsed.player_id,
    assigned_slot_id: targetSlotId,
    picked_manager_card_id: null,
    status: "picked",
  });
  const withPick = state.spins.map((s) => (s.index === active.index ? pickedSpin : s));
  const spins = rebuildSpins(catalog, withPick);

  return finalize(state, spins, squad, state.manager_card_id);
}

/**
 * Confirm a MANAGER pick on the active spin. The coach goes to the dedicated
 * `DraftState.manager_card_id` slot — NEVER a SquadSlot — and no later spin
 * offers a coach. ≤1 manager across the run.
 *
 * @throws RangeError if the draft is complete, a manager has already been
 *   drafted, or the active spin offers no coach.
 */
export function pickManager(catalog: DraftCatalog, state: DraftState): DraftState {
  const active = activeSpin(state);
  if (!active) {
    throw new RangeError("pickManager: the draft has no pending spin (all 17 are resolved)");
  }
  if (state.manager_card_id !== null) {
    throw new RangeError(
      "pickManager: a manager has already been drafted (≤1 manager across the 17 spins)",
    );
  }
  if (active.rolled_manager_card_id === null) {
    throw new RangeError(`pickManager: spin ${active.index} offers no coach`);
  }
  const mgr = active.rolled_manager_card_id;
  const pickedSpin = freezeSpin({
    ...active,
    picked_kind: "manager",
    picked_card_id: null,
    picked_player_id: null,
    assigned_slot_id: null,
    picked_manager_card_id: mgr,
    status: "picked",
  });
  const withPick = state.spins.map((s) => (s.index === active.index ? pickedSpin : s));
  const spins = rebuildSpins(catalog, withPick);
  // Squad untouched: the manager never occupies a SquadSlot.
  return finalize(state, spins, state.squad, mgr);
}

// ─── PUBLIC: DEFAULT AUTOPILOT POLICY ────────────────────────────────────────

/**
 * Advance the draft by exactly one spin using the deterministic default policy.
 * The policy is purely STATE-DERIVED (no hidden counters), so stepping from a
 * resumed snapshot reproduces the same forward sequence (lock-on-pick resume):
 *
 *   - Take the MANAGER the first time a coach is offered and none is drafted
 *     yet (≤1 manager; the other 16 spins fill the 16 player slots exactly).
 *   - Otherwise take the canonically-first player candidate
 *     (`rolled_card_ids[0]`) and assign it to the first vacant slot (starters
 *     before bench).
 *
 * @throws RangeError if the draft is complete, a player spin has no candidates,
 *   or no coach is ever offered (a 17th player has nowhere to go).
 */
export function stepDraft(catalog: DraftCatalog, state: DraftState): DraftState {
  const active = activeSpin(state);
  if (!active) {
    throw new RangeError("stepDraft: the draft is already complete");
  }
  const needManager = state.manager_card_id === null;
  if (needManager && active.rolled_manager_card_id !== null) {
    return pickManager(catalog, state);
  }
  if (active.rolled_card_ids.length === 0) {
    throw new RangeError(
      `stepDraft: spin ${active.index} has no player candidates and no coach to draft`,
    );
  }
  const slotId = firstVacantSlotId(state);
  if (slotId === null) {
    throw new RangeError(
      `stepDraft: no vacant slot for a player at spin ${active.index} — was a coach ever offered?`,
    );
  }
  return pickPlayer(catalog, state, active.rolled_card_ids[0]!, slotId);
}

/**
 * Run a full 17-spin draft to completion with the deterministic default policy.
 * Identical (params, dataset) → byte-identical DraftState. This is the harness
 * the golden tests exercise; real gameplay drives `pickPlayer` / `pickManager`
 * from user choices instead.
 */
export function autoDraft(input: CreateDraftParams & { dataset: DraftDataset }): DraftState {
  const { dataset, ...params } = input;
  const catalog = buildDraftCatalog(dataset);
  let state = createDraft(catalog, params);
  while (!isDraftComplete(state)) {
    state = stepDraft(catalog, state);
  }
  return state;
}

// ─── PUBLIC: SQUAD VALIDATION (soft summary) ─────────────────────────────────

/**
 * Compute the squad-level validation summary. `is_fieldable` (11 starters
 * assigned) is the ONLY hard gate; everything else is a soft warning surfaced
 * to the UI / sim (no-GK, out-of-position, missing manager on a complete draft).
 */
export function validateSquad(state: DraftState): SquadValidation {
  const starters = state.squad.filter((s) => s.is_starter);
  const is_fieldable = starters.every((s) => s.card_id !== null);
  const gkSlot = starters.find((s) => slotPositionLine(s.slot_position) === "GK");
  const has_goalkeeper =
    !!gkSlot && gkSlot.card_id !== null && gkSlot.position_compatibility === 1;

  const warnings: string[] = [];
  for (const slot of state.squad) {
    for (const w of slot.validation_warnings) warnings.push(`${slot.slot_id}: ${w}`);
  }
  if (!is_fieldable) {
    warnings.push("XI incomplete: not all 11 starter slots are filled");
  }
  if (!has_goalkeeper) {
    warnings.push("no recognised goalkeeper in the XI — outfielder-in-goal penalty applies");
  }
  if (state.manager_card_id === null && isDraftComplete(state)) {
    warnings.push("no manager drafted");
  }
  return { is_fieldable, has_goalkeeper, warnings };
}
