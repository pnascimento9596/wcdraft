// Memory (hidden) mode — blind seam + determinism contract tests.
//
// REQUIRED OUTCOMES (memory-hidden-mode build plan):
//   - DETERMINISM: a hidden run and a classic run from the SAME seed produce
//     BYTE-IDENTICAL sim results. Mode is display-only — it never reaches the
//     engine/sim. Asserted on the full `PersistedSimulation` payload.
//   - BLIND SET (display): `blindCardRatingView` hides OVR, the four
//     channels, coverage (rating-confidence metadata — % and bars), the
//     legend gold (via the #56 `badge_kind` seam — never a re-derived
//     OVR≥96 check), the provenance hue/label, and `overall_basis`.
//   - KEEP SET (display): identity (name, nation, year), position shape
//     inputs, position-fit/compatibility numerics, stats and interactivity
//     inputs stay untouched.
//   - TOKEN: `md: "hidden"` rides the `t1.` token and reconstructs a
//     hidden-mode draft, so a shared hidden run replays (and reveals) on web.

import { describe, expect, it } from "vitest";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  activeSpin,
  autoDraft,
  buildDraftCatalog,
  createDraft,
  stepDraft,
  type DraftDataset,
  type DraftState,
} from "@wcdraft/core";
import {
  DAILY_SEED_SALT_MAP_BUNDLE,
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  SCENARIO_2026_BUNDLE,
  type RuntimeDataManifest,
} from "@wcdraft/data";

import type { GameData, RunRecordVersions } from "../data";
import { buildGameDataIndexes, composeVersions } from "../data";
import type { RunRecordV1 } from "../run-record";
import { runSimulationSync } from "../simulate";
import {
  draftCandidateViews,
  lineStrengthViews,
  pitchSlotViews,
  playerCardView,
  squadAverageOverall,
} from "../adapters";
import {
  buildRunTokenBody,
  decodeRunToken,
  encodeRunToken,
  reconstructDraftFromToken,
} from "../run-token";
import { buildMemoryRevealView } from "../memory-reveal-model";
import { blindCardRatingView, type CardRatingView } from "../view-models";
import type { PlayerCardView } from "../view-models";
import { CandidateCard } from "@/components/game/candidate-card";

// ─── Harness (mirrors run-token.test.ts) ─────────────────────────────────────

const PARENT_SEED = "wcdraft:memory-mode:v1:7";

function buildDataset(): DraftDataset {
  const ratingByCardId = new Map(DRAFT_POOL_BUNDLE.ratings.map((r) => [r.card_id, r]));
  return {
    players: DRAFT_POOL_BUNDLE.player_cards.map((c) => ({
      player_id: c.player_id,
      tournament_id: c.tournament_id,
      nation_id: c.nation_id,
      eligible_positions: c.eligible_positions,
      choice_overall: {
        career: ratingByCardId.get(c.card_id)?.overall ?? null,
        current: ratingByCardId.get(c.card_id)?.basis_ratings.current.overall ?? null,
      },
    })),
    managers: DRAFT_POOL_BUNDLE.manager_cards.map((m) => ({
      manager_id: m.manager_id,
      tournament_id: m.tournament_id,
      nation_id: m.nation_id,
    })),
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
    dailySeedSaltMap: DAILY_SEED_SALT_MAP_BUNDLE,
  };
}

function buildRecord(
  gameData: GameData,
  mode: "classic" | "hidden" | "open_hidden",
  seed = PARENT_SEED,
): RunRecordV1 {
  const draft = autoDraft({
    run_id: "memory-mode-origin",
    parent_seed: seed,
    formation_id: "4-3-3",
    mode,
    team_name: "Memory XI",
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    dataset: gameData.draftDataset,
  });
  return {
    record_version: 1,
    run_id: "memory-mode-origin",
    parent_seed: seed,
    created_seq: 1,
    updated_seq: 1,
    versions: gameData.versions,
    draft,
  };
}

