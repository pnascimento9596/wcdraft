"use client";

// F-4 U4 — submit affordance container (results screen, post-sim only).
//
// Renders nothing unless (a) the run is complete and simulated locally
// (callers only mount it then), (b) the client's own `versionsAgree` passes
// against its loaded bundle — a skewed run gets NO affordance (absent, not
// disabled), and (c) the page is leaderboard-enabled (server-gated prop;
// no NEXT_PUBLIC_ mirror). Local conveniences: last-used display name and
// submitted-token memory in localStorage (best-effort, never load-bearing —
// the server's duplicate handling is the truth).

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-context";
import { putJson } from "@/lib/auth/client";
import type { GameData } from "@/lib/game/data";
import { utcDateString } from "@/lib/game/daily";
import type { RunRecordV1 } from "@/lib/game/run-record";
import { buildRunTokenBody, encodeRunToken, versionsAgree } from "@/lib/game/run-token";
import { boardQueryString, type BoardFilter } from "@/lib/leaderboard/board-view";
import { validateDisplayName, type DisplayNameRejection } from "@/lib/leaderboard/display-name";
import { submitRun } from "@/lib/leaderboard/client";
import { NAME_HINT, submitStatusCopy } from "@/lib/leaderboard/submit-copy";
import {
  IDLE,
  loadLastDisplayName,
  rememberTokenSubmitted,
  saveLastDisplayName,
  wasTokenSubmitted,
  type SubmitBoardMode,
  type SubmitPhase,
} from "@/lib/leaderboard/submit-state";

import { SubmitPanelView } from "./submit-panel-views";

export function LeaderboardSubmitPanel({
  gameData,
  record,
}: {
  gameData: GameData;
  record: RunRecordV1;
}) {
  const sim = record.simulation ?? null;
  const token = useMemo(() => {
    if (sim === null) return null;
    const body = buildRunTokenBody(record);
    if (!versionsAgree(body, gameData.versions)) return null;
    return encodeRunToken(record);
  }, [record, gameData.versions, sim]);

  const [phase, setPhase] = useState<SubmitPhase>(IDLE);
  const [submitMode, setSubmitMode] = useState<SubmitBoardMode>(() =>
    record.ranked_attempt ? "ranked" : "casual",
  );
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [retryRemaining, setRetryRemaining] = useState<number | null>(null);
  const { ready: authReady, isSignedIn, session, refresh } = useAuth();
  const publicUsername = isSignedIn ? (session?.username ?? null) : null;
  const dailyChallenge = record.challenge?.kind === "daily" ? record.challenge : null;
  const rankedAttemptId = record.ranked_attempt?.attempt_id ?? null;
  const effectiveSubmitMode: SubmitBoardMode = dailyChallenge === null ? submitMode : "casual";
  const dailyOpen = dailyChallenge === null || dailyChallenge.date === utcDateString();

  useEffect(() => {
    setSubmitMode(rankedAttemptId === null ? "casual" : "ranked");
  }, [record.run_id, rankedAttemptId]);

  // Local memory — read in an effect so SSR/hydration stay byte-stable.
  useEffect(() => {
    if (token === null) return;
    setName((n) => (n.length > 0 ? n : loadLastDisplayName()));
  }, [token]);

  useEffect(() => {
    if (token === null) return;
    setPhase(wasTokenSubmitted(token, effectiveSubmitMode) ? { kind: "submitted-earlier" } : IDLE);
    setRetryRemaining(null);
  }, [token, effectiveSubmitMode]);

  // RATE_LIMITED: respect Retry-After with a live countdown; the submit
  // button stays disabled until it elapses.
  useEffect(() => {
    if (
      phase.kind === "rejected" &&
      phase.code === "RATE_LIMITED" &&
      phase.retryAfterSeconds !== null
    ) {
      setRetryRemaining(phase.retryAfterSeconds);
      const iv = setInterval(() => {
        setRetryRemaining((prev) => (prev !== null && prev > 1 ? prev - 1 : null));
      }, 1000);
      return () => clearInterval(iv);
    }
    setRetryRemaining(null);
    return undefined;
  }, [phase]);

  if (sim === null || token === null) return null;
  const score = sim.run.score;
  const leaderboardHref = leaderboardHrefForRecord(record, effectiveSubmitMode);

  const preparedName = preparePublicName({ mode: effectiveSubmitMode, raw: name, publicUsername });
  const nameHint = touched && !preparedName.ok ? NAME_HINT[preparedName.reason] : null;

  const onSubmit = () => {
    if (phase.kind === "submitting") return;
    if (!dailyOpen) {
      setPhase({
        kind: "rejected",
        code: "BAD_ATTEMPT",
        copy: submitStatusCopy("BAD_ATTEMPT"),
        nameHint: null,
        retryAfterSeconds: null,
      });
      return;
    }
    if (effectiveSubmitMode === "ranked" && (!authReady || !isSignedIn)) {
      setPhase(rankedAuthRequiredPhase());
      return;
    }
    if (!preparedName.ok) {
      setTouched(true);
      return;
    }
    setPhase({ kind: "submitting" });
    void submitAfterProfile({
      token,
      score,
      mode: effectiveSubmitMode,
      draftMode: record.draft.mode,
      displayName: preparedName.value,
      challenge: dailyChallenge === null ? "season" : "daily",
      challengeDate: dailyChallenge?.date ?? null,
      needsUsername: effectiveSubmitMode === "ranked" && isSignedIn && publicUsername === null,
      refresh,
    }).then((outcome) => {
      if (outcome.kind === "accepted" || outcome.kind === "duplicate") {
        rememberTokenSubmitted(token, effectiveSubmitMode);
        if (preparedName.value !== null) saveLastDisplayName(preparedName.value);
      }
      setPhase(outcome);
    });
  };

  return (
    <SubmitPanelView
      score={score}
      draftMode={record.draft.mode}
      submitMode={effectiveSubmitMode}
      authReady={authReady}
      isSignedIn={isSignedIn}
      publicUsername={publicUsername}
      challengeKind={dailyChallenge === null ? "season" : "daily"}
      dailyOpen={dailyOpen}
      leaderboardHref={leaderboardHref}
      name={name}
      nameHint={nameHint}
      phase={phase}
      retryRemaining={retryRemaining}
      onModeChange={(mode) => {
        setTouched(false);
        setSubmitMode(mode);
      }}
      onNameChange={(v) => {
        setTouched(true);
        setName(v);
      }}
      onSubmit={onSubmit}
    />
  );
}

