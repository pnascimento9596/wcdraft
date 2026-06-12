// F-4 U4 — pure submit-affordance view (no "use client": stateless, consumed
// by the client container and string-rendered by tests).
//
// Every visible outcome string maps 1:1 to a server response through the
// single-sourced status table (submit-copy.ts) — no invented intermediate
// states, no optimistic rank. The score shown is the engine's own
// `run.score` from the local simulation; the SERVER's verdict decides what
// lands on the board.

import Link from "next/link";

import type { SubmitPhase } from "@/lib/leaderboard/submit-state";

import s from "./leaderboard.module.css";

export interface SubmitPanelViewProps {
  /** Engine score of the local run (the value being claimed). */
  score: number;
  draftMode: "classic" | "hidden";
  name: string;
  /** Live U2-mirror hint; null when the name is fine or untouched. */
  nameHint: string | null;
  phase: SubmitPhase;
  /** RATE_LIMITED countdown (seconds left); null otherwise. */
  retryRemaining: number | null;
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

      {formVisible(phase) && (
        <>
          <div className={s.nameRow}>
            <div className={s.nameField}>
              <label className="visually-hidden" htmlFor="lb-display-name">
                Display name
              </label>
              <input
                id="lb-display-name"
                className={s.nameInput}
                value={props.name}
                maxLength={48}
                placeholder="Alias (3-20 chars: a-z, 0-9, _)"
                autoComplete="nickname"
                onChange={(e) => props.onNameChange(e.target.value)}
                disabled={phase.kind === "submitting"}
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
              disabled={phase.kind === "submitting" || props.retryRemaining !== null}
            >
              {phase.kind === "submitting" ? "Submitting…" : "Post to leaderboard"}
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
