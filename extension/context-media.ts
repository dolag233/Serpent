import { isHttpUrl, type MediaTarget } from './media-target';

export interface ContextMediaSnapshot {
  media: MediaTarget;
  sourceUrls: string[];
  at: number;
}

export function matchingContextMedia(
  snapshot: ContextMediaSnapshot | null,
  srcUrl: unknown,
  now = Date.now(),
): { mediaUrl: string; originalMediaUrl?: string } | null {
  if (!snapshot || now - snapshot.at >= 60_000 || typeof srcUrl !== 'string') return null;
  if (!snapshot.sourceUrls.includes(srcUrl)) return null;
  return {
    mediaUrl: snapshot.media.mediaUrl,
    ...(snapshot.media.originalMediaUrl
      ? { originalMediaUrl: snapshot.media.originalMediaUrl }
      : {}),
  };
}

export function readContextMedia(
  tabId: number | undefined,
  srcUrl: string | undefined,
  frameId: number | undefined,
): Promise<{ mediaUrl?: string; originalMediaUrl?: string } | null> {
  if (tabId === undefined || !srcUrl) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onResponse = (response?: unknown) => {
      void chrome.runtime.lastError;
      if (!response || typeof response !== 'object') return resolve(null);
      const mediaUrl = Reflect.get(response, 'mediaUrl');
      const originalMediaUrl = Reflect.get(response, 'originalMediaUrl');
      resolve({
        mediaUrl: typeof mediaUrl === 'string' && isHttpUrl(mediaUrl) ? mediaUrl : undefined,
        originalMediaUrl: typeof originalMediaUrl === 'string' && isHttpUrl(originalMediaUrl)
          ? originalMediaUrl : undefined,
      });
    };
    const request = { type: 'serpent-context-media-request', srcUrl };
    if (frameId === undefined) {
      chrome.tabs.sendMessage(tabId, request, onResponse);
    } else {
      chrome.tabs.sendMessage(tabId, request, { frameId }, onResponse);
    }
  });
}
