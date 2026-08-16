import { describe, expect, it, vi } from 'vitest';

import {
  isRetryableRenameError,
  removeLibraryRootWithRetry,
  removePathWithSyncRetry,
  renamePathWithRetry,
} from '../../src/worker/windows-fs-retry';

describe('renamePathWithRetry (Windows folder-trash staging rename)', () => {
  it('renames immediately when the first attempt succeeds', () => {
    const renameFn = vi.fn();
    const waitFn = vi.fn();
    renamePathWithRetry('/from', '/to', { renameFn, waitFn });
    expect(renameFn).toHaveBeenCalledTimes(1);
    expect(renameFn).toHaveBeenCalledWith('/from', '/to');
    expect(waitFn).not.toHaveBeenCalled();
  });

  it('retries transient EBUSY locks and succeeds', () => {
    const renameFn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      })
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      })
      .mockImplementationOnce(() => undefined);
    const waitFn = vi.fn();
    renamePathWithRetry('/from', '/to', { renameFn, waitFn });
    expect(renameFn).toHaveBeenCalledTimes(3);
    // Backoff grows: 150ms * 1, then 150ms * 2.
    expect(waitFn).toHaveBeenNthCalledWith(1, 150);
    expect(waitFn).toHaveBeenNthCalledWith(2, 300);
  });

  it('gives up after the retry limit and rethrows the original error', () => {
    const busy = Object.assign(new Error('locked'), { code: 'EPERM' });
    const renameFn = vi.fn(() => {
      throw busy;
    });
    const waitFn = vi.fn();
    expect(() =>
      renamePathWithRetry('/from', '/to', { renameFn, waitFn }),
    ).toThrow(busy);
    // 1 initial attempt + 4 retries.
    expect(renameFn).toHaveBeenCalledTimes(5);
    expect(waitFn).toHaveBeenCalledTimes(4);
  });

  it('propagates non-retryable errors immediately', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const renameFn = vi.fn(() => {
      throw missing;
    });
    const waitFn = vi.fn();
    expect(() =>
      renamePathWithRetry('/from', '/to', { renameFn, waitFn }),
    ).toThrow(missing);
    expect(renameFn).toHaveBeenCalledTimes(1);
    expect(waitFn).not.toHaveBeenCalled();
  });

  it('treats EBUSY / EPERM / EACCES as retryable and nothing else', () => {
    expect(isRetryableRenameError(Object.assign(new Error('x'), { code: 'EBUSY' }))).toBe(true);
    expect(isRetryableRenameError(Object.assign(new Error('x'), { code: 'EPERM' }))).toBe(true);
    expect(isRetryableRenameError(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(true);
    expect(isRetryableRenameError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(false);
    expect(isRetryableRenameError(new Error('no code'))).toBe(false);
  });
});

describe('removePathWithSyncRetry (operation-directory cleanup)', () => {
  it('removes immediately when the first attempt succeeds', () => {
    const rmFn = vi.fn();
    const waitFn = vi.fn();
    removePathWithSyncRetry('/op', { rmFn, waitFn });
    expect(rmFn).toHaveBeenCalledTimes(1);
    expect(rmFn).toHaveBeenCalledWith('/op', { force: true, recursive: true });
    expect(waitFn).not.toHaveBeenCalled();
  });

  it('retries transient ENOTEMPTY (Defender scan of staged files) and succeeds', () => {
    const rmFn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('not empty'), { code: 'ENOTEMPTY' });
      })
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      })
      .mockImplementationOnce(() => undefined);
    const waitFn = vi.fn();
    removePathWithSyncRetry('/op', { rmFn, waitFn });
    expect(rmFn).toHaveBeenCalledTimes(3);
    expect(waitFn).toHaveBeenNthCalledWith(1, 150);
    expect(waitFn).toHaveBeenNthCalledWith(2, 300);
  });

  it('gives up after the retry limit and rethrows the original error', () => {
    const notEmpty = Object.assign(new Error('not empty'), { code: 'ENOTEMPTY' });
    const rmFn = vi.fn(() => {
      throw notEmpty;
    });
    const waitFn = vi.fn();
    expect(() => removePathWithSyncRetry('/op', { rmFn, waitFn })).toThrow(notEmpty);
    expect(rmFn).toHaveBeenCalledTimes(5);
    expect(waitFn).toHaveBeenCalledTimes(4);
  });
});

describe('removeLibraryRootWithRetry (Serpent-dfgg)', () => {
  it('retries EPERM then deletes the original path', () => {
    const rmFn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('locked'), { code: 'EPERM' });
      })
      .mockImplementationOnce(() => undefined);
    const waitFn = vi.fn();
    const renameFn = vi.fn();
    removeLibraryRootWithRetry('/library', {
      rmFn,
      waitFn,
      renameFn,
      retryLimit: 4,
      retryDelayMs: 10,
    });
    expect(rmFn).toHaveBeenCalledTimes(2);
    expect(renameFn).not.toHaveBeenCalled();
  });

  it('renames the root aside when rm keeps failing and treats the original path as gone', () => {
    const busy = Object.assign(new Error('not empty'), { code: 'ENOTEMPTY' });
    const rmFn = vi.fn(() => {
      throw busy;
    });
    const renameFn = vi.fn();
    const waitFn = vi.fn();
    const existsFn = vi.fn((targetPath: string) => targetPath === '/library.del-99');
    removeLibraryRootWithRetry('/library', {
      rmFn,
      waitFn,
      renameFn,
      existsFn,
      nowFn: () => 99,
      retryLimit: 1,
      retryDelayMs: 10,
    });
    expect(renameFn).toHaveBeenCalledWith('/library', '/library.del-99');
    expect(existsFn).toHaveBeenCalledWith('/library');
  });

  it('rethrows the original rm error when rename-aside also fails', () => {
    const busy = Object.assign(new Error('locked'), { code: 'EPERM' });
    const rmFn = vi.fn(() => {
      throw busy;
    });
    const renameFn = vi.fn(() => {
      throw Object.assign(new Error('still locked'), { code: 'EPERM' });
    });
    const waitFn = vi.fn();
    expect(() =>
      removeLibraryRootWithRetry('/library', {
        rmFn,
        waitFn,
        renameFn,
        retryLimit: 0,
        retryDelayMs: 10,
      }),
    ).toThrow(busy);
  });
});
