"use client";

import type { ManagerCardView } from "@/lib/game/view-models";
import s from "./game.module.css";

/**
 * The 17th squad slot — the manager — surfaced next to the pitch.
 *
 * HONEST-STATE INVARIANTS:
 * - Manager has `rating_available: false` in runtime data; we OMIT any
 *   numeric rating. We never render a fabricated number. A "Rating
 *   unavailable" tag stands in for the OVR badge.
 * - Three states: committed, preview (draft-time, before lock), open.
 * - Open / preview states are read-only at this site; selection happens in
 *   the candidate list, the manager slot only mirrors it.
 *
 * NOMENCLATURE: this is the MANAGER slot. Synergy (not "chemistry") draws
 * a small link from the slot's nation_id to the XI via `computeSynergy`'s
 * `manager_link` term — surfaced numerically in the SynergyBar, not here.
 */
export function ManagerSlot({
  manager,
  previewManager = null,
}: {
  manager: ManagerCardView | null;
  previewManager?: ManagerCardView | null;
}) {
  const display = manager ?? previewManager;
  const isPreview = !manager && !!previewManager;
  const isCommitted = !!manager;

  const stateClass = isCommitted
    ? s.managerSlotCommitted
    : isPreview
      ? s.managerSlotPreview
      : s.managerSlotOpen;

  return (
    <aside
      className={`${s.managerSlot} ${stateClass}`}
      aria-label={
        isCommitted
          ? "Manager slot — locked"
          : isPreview
            ? "Manager slot — preview"
            : "Manager slot — open"
      }
    >
      <span className={s.managerSlotEyebrow}>Manager</span>
      {display ? (
        <>
          <div className={s.managerSlotIdentity}>
            <span
              className={`${s.managerSlotFlag} ${s.flagShape_diamond}`}
              aria-label={display.nation_name}
              title={display.nation_name}
            >
              {display.nation_code}
            </span>
            <div className={s.managerSlotNameWrap}>
              <span className={s.managerSlotName}>{display.name}</span>
              <span className={s.managerSlotMeta}>
                {display.nation_name} · {display.year}
              </span>
            </div>
          </div>
          <span className={s.managerSlotBadge}>
            {isPreview ? "Preview · rating unavailable" : "Rating unavailable"}
          </span>
        </>
      ) : (
        <p className={s.managerSlotEmpty}>
          Open — pick a manager on any spin to fill this slot.
        </p>
      )}
    </aside>
  );
}
