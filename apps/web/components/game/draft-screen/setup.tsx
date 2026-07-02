import { useCallback, useState } from "react";
import Image from "next/image";
import {
  ERA_PRESET_IDS,
  type DraftFlow,
  type DraftMode,
  type EraPresetId,
  type RatingBasis,
} from "@wcdraft/core";

import type { GameData } from "@/lib/game/data";
import { describeGameError } from "@/lib/game/errors";
import {
  getFormationVisualSlots,
  SUPPORTED_FORMATION_OPTIONS,
  type SupportedFormationId,
} from "@/lib/game/formation-layout";
import { requestRankedAttempt } from "@/lib/leaderboard/client";
import { createNewRunRecord, type RunRecordV1 } from "@/lib/game/run-record";
import { ERA_PRESET_LABELS } from "@/lib/game/era-labels";
import { DRAFT_MODE_COPY } from "@/lib/game/mode-labels";
import { positionShape } from "@/lib/game/view-models";
import { PitchMarkings } from "../pitch";
import { DraftAppBar } from "./app-bar";
import s from "../game.module.css";

// ─── DC-2/DC-4 — pre-draft "Draft setup" disclosure (plan §G) ───────────────

const DRAFT_FLOW_LABELS: Record<DraftFlow, string> = {
  squad_first: "Squad First",
  position_first: "Position First",
};

const RATING_BASIS_LABELS: Record<RatingBasis, string> = {
  career: "Career",
  current: "Current",
};

/**
 * The rating bases the setup control offers, in display order. EXPORTED as the
 * control-of-record so a test can pin it against the bases actually present in
 * the served runtime bundle — the UI can never silently lag (or lead) the data.
 */
export const SETUP_RATING_BASES = ["career", "current"] as const satisfies readonly RatingBasis[];

function DraftSetupDisclosure({
  eraPreset,
  onEraPreset,
  draftFlow,
  onDraftFlow,
  ratingBasis,
  onRatingBasis,
  disabled,
}: {
  eraPreset: EraPresetId;
  onEraPreset: (p: EraPresetId) => void;
  draftFlow: DraftFlow;
  onDraftFlow: (f: DraftFlow) => void;
  ratingBasis: RatingBasis;
  onRatingBasis: (b: RatingBasis) => void;
  disabled: boolean;
}) {
  // Owner note: the setup axes must be visible on arrival. The control still
  // collapses on demand, but it no longer hides the Era / Draft mode / Rating
  // basis choices by default on mobile.
  const [open, setOpen] = useState(true);
  // Summary mirrors all three config axes.
  const summaryParts = [
    `${DRAFT_FLOW_LABELS[draftFlow]} · ${RATING_BASIS_LABELS[ratingBasis]}`,
    ERA_PRESET_LABELS[eraPreset],
  ] as const;
  const summary = `${DRAFT_FLOW_LABELS[draftFlow]} · ${RATING_BASIS_LABELS[ratingBasis]} · ${ERA_PRESET_LABELS[eraPreset]}`;
  return (
    <div>
      <button
        type="button"
        className={s.setupRow}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={s.setupRowLabel}>Draft setup</span>
        <span className={s.setupRowValue} aria-label={summary}>
          {summaryParts.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </span>
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
            <span className={s.setupAxisLabel}>Draft order</span>
            <div className={s.setupSeg} role="group" aria-label="Draft order">
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
              {SETUP_RATING_BASES.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`${s.setupSegBtn} ${ratingBasis === b ? s.setupSegBtnActive : ""}`}
                  aria-pressed={ratingBasis === b}
                  disabled={disabled}
                  onClick={() => onRatingBasis(b)}
                >
                  {RATING_BASIS_LABELS[b]}
                </button>
              ))}
            </div>
            <p className={s.setupAxisNote}>
              Career: each card on its whole-career peak. Current: the player at that
              tournament&rsquo;s strength, estimated where a career is still in progress.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Formation select (LOCK gate) ────────────────────────────────────────────

