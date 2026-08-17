import { z } from 'zod';

/** Stable states are persisted; the transition states are used while a
 * Worker is applying a multi-step recipe. */
export const historyEntryStateSchema = z.enum([
  'open',
  'applied',
  'undoing',
  'undone',
  'redoing',
  'stale',
]);
export type HistoryEntryState = z.infer<typeof historyEntryStateSchema>;

export const historySourceSchema = z.enum(['desktop', 'script', 'mcp', 'plugin']);
export type HistorySource = z.infer<typeof historySourceSchema>;

export const historyPolicySchema = z.enum(['reversible', 'barrier']);
export type HistoryPolicy = z.infer<typeof historyPolicySchema>;

export const historyDirectionSchema = z.enum(['undo', 'redo']);
export type HistoryDirection = z.infer<typeof historyDirectionSchema>;

export const historyRecipeSchema = z.strictObject({
  kind: z.string().min(1).max(120),
  version: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
});
export type HistoryRecipe = z.infer<typeof historyRecipeSchema>;

export const historyOperationReceiptSchema = z.strictObject({
  historyEntryId: z.string().min(1),
  undoable: z.boolean(),
  redoable: z.boolean(),
  policy: historyPolicySchema,
});
export type HistoryOperationReceipt = z.infer<typeof historyOperationReceiptSchema>;

export interface HistoryEntrySummary {
  readonly historyEntryId: string;
  readonly source: HistorySource;
  readonly sourceReference: string | null;
  readonly labelKey: string;
  readonly labelArgs: Readonly<Record<string, string | number>>;
  readonly policy: HistoryPolicy;
  readonly state: HistoryEntryState;
  readonly staleCode: string | null;
  readonly affectedCount: number;
}

export interface HistoryStatus {
  readonly libraryId: string;
  readonly undoTop: HistoryEntrySummary | null;
  readonly redoTop: HistoryEntrySummary | null;
  /** The newest blocked entry, retained so the UI can explain why undo stopped. */
  readonly staleTop: HistoryEntrySummary | null;
  readonly transitionInProgress: boolean;
}

export interface HistoryStackEntry extends HistoryEntrySummary {
  readonly appliedSequence: number;
  /** Durable LIFO sequence for the redo stack; zero means currently applied. */
  readonly redoSequence: number;
}

export class HistoryTransitionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'HISTORY_ENTRY_NOT_FOUND'
      | 'HISTORY_NOT_TOP'
      | 'HISTORY_NOT_REVERSIBLE'
      | 'HISTORY_TRANSITION_IN_PROGRESS'
      | 'HISTORY_STALE',
  ) {
    super(message);
    this.name = 'HistoryTransitionError';
  }
}

function stableEntries(entries: readonly HistoryStackEntry[]): HistoryStackEntry[] {
  return entries
    .filter((entry) => entry.state === 'applied' || entry.state === 'undone' || entry.state === 'stale')
    .sort((left, right) => left.appliedSequence - right.appliedSequence);
}

function latestApplied(entries: readonly HistoryStackEntry[]): HistoryStackEntry | null {
  const barrierSequence = stableEntries(entries)
    .filter((entry) => entry.state === 'applied' && entry.policy === 'barrier')
    .at(-1)?.appliedSequence ?? -Infinity;
  const candidate = stableEntries(entries)
    .filter((entry) => entry.state === 'applied'
      && entry.policy === 'reversible'
      && entry.appliedSequence > barrierSequence)
    .at(-1) ?? null;
  const stale = stableEntries(entries)
    .filter((entry) => entry.state === 'stale' && entry.appliedSequence > barrierSequence)
    .at(-1) ?? null;
  return stale !== null
    && (candidate === null || stale.appliedSequence > candidate.appliedSequence)
    ? null
    : candidate;
}

function latestUndone(entries: readonly HistoryStackEntry[]): HistoryStackEntry | null {
  const barrierSequence = stableEntries(entries)
    .filter((entry) => entry.state === 'applied' && entry.policy === 'barrier')
    .at(-1)?.appliedSequence ?? -Infinity;
  const candidate = stableEntries(entries)
    .filter((entry) => entry.state === 'undone'
      && entry.policy === 'reversible'
      && entry.appliedSequence > barrierSequence)
    .sort((left, right) => right.redoSequence - left.redoSequence
      || right.appliedSequence - left.appliedSequence)
    .at(0) ?? null;
  const stale = stableEntries(entries)
    .filter((entry) => entry.state === 'stale' && entry.appliedSequence > barrierSequence)
    .at(-1) ?? null;
  return stale !== null
    && (candidate === null || stale.appliedSequence > candidate.appliedSequence)
    ? null
    : candidate;
}

function latestStale(entries: readonly HistoryStackEntry[]): HistoryStackEntry | null {
  const barrierSequence = stableEntries(entries)
    .filter((entry) => entry.state === 'applied' && entry.policy === 'barrier')
    .at(-1)?.appliedSequence ?? -Infinity;
  return stableEntries(entries)
    .filter((entry) => entry.state === 'stale' && entry.appliedSequence > barrierSequence)
    .at(-1) ?? null;
}

function publicSummary(entry: HistoryStackEntry | null): HistoryEntrySummary | null {
  if (!entry) return null;
  return {
    historyEntryId: entry.historyEntryId,
    source: entry.source,
    sourceReference: entry.sourceReference,
    labelKey: entry.labelKey,
    labelArgs: entry.labelArgs,
    policy: entry.policy,
    state: entry.state,
    staleCode: entry.staleCode,
    affectedCount: entry.affectedCount,
  };
}

