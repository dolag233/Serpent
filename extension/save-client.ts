import type { ExtensionFolderOption } from './folder-menu';

export const SERPENT_PORTS = [19876, 19877, 19878] as const;

const SERPENT_HOST = 'http://127.0.0.1';

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
  | { kind: 'unreachable' };

export type ConnectionOutcome =
  | { kind: 'connected' }
  | { kind: 'needs_pairing' }
  | { kind: 'offline' };

export type FolderListOutcome =
  | { kind: 'ok'; folders: ExtensionFolderOption[] }
  | { kind: 'rejected'; status: number; reason: string }
  | { kind: 'unreachable' };

export interface UserNotification {
  title: string;
  message: string;
}

type FetchResponse = Pick<Response, 'status' | 'text'>;
type FetchFunction = (
  input: string,
  init: RequestInit,
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

function authHeaders(pairingToken: string): HeadersInit {
  return { Authorization: `Bearer ${pairingToken}` };
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
  pairingToken: string | undefined,
  fetchFn: FetchFunction = fetch,
): Promise<ConnectionOutcome> {
  if (!pairingToken) return { kind: 'needs_pairing' };

  const ping = await requestSerpent('/ping', { method: 'GET' }, fetchFn);
  if (!ping) return { kind: 'offline' };

  const status = await requestSerpent(
    '/folders',
    { method: 'GET', headers: authHeaders(pairingToken) },
    fetchFn,
  );
  if (!status) return { kind: 'offline' };
  if (status.status === 401) return { kind: 'needs_pairing' };
  if (status.status === 200 || status.status === 503) return { kind: 'connected' };
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
  pairingToken: string,
  fetchFn: FetchFunction = fetch,
): Promise<FolderListOutcome> {
  const response = await requestSerpent(
    '/folders',
    { method: 'GET', headers: authHeaders(pairingToken) },
    fetchFn,
  );
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

/**
 * Delivers one save intent to the first running Serpent extension server.
 * A reachable server owns the request even when it rejects it, so only
 * connection failures fall through to the next port.
 */
export async function deliverSaveIntent(
  intent: SaveIntent,
  pairingToken: string,
  fetchFn: FetchFunction = fetch,
): Promise<SaveOutcome> {
  const payload: Record<string, unknown> = {
    kind: intent.kind,
    sourcePageUrl: intent.sourcePageUrl,
    mediaUrl: intent.mediaUrl,
  };
  if (intent.targetFolderId !== undefined) {
    payload.targetFolderId = intent.targetFolderId;
  }

  const response = await requestSerpent(
    '/save',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(pairingToken),
      },
      body: JSON.stringify(payload),
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
    // The HTTP status is still actionable if the response body is unreadable.
  }

  return {
    kind: 'rejected',
    status: response.status,
    reason: rejectionReason(body) ?? `HTTP ${response.status}`,
  };
}

export function notificationForOutcome(outcome: SaveOutcome): UserNotification {
  switch (outcome.kind) {
    case 'accepted':
      return {
        title: '已发送到 Serpent',
        message: 'Serpent 已接收保存请求。',
      };
    case 'rejected':
      if (outcome.status === 401) {
        return {
          title: 'Serpent 配对已失效',
          message: '请打开扩展选项，粘贴桌面应用显示的新配对码。',
        };
      }
      return {
        title: 'Serpent 拒绝了保存请求',
        message: `HTTP ${outcome.status}：${outcome.reason}`,
      };
    case 'unreachable':
      return {
        title: '无法连接 Serpent',
        message: '请先启动 Serpent 桌面应用，然后重新保存。',
      };
  }
}
