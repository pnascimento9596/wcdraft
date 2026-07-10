"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  activeSpin,
  computeSynergy,
  FORMATION_TEMPLATES,
  isBlindDraftMode,
  isDraftComplete,
  isOpenDraftMode,
  isRankedDraftMode,
  pickManager,
  pickPlayer,
  positionCompatibility,
  validateSquad,
  type CardId,
  type DraftMode,
  type DraftState,
  type ManagerCardId,
  type Position,
  type SquadSlot,
  type SynergyResult,
  selectDraftTarget,
  DraftTargetDeadEndError,
} from "@wcdraft/core";
import {
  draftCandidateViews,
  managerCardView,
  managerTournamentFor,
  pitchSlotViews,
} from "@/lib/game/adapters";
import { getCatalogForEra, type GameData } from "@/lib/game/data";
import { dailyDateFromSearchParams } from "@/lib/game/daily";
import { DraftTransitionError } from "@/lib/game/errors";
import { draftTargetLabel, lockBarIdleCopy } from "@/lib/game/config-badges";
import { DRAFT_MODE_COPY } from "@/lib/game/mode-labels";
import {
  dailyDraftHref,
  draftHref,
  reviewHref,
  type DailyDraftContext,
} from "@/lib/game/navigation";
import { saveRunRecord, type RunRecordV1 } from "@/lib/game/run-record";
import {
  compatLabel,
  compatTier,
  type ManagerCardView,
  type PlayerCardView,
} from "@/lib/game/view-models";
import { buildSlotRevealModel } from "@/lib/game/slot-reveal";
import { focusFirstWithin, trapTabWithin } from "@/lib/a11y/focus";
import { LockIcon } from "@/components/icons";
import { Pitch } from "../pitch";
import { CandidateCard, ManagerCandidate } from "../candidate-card";
import { SquadHeaderFlag } from "../squad-header-flag";
import { ManagerSlot } from "../manager-slot";
import { MiniNationFlag } from "../mini-nation-flag";
import { SpinStage, skipSpinAnimState, type SpinAnimState } from "../slot-machine";
import { SynergyBar } from "../synergy-bar";
import { GameFallback } from "../game-fallback";
import { DailyUnavailableNotice } from "../daily-unavailable-notice";
import { LocalProgressBandWithVersions, type FriendRunContext } from "../local-progress-band";
import { DraftAppBar } from "./app-bar";
import { TOTAL_SPINS } from "./constants";
import { FormationSelect } from "./setup";
import { useDraftScreenLoader } from "./use-draft-screen-loader";
import s from "../game.module.css";

export { SETUP_RATING_BASES } from "./setup";

// Standalone-spin flow phases. Each of the 17 spins is gated: the user lands on
// the spin stage (`spin`), clicks SPIN, watches the reveal, then crosses into
// the lineup/pick view (`lineup`) to assign + lock. Locking advances the engine
// to the next spin, which resets the phase back to `spin` (the re-spin swap).
type SpinPhase = "spin" | "lineup";

