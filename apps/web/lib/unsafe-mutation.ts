"use client";

import { useCallback, useRef, useState } from "react";
import { isRequestTimeoutError } from "@wcdraft/data/client";

/**
 * A dispatched mutation has four materially different client states. Once
 * its outcome is unknown, another write is unsafe until the user changes the
 * operation or a read reconciles server state.
 */
export type UnsafeMutationPhase = "idle" | "pending" | "committed" | "outcome-unknown";

export type UnsafeMutationResponseDisposition = "definitive" | "outcome-unknown";

/**
 * Classify the acknowledgement value of an HTTP response to a non-idempotent
 * mutation. Known application 4xx responses reject the request definitively,
 * except 408; a 408 or 5xx may be returned after the write committed but before
 * its acknowledgement reached the browser.
 */
export function unsafeMutationResponseDisposition(
  status: number,
): UnsafeMutationResponseDisposition {
  if (!Number.isInteger(status) || status < 100 || status > 599) return "outcome-unknown";
  return status === 408 || status >= 500 ? "outcome-unknown" : "definitive";
}

export function isUnsafeMutationResponseAmbiguous(status: number): boolean {
  return unsafeMutationResponseDisposition(status) === "outcome-unknown";
}

export interface UnsafeMutationLatch {
  readonly phase: UnsafeMutationPhase;
  readonly locked: boolean;
  readonly outcomeUnknown: boolean;
  /** Synchronously claims the write slot. False means a write is already unsafe. */
  begin: () => boolean;
  /** Releases the slot only after a definitive HTTP outcome. */
  settle: () => void;
  /** Keeps an irrevocably accepted write locked through its local handoff. */
  markCommitted: () => void;
  /** Permanently latches this operation after a timeout/transport failure. */
  markOutcomeUnknown: () => void;
  /** Releases an unknown latch only because the user changed the operation. */
  resetForChangedOperation: () => void;
}

export function useUnsafeMutationLatch(): UnsafeMutationLatch {
  const [phase, setPhase] = useState<UnsafeMutationPhase>("idle");
  const phaseRef = useRef<UnsafeMutationPhase>("idle");

  const update = useCallback((next: UnsafeMutationPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const begin = useCallback(() => {
    if (phaseRef.current !== "idle") return false;
    update("pending");
    return true;
  }, [update]);

  const settle = useCallback(() => {
    if (phaseRef.current === "pending") update("idle");
  }, [update]);
  const markCommitted = useCallback(() => update("committed"), [update]);
  const markOutcomeUnknown = useCallback(() => update("outcome-unknown"), [update]);
  const resetForChangedOperation = useCallback(() => {
    if (phaseRef.current === "outcome-unknown") update("idle");
  }, [update]);

  return {
    phase,
    locked: phase !== "idle",
    outcomeUnknown: phase === "outcome-unknown",
    begin,
    settle,
    markCommitted,
    markOutcomeUnknown,
    resetForChangedOperation,
  };
}

export function unsafeMutationUnknownMessage(
  error: unknown,
  copy: { readonly timeout: string; readonly transport: string },
): string {
  return isRequestTimeoutError(error) ? copy.timeout : copy.transport;
}
