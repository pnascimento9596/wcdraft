export interface SimulationAttempt {
  readonly id: number;
  readonly controller: AbortController;
}

interface ActiveAttempt extends SimulationAttempt {
  ownedStatusSequence: number | null;
  resultCommitted: boolean;
}

/** Coordinates one UI simulation attempt and its durable status handoff. */
export class SimulationHandoff {
  private nextId = 1;
  private active: ActiveAttempt | null = null;

  begin(): SimulationAttempt | null {
    if (this.active) return null;
    const attempt: ActiveAttempt = {
      id: this.nextId++,
      controller: new AbortController(),
      ownedStatusSequence: null,
      resultCommitted: false,
    };
    this.active = attempt;
    return attempt;
  }

  markStatusSimulating(attempt: SimulationAttempt, updatedSequence: number): void {
    if (this.isCurrent(attempt)) this.active!.ownedStatusSequence = updatedSequence;
  }

  ownedStatusSequence(attempt: SimulationAttempt): number | null {
    return this.isCurrent(attempt) ? this.active!.ownedStatusSequence : null;
  }

  canCommit(attempt: SimulationAttempt): boolean {
    return this.isCurrent(attempt) && !attempt.controller.signal.aborted;
  }

  markResultCommitted(attempt: SimulationAttempt): void {
    if (!this.isCurrent(attempt)) return;
    this.active!.resultCommitted = true;
    this.active!.ownedStatusSequence = null;
  }

  markStatusRecovered(attempt: SimulationAttempt): void {
    if (this.isCurrent(attempt)) this.active!.ownedStatusSequence = null;
  }

  finish(attempt: SimulationAttempt): void {
    if (this.isCurrent(attempt)) this.active = null;
  }

  /**
   * Invalidate and abort before restoring durable status. A committed result
   * is already `complete` and must never be changed back to `ready` during
   * results navigation.
   */
  cancel(resetReady: (ownedStatusSequence: number) => void): void {
    const active = this.active;
    this.active = null;
    if (!active) return;
    active.controller.abort();
    if (active.ownedStatusSequence !== null && !active.resultCommitted) {
      resetReady(active.ownedStatusSequence);
    }
  }

  private isCurrent(attempt: SimulationAttempt): boolean {
    return this.active?.id === attempt.id && this.active.controller === attempt.controller;
  }
}