export function FormationSelect({
  gameData,
  draftMode,
  ranked,
  onLocked,
}: {
  gameData: GameData;
  /** Run mode for the record being created. */
  draftMode: DraftMode;
  /** Hidden route hook: ranked drafts must use a server-issued seed. */
  ranked?: boolean;
  onLocked: (record: RunRecordV1, warning: string | null) => void;
}) {
  const defaultFormation: SupportedFormationId =
    SUPPORTED_FORMATION_OPTIONS[0]?.formation_id ?? "4-3-3";
  const [selected, setSelected] = useState<SupportedFormationId>(defaultFormation);
  const [pending, setPending] = useState<SupportedFormationId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eraPreset, setEraPreset] = useState<EraPresetId>("all_time");
  const [draftFlow, setDraftFlow] = useState<DraftFlow>("squad_first");
  const [ratingBasis, setRatingBasis] = useState<RatingBasis>("career");

  const lockIn = useCallback(
    async (formation_id: SupportedFormationId) => {
      setError(null);
      setPending(formation_id);
      try {
        let rankedAttempt: Awaited<ReturnType<typeof requestRankedAttempt>> | null = null;
        if (ranked === true) {
          if (draftMode === "open") {
            throw new Error("Open Draft is casual and does not issue ranked seeds.");
          }
          rankedAttempt = await requestRankedAttempt({
            formationId: formation_id,
            draftMode,
            draftOrder: draftFlow,
            era: eraPreset,
            ratingBasis,
          });
        }
        if (rankedAttempt !== null && !rankedAttempt.ok) {
          throw new Error(
            rankedAttempt.message ??
              (rankedAttempt.status === 401
                ? "Sign in before starting a ranked draft."
                : "Ranked draft seed could not be issued."),
          );
        }
        const created = createNewRunRecord(gameData, {
          formation_id,
          mode: draftMode,
          parent_seed: rankedAttempt?.attempt.parent_seed,
          ranked_attempt:
            rankedAttempt === null
              ? undefined
              : {
                  attempt_id: rankedAttempt.attempt.attempt_id,
                  season_key: rankedAttempt.attempt.season_key,
                  parent_seed: rankedAttempt.attempt.parent_seed,
                  expires_at: rankedAttempt.attempt.expires_at,
                },
          era_preset: eraPreset,
          draft_flow: draftFlow,
          rating_basis: ratingBasis,
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
    [gameData, draftMode, ranked, eraPreset, draftFlow, ratingBasis, onLocked],
  );

  return (
    <div className={s.draftShell}>
      <DraftAppBar spinNumber={null} progressPct={0} />
      <section className={s.formationSelect}>
        <div className={s.formationHead}>
          <Image src="/brand/wcdraft-lockup.svg" alt="wcdraft" width={240} height={60} priority />
          <h1 className={s.formationTitle}>Lock a formation</h1>
          <p className={s.formationSub}>
            Your shape is committed the moment you lock. 17 spins, one pick per spin — a player, or
            your manager. No rearranging afterwards.
          </p>
          {draftMode === "hidden" ? (
            <p className={s.memoryModeNote} role="note">
              Memory mode — names, flags and years stay visible; ratings and Synergy numbers hide
              until you simulate.
            </p>
          ) : null}
          {draftMode === "open" ? (
            <p className={s.memoryModeNote} role="note">
              {DRAFT_MODE_COPY.open.label} — {DRAFT_MODE_COPY.open.description} Casual, not ranked.
            </p>
          ) : null}
        </div>
        <DraftSetupDisclosure
          eraPreset={eraPreset}
          onEraPreset={setEraPreset}
          draftFlow={draftFlow}
          onDraftFlow={setDraftFlow}
          ratingBasis={ratingBasis}
          onRatingBasis={setRatingBasis}
          disabled={pending !== null}
        />
        <div className={s.formationGrid}>
          {/* ws-ux/mobile-polish-2: blurb prose dropped from the tile — at
              tile width it truncated mid-sentence ("…"), which added noise
              without information. The tile is shape-first: mini pitch +
              name + lock CTA. `FormationOption.blurb` stays in the data
              layer for surfaces with room for prose. */}
          {SUPPORTED_FORMATION_OPTIONS.map(({ formation_id: fid }) => {
            const active = selected === fid;
            return (
              <button
                key={fid}
                type="button"
                className={`${s.formationCard} ${active ? s.formationCardSelected : ""} ${
                  pending === fid ? s.formationCardPending : ""
                }`}
                aria-pressed={active}
                disabled={pending !== null}
                onClick={() => setSelected(fid)}
              >
                <MiniPitch formation_id={fid} />
                <div className={s.formationCardBody}>
                  <span className={s.formationCardName}>{fid}</span>
                  <span className={s.formationCardCta}>
                    {pending === fid ? "Locking…" : active ? "Selected" : "Lock this shape"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        {error ? <p className={s.formationError}>{error}</p> : null}
      </section>
      <div className={s.formationDock}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={pending !== null}
          onClick={() => lockIn(selected)}
        >
          {pending === selected ? "Locking…" : `Lock ${selected} & spin`}
        </button>
      </div>
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
