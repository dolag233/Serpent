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
