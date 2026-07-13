// Manifest V3 service worker for the Serpent browser extension.

import {
  deliverSaveIntent,
  notificationForOutcome,
  saveIntentFromContextMenu,
  type UserNotification,
} from './save-client';

const MENU_ID = 'save-to-serpent';
let notificationSequence = 0;

function createContextMenu(): void {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '保存到 Serpent',
    contexts: ['image', 'video'],
  }, () => {
    // Reading lastError prevents Chrome from reporting an unchecked callback
    // error if policy blocks context-menu creation.
    void chrome.runtime.lastError;
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    createContextMenu();
  });
});

function showNotification(notification: UserNotification): void {
  notificationSequence += 1;
  chrome.notifications.create(
    `serpent-save-${Date.now()}-${notificationSequence}`,
    {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: notification.title,
      message: notification.message,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
}

async function handleContextMenuClick(info: SerpentContextMenuClickData): Promise<void> {
  if (info.menuItemId !== MENU_ID) return;

  // srcUrl and pageUrl are supplied with the contextMenus click itself. They
  // survive MV3 service-worker suspension, unlike an in-memory capture Map.
  const intent = saveIntentFromContextMenu(info);
  if (!intent) {
    showNotification({
      title: '无法保存到 Serpent',
      message: '这个媒体或页面不是可下载的 HTTP(S) 地址。',
    });
    return;
  }

  const pairingToken = await new Promise<string | undefined>((resolve) => {
    chrome.storage.local.get('pairingToken', (values) => {
      void chrome.runtime.lastError;
      const value = values.pairingToken;
      resolve(typeof value === 'string' && value.length > 0 ? value : undefined);
    });
  });
  if (!pairingToken) {
    showNotification({
      title: '需要与 Serpent 配对',
      message: '请打开扩展选项，粘贴桌面应用中的浏览器扩展配对码。',
    });
    return;
  }

  const outcome = await deliverSaveIntent(intent, pairingToken);
  showNotification(notificationForOutcome(outcome));
}

chrome.contextMenus.onClicked.addListener((info) => {
  void handleContextMenuClick(info);
});
