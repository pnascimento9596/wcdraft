import type { WorkerInput, WorkerOutput } from "./simulate";
import { parsePersistedSimulation } from "./simulation-payload";

export interface SimulationWorkerLike {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: WorkerInput): void;
  terminate(): void;
}

export class SimulationWorkerBusyError extends Error {
  constructor() {
    super("simulation worker already has an active run");
    this.name = "SimulationWorkerBusyError";
  }
}

export class SimulationWorkerExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationWorkerExecutionError";
  }
}

interface ActiveRequest {
  readonly requestId: number;
  readonly resolve: (output: Extract<WorkerOutput, { kind: "done" }>) => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
  readonly onAbort: () => void;
}

export interface SimulationWorkerClientOptions {
  readonly createWorker: () => SimulationWorkerLike;
  readonly idleTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
}

/** One reusable module worker with one deterministic run in flight at a time. */
export class SimulationWorkerClient {
  private worker: SimulationWorkerLike | null = null;
  private active: ActiveRequest | null = null;
  private nextRequestId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private requestTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly createWorker: () => SimulationWorkerLike;
  private readonly idleTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;

  constructor(options: SimulationWorkerClientOptions) {
    this.createWorker = options.createWorker;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 120_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    // Some browser timer implementations reject a non-global Web-IDL receiver.
    // Without binding, `this.setTimer(...)` supplies this client as the receiver.
    this.setTimer = options.setTimer ?? setTimeout.bind(globalThis);
    this.clearTimer = options.clearTimer ?? clearTimeout.bind(globalThis);
  }

  /** Construct the module worker before the user presses Simulate. */
  prewarm(): void {
    this.ensureWorker();
    this.scheduleIdleTermination();
  }

  run(
    input: Omit<WorkerInput, "request_id">,
    signal?: AbortSignal,
  ): Promise<Extract<WorkerOutput, { kind: "done" }>> {
    if (this.active) return Promise.reject(new SimulationWorkerBusyError());
    if (signal?.aborted) return Promise.reject(abortError());

    let worker: SimulationWorkerLike;
    try {
      worker = this.ensureWorker();
    } catch (error) {
      return Promise.reject(error);
    }
    this.clearIdleTimer();
    const requestId = this.nextRequestId++;

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (this.active?.requestId !== requestId) return;
        this.active = null;
        this.terminateWorker();
        reject(abortError());
      };
      this.active = { requestId, resolve, reject, signal, onAbort };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.requestTimer = this.setTimer(() => {
        this.requestTimer = null;
        this.finishWithError(
          requestId,
          new SimulationWorkerExecutionError("simulation worker timed out"),
        );
      }, this.requestTimeoutMs);
      try {
        worker.postMessage({ ...input, request_id: requestId });
      } catch (error) {
        this.finishWithError(requestId, error);
      }
    });
  }

  /** Navigation/unmount teardown. Any active request is cancelled. */
  terminate(): void {
    const active = this.active;
    this.active = null;
    this.clearRequestTimer();
    if (active) {
      active.signal?.removeEventListener("abort", active.onAbort);
      active.reject(abortError());
    }
    this.terminateWorker();
  }

  private ensureWorker(): SimulationWorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.addEventListener("message", this.onMessage);
    worker.addEventListener("error", this.onError);
    worker.addEventListener("messageerror", this.onMessageError);
    this.worker = worker;
    return worker;
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    const active = this.active;
    if (!active) return;
    const output = parseWorkerOutput(event.data);
    if (!output) {
      this.finishWithError(
        active.requestId,
        new SimulationWorkerExecutionError("sim worker returned a malformed message"),
      );
      return;
    }
    // A result from an aborted/previous worker request can never win the
    // current handoff. Ignore it rather than mutating the active request.
    if (output.request_id !== active.requestId) return;
    this.active = null;
    this.clearRequestTimer();
    active.signal?.removeEventListener("abort", active.onAbort);
    if (output.kind === "done") {
      active.resolve(output);
      this.scheduleIdleTermination();
      return;
    }
    active.reject(new SimulationWorkerExecutionError(`sim worker error: ${output.message}`));
    this.terminateWorker();
  };

  private readonly onError = (event: ErrorEvent): void => {
    const active = this.active;
    this.active = null;
    this.clearRequestTimer();
    if (active) {
      active.signal?.removeEventListener("abort", active.onAbort);
      active.reject(
        new SimulationWorkerExecutionError(
          `simulation worker failed (${event.message || "unknown error"})`,
        ),
      );
    }
    this.terminateWorker();
  };

  private readonly onMessageError = (): void => {
    const active = this.active;
    this.active = null;
    this.clearRequestTimer();
    if (active) {
      active.signal?.removeEventListener("abort", active.onAbort);
      active.reject(
        new SimulationWorkerExecutionError("simulation worker message could not be deserialized"),
      );
    }
    this.terminateWorker();
  };

  private finishWithError(requestId: number, error: unknown): void {
    const active = this.active;
    if (!active || active.requestId !== requestId) return;
    this.active = null;
    this.clearRequestTimer();
    active.signal?.removeEventListener("abort", active.onAbort);
    active.reject(error);
    this.terminateWorker();
  }

  private scheduleIdleTermination(): void {
    this.clearIdleTimer();
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = null;
      if (!this.active) this.terminateWorker();
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer === null) return;
    this.clearTimer(this.idleTimer);
    this.idleTimer = null;
  }

  private clearRequestTimer(): void {
    if (this.requestTimer === null) return;
    this.clearTimer(this.requestTimer);
    this.requestTimer = null;
  }

  private terminateWorker(): void {
    this.clearIdleTimer();
    this.clearRequestTimer();
    if (!this.worker) return;
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onError);
    this.worker.removeEventListener("messageerror", this.onMessageError);
    this.worker.terminate();
    this.worker = null;
  }
}

function parseWorkerOutput(value: unknown): WorkerOutput | null {
  if (!isObject(value)) return null;
  const requestId = value.request_id;
  if (typeof requestId !== "number" || !Number.isSafeInteger(requestId) || requestId < 1) {
    return null;
  }
  if (value.kind === "error") {
    if (typeof value.message !== "string" || value.message.length === 0) return null;
    if (value.stack !== undefined && typeof value.stack !== "string") return null;
    return value as Extract<WorkerOutput, { kind: "error" }>;
  }
  if (value.kind !== "done") return null;
  const simulation = parsePersistedSimulation(value.simulation);
  if (!simulation || !isObject(value.telemetry)) return null;
  const duration = value.telemetry.duration_ms;
  if (
    duration !== null &&
    (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0)
  ) {
    return null;
  }
  return {
    request_id: requestId,
    kind: "done",
    simulation,
    telemetry: { duration_ms: duration },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function abortError(): DOMException {
  return new DOMException("Simulation cancelled", "AbortError");
}

const sharedSimulationWorker = new SimulationWorkerClient({
  createWorker: () => {
    if (typeof Worker === "undefined") {
      throw new Error("worker unavailable in this environment");
    }
    return new Worker(new URL("./sim.worker.ts", import.meta.url), {
      type: "module",
    });
  },
});

export function prewarmSimulationWorker(): void {
  sharedSimulationWorker.prewarm();
}

export function terminateSimulationWorker(): void {
  sharedSimulationWorker.terminate();
}

export function runWithSimulationWorker(
  input: Omit<WorkerInput, "request_id">,
  signal?: AbortSignal,
): Promise<Extract<WorkerOutput, { kind: "done" }>> {
  return sharedSimulationWorker.run(input, signal);
}