/** DraftState with the `mode` field dropped — for everything-else equality. */
function draftSansMode(draft: DraftState): Omit<DraftState, "mode"> {
  const { mode, ...rest } = draft;
  void mode;
  return rest;
}

// ─── Determinism: mode never reaches the engine/sim ──────────────────────────

describe("memory mode — classic vs hidden determinism", () => {
  const gameData = buildGameDataFromBundles();
  const classic = buildRecord(gameData, "classic");
  const hidden = buildRecord(gameData, "hidden");

  it("same seed → byte-identical DraftState apart from the mode tag", () => {
    expect(classic.draft.mode).toBe("classic");
    expect(hidden.draft.mode).toBe("hidden");
    // Spins, picks, squad, dedup state — everything but `mode` is identical.
    expect(JSON.stringify(draftSansMode(hidden.draft))).toBe(
      JSON.stringify(draftSansMode(classic.draft)),
    );
  });

  it("same seed → BYTE-IDENTICAL PersistedSimulation payloads", () => {
    const classicSim = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, classic).simulation;
    const hiddenSim = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, hidden).simulation;
    // The whole deterministic payload — scenario, run (score breakdown,
    // narrative, seed), per-match event logs, group stage, ladder meta.
    expect(JSON.stringify(hiddenSim)).toBe(JSON.stringify(classicSim));
  });
});

// ─── Blind seam: blindCardRatingView ─────────────────────────────────────────

describe("memory mode — blindCardRatingView blind/keep sets", () => {
  const legendInput: CardRatingView = {
    overall: 97,
    attack: 95,
    midfield: 88,
    defense: 41,
    goalkeeping: 12,
    coverage: 0.92,
    provenance: "wc_performance",
    overall_basis: "measured_performance",
    legend: true,
    badge_kind: "legend",
    badge_label: "Legend",
    basis: "career",
  };

  it("hides the full blind set — OVR, channels, legend gold, provenance hue", () => {
    const blinded = blindCardRatingView(legendInput);
    expect(blinded.overall).toBeNull();
    expect(blinded.attack).toBeNull();
    expect(blinded.midfield).toBeNull();
    expect(blinded.defense).toBeNull();
    expect(blinded.goalkeeping).toBeNull();
    // Legend gold is blinded via the badge seam, not a re-derived check.
    expect(blinded.badge_kind).toBe("masked");
    expect(blinded.badge_label).toBe("Hidden");
    expect(blinded.legend).toBeUndefined();
    expect(blinded.overall_basis).toBeUndefined();
    // `basis` is CONFIG, not a rating signal — it survives blinding so the
    // CURRENT chip can still render while every numeric stays masked.
    expect(blinded.basis).toBe("career");
    expect(blindCardRatingView({ ...legendInput, basis: "current" }).basis).toBe("current");
  });

  it("blinds coverage (rating-confidence metadata) and does not mutate its input", () => {
    const before = JSON.stringify(legendInput);
    const blinded = blindCardRatingView(legendInput);
    expect(blinded.coverage).toBeNull();
    expect(JSON.stringify(legendInput)).toBe(before);
  });

  it("masks every badge kind uniformly — estimate/projected don't leak either", () => {
    for (const badge_kind of ["historical", "projected", "estimate", "legend"] as const) {
      const blinded = blindCardRatingView({ ...legendInput, badge_kind });
      expect(blinded.badge_kind).toBe("masked");
    }
  });
});

// ─── Blind seam: adapter threading ───────────────────────────────────────────

