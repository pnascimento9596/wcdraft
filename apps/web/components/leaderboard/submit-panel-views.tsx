// F-4 U4 — pure submit-affordance view (no "use client": stateless, consumed
// by the client container and string-rendered by tests).
//
// Every visible outcome string maps 1:1 to a server response through the
// single-sourced status table (submit-copy.ts) — no invented intermediate
// states, no optimistic rank. The score shown is the engine's own
// `run.score` from the local simulation; the SERVER's verdict decides what
// lands on the board.

import Link from "next/link";

import { draftModeLaneLabel } from "@/lib/leaderboard/config";
import type { SubmitBoardMode, SubmitPhase } from "@/lib/leaderboard/submit-state";
import {
  dailyLeaderboardStandingText,
  leaderboardStandingText,
} from "@/lib/leaderboard/standing-copy";

import s from "./leaderboard.module.css";

export interface SubmitPanelViewProps {
  /** Engine score of the local run (the value being claimed). */
  score: number;
  draftMode: "classic" | "hidden";
  submitMode: SubmitBoardMode;
  authReady: boolean;
  isSignedIn: boolean;
  publicUsername: string | null;
  emailVerified?: boolean;
  challengeKind?: "season" | "daily";
  dailyOpen?: boolean;
  /** Seed-disclosed friend challenges can only use the casual lane. */
  casualOnly?: boolean;
  leaderboardHref: string;
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
  return phase.kind === "idle" || phase.kind === "submitting" || phase.kind === "rejected";
}

export function SubmitPanelView(props: SubmitPanelViewProps) {
  const { phase } = props;
  const rankedSelected = props.submitMode === "ranked";
  const daily = props.challengeKind === "daily";
  const casualOnly = props.casualOnly === true;
  const dailyOpen = props.dailyOpen ?? true;
  const rankedAuthBlocked = rankedSelected && (!props.authReady || !props.isSignedIn);
  const rankedVerificationBlocked =
    rankedSelected && props.isSignedIn && props.emailVerified === false;
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
    phase.kind === "submitting" ||
    props.retryRemaining !== null ||
    rankedAuthBlocked ||
    rankedVerificationBlocked ||
    !dailyOpen;
  return (
    <section className={s.submitPanel} aria-label="Post to the leaderboard">
      <div className={s.submitHead}>
        <h2 className={s.submitTitle}>Leaderboard</h2>
        <span className={s.submitScore}>
          <span className={s.submitScoreNum}>{props.score}</span>pts ·{" "}
          <span className={props.draftMode === "hidden" ? `${s.badge} ${s.badgeHidden}` : s.badge}>
            {draftModeLaneLabel(props.draftMode)}
          </span>
        </span>
      </div>

      <div className={s.submitModeRow}>
        {daily ? (
          <p className={s.submitModeNote}>
            {dailyOpen
              ? "Daily board · anonymous posting open today"
              : "Daily board · submissions closed for this date"}
          </p>
        ) : casualOnly ? (
          <p className={s.submitModeNote}>Friend challenge · Casual board only</p>
        ) : (
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
        )}
        <SubmitModeNote
          mode={props.submitMode}
          challengeKind={props.challengeKind ?? "season"}
          authReady={props.authReady}
          isSignedIn={props.isSignedIn}
          emailVerified={props.emailVerified !== false}
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
                : daily
                  ? "Post daily score"
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

      <SubmitOutcome
        phase={phase}
        retryRemaining={props.retryRemaining}
        leaderboardHref={props.leaderboardHref}
        challengeKind={props.challengeKind ?? "season"}
      />
    </section>
  );
}

function SubmitModeNote({
  mode,
  challengeKind,
  authReady,
  isSignedIn,
  emailVerified,
  publicUsername,
}: {
  mode: SubmitBoardMode;
  challengeKind: "season" | "daily";
  authReady: boolean;
  isSignedIn: boolean;
  emailVerified: boolean;
  publicUsername: string | null;
}) {
  if (challengeKind === "daily") return null;
  if (mode === "casual") {
    return (
      <p className={s.submitModeNote}>Casual posts anonymously; sign in later to claim the run.</p>
    );
  }
  if (!authReady) {
    return <p className={s.submitModeNote}>Checking account…</p>;
  }
  if (!isSignedIn) {
    return (
      <p className={s.submitModeNote}>
        Sign in to post ranked runs. Casual posts anonymously and can be claimed later.{" "}
        <Link href="/sign-in">Sign in</Link>
      </p>
    );
  }
  if (!emailVerified) {
    return (
      <p className={s.submitModeNote}>
        Verify your email to post ranked runs.{" "}
        <Link href="/account?verify=1">Resend verification</Link>
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
  leaderboardHref,
  challengeKind,
}: {
  phase: SubmitPhase;
  retryRemaining: number | null;
  leaderboardHref: string;
  challengeKind: "season" | "daily";
}) {
  if (phase.kind === "idle" || phase.kind === "submitting") return null;

  if (phase.kind === "accepted") {
    return (
      <div className={s.outcome} role="status">
        <p className={`${s.outcomeTitle} ${s.outcomeTitleGood}`}>On the board</p>
        {phase.rank !== null ? (
          <p className={s.outcomeRank}>{standingText(phase, challengeKind)}</p>
        ) : (
          <p className={s.outcomeMsg}>Posted — your rank will show on the board.</p>
        )}
        <Link href={leaderboardHref} className="btn btn--ghost">
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
          {phase.rank !== null
            ? ` — your best sits at ${standingText(phase, challengeKind)}.`
            : "."}
        </p>
        <Link href={leaderboardHref} className="btn btn--ghost">
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
        <Link href={leaderboardHref} className="btn btn--ghost">
          View leaderboard
        </Link>
      </div>
    );
  }

  if (phase.kind === "unreachable") {
    return (
      <div className={s.outcome} role="alert">
        <p className={`${s.outcomeTitle} ${s.outcomeTitleBad}`}>Couldn&rsquo;t reach the server</p>
        <p className={s.outcomeMsg}>
          No server verdict came back. Check the leaderboard before submitting this run again.
        </p>
        <Link href={leaderboardHref} className="btn btn--ghost">
          Check leaderboard
        </Link>
      </div>
    );
  }

  if (phase.kind === "timeout") {
    return (
      <div className={s.outcome} role="alert">
        <p className={`${s.outcomeTitle} ${s.outcomeTitleBad}`}>The post timed out</p>
        <p className={s.outcomeMsg}>
          The outcome is unknown and the run may already be on the board. Check the leaderboard
          before submitting it again.
        </p>
        <Link href={leaderboardHref} className="btn btn--ghost">
          Check leaderboard
        </Link>
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
      {phase.code === "VERIFICATION_REQUIRED" && (
        <Link href="/account?verify=1" className="btn btn--ghost">
          Verify email
        </Link>
      )}
    </div>
  );
}

function standingText(
  phase: {
    readonly rank: number | null;
    readonly percentile: number | null;
    readonly fieldSize: number;
  },
  challengeKind: "season" | "daily",
): string {
  return challengeKind === "daily"
    ? dailyLeaderboardStandingText(phase)
    : leaderboardStandingText(phase);
}
