import {
  folderMenuId,
  folderMenuLabel,
  parseFolderMenuId,
  pushRecentFolderId,
  RECENT_FOLDER_IDS_KEY,
  sortFoldersForMenu,
  type ExtensionFolderOption,
} from './folder-menu';
import {
  deliverSaveIntent,
  fetchSerpentFolders,
  notificationForOutcome,
  probeSerpentConnection,
  saveIntentFromContextMenu,
  type SaveIntent,
  type UserNotification,
} from './save-client';

const MENU_ROOT_ID = 'serpent-save';
const MENU_ROOT_FOLDER_ID = 'serpent-save-root';
const CONNECTION_ALARM = 'serpent-connection-check';
const ICON_SIZES = [16, 32, 48, 128] as const;

let notificationSequence = 0;
let connectionState: 'connected' | 'disconnected' = 'disconnected';
let dynamicFolderMenuIds: string[] = [];
let folderMenuRefreshPromise: Promise<void> | null = null;

function readPairingToken(): Promise<string | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get('pairingToken', (values) => {
      void chrome.runtime.lastError;
      const value = values.pairingToken;
      resolve(typeof value === 'string' && value.length > 0 ? value : undefined);
    });
  });
}

function readRecentFolderIds(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(RECENT_FOLDER_IDS_KEY, (values) => {
      void chrome.runtime.lastError;
      const stored = values[RECENT_FOLDER_IDS_KEY];
      resolve(Array.isArray(stored) ? stored.filter((entry) => typeof entry === 'string') : []);
    });
  });
}

