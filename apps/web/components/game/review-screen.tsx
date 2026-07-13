"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  computeSynergy,
  FORMATION_TEMPLATES,
  isBlindDraftMode,
  isDraftComplete,
  validateSquad,
} from "@wcdraft/core";
import {
  lineStrengthViews,
  managerCardView,
  managerTournamentFor,
  pitchSlotViews,
  squadAverageOverall,
} from "@/lib/game/adapters";
import type { GameData } from "@/lib/game/data";
import { describeGameError } from "@/lib/game/errors";
import { DRAFT_MODE_COPY } from "@/lib/game/mode-labels";
import { draftHref, resultsHref } from "@/lib/game/navigation";
import {
  saveRunRecord,
  setRunArrangement,
  setRunSimulation,
  setRunStatus,
  type RunRecordV1,
} from "@/lib/game/run-record";
import { resolveDisplayRun } from "@/lib/game/run-screen-loader";
import { loadScenarioBundle } from "@/lib/game/scenario-data";
import { mirrorRunToServer } from "@/lib/game/save-mirror";
import { runSimulation } from "@/lib/game/simulate";
import {
  canonicalTeamSheetSlots,
  materializeTeamSheetDraft,
  verifyTeamSheetArrangement,
} from "@/lib/game/team-sheet";
import { prewarmSimulationWorker, terminateSimulationWorker } from "@/lib/game/sim-worker-client";
import { SimulationHandoff } from "@/lib/game/simulation-handoff";
import { formatNullableNumber, type PitchSlotView } from "@/lib/game/view-models";
import { Pitch } from "./pitch";
import { ManagerSlot } from "./manager-slot";
import { MiniNationFlag } from "./mini-nation-flag";
import { SynergyBar } from "./synergy-bar";
import s from "./game.module.css";

type Mode =
  | { kind: "loading" }
  | {
      kind: "ready";
      gameData: GameData;
      record: RunRecordV1;
      persistenceWarning: string | null;
    }
  | { kind: "missing"; reason: string }
  | { kind: "error"; title: string; message: string };

export function ReviewScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const runId = searchParams?.get("run") ?? null;

  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);
  const reqToken = useRef(0);

  useEffect(() => {
    const myToken = ++reqToken.current;
    setMode({ kind: "loading" });
    if (!runId) {
      setMode({
        kind: "missing",
        reason: "Open a draft first — review is only available for a saved run.",
      });
      return;
    }
    resolveDisplayRun(runId ? { kind: "id", run_id: runId } : null, {
      allowUnsimulatedLocalRun: true,
    })
      .then((resolved) => {
        if (myToken !== reqToken.current) return;
        if (resolved.kind === "ready") {
          setMode({
            kind: "ready",
            gameData: resolved.gameData,
            record: resolved.record,
            persistenceWarning: null,
          });
        } else {
          setMode({
            kind: "missing",
            reason:
              resolved.kind === "missing" && resolved.runId === null
                ? "Open a draft first — review is only available for a saved run."
                : resolved.kind === "stale"
                  ? "This draft was created on an older data bundle."
                  : "We couldn't find this draft.",
          });
        }
      })
      .catch((err) => {
        if (myToken !== reqToken.current) return;
        const d = describeGameError(err);
        setMode({ kind: "error", title: d.title, message: d.message });
      });
  }, [retryNonce, runId]);

  useEffect(() => {
    if (mode.kind !== "ready") return;
    try {
      // `resolveDisplayRun` has already passed C4's runtime-data integrity
      // gate. Start the one reusable module worker while the user reviews.
      prewarmSimulationWorker();
    } catch (error) {
      // The click path retains the main-thread fallback and surfaces a warning.
      console.warn("[simulation] worker prewarm failed", error);
    }
    return () => terminateSimulationWorker();
  }, [mode.kind, mode.kind === "ready" ? mode.record.run_id : null]);

  if (mode.kind === "loading") {
    return (
      <div className={s.reviewShell}>
        <ReviewAppBar />
        <div className={s.loadingPanel} role="status">
          <p>Loading your draft…</p>
        </div>
      </div>
    );
  }

  if (mode.kind === "error") {
    return (
      <div className={s.reviewShell}>
        <ReviewAppBar />
        <div className={s.errorPanel} role="alert">
          <h2 className={s.errorTitle}>{mode.title}</h2>
          <p className={s.errorMessage}>{mode.message}</p>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setRetryNonce((value) => value + 1)}
          >
            Retry loading
          </button>
          <Link href={draftHref(null)} className="btn btn--primary">
            Start a new draft
          </Link>
          <Link href="/" className="btn btn--ghost">
            Home
          </Link>
        </div>
      </div>
    );
  }

  if (mode.kind === "missing") {
    return (
      <div className={s.reviewShell}>
        <ReviewAppBar />
        <div className={s.errorPanel}>
          <h2 className={s.errorTitle}>No draft to review</h2>
          <p className={s.errorMessage}>{mode.reason}</p>
          <Link href={draftHref(null)} className="btn btn--primary">
            Open the draft
          </Link>
        </div>
      </div>
    );
  }

  return (
    <ReviewBoard
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
      onBack={() => router.push(draftHref(mode.record.run_id))}
    />
  );
}

