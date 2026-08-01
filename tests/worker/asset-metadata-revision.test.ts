import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const services: LibraryService[] = [];
const temporaryRoots: string[] = [];
const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

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

  it('replaces managed asset bytes with a new revision and queues thumbnail refresh', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-content-replace-test-'));
    temporaryRoots.push(root);
    const sourcePath = path.join(root, 'asset.png');
    writeFileSync(sourcePath, VALID_1X1_PNG);

    const service = new LibraryService();
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Content replacement',
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
    const replacement = Buffer.from('replacement-image-bytes');
    const result = service.replaceManagedAssetContent({
      libraryId: library.libraryId,
      assetId: importedAsset.assetId,
      dataBase64: replacement.toString('base64'),
      expectedRevisionId: importedAsset.currentRevisionId,
    });

    expect(result).toMatchObject({
      assetId: importedAsset.assetId,
      byteSize: replacement.length,
    });
    expect(result.revisionId).not.toBe(importedAsset.currentRevisionId);
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'asset.png'))).toEqual(replacement);
    expect(service.listAssets({ libraryId: library.libraryId, recursive: false })[0]?.currentRevisionId)
      .toBe(result.revisionId);
    expect(service.listMediaJobs(library.libraryId).jobs).toEqual([
      expect.objectContaining({
        assetId: importedAsset.assetId,
        revisionId: result.revisionId,
        kind: 'generate_thumbnail',
        status: 'queued',
      }),
    ]);
  });

  it('reads bounded bytes from an available managed asset without exposing its path', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-content-read-test-'));
    temporaryRoots.push(root);
    const sourcePath = path.join(root, 'asset.png');
    const sourceBytes = Buffer.from('0123456789');
    writeFileSync(sourcePath, sourceBytes);

    const service = new LibraryService();
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Content read',
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

    const result = service.readManagedAssetContent({
      libraryId: library.libraryId,
      assetId: imported.assets[0]!.assetId,
      maxBytes: 4,
    });

    expect(result).toEqual({
      assetId: imported.assets[0]!.assetId,
      revisionId: imported.assets[0]!.currentRevisionId,
      byteSize: sourceBytes.length,
      dataBase64: sourceBytes.subarray(0, 4).toString('base64'),
      truncated: true,
      mimeType: 'image/png',
    });
    expect(result).not.toHaveProperty('absolutePath');
  });
});
