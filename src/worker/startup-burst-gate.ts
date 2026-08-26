/**
 * Admission gate for work that is safe only after a library's first browse
 * response has been posted.  The Worker can own more than one open library,
 * so this state must never be process-global: a browse in library A must not
 * release reconciliation for library B, and opening B must not cancel A.
 */

export const STARTUP_BURST_MAX_WAIT_MS = 15_000;

export type StartupBurstGateToken = {
  libraryId: string;
  generation: number;
};

type StartupBurstWaiter = {
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
};

type StartupBurstGate = StartupBurstGateToken & {
  browseServed: boolean;
  openingResponsePending: boolean;
  cancelled: Error | undefined;
  waiters: Map<() => void, StartupBurstWaiter>;
};

export class StartupBurstGateRegistry {
  private readonly gates = new Map<string, StartupBurstGate>();
  private readonly inFlightCommands = new Map<string, number>();

  /** Count a parsed request that targets an open library. */
  beginCommand(libraryId: string, generation?: number): void {
    const key = this.commandKey(libraryId, generation);
    this.inFlightCommands.set(key, (this.inFlightCommands.get(key) ?? 0) + 1);
  }

  /**
   * Finish a posted response. The browse marker is deliberately updated only
   * after the response has crossed the Worker→Main postMessage boundary.
   */
  finishCommand(input: {
    libraryId: string;
    generation?: number;
    commandType: string;
    servedSuccessfully: boolean;
  }): void {
    const key = this.commandKey(input.libraryId, input.generation);
    const count = this.inFlightCommands.get(key) ?? 0;
    if (count <= 1) this.inFlightCommands.delete(key);
    else this.inFlightCommands.set(key, count - 1);

    // A response without an effective generation is still removed from its
    // unversioned counter, but it is never allowed to mark the current gate:
    // an old unversioned response must not release a reopened generation.
    if (input.generation === undefined) return;
    const gate = this.gates.get(input.libraryId);
    if (!this.matchesGate(gate, input.generation)) return;
    if (
      input.servedSuccessfully
      && (input.commandType === 'asset.search' || input.commandType === 'folder.browse-entries')
    ) {
      gate.browseServed = true;
    }
    this.settleIfDrained(gate);
  }

  /**
   * Start a new open generation. The pending response is represented as a
   * sentinel until the opened response itself has been posted.
   */
  open(libraryId: string, generation: number): StartupBurstGateToken {
    const previous = this.gates.get(libraryId);
    if (previous) this.cancelGate(previous, new Error('Startup reconciliation gate superseded.'));
    const gate: StartupBurstGate = {
      libraryId,
      generation,
      browseServed: false,
      openingResponsePending: true,
      cancelled: undefined,
      waiters: new Map(),
    };
    this.gates.set(libraryId, gate);
    return { libraryId, generation };
  }

  /** Release the sentinel after the opened response has been posted. */
  finishOpenResponse(token: StartupBurstGateToken): void {
    const gate = this.gates.get(token.libraryId);
    if (!this.matchesGate(gate, token.generation)) return;
    gate.openingResponsePending = false;
    this.settleIfDrained(gate);
  }

  /** Cancel only one library's startup gate. */
  cancel(libraryId: string, reason: string): void {
    const gate = this.gates.get(libraryId);
    if (!gate) return;
    this.cancelGate(gate, new Error(reason));
    this.gates.delete(libraryId);
  }

  /** Cancel all gates during Worker shutdown. */
  cancelAll(reason: string): void {
    for (const gate of this.gates.values()) this.cancelGate(gate, new Error(reason));
    this.gates.clear();
  }

  /**
   * Normal operation has no startup hold. A library without a gate therefore
   * yields like a served library; only a live matching gate gets the special
   * first-browse treatment.
   */
  isBrowseServed(libraryId: string): boolean {
    return this.gates.get(libraryId)?.browseServed ?? true;
  }

  waitForDrain(token: StartupBurstGateToken): Promise<void> {
    const gate = this.gates.get(token.libraryId);
    if (!gate || !this.matchesGate(gate, token.generation)) {
      return Promise.reject(new Error('Startup burst gate is no longer active.'));
    }
    if (gate.cancelled) return Promise.reject(gate.cancelled);
    if (this.isDrained(gate)) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!gate.waiters.delete(resolve)) return;
        // The cap is an intentional degraded-mode escape hatch. Marking the
        // burst as served also prevents later searches from permanently taking
        // the special first-browse path when no browse response ever arrives.
        gate.browseServed = true;
        const remaining = [...gate.waiters.values()];
        gate.waiters.clear();
        clearTimeout(timer);
        resolve();
        for (const waiter of remaining) {
          clearTimeout(waiter.timer);
          waiter.resolve();
        }
      }, STARTUP_BURST_MAX_WAIT_MS);
      (timer as { unref?: () => void }).unref?.();
      gate.waiters.set(resolve, { timer, resolve, reject });
    });
  }

  private matchesGate(
    gate: StartupBurstGate | undefined,
    generation: number | undefined,
  ): gate is StartupBurstGate {
    return gate !== undefined && (generation === undefined || gate.generation === generation);
  }

  private isDrained(gate: StartupBurstGate): boolean {
    return !gate.cancelled
      && !gate.openingResponsePending
      && gate.browseServed
      && (this.inFlightCommands.get(this.commandKey(gate.libraryId, gate.generation)) ?? 0) === 0;
  }

  private commandKey(libraryId: string, generation?: number): string {
    return `${libraryId}\u0000${generation ?? 'unversioned'}`;
  }

  private settleIfDrained(gate: StartupBurstGate): void {
    if (!this.isDrained(gate)) return;
    const waiters = [...gate.waiters.values()];
    gate.waiters.clear();
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private cancelGate(gate: StartupBurstGate, reason: Error): void {
    gate.cancelled = reason;
    // Late responses from a cancelled generation are ignored by
    // finishCommand; discard the counter now so repeated close/reopen cycles
    // cannot retain one map entry per abandoned generation.
    this.inFlightCommands.delete(this.commandKey(gate.libraryId, gate.generation));
    const waiters = [...gate.waiters.values()];
    gate.waiters.clear();
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(reason);
    }
  }
}
