// Live API tier detection.
//
// Phases B/C (mentions polling + search) require Basic tier or higher; the
// Free tier allows posting (Phase A) but rejects read/search. We detect the
// tier from a live capability probe rather than configuration, so the features
// gate on what the credentials can ACTUALLY do. A search call that 403s with
// an access-level error ⇒ Free tier.

import type { Tier } from "../config.ts";
import { XApiError, type XClient } from "./client.ts";

export interface TierProbe {
  tier: Tier;
  detail: string;
}

/**
 * Probe by attempting a recent-search. 200 ⇒ Basic+. A 402 (Payment Required —
 * the endpoint needs a paid tier these creds don't have) or 403 (access level /
 * client-not-enrolled) ⇒ Free. Anything else (401/429/network) ⇒ unknown — we
 * fail SAFE: engagement stays gated off until the tier is positively Basic+.
 */
export async function probeTier(client: XClient): Promise<TierProbe> {
  try {
    await client.searchRecent("wcdraft", 10);
    return { tier: "basic_or_higher", detail: "search/recent returned 200 — Basic tier or higher" };
  } catch (err) {
    if (err instanceof XApiError) {
      if (err.status === 402 || err.status === 403) {
        return {
          tier: "free",
          detail: `search/recent ${err.status} — Free tier (read/search needs a paid tier)`,
        };
      }
      return {
        tier: "unknown",
        detail: `search/recent ${err.status} — tier indeterminate; engagement stays gated`,
      };
    }
    return {
      tier: "unknown",
      detail: `probe failed (${err instanceof Error ? err.message : String(err)}) — engagement stays gated`,
    };
  }
}
