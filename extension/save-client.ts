import type { ExtensionFolderOption } from './folder-menu';

export const SERPENT_PORTS = [19876, 19877, 19878] as const;

const SERPENT_HOST = 'http://127.0.0.1';
/** Keep in sync with Main MAX_EXTENSION_UPLOAD_BYTES. */
export const MAX_BROWSER_FETCH_BYTES = 500 * 1024 * 1024;

export interface SaveIntent {
  kind: 'image' | 'video';
  sourcePageUrl: string;
  mediaUrl: string;
  targetFolderId?: string | null;
}

export interface ContextMenuMediaInfo {
  mediaType?: 'image' | 'video' | 'audio';
  pageUrl?: string;
  srcUrl?: string;
}

export type SaveOutcome =
  | { kind: 'accepted' }
  | { kind: 'rejected'; status: number; reason: string }
  | { kind: 'unreachable' }
  | { kind: 'fetch_failed'; reason: string };

export type ConnectionOutcome =
  | { kind: 'connected' }
  | { kind: 'offline' };

export type FolderListOutcome =
  | { kind: 'ok'; folders: ExtensionFolderOption[] }
  | { kind: 'rejected'; status: number; reason: string }
  | { kind: 'unreachable' };

export interface UserNotification {
  title: string;
  message: string;
}

export interface FetchedMedia {
  body: ArrayBuffer;
  contentType: string;
  filename: string;
}

type FetchHeaders = { get(name: string): string | null };
type FetchResponse = {
  status: number;
  ok: boolean;
  headers: FetchHeaders;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
};
type FetchFunction = (
  input: string,
  init?: RequestInit,
) => Promise<FetchResponse>;

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function saveIntentFromContextMenu(
  info: ContextMenuMediaInfo,
): SaveIntent | undefined {
  if (!isHttpUrl(info.srcUrl) || !isHttpUrl(info.pageUrl)) return undefined;

  return {
    kind: info.mediaType === 'video' ? 'video' : 'image',
    sourcePageUrl: info.pageUrl,
    mediaUrl: info.srcUrl,
  };
}

function rejectionReason(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;

    for (const key of ['reason', 'message', 'error']) {
      const value = Reflect.get(parsed, key);
      if (typeof value === 'string' && value.trim()) {
        return value.trim().slice(0, 240);
      }
    }
  } catch {
    const trimmed = body.trim();
    return trimmed ? trimmed.slice(0, 240) : undefined;
  }

  return undefined;
}

async function requestSerpent(
  path: string,
  init: RequestInit,
  fetchFn: FetchFunction,
): Promise<FetchResponse | null> {
  for (const port of SERPENT_PORTS) {
    try {
      return await fetchFn(`${SERPENT_HOST}:${port}${path}`, init);
    } catch {
      // Serpent may have selected the next fallback port.
    }
  }
  return null;
}

export async function probeSerpentConnection(
  fetchFn: FetchFunction = fetch,
): Promise<ConnectionOutcome> {
  const ping = await requestSerpent('/ping', { method: 'GET' }, fetchFn);
  if (!ping) return { kind: 'offline' };
  if (ping.status !== 200) return { kind: 'offline' };

  const folders = await requestSerpent('/folders', { method: 'GET' }, fetchFn);
  if (!folders) return { kind: 'offline' };
  // 200 = library open; 503 = app up but no library — still "connected" for icon.
  if (folders.status === 200 || folders.status === 503) return { kind: 'connected' };
  return { kind: 'connected' };
}

function parseFolderList(body: string): ExtensionFolderOption[] {
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== 'object') return [];
  const folders = Reflect.get(parsed, 'folders');
  if (!Array.isArray(folders)) return [];

  return folders.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const folderId = Reflect.get(entry, 'folderId');
    const name = Reflect.get(entry, 'name');
    const relativePath = Reflect.get(entry, 'relativePath');
    if (
      typeof folderId !== 'string' ||
      typeof name !== 'string' ||
      typeof relativePath !== 'string'
    ) {
      return [];
    }
    return [{ folderId, name, relativePath }];
  });
}

export async function fetchSerpentFolders(
  fetchFn: FetchFunction = fetch,
): Promise<FolderListOutcome> {
  const response = await requestSerpent('/folders', { method: 'GET' }, fetchFn);
  if (!response) return { kind: 'unreachable' };

  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }

  if (response.status === 200) {
    return { kind: 'ok', folders: parseFolderList(body) };
  }

  return {
    kind: 'rejected',
    status: response.status,
    reason: rejectionReason(body) ?? `HTTP ${response.status}`,
  };
}

