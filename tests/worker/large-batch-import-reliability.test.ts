import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isImportCompletion, isImportConflictPlan } from '../../src/shared/import-outcome';
import { LibraryService } from '../../src/worker/library-service';

const temporaryRoots: string[] = [];
const LARGE_BATCH_COUNT = Number.parseInt(process.env.SERPENT_LARGE_BATCH_COUNT ?? '50000', 10);

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-large-batch-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    try {
      rmSync(root, { force: true, recursive: true, maxRetries: 8, retryDelay: 50 });
    } catch {
      // Windows may still hold a handle; the OS temp directory reclaims it.
    }
  }
}, 180_000);

describe('large-batch import reliability', () => {
  it(`imports ${LARGE_BATCH_COUNT} tiny files then tags, collections, and trash them`, () => {
    expect(Number.isSafeInteger(LARGE_BATCH_COUNT) && LARGE_BATCH_COUNT > 900).toBe(true);
    const root = temporaryRoot();
    const incoming = path.join(root, 'incoming');
    const folderCount = 50;
    const filesPerFolder = Math.trunc(LARGE_BATCH_COUNT / folderCount);
    mkdirSync(incoming);
    let written = 0;
    for (let folderIndex = 0; folderIndex < folderCount; folderIndex += 1) {
      const folderPath = path.join(incoming, `d${folderIndex}`);
      mkdirSync(folderPath);
      for (let fileIndex = 0; fileIndex < filesPerFolder; fileIndex += 1) {
        writeFileSync(path.join(folderPath, `f${fileIndex}.txt`), `${folderIndex}-${fileIndex}`);
        written += 1;
      }
    }

    const service = new LibraryService();
    try {
    const library = service.createLibrary({
      displayName: 'Large Batch',
      selectedParentPath: root,
    });
    const plan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'folder',
      sourcePaths: [incoming],
      skipContentHash: true,
      skipLibraryDuplicateScan: true,
    });
    expect(isImportConflictPlan(plan)).toBe(true);
    if (!isImportConflictPlan(plan)) {
      throw new Error('expected staged import plan');
    }
    const result = service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
    expect(isImportCompletion(result)).toBe(true);
    if (!isImportCompletion(result)) {
      throw new Error('expected import completion');
    }
    expect(result.importedCount).toBe(written);
    expect(result.assetCount).toBe(written);

    const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
    expect(assets).toHaveLength(written);
    const assetIds = assets.map((asset) => asset.assetId);
    expect(service.listAssets({
      libraryId: library.libraryId,
      recursive: true,
      assetIds,
    })).toHaveLength(written);

    const tag = service.createTag({ libraryId: library.libraryId, name: 'batch' });
    const assigned = service.assignTags({
      libraryId: library.libraryId,
      assetIds,
      tagIds: [tag.tagId],
    });
    expect(assigned.assignedCount).toBe(written);

    const collection = service.createCollection({ libraryId: library.libraryId, name: 'Batch' });
    service.addCollectionAssets({
      libraryId: library.libraryId,
      collectionId: collection.collectionId,
      assetIds,
    });
    const collections = service.listCollections(library.libraryId);
    expect(collections).toEqual(expect.arrayContaining([
      expect.objectContaining({ collectionId: collection.collectionId, assetCount: written }),
    ]));

    const trashed = service.trashAssets({
      libraryId: library.libraryId,
      assetIds,
    });
    expect(trashed.trashedCount).toBe(written);
    const remainingLive = service.listAssets({ libraryId: library.libraryId, recursive: true })
      .filter((asset) => asset.deletedAt == null);
    expect(remainingLive).toHaveLength(0);

    service.closeAll();
    const reopened = new LibraryService();
    try {
      const opened = reopened.openLibrary(library.libraryPath);
      expect(
        reopened.listAssets({ libraryId: opened.libraryId, recursive: true })
          .filter((asset) => asset.deletedAt == null),
      ).toHaveLength(0);
    } finally {
      reopened.closeAll();
    }
    } finally {
      service.closeAll();
    }
  }, 900_000);
});
