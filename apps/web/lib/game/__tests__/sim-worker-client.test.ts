import { afterEach, describe, expect, it, vi } from "vitest";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";

import {
  SimulationWorkerBusyError,
  SimulationWorkerClient,
  SimulationWorkerExecutionError,
  type SimulationWorkerLike,
} from "../sim-worker-client";
import type { WorkerInput, WorkerOutput } from "../simulate";
import { runSimulationSync } from "../simulate";
import { buildGameDataFromBundles, buildOriginRecord } from "./run-token.test-harness";

class FakeWorker implements SimulationWorkerLike {
  readonly posted: WorkerInput[] = [];
  terminate = vi.fn();
  private readonly messageListeners = new Set<(event: MessageEvent<unknown>) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();
  private readonly messageErrorListeners = new Set<(event: MessageEvent<unknown>) => void>();

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener as (event: MessageEvent<unknown>) => void);
    } else if (type === "error") {
      this.errorListeners.add(listener as (event: ErrorEvent) => void);
    } else {
      this.messageErrorListeners.add(listener as (event: MessageEvent<unknown>) => void);
    }
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.delete(listener as (event: MessageEvent<unknown>) => void);
    } else if (type === "error") {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void);
    } else {
      this.messageErrorListeners.delete(listener as (event: MessageEvent<unknown>) => void);
    }
  }

  postMessage(message: WorkerInput): void {
    this.posted.push(message);
  }

  emit(output: unknown): void {
    for (const listener of this.messageListeners) {
      listener({ data: output } as MessageEvent<unknown>);
    }
  }

  fail(message: string): void {
    for (const listener of this.errorListeners) {
      listener({ message } as ErrorEvent);
    }
  }

  failDeserialization(): void {
    for (const listener of this.messageErrorListeners) {
      listener({ data: undefined } as MessageEvent<unknown>);
    }
  }

  listenerCounts(): { message: number; error: number; messageerror: number } {
    return {
      message: this.messageListeners.size,
      error: this.errorListeners.size,
      messageerror: this.messageErrorListeners.size,
    };
  }
}

const input = {
  kind: "run",
  draft: {} as WorkerInput["draft"],
  parent_seed: "seed",
  world: {} as WorkerInput["world"],
  scenario: {} as WorkerInput["scenario"],
} as const;

const gameData = buildGameDataFromBundles();
const record = buildOriginRecord(gameData, "wcdraft:sim-worker-client:valid-output");
const validSimulation = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record).simulation;

function done(request_id: number): Extract<WorkerOutput, { kind: "done" }> {
  return {
    request_id,
    kind: "done",
    simulation: validSimulation,
    telemetry: { duration_ms: 1 },
  };
}

afterEach(() => vi.useRealTimers());

