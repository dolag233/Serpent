import { describe, expect, it } from 'vitest';

import {
  focusAppAfterSaveFromStored,
  FOCUS_APP_AFTER_SAVE_KEY,
  notificationsEnabledFromStored,
  NOTIFICATIONS_ENABLED_KEY,
  revealInLibraryAfterSaveFromStored,
  REVEAL_IN_LIBRARY_AFTER_SAVE_KEY,
} from '../../extension/preferences';

describe('extension save preferences', () => {
  it('defaults notifications to enabled unless explicitly disabled', () => {
    expect(notificationsEnabledFromStored(undefined)).toBe(true);
    expect(notificationsEnabledFromStored(true)).toBe(true);
    expect(notificationsEnabledFromStored(false)).toBe(false);
  });

  it('defaults focus and reveal behaviors to enabled unless explicitly disabled', () => {
    expect(focusAppAfterSaveFromStored(undefined)).toBe(true);
    expect(focusAppAfterSaveFromStored(false)).toBe(false);
    expect(revealInLibraryAfterSaveFromStored(undefined)).toBe(true);
    expect(revealInLibraryAfterSaveFromStored(false)).toBe(false);
  });

  it('uses stable storage keys', () => {
    expect(NOTIFICATIONS_ENABLED_KEY).toBe('serpentNotificationsEnabled');
    expect(FOCUS_APP_AFTER_SAVE_KEY).toBe('serpentFocusAppAfterSave');
    expect(REVEAL_IN_LIBRARY_AFTER_SAVE_KEY).toBe(
      'serpentRevealInLibraryAfterSave',
    );
  });
});
