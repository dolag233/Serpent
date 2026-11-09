// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../src/renderer/i18n';
import { useInspectorFieldHandlers, type UseInspectorFieldHandlersParams } from '../../src/renderer/use-inspector-field-handlers';
import { useInspectorMultiEdit } from '../../src/renderer/use-inspector-multi-edit';
import { assetMetadataResultSchema } from '../../src/shared/asset-types';
import type { SerpentLibraryApi } from '../../src/shared/library-api';

it('writes a mixed author to the whole selection only after user input', async () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const save = vi.fn(async () => {});
  let handlers: ReturnType<typeof useInspectorFieldHandlers>;
  function Harness() {
    const [editAuthor, setEditAuthor] = useState('');
    handlers = useInspectorFieldHandlers({
      selectedAssetIds: ['one', 'two'], selectedAssetId: 'one',
      multiEdit: { author: { kind: 'mixed' } }, editAuthor, setEditAuthor,
      saveMetadataForSelection: save,
    } as unknown as UseInspectorFieldHandlersParams);
    return null;
  }
  try {
    await act(() => root.render(createElement(LocaleProvider, null, createElement(Harness))));
    act(() => handlers.handleAuthorSave());
    expect(save).not.toHaveBeenCalled();
    await act(() => handlers.handleAuthorInput({ target: { value: 'Example author' } } as unknown as Parameters<typeof handlers.handleAuthorInput>[0]));
    await act(() => handlers.handleAuthorSave());
    expect(save).toHaveBeenCalledWith(['one', 'two'], { author: 'Example author' });
    act(() => handlers.handleAuthorSave());
    expect(save).toHaveBeenCalledTimes(1);
  } finally { await act(() => root.unmount()); host.remove(); }
});

it('persists the new author to both real multi-edit cache entries and clears both authors', async () => {
  const root = createRoot(document.createElement('div'));
  const cache = new Map(['one', 'two'].map((id, index) => [id, assetMetadataResultSchema.parse({
    assetId: id, description: null, rating: 0, favorite: false, palette: null,
    sourcePageUrl: null, author: index ? 'Second author' : 'First author',
    entityVersion: 0, updatedAt: '2026-01-01T00:00:00Z',
  })]));
  const write = vi.fn(async ({ assetId, author, expectedVersion }: {assetId: string; author: string; expectedVersion: number}) => ({
    ok: true as const, value: { ...cache.get(assetId)!, author: author || null, entityVersion: expectedVersion + 1 },
  }));
  const api = { setAssetMetadata: write } as unknown as SerpentLibraryApi;
  let handlers: ReturnType<typeof useInspectorFieldHandlers>;
  function Harness() {
    const [editAuthor, setEditAuthor] = useState('');
    const metadataByAssetRef = useRef(cache);
    const metadataConflictAssetIdsRef = useRef(new Set<string>());
    const selectedAssetIdRef = useRef<string | undefined>('one');
    const multi = useInspectorMultiEdit({
      api, library: { libraryId: 'library', displayPath: 'fixture', displayName: 'Fixture' },
      selectedAssetIds: ['one', 'two'], selectedAssetIdRef, metadataByAssetRef,
      metadataConflictAssetIdsRef, setEditAuthor, setEditDescription: vi.fn(), setEditRating: vi.fn(),
      setEditFavorite: vi.fn(), setEditSourceUrl: vi.fn(), setAssetMetadata: vi.fn(),
      setAssets: vi.fn(), setTrashedAssets: vi.fn(), setNotice: vi.fn(), setError: vi.fn(),
    });
    handlers = useInspectorFieldHandlers({
      selectedAssetIds: ['one', 'two'], selectedAssetId: 'one', multiEdit: multi.multiEdit,
      editAuthor, setEditAuthor, saveMetadataForSelection: multi.saveMetadataForSelection,
    } as unknown as UseInspectorFieldHandlersParams);
    return null;
  }
  try {
    await act(() => root.render(createElement(LocaleProvider, null, createElement(Harness))));
    for (const value of ['Unified author', '']) {
      await act(() => handlers.handleAuthorInput({ target: { value } } as unknown as Parameters<typeof handlers.handleAuthorInput>[0]));
      await act(async () => { handlers.handleAuthorSave(); });
      expect([...cache.values()].map(metadata => metadata.author)).toEqual([value || null, value || null]);
    }
    expect(write).toHaveBeenCalledTimes(4);
  } finally { await act(() => root.unmount()); }
});
