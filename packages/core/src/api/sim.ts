// Function signatures for the sim engine.
//
// CONTRACT-ONLY: implementations land in WS-B. The runtime stubs throw.
// The TYPE signatures here are authoritative and consumed by WS-B / WS-C / WS-D.

import type { DraftState } from "../types/draft.js";
import type { MatchResult } from "../types/sim.js";
import type { MatchRound } from "../types/primitives.js";
import type { Rating, TeamStrength } from "../types/rating.js";
import type { RunResult } from "../types/run.js";
import type { RunScenario, Team2026 } from "../types/tournament.js";

/**
 * Minimal sim-side view of the user XI — the four channels per assigned card
 * plus the squad aggregate. Distilled from the DraftState's assigned starters
 * + bench cards by the rating engine prior to invoking `simulateMatch`.
 *
 * The sim consumes ONLY this view; it must never reach back into raw cards.
 */
export interface UserXiSimView {
  /** Source DraftState; carried through for replay anchors. */
  draft_id: string;
  /** Per-card ratings for the 11 starters + 5 bench cards. */
  squad_ratings: Rating[];
  /** Aggregate strength derived by the same engine that produces per-card Ratings. */
  aggregate: TeamStrength;
}

/**
 * Simulate one match between the user XI and a real 2026 opponent.
 *
 * DETERMINISM CONTRACT:
 *  - `seed` is the STRING `match_sim` sub-seed produced by
 *    `deriveSubseed(run.seed, "match_sim", "match:<match_index>")`. NEVER a
 *    fresh RNG.
 *  - Any sampling pool inside the sim (rolled events, ET probability,
 *    shootout taker order) MUST be canonically sorted via `canonicalSortBy`
 *    by stable id before any draw — the invariant lives at the sampling site,
 *    but is restated here for reviewers.
 *  - The same (userTeam, opponent, round, seed) → byte-identical MatchResult.
 */
export type SimulateMatchFn = (
  userTeam: UserXiSimView,
  opponent: Team2026,
  round: MatchRound,
  seed: string,
) => MatchResult;

/**
 * Run a full eight-match tournament path for a draft + scenario.
 *
 * DETERMINISM CONTRACT:
 *  - `seed` is the STRING run seed; persisted on `RunResult.seed`. The
 *    implementation derives per-substream sub-seeds (match_sim / event_gen /
 *    opponent_selection / narrative) via `deriveSubseed` — never instantiates
 *    a fresh RNG.
 *  - Returns a fully-derived `RunResult` including `round_results`,
 *    `aggregate.clean_sheets`, `player_stats`, `score`, `score_breakdown`,
 *    and `narrative.narrative_seed = deriveSubseed(seed, "narrative")`. The
 *    caller does not need to invoke `computeScore` or the narrative reducer
 *    separately for persistence.
 *  - Same (draft, scenario, seed, version anchors) → byte-identical RunResult.
 */
export type RunTournamentFn = (draft: DraftState, scenario: RunScenario, seed: string) => RunResult;

// WS-B IMPLEMENTATIONS. Engine bodies live in `../engine/*` so the api layer
// stays a thin, contract-typed surface. `simulateMatch` is the public
// `UserXiSimView` path (positions inferred from the distilled view).
// `runTournament` orchestrates the full path; its engine impl takes an optional
// resolved `SimWorld` (see the engine contract-gap note) while staying
// assignable to the 3-arg `RunTournamentFn`. Tests that need the event-bearing
// matches use `runTournamentFull` from the engine directly.
import { simulateMatchFromView } from "../engine/match.js";
import { runTournament as runTournamentImpl } from "../engine/tournament.js";
export type { SimWorld } from "../engine/tournament.js";

/** Simulate one match from a distilled user XI view vs a real 2026 opponent. */
export const simulateMatch: SimulateMatchFn = simulateMatchFromView;

/** Run the full seeded tournament path for a draft + scenario. */
export const runTournament: RunTournamentFn = runTournamentImpl;
