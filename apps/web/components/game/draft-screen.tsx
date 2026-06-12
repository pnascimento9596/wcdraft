"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  activeSpin,
  computeSynergy,
  FORMATION_TEMPLATES,
  isDraftComplete,
  pickManager,
  pickPlayer,
  positionCompatibility,
  validateSquad,
  type CardId,
  type DraftState,
  type Position,
  type SquadSlot,
  type SynergyResult,
  ERA_PRESET_IDS,
  selectDraftTarget,
  DraftTargetDeadEndError,
  type DraftFlow,
  type EraPresetId,
} from "@wcdraft/core";
import {
  draftCandidateViews,
  managerCardView,
  managerTournamentFor,
  pitchSlotViews,
} from "@/lib/game/adapters";
import { getCatalogForEra, loadGameData, type GameData } from "@/lib/game/data";
import { describeGameError, DraftTransitionError } from "@/lib/game/errors";
import {
  getFormationVisualSlots,
  SUPPORTED_FORMATION_OPTIONS,
  type SupportedFormationId,
} from "@/lib/game/formation-layout";
import { draftTargetLabel, lockBarIdleCopy } from "@/lib/game/config-badges";
import { draftHref, reviewHref } from "@/lib/game/navigation";
import {
  createNewRunRecord,
  evictStaleRunRecords,
  isStorageVolatile,
  loadRunRecord,
  saveRunRecord,
  type RunRecordV1,
} from "@/lib/game/run-record";

/**
 * Honest fallback copy when the run-record store is running on the in-memory
 * fallback. Kept in sync with the FormationSelect / handleLock messages so a
 * resume after `router.replace` doesn't lose the warning the user already saw.
 */
const VOLATILE_STORAGE_WARNING =
  "Draft is saved in this tab only — browser storage is unavailable.";
import {
  compatLabel,
  compatTier,
  positionShape,
  type ManagerCardView,
  type PlayerCardView,
} from "@/lib/game/view-models";
import { buildSlotRevealModel } from "@/lib/game/slot-reveal";
import { Pitch, PitchMarkings } from "./pitch";
import { CandidateCard, ManagerCandidate } from "./candidate-card";
import { SquadHeaderFlag } from "./squad-header-flag";
import { ManagerSlot } from "./manager-slot";
import { SpinStage, type SpinAnimState } from "./slot-machine";
import { SynergyBar } from "./synergy-bar";
import s from "./game.module.css";

const TOTAL_SPINS = 17;

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
type Selection =
  | { kind: "player"; card: PlayerCardView }
  | { kind: "manager"; card: ManagerCardView }
  | null;
type PosFilter = "ALL" | Position;
type SortKey = "ovr" | "name" | "pos";
const POS_FILTERS: PosFilter[] = ["ALL", "GK", "DF", "MF", "FW"];

type Mode =
  | { kind: "loading" }
  | { kind: "formation_select"; gameData: GameData }
  | {
      kind: "ready";
      gameData: GameData;
      record: RunRecordV1;
      persistenceWarning: string | null;
    }
  | { kind: "recovery"; gameData: GameData; reason: string; runId: string | null }
  | { kind: "error"; title: string; message: string };

