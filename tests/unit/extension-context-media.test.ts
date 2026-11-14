import { afterEach, describe, expect, it, vi } from 'vitest';

import { matchingContextMedia, readContextMedia } from '../../extension/context-media';

afterEach(() => vi.unstubAllGlobals());

describe('right-click original image bridge', () => {
  it('only returns the fresh media that matches the browser context URL', () => {
    const snapshot = {
      media: {
        kind: 'image' as const,
        mediaUrl: 'https://cdn.example.com/preview.jpg',
        originalMediaUrl: 'https://cdn.example.com/full.jpg',
      },
      sourceUrls: ['https://cdn.example.com/preview.jpg'],
      at: 1000,
    };
    expect(matchingContextMedia(snapshot, snapshot.sourceUrls[0], 2000)).toEqual({
      mediaUrl: snapshot.media.mediaUrl,
      originalMediaUrl: snapshot.media.originalMediaUrl,
    });
    expect(matchingContextMedia(snapshot, 'https://cdn.example.com/other.jpg', 2000)).toBeNull();
    expect(matchingContextMedia(snapshot, snapshot.sourceUrls[0], 61_000)).toBeNull();
  });

  it('queries the clicked iframe and accepts only HTTP image candidates', async () => {
    const sendMessage = vi.fn((
      _tabId: number,
      _message: unknown,
      _options: { frameId: number },
      callback: (response: unknown) => void,
    ) => {
      callback({
        mediaUrl: 'https://cdn.example.com/preview.jpg',
        originalMediaUrl: 'javascript:alert(1)',
      });
    });
    vi.stubGlobal('chrome', { runtime: {}, tabs: { sendMessage } });
    await expect(readContextMedia(7, 'https://cdn.example.com/preview.jpg', 3)).resolves.toEqual({
      mediaUrl: 'https://cdn.example.com/preview.jpg',
      originalMediaUrl: undefined,
    });
    expect(sendMessage).toHaveBeenCalledWith(
      7,
      { type: 'serpent-context-media-request', srcUrl: 'https://cdn.example.com/preview.jpg' },
      { frameId: 3 },
      expect.any(Function),
    );
  });

  it('keeps the legacy tab message form when the frame is unavailable', async () => {
    const sendMessage = vi.fn((
      _tabId: number,
      _message: unknown,
      callback: (response: unknown) => void,
    ) => callback(null));
    vi.stubGlobal('chrome', { runtime: {}, tabs: { sendMessage } });
    await expect(readContextMedia(7, 'https://cdn.example.com/preview.jpg', undefined))
      .resolves.toBeNull();
    expect(sendMessage).toHaveBeenCalledWith(
      7,
      { type: 'serpent-context-media-request', srcUrl: 'https://cdn.example.com/preview.jpg' },
      expect.any(Function),
    );
  });
});
