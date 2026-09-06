import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import type { DeleteProgressEvent } from '../../src/shared/protocol/responses';

const roots: string[] = [];
const services: LibraryService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('managed asset delete progress', () => {
  it('emits counted trash and disk-delete progress for a multi-file batch', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-delete-progress-'));
    roots.push(root);
    const sources = [0, 1, 2].map((index) => {
      const source = path.join(root, `file-${index}.txt`);
      writeFileSync(source, `payload-${index}`);
      return source;
    });
    const events: DeleteProgressEvent[] = [];
    const service = new LibraryService({
      onProgress: (event) => {
        if (event.type === 'delete.progress') events.push(event);
      },
    });
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Delete Progress',
      selectedParentPath: root,
    });
    await service.prepareOrExecuteImportCancellable({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: sources,
    });
    const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
    expect(assets).toHaveLength(3);

    service.trashAssets({
      libraryId: library.libraryId,
      assetIds: assets.map((asset) => asset.assetId),
    });
    const trashEvents = events.filter((event) => event.kind === 'trash');
    expect(trashEvents.some((event) => event.phase === 'run' && event.totalFiles === 3)).toBe(true);
    expect(trashEvents.some((event) => event.phase === 'complete' && event.filesProcessed === 3)).toBe(true);

    events.length = 0;
    const diskSources = [0, 1, 2].map((index) => {
      const source = path.join(root, `disk-${index}.txt`);
      writeFileSync(source, `disk-${index}`);
      return source;
    });
    await service.prepareOrExecuteImportCancellable({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: diskSources,
    });
    const diskAssets = service.listAssets({ libraryId: library.libraryId, recursive: true })
      .filter((asset) => asset.relativeFilePath.includes('disk-'));
    expect(diskAssets).toHaveLength(3);
    await service.deleteAssetsFromDiskAsync({
      libraryId: library.libraryId,
      assetIds: diskAssets.map((asset) => asset.assetId),
    });
    const diskEvents = events.filter((event) => event.kind === 'disk');
    expect(diskEvents.some((event) => event.phase === 'run' && event.totalFiles === 3)).toBe(true);
    expect(diskEvents.some((event) => event.phase === 'complete' && event.filesProcessed === 3)).toBe(true);
    expect(diskEvents.some((event) => event.phase === 'run' && event.cancelable === true)).toBe(true);
  });

  it('emits cancellable disk-delete progress that can stop between files', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-delete-cancel-'));
    roots.push(root);
    const sources = [0, 1, 2, 3, 4].map((index) => {
      const source = path.join(root, `cancel-${index}.txt`);
      writeFileSync(source, `payload-${index}`);
      return source;
    });
    const cancelEvents: DeleteProgressEvent[] = [];
    const cancelling = new LibraryService({
      onProgress: (event) => {
        if (event.type !== 'delete.progress') return;
        cancelEvents.push(event);
        if (event.kind === 'disk' && event.phase === 'run' && event.cancelable) {
          cancelling.cancelDiskDelete(event.operationId);
        }
      },
    });
    services.push(cancelling);
    const cancelLibrary = cancelling.createLibrary({
      displayName: 'Delete Cancel',
      selectedParentPath: root,
    });
    await cancelling.prepareOrExecuteImportCancellable({
      libraryId: cancelLibrary.libraryId,
      sourceKind: 'files',
      sourcePaths: sources,
    });
    const cancelAssets = cancelling.listAssets({ libraryId: cancelLibrary.libraryId, recursive: true });
    expect(cancelAssets).toHaveLength(5);
    await expect(
      cancelling.deleteAssetsFromDiskAsync({
        libraryId: cancelLibrary.libraryId,
        assetIds: cancelAssets.map((asset) => asset.assetId),
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(cancelEvents.some((event) => event.phase === 'cancelled' && event.kind === 'disk')).toBe(true);
    expect(cancelling.listAssets({ libraryId: cancelLibrary.libraryId, recursive: true })).toHaveLength(5);
  });
});
