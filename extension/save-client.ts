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
  | { kind: 'ok'; folders: ExtensionFolderOption[]; recentBrowsedFolderIds: string[] }
  | { kind: 'rejected'; status: number; reason: string }
  | { kind: 'unreachable' };

import type { ExtensionSaveBehavior } from './preferences';

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

function parseFolderList(body: string): {
  folders: ExtensionFolderOption[];
  recentBrowsedFolderIds: string[];
} {
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    return { folders: [], recentBrowsedFolderIds: [] };
  }
  const folders = Reflect.get(parsed, 'folders');
  const recentBrowsedFolderIds = Reflect.get(parsed, 'recentBrowsedFolderIds');
  const folderList = !Array.isArray(folders) ? [] : folders.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const folderId = Reflect.get(entry, 'folderId');
    const name = Reflect.get(entry, 'name');
    const relativePath = Reflect.get(entry, 'relativePath');
    const assetCount = Reflect.get(entry, 'assetCount');
    if (
      typeof folderId !== 'string' ||
      typeof name !== 'string' ||
      typeof relativePath !== 'string'
    ) {
      return [];
    }
    return [{
      folderId,
      name,
      relativePath,
      ...(typeof assetCount === 'number' && Number.isFinite(assetCount)
        ? { assetCount: Math.max(0, Math.floor(assetCount)) }
        : {}),
    }];
  });
  const browsed = Array.isArray(recentBrowsedFolderIds)
    ? recentBrowsedFolderIds.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return { folders: folderList, recentBrowsedFolderIds: browsed };
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
    const parsed = parseFolderList(body);
    return {
      kind: 'ok',
      folders: parsed.folders,
      recentBrowsedFolderIds: parsed.recentBrowsedFolderIds,
    };
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

const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/tiff': ['.tif', '.tiff'],
  'image/webp': ['.webp'],
  'image/bmp': ['.bmp'],
  'video/mp4': ['.mp4', '.m4v'],
  'video/quicktime': ['.mov'],
  'video/webm': ['.webm'],
  'video/x-msvideo': ['.avi'],
  'video/x-ms-wmv': ['.wmv'],
};

const CONTENT_TYPE_PREFERRED_EXTENSION: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/tiff': '.tiff',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-msvideo': '.avi',
  'video/x-ms-wmv': '.wmv',
};

function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return '';
  return filename.slice(dot).toLowerCase();
}

/** Align URL-derived filenames with the response Content-Type (Serpent-1jyi). */
export function alignFilenameWithContentType(
  filename: string,
  contentType: string,
): string {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  const allowed = CONTENT_TYPE_EXTENSIONS[normalized];
  const preferred = CONTENT_TYPE_PREFERRED_EXTENSION[normalized];
  if (!allowed || !preferred) return filename;

  const current = fileExtension(filename);
  if (current && allowed.includes(current)) return filename;

  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}${preferred}`;
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value);
}

function asciiAtBytes(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/** Sniff media type when servers return application/octet-stream or omit it. */
export function sniffContentType(body: ArrayBuffer): string | undefined {
  const bytes = new Uint8Array(body, 0, Math.min(32, body.byteLength));
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (asciiAtBytes(bytes, 0, 'GIF87a') || asciiAtBytes(bytes, 0, 'GIF89a')) {
    return 'image/gif';
  }
  if (asciiAtBytes(bytes, 0, 'RIFF') && asciiAtBytes(bytes, 8, 'WEBP')) {
    return 'image/webp';
  }
  if (asciiAtBytes(bytes, 0, 'BM')) return 'image/bmp';
  if (bytes.length >= 12 && asciiAtBytes(bytes, 4, 'ftyp')) return 'video/mp4';
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  return undefined;
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
  let contentType = contentTypeHeader.split(';')[0]?.trim().toLowerCase() ||
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

  if (!contentType || contentType === 'application/octet-stream') {
    const sniffed = sniffContentType(body);
    if (sniffed) contentType = sniffed;
  }

  const filename = alignFilenameWithContentType(
    filenameFromUrl(intent.mediaUrl, contentType),
    contentType,
  );

  return {
    body,
    contentType,
    filename,
  };
}

export async function deliverSaveUpload(
  intent: SaveIntent,
  media: FetchedMedia,
  behavior: ExtensionSaveBehavior,
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
    'X-Serpent-Focus-App-After-Save': String(behavior.focusAppAfterSave),
    'X-Serpent-Reveal-In-Library': String(behavior.revealInLibraryAfterSave),
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
  behavior: ExtensionSaveBehavior,
  fetchFn: FetchFunction = fetch,
): Promise<SaveOutcome> {
  const fetched = await fetchMediaInBrowser(intent, fetchFn);
  if ('error' in fetched) {
    return { kind: 'fetch_failed', reason: fetched.error };
  }
  return deliverSaveUpload(intent, fetched, behavior, fetchFn);
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
