"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { boundedRequest } from "@wcdraft/data/client";
import {
  buildFriendChallengeShareCopy,
  buildFriendChallengeUrl,
  type FriendChallengeRef,
} from "@/lib/game/friend-challenge";
import type { RunRecordV1 } from "@/lib/game/run-record";
import { encodeRunToken } from "@/lib/game/run-token";

type State =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "copied" }
  | { kind: "error"; message: string };
const CHALLENGE_PROOF_BUDGET_MS = 4_000;

export function ChallengeFriendButton({
  record,
  proof = null,
  className = "btn btn--ghost",
}: {
  record: RunRecordV1;
  proof?: string | null;
  className?: string;
}) {
  const token = useMemo(() => {
    try {
      return encodeRunToken(record);
    } catch {
      return null;
    }
  }, [record]);
  const [state, setState] = useState<State>({ kind: "idle" });
  const requestController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      requestController.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (state.kind !== "copied") return;
    const reset = window.setTimeout(() => setState({ kind: "idle" }), 2_000);
    return () => window.clearTimeout(reset);
  }, [state.kind]);

  async function copyChallengeLink() {
    if (state.kind === "pending" || token === null) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setState({ kind: "pending" });
    try {
      const challengeProof = proof ?? (await requestChallengeProof(token, controller.signal));
      if (controller.signal.aborted) return;
      if (!challengeProof) {
        setState({
          kind: "error",
          message:
            record.challenge?.kind === "daily"
              ? "This Daily board is outside current challenge coverage."
              : "Challenge verification is unavailable. Try again.",
        });
        return;
      }
      const ref: FriendChallengeRef = { token, proof: challengeProof };
      const url = buildFriendChallengeUrl(
        window.location.origin,
        ref,
        record.challenge?.kind === "daily" ? record.challenge.date : null,
      );
      await navigator.clipboard.writeText(buildFriendChallengeShareCopy(url));
      if (controller.signal.aborted) return;
      setState({ kind: "copied" });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        kind: "error",
        message:
          error instanceof RangeError
            ? "This run is too large for a safe challenge link."
            : "Challenge link unavailable. Try again.",
      });
    } finally {
      if (requestController.current === controller) requestController.current = null;
    }
  }
  const disabled = token === null || state.kind === "pending";
  const label =
    token === null
      ? "Challenge unavailable"
      : state.kind === "pending"
        ? "Verifying challenge…"
        : state.kind === "copied"
          ? "Challenge link copied ✓"
          : state.kind === "error"
            ? "Retry challenge link"
            : "Challenge a friend";
  return (
    <div>
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-disabled={disabled}
        onClick={copyChallengeLink}
      >
        {label}
      </button>
      {state.kind === "error" ? (
        <p role="status" className="form-note">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

async function requestChallengeProof(token: string, signal: AbortSignal): Promise<string | null> {
  const response = await boundedRequest(
    async (signal) =>
      fetch("/api/og/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run: token }),
        signal,
      }),
    {
      operation: "friend challenge proof",
      timeoutMs: CHALLENGE_PROOF_BUDGET_MS,
      safety: "safe-read",
      signal,
    },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { challenge_proof?: unknown };
  return typeof body.challenge_proof === "string" ? body.challenge_proof : null;
}
