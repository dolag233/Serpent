import { describe, expect, it } from 'vitest';

import {
  LibraryOperationError,
  shouldSuppressClipboardPasteFeedback,
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
