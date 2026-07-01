import type { LinkedPair } from "@wcdraft/core";

import type { ManagerCardView, PitchSlotView, LineStrengthView } from "../game/view-models";
import type { ConfigBadge } from "../game/config-badges";

export interface LeaderboardLineupResultView {
  readonly score: number;
  readonly score_label: string;
  readonly record: string;
  readonly wins: number;
  readonly losses: number;
  readonly matches_played: number;
  readonly goals_for: number;
  readonly goals_against: number;
  readonly reached_round: string;
  readonly is_champion: boolean;
  readonly shootout_wins: number;
}

export interface LeaderboardLineupFormationView {
  readonly id: string;
  readonly name: string;
}

export interface LeaderboardLineupView {
  readonly team_name: string;
  readonly mode_label: "Classic" | "Memory" | "Open";
  readonly formation: LeaderboardLineupFormationView;
  readonly badges: readonly ConfigBadge[];
  readonly result: LeaderboardLineupResultView;
  readonly starters: readonly PitchSlotView[];
  readonly bench: readonly PitchSlotView[];
  readonly manager: ManagerCardView | null;
  readonly linked_pairs: readonly LinkedPair[];
  readonly line_strengths: readonly LineStrengthView[];
  readonly squad_average: number | null;
}

export type LeaderboardLineupWire =
  | {
      readonly ok: true;
      readonly lineup: LeaderboardLineupView;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly message: string;
    };
