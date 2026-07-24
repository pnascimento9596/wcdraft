"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildFriendChallengeShareCopy,
  buildFriendChallengeUrl,
  type FriendChallengeRef,
} from "@/lib/game/friend-challenge";
import { prewarmRunOgSign, signRunOg } from "@/lib/game/run-og-prewarm";
import type { RunRecordV1 } from "@/lib/game/run-record";
import { encodeRunToken } from "@/lib/game/run-token";

type State =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "copied" }
  | { kind: "shared" }
  | { kind: "error"; message: string };
export const CHALLENGE_PROOF_BUDGET_MS = 4_000;

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
    if (state.kind !== "copied" && state.kind !== "shared") return;
    const reset = window.setTimeout(() => setState({ kind: "idle" }), 2_000);
    return () => window.clearTimeout(reset);
  }, [state.kind]);

  function prewarm() {
    if (token === null) return;
    void prewarmRunOgSign(token);
  }

  async function resolveChallengePayload(
    signal: AbortSignal,
  ): Promise<{ url: string; copy: string } | null> {
    const challengeProof = proof ?? (await requestChallengeProof(token!, signal));
    if (signal.aborted) return null;
    if (!challengeProof) return null;
    const ref: FriendChallengeRef = { token: token!, proof: challengeProof };
    const url = buildFriendChallengeUrl(
      window.location.origin,
      ref,
      record.challenge?.kind === "daily" ? record.challenge.date : null,
    );
    return { url, copy: buildFriendChallengeShareCopy(url) };
  }

  async function shareOrCopyChallenge() {
    if (state.kind === "pending" || token === null) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setState({ kind: "pending" });
    try {
      const payload = await resolveChallengePayload(controller.signal);
      if (controller.signal.aborted) return;
      if (!payload) {
        setState({
          kind: "error",
          message:
            record.challenge?.kind === "daily"
              ? "This Daily board is outside current challenge coverage."
              : "Challenge verification is unavailable. Try again.",
        });
        return;
      }

      // Full intent set parity with Share: navigator.share when available,
      // clipboard fallback otherwise. Never blocks on OG; proof is required
      // for a valid challenge URL.
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        try {
          await navigator.share({
            title: "Challenge me on wcdraft",
            text: payload.copy,
            url: payload.url,
          });
          if (controller.signal.aborted) return;
          setState({ kind: "shared" });
          return;
        } catch (error) {
          // User cancel is not a failure — fall through only on real errors
          // when share is unavailable/rejected; AbortError = user cancelled.
          if (error instanceof DOMException && error.name === "AbortError") {
            setState({ kind: "idle" });
            return;
          }
        }
      }

      await navigator.clipboard.writeText(payload.copy);
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
          : state.kind === "shared"
            ? "Challenge shared ✓"
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
        onClick={shareOrCopyChallenge}
        onPointerDown={prewarm}
        onFocus={prewarm}
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
  // Shared session sign path — reuses prewarm/share success cache.
  const result = await signRunOg(token, {
    operation: "friend challenge proof",
    signal,
  });
  return result?.challengeProof ?? null;
}