/**
 * A small in-memory projection of the durable Worker history. It deliberately
 * knows nothing about recipes or transports; that keeps stack/fencing rules
 * identical for Desktop, scripts, MCP and plugins.
 */
export class OperationHistoryStateMachine {
  #entries: HistoryStackEntry[];
  #transition: { entryId: string; direction: HistoryDirection } | null = null;

  constructor(entries: readonly HistoryStackEntry[] = []) {
    this.#entries = [...entries].sort((left, right) => left.appliedSequence - right.appliedSequence);
  }

  get entries(): readonly HistoryStackEntry[] {
    return this.#entries;
  }

  status(libraryId: string): HistoryStatus {
    const transition = this.#transition;
    return {
      libraryId,
      undoTop: publicSummary(latestApplied(this.#entries)),
      redoTop: publicSummary(latestUndone(this.#entries)),
      staleTop: publicSummary(latestStale(this.#entries)),
      transitionInProgress:
        transition !== null || this.#entries.some((entry) =>
          entry.state === 'open' || entry.state === 'undoing' || entry.state === 'redoing'),
    };
  }

  append(entry: HistoryStackEntry): void {
    if (this.#transition) {
      throw new HistoryTransitionError('A history transition is already in progress.', 'HISTORY_TRANSITION_IN_PROGRESS');
    }
    // A new forward mutation after undo starts a new branch. Barrier entries
    // are retained as audit records but never become an undo target.
    this.#entries = this.#entries.filter((candidate) => candidate.state !== 'undone');
    this.#entries.push(entry);
  }

  /**
   * A retried transition may arrive after its first request committed.  It is
   * safe to acknowledge that terminal state without re-running the recipe;
   * callers still use `begin()` for all new transitions and fencing checks.
   */
  isCompleted(direction: HistoryDirection, expectedEntryId: string): boolean {
    const entry = this.#entries.find((candidate) => candidate.historyEntryId === expectedEntryId);
    if (!entry || entry.policy !== 'reversible') return false;
    return direction === 'undo'
      ? entry.state === 'undone'
      : entry.state === 'applied';
  }

  begin(direction: HistoryDirection, expectedEntryId: string): HistoryStackEntry {
    if (this.#transition) {
      throw new HistoryTransitionError('A history transition is already in progress.', 'HISTORY_TRANSITION_IN_PROGRESS');
    }
    const requested = this.#entries.find((candidate) => candidate.historyEntryId === expectedEntryId);
    if (requested?.state === 'stale') {
      throw new HistoryTransitionError('The requested history entry is stale and needs conflict resolution.', 'HISTORY_STALE');
    }
    const entry = direction === 'undo'
      ? latestApplied(this.#entries)
      : latestUndone(this.#entries);
    if (!entry) {
      throw new HistoryTransitionError('No history entry is available for this transition.', 'HISTORY_ENTRY_NOT_FOUND');
    }
    if (entry.historyEntryId !== expectedEntryId) {
      throw new HistoryTransitionError('The requested history entry is not the current stack top.', 'HISTORY_NOT_TOP');
    }
    if (entry.policy !== 'reversible') {
      throw new HistoryTransitionError('This history entry is a barrier and cannot be reversed.', 'HISTORY_NOT_REVERSIBLE');
    }
    if (entry.state === 'stale') {
      throw new HistoryTransitionError('This history entry is stale and needs conflict resolution.', 'HISTORY_STALE');
    }
    this.#transition = { entryId: entry.historyEntryId, direction };
    const nextState: HistoryEntryState = direction === 'undo' ? 'undoing' : 'redoing';
    const updated = { ...entry, state: nextState, staleCode: null };
    this.#replace(updated);
    return updated;
  }

  complete(direction: HistoryDirection, entryId: string): HistoryStackEntry {
    this.#assertTransition(direction, entryId);
    const entry = this.#get(entryId);
    const updated = {
      ...entry,
      state: direction === 'undo' ? 'undone' : 'applied',
      staleCode: null,
    } as HistoryStackEntry;
    this.#replace(updated);
    this.#transition = null;
    return updated;
  }

  fail(direction: HistoryDirection, entryId: string, staleCode?: string): HistoryStackEntry {
    this.#assertTransition(direction, entryId);
    const entry = this.#get(entryId);
    const updated = {
      ...entry,
      state: staleCode ? 'stale' : direction === 'undo' ? 'applied' : 'undone',
      staleCode: staleCode ?? entry.staleCode,
    } as HistoryStackEntry;
    this.#replace(updated);
    this.#transition = null;
    return updated;
  }

  markStale(entryId: string, staleCode: string): HistoryStackEntry {
    if (this.#transition) {
      throw new HistoryTransitionError('A history transition is already in progress.', 'HISTORY_TRANSITION_IN_PROGRESS');
    }
    const entry = this.#get(entryId);
    const updated = { ...entry, state: 'stale' as const, staleCode };
    this.#replace(updated);
    return updated;
  }

  #get(entryId: string): HistoryStackEntry {
    const entry = this.#entries.find((candidate) => candidate.historyEntryId === entryId);
    if (!entry) {
      throw new HistoryTransitionError('The history entry does not exist.', 'HISTORY_ENTRY_NOT_FOUND');
    }
    return entry;
  }

  #assertTransition(direction: HistoryDirection, entryId: string): void {
    if (!this.#transition || this.#transition.entryId !== entryId || this.#transition.direction !== direction) {
      throw new HistoryTransitionError('The requested history transition is not active.', 'HISTORY_TRANSITION_IN_PROGRESS');
    }
  }

  #replace(entry: HistoryStackEntry): void {
    this.#entries = this.#entries.map((candidate) =>
      candidate.historyEntryId === entry.historyEntryId ? entry : candidate,
    );
  }
}
