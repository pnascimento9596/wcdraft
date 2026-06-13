// F-4 U4 — pure submit-affordance view (no "use client": stateless, consumed
// by the client container and string-rendered by tests).
//
// Every visible outcome string maps 1:1 to a server response through the
// single-sourced status table (submit-copy.ts) — no invented intermediate
// states, no optimistic rank. The score shown is the engine's own
// `run.score` from the local simulation; the SERVER's verdict decides what
// lands on the board.

import Link from "next/link";

import type { SubmitBoardMode, SubmitPhase } from "@/lib/leaderboard/submit-state";

import s from "./leaderboard.module.css";

export interface SubmitPanelViewProps {
  /** Engine score of the local run (the value being claimed). */
  score: number;
  draftMode: "classic" | "hidden";
  submitMode: SubmitBoardMode;
  authReady: boolean;
  isSignedIn: boolean;
  publicUsername: string | null;
  name: string;
  /** Live U2-mirror hint; null when the name is fine or untouched. */
  nameHint: string | null;
  phase: SubmitPhase;
  /** RATE_LIMITED countdown (seconds left); null otherwise. */
  retryRemaining: number | null;
  onModeChange: (mode: SubmitBoardMode) => void;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
}

/** Phases that keep the form on screen for another attempt. */
function formVisible(phase: SubmitPhase): boolean {
  return (
    phase.kind === "idle" ||
    phase.kind === "submitting" ||
    phase.kind === "rejected" ||
    phase.kind === "unreachable"
  );
}

export function SubmitPanelView(props: SubmitPanelViewProps) {
  const { phase } = props;
  const rankedSelected = props.submitMode === "ranked";
  const rankedAuthBlocked = rankedSelected && (!props.authReady || !props.isSignedIn);
  const needsUsername = rankedSelected && props.isSignedIn && props.publicUsername === null;
  const aliasOptional = rankedSelected && props.isSignedIn && props.publicUsername !== null;
  const inputId = needsUsername ? "lb-username" : "lb-display-name";
  const inputLabel = needsUsername ? "Username" : "Display alias";
  const inputPlaceholder = needsUsername
    ? "Username (3-20 chars: a-z, 0-9, _)"
    : aliasOptional
      ? "Optional alias (3-20 chars)"
      : "Alias (3-20 chars: a-z, 0-9, _)";
  const submitDisabled =
    phase.kind === "submitting" || props.retryRemaining !== null || rankedAuthBlocked;
  return (
    <section className={s.submitPanel} aria-label="Post to the leaderboard">
      <div className={s.submitHead}>
        <h2 className={s.submitTitle}>Leaderboard</h2>
        <span className={s.submitScore}>
          <span className={s.submitScoreNum}>{props.score}</span>pts ·{" "}
          <span className={props.draftMode === "hidden" ? `${s.badge} ${s.badgeHidden}` : s.badge}>
            {props.draftMode === "hidden" ? "Memory" : "Classic"}
          </span>
        </span>
      </div>

      <div className={s.submitModeRow}>
        <div className="segmented" role="group" aria-label="Leaderboard lane">
          <button
            type="button"
            aria-pressed={props.submitMode === "casual"}
            disabled={phase.kind === "submitting"}
            onClick={() => props.onModeChange("casual")}
          >
            Casual
          </button>
          <button
            type="button"
            aria-pressed={props.submitMode === "ranked"}
            disabled={phase.kind === "submitting"}
            onClick={() => props.onModeChange("ranked")}
          >
            Ranked
          </button>
        </div>
        <SubmitModeNote
          mode={props.submitMode}
          authReady={props.authReady}
          isSignedIn={props.isSignedIn}
          publicUsername={props.publicUsername}
        />
      </div>

      {formVisible(phase) && (
        <>
          <div className={s.nameRow}>
            <div className={s.nameField}>
              <label className="visually-hidden" htmlFor={inputId}>
                {inputLabel}
              </label>
              <input
                id={inputId}
                className={s.nameInput}
                value={props.name}
                maxLength={48}
                placeholder={inputPlaceholder}
                autoComplete="nickname"
                onChange={(e) => props.onNameChange(e.target.value)}
                disabled={phase.kind === "submitting" || rankedAuthBlocked}
              />
              {props.nameHint !== null && (
                <span className={s.nameHint} role="status">
                  {props.nameHint}
                </span>
              )}
            </div>
            <button
              type="button"
              className={`btn btn--primary ${s.submitBtn}`}
              onClick={props.onSubmit}
              disabled={submitDisabled}
            >
              {phase.kind === "submitting"
                ? "Submitting…"
                : rankedSelected
                  ? "Post ranked run"
                  : "Post casual run"}
            </button>
          </div>
          <p className={s.submitFine}>
            The server replays and re-simulates the run before anything is posted.
          </p>
        </>
      )}

      <SubmitOutcome phase={phase} retryRemaining={props.retryRemaining} />
    </section>
  );
}

