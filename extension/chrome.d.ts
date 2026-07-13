interface SerpentContextMenuClickData {
  menuItemId: string | number;
  mediaType?: 'image' | 'video' | 'audio';
  pageUrl?: string;
  srcUrl?: string;
}

interface SerpentChromeApi {
  runtime: {
    lastError?: { message?: string };
    onInstalled: {
      addListener(callback: () => void): void;
    };
  };
  contextMenus: {
    create(
      properties: {
        id: string;
        title: string;
        contexts: Array<'image' | 'video'>;
      },
      callback?: () => void,
    ): void;
    removeAll(callback?: () => void): void;
    onClicked: {
      addListener(callback: (info: SerpentContextMenuClickData) => void): void;
    };
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
      get(key: string, callback: (values: Record<string, unknown>) => void): void;
      set(values: Record<string, unknown>, callback?: () => void): void;
    };
  };
}

declare const chrome: SerpentChromeApi;
