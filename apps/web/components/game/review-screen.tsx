"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { computeSynergy, FORMATION_TEMPLATES, isDraftComplete, validateSquad } from "@wcdraft/core";
import {
  lineStrengthViews,
  managerCardView,
  managerTournamentFor,
  pitchSlotViews,
  squadAverageOverall,
} from "@/lib/game/adapters";
import { loadGameData, type GameData } from "@/lib/game/data";
import { describeGameError } from "@/lib/game/errors";
import { draftHref, resultsHref } from "@/lib/game/navigation";
import {
  loadRunRecord,
  saveRunRecord,
  setRunSimulation,
  setRunStatus,
  type RunRecordV1,
} from "@/lib/game/run-record";
import { loadScenarioBundle } from "@/lib/game/scenario-data";
import { mirrorRunToServer } from "@/lib/game/save-mirror";
import { runSimulation } from "@/lib/game/simulate";
import { formatNullableNumber } from "@/lib/game/view-models";
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
    loadGameData()
      .then((gd) => {
        if (myToken !== reqToken.current) return;
        const loaded = loadRunRecord(runId, gd.versions);
        if (loaded.status === "loaded" && loaded.record) {
          setMode({
            kind: "ready",
            gameData: gd,
            record: loaded.record,
            persistenceWarning: null,
          });
        } else {
          setMode({
            kind: "missing",
            reason:
              loaded.status === "stale"
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
  }, [runId]);

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
          <Link href={draftHref(null)} className="btn btn--primary">
            Start a new draft
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
        <Image src="/brand/wcdraft-mark.svg" alt="wcdraft" width={28} height={31} priority />
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
  const draft = record.draft;
  const formation = FORMATION_TEMPLATES[draft.formation_id]!;
  const validation = useMemo(() => validateSquad(draft), [draft]);

  // Memory (hidden) mode — blind every rating SIGNAL (OVRs, channels, legend
  // gold, provenance hue, Synergy numerics, line strengths) until the
  // post-Simulate reveal. DISPLAY-ONLY: the engine still consumes the real
  // channels; identities, shapes, flags and synergy LINK LINES stay visible.
  const blind = draft.mode === "hidden";
  // Rating basis the squad was drafted on — every card/aggregate view resolves
  // from it (Current reads basis_ratings.current); the CURRENT chip rides it.
  const basis = draft.rating_basis;

  const { starters, bench } = useMemo(
    () => pitchSlotViews(gameData.indexes, draft, { blindRatings: blind, basis }),
    [gameData, draft, blind, basis],
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

  // Blinding rides the adapter opts (same as pitchSlotViews / squadAverageOverall)
  // so the masked nulls come out of the `blindCardRatingView` seam, never a screen
  // branch. Under blind, per-line `value` is null but `count` still reports the
  // filled-starter count so the row labels can render unconditionally.
  const lineRatings = useMemo(
    () => lineStrengthViews(gameData.indexes, draft, { blindRatings: blind, basis }),
    [gameData, draft, blind, basis],
  );
  const squadAvg = useMemo(
    () => squadAverageOverall(gameData.indexes, draft, { blindRatings: blind, basis }),
    [gameData, draft, blind, basis],
  );

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
    <div className={s.reviewShell}>
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

      <section className={s.panel} aria-label="Final XI">
        <SynergyBar result={synergy} active={true} blind={blind} />
        {blind ? (
          <p className={s.memoryModeNote} role="note">
            Memory mode — ratings &amp; Synergy numbers reveal after you simulate.
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
          <span className={s.panelMeta}>Locked · no rearranging</span>
        </div>
        <div className={s.squadStage}>
          <Pitch
            formationId={draft.formation_id}
            starters={starters}
            linkedPairs={synergy.linked_pairs}
            showInactiveEdges
          />
          <ManagerSlot manager={manager} />
        </div>

        <div className={s.bench}>
          <span className={s.benchLabel}>Bench</span>
          <div className={s.benchSlots}>
            {bench.map((b) => (
              <div
                key={b.slot_id}
                className={`${s.benchSlot} ${b.card ? s.benchFilled : ""} ${
                  b.card ? s.slotLocked : ""
                }`}
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
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={s.panel}>
        <div className={s.panelHead}>
          <h2 className={s.panelTitle}>Rating by line</h2>
          <span className={s.squadAvg}>{formatNullableNumber(squadAvg)} OVR</span>
        </div>
        {blind ? (
          <p className={s.memoryModeNote} role="note">
            Hidden until you simulate — line strengths are part of the Memory-mode blind.
          </p>
        ) : null}
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

      {validation.warnings.length > 0 ? (
        <section
          className={`${s.panel} ${s.warningsPanel}`}
          tabIndex={0}
          aria-labelledby="squad-warnings-title"
        >
          <h3 id="squad-warnings-title" className={s.panelSubTitle}>
            Squad warnings
          </h3>
          <ul className={s.warnList}>
            {validation.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
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

  const startSim = useCallback(async () => {
    if (!complete || sim.kind === "running") return;
    setSim({ kind: "running", note: "Loading 2026 scenario…" });
    // Reflect lifecycle on the persisted record so refreshes don't claim the
    // run is "ready" mid-simulation. Best-effort — proceed on failure.
    try {
      const stat = setRunStatus(record.run_id, gameData.versions, "simulating");
      if (stat.status === "updated" && stat.record) {
        onRecordUpdate(stat.record, persistenceWarning);
      }
    } catch {
      // Non-fatal: a quota error here doesn't block the actual sim.
    }
    try {
      const scenarioBundle = await loadScenarioBundle();
      setSim({ kind: "running", note: "Simulating the run…" });
      const result = await runSimulation(gameData, scenarioBundle, record);
      const persist = setRunSimulation(record.run_id, gameData.versions, result.simulation);
      if (persist.status !== "updated" || !persist.record) {
        setSim({
          kind: "error",
          title: "Couldn't save the simulation",
          message:
            "This draft record went stale between the tap and the result. Start a new draft to try again.",
        });
        return;
      }
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
      void mirrorRunToServer(gameData, persist.record);
      router.push(resultsHref(persist.record.run_id));
    } catch (err) {
      // Reset record status so the user can retry from a clean state.
      try {
        const stat = setRunStatus(record.run_id, gameData.versions, "ready");
        if (stat.status === "updated" && stat.record) {
          onRecordUpdate(stat.record, persistenceWarning);
        }
      } catch {
        // best-effort
      }
      const d = describeGameError(err);
      setSim({ kind: "error", title: d.title, message: d.message });
    }
  }, [complete, sim.kind, gameData, record, router, onRecordUpdate, persistenceWarning]);

  const note = !complete
    ? "Your draft isn't finished — head back and consume all 17 spins before simulating."
    : sim.kind === "running"
      ? sim.note
      : "Your draft is complete. Hit simulate to play the 8-match run.";

  return (
    <section className={`${s.panel} ${s.simPanel}`}>
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
        className={`btn btn--primary${!complete || sim.kind === "running" ? " btn--disabled" : ""}`}
        onClick={startSim}
        disabled={!complete || sim.kind === "running"}
        aria-disabled={!complete || sim.kind === "running"}
      >
        {sim.kind === "running" ? "Simulating…" : "Simulate the run"}
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
