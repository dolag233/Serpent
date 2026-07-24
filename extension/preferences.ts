/// <reference path="./chrome.d.ts" />

export const NOTIFICATIONS_ENABLED_KEY = 'serpentNotificationsEnabled';
export const FOCUS_APP_AFTER_SAVE_KEY = 'serpentFocusAppAfterSave';
export const REVEAL_IN_LIBRARY_AFTER_SAVE_KEY = 'serpentRevealInLibraryAfterSave';

/** Default on so first-time users still see save feedback. */
export function notificationsEnabledFromStored(value: unknown): boolean {
  return value !== false;
}

/** Default on so Serpent surfaces after a browser save. */
export function focusAppAfterSaveFromStored(value: unknown): boolean {
  return value !== false;
}

/** Default on so the saved asset is easy to find in the library. */
export function revealInLibraryAfterSaveFromStored(value: unknown): boolean {
  return value !== false;
}

export type ExtensionSaveBehavior = {
  notificationsEnabled: boolean;
  focusAppAfterSave: boolean;
  revealInLibraryAfterSave: boolean;
};

export function readExtensionSaveBehavior(): Promise<ExtensionSaveBehavior> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      [
        NOTIFICATIONS_ENABLED_KEY,
        FOCUS_APP_AFTER_SAVE_KEY,
        REVEAL_IN_LIBRARY_AFTER_SAVE_KEY,
      ],
      (values) => {
        void chrome.runtime.lastError;
        resolve({
          notificationsEnabled: notificationsEnabledFromStored(
            values[NOTIFICATIONS_ENABLED_KEY],
          ),
          focusAppAfterSave: focusAppAfterSaveFromStored(
            values[FOCUS_APP_AFTER_SAVE_KEY],
          ),
          revealInLibraryAfterSave: revealInLibraryAfterSaveFromStored(
            values[REVEAL_IN_LIBRARY_AFTER_SAVE_KEY],
          ),
        });
      },
    );
  });
}

export function readNotificationsEnabled(): Promise<boolean> {
  return readExtensionSaveBehavior().then(
    (behavior) => behavior.notificationsEnabled,
  );
}

export function writeNotificationsEnabled(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [NOTIFICATIONS_ENABLED_KEY]: enabled }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

export function writeFocusAppAfterSave(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [FOCUS_APP_AFTER_SAVE_KEY]: enabled }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

export function writeRevealInLibraryAfterSave(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(
      { [REVEAL_IN_LIBRARY_AFTER_SAVE_KEY]: enabled },
      () => {
        void chrome.runtime.lastError;
        resolve();
      },
    );
  });
}