function ReviewAppBar({ warning }: { warning?: string | null } = {}) {
  return (
    <header className={s.draftAppBar}>
      <div className={s.appBarBrand}>
        <Image src="/brand/logo-header.png" alt="WCDraft" width={28} height={28} priority />
        <span className={s.appBarTitle}>Review</span>
      </div>
      {warning ? (
        <p className={s.persistenceWarn} role="status">
          {warning}
        </p>
      ) : null}
    </header>
  );
}

function ReviewBoard({
  gameData,
  record,
  persistenceWarning,
  onRecordUpdate,
  onBack,
}: {
  gameData: GameData;
  record: RunRecordV1;
  persistenceWarning: string | null;
  onRecordUpdate: (rec: RunRecordV1, warning: string | null) => void;
  onBack: () => void;
}) {
  const sourceDraft = record.draft;
  const arrangement = useMemo(
    () => verifyTeamSheetArrangement(sourceDraft, record.arrangement),
    [sourceDraft, record.arrangement],
  );
  // Ephemeral only: projected slots deliberately never replace persisted pick
  // evidence. The record remains base DraftState + optional arrangement.
  const draft = useMemo(
    () => materializeTeamSheetDraft(gameData, sourceDraft, arrangement),
    [arrangement, gameData, sourceDraft],
  );
  const formation = FORMATION_TEMPLATES[draft.formation_id]!;
  const validation = useMemo(() => validateSquad(draft), [draft]);
  const [warningsExpanded, setWarningsExpanded] = useState(false);
  const [selectedSheetSlot, setSelectedSheetSlot] = useState<string | null>(null);
  const arrangementMutable =
    record.simulation === undefined &&
    record.status !== "simulating" &&
    record.status !== "complete";

  const swapSheetSlot = useCallback(
    (slotId: string) => {
      if (!arrangementMutable) return;
      if (selectedSheetSlot === null) {
        setSelectedSheetSlot(slotId);
        return;
      }
      if (selectedSheetSlot === slotId) {
        setSelectedSheetSlot(null);
        return;
      }
      const slots = canonicalTeamSheetSlots(sourceDraft);
      const from = slots.findIndex((slot) => slot.slot_id === selectedSheetSlot);
      const to = slots.findIndex((slot) => slot.slot_id === slotId);
      if (from < 0 || to < 0) {
        setSelectedSheetSlot(null);
        return;
      }
      const nextArrangement = [...arrangement];
      [nextArrangement[from], nextArrangement[to]] = [nextArrangement[to]!, nextArrangement[from]!];
      const save = setRunArrangement(record.run_id, gameData.versions, nextArrangement);
      if (save.status !== "updated" || !save.record) {
        setSelectedSheetSlot(null);
        const authoritative = save.record ?? record;
        onRecordUpdate(
          authoritative,
          save.status === "conflict"
            ? "Team-sheet arrangement is locked because this run has already simulated."
            : "Couldn't save the team-sheet arrangement. Reload Review and try again.",
        );
        return;
      }
      const warning =
        save.persistence === "volatile" || save.warnings.length > 0
          ? save.warnings.join(" · ") ||
            "Team sheet is saved in this tab only — browser storage is unavailable."
          : persistenceWarning;
      setSelectedSheetSlot(null);
      onRecordUpdate(save.record, warning ?? null);
    },
    [
      arrangement,
      arrangementMutable,
      gameData.versions,
      onRecordUpdate,
      persistenceWarning,
      record,
      selectedSheetSlot,
      sourceDraft,
    ],
  );

  // Memory / Blind Open preserve blind picks, then reveal the complete factual
  // card information before this arrangement decision.
  const hiddenModeRevealed = isBlindDraftMode(draft.mode);
  const blindModeLabel = DRAFT_MODE_COPY[draft.mode].label;
  // Rating basis the squad was drafted on — every card/aggregate view resolves
  // from it (Current reads basis_ratings.current); the CURRENT chip rides it.
  const basis = draft.rating_basis;

  const { starters, bench } = useMemo(
    () => pitchSlotViews(gameData.indexes, draft, { basis }),
    [gameData, draft, basis],
  );

  const manager = draft.manager_card_id
    ? managerCardView(gameData.indexes, draft.manager_card_id)
    : null;
  const managerTournament = draft.manager_card_id
    ? managerTournamentFor(gameData.indexes, draft.manager_card_id)
    : null;

  const synergy = useMemo(
    () => computeSynergy(draft.squad, formation, managerTournament, gameData.nationByCardId),
    [draft.squad, formation, managerTournament, gameData.nationByCardId],
  );

  const lineRatings = useMemo(
    () => lineStrengthViews(gameData.indexes, draft, { basis }),
    [gameData, draft, basis],
  );
  const squadAvg = useMemo(
    () => squadAverageOverall(gameData.indexes, draft, { basis }),
    [gameData, draft, basis],
  );
  const squadWarnings = useMemo(
    () => buildPlainSquadWarnings(validation.warnings, [...starters, ...bench]),
    [validation.warnings, starters, bench],
  );
  const visibleWarnings = warningsExpanded ? squadWarnings : squadWarnings.slice(0, 4);
  const hiddenWarningCount = Math.max(0, squadWarnings.length - visibleWarnings.length);

  // Team name with debounced persistence.
  const [teamName, setTeamName] = useState(draft.team_name);
  useEffect(() => setTeamName(draft.team_name), [draft.team_name]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistTeamName = useCallback(
    (value: string) => {
      const trimmed = value.trim().slice(0, 32);
      if (trimmed === record.draft.team_name) return;
      const nextDraft = { ...record.draft, team_name: trimmed || "Your XI" };
      const next: RunRecordV1 = {
        ...record,
        updated_seq: record.updated_seq + 1,
        draft: nextDraft,
      };
      const save = saveRunRecord(next);
      const warning =
        save.persistence === "volatile" || save.warnings.length > 0
          ? save.warnings.join(" · ") ||
            "Draft is saved in this tab only — browser storage is unavailable."
          : persistenceWarning;
      onRecordUpdate(next, warning ?? null);
    },
    [record, persistenceWarning, onRecordUpdate],
  );

  function onTeamNameChange(value: string) {
    setTeamName(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => persistTeamName(value), 300);
  }

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // I3.7 fix-pass #2 (PR #18 BLOCKER): the Simulate gate must be DRAFT
  // COMPLETION (all 17 spins → full XI + 5 bench + 1 manager), NOT mere
  // fieldability (11 starters). The share token requires 17 picks to encode;
  // simulating a `drafting`-status squad ships an incomplete run and breaks
  // the share/replay contract. (validation.is_fieldable + the no-GK soft
  // warning remain layered checks — never the unlock condition.)
  const complete = isDraftComplete(draft);

  return (
    <div className={s.reviewShell} data-review-desktop-shell>
      <ReviewAppBar warning={persistenceWarning} />

      <header className={s.reviewHead}>
        <span className={s.eyebrowAccent}>Squad review</span>
        <div className={s.teamNameRow}>
          <label className={s.teamNameLabel} htmlFor="team-name">
            Name your team
          </label>
          <input
            id="team-name"
            className={s.teamNameInput}
            value={teamName}
            maxLength={32}
            onChange={(e) => onTeamNameChange(e.target.value)}
            onBlur={(e) => persistTeamName(e.target.value)}
            placeholder="Your XI"
          />
        </div>
      </header>

      <section className={`${s.panel} ${s.reviewMainPanel}`} aria-label="Final XI">
        <SynergyBar result={synergy} active={true} blind={false} />
        {hiddenModeRevealed ? (
          <p className={s.memoryModeNote} role="note">
            {blindModeLabel} reveal complete — arrange with full card information.
          </p>
        ) : null}
        <div className={s.panelHead}>
          <h1 className={s.panelTitle}>{formation.name}</h1>
          {basis === "current" ? (
            <span
              className={s.basisChip}
              title="This run rates every card on its at-tournament (Current) strength."
            >
              Current
            </span>
          ) : null}
          <span className={s.panelMeta}>
            {arrangementMutable
              ? "Tap two players to swap · fit never blocks"
              : "Team sheet locked during and after simulation"}
          </span>
        </div>
        <div className={s.squadStage}>
          <Pitch
            formationId={draft.formation_id}
            starters={starters}
            linkedPairs={synergy.linked_pairs}
            showInactiveEdges
            selectedSlotId={selectedSheetSlot}
            onSlotSelect={arrangementMutable ? swapSheetSlot : undefined}
            interactive={arrangementMutable}
            filledSlotInteraction={arrangementMutable}
          />
          <ManagerSlot manager={manager} />
        </div>

        <div className={s.bench}>
          <span className={s.benchLabel}>Bench</span>
          <div className={s.benchSlots}>
            {bench.map((b) => (
              <button
                type="button"
                key={b.slot_id}
                className={`${s.benchSlot} ${b.card ? s.benchFilled : ""} ${
                  selectedSheetSlot === b.slot_id ? s.slotSelected : ""
                }`}
                aria-pressed={selectedSheetSlot === b.slot_id}
                aria-label={`${b.slot_position} bench — ${b.card?.name ?? "open"}; ${
                  arrangementMutable ? "select to swap" : "arrangement locked"
                }`}
                onClick={() => swapSheetSlot(b.slot_id)}
                disabled={!arrangementMutable}
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
                <span className={s.slotName}>{b.card ? b.card.name : "Open"}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={`${s.panel} ${s.reviewMetricsPanel}`}>
        <div className={s.panelHead}>
          <h2 className={s.panelTitle}>Rating by line</h2>
          <span className={s.squadAvg}>{formatNullableNumber(squadAvg)} OVR</span>
        </div>
        <p className={s.lineCaption}>line strength · sim scale 0–100</p>
        <div className={s.lineRatings}>
          {lineRatings.map((l) => (
            <div key={l.line} className={s.lineRow}>
              <span className={s.lineName}>{l.label}</span>
              <span className={s.lineTrack}>
                <span className={s.lineFill} style={{ width: `${l.value ?? 0}%` }} />
              </span>
              <span className={s.lineVal}>{formatNullableNumber(l.value)}</span>
            </div>
          ))}
        </div>
      </section>

      {squadWarnings.length > 0 ? (
        <section
          className={`${s.panel} ${s.warningsPanel} ${s.reviewWarningsPanel}`}
          tabIndex={0}
          aria-labelledby="squad-warnings-title"
        >
          <div className={s.warnHead}>
            <h3 id="squad-warnings-title" className={s.panelSubTitle}>
              Squad warnings
            </h3>
            <span className={s.warnCount}>
              {squadWarnings.length} note{squadWarnings.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className={s.warnList}>
            {visibleWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {hiddenWarningCount > 0 || warningsExpanded ? (
            <button
              type="button"
              className={s.warnExpand}
              aria-expanded={warningsExpanded}
              onClick={() => setWarningsExpanded((v) => !v)}
            >
              {warningsExpanded ? "Show fewer" : `Show ${hiddenWarningCount.toString()} more`}
            </button>
          ) : null}
        </section>
      ) : null}

      <SimulatePanel
        gameData={gameData}
        record={record}
        complete={complete}
        onBack={onBack}
        onRecordUpdate={onRecordUpdate}
        persistenceWarning={persistenceWarning}
      />
    </div>
  );
}

// ─── Simulate CTA ─────────────────────────────────────────────────────────────

type SimState =
  | { kind: "idle" }
  | { kind: "running"; note: string }
  | { kind: "error"; title: string; message: string };

function SimulatePanel({
  gameData,
  record,
  complete,
  onBack,
  onRecordUpdate,
  persistenceWarning,
}: {
  gameData: GameData;
  record: RunRecordV1;
  /**
   * True iff every spin has been picked (`isDraftComplete(draft)`).
   * I3.7 fix-pass #2 (PR #18 BLOCKER): Simulate gates on draft completion —
   * never on `is_fieldable` — because a fieldable-but-not-complete squad has
   * <17 picks and cannot encode a replay token.
   */
  complete: boolean;
  onBack: () => void;
  onRecordUpdate: (rec: RunRecordV1, warning: string | null) => void;
  persistenceWarning: string | null;
}) {
  const router = useRouter();
  const [sim, setSim] = useState<SimState>({ kind: "idle" });
  const simInFlightRef = useRef(false);
  const handoffRef = useRef(new SimulationHandoff());

  useEffect(
    () => () => {
      handoffRef.current.cancel((ownedStatusSequence) => {
        try {
          setRunStatus(record.run_id, gameData.versions, "ready", {
            status: "simulating",
            updated_seq: ownedStatusSequence,
          });
        } catch {
          // Best-effort durable recovery during navigation/unmount.
        }
      });
      simInFlightRef.current = false;
    },
    [gameData.versions, record.run_id],
  );

  const startSim = useCallback(async () => {
    if (!complete || sim.kind === "running" || simInFlightRef.current) return;
    if (record.simulation !== undefined || record.status === "complete") return;
    const attempt = handoffRef.current.begin();
    if (!attempt) return;
    simInFlightRef.current = true;
    setSim({ kind: "running", note: "Loading 2026 scenario…" });
    // Reflect lifecycle on the persisted record so refreshes don't claim the
    // run is "ready" mid-simulation. Best-effort — proceed on failure.
    try {
      const stat = setRunStatus(record.run_id, gameData.versions, "simulating");
      if (stat.status === "updated" && stat.record) {
        if (stat.persistence === "durable") {
          handoffRef.current.markStatusSimulating(attempt, stat.record.updated_seq);
        }
        onRecordUpdate(stat.record, persistenceWarning);
      }
    } catch {
      // Non-fatal: a quota error here doesn't block the actual sim.
    }
    try {
      const scenarioBundle = await loadScenarioBundle();
      if (!handoffRef.current.canCommit(attempt)) return;
      setSim({ kind: "running", note: "Simulating the run…" });
      const result = await runSimulation(gameData, scenarioBundle, record, {
        signal: attempt.controller.signal,
      });
      if (!handoffRef.current.canCommit(attempt)) return;
      const ownedStatusSequence = handoffRef.current.ownedStatusSequence(attempt);
      const persist = setRunSimulation(
        record.run_id,
        gameData.versions,
        result.simulation,
        ownedStatusSequence === null
          ? undefined
          : { status: "simulating", updated_seq: ownedStatusSequence },
      );
      if (persist.status !== "updated" || !persist.record) {
        if (ownedStatusSequence !== null) {
          try {
            setRunStatus(record.run_id, gameData.versions, "ready", {
              status: "simulating",
              updated_seq: ownedStatusSequence,
            });
          } catch {
            // Best-effort; the stale/invalid record may no longer be writable.
          }
        }
        handoffRef.current.markStatusRecovered(attempt);
        setSim({
          kind: "error",
          title: "Couldn't save the simulation",
          message:
            "This draft record went stale between the tap and the result. Start a new draft to try again.",
        });
        return;
      }
      handoffRef.current.markResultCommitted(attempt);
      const warningParts: string[] = [];
      if (result.warning) warningParts.push(result.warning);
      if (persist.persistence === "volatile") {
        warningParts.push("Simulation saved to this tab only — browser storage is unavailable.");
      }
      warningParts.push(...persist.warnings);
      const warn = warningParts.length > 0 ? warningParts.join(" · ") : persistenceWarning;
      onRecordUpdate(persist.record, warn ?? null);
      // F-3.5 — fire-and-forget server mirror. The local save is the
      // source of truth; this just lands the row in saved_runs so signed-
      // in users get cross-device history and the F-3 claim has something
      // to transfer at sign-in.
      setSim({ kind: "running", note: "Syncing run to history..." });
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (!handoffRef.current.canCommit(attempt)) return;
      void mirrorRunToServer(gameData, persist.record);
      router.push(resultsHref(persist.record.run_id));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Navigation/unmount cancellation performs its own ownership-checked
        // recovery before this aborted continuation resumes.
        return;
      }
      if (!handoffRef.current.canCommit(attempt)) return;
      // Reset record status so the user can retry from a clean state.
      const ownedStatusSequence = handoffRef.current.ownedStatusSequence(attempt);
      if (ownedStatusSequence !== null) {
        try {
          const stat = setRunStatus(record.run_id, gameData.versions, "ready", {
            status: "simulating",
            updated_seq: ownedStatusSequence,
          });
          if (stat.status === "updated" && stat.record) {
            onRecordUpdate(stat.record, persistenceWarning);
          }
          handoffRef.current.markStatusRecovered(attempt);
        } catch {
          // best-effort
        }
      }
      const d = describeGameError(err);
      setSim({ kind: "error", title: d.title, message: d.message });
    } finally {
      if (handoffRef.current.canCommit(attempt)) {
        handoffRef.current.finish(attempt);
        simInFlightRef.current = false;
      }
    }
  }, [complete, sim.kind, gameData, record, router, onRecordUpdate, persistenceWarning]);

  const simulationLocked = record.simulation !== undefined || record.status === "complete";
  const note = simulationLocked
    ? "This completed run is read-only. Its team sheet and simulation stay paired."
    : !complete
    ? "Your draft isn't finished — head back and consume all 17 spins before simulating."
    : sim.kind === "running"
      ? sim.note
      : "Your team sheet is ready. Confirm it to play the 8-match run.";

  return (
    <section className={`${s.panel} ${s.simPanel} ${s.reviewSimPanel}`}>
      {sim.kind === "error" ? (
        <div role="alert">
          <p className={s.simNote}>
            <strong>{sim.title}</strong> · {sim.message}
          </p>
        </div>
      ) : (
        <p className={s.simNote} role={sim.kind === "running" ? "status" : undefined}>
          {note}
        </p>
      )}
      <button
        type="button"
        className={`btn btn--primary${
          !complete || simulationLocked || sim.kind === "running" ? " btn--disabled" : ""
        }`}
        onClick={startSim}
        disabled={!complete || simulationLocked || sim.kind === "running"}
        aria-disabled={!complete || simulationLocked || sim.kind === "running"}
      >
        {simulationLocked
          ? "Simulation complete"
          : sim.kind === "running"
            ? "Simulating…"
            : "Confirm team sheet & simulate"}
      </button>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={onBack}
        disabled={sim.kind === "running"}
      >
        Back to draft
      </button>
    </section>
  );
}

function buildPlainSquadWarnings(
  rawWarnings: readonly string[],
  slots: readonly PitchSlotView[],
): string[] {
  const slotWarnings = slots.flatMap((slot) =>
    slot.warnings.map((warning) => plainSlotWarning(slot, warning)),
  );
  const nonSlotWarnings = rawWarnings
    .filter((warning) => !slots.some((slot) => warning.startsWith(`${slot.slot_id}: `)))
    .map(plainGeneralWarning);
  return [...slotWarnings, ...nonSlotWarnings];
}

function plainSlotWarning(slot: PitchSlotView, raw: string): string {
  const card = slot.card;
  if (!card) return plainGeneralWarning(raw);
  const role = roleName(card.primary_position);
  const place = slotPlace(slot);
  if (raw.includes("outfielder in goal")) {
    return `${card.name} is a ${role} playing in goal; the sim applies a heavy penalty.`;
  }
  if (raw.includes("out-of-position") || raw.includes("placed in")) {
    return `${card.name} is a ${role} in the ${place} slot; expect a fit penalty.`;
  }
  return `${card.name} in ${place}: ${plainGeneralWarning(raw)}`;
}

function plainGeneralWarning(raw: string): string {
  if (raw.includes("XI incomplete")) return "The starting XI is not complete.";
  if (raw.includes("no recognised goalkeeper")) {
    return "No specialist goalkeeper is in the XI; the sim applies an outfielder-in-goal penalty.";
  }
  if (raw.includes("no manager drafted")) return "No manager has been drafted.";
  return raw.replace(/^[^:]+:\s*/u, "");
}

function roleName(position: PitchSlotView["line"] | null): string {
  if (position === null) return "player with no listed position";
  switch (position) {
    case "GK":
      return "goalkeeper";
    case "DF":
      return "defender";
    case "MF":
      return "midfielder";
    case "FW":
      return "forward";
  }
}

function slotPlace(slot: PitchSlotView): string {
  if (!slot.is_starter) return "bench";
  switch (slot.slot_position) {
    case "GK":
      return "goalkeeper";
    case "LB":
      return "left back";
    case "RB":
      return "right back";
    case "LCB":
    case "CB":
    case "RCB":
      return "centre back";
    case "LWB":
      return "left wing-back";
    case "RWB":
      return "right wing-back";
    case "CDM":
      return "defensive midfield";
    case "LCM":
    case "CM":
    case "RCM":
      return "central midfield";
    case "CAM":
      return "attacking midfield";
    case "LW":
      return "left wing";
    case "RW":
      return "right wing";
    case "ST":
      return "striker";
    default:
      return slot.slot_position.toLowerCase();
  }
}
