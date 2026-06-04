import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  autoDraft,
  buildDraftCatalog,
  createDraft,
  pickPlayer,
  pickManager,
  stepDraft,
  activeSpin,
  isDraftComplete,
  validateSquad,
  DraftStateSchema,
} from "./index.js";
import type { DraftState } from "./index.js";
import {
  buildDraftFixture,
  buildNationSwitcherFixture,
  buildSingleCoachFixture,
  SWITCHER_PLAYER_ID,
} from "./draft.fixture.js";

// GOLDEN INVARIANT (WS-0c depth-layer revision, WS-C implementation):
//   A fixed `draft_seed` reproduces an IDENTICAL 17-spin sequence — same
//   (tournament_id, nation_id) pairs in the same order, same rolled card sets,
//   same post-dedup pools, same per-spin `rolled_manager_card_id`. The manager
//   can be taken on ANY spin, but the candidate space is reproducible
//   byte-for-byte.
//
// This file is SELECTED BY PATH alongside the other golden suites; it RE-DERIVES
// the draft from the committed fixture and deep-equals against the recorded
// snapshot (test/fixtures/draft-golden.json). Regenerate the snapshot
// intentionally with `pnpm --filter @wcdraft/core run gen:golden:draft` (only on
// a deliberate engine change — a diff means the deterministic output drifted).

const here = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(here, "..", "test", "fixtures", "draft-golden.json");
const goldenDraft = (JSON.parse(readFileSync(goldenPath, "utf8")) as { draft: DraftState }).draft;

// nation_id ordering used by the fixture — to recompute "dataset has a coach
// for this (tournament, nation)" without re-importing the builder internals.
const FIXTURE_NATIONS = ["arg", "bra", "eng", "esp", "fra", "ger", "ita", "ned", "por", "uru"];
function fixtureDatasetHasCoach(tournament_id: number, nation_id: string): boolean {
  const idx = FIXTURE_NATIONS.indexOf(nation_id);
  return idx >= 0 && (tournament_id + idx) % 2 === 0;
}

function runFixtureDraft(): DraftState {
  const { dataset, params } = buildDraftFixture();
  return autoDraft({ ...params, dataset });
}

describe("draft — fixed seed reproduces identical 17-spin sequence", () => {
  it("the same (fixture, draft_seed) produces a byte-identical DraftState (determinism guard)", () => {
    const a = runFixtureDraft();
    const b = runFixtureDraft();
    // Determinism within the engine: two independent runs must be identical.
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
    // Drift guard: re-derived run must match the committed golden recording.
    expect(JSON.parse(JSON.stringify(a))).toEqual(goldenDraft);
  });

  it("the persisted draft passes the DraftState boundary schema", () => {
    const draft = runFixtureDraft();
    const parsed = DraftStateSchema.safeParse(draft);
    expect(parsed.success).toBe(true);
  });

  it("flips to 'ready' the moment 11 starters are assigned — before all 17 spins resolve", () => {
    const { dataset, params } = buildDraftFixture();
    const catalog = buildDraftCatalog(dataset);
    let state = createDraft(catalog, params);
    expect(state.status).toBe("drafting");
    let sawReadyWhilePending = false;
    while (!isDraftComplete(state)) {
      state = stepDraft(catalog, state);
      const startersFilled = state.squad
        .filter((s) => s.is_starter)
        .every((s) => s.card_id !== null);
      // The HARD gate is 11 starters — not draft completion.
      expect(state.status).toBe(startersFilled ? "ready" : "drafting");
      if (startersFilled && !isDraftComplete(state)) sawReadyWhilePending = true;
    }
    expect(sawReadyWhilePending).toBe(true);
    expect(state.status).toBe("ready");
  });

  it("has exactly 17 spins indexed 0..16, a 16-slot squad (11 starters + 5 bench), and reaches 'ready'", () => {
    const draft = runFixtureDraft();
    expect(draft.spins).toHaveLength(17);
    draft.spins.forEach((s, i) => expect(s.index).toBe(i));
    expect(draft.squad).toHaveLength(16);
    expect(draft.squad.filter((s) => s.is_starter)).toHaveLength(11);
    expect(draft.squad.filter((s) => !s.is_starter)).toHaveLength(5);
    expect(draft.status).toBe("ready");
    expect(validateSquad(draft).is_fieldable).toBe(true);
  });

  it("all 17 (tournament_id, nation_id) pairs are unique across the spins", () => {
    const draft = runFixtureDraft();
    const keys = draft.spins.map((s) => `${s.tournament_id}:${s.nation_id}`);
    expect(new Set(keys).size).toBe(17);
  });

  it("carries the three version anchors verbatim (honest replay state)", () => {
    const draft = runFixtureDraft();
    expect(draft.dataset_version).toBe("fixture-dataset-v1");
    expect(draft.rating_version).toBe("fixture-rating-v1");
    expect(draft.engine_version).toBe("wcdraft-core@ws-c-fixture");
    expect(draft.draft_seed.length).toBeGreaterThan(0);
  });
});

