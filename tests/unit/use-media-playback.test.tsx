// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { AssetSummary } from '../../src/shared/asset-types';
import type { SerpentLibraryApi } from '../../src/shared/library-api';
import { useMediaPlayback } from '../../src/renderer/use-media-playback';

vi.mock('../../src/renderer/i18n', () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: 'en' }) }));

it('loads the next page before navigating once, and cancels a pending advance when the viewer closes', async () => {
  localStorage.clear();
  const root = createRoot(document.createElement('div'));
  const current = { assetId: 'a', locationKind: 'managed', managedFolderId: null, relativeFilePath: 'a.mp4', mediaType: 'video', availability: 'available', deletedAt: null } as AssetSummary;
  const next = { ...current, assetId: 'b', relativeFilePath: 'b.mp4' };
  const navigate = vi.fn();
  const ensureLoaded = vi.fn(async () => {});
  let resolveIds: (ids: string[]) => void = () => {};
  const getOrderedIds = vi.fn(() => new Promise<string[]>(resolve => { resolveIds = resolve; }));
  const api = { listAssets: vi.fn(async () => ({ ok: true, value: [next] })) } as unknown as SerpentLibraryApi;
  let playback: ReturnType<typeof useMediaPlayback>;
  function Harness({ open }: { open: boolean }) {
    playback = useMediaPlayback({ api, libraryId: 'lib', current: open ? current : null, shuffleSeed: null, getOrderedIds, navigate, ensureLoaded, setError: vi.fn() });
    return null;
  }
  try {
    await act(() => root.render(createElement(Harness, { open: true })));
    await act(() => playback.changeMode('sequential'));
    let first: Promise<void>;
    await act(() => { first = playback.ended('a'); void playback.ended('a'); });
    expect(getOrderedIds).toHaveBeenCalledOnce();
    await act(async () => { resolveIds(['a', 'b']); await first; });
    expect(ensureLoaded).toHaveBeenCalledWith(1);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(next);
    navigate.mockClear();
    let pending: Promise<void>;
    await act(() => { pending = playback.ended('a'); });
    await act(() => root.render(createElement(Harness, { open: false })));
    await act(async () => { resolveIds(['a', 'b']); await pending; });
    expect(navigate).not.toHaveBeenCalled();
  } finally { await act(() => root.unmount()); localStorage.clear(); }
});
