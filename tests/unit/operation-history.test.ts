import { describe, expect, it } from 'vitest';

import {
  HistoryTransitionError,
  OperationHistoryStateMachine,
  type HistoryStackEntry,
} from '../../src/worker/operation-history';

function entry(
  historyEntryId: string,
  appliedSequence: number,
  state: HistoryStackEntry['state'] = 'applied',
  policy: HistoryStackEntry['policy'] = 'reversible',
): HistoryStackEntry {
  return {
    historyEntryId,
    source: 'desktop',
    sourceReference: null,
    labelKey: `history.${historyEntryId}`,
    labelArgs: {},
    policy,
    state,
    staleCode: null,
    affectedCount: 1,
    appliedSequence,
    redoSequence: state === 'undone' ? appliedSequence : 0,
  };
}

describe('OperationHistoryStateMachine', () => {
  it('exposes only the current reversible stack tops', () => {
    const machine = new OperationHistoryStateMachine([
      entry('one', 1),
      entry('barrier', 2, 'applied', 'barrier'),
      entry('two', 3),
    ]);

    expect(machine.status('library-1')).toMatchObject({
      undoTop: { historyEntryId: 'two' },
      redoTop: null,
      transitionInProgress: false,
    });
  });

  it('fences undo/redo to the exact top entry and completes both directions', () => {
    const machine = new OperationHistoryStateMachine([entry('one', 1), entry('two', 2)]);

    expect(() => machine.begin('undo', 'one')).toThrowError(HistoryTransitionError);
    expect(machine.begin('undo', 'two').state).toBe('undoing');
    expect(machine.complete('undo', 'two').state).toBe('undone');
    expect(machine.status('library-1').redoTop?.historyEntryId).toBe('two');

    expect(machine.begin('redo', 'two').state).toBe('redoing');
    expect(machine.complete('redo', 'two').state).toBe('applied');
    expect(machine.status('library-1').undoTop?.historyEntryId).toBe('two');
  });

  it('clears the redo branch when a new forward mutation is appended', () => {
    const machine = new OperationHistoryStateMachine([entry('one', 1), entry('two', 2)]);
    machine.begin('undo', 'two');
    machine.complete('undo', 'two');
    machine.append(entry('three', 3));

    expect(machine.status('library-1')).toMatchObject({
      undoTop: { historyEntryId: 'three' },
      redoTop: null,
    });
    expect(machine.entries.map((item) => item.historyEntryId)).toEqual(['one', 'three']);
  });

  it('uses the most recently undone entry as the redo top', () => {
    const machine = new OperationHistoryStateMachine([
      entry('one', 1, 'undone'),
      entry('two', 2, 'undone'),
    ]);

    expect(machine.status('library-1').redoTop?.historyEntryId).toBe('two');
    expect(machine.begin('redo', 'two').state).toBe('redoing');
  });

  it('makes stale entries explicit and never silently skips them', () => {
    const machine = new OperationHistoryStateMachine([entry('one', 1)]);
    machine.markStale('one', 'PATH_OCCUPIED');

    expect(machine.status('library-1')).toMatchObject({
      undoTop: null,
      redoTop: null,
      staleTop: { historyEntryId: 'one', staleCode: 'PATH_OCCUPIED' },
    });
    expect(() => machine.begin('undo', 'one')).toThrowError(
      /stale/u,
    );
    expect(machine.entries[0]).toMatchObject({ state: 'stale', staleCode: 'PATH_OCCUPIED' });
  });

  it('blocks older stack entries behind a newer stale entry', () => {
    const machine = new OperationHistoryStateMachine([
      entry('older', 1),
      { ...entry('newer', 2), state: 'stale', staleCode: 'VERSION_CONFLICT' },
    ]);

    expect(machine.status('library-1')).toMatchObject({
      undoTop: null,
      redoTop: null,
      staleTop: { historyEntryId: 'newer' },
    });
    expect(() => machine.begin('undo', 'older')).toThrowError(
      /No history entry is available/u,
    );
  });

  it('treats a permanent-delete barrier as the start of a new undo segment', () => {
    const machine = new OperationHistoryStateMachine([
      entry('before', 1, 'undone'),
      entry('barrier', 2, 'applied', 'barrier'),
    ]);

    expect(machine.status('library-1')).toMatchObject({ undoTop: null, redoTop: null });
  });

  it('returns a stable state after a failed transition', () => {
    const machine = new OperationHistoryStateMachine([entry('one', 1)]);
    machine.begin('undo', 'one');
    expect(machine.fail('undo', 'one', 'FILE_BUSY').state).toBe('stale');
    expect(machine.status('library-1').transitionInProgress).toBe(false);
  });
});
