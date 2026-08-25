import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { CONTENT_REPLACE_STAGE_CHUNK_MAX_BYTES } from '../../src/shared/content-replace';

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
        assetName: 'asset.png',
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

  it('stages content and replaces a batch with one revision/event cycle', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-content-replace-batch-test-'));
    temporaryRoots.push(root);
    const firstPath = path.join(root, 'first.png');
    const secondPath = path.join(root, 'second.png');
    writeFileSync(firstPath, VALID_1X1_PNG);
    writeFileSync(secondPath, Buffer.from('second-original'));

    const events: unknown[] = [];
    const service = new LibraryService({
      onAssetsChanged: (event) => events.push(event),
    });
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Batch content replacement',
      selectedParentPath: root,
    });
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [firstPath, secondPath],
    });
    if (!('assets' in imported) || imported.assets.length !== 2) {
      throw new Error('Expected two imported assets.');
    }
    const first = imported.assets.find((asset) => asset.displayName === 'first.png')!;
    const second = imported.assets.find((asset) => asset.displayName === 'second.png')!;
    const staged = service.stageManagedAssetContent({
      libraryId: library.libraryId,
      assetId: first.assetId,
      dataBase64: Buffer.from('first-replacement').toString('base64'),
      complete: true,
    });
    const result = service.replaceManagedAssetContentBatch({
      libraryId: library.libraryId,
      items: [
        {
          assetId: first.assetId,
          stagingToken: staged.stagingToken,
          expectedRevisionId: first.currentRevisionId,
        },
        {
          assetId: second.assetId,
          dataBase64: Buffer.from('second-replacement').toString('base64'),
          expectedRevisionId: second.currentRevisionId,
        },
      ],
    });

    expect(result.items).toHaveLength(2);
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'first.png'))).toEqual(
      Buffer.from('first-replacement'),
    );
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'second.png'))).toEqual(
      Buffer.from('second-replacement'),
    );
    expect(events.filter((event) => (
      typeof event === 'object' &&
      event !== null &&
      'source' in event &&
      event.source === 'content-replace'
    ))).toEqual([{
      type: 'asset.changed',
      libraryId: library.libraryId,
      changedCount: 2,
      missingCount: 0,
      source: 'content-replace',
    }]);
    expect(service.listAssets({ libraryId: library.libraryId, recursive: false })
      .map((asset) => asset.currentRevisionId))
      .toEqual(expect.arrayContaining(result.items.map((item) => item.revisionId)));
  });

  it('rejects an oversized staging chunk before creating a staging file', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-content-stage-limit-test-'));
    temporaryRoots.push(root);
    const sourcePath = path.join(root, 'asset.png');
    writeFileSync(sourcePath, VALID_1X1_PNG);

    const service = new LibraryService();
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Content staging limit',
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
    const stagingToken = '00000000-0000-4000-8000-000000000000';

    expect(() => service.stageManagedAssetContent({
      libraryId: library.libraryId,
      assetId: imported.assets[0]!.assetId,
      stagingToken,
      dataBase64: Buffer.alloc(CONTENT_REPLACE_STAGE_CHUNK_MAX_BYTES + 1).toString('base64'),
      complete: false,
    })).toThrow();
    expect(existsSync(path.join(library.libraryPath, '.serpent', 'content-staging', `${stagingToken}.bin`))).toBe(false);
  });

  it('preflights every expected revision before writing any batch target', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-content-replace-batch-fence-test-'));
    temporaryRoots.push(root);
    const firstPath = path.join(root, 'first.png');
    const secondPath = path.join(root, 'second.png');
    writeFileSync(firstPath, Buffer.from('first-original'));
    writeFileSync(secondPath, Buffer.from('second-original'));

    const events: unknown[] = [];
    const service = new LibraryService({ onAssetsChanged: (event) => events.push(event) });
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Batch content fence',
      selectedParentPath: root,
    });
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [firstPath, secondPath],
    });
    if (!('assets' in imported) || imported.assets.length !== 2) {
      throw new Error('Expected two imported assets.');
    }
    const first = imported.assets.find((asset) => asset.displayName === 'first.png')!;
    const second = imported.assets.find((asset) => asset.displayName === 'second.png')!;

    expect(() => service.replaceManagedAssetContentBatch({
      libraryId: library.libraryId,
      items: [
        {
          assetId: first.assetId,
          dataBase64: Buffer.from('first-new').toString('base64'),
          expectedRevisionId: first.currentRevisionId,
        },
        {
          assetId: second.assetId,
          dataBase64: Buffer.from('second-new').toString('base64'),
          expectedRevisionId: 'stale-revision',
        },
      ],
    })).toThrow();
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'first.png'))).toEqual(
      Buffer.from('first-original'),
    );
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'second.png'))).toEqual(
      Buffer.from('second-original'),
    );
    expect(events.filter((event) => (
      typeof event === 'object' &&
      event !== null &&
      'source' in event &&
      event.source === 'content-replace'
    ))).toEqual([]);
  });

  it('rejects a target changed after preflight without overwriting it or other batch targets', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-content-replace-batch-external-change-test-'));
    temporaryRoots.push(root);
    const firstPath = path.join(root, 'first.png');
    const secondPath = path.join(root, 'second.png');
    writeFileSync(firstPath, Buffer.from('first-original'));
    writeFileSync(secondPath, Buffer.from('second-original'));

    let firstTargetPath = '';
    let changedExternally = false;
    const service = new LibraryService({
      beforeContentReplaceBatchBackup: ({ assetId }) => {
        if (assetId !== firstAssetId || changedExternally) return;
        changedExternally = true;
        writeFileSync(firstTargetPath, Buffer.from('external-change'));
      },
    });
    let firstAssetId = '';
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Batch external change fence',
      selectedParentPath: root,
    });
    firstTargetPath = path.join(library.libraryPath, 'Assets', 'first.png');
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [firstPath, secondPath],
    });
    if (!('assets' in imported) || imported.assets.length !== 2) {
      throw new Error('Expected two imported assets.');
    }
    const first = imported.assets.find((asset) => asset.displayName === 'first.png')!;
    const second = imported.assets.find((asset) => asset.displayName === 'second.png')!;
    firstAssetId = first.assetId;

    expect(() => service.replaceManagedAssetContentBatch({
      libraryId: library.libraryId,
      items: [
        {
          assetId: first.assetId,
          dataBase64: Buffer.from('first-new').toString('base64'),
          expectedRevisionId: first.currentRevisionId,
        },
        {
          assetId: second.assetId,
          dataBase64: Buffer.from('second-new').toString('base64'),
          expectedRevisionId: second.currentRevisionId,
        },
      ],
    })).toThrow('VERSION_CONFLICT');

    expect(readFileSync(firstTargetPath)).toEqual(Buffer.from('external-change'));
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'second.png'))).toEqual(
      Buffer.from('second-original'),
    );
    expect(service.listAssets({ libraryId: library.libraryId, recursive: false })
      .map((asset) => asset.currentRevisionId))
      .toEqual(expect.arrayContaining([first.currentRevisionId, second.currentRevisionId]));
  });

  it('uses the batch journal to restore a partially placed filesystem after restart', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-content-replace-batch-recovery-test-'));
    temporaryRoots.push(root);
    const firstPath = path.join(root, 'first.png');
    const secondPath = path.join(root, 'second.png');
    writeFileSync(firstPath, Buffer.from('first-original'));
    writeFileSync(secondPath, Buffer.from('second-original'));

    const crashing = new LibraryService({ failAt: 'crash-content-replace-batch-after-first-file' });
    services.push(crashing);
    const library = crashing.createLibrary({
      displayName: 'Batch content recovery',
      selectedParentPath: root,
    });
    const imported = crashing.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [firstPath, secondPath],
    });
    if (!('assets' in imported) || imported.assets.length !== 2) {
      throw new Error('Expected two imported assets.');
    }
    const first = imported.assets.find((asset) => asset.displayName === 'first.png')!;
    const second = imported.assets.find((asset) => asset.displayName === 'second.png')!;
    expect(() => crashing.replaceManagedAssetContentBatch({
      libraryId: library.libraryId,
      items: [
        {
          assetId: first.assetId,
          dataBase64: Buffer.from('first-new').toString('base64'),
          expectedRevisionId: first.currentRevisionId,
        },
        {
          assetId: second.assetId,
          dataBase64: Buffer.from('second-new').toString('base64'),
          expectedRevisionId: second.currentRevisionId,
        },
      ],
    })).toThrow();
    crashing.closeAll();

    const recovered = new LibraryService();
    services.push(recovered);
    recovered.openLibrary(library.libraryPath);
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'first.png'))).toEqual(
      Buffer.from('first-original'),
    );
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'second.png'))).toEqual(
      Buffer.from('second-original'),
    );
    expect(recovered.listAssets({ libraryId: library.libraryId, recursive: false })
      .map((asset) => asset.currentRevisionId))
      .toEqual(expect.arrayContaining([first.currentRevisionId, second.currentRevisionId]));
  });

  it('retains the batch journal when recovery finds an external destination conflict', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-content-replace-batch-recovery-conflict-test-'));
    temporaryRoots.push(root);
    const firstPath = path.join(root, 'first.png');
    const secondPath = path.join(root, 'second.png');
    writeFileSync(firstPath, Buffer.from('first-original'));
    writeFileSync(secondPath, Buffer.from('second-original'));

    let secondAssetId = '';
    let changedExternally = false;
    const service = new LibraryService({
      beforeContentReplaceBatchBackup: ({ assetId }) => {
        if (assetId !== secondAssetId || changedExternally) return;
        changedExternally = true;
        writeFileSync(path.join(library.libraryPath, 'Assets', 'first.png'), Buffer.from('external-during-recovery'));
      },
    });
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Batch recovery conflict',
      selectedParentPath: root,
    });
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [firstPath, secondPath],
    });
    if (!('assets' in imported) || imported.assets.length !== 2) {
      throw new Error('Expected two imported assets.');
    }
    const first = imported.assets.find((asset) => asset.displayName === 'first.png')!;
    const second = imported.assets.find((asset) => asset.displayName === 'second.png')!;
    secondAssetId = second.assetId;
    expect(() => service.replaceManagedAssetContentBatch({
      libraryId: library.libraryId,
      items: [
        {
          assetId: first.assetId,
          dataBase64: Buffer.from('first-new').toString('base64'),
          expectedRevisionId: first.currentRevisionId,
        },
        {
          assetId: second.assetId,
          dataBase64: Buffer.from('second-new').toString('base64'),
          expectedRevisionId: second.currentRevisionId,
        },
      ],
    })).toThrow('VERSION_CONFLICT');

    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'first.png'))).toEqual(
      Buffer.from('external-during-recovery'),
    );
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'second.png'))).toEqual(
      Buffer.from('second-original'),
    );
    const operationsPath = path.join(library.libraryPath, '.serpent', 'operations');
    const operationDirectories = readdirSync(operationsPath);
    expect(operationDirectories).toHaveLength(1);
    expect(existsSync(path.join(operationsPath, operationDirectories[0]!, 'backup'))).toBe(true);

    service.closeAll();
    const reopened = new LibraryService();
    services.push(reopened);
    reopened.openLibrary(library.libraryPath);
    const retainedAfterReopen = readdirSync(operationsPath);
    expect(retainedAfterReopen).toEqual(operationDirectories);
    expect(existsSync(path.join(operationsPath, retainedAfterReopen[0]!, 'backup'))).toBe(true);
  });

  it('replaces content on a linked asset with a new revision and writes to external file', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-linked-replace-test-'));
    temporaryRoots.push(root);
    const linkedRoot = mkdtempSync(path.join(tmpdir(), 'serpent-linked-root-'));
    temporaryRoots.push(linkedRoot);
    const linkedFilePath = path.join(linkedRoot, 'linked-image.png');
    const originalBytes = Buffer.from('original-linked-image');
    writeFileSync(linkedFilePath, originalBytes);

    const service = new LibraryService();
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Linked content replace',
      selectedParentPath: root,
    });
    service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: linkedRoot,
    });
    const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
    expect(assets).toHaveLength(1);
    const linkedAsset = assets[0]!;
    expect(linkedAsset.locationKind).toBe('linked');

    const replacement = Buffer.from('replaced-linked-image-bytes');
    const result = service.replaceManagedAssetContent({
      libraryId: library.libraryId,
      assetId: linkedAsset.assetId,
      dataBase64: replacement.toString('base64'),
      expectedRevisionId: linkedAsset.currentRevisionId,
    });

    expect(result).toMatchObject({
      assetId: linkedAsset.assetId,
      byteSize: replacement.length,
    });
    expect(result.revisionId).not.toBe(linkedAsset.currentRevisionId);
    expect(readFileSync(linkedFilePath)).toEqual(replacement);
    const updated = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
    expect(updated.currentRevisionId).toBe(result.revisionId);
  });

  it('stages content and replaces a batch containing both managed and linked assets', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-mixed-batch-test-'));
    temporaryRoots.push(root);
    const linkedRoot = mkdtempSync(path.join(tmpdir(), 'serpent-mixed-linked-root-'));
    temporaryRoots.push(linkedRoot);

    const managedSourcePath = path.join(root, 'managed.png');
    writeFileSync(managedSourcePath, Buffer.from('managed-original'));
    const linkedFilePath = path.join(linkedRoot, 'linked.png');
    writeFileSync(linkedFilePath, Buffer.from('linked-original'));

    const service = new LibraryService();
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Mixed batch replace',
      selectedParentPath: root,
    });
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [managedSourcePath],
    });
    if (!('assets' in imported) || imported.assets.length !== 1) {
      throw new Error('Expected one imported managed asset.');
    }
    const managedAsset = imported.assets[0]!;

    service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: linkedRoot,
    });
    const allAssets = service.listAssets({ libraryId: library.libraryId, recursive: true });
    const linkedAsset = allAssets.find((a) => a.locationKind === 'linked')!;
    expect(linkedAsset).toBeDefined();

    const stagedManaged = service.stageManagedAssetContent({
      libraryId: library.libraryId,
      assetId: managedAsset.assetId,
      dataBase64: Buffer.from('managed-new').toString('base64'),
      complete: true,
    });
    const stagedLinked = service.stageManagedAssetContent({
      libraryId: library.libraryId,
      assetId: linkedAsset.assetId,
      dataBase64: Buffer.from('linked-new').toString('base64'),
      complete: true,
    });

    const result = service.replaceManagedAssetContentBatch({
      libraryId: library.libraryId,
      items: [
        {
          assetId: managedAsset.assetId,
          stagingToken: stagedManaged.stagingToken,
          expectedRevisionId: managedAsset.currentRevisionId,
        },
        {
          assetId: linkedAsset.assetId,
          stagingToken: stagedLinked.stagingToken,
          expectedRevisionId: linkedAsset.currentRevisionId,
        },
      ],
    });

    expect(result.items).toHaveLength(2);
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'managed.png'))).toEqual(
      Buffer.from('managed-new'),
    );
    expect(readFileSync(linkedFilePath)).toEqual(Buffer.from('linked-new'));
  });
});
