import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const services: LibraryService[] = [];
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('asset metadata and content revisions', () => {
  it('does not change currentRevisionId when metadata is updated', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-metadata-revision-test-'));
    temporaryRoots.push(root);
    const sourcePath = path.join(root, 'asset.txt');
    writeFileSync(sourcePath, 'asset content');

    const service = new LibraryService();
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Metadata revision semantics',
      selectedParentPath: root,
    });
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [sourcePath],
    });
    if (!('assets' in imported) || imported.assets.length !== 1) {
      throw new Error('Expected one imported asset.');
    }

    const importedAsset = imported.assets[0]!;
    const before = service.getAssetMetadata({
      libraryId: library.libraryId,
      assetId: importedAsset.assetId,
    });

    const updated = service.setAssetMetadata({
      libraryId: library.libraryId,
      assetId: importedAsset.assetId,
      expectedVersion: before.entityVersion,
      description: 'metadata only',
      favorite: true,
    });
    const after = service.listAssets({
      libraryId: library.libraryId,
      recursive: false,
    })[0]!;

    expect(updated.entityVersion).toBe(before.entityVersion + 1);
    expect(after.currentRevisionId).toBe(importedAsset.currentRevisionId);
    expect(after.favorite).toBe(true);
  });
});