function SubmitModeNote({
  mode,
  authReady,
  isSignedIn,
  publicUsername,
}: {
  mode: SubmitBoardMode;
  authReady: boolean;
  isSignedIn: boolean;
  publicUsername: string | null;
}) {
  if (mode === "casual") {
    return <p className={s.submitModeNote}>Casual runs stay shareable.</p>;
  }
  if (!authReady) {
    return <p className={s.submitModeNote}>Checking account…</p>;
  }
  if (!isSignedIn) {
    return (
      <p className={s.submitModeNote}>
        Sign in to post ranked runs — casual runs stay shareable.{" "}
        <Link href="/sign-in">Sign in</Link>
      </p>
    );
  }
  if (publicUsername !== null) {
    return (
      <p className={s.submitModeNote}>
        Posting as <span className="mono">{publicUsername}</span>. Optional alias applies to this
        run only.
      </p>
    );
  }
  return <p className={s.submitModeNote}>Choose a username for ranked.</p>;
}

function SubmitOutcome({
  phase,
  retryRemaining,
}: {
  phase: SubmitPhase;
  retryRemaining: number | null;
}) {
  if (phase.kind === "idle" || phase.kind === "submitting") return null;

  if (phase.kind === "accepted") {
    return (
      <div className={s.outcome} role="status">
        <p className={`${s.outcomeTitle} ${s.outcomeTitleGood}`}>On the board</p>
        {phase.rank !== null ? (
          <p className={s.outcomeRank}>Rank #{phase.rank}</p>
        ) : (
          <p className={s.outcomeMsg}>Posted — your rank will show on the board.</p>
        )}
        <Link href="/leaderboard" className="btn btn--ghost">
          View leaderboard
        </Link>
      </div>
    );
  }

  if (phase.kind === "duplicate") {
    return (
      <div className={s.outcome} role="status">
        <p className={s.outcomeTitle}>Already on the board</p>
        <p className={s.outcomeMsg}>
          This exact run was posted before
          {phase.rank !== null ? ` — your best sits at rank #${phase.rank}.` : "."}
        </p>
        <Link href="/leaderboard" className="btn btn--ghost">
          View leaderboard
        </Link>
      </div>
    );
  }

  if (phase.kind === "submitted-earlier") {
    return (
      <div className={s.outcome} role="status">
        <p className={s.outcomeTitle}>Posted from this device</p>
        <p className={s.outcomeMsg}>This run was already submitted to the board.</p>
        <Link href="/leaderboard" className="btn btn--ghost">
          View leaderboard
        </Link>
      </div>
    );
  }

  if (phase.kind === "unreachable") {
    return (
      <div className={s.outcome} role="alert">
        <p className={`${s.outcomeTitle} ${s.outcomeTitleBad}`}>Couldn&rsquo;t reach the server</p>
        <p className={s.outcomeMsg}>Nothing was posted. Check your connection and try again.</p>
      </div>
    );
  }

  // rejected — copy from the single-sourced status table.
  return (
    <div className={s.outcome} role="alert">
      <p className={`${s.outcomeTitle} ${s.outcomeTitleBad}`}>{phase.copy.title}</p>
      <p className={s.outcomeMsg}>{phase.copy.message}</p>
      {phase.nameHint !== null && <p className={s.outcomeMsg}>{phase.nameHint}</p>}
      {phase.code === "RATE_LIMITED" && retryRemaining !== null && (
        <p className={s.outcomeMsg} data-testid="retry-after">
          Try again in {retryRemaining}s.
        </p>
      )}
      {phase.code === "AUTH_REQUIRED" && (
        <Link href="/sign-in" className="btn btn--ghost">
          Sign in
        </Link>
      )}
    </div>
  );
}
