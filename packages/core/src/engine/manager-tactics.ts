import type { TeamStrength } from "../types/rating.js";
import type { ManagerTacticalBand } from "../types/sim.js";
import { MANAGER_TACTICAL, clamp, toChannelInt } from "./calibration.js";

export interface ManagerTacticalAdjustment {
  /** Discrete, sim-internal tier derived only from active Synergy.manager_link. */
  manager_tactical_band: ManagerTacticalBand;
  /** Exact multiplier applied uniformly to all four sim channels. */
  manager_tactical_multiplier: number;
  /** Strength actually presented to both sides of the four-channel lambda map. */
  post_tactical_strength: TeamStrength;
  /** False for non-simulated outcomes such as availability forfeits. */
  tactical_applied_to_outcome: boolean;
}

/** Map the bounded manager-link channel to the canonical +0/+1/+2 tier. */
export function managerTacticalBand(managerLink: number): ManagerTacticalBand {
  const normalized = clamp(Number.isFinite(managerLink) ? managerLink : 0, 0, 1);
  return Math.round(normalized * MANAGER_TACTICAL.MAX_BAND) as ManagerTacticalBand;
}

/**
 * Build the complete factual tactical channel. No RNG is consumed. When the
 * match outcome bypasses lambda simulation, every applied field is neutral so
 * the persisted row never claims a mechanical effect that did not occur.
 */
export function applyManagerTacticalAdjustment(
  strength: TeamStrength,
  managerLink: number,
  appliedToOutcome = true,
): ManagerTacticalAdjustment {
  if (!appliedToOutcome) {
    return {
      manager_tactical_band: 0,
      manager_tactical_multiplier: 1,
      post_tactical_strength: { ...strength },
      tactical_applied_to_outcome: false,
    };
  }

  const manager_tactical_band = managerTacticalBand(managerLink);
  const manager_tactical_multiplier =
    1 + MANAGER_TACTICAL.WIDTH * (manager_tactical_band / MANAGER_TACTICAL.MAX_BAND);
  return {
    manager_tactical_band,
    manager_tactical_multiplier,
    post_tactical_strength: {
      attack: toChannelInt(strength.attack * manager_tactical_multiplier),
      midfield: toChannelInt(strength.midfield * manager_tactical_multiplier),
      defense: toChannelInt(strength.defense * manager_tactical_multiplier),
      goalkeeping: toChannelInt(strength.goalkeeping * manager_tactical_multiplier),
      coverage: strength.coverage,
    },
    tactical_applied_to_outcome: true,
  };
}