describe("draft — global dedup never yields a duplicate player_id", () => {
  it("the 16 player picks have 16 distinct player_ids and match deduped_player_ids", () => {
    const draft = runFixtureDraft();
    const playerPicks = draft.spins.filter(
      (s) => s.status === "picked" && s.picked_kind === "player",
    );
    expect(playerPicks).toHaveLength(16);
    const ids = playerPicks.map((s) => s.picked_player_id);
    expect(new Set(ids).size).toBe(16);
    expect(draft.deduped_player_ids).toEqual(ids);
  });

  it("no spin offers a card whose player_id was already picked (global, forward dedup)", () => {
    const draft = runFixtureDraft();
    for (const spin of draft.spins) {
      const excluded = new Set(spin.excluded_player_ids);
      for (const cardId of spin.rolled_card_ids) {
        const playerId = cardId.slice(0, cardId.lastIndexOf(":"));
        expect(excluded.has(playerId)).toBe(false);
      }
    }
  });

  it("a nation-switcher picked in one bucket is excluded from its OTHER bucket later", () => {
    // EXACTLY-17-pair pool → both switcher buckets are drawn. The switcher
    // sorts first, so the autopilot takes it on the earlier of its two spins.
    const { dataset, params } = buildNationSwitcherFixture();
    const draft = autoDraft({ ...params, dataset });
    const switcherSpins = draft.spins
      .filter((s) => (s.tournament_id === 1 && s.nation_id === "esp") || (s.tournament_id === 2 && s.nation_id === "bra"))
      .sort((a, b) => a.index - b.index);
    expect(switcherSpins).toHaveLength(2);
    const [earlier, later] = switcherSpins;
    expect(earlier!.picked_kind).toBe("player");
    expect(earlier!.picked_player_id).toBe(SWITCHER_PLAYER_ID);
    // The later bucket must have dropped the switcher from its roll and listed
    // it among the globally-excluded players.
    expect(later!.rolled_card_ids.some((c) => c.startsWith(`${SWITCHER_PLAYER_ID}:`))).toBe(false);
    expect(later!.excluded_player_ids).toContain(SWITCHER_PLAYER_ID);
    // Picked exactly once across the whole draft.
    expect(draft.deduped_player_ids.filter((p) => p === SWITCHER_PLAYER_ID)).toHaveLength(1);
  });
});

