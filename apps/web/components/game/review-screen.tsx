"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  computeSynergy,
  FORMATION_TEMPLATES,
  validateSquad,
} from "@wcdraft/core";
import {
  lineStrengthViews,
  managerCardView,
  managerTournamentFor,
  pitchSlotViews,
  squadAverageOverall,
} from "@/lib/game/adapters";
import { loadGameData, type GameData } from "@/lib/game/data";
import { describeGameError } from "@/lib/game/errors";
import { draftHref } from "@/lib/game/navigation";
import {
  loadRunRecord,
  saveRunRecord,
  type RunRecordV1,
} from "@/lib/game/run-record";
import { formatNullableNumber } from "@/lib/game/view-models";
import { Pitch } from "./pitch";
import { SynergyPanel } from "./synergy-panel";
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
        <Image
          src="/brand/wcdraft-mark.svg"
          alt="wcdraft"
          width={28}
          height={31}
          priority
        />
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

  const { starters, bench } = useMemo(
    () => pitchSlotViews(gameData.indexes, draft),
    [gameData, draft],
  );

  const manager = draft.manager_card_id
    ? managerCardView(gameData.indexes, draft.manager_card_id)
    : null;
  const managerTournament = draft.manager_card_id
    ? managerTournamentFor(gameData.indexes, draft.manager_card_id)
    : null;

  const synergy = useMemo(
    () =>
      computeSynergy(
        draft.squad,
        formation,
        managerTournament,
        gameData.nationByCardId,
      ),
    [draft.squad, formation, managerTournament, gameData.nationByCardId],
  );

  const lineRatings = useMemo(
    () => lineStrengthViews(gameData.indexes, draft),
    [gameData, draft],
  );
  const squadAvg = useMemo(() => squadAverageOverall(gameData.indexes, draft), [
    gameData,
    draft,
  ]);

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

  const fieldable = validation.is_fieldable;

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
        <div className={s.panelHead}>
          <h2 className={s.panelTitle}>{formation.name}</h2>
          <span className={s.panelMeta}>Locked · no rearranging</span>
        </div>
        <Pitch formationId={draft.formation_id} starters={starters} />

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
                <span className={s.slotPos}>{b.slot_position}</span>
                <span className={s.slotName}>{b.card ? b.card.name : "Open"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={s.mgrSlot}>
          <span className={s.benchLabel}>Manager</span>
          <span className={manager ? s.mgrFilled : s.mgrEmpty}>
            {manager
              ? `${manager.name} · ${manager.nation_name} · ${manager.year} · rating unavailable`
              : "No manager drafted — return to draft to keep spinning."}
          </span>
        </div>
      </section>

      <section className={s.panel}>
        <div className={s.panelHead}>
          <h2 className={s.panelTitle}>Rating by line</h2>
          <span className={s.squadAvg}>{formatNullableNumber(squadAvg)} OVR</span>
        </div>
        <div className={s.lineRatings}>
          {lineRatings.map((l) => (
            <div key={l.line} className={s.lineRow}>
              <span className={s.lineName}>{l.label}</span>
              <span className={s.lineTrack}>
                <span className={s.lineFill} style={{ width: `${l.value}%` }} />
              </span>
              <span className={s.lineVal}>{l.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={s.panel}>
        <SynergyPanel result={synergy} />
      </section>

      {validation.warnings.length > 0 ? (
        <section className={`${s.panel} ${s.warningsPanel}`}>
          <h3 className={s.panelSubTitle}>Squad warnings</h3>
          <ul className={s.warnList}>
            {validation.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={`${s.panel} ${s.simPanel}`}>
        <p className={s.simNote}>
          {fieldable
            ? `Your XI is fieldable. Simulation lands in the next phase.`
            : "Your XI isn't fieldable yet — head back to the draft and finish the starters."}
        </p>
        <button
          type="button"
          className="btn btn--primary btn--disabled"
          disabled
          aria-disabled="true"
          title="Simulation wires in during I3"
        >
          Simulate the run · next phase
        </button>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          Back to draft
        </button>
      </section>
    </div>
  );
}
