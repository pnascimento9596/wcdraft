"use client";

import type { SynergyResult } from "@wcdraft/core";
import s from "./game.module.css";

/**
 * Synergy summary — OUR term and OUR formula. Renders the three contract
 * components (nation clusters, adjacency links, manager link) plus the folded
 * display score and bounded multiplier. `delta` shows the live change a pending
 * placement would make on the draft screen.
 */
export function SynergyPanel({
  result,
  delta = null,
  compact = false,
}: {
  result: SynergyResult;
  delta?: number | null;
  compact?: boolean;
}) {
  const linked = result.linked_pairs.filter((p) => p.linked).length;
  return (
    <div className={s.synergy}>
      <div className={s.synergyHead}>
        <span className={s.synergyTitle}>Synergy</span>
        <div className={s.synergyScore}>
          <span className={s.synergyNum}>{result.overall}</span>
          {delta != null && delta !== 0 && (
            <span className={delta > 0 ? s.deltaUp : s.deltaDown}>
              {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
            </span>
          )}
        </div>
      </div>

      <div className={s.synergyBarTrack}>
        <span className={s.synergyBarFill} style={{ width: `${result.overall}%` }} />
      </div>

      <div className={s.synergyMeta}>
        <div className={s.synergyStat}>
          <span className={s.synergyStatNum}>{result.multiplier.toFixed(2)}×</span>
          <span className={s.synergyStatLabel}>strength mult.</span>
        </div>
        <div className={s.synergyStat}>
          <span className={s.synergyStatNum}>
            {linked}/{result.linked_pairs.length}
          </span>
          <span className={s.synergyStatLabel}>links live</span>
        </div>
        <div className={s.synergyStat}>
          <span className={s.synergyStatNum}>{Math.round(result.manager_link * 100)}%</span>
          <span className={s.synergyStatLabel}>manager link</span>
        </div>
      </div>

      {!compact && result.nation_clusters.length > 0 && (
        <div className={s.clusters}>
          <span className={s.clustersLabel}>Nation clusters</span>
          <div className={s.clusterTags}>
            {result.nation_clusters.map((c) => (
              <span key={c.nation_id} className={s.clusterTag}>
                {c.nation_id.toUpperCase()} ×{c.size}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
