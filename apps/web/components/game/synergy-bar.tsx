"use client";

import { useCallback, useEffect, useState } from "react";
import type { SynergyResult } from "@wcdraft/core";
import s from "./game.module.css";

/**
 * Synergy bar — the compact, top-of-formation summary that replaces the
 * old bulky `SynergyPanel` card. Keeps every metric the panel surfaced
 * (overall score, strength multiplier, links live, manager link).
 *
 * COLLAPSIBLE (presentation-only): the head row (label + headline score)
 * is always visible and acts as the toggle; the strength track + figures
 * collapse. Mobile-first paint defaults to COLLAPSED (the pitch is the
 * star of the section); ≥720px defaults to expanded. An explicit user
 * toggle is persisted and wins over both defaults.
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

/** Persisted expand/collapse preference. UI chrome only — never game state. */
const SYNERGY_OPEN_KEY = "wcdraft:ui:synergy-bar-open:v1";

function readStoredOpen(): boolean | null {
  try {
    const raw = window.localStorage.getItem(SYNERGY_OPEN_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* storage unavailable → fall through to defaults */
  }
  return null;
}

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
  // SSR + first client paint render the mobile default (collapsed) so
  // hydration matches; the effect then applies the stored preference or
  // the desktop default. UI-chrome state only.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const stored = readStoredOpen();
    if (stored !== null) {
      setOpen(stored);
      return;
    }
    if (window.matchMedia("(min-width: 720px)").matches) {
      setOpen(true);
    }
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SYNERGY_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* volatile storage — toggle still works for this view */
      }
      return next;
    });
  }, []);

  const linked = result.linked_pairs.filter((p) => p.linked).length;
  const totalEdges = result.linked_pairs.length;
  const showDash = blind || !active || (linked === 0 && result.manager_link === 0);
  // Display formatting only: `overall` can be fractional (the review screen
  // surfaced a raw 9.324675…); the headline renders a rounded integer while
  // the real value still drives the fill width and the sim untouched.
  const overallText = showDash ? "—" : String(Math.round(result.overall));
  const fillPct = showDash ? 0 : result.overall;
  const roundedDelta = !blind && delta != null ? Math.round(delta) : 0;

  return (
    <div
      className={s.synergyBar}
      role="group"
      aria-label={blind ? "Squad synergy summary — hidden until you simulate" : "Squad synergy summary"}
    >
      <button
        type="button"
        className={s.synergyBarToggle}
        onClick={toggle}
        aria-expanded={open}
      >
        <span className={s.synergyBarLabel}>Synergy</span>
        <span className={s.synergyBarScore} aria-live="polite">
          <span className={s.synergyBarNum}>{overallText}</span>
          {/* Display rounding only — fractional deltas rendered raw before
              (e.g. 18.649350649350648); a delta that rounds to 0 hides. */}
          {roundedDelta !== 0 ? (
            <span
              className={roundedDelta > 0 ? s.deltaUp : s.deltaDown}
              aria-label={`Synergy ${roundedDelta > 0 ? "up" : "down"} ${Math.abs(roundedDelta)} points`}
            >
              <span aria-hidden="true">
                {roundedDelta > 0 ? "▲" : "▼"} {Math.abs(roundedDelta)}
              </span>
              <span className="visually-hidden">
                Synergy {roundedDelta > 0 ? "up" : "down"} {Math.abs(roundedDelta)} points
              </span>
            </span>
          ) : null}
          <span className={s.synergyBarChevron} aria-hidden="true">
            {open ? "▴" : "▾"}
          </span>
        </span>
      </button>

      {open ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}
