"use client";

import { flagSrcForNationId } from "@/lib/game/flags";
import s from "./game.module.css";

/**
 * Compact nominative national flag for locked squad entities.
 *
 * Licensing / honesty contract: this only resolves bundled `/flags/*.svg`
 * assets by authoritative `nation_id`. If a flag asset is unavailable, it
 * falls back to the runtime nation code text chip rather than guessing.
 */
export function MiniNationFlag({
  nationId,
  nationName,
  nationCode,
  className,
}: {
  nationId: string;
  nationName: string;
  nationCode: string | null;
  className?: string;
}) {
  const flagSrc = flagSrcForNationId(nationId);
  const classes = className ? `${s.miniNationFlag} ${className}` : s.miniNationFlag;

  if (flagSrc) {
    return (
      <img
        src={flagSrc}
        alt={`${nationName} flag`}
        className={classes}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    );
  }

  return (
    <span
      className={className ? `${s.miniNationFlagFallback} ${className}` : s.miniNationFlagFallback}
      aria-label={nationName}
      title={nationName}
    >
      {nationCode ?? "-"}
    </span>
  );
}