/** Read `prefers-reduced-motion` reactively (client-only). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useCompactDraftLayout(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 430px)");
    const onChange = () => setCompact(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return compact;
}

type Selection =
  | { kind: "player"; card: PlayerCardView }
  | { kind: "manager"; card: ManagerCardView }
  | null;

type OpenRosterFilter = "ALL" | Position;
const OPEN_ROSTER_FILTERS: readonly OpenRosterFilter[] = ["ALL", "GK", "DF", "MF", "FW"];
const SPIN_SKIP_READY_STORAGE_KEY = "wcdraft.spin-skip-ready.v1";

export function DraftScreen({ daily = false }: { daily?: boolean }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestRunId = searchParams?.get("run") ?? null;
  const dailyDate = daily ? dailyDateFromSearchParams(searchParams) : null;
  const friendRun = useMemo(
    () => (daily ? friendRunFromSearchParams(searchParams) : null),
    [daily, searchParams],
  );
  // Mode-select threads `?mode=hidden` for a Memory draft; anything else is
  // classic. Only consulted when CREATING a run — resumed runs carry their
  // mode on the persisted DraftState.
  const modeParam = searchParams?.get("mode");
  const requestedMode: DraftMode =
    modeParam === "hidden"
      ? "hidden"
      : modeParam === "open"
        ? "open"
        : modeParam === "open_hidden" || modeParam === "blind_open"
          ? "open_hidden"
          : "classic";
  const rankedDraft =
    isRankedDraftMode(requestedMode) &&
    !daily &&
    (searchParams?.get("lane") === "ranked" || searchParams?.get("ranked") === "1");

  const { mode, setMode, retryFromError } = useDraftScreenLoader(requestRunId, { dailyDate });

  useEffect(() => {
    if (!dailyDate || requestRunId !== null || mode.kind !== "ready") return;
    router.replace(dailyDraftHref(mode.record.run_id, dailyDate, dailyBeatContext(friendRun)));
  }, [dailyDate, friendRun?.record, friendRun?.score, mode, requestRunId, router]);

  // ── Sub-renderers per mode ───────────────────────────────────────────────
  if (mode.kind === "loading") {
    return <DraftLoadingShell />;
  }

  if (mode.kind === "daily_unavailable") {
    return (
      <div className={s.draftShell}>
        <h1 className="visually-hidden">Daily Draft unavailable</h1>
        <DraftAppBar spinNumber={null} progressPct={0} />
        <DailyUnavailableNotice />
      </div>
    );
  }

  if (mode.kind === "error") {
    return (
      <div className={s.draftShell}>
        <h1 className="visually-hidden">Draft setup unavailable</h1>
        <DraftAppBar spinNumber={null} progressPct={0} />
        <div className={s.errorPanel} role="alert">
          <h2 className={s.errorTitle}>{mode.title}</h2>
          <p className={s.errorMessage}>{mode.message}</p>
          <button type="button" className="btn btn--primary" onClick={retryFromError}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (mode.kind === "recovery") {
    return (
      <div className={s.draftShell}>
        <h1 className="visually-hidden">Draft recovery</h1>
        <DraftAppBar spinNumber={null} progressPct={0} />
        <div className={s.errorPanel} role="alert">
          <h2 className={s.errorTitle}>Couldn&rsquo;t resume that draft</h2>
          <p className={s.errorMessage}>{mode.reason}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() =>
              router.replace(
                dailyDate
                  ? dailyDraftHref(null, dailyDate, dailyBeatContext(friendRun))
                  : draftHref(null),
              )
            }
          >
            Start a new draft
          </button>
        </div>
      </div>
    );
  }

  if (mode.kind === "formation_select") {
    return (
      <FormationSelect
        gameData={mode.gameData}
        draftMode={requestedMode}
        ranked={rankedDraft}
        onLocked={(record, warning) => {
          // Replace URL with new run id; keep history clean.
          router.replace(
            dailyDate
              ? dailyDraftHref(record.run_id, dailyDate, dailyBeatContext(friendRun))
              : draftHref(record.run_id),
          );
          setMode({
            kind: "ready",
            gameData: mode.gameData,
            record,
            persistenceWarning: warning,
          });
        }}
      />
    );
  }

  // mode.kind === "ready"
  return (
    <DraftBoard
      gameData={mode.gameData}
      record={mode.record}
      dailyDate={dailyDate}
      friendRun={friendRun}
      resumedRun={requestRunId !== null}
      persistenceWarning={mode.persistenceWarning}
      onRecordUpdate={(rec, warn) =>
        setMode({
          kind: "ready",
          gameData: mode.gameData,
          record: rec,
          persistenceWarning: warn,
        })
      }
      onReview={() => router.push(reviewHref(mode.record.run_id))}
    />
  );
}

function DraftLoadingShell() {
  return <GameFallback title="Loading draft setup" />;
}

// ─── Draft board (active spin → pick → lock) ─────────────────────────────────

function DraftBoard({
  gameData,
  record,
  dailyDate,
  friendRun,
  resumedRun,
  persistenceWarning,
  onRecordUpdate,
  onReview,
}: {
  gameData: GameData;
  record: RunRecordV1;
  dailyDate: string | null;
  friendRun: FriendRunContext | null;
  resumedRun: boolean;
  persistenceWarning: string | null;
  onRecordUpdate: (rec: RunRecordV1, warning: string | null) => void;
  onReview: () => void;
}) {
  const draft = record.draft;
  const formation = FORMATION_TEMPLATES[draft.formation_id]!;
  const spin = activeSpin(draft);
  const complete = isDraftComplete(draft);
  const validation = useMemo(() => validateSquad(draft), [draft]);
  const fieldable = validation.is_fieldable;
  const spinNumber = spin !== null ? spin.index + 1 : TOTAL_SPINS;
  const picked = draft.spins.filter((sp) => sp.status === "picked").length;
  const progressPct = Math.round((picked / TOTAL_SPINS) * 100);
  const dailyRun = dailyDate !== null;
  const dailyPickSpace = dailyRun ? "Classic rules" : DRAFT_MODE_COPY[draft.mode].pickSpace;

  // Blind modes hide every rating SIGNAL (OVRs, channels, legend
  // gold, provenance hue, Synergy numerics) on the draft surface. DISPLAY-
  // ONLY: the engine state, pick/lock flow, and the sim inputs are the real
  // values; identities, shapes, flags, the spin and synergy LINK LINES stay.
  const blind = isBlindDraftMode(draft.mode);
  const blindModeLabel = DRAFT_MODE_COPY[draft.mode].label;
  const openPickSpace = isOpenDraftMode(draft.mode);
  // Rating-basis seam: every card view + the sim resolve from this basis. The
  // CURRENT chip rides `draft.rating_basis` (config, not a rating), so it shows
  // even under Memory mode while the numerics stay masked.
  const basis = draft.rating_basis;

  // DC-3 position-first derivations. `awaitingTarget` gates the target-select
  // stage (the spin's draw is NOT materialized yet); `lockedTarget` pins the
  // assignment once the squad rolled (the lock action fills only the target).
  const positionFirst = draft.draft_flow === "position_first";
  const awaitingTarget = positionFirst && spin?.status === "awaiting_slot";
  const lockedTarget = positionFirst && spin?.status === "pending" ? spin.target_slot_id : null;
  const lockedTargetLabel = lockedTarget ? draftTargetLabel(draft, lockedTarget) : null;

  // Adapter views.
  const { starters, bench } = useMemo(
    () => pitchSlotViews(gameData.indexes, draft, { blindRatings: blind, basis }),
    [gameData, draft, blind, basis],
  );
  const candidates = useMemo(
    () => draftCandidateViews(gameData.indexes, draft, spin, { blindRatings: blind, basis }),
    [gameData, draft, spin, blind, basis],
  );
  // Open vacant slots (engine truth).
  const openSlots = useMemo(() => draft.squad.filter((sl) => sl.card_id === null), [draft.squad]);
  const managerOnlyOpen =
    !complete && !!spin && draft.manager_card_id === null && openSlots.length === 0;

  // Selection / UI state.
  const [sel, setSel] = useState<Selection>(null);
  const [selSlot, setSelSlot] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [openRosterFilter, setOpenRosterFilter] = useState<OpenRosterFilter>("ALL");
  const [openRosterManagersOpen, setOpenRosterManagersOpen] = useState(false);

  // Standalone-spin flow state. `phase` gates the spin stage vs the lineup
  // view; `anim` drives the drum lifecycle on the spin stage.
  const [phase, setPhase] = useState<SpinPhase>("spin");
  const [anim, setAnim] = useState<SpinAnimState>("idle");
  const [spinSkipReady, setSpinSkipReady] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const compactDraftLayout = useCompactDraftLayout();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSpinSkipReady(window.sessionStorage.getItem(SPIN_SKIP_READY_STORAGE_KEY) === "1");
  }, []);

  // Refs used to drive deterministic scroll alignment on two key
  // transitions:
  //  - assign-flow: picking a candidate scrolls the formation panel into
  //    view so the slot picker is on screen (no manual scroll up).
  //  - post-lock: locking advances the engine + flips phase to "spin", so
  //    we scroll the window to the spin-stage origin to put the flags
  //    card at the top of the viewport (no mid-page landing).
  const formationPanelRef = useRef<HTMLElement | null>(null);
  const candidatePanelRef = useRef<HTMLElement | null>(null);
  const lineupHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const revealFocusTargetRef = useRef<"candidates" | "formation" | null>(null);
  const slotPickerButtonRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheetCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const sheetRestoreFocusRef = useRef<HTMLElement | null>(null);
  const lastSelectedPlayerRef = useRef<string | null>(null);
  // Set by handleLock to signal the post-lock spin-stage scroll on next
  // render. Tracked in a ref (not state) so it doesn't cause an extra
  // render before the layout effect fires.
  const justLockedRef = useRef(false);

  // Reset selection + spin flow whenever the active spin changes (incl. the
  // post-lock advance — this IS the re-spin swap back to the idle drum).
  useEffect(() => {
    setSel(null);
    setSelSlot(null);
    setSheetOpen(false);
    setTransitionError(null);
    setOpenRosterFilter("ALL");
    setOpenRosterManagersOpen(false);
    setPhase("spin");
    setAnim("idle");
    lastSelectedPlayerRef.current = null;
    revealFocusTargetRef.current = null;
    sheetRestoreFocusRef.current = null;
  }, [spin?.index]);

  // Post-lock scroll alignment. handleLock sets `justLockedRef` AND
  // `phase = "spin"` together; the spin-stage early-return swaps the
  // whole DraftBoard tree on next render. We then scroll the window
  // back to the origin so the spin-stage flags / drum land at the top
  // of the viewport instead of wherever the user clicked the lockBar.
  useEffect(() => {
    if (!justLockedRef.current) return;
    if (phase !== "spin") return;
    justLockedRef.current = false;
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }, [phase, spin?.index, reducedMotion]);

  // Assign-flow scroll. Selecting a player NAME from the candidate list
  // should put the formation/slot picker on screen so the user assigns
  // the slot without manual scroll-up. Triggered on a player selection
  // ID change (manager selection has no slot to assign, so it does not
  // scroll). Skipped when the formation panel is already in view.
  useEffect(() => {
    const id = sel?.kind === "player" ? sel.card.card_id : null;
    if (!id) {
      lastSelectedPlayerRef.current = null;
      return;
    }
    if (id === lastSelectedPlayerRef.current) return;
    lastSelectedPlayerRef.current = id;
    const el = formationPanelRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    // Already at or above the viewport top (with a small slack) → no scroll.
    if (rect.top >= 0 && rect.top <= 80) return;
    el.scrollIntoView({
      block: "start",
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [sel, reducedMotion]);

  useEffect(() => {
    if (phase !== "lineup") return;
    const target = revealFocusTargetRef.current;
    if (target === null) return;
    revealFocusTargetRef.current = null;
    if (target === "candidates") {
      if (managerOnlyOpen) return;
      focusFirstWithin(candidatePanelRef.current, candidatePanelRef.current);
      return;
    }
    lineupHeadingRef.current?.focus({ preventScroll: true });
  }, [phase, managerOnlyOpen]);

  useEffect(() => {
    if (!sheetOpen || sel?.kind !== "player") return undefined;
    const frame = requestAnimationFrame(() => {
      const activeSlot = sheetRef.current?.querySelector<HTMLElement>("[data-active='true']");
      if (activeSlot) {
        activeSlot.focus();
        return;
      }
      focusFirstWithin(sheetRef.current, sheetCloseButtonRef.current);
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSheetOpen(false);
        return;
      }
      trapTabWithin(event, sheetRef.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      const restoreTarget = sheetRestoreFocusRef.current;
      sheetRestoreFocusRef.current = null;
      if (!restoreTarget) return;
      requestAnimationFrame(() => {
        if (document.contains(restoreTarget)) restoreTarget.focus();
      });
    };
  }, [sheetOpen, sel?.kind]);

  // SPIN clicked: reduced-motion skips the 2–3s reveal straight to settled;
  // otherwise the drum animates and `onSettle` (animationend) flips to settled.
  const handleSpin = useCallback(() => {
    setAnim(reducedMotion ? "settled" : "spinning");
  }, [reducedMotion]);
  const markSpinSkipReady = useCallback(() => {
    setSpinSkipReady(true);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(SPIN_SKIP_READY_STORAGE_KEY, "1");
    }
  }, []);
  const handleSettle = useCallback(() => {
    setAnim("settled");
    markSpinSkipReady();
  }, [markSpinSkipReady]);
  const handleSkip = useCallback(() => {
    setAnim((current) => skipSpinAnimState(current, spinSkipReady));
  }, [spinSkipReady]);
  const handleReveal = useCallback(() => {
    revealFocusTargetRef.current = compactDraftLayout ? "candidates" : "formation";
    setPhase("lineup");
  }, [compactDraftLayout]);

  // DC-3 — commit a position-first target, roll the squad, persist. A
  // DraftTargetDeadEndError leaves the spin UNCONSUMED: we surface the
  // blocking honest notice and the user picks a different target.
  const [targetDeadEnd, setTargetDeadEnd] = useState<string | null>(null);
  const handleSelectTarget = useCallback(
    (target: string) => {
      if (committing) return;
      setCommitting(true);
      setTargetDeadEnd(null);
      setTransitionError(null);
      try {
        const catalog = getCatalogForEra(gameData, draft.era_preset ?? "all_time");
        const nextDraft = selectDraftTarget(catalog, draft, target);
        const updated: RunRecordV1 = {
          ...record,
          updated_seq: record.updated_seq + 1,
          draft: nextDraft,
        };
        const save = saveRunRecord(updated);
        const warning =
          save.persistence === "volatile" || save.warnings.length > 0
            ? save.warnings.join(" · ") ||
              "Draft is saved in this tab only — browser storage is unavailable."
            : null;
        setPhase("spin");
        setAnim("idle");
        onRecordUpdate(updated, warning ?? persistenceWarning);
      } catch (err) {
        if (err instanceof DraftTargetDeadEndError) {
          setTargetDeadEnd(err.message);
        } else {
          setTransitionError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setCommitting(false);
      }
    },
    [committing, gameData, draft, record, onRecordUpdate, persistenceWarning],
  );

  const bestSlotFor = useCallback(
    (card: PlayerCardView): string | null => {
      const starterOpens = openSlots.filter((sl) => sl.is_starter);
      const pool = starterOpens.length > 0 ? starterOpens : openSlots;
      let best: { id: string; c: number } | null = null;
      for (const slot of pool) {
        const c = positionCompatibility(card.eligible_positions, slot.slot_position);
        if (!best || c > best.c) best = { id: slot.slot_id, c };
      }
      return best?.id ?? null;
    },
    [openSlots],
  );

  const selectPlayer = useCallback(
    (card: PlayerCardView) => {
      if (managerOnlyOpen) return;
      setSel({ kind: "player", card });
      // Position-first: the slot was committed before the reveal — the pick
      // can only fill the locked target.
      setSelSlot(lockedTarget ?? bestSlotFor(card));
      setTransitionError(null);
    },
    [bestSlotFor, lockedTarget, managerOnlyOpen],
  );

  const selectManager = useCallback((card: ManagerCardView) => {
    setSel({ kind: "manager", card });
    setSelSlot(null);
    setTransitionError(null);
  }, []);

  useEffect(() => {
    if (!managerOnlyOpen) return;
    setSelSlot(null);
    if (openPickSpace && candidates.managers.length > 0) {
      setOpenRosterManagersOpen(true);
    }
  }, [managerOnlyOpen, openPickSpace, candidates.managers.length]);

  const openSlotSheet = useCallback(() => {
    sheetRestoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : slotPickerButtonRef.current;
    setSheetOpen(true);
  }, []);

  const closeSlotSheet = useCallback(() => {
    setSheetOpen(false);
  }, []);

  // Preview compatibility per open slot, given the selected player.
  const previewCompat = useMemo(() => {
    if (sel?.kind !== "player") return null;
    const map: Record<string, number> = {};
    for (const slot of openSlots) {
      map[slot.slot_id] = positionCompatibility(sel.card.eligible_positions, slot.slot_position);
    }
    return map;
  }, [sel, openSlots]);

  // Synergy: base + preview.
  const currentManagerTournament = useMemo(
    () =>
      draft.manager_card_id ? managerTournamentFor(gameData.indexes, draft.manager_card_id) : null,
    [gameData, draft.manager_card_id],
  );

  const baseSynergy: SynergyResult = useMemo(
    () => computeSynergy(draft.squad, formation, currentManagerTournament, gameData.nationByCardId),
    [draft.squad, formation, currentManagerTournament, gameData.nationByCardId],
  );

  const previewSynergy: SynergyResult = useMemo(() => {
    if (sel?.kind === "manager") {
      const mt = managerTournamentFor(gameData.indexes, sel.card.manager_card_id);
      return computeSynergy(draft.squad, formation, mt, gameData.nationByCardId);
    }
    if (sel?.kind === "player" && selSlot) {
      const hyp = hypotheticalSquad(draft.squad, sel.card, selSlot);
      return computeSynergy(hyp, formation, currentManagerTournament, gameData.nationByCardId);
    }
    return baseSynergy;
  }, [sel, selSlot, draft.squad, formation, currentManagerTournament, gameData, baseSynergy]);

  const synergyDelta = previewSynergy.overall - baseSynergy.overall;

  // Slot-machine reveal model — PRESENTATION ONLY. The center reel ALWAYS
  // lands on the engine-decided `(spin.nation_id, spin.tournament_id)`. No
  // randomness here; the neighbor reel faces are derived from the ordered
  // spin ring. Animation lives in CSS.
  const slotReveal = useMemo(() => {
    // awaiting_slot placeholders carry no draw — nothing to reveal yet.
    if (!spin || spin.status === "awaiting_slot") return null;
    return buildSlotRevealModel({
      activeSpin: spin,
      allSpins: draft.spins,
      indexes: gameData.indexes,
      totalPicks: TOTAL_SPINS,
      eraPreset: draft.era_preset,
    });
  }, [spin, draft.spins, draft.era_preset, gameData.indexes]);

  // Hidden mode blinds the spin-stage Synergy numerics too — the props are
  // already nullable, and null renders the honest "—".
  const revealSynergyOverall =
    !blind && Number.isFinite(baseSynergy.overall) ? baseSynergy.overall : null;
  const revealSynergyMultiplier =
    !blind && Number.isFinite(baseSynergy.multiplier) ? baseSynergy.multiplier : null;

  const spinResultLabel =
    slotReveal !== null ? `${slotReveal.result.nationName} ${slotReveal.result.yearLabel}` : null;

  // Lock pick → call core engine → save record.
  const handleLock = useCallback(() => {
    if (!sel || committing) return;
    setCommitting(true);
    setTransitionError(null);
    try {
      let nextDraft: DraftState;
      // DC-2: picks must run against the SAME era-bounded catalog the draft
      // was created from — pending-spin rebuilds redraw from this pool.
      const catalog = getCatalogForEra(gameData, draft.era_preset ?? "all_time");
      if (sel.kind === "player") {
        if (!selSlot) {
          setCommitting(false);
          setTransitionError("Pick a slot for this player.");
          return;
        }
        nextDraft = pickPlayer(catalog, draft, sel.card.card_id as CardId, selSlot);
      } else {
        nextDraft = pickManager(catalog, draft, sel.card.manager_card_id as ManagerCardId);
      }
      const updated: RunRecordV1 = {
        ...record,
        updated_seq: record.updated_seq + 1,
        draft: nextDraft,
      };
      const save = saveRunRecord(updated);
      const warning =
        save.persistence === "volatile" || save.warnings.length > 0
          ? save.warnings.join(" · ") ||
            "Draft is saved in this tab only — browser storage is unavailable."
          : null;
      // Re-spin swap: snap back to the idle drum for the next spin in the same
      // commit as the record update, so the lineup for the next spin never
      // flashes before the spin-stage reset effect runs. Flag the post-lock
      // scroll so the `phase === "spin"` re-render lands the flags/drum at
      // the top of the viewport (handled in the scroll effect above).
      justLockedRef.current = true;
      setPhase("spin");
      setAnim("idle");
      onRecordUpdate(updated, warning ?? persistenceWarning);
    } catch (err) {
      const wrapped =
        err instanceof DraftTransitionError
          ? err
          : new DraftTransitionError(err instanceof Error ? err.message : String(err), err);
      setTransitionError(wrapped.message);
    } finally {
      setCommitting(false);
      setSheetOpen(false);
    }
  }, [sel, selSlot, committing, gameData, draft, record, onRecordUpdate, persistenceWarning]);

  const selectedSlot =
    sel?.kind === "player" && selSlot
      ? (draft.squad.find((sl) => sl.slot_id === selSlot) ?? null)
      : null;
  const selectedCompat =
    selectedSlot && sel?.kind === "player"
      ? positionCompatibility(sel.card.eligible_positions, selectedSlot.slot_position)
      : null;

  const canLock = sel?.kind === "manager" || (sel?.kind === "player" && !!selSlot);
  const visiblePlayers = useMemo(() => {
    if (!openPickSpace) return candidates.players;
    return openRosterFilter === "ALL"
      ? candidates.players
      : candidates.players.filter((card) => card.eligible_positions.includes(openRosterFilter));
  }, [candidates.players, openPickSpace, openRosterFilter]);
  const openRosterManagerGroup = openPickSpace && candidates.managers.length > 0;
  const showManagerCandidates = !openRosterManagerGroup || openRosterManagersOpen;

  // I3.7 fix-pass #2 (PR #18 BLOCKER): the Review CTA gates the entrance to
  // Simulate/Share. It MUST require the draft to be COMPLETE (all 17 spins
  // consumed — `isDraftComplete`), NOT merely fieldable (11 starters).
  // Fieldable is reachable at Spin 12/17 with no bench and no manager, and
  // the share token requires the full 17 picks to encode; reviewing /
  // simulating a `drafting`-status squad violates the share/replay contract.
  // Fieldability remains a layered validity check (see no-GK warning below).
  const showReviewCta = !sel && complete;

  // ── DC-3 — position-first target stage (before any squad is rolled) ─────
  if (!complete && spin && awaitingTarget) {
    const vacantStarters = draft.squad.filter((sl) => sl.is_starter && sl.card_id === null);
    const vacantBench = draft.squad.filter((sl) => !sl.is_starter && sl.card_id === null);
    const managerOpen = draft.manager_card_id === null;
    const unresolvedAfter = draft.spins.filter(
      (sp) => sp.status !== "picked" && sp.index > spin.index,
    ).length;
    const managerForced = managerOpen && unresolvedAfter === 0;
    return (
      <div className={`${s.draftShell} ${s.draftShellAnchored}`} data-draft-anchored>
        <h1 className="visually-hidden">Choose your draft target</h1>
        <DraftAppBar
          spinNumber={spinNumber}
          progressPct={progressPct}
          mode={draft.mode}
          daily={dailyRun}
          ranked={record.ranked_attempt !== undefined}
          pickSpace={dailyPickSpace}
          warning={persistenceWarning}
        />
        <div className={s.draftScroll}>
          <section className={s.panel} aria-label="Choose your target">
            <span className={s.eyebrowAccent}>
              Pick {spinNumber} / {TOTAL_SPINS}
            </span>
            <h2 className={s.panelTitle}>Choose the slot to fill</h2>
            <p className={s.completeNote}>
              Position First — commit a target before the squad is revealed. The spin fills only
              this target; the choice is locked once the squad rolls.
            </p>
            {targetDeadEnd ? (
              <p className={s.formationError} role="alert">
                {managerForced
                  ? "The revealed squad has no manager, and this final manager target is unrecoverable. Start a new draft."
                  : "No candidate for that target in this configured pool — the spin was not used. Pick a different target."}
              </p>
            ) : null}
            {transitionError ? (
              <p className={s.formationError} role="alert">
                {transitionError}
              </p>
            ) : null}
            {managerForced ? (
              <p className={s.memoryModeNote} role="note">
                Final spin with no manager drafted — the manager is the only legal target.
              </p>
            ) : null}
            {managerOpen ? (
              <div className={s.targetGroup}>
                <h3 className={s.targetGroupTitle}>Staff</h3>
                <div className={s.targetGrid}>
                  <button
                    type="button"
                    className={s.targetChip}
                    disabled={committing}
                    onClick={() => handleSelectTarget("manager")}
                  >
                    <span className={s.targetChipPos}>MGR</span>
                    <span className={s.targetChipId}>Manager</span>
                  </button>
                </div>
              </div>
            ) : null}
            {!managerForced && vacantStarters.length > 0 ? (
              <div className={s.targetGroup}>
                <h3 className={s.targetGroupTitle}>Starting XI</h3>
                <div className={s.targetGrid}>
                  {vacantStarters.map((sl) => (
                    <button
                      key={sl.slot_id}
                      type="button"
                      className={s.targetChip}
                      disabled={committing}
                      onClick={() => handleSelectTarget(sl.slot_id)}
                    >
                      <span className={s.targetChipPos}>{sl.slot_position}</span>
                      <span className={s.targetChipId}>
                        {sl.is_starter ? "Starting XI" : "Bench"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {!managerForced && vacantBench.length > 0 ? (
              <div className={s.targetGroup}>
                <h3 className={s.targetGroupTitle}>Bench</h3>
                <div className={s.targetGrid}>
                  {vacantBench.map((sl) => (
                    <button
                      key={sl.slot_id}
                      type="button"
                      className={s.targetChip}
                      disabled={committing}
                      onClick={() => handleSelectTarget(sl.slot_id)}
                    >
                      <span className={s.targetChipPos}>{sl.slot_position}</span>
                      <span className={s.targetChipId}>Bench</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  // ── Standalone spin stage — the centerpiece, gated per spin ────────────
  // Each of the 17 spins lands here first (idle drum, CTA "Spin"). Only after
  // the reveal settles and the user taps "Reveal choices →" do we cross into the
  // lineup/pick view below. This supersedes the inline reveal from PR #21.
  if (!complete && spin && slotReveal && phase === "spin") {
    return (
      <div className={`${s.draftShell} ${s.spinShell}`} data-draft-desktop-shell>
        <h1 className="visually-hidden">Spin for your next draft pick</h1>
        {persistenceWarning ? (
          <p className={`${s.persistenceWarn} ${s.spinPersistenceWarn}`} role="status">
            {persistenceWarning}
          </p>
        ) : null}
        {dailyDate ? (
          <LocalProgressBandWithVersions
            versions={gameData.versions}
            targetDate={dailyDate}
            compact
            friendRun={friendRun}
          />
        ) : null}
        {resumedRun && picked > 0 ? (
          <p className={s.spinResumeNote} role="status">
            Same draw — spins are seed-locked.
          </p>
        ) : null}
        <SpinStage
          model={slotReveal}
          pickNumber={spinNumber}
          totalPicks={TOTAL_SPINS}
          formationId={draft.formation_id}
          modeLabel={dailyRun ? "Daily" : DRAFT_MODE_COPY[draft.mode].shortLabel}
          modeCue={
            dailyRun
              ? "today's shared draft"
              : record.ranked_attempt
                ? "Ranked"
                : DRAFT_MODE_COPY[draft.mode].cue
          }
          pickSpace={dailyPickSpace}
          synergyOverall={revealSynergyOverall}
          synergyMultiplier={revealSynergyMultiplier}
          playerPoolCount={candidates.players.length}
          anim={anim}
          onSpin={handleSpin}
          onSettle={handleSettle}
          onSkip={handleSkip}
          onReveal={handleReveal}
          canSkip={spinSkipReady}
          showSkipHint={spinSkipReady}
        />
      </div>
    );
  }

  const spinContextSection = complete ? (
    <section className={`${s.panel} ${s.completePanel}`}>
      <span className={s.eyebrowAccent}>Draft complete</span>
      <h1 className={s.panelTitle}>All 17 spins resolved.</h1>
      <p className={s.completeNote}>
        Lock-on-pick — nothing else can be rearranged. Step into review for line ratings, Synergy,
        and your final XI.
      </p>
    </section>
  ) : spinResultLabel && slotReveal ? (
    <section className={s.nowDrafting} aria-label="Current spin">
      <SquadHeaderFlag
        flagSrc={slotReveal.result.flagSrc}
        nationCode={slotReveal.result.nationCode}
        nationName={slotReveal.result.nationName}
      />
      <div className={s.nowDraftingMain}>
        <span className={s.nowDraftingPick}>
          Pick {spinNumber} / {TOTAL_SPINS}
        </span>
        <span className={s.nowDraftingResult}>{spinResultLabel}</span>
      </div>
      <button type="button" className={s.nowDraftingBack} onClick={() => setPhase("spin")}>
        ↺ Spin view
      </button>
    </section>
  ) : null;

  const formationSection = (
    <section
      ref={formationPanelRef}
      className={`${s.panel} ${s.formationPanel}`}
      aria-label="Your formation"
    >
      <SynergyBar
        result={previewSynergy}
        delta={sel && !blind ? synergyDelta : null}
        active={starters.some((sl) => sl.card) || draft.manager_card_id !== null}
        blind={blind}
      />
      {blind ? (
        <p className={s.memoryModeNote} role="note">
          {blindModeLabel} — hidden values reveal after you simulate.
        </p>
      ) : null}
      <div className={s.panelHead}>
        <h2
          ref={lineupHeadingRef}
          tabIndex={-1}
          className={`${s.panelTitle} ${s.formationTitleInline}`}
        >
          {formation.name}
        </h2>
        {basis === "current" ? (
          <span
            className={s.basisChip}
            title="This run rates every card on its at-tournament (Current) strength."
          >
            Current
          </span>
        ) : null}
        <span className={`${s.panelMeta} ${s.squadCounter}`}>
          <span className={s.squadCounterCell}>
            <b>{starters.filter((sl) => sl.card).length}/11</b> XI
          </span>
          <span className={s.squadCounterSep} aria-hidden="true">
            ·
          </span>
          <span className={s.squadCounterCell}>
            <b>{bench.filter((sl) => sl.card).length}/5</b> Bench
          </span>
          <span className={s.squadCounterSep} aria-hidden="true">
            ·
          </span>
          <span className={s.squadCounterCell}>
            <b>{draft.manager_card_id ? "1" : "0"}/1</b> Mgr
          </span>
        </span>
      </div>

      <div className={s.squadStage}>
        <Pitch
          formationId={draft.formation_id}
          starters={starters}
          interactive={!complete}
          selectedSlotId={selSlot}
          previewCompat={previewCompat}
          linkedPairs={previewSynergy.linked_pairs}
          onSlotSelect={(id) => {
            if (sel?.kind !== "player") return;
            const slot = draft.squad.find((sl) => sl.slot_id === id);
            if (!slot || slot.card_id !== null) return;
            setSelSlot(id);
          }}
        />
        <ManagerSlot
          manager={
            draft.manager_card_id ? managerCardView(gameData.indexes, draft.manager_card_id) : null
          }
          previewManager={sel?.kind === "manager" ? sel.card : null}
        />
      </div>

      <div className={s.bench}>
        <span className={s.benchLabel}>Bench</span>
        <div className={s.benchSlots}>
          {bench.map((b) => {
            const isSel = b.slot_id === selSlot;
            const pc = previewCompat?.[b.slot_id];
            const classes = [s.benchSlot];
            if (b.card) classes.push(s.benchFilled, s.slotLocked);
            if (isSel) classes.push(s.slotSelected);
            return (
              <button
                key={b.slot_id}
                type="button"
                className={classes.join(" ")}
                disabled={!!b.card || sel?.kind !== "player"}
                onClick={() => setSelSlot(b.slot_id)}
                aria-pressed={isSel}
              >
                <span className={s.benchSlotTop}>
                  <span className={s.slotPos}>{b.slot_position}</span>
                  {b.card ? (
                    <MiniNationFlag
                      nationId={b.card.nation_id}
                      nationName={b.card.nation_name}
                      nationCode={b.card.nation_code}
                      className={s.benchMiniFlag}
                    />
                  ) : null}
                </span>
                <span className={s.slotName}>
                  {b.card ? b.card.name : pc != null ? `FIT ${Math.round(pc * 100)}%` : "—"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );

  const goalkeeperWarningSection =
    !validation.has_goalkeeper && fieldable ? (
      <section className={`${s.panel} ${s.gkWarnPanel}`}>
        <p className={s.gkWarn} role="status">
          <span className={s.gkWarnGlyph} aria-hidden="true">
            !
          </span>
          No specialist goalkeeper placed yet — the sim will apply an outfielder-in-goal penalty.
        </p>
      </section>
    ) : null;

  const candidateSection =
    !complete && spin ? (
      <section
        id="draft-candidates"
        ref={candidatePanelRef}
        className={`${s.panel} ${s.candidatePanel}`}
        aria-label="Candidates"
      >
        {openPickSpace ? (
          <div className={s.openRosterTools}>
            <div
              className={s.openRosterSeg}
              role="group"
              aria-label={`Filter ${DRAFT_MODE_COPY[draft.mode].label} roster`}
            >
              {OPEN_ROSTER_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`${s.openRosterBtn} ${
                    openRosterFilter === filter ? s.openRosterBtnActive : ""
                  }`}
                  aria-pressed={openRosterFilter === filter}
                  onClick={() => setOpenRosterFilter(filter)}
                >
                  {filter === "ALL" ? "All" : filter}
                </button>
              ))}
            </div>
            <span className={s.openRosterMeta}>
              {visiblePlayers.length}/{candidates.players.length}
              {blind ? "" : " · OVR sort"}
            </span>
          </div>
        ) : null}
        {openRosterManagerGroup ? (
          <div className={s.openRosterManagerGroup}>
            <button
              type="button"
              className={s.openRosterManagerToggle}
              aria-expanded={openRosterManagersOpen}
              aria-controls="open-roster-managers"
              onClick={() => setOpenRosterManagersOpen((open) => !open)}
            >
              <span className={s.openRosterManagerTitle}>
                Managers ({candidates.managers.length})
              </span>
              <span className={s.openRosterManagerMeta}>Expandable group · manager slot</span>
              <span className={s.openRosterManagerChevron} aria-hidden="true">
                {openRosterManagersOpen ? "▴" : "▾"}
              </span>
            </button>
            {showManagerCandidates ? (
              <div id="open-roster-managers" className={s.openRosterManagerList}>
                {candidates.managers.map((manager, index) => (
                  <ManagerCandidate
                    key={manager.manager_card_id}
                    manager={manager}
                    selected={
                      sel?.kind === "manager" &&
                      sel.card.manager_card_id === manager.manager_card_id
                    }
                    disabled={draft.manager_card_id !== null}
                    rarePick={spin?.rare === true}
                    autoFocus={managerOnlyOpen && index === 0}
                    onSelect={selectManager}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          candidates.managers.map((manager, index) => (
            <ManagerCandidate
              key={manager.manager_card_id}
              manager={manager}
              selected={
                sel?.kind === "manager" && sel.card.manager_card_id === manager.manager_card_id
              }
              disabled={draft.manager_card_id !== null}
              rarePick={spin?.rare === true}
              autoFocus={managerOnlyOpen && index === 0}
              onSelect={selectManager}
            />
          ))
        )}
        {managerOnlyOpen ? (
          <p className={s.emptyList} role="status">
            All player slots filled — pick the manager.
          </p>
        ) : null}

        <div className={s.candList}>
          {visiblePlayers.map((card) => (
            <CandidateCard
              key={card.card_id}
              card={card}
              selected={sel?.kind === "player" && sel.card.card_id === card.card_id}
              disabled={managerOnlyOpen}
              blindRatings={blind}
              rarePick={spin?.rare === true}
              onSelect={selectPlayer}
            />
          ))}
          {visiblePlayers.length === 0 ? (
            <p className={s.emptyList}>
              {openPickSpace ? "No players match this filter." : "No player choices on this spin."}
            </p>
          ) : null}
        </div>
      </section>
    ) : null;

  return (
    /* ws-ux/tap-stability-2: the main draft layout is an ANCHORED shell — the
       document never scrolls (scrolling lives in .draftScroll), so iOS Safari's
       toolbar never collapses mid-session and the lock bar — a normal-flow
       bottom row of this 100svh shell, not a viewport-fixed element — cannot
       move under the user's finger. */
    <div className={`${s.draftShell} ${s.draftShellAnchored}`} data-draft-anchored>
      {!complete ? <h1 className="visually-hidden">Pick your draft candidate</h1> : null}
      <DraftAppBar
        spinNumber={spinNumber}
        progressPct={progressPct}
        mode={draft.mode}
        daily={dailyRun}
        ranked={record.ranked_attempt !== undefined}
        pickSpace={dailyPickSpace}
        warning={persistenceWarning}
      />

      <div className={s.draftScroll}>
        {dailyDate ? (
          <LocalProgressBandWithVersions
            versions={gameData.versions}
            targetDate={dailyDate}
            compact
            friendRun={friendRun}
          />
        ) : null}
        {spinContextSection}
        {compactDraftLayout ? (
          <>
            {candidateSection}
            {formationSection}
            {goalkeeperWarningSection}
          </>
        ) : (
          <>
            {formationSection}
            {goalkeeperWarningSection}
            {candidateSection}
          </>
        )}

        <p className={s.draftAttribution}>
          <Link href="/attribution">Data: Fjelstul (CC-BY-SA 4.0) · Wikipedia (CC-BY-SA)</Link>
        </p>
      </div>

      {/* In-shell bottom CTA bar (normal flow — see .lockBar) */}
      <div className={s.lockBar} role="region" aria-label="Pick controls">
        <div className={s.lockInfo}>
          {transitionError ? (
            <span className={s.lockError}>{transitionError}</span>
          ) : sel?.kind === "player" && selectedSlot && selectedCompat != null ? (
            <span>
              <b>{sel.card.name}</b> → <b>{selectedSlot.slot_position}</b>
              <span className={`${s.compatPill} ${s[`tier_${compatTier(selectedCompat)}`]!}`}>
                {compatLabel(selectedCompat)} · FIT {Math.round(selectedCompat * 100)}%
              </span>
            </span>
          ) : sel?.kind === "manager" ? (
            <span>
              <b>{sel.card.name}</b> → manager slot
            </span>
          ) : showReviewCta ? (
            <span className={s.lockHint}>
              {lockBarIdleCopy({ lockedTargetLabel: null, showReviewCta })}
            </span>
          ) : (
            <span className={s.lockHint}>
              {lockBarIdleCopy({ lockedTargetLabel, showReviewCta })}
            </span>
          )}
        </div>
        <div className={s.lockActions}>
          {sel?.kind === "player" && openSlots.length > 0 && !lockedTarget ? (
            <button
              ref={slotPickerButtonRef}
              type="button"
              className={`btn btn--ghost ${s.lockSecondary}`}
              onClick={openSlotSheet}
            >
              Choose slot
            </button>
          ) : null}
          {showReviewCta ? (
            <button
              type="button"
              className={`btn btn--primary ${s.lockPrimary}`}
              onClick={onReview}
            >
              Review XI →
            </button>
          ) : (
            <button
              type="button"
              className={`btn btn--primary ${s.lockPrimary}`}
              disabled={!canLock || committing}
              onClick={handleLock}
            >
              {committing ? (
                "Locking..."
              ) : (
                <>
                  <LockIcon width={17} height={17} />
                  <span>Lock pick</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Bottom-sheet slot picker (mobile thumb zone) */}
      {sheetOpen && sel?.kind === "player" ? (
        <div className={s.sheetBackdrop} onClick={closeSlotSheet}>
          <div
            ref={sheetRef}
            className={s.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby="slot-picker-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={s.sheetHead}>
              <span id="slot-picker-title" className={s.sheetTitle}>
                Assign to slot
              </span>
              <button
                ref={sheetCloseButtonRef}
                type="button"
                className={s.sheetClose}
                onClick={closeSlotSheet}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className={s.sheetGrid}>
              {sortSlots(openSlots).map((slot) => {
                const c = positionCompatibility(sel.card.eligible_positions, slot.slot_position);
                const tier = compatTier(c);
                const isSel = selSlot === slot.slot_id;
                return (
                  <button
                    key={slot.slot_id}
                    type="button"
                    className={`${s.sheetSlot} ${s[`tier_${tier}`]!} ${
                      isSel ? s.sheetSlotActive : ""
                    }`}
                    data-active={isSel ? "true" : undefined}
                    onClick={() => {
                      setSelSlot(slot.slot_id);
                      closeSlotSheet();
                    }}
                  >
                    <span className={s.sheetSlotPos}>{slot.slot_position}</span>
                    <span className={s.sheetSlotKind}>{slot.is_starter ? "Starter" : "Bench"}</span>
                    <span className={s.sheetSlotCompat}>FIT {Math.round(c * 100)}%</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hypotheticalSquad(
  squad: readonly SquadSlot[],
  card: PlayerCardView,
  slot_id: string,
): SquadSlot[] {
  return squad.map((sl) => {
    if (sl.slot_id !== slot_id) return sl;
    const compat = positionCompatibility(card.eligible_positions, sl.slot_position);
    return {
      ...sl,
      card_id: card.card_id,
      player_id: card.player_id,
      tournament_id: card.tournament_id,
      position_compatibility: compat,
      validation_warnings: [],
    };
  });
}

function sortSlots(slots: readonly SquadSlot[]): SquadSlot[] {
  return [...slots].sort((a, b) => {
    if (a.is_starter !== b.is_starter) return a.is_starter ? -1 : 1;
    return a.slot_id.localeCompare(b.slot_id);
  });
}

function friendRunFromSearchParams(
  params: URLSearchParams | { get: (key: string) => string | null } | null,
): FriendRunContext | null {
  const rawScore = params?.get("beat") ?? null;
  if (rawScore === null || !/^\d{1,4}$/u.test(rawScore)) return null;
  const score = Number.parseInt(rawScore, 10);
  if (!Number.isSafeInteger(score) || score < 0 || score > 9999) return null;

  const rawRecord = params?.get("beat_record")?.trim() ?? "";
  const record = /^\d{1,2}-\d{1,2}$/u.test(rawRecord) ? rawRecord : null;
  return { score, record };
}

function dailyBeatContext(friendRun: FriendRunContext | null): DailyDraftContext | undefined {
  return friendRun
    ? {
        beatScore: friendRun.score,
        beatRecord: friendRun.record,
      }
    : undefined;
}
