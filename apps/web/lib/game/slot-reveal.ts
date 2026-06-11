// Pure helper that converts the deterministic engine output (`Spin`,
// `draft.spins`, `GameDataIndexes`) into a display-only model for the
// slot-machine reveal.
//
// HARD CONTRACT — DETERMINISM:
//   - `result` MUST come from `activeSpin.nation_id` + `activeSpin.tournament_id`.
//   - `reels[1].landingFace` MUST equal `result`.
//   - No randomness (`Math.random` / `Date.now` / `crypto`) anywhere in this
//     module. Neighbor reel faces are derived deterministically from the
//     spin list.
//   - Output is referentially stable for identical inputs (golden-friendly).
//
// The component layer (`slot-machine.tsx`) consumes this model and animates
// the reels visually. It must not alter draft state.

import type { EraPresetId, Spin } from "@wcdraft/core";

import type { GameDataIndexes } from "./data";
import { flagSrcForNationId } from "./flags";

export interface SlotRevealFace {
  /** Stable key for React lists: `${nationId}:${tournamentId}:${slotIndex}`. */
  readonly key: string;
  readonly nationId: string;
  readonly nationName: string;
  readonly nationCode: string | null;
  readonly flagSrc: string | null;
  readonly yearLabel: string;
}

export interface SlotRevealReel {
  readonly key: "left" | "center" | "right";
  readonly landingFace: SlotRevealFace;
  /**
   * Ordered sequence of faces that scroll past the window. The FINAL entry is
   * always `landingFace` so the visual track stops on the deterministic
   * result.
   */
  readonly trackFaces: readonly SlotRevealFace[];
}

export interface SlotRevealModel {
  /** Display string, exact format: `PICK 01 OF 17`. */
  readonly pickLabel: string;
  /** Display string, exact format: `SPIN RESULT — Argentina 1986`. */
  readonly resultLine: string;
  /** Authoritative result face — equal to `reels[1].landingFace`. */
  readonly result: SlotRevealFace;
  readonly reels: readonly [SlotRevealReel, SlotRevealReel, SlotRevealReel];
  /**
   * ENGINE-V2 E-2 — pass-through of the engine's rare flag for the active
   * spin. The UI surfaces this with a gold "RARE PICK!" accent; this layer
   * does NOT recompute rarity.
   */
  readonly rare: boolean;
  /**
   * ENGINE-V2 E-2 — the honest engine-computed draw probability for the
   * active spin (in [0, 1]). Displayed as a percentage; rare spins read at
   * `<= 10%` in practice but the UI shows whatever the engine emitted.
   */
  readonly drawProbability: number;
  /** Pre-formatted percent label, e.g. `12.4%` / `0.42%` / `0.0%`. */
  readonly drawProbabilityLabel: string;
  /**
   * DC-2 — display label for a NON-default era preset bounding this run's
   * pool (e.g. `Modern (2018–2026)`), or `null` under the default all-time
   * pool (today's rendering, unchanged). Sampling metadata only — allowed in
   * Memory mode's keep set.
   */
  readonly eraPresetLabel: string | null;
}

export interface BuildSlotRevealModelParams {
  readonly activeSpin: Spin;
  readonly allSpins: readonly Spin[];
  readonly indexes: GameDataIndexes;
  readonly totalPicks: number;
  /** DC-2 — the run's era preset (default `all_time`). */
  readonly eraPreset?: EraPresetId;
}

const ERA_REVEAL_LABELS: Record<Exclude<EraPresetId, "all_time">, string> = {
  post_2000: "Post-2000 (2002–2026)",
  post_2010: "Post-2010 (2014–2026)",
  modern: "Modern (2018–2026)",
};

const TRACK_LEN = 7;

