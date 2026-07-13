import { describe, expect, it, vi } from 'vitest';

import {
  deliverSaveIntent,
  notificationForOutcome,
  saveIntentFromContextMenu,
  SERPENT_PORTS,
  type SaveIntent,
} from '../../extension/save-client';

const imageIntent: SaveIntent = {
  kind: 'image',
  sourcePageUrl: 'https://example.com/gallery',
  mediaUrl: 'https://cdn.example.com/image.png',
};

function response(status: number, body = ''): Pick<Response, 'status' | 'text'> {
  return {
    status,
    text: async () => body,
  };
}

describe('browser extension save client', () => {
  it('builds the intent directly from the context-menu click payload', () => {
    expect(saveIntentFromContextMenu({
      mediaType: 'video',
      pageUrl: 'https://example.com/watch',
      srcUrl: 'https://cdn.example.com/movie.mp4',
    })).toEqual({
      kind: 'video',
      sourcePageUrl: 'https://example.com/watch',
      mediaUrl: 'https://cdn.example.com/movie.mp4',
    });
  });

  it('rejects context-menu payloads without HTTP(S) page and media URLs', () => {
    expect(saveIntentFromContextMenu({
      mediaType: 'image',
      pageUrl: 'https://example.com/gallery',
      srcUrl: 'data:image/png;base64,abc',
    })).toBeUndefined();
    expect(saveIntentFromContextMenu({
      mediaType: 'image',
      pageUrl: 'chrome://extensions',
      srcUrl: 'https://example.com/image.png',
    })).toBeUndefined();
  });

  it('reports a 202 response as accepted', async () => {
    const fetchFn = vi.fn(async () => response(202));

    await expect(deliverSaveIntent(imageIntent, 'pairing-token', fetchFn)).resolves.toEqual({
      kind: 'accepted',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://127.0.0.1:19876/save',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(imageIntent),
        headers: expect.objectContaining({ Authorization: 'Bearer pairing-token' }),
      }),
    );
  });

  it('tries fallback ports after connection failures', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response(202));

    await expect(deliverSaveIntent(imageIntent, 'pairing-token', fetchFn)).resolves.toEqual({
      kind: 'accepted',
    });
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:19876/save',
      'http://127.0.0.1:19877/save',
    ]);
  });

  it('reports the server rejection reason without scanning unrelated ports', async () => {
    const fetchFn = vi.fn(async () => response(
      503,
      JSON.stringify({ status: 'rejected', reason: 'no active library' }),
    ));

    await expect(deliverSaveIntent(imageIntent, 'pairing-token', fetchFn)).resolves.toEqual({
      kind: 'rejected',
      status: 503,
      reason: 'no active library',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps a non-202 HTTP status observable when the body is unreadable', async () => {
    const fetchFn = vi.fn(async () => ({
      status: 500,
      text: async () => { throw new Error('body reset'); },
    }));

    await expect(deliverSaveIntent(imageIntent, 'pairing-token', fetchFn)).resolves.toEqual({
      kind: 'rejected',
      status: 500,
      reason: 'HTTP 500',
    });
  });

  it('reports Serpent as unreachable only after every configured port fails', async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError('connection refused'); });

    await expect(deliverSaveIntent(imageIntent, 'pairing-token', fetchFn)).resolves.toEqual({
      kind: 'unreachable',
    });
    expect(fetchFn).toHaveBeenCalledTimes(SERPENT_PORTS.length);
  });

  it('maps every outcome to an explicit user notification', () => {
    expect(notificationForOutcome({ kind: 'accepted' })).toEqual({
      title: '已发送到 Serpent',
      message: 'Serpent 已接收保存请求。',
    });
    expect(notificationForOutcome({
      kind: 'rejected',
      status: 403,
      reason: 'forbidden origin',
    })).toEqual({
      title: 'Serpent 拒绝了保存请求',
      message: 'HTTP 403：forbidden origin',
    });
    expect(notificationForOutcome({ kind: 'unreachable' })).toEqual({
      title: '无法连接 Serpent',
      message: '请先启动 Serpent 桌面应用，然后重新保存。',
    });
    expect(notificationForOutcome({
      kind: 'rejected', status: 401, reason: 'authentication required',
    })).toEqual({
      title: 'Serpent 配对已失效',
      message: '请打开扩展选项，粘贴桌面应用显示的新配对码。',
    });
  });
});
