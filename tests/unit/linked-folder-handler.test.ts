import { expect, test, vi } from 'vitest';

import { executeLinkedFolderWorkerCommand } from '../../src/worker/handlers/linked-folders';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function linkedFolderRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

function hooks() {
  return {
    scheduleThumbnails: vi.fn(),
    recordPermanentDeleteBarrier: vi.fn(),
  };
}

test('linked-folder.list returns the indexed folders', async () => {
  const folders = [{ folderId: 'folder-1', name: 'Source' }];
  const libraryService = {
    listLinkedFolders: vi.fn(() => folders),
  } as unknown as LibraryService;

  await expect(executeLinkedFolderWorkerCommand(
    libraryService,
    linkedFolderRequest({ type: 'linked-folder.list', libraryId: 'lib-1' }),
    hooks(),
  )).resolves.toEqual({
    ok: true,
    type: 'linked-folder.list',
    folders,
  });
});

test('linked-folder.remove records a permanent-delete barrier', async () => {
  const libraryService = {
    removeLinkedFolder: vi.fn(async () => ({ removedAssetCount: 2 })),
  } as unknown as LibraryService;
  const linkedHooks = hooks();

  await expect(executeLinkedFolderWorkerCommand(
    libraryService,
    linkedFolderRequest({
      type: 'linked-folder.remove',
      libraryId: 'lib-1',
      folderId: 'folder-1',
    }),
    linkedHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'linked-folder.removed',
    folderId: 'folder-1',
    removedAssetCount: 2,
  });
  expect(linkedHooks.recordPermanentDeleteBarrier).toHaveBeenCalledWith({
    libraryId: 'lib-1',
    commandId: 'linked-folder.remove',
    labelKey: 'history.linked-folder.remove',
    reason: 'linked-folder-index-remove',
    affectedCount: 2,
    affectedEntities: ['folder-1'],
    historyContext: undefined,
  });
});

test('linked-folder.relink schedules a linked thumbnail scene', async () => {
  const linkedFolder = { folderId: 'folder-1' };
  const libraryService = {
    relinkMissingFolder: vi.fn(() => linkedFolder),
  } as unknown as LibraryService;
  const linkedHooks = hooks();

  await expect(executeLinkedFolderWorkerCommand(
    libraryService,
    linkedFolderRequest({
      type: 'linked-folder.relink',
      libraryId: 'lib-1',
      folderId: 'folder-1',
      newRootPath: 'C:\\libraries\\relinked',
    }),
    linkedHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'linked-folder.relinked',
    linkedFolder,
  });
  expect(linkedHooks.scheduleThumbnails).toHaveBeenCalledWith('lib-1', 'linked');
});

test('linked-folder.assets.copy omits internal copiedSourceAssetIds', async () => {
  const assets = [{ assetId: 'asset-1' }];
  const libraryService = {
    copyAssetsToLinkedFolder: vi.fn(() => ({
      copiedCount: 1,
      skippedCount: 0,
      assets,
      copiedSourceAssetIds: ['asset-src'],
    })),
  } as unknown as LibraryService;
  const linkedHooks = hooks();

  await expect(executeLinkedFolderWorkerCommand(
    libraryService,
    linkedFolderRequest({
      type: 'linked-folder.assets.copy',
      libraryId: 'lib-1',
      folderId: 'folder-1',
      assetIds: ['asset-1'],
      conflictStrategy: 'keep-both',
    }),
    linkedHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'linked-folder.assets.copied',
    copiedCount: 1,
    skippedCount: 0,
    assets,
  });
  expect(linkedHooks.scheduleThumbnails).toHaveBeenCalledWith('lib-1', 'linked', ['asset-1']);
});

test('linked-folder.create-directory releases the write lease after success', async () => {
  const folder = { folderId: 'folder-2' };
  const release = vi.fn();
  const libraryService = {
    acquireWriteLease: vi.fn(async () => ({ release })),
    createLinkedFolderDirectory: vi.fn(() => folder),
  } as unknown as LibraryService;

  await expect(executeLinkedFolderWorkerCommand(
    libraryService,
    linkedFolderRequest({
      type: 'linked-folder.create-directory',
      libraryId: 'lib-1',
      linkedFolderId: 'folder-1',
      relativePath: 'refs',
      name: 'New',
    }),
    hooks(),
  )).resolves.toEqual({
    ok: true,
    type: 'linked-folder.directory-created',
    folder,
  });
  expect(release).toHaveBeenCalledOnce();
});
