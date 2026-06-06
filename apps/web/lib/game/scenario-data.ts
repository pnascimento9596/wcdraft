// Lazy loader + session memo for the 2026 scenario bundle.
//
// Kept separate from `data.ts` so the homepage / draft route doesn't pay the
// scenario-bundle fetch cost — only review/results/share reach for it. Memoed
// once per browser session like the draft pool.

import { loadScenario2026Bundle } from "@wcdraft/data/client";
import type { Scenario2026Bundle } from "@wcdraft/data";

import { RuntimeDataLoadError } from "./errors";

let cachedScenario: Scenario2026Bundle | null = null;
let inFlight: Promise<Scenario2026Bundle> | null = null;

/** Test seam — drop the session memo (no production caller). */
export function clearScenarioBundleCacheForTests(): void {
  cachedScenario = null;
  inFlight = null;
}

/**
 * Build (or return the memoized) `Scenario2026Bundle`. Concurrent callers
 * share a single in-flight fetch. On error the in-flight slot clears so the
 * next attempt fetches fresh.
 */
export async function loadScenarioBundle(): Promise<Scenario2026Bundle> {
  if (cachedScenario) return cachedScenario;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const bundle = await loadScenario2026Bundle();
      cachedScenario = bundle;
      return bundle;
    } catch (err) {
      throw new RuntimeDataLoadError(
        `Failed to load 2026 scenario bundle: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
