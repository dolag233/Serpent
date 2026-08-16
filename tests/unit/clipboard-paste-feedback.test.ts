import { describe, expect, it } from 'vitest';

import {
  LibraryOperationError,
  shouldSuppressClipboardPasteFeedback,
  toMessage,
} from '../../src/renderer/error-utils';

describe('shouldSuppressClipboardPasteFeedback', () => {
  it('suppresses empty clipboard and invalid drop selection', () => {
    expect(
      shouldSuppressClipboardPasteFeedback(
        new LibraryOperationError({ code: 'CLIPBOARD_FILES_NOT_FOUND', message: '' }),
      ),
    ).toBe(true);
    expect(
      shouldSuppressClipboardPasteFeedback(
        new LibraryOperationError({ code: 'INVALID_DROP_SELECTION', message: '' }),
      ),
    ).toBe(true);
  });

  it('does not suppress real paste failures', () => {
    expect(
      shouldSuppressClipboardPasteFeedback(
        new LibraryOperationError({ code: 'INVALID_IMPORT_SOURCE', message: '' }),
      ),
    ).toBe(false);
    expect(shouldSuppressClipboardPasteFeedback(new Error('boom'))).toBe(false);
  });
});

describe('toMessage Eagle import stages', () => {
  it('appends distinguishable reasons for parse, copy, and register failures', () => {
    expect(
      toMessage(
        new LibraryOperationError({
          code: 'INVALID_IMPORT_SOURCE',
          message: '',
          reason: 'EAGLE_METADATA_UNREADABLE',
        }),
        'fallback',
        'zh-CN',
      ),
    ).toContain('metadata.json');
    expect(
      toMessage(
        new LibraryOperationError({
          code: 'IMPORT_APPLY_FAILED',
          message: '',
          reason: 'IMPORT_COPY_FAILED',
        }),
        'fallback',
        'zh-CN',
      ),
    ).toContain('复制');
    expect(
      toMessage(
        new LibraryOperationError({
          code: 'IMPORT_APPLY_FAILED',
          message: '',
          reason: 'IMPORT_REGISTER_FAILED',
        }),
        'fallback',
        'zh-CN',
      ),
    ).toContain('登记');
  });
});
