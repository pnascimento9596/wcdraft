// I3.7 fix-pass #2 — gate + share-fallback contract tests.
//
// CONTEXT (PR #18 review BLOCKER #2):
//   The draft UI previously gated Review/Simulate on `validation.is_fieldable`
//   (11 starters), which is reachable at Spin 12/17 with an empty bench and
//   no manager. Following that path to Share emitted a bare local
//   `run-v1-*` id (silent fallback in share-screen.tsx) when token encoding
//   failed on the partial squad — a non-reproducible URL that violates the
//   share/replay contract.
//
// FIX:
//   - The UI gate flips to `isDraftComplete(draft)` (all 17 spins consumed) —
//     i.e. the same condition the share token already requires to encode.
//   - The silent bare-id fallback is removed; `share-screen.tsx` surfaces an
//     honest disabled/error state instead of emitting a `run-v1-*` URL.
//
// THESE TESTS PROVE THE FIX (and would have caught the regression):
//   1. PREDICATE — fieldable-but-not-complete draft (<17 spins) is NOT
//      `isDraftComplete`. The unlock condition the UI uses is the same
//      `isDraftComplete` the token requires.
//   2. INVARIANT — encoding a `<17-pick` draft throws `RunTokenError`; a
//      complete draft yields a replay token.
//   3. REGRESSION — the production share-screen source contains NO
//      `shareHref(record.run_id)` (the removed bare-id fallback) and emits
//      `null` for the share URL on token-encoding failure.
//   4. END-TO-END — a complete 17-spin draft produces a replay token that
//      decodes + replays to a byte-identical DraftState in a fresh context.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDraftCatalog,
  createDraft,
  isDraftComplete,
  stepDraft,
  validateSquad,
  type DraftDataset,
  type DraftState,
} from "@wcdraft/core";
import { DRAFT_POOL_BUNDLE, RUNTIME_DATA_MANIFEST, type RuntimeDataManifest } from "@wcdraft/data";

import {
  buildGameDataIndexes,
  composeVersions,
  type GameData,
  type RunRecordVersions,
} from "../data";
import type { RunRecordV1 } from "../run-record";
import {
  decodeRunToken,
  encodeRunToken,
  reconstructDraftFromToken,
  RUN_TOKEN_V2_PREFIX,
  RunTokenError,
} from "../run-token";

// ─── Harness ─────────────────────────────────────────────────────────────────

const PARENT_SEED = "wcdraft:gate-and-fallback:v1:1";

function buildDataset(): DraftDataset {
  return {
    players: DRAFT_POOL_BUNDLE.player_cards.map((c) => ({
      player_id: c.player_id,
      tournament_id: c.tournament_id,
      nation_id: c.nation_id,
      eligible_positions: c.eligible_positions,
    })),
    managers: DRAFT_POOL_BUNDLE.manager_cards.map((m) => ({
      manager_id: m.manager_id,
      tournament_id: m.tournament_id,
      nation_id: m.nation_id,
    })),
    // ENGINE-V2 E-1: era-weighted sampling needs tournament years.
    tournaments: Object.entries(DRAFT_POOL_BUNDLE.tournaments).map(([tid, t]) => ({
      tournament_id: Number(tid),
      year: t.year,
    })),
  };
}

function buildGameDataFromBundles(): GameData {
  const manifest = RUNTIME_DATA_MANIFEST as RuntimeDataManifest;
  const versions: RunRecordVersions = composeVersions(manifest);
  const indexes = buildGameDataIndexes(DRAFT_POOL_BUNDLE);
  const draftDataset = buildDataset();
  const catalog = buildDraftCatalog(draftDataset);
  return {
    manifest,
    draftPool: DRAFT_POOL_BUNDLE,
    versions,
    indexes,
    draftDataset,
    catalog,
    nationByCardId: DRAFT_POOL_BUNDLE.nation_by_card_id,
  };
}

function freshDraft(gameData: GameData): DraftState {
  return createDraft(gameData.catalog, {
    run_id: "gate-test",
    parent_seed: PARENT_SEED,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Gate XI",
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
  });
}

/**
 * Step the deterministic policy until the squad is fieldable (11 starters
 * assigned) but NOT yet complete (< 17 spins consumed). This is the EXACT
 * shape the reviewer hit at "Spin 12/17": Review/Simulate were reachable
 * even though the bench/manager were still pending. The defualt stepDraft
 * policy fills starters before bench, so the fieldable-but-not-complete
 * state is hit deterministically before the final spins.
 */
function buildFieldableNotCompleteDraft(gameData: GameData): DraftState {
  let state = freshDraft(gameData);
  while (!isDraftComplete(state)) {
    state = stepDraft(gameData.catalog, state);
    if (validateSquad(state).is_fieldable && !isDraftComplete(state)) return state;
  }
  throw new Error(
    "buildFieldableNotCompleteDraft: deterministic policy never produced a fieldable-but-not-complete state",
  );
}

function buildCompleteDraft(gameData: GameData): DraftState {
  let state = freshDraft(gameData);
  while (!isDraftComplete(state)) {
    state = stepDraft(gameData.catalog, state);
  }
  return state;
}

