import { expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  webUtils: {
    getPathForFile: vi.fn(),
  },
}));

vi.mock('../../src/preload/transport', () => ({
  request: vi.fn(),
  failure: vi.fn((result: { error: unknown }) => ({ ok: false, error: result.error })),
  importRequest: vi.fn(),
}));

import { failure, request } from '../../src/preload/transport';
import { library } from '../../src/preload/bridge/library';

test('library.create sends the owned create request through transport', async () => {
  const opened = {
    ok: true as const,
    type: 'library.opened' as const,
    library: { libraryId: 'lib-1', displayName: 'Studio' },
  };
  vi.mocked(request).mockResolvedValue(opened as never);
  await expect(library.create({ displayName: 'Studio' })).resolves.toEqual({
    ok: true,
    value: opened.library,
  });
  expect(request).toHaveBeenCalledWith({
    type: 'library.create.request',
    displayName: 'Studio',
  });
});

test('library.create maps a failed transport result through failure()', async () => {
  const failed = { ok: false as const, error: { code: 'LIBRARY_CREATE_FAILED' } };
  vi.mocked(request).mockResolvedValue(failed as never);
  await expect(library.create({ displayName: 'Studio' })).resolves.toEqual({
    ok: false,
    error: failed.error,
  });
  expect(failure).toHaveBeenCalledWith(failed);
});

test('library.chooseCreateLocation forwards only the native chooser request and token', async () => {
  for (const selectionToken of ['choice-token', null]) {
    vi.mocked(request).mockResolvedValue({
      ok: true, type: 'library.create-location-chosen', selectionToken,
    } as never);
    await expect(library.chooseCreateLocation()).resolves.toEqual({ ok: true, value: selectionToken });
    expect(request).toHaveBeenLastCalledWith({ type: 'library.choose-create-location.request' });
  }
});

test('library.create forwards the opaque selection token when the picker already succeeded', async () => {
  const summary = { libraryId: 'lib-1', displayName: 'Studio' };
  vi.mocked(request).mockResolvedValue({ ok: true, type: 'library.opened', library: summary } as never);
  await expect(library.create({ displayName: 'Studio', selectionToken: 'choice-token' })).resolves.toEqual({
    ok: true, value: summary,
  });
  expect(request).toHaveBeenLastCalledWith({
    type: 'library.create.request', displayName: 'Studio', selectionToken: 'choice-token',
  });
});

test('library.embeddingSearch preserves raw per-asset scores from transport', async () => {
  const response = {
    ok: true as const,
    type: 'embedding.search' as const,
    phase: 'ready' as const,
    done: 2,
    total: 2,
    failedCount: 0,
    assetIds: ['zero', 'negative'],
    scores: [
      { assetId: 'zero', score: 0 },
      { assetId: 'negative', score: -0.25 },
    ],
  };
  vi.mocked(request).mockResolvedValue(response as never);

  await expect(library.embeddingSearch({
    libraryId: 'lib-1',
    modelId: 'embeddinggemma-2-compact',
    query: 'reflection',
  })).resolves.toEqual({
    ok: true,
    value: {
      phase: 'ready',
      done: 2,
      total: 2,
      failedCount: 0,
      assetIds: ['zero', 'negative'],
      scores: [
        { assetId: 'zero', score: 0 },
        { assetId: 'negative', score: -0.25 },
      ],
    },
  });
  expect(request).toHaveBeenCalledWith({
    type: 'embedding.search.request',
    libraryId: 'lib-1',
    modelId: 'embeddinggemma-2-compact',
    query: 'reflection',
  });
});
