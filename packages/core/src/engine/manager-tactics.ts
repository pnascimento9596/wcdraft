import type { TeamStrength } from "../types/rating.js";
import type { ManagerLinkBand, ManagerPresenceBand, ManagerTacticalBand } from "../types/sim.js";
import { MANAGER_TACTICAL, clamp } from "./calibration.js";

export interface ManagerTacticalAdjustment {
  manager_present: boolean;
  manager_presence_band: ManagerPresenceBand;
  manager_link_band: ManagerLinkBand;
  /** Additive presence + preserved link tier, bounded to +0..+3. */
  manager_tactical_band: ManagerTacticalBand;
  /** Exact multiplier applied uniformly to all four sim channels. */
  manager_tactical_multiplier: number;
  /** Strength actually presented to both sides of the four-channel lambda map. */
  post_tactical_strength: TeamStrength;
  /** False for non-simulated outcomes such as availability forfeits. */
  tactical_applied_to_outcome: boolean;
}

export function managerLinkBand(managerLink: number): ManagerLinkBand {
  const normalized = clamp(Number.isFinite(managerLink) ? managerLink : 0, 0, 1);
  return Math.round(normalized * 2) as ManagerLinkBand;
}

export function managerTacticalBand(
  managerPresent: boolean,
  managerLink: number,
): ManagerTacticalBand {
  if (!managerPresent) return 0;
  return (1 + managerLinkBand(managerLink)) as ManagerTacticalBand;
}

/**
 * Build the complete factual tactical channel. No RNG is consumed. When the
 * match outcome bypasses lambda simulation, every applied field is neutral so
 * the persisted row never claims a mechanical effect that did not occur.
 */
export function applyManagerTacticalAdjustment(
  strength: TeamStrength,
  managerPresent: boolean,
  managerLink: number,
  appliedToOutcome = true,
): ManagerTacticalAdjustment {
  const manager_presence_band: ManagerPresenceBand = managerPresent ? 1 : 0;
  const manager_link_band = managerPresent ? managerLinkBand(managerLink) : 0;
  const manager_tactical_band = managerTacticalBand(managerPresent, managerLink);
  if (!appliedToOutcome) {
    return {
      manager_present: managerPresent,
      manager_presence_band,
      manager_link_band,
      manager_tactical_band,
      manager_tactical_multiplier: 1,
      post_tactical_strength: { ...strength },
      tactical_applied_to_outcome: false,
    };
  }

  const manager_tactical_multiplier =
    1 + MANAGER_TACTICAL.WIDTH * (manager_tactical_band / MANAGER_TACTICAL.MAX_BAND);
  const project = (value: number): number =>
    Number(clamp(value * manager_tactical_multiplier, 0, 100).toFixed(6));
  return {
    manager_present: managerPresent,
    manager_presence_band,
    manager_link_band,
    manager_tactical_band,
    manager_tactical_multiplier,
    post_tactical_strength: {
      attack: project(strength.attack),
      midfield: project(strength.midfield),
      defense: project(strength.defense),
      goalkeeping: project(strength.goalkeeping),
      coverage: strength.coverage,
    },
    tactical_applied_to_outcome: true,
  };
}
