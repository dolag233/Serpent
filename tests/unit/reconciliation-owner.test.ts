import { describe, expect, it } from 'vitest';

import { LibraryReconciliationOwner } from '../../src/worker/reconciliation-owner';

describe('LibraryReconciliationOwner', () => {
  it('advances generation independently of the current task slot', () => {
    const owner = new LibraryReconciliationOwner<{ id: string }>();
    const first = owner.register({
      libraryId: 'library-1',
      openLibrary: { id: 'open-1' },
      reason: 'open',
    });
    expect(first.generation).toBe(1);
    expect(owner.isCurrent(first)).toBe(true);

    owner.clearIfCurrent(first);
    expect(owner.current('library-1')).toBeUndefined();
    expect(owner.generation('library-1')).toBe(1);

    const second = owner.register({
      libraryId: 'library-1',
      openLibrary: { id: 'open-2' },
      reason: 'watcher',
    });
    expect(second.generation).toBe(2);
    expect(owner.isCurrent(first)).toBe(false);
    expect(owner.isCurrent(second)).toBe(true);
  });

  it('aborts only the registered controller and forgets a superseded task', () => {
    const owner = new LibraryReconciliationOwner<{ id: string }>();
    const first = owner.register({
      libraryId: 'library-1',
      openLibrary: { id: 'open-1' },
      reason: 'open',
    });
    owner.abort('library-1');
    expect(first.controller.signal.aborted).toBe(true);

    const second = owner.register({
      libraryId: 'library-1',
      openLibrary: { id: 'open-2' },
      reason: 'network',
    });
    owner.clearIfCurrent(first);
    expect(owner.isCurrent(second)).toBe(true);

    const error = owner.abortError();
    expect(error.name).toBe('AbortError');
    expect(error.message).toBe('Open-library reconciliation was cancelled.');
  });
});
