// Web Worker entry point for the tournament simulation.
//
// Hosts the deterministic engine off the main thread so a full 8-match run
// (Poisson + injuries + ET + pens + narrative) never blocks paint or input.
//
// The worker has zero UI dependencies: it just shuttles a single typed
// `WorkerInput` → `WorkerOutput` message through `handleWorkerInput`.
//
// Determinism is preserved end-to-end — the worker never reads `Date.now`,
// `Math.random`, `crypto`, or `performance.now` as an *input* to the engine.
// `performance.now` is used only to capture post-run duration telemetry,
// which is informational and never threads back into the seeded engine.

/// <reference lib="webworker" />

import { handleWorkerInput, type WorkerInput, type WorkerOutput } from "./simulate";

// In a module worker the global is `DedicatedWorkerGlobalScope`. The cast
// keeps TS happy regardless of which lib was loaded for the tsconfig.
declare const self: DedicatedWorkerGlobalScope;

self.addEventListener("message", (ev: MessageEvent<WorkerInput>) => {
  const data = ev.data;
  if (!data || data.kind !== "run") {
    const out: WorkerOutput = {
      request_id:
        typeof (data as { request_id?: unknown } | null)?.request_id === "number"
          ? (data as { request_id: number }).request_id
          : -1,
      kind: "error",
      message: "sim worker: unexpected input message",
    };
    self.postMessage(out);
    return;
  }
  const out = handleWorkerInput(data);
  self.postMessage(out);
});

// Export {} keeps TS treating this as a module so `self` typing applies.
export {};
