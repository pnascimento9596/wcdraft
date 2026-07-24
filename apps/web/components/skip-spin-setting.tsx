"use client";

import { useEffect, useState } from "react";

import {
  readLocalFlag,
  SKIP_SPIN_ANIMATIONS_STORAGE_KEY,
  writeLocalFlag,
} from "@/lib/game/spin-skip-prefs";

/**
 * Presentation-only preference. Never enters the run token, config badges,
 * Daily board, or leaderboard canonicality checks.
 */
export function SkipSpinSetting() {
  const [skip, setSkip] = useState(false);

  useEffect(() => {
    setSkip(readLocalFlag(SKIP_SPIN_ANIMATIONS_STORAGE_KEY));
  }, []);

  return (
    <div className="segmented" role="group" aria-label="Skip spin animations">
      <button
        type="button"
        aria-pressed={!skip}
        onClick={() => {
          setSkip(false);
          writeLocalFlag(SKIP_SPIN_ANIMATIONS_STORAGE_KEY, false);
        }}
      >
        Show spins
      </button>
      <button
        type="button"
        aria-pressed={skip}
        onClick={() => {
          setSkip(true);
          writeLocalFlag(SKIP_SPIN_ANIMATIONS_STORAGE_KEY, true);
        }}
      >
        Skip spin animations
      </button>
    </div>
  );
}
