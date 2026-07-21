import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import type { LibraryServiceError } from '../../src/worker/library-service';
import type { ImportCompletion } from '../../src/shared/protocol/responses';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), 'serpent-managed-copy-'));
  roots.push(value);
  return value;
}

function importFile(service: LibraryService, libraryId: string, sourcePath: string, targetFolderId?: string) {
  return service.prepareOrExecuteImport({
    libraryId,
    sourceKind: 'files',
    sourcePaths: [sourcePath],
    targetFolderId,
  }) as ImportCompletion;
}

function expectCode(run: () => unknown, code: LibraryServiceError['code']) {
  expect(run).toThrowError(expect.objectContaining({ code }));
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { force: true, recursive: true });
});

describe('managed asset copy and one-shot undo (Serpent-2vn)', () => {
  it('copies into another folder with a new identity, clones human metadata, then undoes', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Copy', selectedParentPath: temp });
    const sourceFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Source' });
    const targetFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Target' });
    const sourceA = path.join(temp, 'a.png');
    writeFileSync(sourceA, 'payload-a');
    const a = importFile(service, library.libraryId, sourceA, sourceFolder.folderId).assets[0]!;
    const tag = service.createTag({ libraryId: library.libraryId, name: 'Keep' });
    service.assignTags({ libraryId: library.libraryId, assetIds: [a.assetId], tagIds: [tag.tagId] });
    service.setAssetMetadata({
      libraryId: library.libraryId,
      assetId: a.assetId,
      expectedVersion: 0,
      description: 'Hero',
      sourcePageUrl: 'https://example.com/a',
    });

    const copied = service.copyAssets({
      libraryId: library.libraryId,
      assetIds: [a.assetId],
      targetFolderId: targetFolder.folderId,
      conflictStrategy: 'keep-both',
    });
    expect(copied).toMatchObject({ copiedCount: 1, skippedCount: 0 });
    expect(copied.operationId).toEqual(expect.any(String));
    const clone = copied.assets[0]!;
    expect(clone.assetId).not.toBe(a.assetId);
    expect(clone.relativeFilePath).toBe('Target/a.png');
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Source', 'a.png'))).toBe(true);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Target', 'a.png'))).toBe(true);
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'Target', 'a.png'), 'utf8')).toBe('payload-a');
    expect(service.getAssetMetadata({ libraryId: library.libraryId, assetId: clone.assetId })).toMatchObject({
      description: 'Hero',
      sourcePageUrl: 'https://example.com/a',
    });
    expect(service.listTags(library.libraryId).find((item) => item.tagId === tag.tagId)?.assetCount).toBe(2);

    const undone = service.undoCopyAssets({
      libraryId: library.libraryId,
      operationId: copied.operationId!,
    });
    expect(undone).toMatchObject({ undoneCount: 1, skippedCount: 0 });
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Target', 'a.png'))).toBe(false);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Source', 'a.png'))).toBe(true);
    expect(service.listTags(library.libraryId).find((item) => item.tagId === tag.tagId)?.assetCount).toBe(1);
    expectCode(
      () => service.undoCopyAssets({ libraryId: library.libraryId, operationId: copied.operationId! }),
      'ASSET_MOVE_CONFLICT',
    );
    service.closeAll();
  });

  it('duplicates into the same folder with keep-both naming', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Same', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Album' });
    const source = path.join(temp, 'shot.png');
    writeFileSync(source, 'shot');
    const asset = importFile(service, library.libraryId, source, folder.folderId).assets[0]!;
    const copied = service.copyAssets({
      libraryId: library.libraryId,
      assetIds: [asset.assetId],
      targetFolderId: folder.folderId,
      conflictStrategy: 'keep-both',
    });
    expect(copied.copiedCount).toBe(1);
    expect(copied.assets[0]!.relativeFilePath).toBe('Album/shot (2).png');
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Album', 'shot.png'))).toBe(true);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Album', 'shot (2).png'))).toBe(true);
    service.closeAll();
  });

  it('supports skip and keep-both against an existing destination name', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Conflict', selectedParentPath: temp });
    const left = service.createManagedFolder({ libraryId: library.libraryId, name: 'Left' });
    const right = service.createManagedFolder({ libraryId: library.libraryId, name: 'Right' });
    const leftSource = path.join(temp, 'left-source', 'same.png');
    const rightSource = path.join(temp, 'right-source', 'same.png');
    mkdirSync(path.dirname(leftSource), { recursive: true });
    mkdirSync(path.dirname(rightSource), { recursive: true });
    writeFileSync(leftSource, 'left');
    writeFileSync(rightSource, 'right');
    const leftAsset = importFile(service, library.libraryId, leftSource, left.folderId).assets[0]!;
    importFile(service, library.libraryId, rightSource, right.folderId);

    const skipped = service.copyAssets({
      libraryId: library.libraryId,
      assetIds: [leftAsset.assetId],
      targetFolderId: right.folderId,
      conflictStrategy: 'skip',
    });
    expect(skipped).toMatchObject({ copiedCount: 0, skippedCount: 1, operationId: null });

    const kept = service.copyAssets({
      libraryId: library.libraryId,
      assetIds: [leftAsset.assetId],
      targetFolderId: right.folderId,
      conflictStrategy: 'keep-both',
    });
    expect(kept.assets[0]!.relativeFilePath).toBe('Right/same (2).png');
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'Right', 'same (2).png'), 'utf8')).toBe('left');
    service.closeAll();
  });
});
