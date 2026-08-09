import {
  buildSaveMenuFolderHints,
  buildSaveMenuTree,
  folderMenuItemId,
  MENU_ROOT_PARENT_ID,
  parseFolderMenuId,
  pushRecentFolderId,
  RECENT_FOLDER_IDS_KEY,
  sortFoldersForSaveMenu,
  type ExtensionFolderOption,
  type SaveMenuTreeFolder,
} from './folder-menu';
import { saveMenuTitle } from './connection-ui';
import { readExtensionSaveBehavior } from './preferences';
import {
  fetchSerpentFolders,
  notificationForOutcome,
  probeSerpentConnection,
  saveIntentFromContextMenu,
  saveMediaViaBrowser,
  type SaveIntent,
  type UserNotification,
} from './save-client';

const MENU_ROOT_ID = 'serpent-save';
const MENU_ROOT_FOLDER_ID = 'serpent-save-root';
const MENU_SEPARATOR_ID = 'serpent-save-sep';
const CONNECTION_ALARM = 'serpent-connection-check';
const ICON_SIZES = [32, 48, 64, 128] as const;

let notificationSequence = 0;
let connectionState: 'connected' | 'disconnected' = 'disconnected';
let dynamicFolderMenuIds: string[] = [];
let folderMenuRefreshPromise: Promise<void> | null = null;

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
  title?: string;
  contexts?: Array<'image' | 'video'>;
  parentId?: string;
  enabled?: boolean;
  type?: 'normal' | 'separator';
}): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.create(properties, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function updateMenuItem(
  id: string,
  properties: { title?: string; enabled?: boolean },
): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.update(id, properties, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

/** Root context-menu title reflects connection so disabled state is obvious. */
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
      : 'Serpent 未连接，请启动桌面应用并打开资源库',
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
  const connected = connectionState === 'connected';
  await createMenuItem({
    id: MENU_ROOT_ID,
    title: saveMenuTitle(connected),
    contexts: ['image', 'video'],
    enabled: connected,
  });
}

async function syncSaveMenuEnabled(connected: boolean): Promise<void> {
  await updateMenuItem(MENU_ROOT_ID, {
    title: saveMenuTitle(connected),
    enabled: connected,
  });
  for (const id of dynamicFolderMenuIds) {
    await updateMenuItem(id, { enabled: connected });
  }
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

/** 创建文件夹菜单项并递归展开其子级（右键菜单的层级树）。 */
async function createFolderSubmenu(
  parentId: string,
  folder: SaveMenuTreeFolder,
): Promise<void> {
  const id = folderMenuItemId(folder);
  dynamicFolderMenuIds.push(id);
  await createMenuItem({
    id,
    parentId,
    title: folder.name,
    contexts: ['image', 'video'],
    enabled: true,
  });
  for (const child of folder.children) {
    await createFolderSubmenu(id, child);
  }
}

async function refreshFolderMenus(): Promise<void> {
  if (folderMenuRefreshPromise) return folderMenuRefreshPromise;

  folderMenuRefreshPromise = (async () => {
    const connected = connectionState === 'connected';
    await syncSaveMenuEnabled(connected);

    if (!connected) {
      await removeDynamicFolderMenus();
      return;
    }

    const outcome = await fetchSerpentFolders();
    if (outcome.kind !== 'ok') {
      await removeDynamicFolderMenus();
      return;
    }

    await removeDynamicFolderMenus();

    const recentFolderIds = await readRecentFolderIds();
    const hints = buildSaveMenuFolderHints(
      outcome.folders,
      recentFolderIds,
      outcome.recentBrowsedFolderIds,
    );

    // 与拖拽树一致：最近保存/浏览 → 分割线 → 根目录 → 所有一级目录（子级递归展开）。
    let rootParentCreated = false;
    const createRootParentMenu = async (): Promise<void> => {
      if (rootParentCreated) return;
      rootParentCreated = true;
      dynamicFolderMenuIds.push(MENU_ROOT_PARENT_ID);
      await createMenuItem({
        id: MENU_ROOT_PARENT_ID,
        parentId: MENU_ROOT_ID,
        title: '根目录',
        contexts: ['image', 'video'],
        enabled: true,
      });
      dynamicFolderMenuIds.push(MENU_ROOT_FOLDER_ID);
      await createMenuItem({
        id: MENU_ROOT_FOLDER_ID,
        parentId: MENU_ROOT_PARENT_ID,
        title: '保存至此',
        contexts: ['image', 'video'],
        enabled: true,
      });
    };

    let separatorCreated = false;
    for (const item of buildSaveMenuTree(outcome.folders, hints)) {
      if (item.kind === 'separator') {
        if (separatorCreated) continue;
        separatorCreated = true;
        dynamicFolderMenuIds.push(MENU_SEPARATOR_ID);
        await createMenuItem({
          id: MENU_SEPARATOR_ID,
          type: 'separator',
          parentId: MENU_ROOT_ID,
          contexts: ['image', 'video'],
        });
        // 根目录父菜单紧随分割线之后（拖拽树中库名父节点位于列表顶部）
        await createRootParentMenu();
        continue;
      }
      await createFolderSubmenu(MENU_ROOT_ID, item.folder);
    }
    if (!rootParentCreated) {
      // 无分割线（仅最近或仅一级目录）时根目录排在列表末尾
      await createRootParentMenu();
    }
  })().finally(() => {
    folderMenuRefreshPromise = null;
  });

  return folderMenuRefreshPromise;
}

async function refreshConnectionState(): Promise<void> {
  const outcome = await probeSerpentConnection();
  const nextState = outcome.kind === 'connected' ? 'connected' : 'disconnected';
  connectionState = nextState;
  setToolbarIcon(nextState === 'connected');
  await refreshFolderMenus();
}

/**
 * Fast path for content-script probes: ping only, then reply.
 * Folder contextMenus rebuild is deferred — awaiting it here made
 * `serpent-connection-status` miss sendResponse on large libraries
 * (message port closed → drag menu always showed 未连接 while the
 * toolbar icon was already bright). Serpent-a8mm.
 */
async function probeAndReplyConnectionState(): Promise<'connected' | 'disconnected'> {
  const outcome = await probeSerpentConnection();
  const nextState = outcome.kind === 'connected' ? 'connected' : 'disconnected';
  connectionState = nextState;
  setToolbarIcon(nextState === 'connected');
  void refreshFolderMenus();
  return nextState;
}

function scheduleConnectionChecks(): void {
  chrome.alarms.create(CONNECTION_ALARM, { periodInMinutes: 0.5 });
  void refreshConnectionState();
}

function showNotification(notification: UserNotification): void {
  void readExtensionSaveBehavior().then((behavior) => {
    if (!behavior.notificationsEnabled) return;
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
  });
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

async function saveIntentAndNotify(intent: SaveIntent): Promise<UserNotification> {
  const behavior = await readExtensionSaveBehavior();
  const outcome = await saveMediaViaBrowser(intent, behavior);
  if (outcome.kind === 'accepted') {
    const foldersOutcome = await fetchSerpentFolders();
    if (foldersOutcome.kind === 'ok') {
      const folderId =
        typeof intent.targetFolderId === 'string' ? intent.targetFolderId : null;
      await rememberRecentFolder(folderId, foldersOutcome.folders);
      await refreshFolderMenus();
    }
  }
  const notification = notificationForOutcome(outcome);
  showNotification(notification);
  return notification;
}

/** 把保存进度/结果气泡发送到当前标签页（无 content script 时静默忽略）。 */
function notifySaveFeedback(
  tab: { id?: number } | undefined,
  payload:
    | { state: 'saving' }
    | { state: 'done'; title: string; message: string },
): void {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(
    tab.id,
    { type: 'serpent-save-feedback', ...payload },
    () => {
      void chrome.runtime.lastError;
    },
  );
}

async function handleContextMenuClick(
  info: SerpentContextMenuClickData,
): Promise<void> {
  if (connectionState !== 'connected') {
    showNotification({
      title: '无法保存到 Serpent',
      message: '请先启动 Serpent 桌面应用并打开资源库。',
    });
    notifySaveFeedback(info.tab, {
      state: 'done',
      title: '无法保存到 Serpent',
      message: '请先启动 Serpent 桌面应用并打开资源库。',
    });
    return;
  }

  const targetFolderId = parseFolderMenuId(info.menuItemId);
  if (targetFolderId === undefined) return;

  const intent = saveIntentFromContextMenu({
    mediaType: info.mediaType,
    pageUrl: info.pageUrl,
    srcUrl: info.srcUrl,
  });
  if (!intent) {
    showNotification({
      title: '无法保存到 Serpent',
      message: '这个媒体或页面不是可下载的 HTTP(S) 地址。',
    });
    notifySaveFeedback(info.tab, {
      state: 'done',
      title: '无法保存到 Serpent',
      message: '这个媒体或页面不是可下载的 HTTP(S) 地址。',
    });
    return;
  }

  notifySaveFeedback(info.tab, { state: 'saving' });
  const notification = await saveIntentAndNotify({
    ...intent,
    targetFolderId,
  });
  notifySaveFeedback(info.tab, {
    state: 'done',
    title: notification.title,
    message: notification.message,
  });
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

  if (type === 'serpent-connection-status') {
    void probeAndReplyConnectionState()
      .then((kind) => {
        sendResponse({ kind });
      })
      .catch(() => {
        sendResponse({
          kind: connectionState === 'connected' ? 'connected' : 'disconnected',
        });
      });
    return true;
  }

  if (type === 'serpent-list-folders') {
    void (async () => {
      const outcome = await fetchSerpentFolders();
      if (outcome.kind === 'ok') {
        const recentFolderIds = await readRecentFolderIds();
        const hints = buildSaveMenuFolderHints(
          outcome.folders,
          recentFolderIds,
          outcome.recentBrowsedFolderIds,
        );
        sendResponse({
          kind: 'ok',
          folders: sortFoldersForSaveMenu(outcome.folders, hints),
          recentFolderIds: hints.savedRecentIds,
          recentBrowsedFolderIds: hints.browsedRecentIds,
          libraryDisplayName: outcome.libraryDisplayName,
        });
        return;
      }
      sendResponse({ kind: outcome.kind });
    })();
    return true;
  }

  if (type === 'serpent-save-request') {
    void (async () => {
      if (connectionState !== 'connected') {
        const notification = {
          title: '无法保存到 Serpent',
          message: '请先启动 Serpent 桌面应用并打开资源库。',
        };
        showNotification(notification);
        sendResponse({ notification });
        return;
      }

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

      const saveIntent: SaveIntent = {
        kind,
        sourcePageUrl,
        mediaUrl,
        targetFolderId:
          targetFolderId === null || typeof targetFolderId === 'string'
            ? targetFolderId
            : undefined,
      };
      const notification = await saveIntentAndNotify(saveIntent);
      sendResponse({ notification });
    })();
    return true;
  }
});

if (chrome.contextMenus.onShown) {
  chrome.contextMenus.onShown.addListener((info) => {
    if (info.contexts.includes('image') || info.contexts.includes('video')) {
      void refreshConnectionState();
    }
  });
}

chrome.contextMenus.onClicked.addListener((info) => {
  void handleContextMenuClick(info);
});

void installMenus().then(() => scheduleConnectionChecks());
