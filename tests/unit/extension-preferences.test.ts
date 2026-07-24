import { describe, expect, it } from 'vitest';

import {
  notificationsEnabledFromStored,
  NOTIFICATIONS_ENABLED_KEY,
} from '../../extension/preferences';

describe('extension notification preference', () => {
  it('defaults notifications to enabled unless explicitly disabled', () => {
    expect(notificationsEnabledFromStored(undefined)).toBe(true);
    expect(notificationsEnabledFromStored(true)).toBe(true);
    expect(notificationsEnabledFromStored(false)).toBe(false);
  });

  it('uses a stable storage key', () => {
    expect(NOTIFICATIONS_ENABLED_KEY).toBe('serpentNotificationsEnabled');
  });
});