describe("memory mode — adapters blind ratings but keep identity", () => {
  const gameData = buildGameDataFromBundles();
  const record = buildRecord(gameData, "hidden");
  const firstCardId = record.draft.squad.find((sl) => sl.card_id !== null)!.card_id!;

  it("playerCardView({blindRatings:true}) blinds rating, keeps the keep set", () => {
    const open = playerCardView(gameData.indexes, firstCardId);
    const blinded = playerCardView(gameData.indexes, firstCardId, { blindRatings: true });

    // Blind set.
    expect(blinded.rating.overall).toBeNull();
    expect(blinded.rating.attack).toBeNull();
    expect(blinded.rating.badge_kind).toBe("masked");

    // Keep set — identity, shape inputs, stats are untouched.
    expect(blinded.name).toBe(open.name);
    expect(blinded.nation_code).toBe(open.nation_code);
    expect(blinded.nation_name).toBe(open.nation_name);
    expect(blinded.year).toBe(open.year);
    expect(blinded.primary_position).toBe(open.primary_position);
    expect(blinded.eligible_positions).toEqual(open.eligible_positions);
    expect(blinded.stats).toEqual(open.stats);
    // Coverage is rating-confidence metadata — it rides the BLIND set.
    expect(blinded.rating.coverage).toBeNull();
  });

  it("legend cards never leak gold through the blind", () => {
    // Find a card whose OPEN badge is legend after the public badge fold.
    let open: PlayerCardView | null = null;
    for (const [cardId] of gameData.indexes.ratingByCardId) {
      const candidate = playerCardView(gameData.indexes, cardId);
      if (candidate.rating.badge_kind === "legend") {
        open = candidate;
        break;
      }
    }
    if (!open) throw new Error("expected a card with public legend badge");
    expect(open.rating.badge_kind).toBe("legend");
    const blinded = playerCardView(gameData.indexes, open.card_id, { blindRatings: true });
    expect(blinded.rating.badge_kind).toBe("masked");
    expect(blinded.rating.overall).toBeNull();
  });

  it("pitchSlotViews + draftCandidateViews thread the blind to every card", () => {
    const { starters, bench } = pitchSlotViews(gameData.indexes, record.draft, {
      blindRatings: true,
    });
    for (const slot of [...starters, ...bench]) {
      if (!slot.card) continue;
      expect(slot.card.rating.overall).toBeNull();
      expect(slot.card.rating.badge_kind).toBe("masked");
      expect(slot.card.name.length).toBeGreaterThan(0);
    }

    // Candidates on a LIVE (in-progress) draft — the spin pool the user
    // actually scans. Advance a fresh hidden draft a few picks in, then
    // assert every rolled candidate is blinded but identity-complete.
    let inProgress = createDraft(gameData.catalog, {
      run_id: "memory-mode-live",
      parent_seed: `${PARENT_SEED}:candidates`,
      formation_id: "4-3-3",
      mode: "hidden",
      team_name: "Memory XI",
      dataset_version: gameData.versions.dataset_version,
      rating_version: gameData.versions.rating_version,
      engine_version: gameData.versions.engine_version,
    });
    for (let i = 0; i < 3; i += 1) {
      inProgress = stepDraft(gameData.catalog, inProgress);
    }
    const spin = activeSpin(inProgress);
    expect(spin).not.toBeNull();
    const views = draftCandidateViews(gameData.indexes, inProgress, spin, {
      blindRatings: true,
    });
    expect(views.players.length).toBeGreaterThan(0);
    for (const cand of views.players) {
      expect(cand.rating.overall).toBeNull();
      expect(cand.rating.attack).toBeNull();
      expect(cand.rating.badge_kind).toBe("masked");
      expect(cand.name.length).toBeGreaterThan(0);
      expect(cand.nation_code.length).toBeGreaterThan(0);
      expect(cand.year).toBeGreaterThan(1900);
    }
  });

  it("Blind Open full-roster candidates use the same blindCardRatingView seam", () => {
    const inProgress = createDraft(gameData.catalog, {
      run_id: "blind-open-live",
      parent_seed: `${PARENT_SEED}:blind-open:candidates`,
      formation_id: "4-3-3",
      mode: "open_hidden",
      team_name: "Blind Open XI",
      dataset_version: gameData.versions.dataset_version,
      rating_version: gameData.versions.rating_version,
      engine_version: gameData.versions.engine_version,
    });
    const spin = activeSpin(inProgress);
    expect(spin).not.toBeNull();
    const views = draftCandidateViews(gameData.indexes, inProgress, spin, {
      blindRatings: true,
    });
    expect(views.players.length).toBeGreaterThan(3);
    for (const cand of views.players) {
      expect(cand.rating.overall).toBeNull();
      expect(cand.rating.attack).toBeNull();
      expect(cand.rating.midfield).toBeNull();
      expect(cand.rating.defense).toBeNull();
      expect(cand.rating.goalkeeping).toBeNull();
      expect(cand.rating.coverage).toBeNull();
      expect(cand.rating.badge_kind).toBe("masked");
      expect(cand.rating.badge_label).toBe("Hidden");
      expect(cand.name.length).toBeGreaterThan(0);
      expect(cand.primary_position).toMatch(/^(GK|DF|MF|FW)$/u);
      expect(cand.nation_code.length).toBeGreaterThan(0);
      expect(cand.year).toBeGreaterThan(1900);
    }
  });

  it("classic path (no opts) is unchanged — ratings fully visible", () => {
    const open = playerCardView(gameData.indexes, firstCardId);
    expect(typeof open.rating.attack).toBe("number");
    expect(open.rating.badge_kind).not.toBe("masked");
  });
});