function writeRecentFolderIds(recentFolderIds: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [RECENT_FOLDER_IDS_KEY]: recentFolderIds }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function createMenuItem(properties: {
  id: string;
  title: string;
  contexts: Array<'image' | 'video'>;
  parentId?: string;
}): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.create(properties, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function setToolbarIcon(connected: boolean): void {
  const suffix = connected ? '' : '-gray';
  const path: Record<string, string> = {};
  for (const size of ICON_SIZES) {
    path[String(size)] = `icons/icon${suffix}-${size}.png`;
  }
  chrome.action.setIcon({ path }, () => {
    void chrome.runtime.lastError;
  });
  chrome.action.setTitle({
    title: connected
      ? 'Serpent 已连接'
      : 'Serpent 未连接，请启动桌面应用并完成配对',
  });
}

function removeMenuItem(id: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.remove(id, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function removeDynamicFolderMenus(): Promise<void> {
  const ids = [...dynamicFolderMenuIds];
  dynamicFolderMenuIds = [];
  for (const id of ids) {
    await removeMenuItem(id);
  }
}

async function createStaticMenus(): Promise<void> {
  await createMenuItem({
    id: MENU_ROOT_ID,
    title: '保存到 Serpent',
    contexts: ['image', 'video'],
  });
  await createMenuItem({
    id: MENU_ROOT_FOLDER_ID,
    parentId: MENU_ROOT_ID,
    title: '根目录',
    contexts: ['image', 'video'],
  });
}

async function installMenus(): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
  await createStaticMenus();
}

async function refreshFolderMenus(): Promise<void> {
  if (folderMenuRefreshPromise) return folderMenuRefreshPromise;

  folderMenuRefreshPromise = (async () => {
    if (connectionState !== 'connected') {
      await removeDynamicFolderMenus();
      return;
    }

    const token = await readPairingToken();
    if (!token) {
      await removeDynamicFolderMenus();
      return;
    }

    const outcome = await fetchSerpentFolders(token);
    if (outcome.kind !== 'ok') {
      await removeDynamicFolderMenus();
      return;
    }

    await removeDynamicFolderMenus();

    const recentFolderIds = await readRecentFolderIds();
    const validFolderIds = new Set(outcome.folders.map((folder) => folder.folderId));
    const sorted = sortFoldersForMenu(
      outcome.folders,
      recentFolderIds.filter((folderId) => validFolderIds.has(folderId)),
    );

    for (const folder of sorted) {
      const id = folderMenuId(folder.folderId);
      dynamicFolderMenuIds.push(id);
      await createMenuItem({
        id,
        parentId: MENU_ROOT_ID,
        title: folderMenuLabel(folder),
        contexts: ['image', 'video'],
      });
    }
  })().finally(() => {
    folderMenuRefreshPromise = null;
  });

  return folderMenuRefreshPromise;
}

async function refreshConnectionState(): Promise<void> {
  const token = await readPairingToken();
  const outcome = await probeSerpentConnection(token);
  const nextState = outcome.kind === 'connected' ? 'connected' : 'disconnected';
  connectionState = nextState;
  setToolbarIcon(nextState === 'connected');
  await refreshFolderMenus();
}

function scheduleConnectionChecks(): void {
  chrome.alarms.create(CONNECTION_ALARM, { periodInMinutes: 0.5 });
  void refreshConnectionState();
}

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

async function rememberRecentFolder(
  targetFolderId: string | null,
  folders: readonly ExtensionFolderOption[],
): Promise<void> {
  const validFolderIds = new Set(folders.map((folder) => folder.folderId));
  const recentFolderIds = await readRecentFolderIds();
  await writeRecentFolderIds(
    pushRecentFolderId(recentFolderIds, targetFolderId, validFolderIds),
  );
}

async function handleContextMenuClick(
  info: SerpentContextMenuClickData,
): Promise<void> {
  const targetFolderId = parseFolderMenuId(info.menuItemId);
  if (targetFolderId === undefined) return;

  const intent = saveIntentFromContextMenu(info);
  if (!intent) {
    showNotification({
      title: '无法保存到 Serpent',
      message: '这个媒体或页面不是可下载的 HTTP(S) 地址。',
    });
    return;
  }

  const pairingToken = await readPairingToken();
  if (!pairingToken) {
    showNotification({
      title: '需要与 Serpent 配对',
      message: '请打开扩展选项，粘贴桌面应用中的浏览器扩展配对码。',
    });
    return;
  }

  const saveIntent: SaveIntent = {
    ...intent,
    targetFolderId,
  };
  const outcome = await deliverSaveIntent(saveIntent, pairingToken);
  if (outcome.kind === 'accepted') {
    const foldersOutcome = await fetchSerpentFolders(pairingToken);
    if (foldersOutcome.kind === 'ok') {
      await rememberRecentFolder(targetFolderId, foldersOutcome.folders);
      await refreshFolderMenus();
    }
  }
  showNotification(notificationForOutcome(outcome));
}

chrome.runtime.onInstalled.addListener(() => {
  void installMenus().then(() => scheduleConnectionChecks());
});

chrome.runtime.onStartup.addListener(() => {
  void installMenus().then(() => scheduleConnectionChecks());
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== CONNECTION_ALARM) return;
  void refreshConnectionState();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  const type = Reflect.get(message, 'type');
  if (type === 'pairing-updated') {
    void refreshConnectionState();
    return;
  }

  if (type === 'serpent-list-folders') {
    void (async () => {
      const pairingToken = await readPairingToken();
      if (!pairingToken) {
        sendResponse({ kind: 'needs_pairing' });
        return;
      }
      const outcome = await fetchSerpentFolders(pairingToken);
      if (outcome.kind === 'ok') {
        const recentFolderIds = await readRecentFolderIds();
        const validFolderIds = new Set(outcome.folders.map((folder) => folder.folderId));
        sendResponse({
          kind: 'ok',
          folders: sortFoldersForMenu(
            outcome.folders,
            recentFolderIds.filter((folderId) => validFolderIds.has(folderId)),
          ),
        });
        return;
      }
      sendResponse({ kind: outcome.kind });
    })();
    return true;
  }

  if (type === 'serpent-save-request') {
    void (async () => {
      const intentValue = Reflect.get(message, 'intent');
      if (!intentValue || typeof intentValue !== 'object') {
        sendResponse({
          notification: {
            title: '无法保存到 Serpent',
            message: '保存请求无效。',
          },
        });
        return;
      }

      const kind = Reflect.get(intentValue, 'kind');
      const sourcePageUrl = Reflect.get(intentValue, 'sourcePageUrl');
      const mediaUrl = Reflect.get(intentValue, 'mediaUrl');
      const targetFolderId = Reflect.get(intentValue, 'targetFolderId');
      if (
        (kind !== 'image' && kind !== 'video') ||
        typeof sourcePageUrl !== 'string' ||
        typeof mediaUrl !== 'string'
      ) {
        sendResponse({
          notification: {
            title: '无法保存到 Serpent',
            message: '这个媒体或页面不是可下载的 HTTP(S) 地址。',
          },
        });
        return;
      }

      const pairingToken = await readPairingToken();
      if (!pairingToken) {
        const notification = {
          title: '需要与 Serpent 配对',
          message: '请打开扩展选项，粘贴桌面应用中的浏览器扩展配对码。',
        };
        showNotification(notification);
        sendResponse({ notification });
        return;
      }

      const saveIntent: SaveIntent = {
        kind,
        sourcePageUrl,
        mediaUrl,
        targetFolderId:
          targetFolderId === null || typeof targetFolderId === 'string'
            ? targetFolderId
            : undefined,
      };
      const outcome = await deliverSaveIntent(saveIntent, pairingToken);
      if (outcome.kind === 'accepted') {
        const foldersOutcome = await fetchSerpentFolders(pairingToken);
        if (foldersOutcome.kind === 'ok') {
          const folderId =
            typeof saveIntent.targetFolderId === 'string'
              ? saveIntent.targetFolderId
              : null;
          await rememberRecentFolder(folderId, foldersOutcome.folders);
          await refreshFolderMenus();
        }
      }
      const notification = notificationForOutcome(outcome);
      showNotification(notification);
      sendResponse({ notification });
    })();
    return true;
  }
});

if (chrome.contextMenus.onShown) {
  chrome.contextMenus.onShown.addListener((info) => {
    if (info.contexts.includes('image') || info.contexts.includes('video')) {
      void refreshFolderMenus();
    }
  });
}

chrome.contextMenus.onClicked.addListener((info) => {
  void handleContextMenuClick(info);
});

void installMenus().then(() => scheduleConnectionChecks());
