// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { SerpentLibraryApi } from '../../src/shared/library-api';
import type { RendererLibrarySummary } from '../../src/shared/protocol/responses';
import { useAssetCutState } from '../../src/renderer/use-asset-cut-state';
import { useShellFileActions } from '../../src/renderer/use-shell-file-actions';

vi.mock('../../src/renderer/i18n', () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: 'en' }) }));
afterEach(() => vi.useRealTimers());

it('marks a cut batch without a toast and restores it after external clipboard replacement or copy', async () => {
  vi.useFakeTimers();
  const root = createRoot(document.createElement('div'));
  let clipboardIds: string[] = [];
  const api = {
    getClipboardCutSelection: vi.fn(async () => ({ ok: true, value: { assetIds: clipboardIds, folderIds: [] } })),
    copyAssetFiles: vi.fn(async ({ assetIds, operation }: { assetIds: string[]; operation: string }) => {
      clipboardIds = operation === 'cut' ? [...assetIds] : [];
      return { ok: true, value: undefined };
    }),
  } as unknown as SerpentLibraryApi;
  const notice = vi.fn();
  const error = vi.fn();
  let state: ReturnType<typeof useAssetCutState>;
  let actions: ReturnType<typeof useShellFileActions>;
  function Harness() {
    state = useAssetCutState(api, 'library');
    actions = useShellFileActions({ api, library: { libraryId: 'library' } as RendererLibrarySummary,
      setNotice: notice, setError: error, onClipboardChanged: state.refresh });
    return null;
  }
  try {
    await act(() => root.render(createElement(Harness)));
    await act(() => actions.handleCopyAssetFiles(['one', 'two'], 'cut'));
    expect([...state!.cutAssetIds]).toEqual(['one', 'two']);
    expect(notice).not.toHaveBeenCalled();
    clipboardIds = [];
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(state!.cutAssetIds.size).toBe(0);
    await act(() => actions.handleCopyAssetFiles(['one'], 'cut'));
    await act(() => actions.handleCopyAssetFiles(['one'], 'copy'));
    expect(state!.cutAssetIds.size).toBe(0);
    expect(notice).toHaveBeenCalledExactlyOnceWith('toast.assetCopyDone');
    expect(error).not.toHaveBeenCalled();
  } finally { await act(() => root.unmount()); }
});

it('does not show an old library response after switching libraries', async () => {
  const root = createRoot(document.createElement('div'));
  let resolveOld: (value: unknown) => void = () => {};
  const api = { getClipboardCutSelection: vi.fn(({ libraryId }) => libraryId === 'old'
    ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve({ ok: true, value: { assetIds: [], folderIds: [] } })) } as unknown as SerpentLibraryApi;
  let state: ReturnType<typeof useAssetCutState>;
  function Harness({ libraryId }: { libraryId: string }) { state = useAssetCutState(api, libraryId); return null; }
  try {
    await act(() => root.render(createElement(Harness, { libraryId: 'old' })));
    await act(() => root.render(createElement(Harness, { libraryId: 'new' })));
    await act(() => resolveOld({ ok: true, value: { assetIds: ['old-asset'], folderIds: [] } }));
    expect(state!.cutAssetIds.size).toBe(0);
  } finally { await act(() => root.unmount()); }
});


it('tracks a folders-only cut and restores folder styling after an external clipboard change', async () => {
  vi.useFakeTimers();
  const root = createRoot(document.createElement('div'));
  let folders: string[] = [];
  const notice = vi.fn();
  const api = {
    getClipboardCutSelection: vi.fn(async () => ({ ok: true, value: { assetIds: [], folderIds: folders } })),
    copyAssetFiles: vi.fn(async ({ folderIds }) => { folders = folderIds; return { ok: true }; }),
  } as unknown as SerpentLibraryApi;
  let state: ReturnType<typeof useAssetCutState>;
  let actions: ReturnType<typeof useShellFileActions>;
  function Harness() {
    state = useAssetCutState(api, 'lib');
    actions = useShellFileActions({ api, library: { libraryId: 'lib' } as RendererLibrarySummary,
      setNotice: notice, setError: vi.fn(), onClipboardChanged: state.refresh });
    return null;
  }
  try {
    await act(() => root.render(createElement(Harness)));
    await act(() => actions.handleCopyAssetFiles([], 'cut', ['folder-one', 'folder-two']));
    expect([...state!.cutFolderIds]).toEqual(['folder-one', 'folder-two']);
    expect(notice).not.toHaveBeenCalled();
    expect(api.copyAssetFiles).toHaveBeenCalledWith({ libraryId: 'lib', assetIds: [], folderIds: ['folder-one', 'folder-two'], operation: 'cut' });
    folders = [];
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(state!.cutFolderIds.size).toBe(0);
  } finally { await act(() => root.unmount()); }
});