// ─── Aggregate seams: squad-average + per-line strength under blind ──────────

describe("memory mode — aggregate seams blind through the adapter", () => {
  const gameData = buildGameDataFromBundles();
  const hidden = buildRecord(gameData, "hidden");
  const classic = buildRecord(gameData, "classic");

  it("classic path: per-line strength returns numeric values", () => {
    const lines = lineStrengthViews(gameData.indexes, classic.draft);
    expect(lines.length).toBeGreaterThan(0);
    for (const ln of lines) {
      expect(typeof ln.value).toBe("number");
      expect(ln.count).toBeGreaterThan(0);
    }
  });

  it("blindRatings:true: every per-line `value` is null (no real channel averaged)", () => {
    const lines = lineStrengthViews(gameData.indexes, hidden.draft, {
      blindRatings: true,
    });
    expect(lines.length).toBeGreaterThan(0);
    for (const ln of lines) {
      expect(ln.value).toBeNull();
      // `count` is the filled-starter count — stays visible so labels render.
      expect(ln.count).toBeGreaterThan(0);
    }
  });

  it("seam leak guard: no numeric `value` field escapes the blind output", () => {
    const blindJson = JSON.stringify(
      lineStrengthViews(gameData.indexes, hidden.draft, { blindRatings: true }),
    );
    // If anyone reintroduces a screen-level mask (computing real channels and
    // ternary-hiding them at the screen), this assertion fires — the seam is
    // the single source of truth.
    expect(blindJson).not.toMatch(/"value"\s*:\s*\d/);
  });

  it("blind classic-mode draft (opts={blindRatings:false}) still returns numbers", () => {
    const lines = lineStrengthViews(gameData.indexes, classic.draft, {
      blindRatings: false,
    });
    expect(lines.length).toBeGreaterThan(0);
    for (const ln of lines) {
      expect(typeof ln.value).toBe("number");
    }
  });

  it("squadAverageOverall (aggregate seam, sanity): blind ⇒ null", () => {
    expect(squadAverageOverall(gameData.indexes, hidden.draft, { blindRatings: true })).toBeNull();
    expect(typeof squadAverageOverall(gameData.indexes, classic.draft)).toBe("number");
  });
});

