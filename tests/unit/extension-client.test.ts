import { describe, expect, it, vi } from 'vitest';

import {
  alignFilenameWithContentType,
  deliverSaveUpload,
  fetchMediaInBrowser,
  notificationForOutcome,
  probeSerpentConnection,
  saveIntentFromContextMenu,
  saveMediaViaBrowser,
  sniffContentType,
  SERPENT_PORTS,
  type SaveIntent,
} from '../../extension/save-client';
import type { ExtensionSaveBehavior } from '../../extension/preferences';

const defaultSaveBehavior: ExtensionSaveBehavior = {
  notificationsEnabled: true,
  focusAppAfterSave: true,
  revealInLibraryAfterSave: true,
};

const imageIntent: SaveIntent = {
  kind: 'image',
  sourcePageUrl: 'https://example.com/gallery',
  mediaUrl: 'https://cdn.example.com/image.png',
};

type MockFetchResponse = {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
};

function mockHeaders(values: Record<string, string>) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    normalized[key.toLowerCase()] = value;
  }
  return {
    get: (name: string) => normalized[name.toLowerCase()] ?? null,
  };
}

function mockFetchResponse(options: {
  status: number;
  ok?: boolean;
  contentType?: string;
  contentLength?: string;
  body?: ArrayBuffer;
  text?: string;
}): MockFetchResponse {
  const headers = mockHeaders({
    'content-type': options.contentType ?? '',
    'content-length': options.contentLength ?? '',
  });
  const body = options.body ?? new ArrayBuffer(0);
  return {
    status: options.status,
    ok: options.ok ?? (options.status >= 200 && options.status < 300),
    headers,
    arrayBuffer: async () => body,
    text: async () => options.text ?? '',
    blob: async () => new Blob([body]),
  };
}