describe("draft — at most ONE manager; manager never in a SquadSlot", () => {
  it("exactly one manager pick, matching DraftState.manager_card_id", () => {
    const draft = runFixtureDraft();
    const managerPicks = draft.spins.filter(
      (s) => s.status === "picked" && s.picked_kind === "manager",
    );
    expect(managerPicks).toHaveLength(1);
    expect(draft.manager_card_id).not.toBeNull();
    expect(managerPicks[0]!.picked_manager_card_id).toBe(draft.manager_card_id);
  });

  it("no spin after the manager pick offers a coach, even when the dataset has one (suppression)", () => {
    const draft = runFixtureDraft();
    const mgrIndex = draft.spins.find((s) => s.picked_kind === "manager")!.index;
    for (const s of draft.spins) {
      if (s.index > mgrIndex) expect(s.rolled_manager_card_id).toBeNull();
    }
    // Exactly one spin in the whole draft carries a non-null coach: the
    // manager-pick spin (every earlier spin in this run offered no coach).
    const withCoach = draft.spins.filter((s) => s.rolled_manager_card_id !== null);
    expect(withCoach.map((s) => s.index)).toEqual([mgrIndex]);
    // Prove SUPPRESSION (not mere absence): at least one later spin's
    // (tournament, nation) DOES have a coach in the dataset yet rolls null.
    const suppressed = draft.spins.filter(
      (s) => s.index > mgrIndex && fixtureDatasetHasCoach(s.tournament_id, s.nation_id),
    );
    expect(suppressed.length).toBeGreaterThan(0);
    for (const s of suppressed) expect(s.rolled_manager_card_id).toBeNull();
  });

  it("the manager card occupies NO field/bench SquadSlot", () => {
    const draft = runFixtureDraft();
    expect(draft.squad.some((slot) => slot.card_id === (draft.manager_card_id as unknown))).toBe(
      false,
    );
    // Only the 16 player picks occupy slots.
    expect(draft.squad.filter((s) => s.card_id !== null)).toHaveLength(16);
  });

  it("the manager may be drafted on ANY spin (interactive: a later, non-zero spin)", () => {
    // Drive the engine by hand: force player picks until a spin offers a coach
    // at a NON-zero index, take the manager there, and confirm suppression.
    const { dataset, params } = buildDraftFixture();
    const catalog = buildDraftCatalog(dataset);
    let state = createDraft(catalog, params);
    let managerIndex = -1;
    while (!isDraftComplete(state)) {
      const active = activeSpin(state)!;
      if (managerIndex < 0 && active.index > 0 && active.rolled_manager_card_id !== null) {
        state = pickManager(catalog, state);
        managerIndex = active.index;
        continue;
      }
      if (active.rolled_card_ids.length > 0 && state.squad.some((sl) => sl.card_id === null)) {
        state = pickPlayer(catalog, state, active.rolled_card_ids[0]!);
      } else {
        state = stepDraft(catalog, state);
      }
    }
    expect(managerIndex).toBeGreaterThan(0);
    expect(state.manager_card_id).toBe(state.spins[managerIndex]!.picked_manager_card_id);
    expect(state.spins.filter((s) => s.picked_kind === "manager")).toHaveLength(1);
    for (const s of state.spins) {
      if (s.index > managerIndex) expect(s.rolled_manager_card_id).toBeNull();
    }
    expect(state.spins.filter((s) => s.picked_kind === "player" && s.status === "picked")).toHaveLength(16);
    expect(DraftStateSchema.safeParse(state).success).toBe(true);
  });

  it("REJECTS a player pick that would strand the manager, forcing the manager on the last coach spin", () => {
    // Exactly-17-pair pool with a single coach: wherever the lone coach spin
    // lands, a player pick there (while no manager is drafted and no later spin
    // offers a coach) must be refused — otherwise the draft becomes unrecoverable.
    const { dataset, params } = buildSingleCoachFixture();
    const catalog = buildDraftCatalog(dataset);
    let state = createDraft(catalog, params);
    const coachSpins = state.spins.filter((s) => s.rolled_manager_card_id !== null);
    expect(coachSpins).toHaveLength(1);
    const coachIndex = coachSpins[0]!.index;

    let forcedManager = false;
    while (!isDraftComplete(state)) {
      const active = activeSpin(state)!;
      if (active.index === coachIndex && state.manager_card_id === null) {
        // The strand guard must reject the player pick here…
        expect(() => pickPlayer(catalog, state, active.rolled_card_ids[0]!)).toThrow(/strand/);
        // …and the manager pick is the only legal move.
        state = pickManager(catalog, state);
        forcedManager = true;
      } else {
        state = pickPlayer(catalog, state, active.rolled_card_ids[0]!);
      }
    }
    expect(forcedManager).toBe(true);
    expect(state.manager_card_id).not.toBeNull();
    expect(state.status).toBe("ready");
    expect(DraftStateSchema.safeParse(state).success).toBe(true);
  });

  it("fails honestly at creation when no drawn pair offers a coach (no silent strand)", () => {
    const { dataset, params } = buildDraftFixture();
    const noCoachDataset = { players: dataset.players, managers: [] };
    const catalog = buildDraftCatalog(noCoachDataset);
    expect(() => createDraft(catalog, params)).toThrow(/coach/);
  });
});