function filenameFromUrl(mediaUrl: string, contentType: string): string {
  try {
    const pathname = new URL(mediaUrl).pathname;
    const base = pathname.split('/').filter(Boolean).pop();
    if (base && base.includes('.')) return decodeURIComponent(base);
  } catch {
    // Fall through.
  }
  if (contentType.startsWith('video/')) return 'video.bin';
  if (contentType === 'image/png') return 'image.png';
  if (contentType === 'image/jpeg') return 'image.jpg';
  if (contentType === 'image/webp') return 'image.webp';
  if (contentType === 'image/gif') return 'image.gif';
  return 'download.bin';
}

/**
 * Fetch media in the browser with cookies + page referrer (Serpent-1jyi).
 * This is the anti-hotlink path; Serpent no longer re-downloads the URL.
 */
export async function fetchMediaInBrowser(
  intent: SaveIntent,
  fetchFn: FetchFunction = fetch,
): Promise<FetchedMedia | { error: string }> {
  let response: FetchResponse;
  try {
    response = await fetchFn(intent.mediaUrl, {
      method: 'GET',
      credentials: 'include',
      referrer: intent.sourcePageUrl,
      referrerPolicy: 'unsafe-url',
      cache: 'no-store',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message.slice(0, 200) || 'network error' };
  }

  if (!response.ok) {
    return { error: `HTTP ${response.status}` };
  }

  const contentTypeHeader = response.headers.get('content-type') ?? '';
  const contentType = contentTypeHeader.split(';')[0]?.trim().toLowerCase() ||
    (intent.kind === 'video' ? 'video/mp4' : 'image/jpeg');

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BROWSER_FETCH_BYTES) {
    return { error: 'file too large' };
  }

  let body: ArrayBuffer;
  try {
    body = await response.arrayBuffer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message.slice(0, 200) || 'read failed' };
  }

  if (body.byteLength === 0) return { error: 'empty body' };
  if (body.byteLength > MAX_BROWSER_FETCH_BYTES) return { error: 'file too large' };

  return {
    body,
    contentType,
    filename: filenameFromUrl(intent.mediaUrl, contentType),
  };
}

export async function deliverSaveUpload(
  intent: SaveIntent,
  media: FetchedMedia,
  fetchFn: FetchFunction = fetch,
): Promise<SaveOutcome> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(media.body.byteLength),
    'X-Serpent-Kind': intent.kind,
    'X-Serpent-Source-Page-Url': encodeURIComponent(intent.sourcePageUrl),
    'X-Serpent-Media-Url': encodeURIComponent(intent.mediaUrl),
    'X-Serpent-Content-Type': media.contentType,
    'X-Serpent-Filename': encodeURIComponent(media.filename),
  };
  if (intent.targetFolderId !== undefined) {
    headers['X-Serpent-Target-Folder-Id'] =
      intent.targetFolderId === null ? 'null' : encodeURIComponent(intent.targetFolderId);
  }

  const response = await requestSerpent(
    '/save-upload',
    {
      method: 'POST',
      headers,
      body: media.body,
    },
    fetchFn,
  );
  if (!response) return { kind: 'unreachable' };

  if (response.status === 202) {
    return { kind: 'accepted' };
  }

  let body = '';
  try {
    body = await response.text();
  } catch {
    // Status alone is still actionable.
  }

  return {
    kind: 'rejected',
    status: response.status,
    reason: rejectionReason(body) ?? `HTTP ${response.status}`,
  };
}

/** Preferred path: browser fetch + upload. Falls back is not used (anti-hotlink). */
export async function saveMediaViaBrowser(
  intent: SaveIntent,
  fetchFn: FetchFunction = fetch,
): Promise<SaveOutcome> {
  const fetched = await fetchMediaInBrowser(intent, fetchFn);
  if ('error' in fetched) {
    return { kind: 'fetch_failed', reason: fetched.error };
  }
  return deliverSaveUpload(intent, fetched, fetchFn);
}

export function notificationForOutcome(outcome: SaveOutcome): UserNotification {
  switch (outcome.kind) {
    case 'accepted':
      return {
        title: '已发送到 Serpent',
        message: 'Serpent 已接收保存请求。',
      };
    case 'rejected':
      return {
        title: 'Serpent 拒绝了保存请求',
        message: `HTTP ${outcome.status}：${outcome.reason}`,
      };
    case 'unreachable':
      return {
        title: '无法连接 Serpent',
        message: '请先启动 Serpent 桌面应用并打开资源库，然后重新保存。',
      };
    case 'fetch_failed':
      return {
        title: '浏览器无法下载该媒体',
        message: `下载失败：${outcome.reason}`,
      };
  }
}
