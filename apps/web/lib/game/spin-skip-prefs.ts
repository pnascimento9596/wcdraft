/**
 * Presentation-only spin-skip preferences.
 *
 * These flags never enter the run token, config badges, Daily comparable
 * board, or leaderboard canonicality checks. They only affect whether the
 * slot-machine animation is skippable / skipped locally.
 */

export const SPIN_SKIP_READY_STORAGE_KEY = "wcdraft.spin-skip-ready.v1";
export const SPIN_SKIP_HINT_SEEN_STORAGE_KEY = "wcdraft.spin-skip-hint-seen.v1";
export const SKIP_SPIN_ANIMATIONS_STORAGE_KEY = "wcdraft.ui.skip-spin-animations.v1";

/** Unlock skip after the drum has been spinning this long (not after settle). */
export const SPIN_SKIP_UNLOCK_MS = 300;

function storage(): Storage | null {
  try {
    if (typeof globalThis === "undefined") return null;
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    if (!candidate || typeof candidate.getItem !== "function") return null;
    return candidate;
  } catch {
    return null;
  }
}

export function readLocalFlag(key: string): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    return ls.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeLocalFlag(key: string, value: boolean): void {
  const ls = storage();
  if (!ls) return;
  try {
    if (value) ls.setItem(key, "1");
    else ls.removeItem(key);
  } catch {
    // Presentation preference only — storage failure is non-fatal.
  }
}

/**
 * Pure helper: after `elapsedMs` of spinning, is skip unlocked?
 * Taught state OR elapsed past threshold both unlock.
 */
export function isSpinSkipUnlocked(elapsedMs: number, alreadyTaught: boolean): boolean {
  return alreadyTaught || elapsedMs >= SPIN_SKIP_UNLOCK_MS;
}

/** Pure helper: should the first-time dismissible hint be shown? */
export function shouldShowSpinSkipHint(
  skipReady: boolean,
  hintSeen: boolean,
  spinning: boolean,
): boolean {
  return skipReady && !hintSeen && spinning;
}