describe("memory mode — reveal view model", () => {
  const gameData = buildGameDataFromBundles();
  const hidden = buildRecord(gameData, "hidden");
  const blindOpen = buildRecord(gameData, "open_hidden", `${PARENT_SEED}:blind-open:reveal`);

  it("shows the drafted-against blind state as honest dashes before actual revealed ratings", () => {
    const reveal = buildMemoryRevealView(gameData, hidden.draft);
    expect(reveal.squadAverageBefore).toBeNull();
    expect(typeof reveal.squadAverageAfter).toBe("number");
    expect(reveal.lineRatings.length).toBeGreaterThan(0);
    for (const line of reveal.lineRatings) {
      expect(line.before_value).toBeNull();
      expect(typeof line.after_value).toBe("number");
    }
    expect(reveal.revealStarters).toHaveLength(11);
    for (const starter of reveal.revealStarters) {
      expect(starter.before_overall).toBeNull();
    }
    expect(reveal.topReveals.length).toBeGreaterThan(0);
    expect(reveal.topReveals.some((starter) => typeof starter.after_overall === "number")).toBe(
      true,
    );
  });

  it("reveals a completed Blind Open run from the full-roster pick space", () => {
    const reveal = buildMemoryRevealView(gameData, blindOpen.draft);
    expect(blindOpen.draft.mode).toBe("open_hidden");
    expect(reveal.squadAverageBefore).toBeNull();
    expect(typeof reveal.squadAverageAfter).toBe("number");
    expect(reveal.starters).toHaveLength(11);
    expect(reveal.bench).toHaveLength(5);
    expect(reveal.revealStarters).toHaveLength(11);
    expect(reveal.topReveals.length).toBeGreaterThan(0);
    for (const starter of reveal.revealStarters) {
      expect(starter.before_overall).toBeNull();
      expect(typeof starter.after_overall).toBe("number");
    }
  });
});

// ─── Markup digit probe: a hidden candidate leaks no coverage digits ─────────

describe("memory mode — hidden candidate markup contains no coverage digits", () => {
  const gameData = buildGameDataFromBundles();
  const record = buildRecord(gameData, "hidden");
  const firstCardId = record.draft.squad.find((sl) => sl.card_id !== null)!.card_id!;

  /** Static-markup render (no DOM needed) of the EXPANDED candidate row. */
  function renderCard(card: PlayerCardView): string {
    return renderToStaticMarkup(
      createElement(CandidateCard, {
        card,
        selected: true,
        onSelect: () => {},
      }),
    );
  }

  /** Visible text only — strips tags (and with them style/title attributes). */
  function textContent(html: string): string {
    return html.replace(/<[^>]+>/g, " ");
  }

  it("hidden candidate: zero coverage digits — every digit run is keep-set", () => {
    const blinded = playerCardView(gameData.indexes, firstCardId, { blindRatings: true });
    const text = textContent(renderCard(blinded));

    // Coverage is the only %-rendered value on the candidate card; the blind
    // must leave no percentage anywhere (collapsed cov cell, expanded bar val).
    expect(text).not.toMatch(/\d\s*%/);

    // Stronger: every digit run on a hidden candidate comes from the KEEP set
    // (year, shirt number, era stats, club label) — never a rating signal.
    const allowed = new Set<string>([String(blinded.year)]);
    if (blinded.shirt_number !== null) allowed.add(String(blinded.shirt_number));
    for (const st of blinded.stats) {
      if (typeof st.value === "number") allowed.add(String(st.value));
    }
    for (const run of blinded.club_label?.match(/\d+/g) ?? []) allowed.add(run);
    for (const run of text.match(/\d+/g) ?? []) {
      expect(allowed.has(run), `unexpected digit run "${run}" on a hidden candidate`).toBe(true);
    }
  });

  it("classic control: the coverage % still renders", () => {
    const open = playerCardView(gameData.indexes, firstCardId);
    const text = textContent(renderCard(open));
    expect(text).toMatch(/\d+%/);
  });
});

// ─── Token: `md` rides the replay token (share/replay → reveal path) ─────────

describe("memory mode — replay token carries and reconstructs hidden mode", () => {
  const gameData = buildGameDataFromBundles();
  const hidden = buildRecord(gameData, "hidden");

  it("encodes md='hidden' and round-trips through decode", () => {
    const body = buildRunTokenBody(hidden);
    expect(body.md).toBe("hidden");
    const decoded = decodeRunToken(encodeRunToken(hidden));
    expect(decoded).not.toBeNull();
    expect(decoded!.md).toBe("hidden");
  });

  it("reconstructs a hidden-mode draft byte-identical to the origin", () => {
    const decoded = decodeRunToken(encodeRunToken(hidden))!;
    const replayed = reconstructDraftFromToken(decoded, gameData);
    expect(replayed.mode).toBe("hidden");
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(hidden.draft));
  });
});
