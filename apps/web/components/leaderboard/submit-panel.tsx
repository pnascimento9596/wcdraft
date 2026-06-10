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

import type { GameData } from "@/lib/game/data";
import type { RunRecordV1 } from "@/lib/game/run-record";
import { buildRunTokenBody, encodeRunToken, versionsAgree } from "@/lib/game/run-token";
import { validateDisplayName } from "@/lib/leaderboard/display-name";
import { submitRun } from "@/lib/leaderboard/client";
import { NAME_HINT } from "@/lib/leaderboard/submit-copy";
import {
  IDLE,
  loadLastDisplayName,
  rememberTokenSubmitted,
  saveLastDisplayName,
  wasTokenSubmitted,
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
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [retryRemaining, setRetryRemaining] = useState<number | null>(null);

  // Local memory — read in an effect so SSR/hydration stay byte-stable.
  useEffect(() => {
    if (token === null) return;
    setName((n) => (n.length > 0 ? n : loadLastDisplayName()));
    if (wasTokenSubmitted(token)) setPhase({ kind: "submitted-earlier" });
  }, [token]);

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

  const nameCheck = validateDisplayName(name);
  const nameHint = touched && !nameCheck.ok ? NAME_HINT[nameCheck.reason] : null;

  const onSubmit = () => {
    if (phase.kind === "submitting") return;
    if (!nameCheck.ok) {
      setTouched(true);
      return;
    }
    setPhase({ kind: "submitting" });
    void submitRun({
      token,
      claimedScore: score,
      displayName: nameCheck.name,
    }).then((outcome) => {
      if (outcome.kind === "accepted" || outcome.kind === "duplicate") {
        rememberTokenSubmitted(token);
        saveLastDisplayName(nameCheck.name);
      }
      setPhase(outcome);
    });
  };

  return (
    <SubmitPanelView
      score={score}
      draftMode={record.draft.mode}
      name={name}
      nameHint={nameHint}
      phase={phase}
      retryRemaining={retryRemaining}
      onNameChange={(v) => {
        setTouched(true);
        setName(v);
      }}
      onSubmit={onSubmit}
    />
  );
}
