import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { SimulationHandoff } from "../simulation-handoff";

const SOURCE = readFileSync(
  new URL("../../../components/game/review-screen.tsx", import.meta.url),
  "utf8",
);

describe("review simulation single-winner contract", () => {
  it("retains synchronous double-click exclusion before the first await", () => {
    const guard = SOURCE.indexOf(
      'if (!complete || sim.kind === "running" || simInFlightRef.current) return;',
    );
    const lock = SOURCE.indexOf("simInFlightRef.current = true;", guard);
    const firstAwait = SOURCE.indexOf("await ", guard);
    expect(guard).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(guard);
    expect(lock).toBeLessThan(firstAwait);
  });

  it("checks abort and operation identity before persistence and navigation", () => {
    const resultAwait = SOURCE.indexOf("const result = await runSimulation");
    const commitGuard = SOURCE.indexOf(
      "if (!handoffRef.current.canCommit(attempt)) return;",
      resultAwait,
    );
    const persist = SOURCE.indexOf("const persist = setRunSimulation", resultAwait);
    const navigationGuard = SOURCE.indexOf(
      "if (!handoffRef.current.canCommit(attempt)) return;",
      persist,
    );
    const navigate = SOURCE.indexOf("router.push(resultsHref", resultAwait);
    expect(commitGuard).toBeGreaterThan(resultAwait);
    expect(commitGuard).toBeLessThan(persist);
    expect(navigationGuard).toBeGreaterThan(persist);
    expect(navigationGuard).toBeLessThan(navigate);
  });

  it("cancel restores a genuinely in-flight status and blocks result handoff", () => {
    const handoff = new SimulationHandoff();
    const attempt = handoff.begin();
    if (!attempt) throw new Error("attempt did not begin");
    handoff.markStatusSimulating(attempt, 41);
    const resetReady = vi.fn();
    const persistResult = vi.fn();
    const navigate = vi.fn();

    handoff.cancel(resetReady);
    if (handoff.canCommit(attempt)) {
      persistResult();
      navigate();
    }

    expect(attempt.controller.signal.aborted).toBe(true);
    expect(resetReady).toHaveBeenCalledOnce();
    expect(resetReady).toHaveBeenCalledWith(41);
    expect(persistResult).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not reset a committed result during results navigation", () => {
    const handoff = new SimulationHandoff();
    const attempt = handoff.begin();
    if (!attempt) throw new Error("attempt did not begin");
    handoff.markStatusSimulating(attempt, 42);
    handoff.markResultCommitted(attempt);
    const resetReady = vi.fn();

    handoff.cancel(resetReady);
    expect(resetReady).not.toHaveBeenCalled();
  });

  it("refuses a rapid second begin while the first attempt is active", () => {
    const handoff = new SimulationHandoff();
    expect(handoff.begin()).not.toBeNull();
    expect(handoff.begin()).toBeNull();
  });
});
