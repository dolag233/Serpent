import {
  NOTIFICATIONS_ENABLED_KEY,
  notificationsEnabledFromStored,
  writeNotificationsEnabled,
} from './preferences';

const statusEl = document.getElementById('status');
const notificationsCheckbox = document.getElementById(
  'notifications-enabled',
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
  chrome.storage.sync.get(NOTIFICATIONS_ENABLED_KEY, (values) => {
    void chrome.runtime.lastError;
    if (notificationsCheckbox) {
      notificationsCheckbox.checked = notificationsEnabledFromStored(
        values[NOTIFICATIONS_ENABLED_KEY],
      );
    }
    setStatus('加载已解压扩展后，保持 Serpent 运行即可保存。');
  });
}

notificationsCheckbox?.addEventListener('change', () => {
  const enabled = notificationsCheckbox.checked;
  void writeNotificationsEnabled(enabled).then(() => {
    setStatus(
      enabled ? '已开启系统通知。' : '已关闭系统通知。',
      'success',
    );
  });
});

loadPreferences();