function leaderboardHrefForRecord(record: RunRecordV1, lane: SubmitBoardMode): string {
  if (record.challenge?.kind === "daily") {
    const q = new URLSearchParams({ challenge: "daily", date: record.challenge.date });
    return `/leaderboard?${q.toString()}`;
  }
  const filter: BoardFilter = {
    challenge: "season",
    lane,
    draftMode: record.draft.mode,
    draftOrder: record.draft.draft_flow ?? "squad_first",
    era: record.draft.era_preset ?? "all_time",
    ratingBasis: record.draft.rating_basis ?? "career",
  };
  return `/leaderboard${boardQueryString({ filter, cursor: null })}`;
}

type PreparedPublicName =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly reason: DisplayNameRejection };

function preparePublicName({
  mode,
  raw,
  publicUsername,
}: {
  mode: SubmitBoardMode;
  raw: string;
  publicUsername: string | null;
}): PreparedPublicName {
  if (mode === "ranked" && publicUsername !== null && raw.trim() === "") {
    return { ok: true, value: null };
  }
  const checked = validateDisplayName(raw);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  return { ok: true, value: checked.name };
}

function rankedAuthRequiredPhase(): SubmitPhase {
  return {
    kind: "rejected",
    code: "AUTH_REQUIRED",
    copy: submitStatusCopy("AUTH_REQUIRED"),
    nameHint: null,
    retryAfterSeconds: null,
  };
}

type ProfileUpdateBody = {
  readonly profile?: { readonly username?: unknown };
  readonly error?: unknown;
  readonly username_reason?: unknown;
};

async function submitAfterProfile({
  token,
  score,
  mode,
  draftMode,
  displayName,
  challenge,
  challengeDate,
  needsUsername,
  refresh,
}: {
  token: string;
  score: number;
  mode: SubmitBoardMode;
  draftMode: "classic" | "hidden";
  displayName: string | null;
  challenge: "season" | "daily";
  challengeDate: string | null;
  needsUsername: boolean;
  refresh: () => Promise<void>;
}): Promise<SubmitPhase> {
  let aliasForEntry = displayName;
  if (needsUsername) {
    if (displayName === null) return rankedAuthRequiredPhase();
    const profile = await putJson<ProfileUpdateBody>("/api/profile", { username: displayName });
    if (!profile.ok) {
      if (profile.status === 401) return rankedAuthRequiredPhase();
      const reason =
        typeof profile.data?.username_reason === "string"
          ? (NAME_HINT[profile.data.username_reason as DisplayNameRejection] ?? null)
          : profile.status === 409
            ? "That username is already taken."
            : null;
      if (reason !== null) {
        return {
          kind: "rejected",
          code: "INVALID_NAME",
          copy: submitStatusCopy("INVALID_NAME"),
          nameHint: reason,
          retryAfterSeconds: null,
        };
      }
      return { kind: "unreachable" };
    }
    aliasForEntry = null;
    await refresh();
  }

  return submitRun({
    token,
    claimedScore: score,
    mode,
    draftMode,
    displayName: aliasForEntry,
    challenge,
    challengeDate,
  });
}