describe("reusable simulation worker lifecycle", () => {
  it("binds default browser timers to the global receiver", () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const setTimer = vi.fn(function (this: unknown): ReturnType<typeof setTimeout> {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return 41 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimer = vi.fn(function (this: unknown): void {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
    });
    globalThis.setTimeout = setTimer as unknown as typeof setTimeout;
    globalThis.clearTimeout = clearTimer as unknown as typeof clearTimeout;
    try {
      const client = new SimulationWorkerClient({ createWorker: () => new FakeWorker() });
      expect(() => client.prewarm()).not.toThrow();
      client.terminate();
      expect(setTimer).toHaveBeenCalledOnce();
      expect(clearTimer).toHaveBeenCalledWith(41);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it("prewarms one worker and reuses it across sequential simulations", async () => {
    const worker = new FakeWorker();
    const createWorker = vi.fn(() => worker);
    const client = new SimulationWorkerClient({ createWorker });

    client.prewarm();
    client.prewarm();
    expect(createWorker).toHaveBeenCalledOnce();

    const first = client.run(input);
    worker.emit(done(worker.posted[0]!.request_id));
    await expect(first).resolves.toMatchObject({ kind: "done" });

    const second = client.run(input);
    worker.emit(done(worker.posted[1]!.request_id));
    await expect(second).resolves.toMatchObject({ kind: "done" });
    expect(createWorker).toHaveBeenCalledOnce();
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("terminates a prewarmed idle worker after the bounded idle interval", () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new SimulationWorkerClient({
      createWorker: () => worker,
      idleTimeoutMs: 500,
    });
    client.prewarm();
    vi.advanceTimersByTime(499);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates and cancels an active request on navigation/unmount", async () => {
    const worker = new FakeWorker();
    const client = new SimulationWorkerClient({ createWorker: () => worker });
    const pending = client.run(input);
    client.terminate();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects worker runtime errors and recreates on the next prewarm", async () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    let workerIndex = 0;
    const createWorker = vi.fn(() => workers[workerIndex++]!);
    const client = new SimulationWorkerClient({ createWorker });
    const pending = client.run(input);
    workers[0]!.fail("boom");

    await expect(pending).rejects.toBeInstanceOf(SimulationWorkerExecutionError);
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    client.prewarm();
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed worker protocol response instead of hanging", async () => {
    const worker = new FakeWorker();
    const client = new SimulationWorkerClient({ createWorker: () => worker });
    const pending = client.run(input);
    worker.emit({ kind: "done" } as WorkerOutput);

    await expect(pending).rejects.toBeInstanceOf(SimulationWorkerExecutionError);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each([
    ["done without a simulation", { request_id: 1, kind: "done", telemetry: { duration_ms: 1 } }],
    ["error without a message", { request_id: 1, kind: "error" }],
    ["unknown kind", { request_id: 1, kind: "mystery" }],
    ["non-finite request id", { request_id: Number.NaN, kind: "error", message: "bad" }],
  ])("rejects and terminates a same-request malformed reply: %s", async (_label, output) => {
    const worker = new FakeWorker();
    const client = new SimulationWorkerClient({ createWorker: () => worker });
    const pending = client.run(input);
    worker.emit(output);

    await expect(pending).rejects.toBeInstanceOf(SimulationWorkerExecutionError);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects message deserialization errors and removes every worker listener", async () => {
    const worker = new FakeWorker();
    const client = new SimulationWorkerClient({ createWorker: () => worker });
    const pending = client.run(input);
    expect(worker.listenerCounts()).toEqual({ message: 1, error: 1, messageerror: 1 });
    worker.failDeserialization();

    await expect(pending).rejects.toBeInstanceOf(SimulationWorkerExecutionError);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.listenerCounts()).toEqual({ message: 0, error: 0, messageerror: 0 });
  });

  it("rejects and terminates a silent worker at the bounded request deadline", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new SimulationWorkerClient({
      createWorker: () => worker,
      requestTimeoutMs: 500,
    });
    const pending = client.run(input);
    vi.advanceTimersByTime(500);

    await expect(pending).rejects.toThrow("simulation worker timed out");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("aborts the active worker and ignores its stale result after replacement", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    let workerIndex = 0;
    const createWorker = vi.fn(() => workers[workerIndex++]!);
    const client = new SimulationWorkerClient({ createWorker });
    const controller = new AbortController();
    const first = client.run(input, controller.signal);
    const staleRequestId = firstWorker.posted[0]!.request_id;
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });

    const second = client.run(input);
    firstWorker.emit(done(staleRequestId));
    expect(secondWorker.posted).toHaveLength(1);
    secondWorker.emit(done(secondWorker.posted[0]!.request_id));
    await expect(second).resolves.toMatchObject({ kind: "done" });
  });

  it("rejects a rapid second request instead of running or handing off twice", async () => {
    const worker = new FakeWorker();
    const client = new SimulationWorkerClient({ createWorker: () => worker });
    const first = client.run(input);
    const second = client.run(input);

    await expect(second).rejects.toBeInstanceOf(SimulationWorkerBusyError);
    expect(worker.posted).toHaveLength(1);
    worker.emit(done(worker.posted[0]!.request_id));
    await expect(first).resolves.toMatchObject({ kind: "done" });
  });
});
