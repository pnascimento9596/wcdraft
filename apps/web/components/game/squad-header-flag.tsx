"use client";

import s from "./game.module.css";

/**
 * Squad-header national flag — a persistent identity element for whose squad
 * is on the table during pick/lock-in (ws-ux/club-coverage).
 *
 * Licensing: national flags are public-domain and permitted; federation
 * crests/badges/kits are NOT — this renders flag SVGs only (the same
 * `/flags/*.svg` assets the spin reel uses).
 *
 * Honest-state: if a nation has no renderable flag asset (`flagSrc === null`,
 * e.g. a defunct state missing from the asset map), fall back to the existing
 * nation-code text chip — never a wrong or approximate flag.
 */
export function SquadHeaderFlag({
  flagSrc,
  nationCode,
  nationName,
}: {
  flagSrc: string | null;
  nationCode: string | null;
  nationName: string;
}) {
  if (flagSrc) {
    return (
      <img
        src={flagSrc}
        alt={`${nationName} flag`}
        className={s.squadHeaderFlag}
        loading="eager"
        decoding="async"
        draggable={false}
      />
    );
  }
  return (
    <span className={s.squadHeaderFlagFallback} aria-label={nationName} title={nationName}>
      {nationCode ?? "—"}
    </span>
  );
}
