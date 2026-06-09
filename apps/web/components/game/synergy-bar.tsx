"use client";

import type { SynergyResult } from "@wcdraft/core";
import s from "./game.module.css";

/**
 * Synergy bar — the compact, top-of-formation summary that replaces the
 * old bulky `SynergyPanel` card. Keeps every metric the panel surfaced
 * (overall score, strength multiplier, links live, manager link), in a
 * single horizontal bar.
 *
 * HONEST-STATE INVARIANTS:
 *  - When the squad has no live link AND no nation cluster (or the
 *    manager isn't drafted yet AND no link is live), the headline
 *    score renders as `—`, not `0`. The numeric `result.overall` is
 *    still emitted for screen readers.
 *  - The `delta` only renders when non-null AND non-zero. The pending
 *    placement preview drives it on the draft screen.
 *  - Inline figures use `monospace` for stable tabular alignment, and
 *    wrap is disabled — never two lines.
 *
 * NOMENCLATURE: "Synergy" — OUR term and OUR formula. Never "chemistry".
 */
export function SynergyBar({
  result,
  delta = null,
  active = true,
  blind = false,
}: {
  result: SynergyResult;
  delta?: number | null;
  /**
   * When the squad is empty / no edge is live AND no manager is drafted,
   * the consumer can pass `active={false}` to render the honest-state
   * "—" headline instead of a numeric `0`. Default `true`: render the
   * raw score from `computeSynergy`.
   */
  active?: boolean;
  /**
   * Memory (hidden) mode — blind every Synergy NUMERIC (score, fill,
   * delta, strength multiplier, links-live count, manager link) until the
   * post-Simulate reveal. DISPLAY-ONLY: `result` is still the real
   * `computeSynergy` output (the sim consumes it untouched); the link
   * LINES on the pitch stay visible — they're structural, derivable from
   * the visible flags. Default `false`: classic render path, untouched.
   */
  blind?: boolean;
}) {
  const linked = result.linked_pairs.filter((p) => p.linked).length;
  const totalEdges = result.linked_pairs.length;
  const showDash = blind || !active || (linked === 0 && result.manager_link === 0);
  const overallText = showDash ? "—" : String(result.overall);
  const fillPct = showDash ? 0 : result.overall;

  return (
    <div
      className={s.synergyBar}
      role="group"
      aria-label={blind ? "Squad synergy summary — hidden until you simulate" : "Squad synergy summary"}
    >
      <div className={s.synergyBarHead}>
        <span className={s.synergyBarLabel}>Synergy</span>
        <span className={s.synergyBarScore} aria-live="polite">
          <span className={s.synergyBarNum}>{overallText}</span>
          {!blind && delta != null && delta !== 0 ? (
            <span className={delta > 0 ? s.deltaUp : s.deltaDown}>
              {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
            </span>
          ) : null}
        </span>
      </div>

      <div className={s.synergyBarTrack} aria-hidden="true">
        <span
          className={s.synergyBarFill}
          style={{ width: `${fillPct}%` }}
        />
      </div>

      <dl className={s.synergyBarFigures} aria-label="Synergy components">
        <div className={s.synergyBarFigure}>
          <dt>strength mult.</dt>
          <dd>{blind ? "—" : `${result.multiplier.toFixed(2)}×`}</dd>
        </div>
        <div className={s.synergyBarFigure}>
          <dt>links live</dt>
          <dd>
            {blind ? (
              "—"
            ) : (
              <>
                {linked}
                <span className={s.synergyBarFigureSub}>/{totalEdges}</span>
              </>
            )}
          </dd>
        </div>
        <div className={s.synergyBarFigure}>
          <dt>manager link</dt>
          <dd>{blind ? "—" : `${Math.round(result.manager_link * 100)}%`}</dd>
        </div>
      </dl>
    </div>
  );
}
