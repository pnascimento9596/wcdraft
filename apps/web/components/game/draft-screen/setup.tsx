import { useCallback, useState } from "react";
import Link from "next/link";
import {
  ERA_PRESET_IDS,
  isRankedDraftMode,
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
import { useUnsafeMutationLatch } from "@/lib/unsafe-mutation";
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

type DraftLane = "casual" | "ranked";

type FormationError = {
  readonly message: string;
  readonly action?: {
    readonly href: string;
    readonly label: string;
  };
};

function rankedDraftReturnPath(draftMode: DraftMode): string {
  return draftMode === "hidden" ? "/play/draft?mode=hidden&lane=ranked" : "/play/draft?lane=ranked";
}

/**
 * The rating bases the setup control offers, in display order. EXPORTED as the
 * control-of-record so a test can pin it against the bases actually present in
 * the served runtime bundle — the UI can never silently lag (or lead) the data.
 */
export const SETUP_RATING_BASES = ["career", "current"] as const satisfies readonly RatingBasis[];

function DraftSetupDisclosure({
  lane,
  onLane,
  rankedCapable,
  eraPreset,
  onEraPreset,
  draftFlow,
  onDraftFlow,
  ratingBasis,
  onRatingBasis,
  disabled,
}: {
  lane: DraftLane;
  onLane: (lane: DraftLane) => void;
  rankedCapable: boolean;
  eraPreset: EraPresetId;
  onEraPreset: (p: EraPresetId) => void;
  draftFlow: DraftFlow;
  onDraftFlow: (f: DraftFlow) => void;
  ratingBasis: RatingBasis;
  onRatingBasis: (b: RatingBasis) => void;
  disabled: boolean;
}) {
  // Owner note: the setup axes must be visible on arrival. The control still
  // collapses on demand, but it no longer hides the play type / Era / Draft
  // mode / Rating basis choices by default on mobile.
  const [open, setOpen] = useState(true);
  // Summary mirrors every visible setup axis.
  const summaryParts = [
    ...(rankedCapable ? [lane === "ranked" ? "Ranked" : "Casual"] : []),
    `${DRAFT_FLOW_LABELS[draftFlow]} · ${RATING_BASIS_LABELS[ratingBasis]}`,
    ERA_PRESET_LABELS[eraPreset],
  ] as const;
  const summary = summaryParts.join(" · ");
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
          {rankedCapable ? (
            <div className={s.setupAxis}>
              <span className={s.setupAxisLabel}>Play type</span>
              <div className={s.setupSeg} role="group" aria-label="Play type">
                {(["casual", "ranked"] as const).map((nextLane) => (
                  <button
                    key={nextLane}
                    type="button"
                    className={`${s.setupSegBtn} ${lane === nextLane ? s.setupSegBtnActive : ""}`}
                    aria-pressed={lane === nextLane}
                    disabled={disabled}
                    onClick={() => onLane(nextLane)}
                  >
                    {nextLane === "casual" ? "Casual" : "Ranked"}
                  </button>
                ))}
              </div>
              <p className={s.setupAxisNote}>
                {lane === "ranked"
                  ? "Ranked requests an account-bound server seed when you lock a formation. Sign in and verify your email first."
                  : "Casual by default — start immediately, then post to the Casual board after the run."}
              </p>
            </div>
          ) : null}
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
  initialRanked,
  onLocked,
}: {
  gameData: GameData;
  /** Run mode for the record being created. */
  draftMode: DraftMode;
  /** Backward-compatible URL state; the visible setup choice is authoritative. */
  initialRanked?: boolean;
  onLocked: (record: RunRecordV1, warning: string | null) => void;
}) {
  const defaultFormation: SupportedFormationId =
    SUPPORTED_FORMATION_OPTIONS[0]?.formation_id ?? "4-3-3";
  const [selected, setSelected] = useState<SupportedFormationId>(defaultFormation);
  const [pending, setPending] = useState<SupportedFormationId | null>(null);
  const [error, setError] = useState<FormationError | null>(null);
  const rankedIssuance = useUnsafeMutationLatch();
  const rankedCapable = isRankedDraftMode(draftMode);
  const [lane, setLane] = useState<DraftLane>(
    rankedCapable && initialRanked === true ? "ranked" : "casual",
  );
  const [eraPreset, setEraPreset] = useState<EraPresetId>("all_time");
  const [draftFlow, setDraftFlow] = useState<DraftFlow>("squad_first");
  const [ratingBasis, setRatingBasis] = useState<RatingBasis>("career");

  const lockIn = useCallback(
    async (formation_id: SupportedFormationId) => {
      if (lane === "ranked" && !rankedIssuance.begin()) return;
      setError(null);
      setPending(formation_id);
      let rankedAttemptIssued = false;
      try {
        let rankedAttempt: Awaited<ReturnType<typeof requestRankedAttempt>> | null = null;
        if (lane === "ranked") {
          if (!isRankedDraftMode(draftMode)) {
            throw new Error(
              `${DRAFT_MODE_COPY[draftMode].label} is casual and does not issue ranked seeds.`,
            );
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
          if (rankedAttempt.outcomeUnknown) {
            rankedIssuance.markOutcomeUnknown();
            setPending(null);
            setError({
              message: `${rankedAttempt.message ?? "The ranked seed request ended before the server confirmed it."} This configuration is locked for this page; check your account or choose another mode.`,
            });
            return;
          }
          rankedIssuance.settle();
          const needsSignIn =
            rankedAttempt.code === "AUTH_REQUIRED" || rankedAttempt.status === 401;
          const needsVerification = rankedAttempt.code === "VERIFICATION_REQUIRED";
          setError({
            message:
              rankedAttempt.message ??
              (needsSignIn
                ? "Sign in before starting a ranked draft."
                : needsVerification
                  ? "Verify your email before starting a ranked draft."
                  : "Ranked setup is unavailable right now. Your formation is still selected; try again or switch to Casual."),
            action: needsSignIn
              ? {
                  href: `/sign-in?next=${encodeURIComponent(rankedDraftReturnPath(draftMode))}`,
                  label: "Sign in",
                }
              : needsVerification
                ? { href: "/account?verify=1", label: "Resend verification" }
                : undefined,
          });
          setPending(null);
          return;
        }
        if (rankedAttempt !== null) {
          rankedAttemptIssued = true;
          rankedIssuance.markCommitted();
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
        if (lane === "ranked") rankedIssuance.settle();
        if (rankedAttemptIssued) {
          setError({
            message:
              "The ranked seed was issued, but this draft could not start locally. This configuration remains locked; check your account or choose another mode.",
          });
        } else {
          const d = describeGameError(err);
          setError({ message: `${d.title}: ${d.message}` });
        }
        setPending(null);
      }
    },
    [gameData, draftMode, lane, eraPreset, draftFlow, ratingBasis, onLocked, rankedIssuance],
  );

  const locked = pending !== null || rankedIssuance.locked;

  return (
    <div className={s.draftShell}>
      <DraftAppBar spinNumber={null} progressPct={0} />
      <section className={s.formationSelect}>
        <div className={s.formationHead}>
          <h1 className={s.formationTitle}>Lock a formation</h1>
          <p className={s.formationSub}>
            Your shape is committed the moment you lock. 17 spins, one pick per spin — a player, or
            your manager. No rearranging afterwards.
          </p>
          {draftMode !== "classic" ? (
            <p className={s.memoryModeNote} role="note">
              {DRAFT_MODE_COPY[draftMode].label} — {DRAFT_MODE_COPY[draftMode].description}
            </p>
          ) : null}
        </div>
        <DraftSetupDisclosure
          lane={lane}
          onLane={(nextLane) => {
            setLane(nextLane);
            setError(null);
          }}
          rankedCapable={rankedCapable}
          eraPreset={eraPreset}
          onEraPreset={setEraPreset}
          draftFlow={draftFlow}
          onDraftFlow={setDraftFlow}
          ratingBasis={ratingBasis}
          onRatingBasis={setRatingBasis}
          disabled={locked}
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
                disabled={locked}
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
        {error ? (
          <div className={s.formationError} role="alert">
            <span>{error.message}</span>
            {error.action ? (
              <Link href={error.action.href} className="btn btn--ghost">
                {error.action.label}
              </Link>
            ) : null}
            {rankedIssuance.outcomeUnknown || rankedIssuance.phase === "committed" ? (
              <p>
                <Link href="/account">Check account</Link>
                {" · "}
                <Link href="/play">Choose another mode</Link>
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
      <div className={s.formationDock}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={locked}
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