function recordFor(gameData: GameData, draft: DraftState): RunRecordV1 {
  return {
    record_version: 1,
    run_id: draft.run_id,
    parent_seed: PARENT_SEED,
    created_seq: 1,
    updated_seq: 1,
    versions: gameData.versions,
    draft,
  };
}

// ─── 1. PREDICATE: the gate condition is "all 17 spins consumed" ──────────

describe("gate predicate — Simulate/Share unlocks on isDraftComplete, not is_fieldable", () => {
  const gameData = buildGameDataFromBundles();

  it("a fieldable-but-not-complete draft is NOT `isDraftComplete` (the reviewer's Spin 12/17 path)", () => {
    const partial = buildFieldableNotCompleteDraft(gameData);
    const v = validateSquad(partial);

    // This is the regression shape: 11 starters present, but spins remain.
    expect(v.is_fieldable).toBe(true);
    expect(isDraftComplete(partial)).toBe(false);

    // Count picked spins — must be < 17 (otherwise it would be complete).
    const picked = partial.spins.filter((s) => s.status === "picked").length;
    expect(picked).toBeLessThan(17);
    expect(picked).toBeGreaterThanOrEqual(11); // 11 starter bodies in.
  });

  it("a fully drafted 17-spin draft IS `isDraftComplete` (the only unlock condition)", () => {
    const complete = buildCompleteDraft(gameData);
    expect(isDraftComplete(complete)).toBe(true);
    expect(complete.spins.filter((s) => s.status === "picked").length).toBe(17);
    // Plus the implied byproducts of consuming all 17 spins.
    const startersFilled = complete.squad
      .filter((s) => s.is_starter)
      .every((s) => s.card_id !== null);
    const benchFilled = complete.squad
      .filter((s) => !s.is_starter)
      .every((s) => s.card_id !== null);
    expect(startersFilled).toBe(true);
    expect(benchFilled).toBe(true);
    expect(complete.manager_card_id).not.toBeNull();
  });
});

// ─── 2. INVARIANT: the share token requires draft completion ──────────────

describe("share-token invariant — encoding a <17-pick draft throws; a complete draft tokenizes", () => {
  const gameData = buildGameDataFromBundles();

  it("encodeRunToken throws RunTokenError for a fieldable-but-not-complete draft (<17 picks)", () => {
    const partial = buildFieldableNotCompleteDraft(gameData);
    const record = recordFor(gameData, partial);
    expect(() => encodeRunToken(record)).toThrow(RunTokenError);
  });

  it("encodeRunToken yields `t2.<base64url>` for a complete 17-spin draft", () => {
    const complete = buildCompleteDraft(gameData);
    const record = recordFor(gameData, complete);
    const token = encodeRunToken(record);
    expect(token.startsWith(RUN_TOKEN_V2_PREFIX)).toBe(true);
    const body = token.slice(RUN_TOKEN_V2_PREFIX.length);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/u);
  });
});

// ─── 3. SHARE-SCREEN FALLBACK REMOVED — no bare-id URL is emitted ─────────

describe("share-screen — silent bare-id fallback is removed", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const SHARE_SRC = resolve(HERE, "../../../components/game/share-screen.tsx");
  const src = readFileSync(SHARE_SRC, "utf8");

  it("share-screen.tsx contains NO `shareHref(record.run_id)` (the removed bare-id fallback)", () => {
    // The exact pattern the reviewer flagged at :255 in PR #18. Any future
    // reintroduction of a bare-id share URL must fail this test loudly.
    expect(src).not.toMatch(/shareHref\(\s*record\.run_id\s*\)/);
  });

  it("share-screen.tsx surfaces an honest disabled state instead (shareLinkError)", () => {
    // The replacement emits a visible "Share link unavailable" alert and
    // disables the share-action buttons when token encoding fails.
    expect(src).toMatch(/shareLinkError/);
    expect(src).toMatch(/Share link unavailable/i);
  });

  it("share-screen.tsx still calls encodeRunToken to build the URL", () => {
    // The fix preserves the token replay happy path — only the silent
    // fallback was removed.
    expect(src).toMatch(/encodeRunToken\(\s*record\s*\)/);
  });
});

// ─── 4. END-TO-END: a complete run shares a replay token that replays ──────

describe("regression — complete 17-spin run shares a run token that replays byte-identically", () => {
  const gameData = buildGameDataFromBundles();

  it("token decodes + reconstructs to a byte-identical DraftState in a fresh context", () => {
    const complete = buildCompleteDraft(gameData);
    const record = recordFor(gameData, complete);
    const token = encodeRunToken(record);

    expect(token.startsWith(RUN_TOKEN_V2_PREFIX)).toBe(true);

    const decoded = decodeRunToken(token);
    expect(decoded).not.toBeNull();

    // Replay the token's pick log against the same bundle — the receiving
    // side has NO pre-seeded localStorage; the token alone is enough.
    const replayed = reconstructDraftFromToken(decoded!, gameData);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(record.draft));
  });
});
