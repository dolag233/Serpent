interface SerpentContextMenuClickData {
  menuItemId: string | number;
  mediaType?: 'image' | 'video' | 'audio';
  pageUrl?: string;
  srcUrl?: string;
  tab?: { id?: number };
}

interface SerpentContextMenuShownInfo {
  contexts: Array<'image' | 'video' | 'audio' | 'page' | 'selection' | 'link'>;
}

interface SerpentChromeApi {
  runtime: {
    lastError?: { message?: string };
    onInstalled: {
      addListener(callback: () => void): void;
    };
    onStartup: {
      addListener(callback: () => void): void;
    };
    onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    sendMessage(
      message: unknown,
      callback?: (response: unknown) => void,
    ): void;
  };
  action: {
    setIcon(details: { path: Record<string, string> }, callback?: () => void): void;
    setTitle(details: { title: string }, callback?: () => void): void;
  };
  alarms: {
    create(name: string, info: { periodInMinutes: number }): void;
    onAlarm: {
      addListener(callback: (alarm: { name: string }) => void): void;
    };
  };
  contextMenus: {
    create(
      properties: {
        id: string;
        title?: string;
        contexts?: Array<'image' | 'video'>;
        parentId?: string;
        enabled?: boolean;
        type?: 'normal' | 'separator';
      },
      callback?: () => void,
    ): void;
    update(
      id: string,
      properties: {
        title?: string;
        enabled?: boolean;
      },
      callback?: () => void,
    ): void;
    remove(id: string, callback?: () => void): void;
    removeAll(callback?: () => void): void;
    onClicked: {
      addListener(callback: (info: SerpentContextMenuClickData) => void): void;
    };
    onShown?: {
      addListener(callback: (info: SerpentContextMenuShownInfo) => void): void;
    };
  };
  tabs: {
    sendMessage(tabId: number, message: unknown, callback?: () => void): void;
  };
  notifications: {
    create(
      notificationId: string,
      options: {
        type: 'basic';
        iconUrl: string;
        title: string;
        message: string;
      },
      callback?: () => void,
    ): void;
  };
  storage: {
    local: {
      get(
        key: string,
        callback: (values: Record<string, unknown>) => void,
      ): void;
      set(values: Record<string, unknown>, callback?: () => void): void;
    };
    sync: {
      get(
        keys: string | string[] | null,
        callback: (values: Record<string, unknown>) => void,
      ): void;
      set(values: Record<string, unknown>, callback?: () => void): void;
    };
    onChanged: {
      addListener(
        callback: (
          changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
          areaName: string,
        ) => void,
      ): void;
    };
  };
}

declare const chrome: SerpentChromeApi;
