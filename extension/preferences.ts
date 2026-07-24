/// <reference path="./chrome.d.ts" />

export const NOTIFICATIONS_ENABLED_KEY = 'serpentNotificationsEnabled';

/** Default on so first-time users still see save feedback. */
export function notificationsEnabledFromStored(value: unknown): boolean {
  return value !== false;
}

export function readNotificationsEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(NOTIFICATIONS_ENABLED_KEY, (values) => {
      void chrome.runtime.lastError;
      resolve(notificationsEnabledFromStored(values[NOTIFICATIONS_ENABLED_KEY]));
    });
  });
}

export function writeNotificationsEnabled(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [NOTIFICATIONS_ENABLED_KEY]: enabled }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}