export function DraftScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestRunId = searchParams?.get("run") ?? null;
  // Mode-select threads `?mode=hidden` for a Memory draft; anything else is
  // classic. Only consulted when CREATING a run — resumed runs carry their
  // mode on the persisted DraftState.
  const requestedMode: "classic" | "hidden" =
    searchParams?.get("mode") === "hidden" ? "hidden" : "classic";

  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const reqToken = useRef(0);

  // ── Load game data + resolve run (mount + run param change) ─────────────
  useEffect(() => {
    const myToken = ++reqToken.current;
    setMode({ kind: "loading" });
    loadGameData()
      .then((gd) => {
        if (myToken !== reqToken.current) return;
        evictStaleRunRecords(gd.versions);
        if (requestRunId) {
          const loaded = loadRunRecord(requestRunId, gd.versions);
          if (loaded.status === "loaded" && loaded.record) {
            setMode({
              kind: "ready",
              gameData: gd,
              record: loaded.record,
              // Re-derive the volatile-storage warning on the resume path so
              // it survives the formation-lock `router.replace` (and a real
              // refresh) — otherwise the spin stage flashes blank between the
              // initial save and the next durable-failing pick.
              persistenceWarning: isStorageVolatile() ? VOLATILE_STORAGE_WARNING : null,
            });
          } else {
            setMode({
              kind: "recovery",
              gameData: gd,
              reason:
                loaded.status === "missing"
                  ? "We couldn't find a draft for that link."
                  : loaded.status === "stale"
                    ? "This draft was created on an older data bundle and has been evicted."
                    : "This draft record is invalid and has been removed.",
              runId: requestRunId,
            });
          }
        } else {
          setMode({ kind: "formation_select", gameData: gd });
        }
      })
      .catch((err) => {
        if (myToken !== reqToken.current) return;
        const d = describeGameError(err);
        setMode({ kind: "error", title: d.title, message: d.message });
      });
    return () => {
      reqToken.current += 1;
    };
  }, [requestRunId]);

  // ── Sub-renderers per mode ───────────────────────────────────────────────
  if (mode.kind === "loading") {
    return (
      <div className={s.draftShell}>
        <DraftAppBar spinNumber={null} progressPct={0} />
        <div className={s.loadingPanel} role="status">
          <p>Loading the real 1930–2026 draft pool…</p>
        </div>
      </div>
    );
  }

  if (mode.kind === "error") {
    return (
      <div className={s.draftShell}>
        <DraftAppBar spinNumber={null} progressPct={0} />
        <div className={s.errorPanel} role="alert">
          <h2 className={s.errorTitle}>{mode.title}</h2>
          <p className={s.errorMessage}>{mode.message}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              reqToken.current += 1;
              setMode({ kind: "loading" });
              loadGameData()
                .then((gd) => setMode({ kind: "formation_select", gameData: gd }))
                .catch((err) => {
                  const d = describeGameError(err);
                  setMode({
                    kind: "error",
                    title: d.title,
                    message: d.message,
                  });
                });
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (mode.kind === "recovery") {
    return (
      <div className={s.draftShell}>
        <DraftAppBar spinNumber={null} progressPct={0} />
        <div className={s.errorPanel} role="alert">
          <h2 className={s.errorTitle}>Couldn&rsquo;t resume that draft</h2>
          <p className={s.errorMessage}>{mode.reason}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => router.replace(draftHref(null))}
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
        onLocked={(record, warning) => {
          // Replace URL with new run id; keep history clean.
          router.replace(draftHref(record.run_id));
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

// ─── Top app bar ─────────────────────────────────────────────────────────────

function DraftAppBar({
  spinNumber,
  progressPct,
  warning,
}: {
  spinNumber: number | null;
  progressPct: number;
  warning?: string | null;
}) {
  return (
    <header className={s.draftAppBar}>
      <div className={s.appBarBrand}>
        <Image src="/brand/wcdraft-mark.svg" alt="wcdraft" width={28} height={31} priority />
        <span className={s.appBarTitle}>Draft</span>
      </div>
      {/* No counter until a draft actually exists (formation select /
          loading / error pass spinNumber=null) — a dash-counter on a
          screen with no draft reads as broken state. */}
      {spinNumber !== null ? (
        <div className={s.appBarMeter}>
          <div className={s.spinCounter}>
            <span className={s.spinCounterNum}>Spin {Math.min(spinNumber, TOTAL_SPINS)}</span>
            <span className={s.spinCounterTotal}>/ {TOTAL_SPINS}</span>
          </div>
          <div className={s.spinProgress} aria-hidden="true">
            <span
              className={s.spinProgressFill}
              style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
            />
          </div>
        </div>
      ) : null}
      {warning ? (
        <p className={s.persistenceWarn} role="status">
          {warning}
        </p>
      ) : null}
    </header>
  );
}

// ─── DC-2/DC-4 — pre-draft "Draft setup" disclosure (plan §G) ───────────────

const ERA_PRESET_LABELS: Record<EraPresetId, string> = {
  all_time: "All-time",
  post_2000: "Post-2000",
  post_2010: "Post-2010",
  modern: "Modern",
};

const DRAFT_FLOW_LABELS: Record<DraftFlow, string> = {
  squad_first: "Squad First",
  position_first: "Position First",
};

function DraftSetupDisclosure({
  eraPreset,
  onEraPreset,
  draftFlow,
  onDraftFlow,
  disabled,
}: {
  eraPreset: EraPresetId;
  onEraPreset: (p: EraPresetId) => void;
  draftFlow: DraftFlow;
  onDraftFlow: (f: DraftFlow) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Summary mirrors the three config axes; basis is fixed in this build
  // (Current lands with the MV2-12b basis season).
  const summary = `${DRAFT_FLOW_LABELS[draftFlow]} · Career · ${ERA_PRESET_LABELS[eraPreset]}`;
  return (
    <div>
      <button
        type="button"
        className={s.setupRow}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={s.setupRowLabel}>Draft setup</span>
        <span className={s.setupRowValue}>{summary}</span>
        <span className={s.setupRowChevron} aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open ? (
        <div className={s.setupPanel}>
          <div className={s.setupAxis}>
            <span className={s.setupAxisLabel}>Era</span>
            <div className={s.setupSeg} role="group" aria-label="Era preset">
              {ERA_PRESET_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`${s.setupSegBtn} ${eraPreset === id ? s.setupSegBtnActive : ""}`}
                  aria-pressed={eraPreset === id}
                  disabled={disabled}
                  onClick={() => onEraPreset(id)}
                >
                  {ERA_PRESET_LABELS[id]}
                </button>
              ))}
            </div>
          </div>
          <div className={s.setupAxis}>
            <span className={s.setupAxisLabel}>Draft mode</span>
            <div className={s.setupSeg} role="group" aria-label="Draft mode">
              {(["squad_first", "position_first"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`${s.setupSegBtn} ${draftFlow === f ? s.setupSegBtnActive : ""}`}
                  aria-pressed={draftFlow === f}
                  disabled={disabled}
                  onClick={() => onDraftFlow(f)}
                >
                  {DRAFT_FLOW_LABELS[f]}
                </button>
              ))}
            </div>
            <p className={s.setupAxisNote}>
              Position First: choose the slot to fill, then spin for the squad.
            </p>
          </div>
          <div className={s.setupAxis}>
            <span className={s.setupAxisLabel}>Rating basis</span>
            <div className={s.setupSeg} role="group" aria-label="Rating basis">
              <button
                type="button"
                className={`${s.setupSegBtn} ${s.setupSegBtnActive}`}
                aria-pressed
              >
                Career
              </button>
              <button type="button" className={s.setupSegBtn} disabled>
                Current
              </button>
            </div>
            <p className={s.setupAxisNote}>Current arrives after the rating rebuild.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Formation select (LOCK gate) ────────────────────────────────────────────

function FormationSelect({
  gameData,
  draftMode,
  onLocked,
}: {
  gameData: GameData;
  /** Run mode for the record being created — `hidden` is Memory mode. */
  draftMode: "classic" | "hidden";
  onLocked: (record: RunRecordV1, warning: string | null) => void;
}) {
  const [pending, setPending] = useState<SupportedFormationId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eraPreset, setEraPreset] = useState<EraPresetId>("all_time");
  const [draftFlow, setDraftFlow] = useState<DraftFlow>("squad_first");

  const lockIn = useCallback(
    (formation_id: SupportedFormationId) => {
      setError(null);
      setPending(formation_id);
      try {
        const created = createNewRunRecord(gameData, {
          formation_id,
          mode: draftMode,
          era_preset: eraPreset,
          draft_flow: draftFlow,
        });
        const warning =
          created.persistence === "volatile" || created.warnings.length > 0
            ? created.warnings.join(" · ") ||
              "This draft is saved in this tab only — browser storage is unavailable."
            : null;
        onLocked(created.record, warning);
      } catch (err) {
        const d = describeGameError(err);
        setError(`${d.title}: ${d.message}`);
        setPending(null);
      }
    },
    [gameData, draftMode, eraPreset, draftFlow, onLocked],
  );

  return (
    <div className={s.draftShell}>
      <DraftAppBar spinNumber={null} progressPct={0} />
      <section className={s.formationSelect}>
        <div className={s.formationHead}>
          <Image src="/brand/wcdraft-lockup.svg" alt="wcdraft" width={240} height={60} priority />
          <h1 className={s.formationTitle}>Lock a formation</h1>
          <p className={s.formationSub}>
            Your shape is committed the moment you lock. 17 spins, one entity per spin — no
            rearranging afterwards.
          </p>
          {draftMode === "hidden" ? (
            <p className={s.memoryModeNote} role="note">
              Memory mode — names, flags and years stay visible; ratings &amp; Synergy numbers hide
              until you simulate.
            </p>
          ) : null}
        </div>
        <DraftSetupDisclosure
          eraPreset={eraPreset}
          onEraPreset={setEraPreset}
          draftFlow={draftFlow}
          onDraftFlow={setDraftFlow}
          disabled={pending !== null}
        />
        <div className={s.formationGrid}>
          {/* ws-ux/mobile-polish-2: blurb prose dropped from the tile — at
              tile width it truncated mid-sentence ("…"), which added noise
              without information. The tile is shape-first: mini pitch +
              name + lock CTA. `FormationOption.blurb` stays in the data
              layer for surfaces with room for prose. */}
          {SUPPORTED_FORMATION_OPTIONS.map(({ formation_id: fid }) => (
            <button
              key={fid}
              type="button"
              className={`${s.formationCard} ${pending === fid ? s.formationCardPending : ""}`}
              disabled={pending !== null}
              onClick={() => lockIn(fid)}
            >
              <MiniPitch formation_id={fid} />
              <div className={s.formationCardBody}>
                <span className={s.formationCardName}>{fid}</span>
                <span className={s.formationCardCta}>
                  {pending === fid ? "Locking…" : "Lock this shape"}
                </span>
              </div>
            </button>
          ))}
        </div>
        {error ? <p className={s.formationError}>{error}</p> : null}
      </section>
    </div>
  );
}

function MiniPitch({ formation_id }: { formation_id: SupportedFormationId }) {
  const slots = getFormationVisualSlots(formation_id);
  return (
    <div className={s.miniPitch} aria-hidden="true">
      <PitchMarkings variant="mini" />
      {slots.map((sl) => {
        // Shape comes from the CORE position line (GK square / DF triangle
        // / MF diamond / FW circle). Colour family uses the JSON visual
        // band so a 3-5-2 wing-back stays in the midfield COLOUR but draws
        // as a DF triangle — see formation-layout.ts.
        const shape = positionShape(sl.position_line);
        return (
          <span
            key={sl.slot_id}
            className={`${s.miniDot} ${s[`miniDot_${sl.visual_line}`]!} ${s[`miniDotShape_${shape}`]!}`}
            style={{ left: `${sl.x_pct}%`, top: `${sl.y_pct}%` }}
          />
        );
      })}
    </div>
  );
}

// ─── Draft board (active spin → pick → lock) ─────────────────────────────────

function DraftBoard({
  gameData,
  record,
  persistenceWarning,
  onRecordUpdate,
  onReview,
}: {
  gameData: GameData;
  record: RunRecordV1;
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

  // Memory (hidden) mode — blind every rating SIGNAL (OVRs, channels, legend
  // gold, provenance hue, Synergy numerics) on the draft surface. DISPLAY-
  // ONLY: the engine state, pick/lock flow, and the sim inputs are the real
  // values; identities, shapes, flags, the spin and synergy LINK LINES stay.
  const blind = draft.mode === "hidden";

  // DC-3 position-first derivations. `awaitingTarget` gates the target-select
  // stage (the spin's draw is NOT materialized yet); `lockedTarget` pins the
  // assignment once the squad rolled (the lock action fills only the target).
  const positionFirst = draft.draft_flow === "position_first";
  const awaitingTarget = positionFirst && spin?.status === "awaiting_slot";
  const lockedTarget = positionFirst && spin?.status === "pending" ? spin.target_slot_id : null;
  const lockedTargetLabel = lockedTarget ? draftTargetLabel(draft, lockedTarget) : null;

  // Adapter views.
  const { starters, bench } = useMemo(
    () => pitchSlotViews(gameData.indexes, draft, { blindRatings: blind }),
    [gameData, draft, blind],
  );
  const candidates = useMemo(
    () => draftCandidateViews(gameData.indexes, draft, spin, { blindRatings: blind }),
    [gameData, draft, spin, blind],
  );

  // Selection / UI state.
  const [sel, setSel] = useState<Selection>(null);
  const [selSlot, setSelSlot] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<PosFilter>("ALL");
  // Hidden mode: OVR is blinded, so a rating sort would leak tier order —
  // default to name and drop the option (see the sort <select> below).
  const [sortKey, setSortKey] = useState<SortKey>(blind ? "name" : "ovr");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // Standalone-spin flow state. `phase` gates the spin stage vs the lineup
  // view; `anim` drives the drum lifecycle on the spin stage.
  const [phase, setPhase] = useState<SpinPhase>("spin");
  const [anim, setAnim] = useState<SpinAnimState>("idle");
  const reducedMotion = usePrefersReducedMotion();

  // Refs used to drive deterministic scroll alignment on two key
  // transitions:
  //  - assign-flow: picking a candidate scrolls the formation panel into
  //    view so the slot picker is on screen (no manual scroll up).
  //  - post-lock: locking advances the engine + flips phase to "spin", so
  //    we scroll the window to the spin-stage origin to put the flags
  //    card at the top of the viewport (no mid-page landing).
  const formationPanelRef = useRef<HTMLElement | null>(null);
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
    setSearch("");
    setPosFilter("ALL");
    setTransitionError(null);
    setPhase("spin");
    setAnim("idle");
    lastSelectedPlayerRef.current = null;
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

  // SPIN clicked: reduced-motion skips the 2–3s reveal straight to settled;
  // otherwise the drum animates and `onSettle` (animationend) flips to settled.
  const handleSpin = useCallback(() => {
    setAnim(reducedMotion ? "settled" : "spinning");
  }, [reducedMotion]);
  const handleSettle = useCallback(() => setAnim("settled"), []);
  const handleReveal = useCallback(() => setPhase("lineup"), []);

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

  // Filter/sort player candidates.
  const visibleCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = candidates.players.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.full_name.toLowerCase().includes(q)) {
        return false;
      }
      if (posFilter !== "ALL" && !p.eligible_positions.includes(posFilter)) return false;
      return true;
    });
    const ord: Record<Position, number> = { GK: 0, DF: 1, MF: 2, FW: 3 };
    return [...list].sort((a, b) => {
      if (sortKey === "ovr") {
        const ao = a.rating.overall;
        const bo = b.rating.overall;
        if (ao === null && bo === null) return a.name.localeCompare(b.name);
        if (ao === null) return 1;
        if (bo === null) return -1;
        return bo - ao;
      }
      if (sortKey === "name") return a.name.localeCompare(b.name);
      return ord[a.eligible_positions[0] ?? "MF"] - ord[b.eligible_positions[0] ?? "MF"];
    });
  }, [candidates, search, posFilter, sortKey]);

  // Open vacant slots (engine truth).
  const openSlots = useMemo(() => draft.squad.filter((sl) => sl.card_id === null), [draft.squad]);

  function bestSlotFor(card: PlayerCardView): string | null {
    const starterOpens = openSlots.filter((sl) => sl.is_starter);
    const pool = starterOpens.length > 0 ? starterOpens : openSlots;
    let best: { id: string; c: number } | null = null;
    for (const slot of pool) {
      const c = positionCompatibility(card.eligible_positions, slot.slot_position);
      if (!best || c > best.c) best = { id: slot.slot_id, c };
    }
    return best?.id ?? null;
  }

  function selectPlayer(card: PlayerCardView) {
    setSel({ kind: "player", card });
    // Position-first: the slot was committed before the reveal — the pick
    // can only fill the locked target.
    setSelSlot(lockedTarget ?? bestSlotFor(card));
    setTransitionError(null);
  }
  function selectManager(card: ManagerCardView) {
    setSel({ kind: "manager", card });
    setSelSlot(null);
    setTransitionError(null);
  }

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
        nextDraft = pickManager(catalog, draft);
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
        <DraftAppBar
          spinNumber={spinNumber}
          progressPct={progressPct}
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
                      <span className={s.targetChipId}>{sl.slot_id}</span>
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
                      <span className={s.targetChipId}>{sl.slot_id}</span>
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
  // the reveal settles and the user taps "Reveal squad →" do we cross into the
  // lineup/pick view below. This supersedes the inline reveal from PR #21.
  if (!complete && spin && slotReveal && phase === "spin") {
    return (
      <div className={`${s.draftShell} ${s.spinShell}`}>
        {persistenceWarning ? (
          <p className={`${s.persistenceWarn} ${s.spinPersistenceWarn}`} role="status">
            {persistenceWarning}
          </p>
        ) : null}
        <SpinStage
          model={slotReveal}
          pickNumber={spinNumber}
          totalPicks={TOTAL_SPINS}
          formationId={draft.formation_id}
          synergyOverall={revealSynergyOverall}
          synergyMultiplier={revealSynergyMultiplier}
          playerPoolCount={candidates.players.length}
          anim={anim}
          onSpin={handleSpin}
          onSettle={handleSettle}
          onReveal={handleReveal}
        />
      </div>
    );
  }

  return (
    /* ws-ux/tap-stability-2: the main draft layout is an ANCHORED shell — the
       document never scrolls (scrolling lives in .draftScroll), so iOS Safari's
       toolbar never collapses mid-session and the lock bar — a normal-flow
       bottom row of this 100svh shell, not a viewport-fixed element — cannot
       move under the user's finger. */
    <div className={`${s.draftShell} ${s.draftShellAnchored}`} data-draft-anchored>
      <DraftAppBar spinNumber={spinNumber} progressPct={progressPct} warning={persistenceWarning} />

      <div className={s.draftScroll}>
        {/* Spin reveal → now compact context (full reveal lives on the spin stage) */}
        {complete ? (
          <section className={`${s.panel} ${s.completePanel}`}>
            <span className={s.eyebrowAccent}>Draft complete</span>
            <h2 className={s.panelTitle}>All 17 spins resolved.</h2>
            <p className={s.completeNote}>
              Lock-on-pick — nothing else can be rearranged. Step into review for line ratings,
              Synergy, and your final XI.
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
        ) : null}

        {/* Pitch + bench + manager */}
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
              Memory mode — ratings &amp; Synergy numbers reveal after you simulate.
            </p>
          ) : null}
          <div className={s.panelHead}>
            <h2 className={`${s.panelTitle} ${s.formationTitleInline}`}>{formation.name}</h2>
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
                draft.manager_card_id
                  ? managerCardView(gameData.indexes, draft.manager_card_id)
                  : null
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
                    <span className={s.slotPos}>{b.slot_position}</span>
                    <span className={s.slotName}>
                      {b.card ? b.card.name : pc != null ? `${Math.round(pc * 100)}%` : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {!validation.has_goalkeeper && fieldable ? (
          <section className={`${s.panel} ${s.gkWarnPanel}`}>
            <p className={s.gkWarn} role="status">
              <span className={s.gkWarnGlyph} aria-hidden="true">
                !
              </span>
              No specialist goalkeeper placed yet — the sim will apply an outfielder-in-goal
              penalty.
            </p>
          </section>
        ) : null}

        {/* Candidates */}
        {!complete && spin ? (
          <section id="draft-candidates" className={s.panel} aria-label="Candidates">
            <div className={s.controls}>
              <input
                type="search"
                className={s.searchInput}
                placeholder="Search players…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search players"
              />
              <div className={s.filterRow}>
                <div className={s.segmented} role="group" aria-label="Filter by position">
                  {POS_FILTERS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={posFilter === p ? s.segActive : s.seg}
                      aria-pressed={posFilter === p}
                      onClick={() => setPosFilter(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <label className={s.sortLabel}>
                  Sort
                  <select
                    className={s.sortSelect}
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                  >
                    {/* Hidden mode: rating sort would leak the blinded OVR order. */}
                    {!blind ? <option value="ovr">Rating</option> : null}
                    <option value="name">Name</option>
                    <option value="pos">Position</option>
                  </select>
                </label>
              </div>
            </div>

            {candidates.manager ? (
              <ManagerCandidate
                manager={candidates.manager}
                selected={sel?.kind === "manager"}
                disabled={draft.manager_card_id !== null}
                rarePick={spin?.rare === true}
                onSelect={() => selectManager(candidates.manager!)}
              />
            ) : null}

            <div className={s.candList}>
              {visibleCandidates.map((card) => (
                <CandidateCard
                  key={card.card_id}
                  card={card}
                  selected={sel?.kind === "player" && sel.card.card_id === card.card_id}
                  disabled={false}
                  rarePick={spin?.rare === true}
                  onSelect={() => selectPlayer(card)}
                />
              ))}
              {visibleCandidates.length === 0 ? (
                <p className={s.emptyList}>No players match those filters.</p>
              ) : null}
            </div>
          </section>
        ) : null}

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
                {compatLabel(selectedCompat)} · {Math.round(selectedCompat * 100)}%
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
              type="button"
              className={`btn btn--ghost ${s.lockSecondary}`}
              onClick={() => setSheetOpen(true)}
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
              {committing ? "Locking…" : "Lock pick 🔒"}
            </button>
          )}
        </div>
      </div>

      {/* Bottom-sheet slot picker (mobile thumb zone) */}
      {sheetOpen && sel?.kind === "player" ? (
        <div className={s.sheetBackdrop} onClick={() => setSheetOpen(false)}>
          <div
            className={s.sheet}
            role="dialog"
            aria-label="Assign slot"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={s.sheetHead}>
              <span className={s.sheetTitle}>Assign to slot</span>
              <button
                type="button"
                className={s.sheetClose}
                onClick={() => setSheetOpen(false)}
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
                    onClick={() => {
                      setSelSlot(slot.slot_id);
                      setSheetOpen(false);
                    }}
                  >
                    <span className={s.sheetSlotPos}>{slot.slot_position}</span>
                    <span className={s.sheetSlotKind}>{slot.is_starter ? "Starter" : "Bench"}</span>
                    <span className={s.sheetSlotCompat}>{Math.round(c * 100)}%</span>
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