/** Build the deterministic slot-machine model for the given active spin. */
export function buildSlotRevealModel(
  params: BuildSlotRevealModelParams,
): SlotRevealModel {
  const { activeSpin, allSpins, indexes, totalPicks, eraPreset } = params;

  const resultFace = faceFromSpin(activeSpin, indexes, "C");
  const pickLabel = `PICK ${String(activeSpin.index + 1).padStart(2, "0")} OF ${totalPicks}`;
  const resultLine = `SPIN RESULT — ${resultFace.nationName} ${resultFace.yearLabel}`;

  // Build deterministic neighbor faces by walking the ordered spin ring.
  const sortedSpins = [...allSpins].sort((a, b) => a.index - b.index);
  const ringLen = sortedSpins.length;
  const activeRingIndex = Math.max(
    0,
    sortedSpins.findIndex((s) => s.index === activeSpin.index),
  );

  // Left = previous (wrap-around). Right = next (wrap-around). On a full
  // 17-spin draft these are always distinct from the active spin.
  const leftSpin =
    ringLen > 1
      ? sortedSpins[(activeRingIndex - 1 + ringLen) % ringLen]!
      : activeSpin;
  const rightSpin =
    ringLen > 1
      ? sortedSpins[(activeRingIndex + 1) % ringLen]!
      : activeSpin;

  const leftLanding = faceFromSpin(leftSpin, indexes, "L");
  const rightLanding = faceFromSpin(rightSpin, indexes, "R");

  const centerTrack = buildTrack(
    sortedSpins,
    activeRingIndex,
    resultFace,
    indexes,
    "C",
  );
  const leftTrack = buildTrack(
    sortedSpins,
    (activeRingIndex - 1 + ringLen) % ringLen,
    leftLanding,
    indexes,
    "L",
  );
  const rightTrack = buildTrack(
    sortedSpins,
    (activeRingIndex + 1) % ringLen,
    rightLanding,
    indexes,
    "R",
  );

  return {
    pickLabel,
    resultLine,
    result: resultFace,
    reels: [
      { key: "left", landingFace: leftLanding, trackFaces: leftTrack },
      { key: "center", landingFace: resultFace, trackFaces: centerTrack },
      { key: "right", landingFace: rightLanding, trackFaces: rightTrack },
    ],
    rare: activeSpin.rare,
    drawProbability: activeSpin.draw_probability,
    drawProbabilityLabel: formatDrawProbability(activeSpin.draw_probability),
    eraPresetLabel:
      eraPreset && eraPreset !== "all_time" ? ERA_REVEAL_LABELS[eraPreset] : null,
  };
}

/**
 * Format an engine-emitted draw probability (in [0, 1]) as a deterministic,
 * locale-stable percent string suitable for snapshots and golden tests.
 *
 * Rules:
 *   * Below 1% → 2 decimals (e.g. `0.42%`).
 *   * 1% and above → 1 decimal (e.g. `12.4%`).
 *   * Hard zero → `0.00%` (honest, not hidden).
 *   * Anything outside [0, 1] is displayed honestly (the engine controls the
 *     value; UI never silently clamps it).
 */
export function formatDrawProbability(p: number): string {
  if (!Number.isFinite(p)) return "—";
  const pct = p * 100;
  if (pct < 1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

function buildTrack(
  ring: readonly Spin[],
  landingIdx: number,
  landingFace: SlotRevealFace,
  indexes: GameDataIndexes,
  reelKey: "L" | "C" | "R",
): readonly SlotRevealFace[] {
  if (ring.length === 0) return [landingFace];

  // Walk backward from the landing index so the LAST face is the landing.
  // The 1st-N-1 faces are taken from earlier ring entries (mod ring.length).
  const faces: SlotRevealFace[] = [];
  for (let i = 0; i < TRACK_LEN; i++) {
    const ringIdx =
      (((landingIdx - (TRACK_LEN - 1 - i)) % ring.length) + ring.length) %
      ring.length;
    if (i === TRACK_LEN - 1) {
      faces.push(landingFace);
    } else {
      const spin = ring[ringIdx]!;
      faces.push(faceFromSpin(spin, indexes, reelKey, i));
    }
  }
  return faces;
}

function faceFromSpin(
  spin: Spin,
  indexes: GameDataIndexes,
  reelKey: "L" | "C" | "R",
  slotIdx?: number,
): SlotRevealFace {
  const nation = indexes.nationById.get(spin.nation_id);
  const tournament = indexes.tournamentById.get(spin.tournament_id);
  const nationName = nation?.canonical_name ?? spin.nation_id;
  const nationCode = nation?.code ?? null;
  const yearLabel = String(tournament?.year ?? spin.tournament_id);
  const slotPart = slotIdx === undefined ? "land" : String(slotIdx);
  return {
    key: `${reelKey}:${spin.index}:${spin.nation_id}:${spin.tournament_id}:${slotPart}`,
    nationId: spin.nation_id,
    nationName,
    nationCode,
    flagSrc: flagSrcForNationId(spin.nation_id),
    yearLabel,
  };
}
