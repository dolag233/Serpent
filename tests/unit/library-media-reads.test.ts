import { afterEach, describe, expect, it } from 'vitest';

import {
  bindLibraryMediaReadSignal,
  blockLibraryMediaReads,
  isLibraryMediaReadBlocked,
  unblockLibraryMediaReads,
} from '../../src/main/library-media-reads';

const LIBRARY_ID = 'lib-delete-reads';

afterEach(() => {
  unblockLibraryMediaReads(LIBRARY_ID);
});

describe('library media reads (Serpent-dfgg)', () => {
  it('aborts live library streams when deletion starts', () => {
    const signal = bindLibraryMediaReadSignal(LIBRARY_ID);
    expect(signal.aborted).toBe(false);
    expect(isLibraryMediaReadBlocked(LIBRARY_ID)).toBe(false);

    blockLibraryMediaReads(LIBRARY_ID);

    expect(isLibraryMediaReadBlocked(LIBRARY_ID)).toBe(true);
    expect(signal.aborted).toBe(true);
  });

  it('combines Chromium cancel with the library abort', () => {
    const request = new AbortController();
    const signal = bindLibraryMediaReadSignal(LIBRARY_ID, request.signal);
    expect(signal.aborted).toBe(false);

    request.abort();
    expect(signal.aborted).toBe(true);
  });

  it('returns an already-aborted signal for blocked libraries', () => {
    blockLibraryMediaReads(LIBRARY_ID);
    const signal = bindLibraryMediaReadSignal(LIBRARY_ID);
    expect(signal.aborted).toBe(true);
  });

  it('allows new reads after a failed delete reopens the library', () => {
    const first = bindLibraryMediaReadSignal(LIBRARY_ID);
    blockLibraryMediaReads(LIBRARY_ID);
    expect(first.aborted).toBe(true);

    unblockLibraryMediaReads(LIBRARY_ID);
    expect(isLibraryMediaReadBlocked(LIBRARY_ID)).toBe(false);

    const second = bindLibraryMediaReadSignal(LIBRARY_ID);
    expect(second.aborted).toBe(false);
  });
});
