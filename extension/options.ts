import {
  FOCUS_APP_AFTER_SAVE_KEY,
  focusAppAfterSaveFromStored,
  NOTIFICATIONS_ENABLED_KEY,
  notificationsEnabledFromStored,
  REVEAL_IN_LIBRARY_AFTER_SAVE_KEY,
  revealInLibraryAfterSaveFromStored,
  writeFocusAppAfterSave,
  writeNotificationsEnabled,
  writeRevealInLibraryAfterSave,
} from './preferences';

const statusEl = document.getElementById('status');
const notificationsCheckbox = document.getElementById(
  'notifications-enabled',
) as HTMLInputElement | null;
const focusAppCheckbox = document.getElementById(
  'focus-app-after-save',
) as HTMLInputElement | null;
const revealInLibraryCheckbox = document.getElementById(
  'reveal-in-library-after-save',
) as HTMLInputElement | null;

function setStatus(message: string, kind?: 'success' | 'error'): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  if (kind) {
    statusEl.dataset.kind = kind;
  } else {
    delete statusEl.dataset.kind;
  }
}

function loadPreferences(): void {
  chrome.storage.sync.get(
    [
      NOTIFICATIONS_ENABLED_KEY,
      FOCUS_APP_AFTER_SAVE_KEY,
      REVEAL_IN_LIBRARY_AFTER_SAVE_KEY,
    ],
    (values) => {
      void chrome.runtime.lastError;
      if (notificationsCheckbox) {
        notificationsCheckbox.checked = notificationsEnabledFromStored(
          values[NOTIFICATIONS_ENABLED_KEY],
        );
      }
      if (focusAppCheckbox) {
        focusAppCheckbox.checked = focusAppAfterSaveFromStored(
          values[FOCUS_APP_AFTER_SAVE_KEY],
        );
      }
      if (revealInLibraryCheckbox) {
        revealInLibraryCheckbox.checked = revealInLibraryAfterSaveFromStored(
          values[REVEAL_IN_LIBRARY_AFTER_SAVE_KEY],
        );
      }
    },
  );
}

function bindToggle(
  checkbox: HTMLInputElement | null,
  write: (enabled: boolean) => Promise<void>,
): void {
  checkbox?.addEventListener('change', () => {
    const enabled = checkbox.checked;
    void write(enabled).then(() => {
      setStatus('已保存', 'success');
    });
  });
}

bindToggle(notificationsCheckbox, writeNotificationsEnabled);
bindToggle(focusAppCheckbox, writeFocusAppAfterSave);
bindToggle(revealInLibraryCheckbox, writeRevealInLibraryAfterSave);

loadPreferences();