describe('browser extension save client', () => {
  it('builds the intent directly from the context-menu click payload', () => {
    expect(
      saveIntentFromContextMenu({
        mediaType: 'video',
        pageUrl: 'https://example.com/watch',
        srcUrl: 'https://cdn.example.com/movie.mp4',
      }),
    ).toEqual({
      kind: 'video',
      sourcePageUrl: 'https://example.com/watch',
      mediaUrl: 'https://cdn.example.com/movie.mp4',
    });
  });

  it('rejects context-menu payloads without HTTP(S) page and media URLs', () => {
    expect(
      saveIntentFromContextMenu({
        mediaType: 'image',
        pageUrl: 'https://example.com/gallery',
        srcUrl: 'data:image/png;base64,abc',
      }),
    ).toBeUndefined();
    expect(
      saveIntentFromContextMenu({
        mediaType: 'image',
        pageUrl: 'chrome://extensions',
        srcUrl: 'https://example.com/image.png',
      }),
    ).toBeUndefined();
  });

  it('fetches media in the browser with credentials and referrer', async () => {
    const body = new Uint8Array([1, 2, 3]).buffer;
    const fetchFn = vi.fn(async () =>
      mockFetchResponse({
        status: 200,
        contentType: 'image/png',
        body,
      }),
    );

    await expect(fetchMediaInBrowser(imageIntent, fetchFn)).resolves.toEqual({
      body,
      contentType: 'image/png',
      filename: 'image.png',
    });
    expect(fetchFn).toHaveBeenCalledWith(
      imageIntent.mediaUrl,
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        referrer: imageIntent.sourcePageUrl,
      }),
    );
  });

  it('reports fetch failures from the browser download step', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('network down');
    });

    await expect(fetchMediaInBrowser(imageIntent, fetchFn)).resolves.toEqual({
      error: 'network down',
    });
  });

  it('posts binary uploads to /save-upload without Authorization', async () => {
    const mediaBody = new Uint8Array([9, 8, 7]).buffer;
    const fetchFn = vi.fn(async () => mockFetchResponse({ status: 202 }));

    await expect(
      deliverSaveUpload(
        imageIntent,
        { body: mediaBody, contentType: 'image/png', filename: 'shot.png' },
        defaultSaveBehavior,
        fetchFn,
      ),
    ).resolves.toEqual({ kind: 'accepted' });

    expect(fetchFn).toHaveBeenCalledWith(
      'http://127.0.0.1:19876/save-upload',
      expect.objectContaining({
        method: 'POST',
        body: mediaBody,
        headers: expect.objectContaining({
          'Content-Type': 'application/octet-stream',
          'X-Serpent-Kind': 'image',
          'X-Serpent-Content-Type': 'image/png',
          'X-Serpent-Filename': encodeURIComponent('shot.png'),
        }),
      }),
    );
    const firstCall = (fetchFn.mock.calls as unknown as Array<[string, { headers?: Record<string, string> }]>)[0];
    expect(firstCall?.[1]?.headers).not.toHaveProperty('Authorization');
  });

  it('omits remote URL metadata for local-file uploads', async () => {
    const mediaBody = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const fetchFn = vi.fn(async () => mockFetchResponse({ status: 202 }));

    await expect(
      deliverSaveUpload(
        { kind: 'image', targetFolderId: null },
        { body: mediaBody, contentType: 'image/png', filename: 'shot.png' },
        defaultSaveBehavior,
        fetchFn,
      ),
    ).resolves.toEqual({ kind: 'accepted' });

    const request = (fetchFn.mock.calls[0] as unknown as [string, { headers?: Record<string, string> }])?.[1];
    expect(request.headers).not.toHaveProperty('X-Serpent-Source-Page-Url');
    expect(request.headers).not.toHaveProperty('X-Serpent-Media-Url');
  });

  it('tries fallback ports after connection failures', async () => {
    const mediaBody = new Uint8Array([1]).buffer;
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(mockFetchResponse({ status: 202 }));

    await expect(
      deliverSaveUpload(
        imageIntent,
        { body: mediaBody, contentType: 'image/png', filename: 'a.png' },
        defaultSaveBehavior,
        fetchFn,
      ),
    ).resolves.toEqual({ kind: 'accepted' });

    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:19876/save-upload',
      'http://127.0.0.1:19877/save-upload',
    ]);
  });

  it('reports the server rejection reason without scanning unrelated ports', async () => {
    const fetchFn = vi.fn(async () =>
      mockFetchResponse({
        status: 503,
        text: JSON.stringify({ status: 'rejected', reason: 'no active library' }),
      }),
    );

    await expect(
      deliverSaveUpload(
        imageIntent,
        { body: new Uint8Array([1]).buffer, contentType: 'image/png', filename: 'a.png' },
        defaultSaveBehavior,
        fetchFn,
      ),
    ).resolves.toEqual({
      kind: 'rejected',
      status: 503,
      reason: 'no active library',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps a non-202 HTTP status observable when the body is unreadable', async () => {
    const fetchFn = vi.fn(async () => ({
      status: 500,
      ok: false,
      headers: mockHeaders({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => {
        throw new Error('body reset');
      },
      blob: async () => new Blob(),
    }));

    await expect(
      deliverSaveUpload(
        imageIntent,
        { body: new Uint8Array([1]).buffer, contentType: 'image/png', filename: 'a.png' },
        defaultSaveBehavior,
        fetchFn,
      ),
    ).resolves.toEqual({
      kind: 'rejected',
      status: 500,
      reason: 'HTTP 500',
    });
  });

  it('reports Serpent as unreachable only after every configured port fails', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('connection refused');
    });

    await expect(
      deliverSaveUpload(
        imageIntent,
        { body: new Uint8Array([1]).buffer, contentType: 'image/png', filename: 'a.png' },
        defaultSaveBehavior,
        fetchFn,
      ),
    ).resolves.toEqual({ kind: 'unreachable' });
    expect(fetchFn).toHaveBeenCalledTimes(SERPENT_PORTS.length);
  });

  it('uses browser fetch then upload as the preferred save path', async () => {
    const mediaBody = new Uint8Array([4, 5, 6]).buffer;
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          contentType: 'image/jpeg',
          body: mediaBody,
        }),
      )
      .mockResolvedValueOnce(mockFetchResponse({ status: 202 }));

    await expect(saveMediaViaBrowser(imageIntent, defaultSaveBehavior, fetchFn)).resolves.toEqual({
      kind: 'accepted',
    });

    expect(fetchFn.mock.calls[0]?.[0]).toBe(imageIntent.mediaUrl);
    expect(fetchFn.mock.calls[1]?.[0]).toBe('http://127.0.0.1:19876/save-upload');
  });

  it('returns fetch_failed when the browser download step fails', async () => {
    const fetchFn = vi.fn(async () => mockFetchResponse({ status: 403 }));

    await expect(saveMediaViaBrowser(imageIntent, defaultSaveBehavior, fetchFn)).resolves.toEqual({
      kind: 'fetch_failed',
      reason: 'HTTP 403',
    });
  });

  it('probes Serpent via /ping and /folders without a token', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse({ status: 200 }))
      .mockResolvedValueOnce(mockFetchResponse({ status: 200, text: '{"folders":[]}' }));

    await expect(probeSerpentConnection(fetchFn)).resolves.toEqual({ kind: 'connected' });
    expect(fetchFn.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['http://127.0.0.1:19876/ping', 'GET'],
      ['http://127.0.0.1:19876/folders', 'GET'],
    ]);
    for (const [, init] of fetchFn.mock.calls) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers).not.toHaveProperty('Authorization');
    }
  });

  it('reports offline when ping cannot reach Serpent', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('connection refused');
    });

    await expect(probeSerpentConnection(fetchFn)).resolves.toEqual({ kind: 'offline' });
    expect(fetchFn).toHaveBeenCalledTimes(SERPENT_PORTS.length);
  });

  it('aligns URL filenames with the response Content-Type before upload', () => {
    expect(alignFilenameWithContentType('photo.jpg', 'image/png')).toBe('photo.png');
    expect(alignFilenameWithContentType('clip.bin', 'video/mp4')).toBe('clip.mp4');
    expect(alignFilenameWithContentType('already.png', 'image/png')).toBe('already.png');
  });

  it('sniffs image/png when the response omits a useful Content-Type', () => {
    const body = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]).buffer;
    expect(sniffContentType(body)).toBe('image/png');
  });

  it('maps every outcome to an explicit user notification', () => {
    expect(notificationForOutcome({ kind: 'accepted' })).toEqual({
      title: '已发送到 Serpent',
      message: 'Serpent 已接收保存请求。',
    });
    expect(
      notificationForOutcome({
        kind: 'rejected',
        status: 403,
        reason: 'forbidden origin',
      }),
    ).toEqual({
      title: 'Serpent 拒绝了保存请求',
      message: 'HTTP 403：forbidden origin',
    });
    expect(notificationForOutcome({ kind: 'unreachable' })).toEqual({
      title: '无法连接 Serpent',
      message: '请先启动 Serpent 桌面应用并打开资源库，然后重新保存。',
    });
    expect(
      notificationForOutcome({
        kind: 'fetch_failed',
        reason: 'HTTP 403',
      }),
    ).toEqual({
      title: '浏览器无法下载该媒体',
      message: '下载失败：HTTP 403（该站点可能启用了防盗链，请反馈给扩展开发者加入支持列表）',
    });
    expect(
      notificationForOutcome({
        kind: 'fetch_failed',
        reason: 'HTTP 500',
      }),
    ).toEqual({
      title: '浏览器无法下载该媒体',
      message: '下载失败：HTTP 500',
    });
  });
});
