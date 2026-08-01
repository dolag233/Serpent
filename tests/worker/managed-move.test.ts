import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import type { LibraryServiceError } from '../../src/worker/library-service';
import { importNoConflict as importFile } from './import-no-conflict';

const roots: string[] = [];
const require = createRequire(import.meta.url);
const TestDatabase = require('better-sqlite3') as new (filename: string) => {
  close(): void;
  prepare(source: string): {
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
  };
};

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), 'serpent-managed-move-'));
  roots.push(value);
  return value;
}

function expectCode(run: () => unknown, code: LibraryServiceError['code']) {
  expect(run).toThrowError(expect.objectContaining({ code }));
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { force: true, recursive: true });
});

describe('managed asset move and one-shot undo', () => {
  it('moves a batch while preserving identities and organization metadata, then undoes it', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Move', selectedParentPath: temp });
    const sourceFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Source' });
    const targetFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Target' });
    const sourceA = path.join(temp, 'a.png');
    const sourceB = path.join(temp, 'b.png');
    writeFileSync(sourceA, 'a');
    writeFileSync(sourceB, 'b');
    const a = importFile(service, library.libraryId, sourceA, sourceFolder.folderId).assets[0]!;
    const b = importFile(service, library.libraryId, sourceB, sourceFolder.folderId).assets[0]!;
    const tag = service.createTag({ libraryId: library.libraryId, name: 'Keep' });
    service.assignTags({ libraryId: library.libraryId, assetIds: [a.assetId], tagIds: [tag.tagId] });
    const collection = service.createCollection({ libraryId: library.libraryId, name: 'Set' });
    service.addCollectionAssets({ libraryId: library.libraryId, collectionId: collection.collectionId, assetIds: [a.assetId] });
    service.setAssetMetadata({ libraryId: library.libraryId, assetId: a.assetId, expectedVersion: 0, description: 'Hero', sourcePageUrl: 'https://example.com/a' });

    const moved = service.moveAssets({
      libraryId: library.libraryId,
      assetIds: [a.assetId, b.assetId],
      targetFolderId: targetFolder.folderId,
      conflictStrategy: 'keep-both',
    });
    expect(moved).toMatchObject({ movedCount: 2, skippedCount: 0 });
    expect(moved.operationId).toEqual(expect.any(String));
    expect(moved.assets.map((asset) => asset.assetId)).toEqual([a.assetId, b.assetId]);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Target', 'a.png'))).toBe(true);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Source', 'a.png'))).toBe(false);
    expect(service.getAssetMetadata({ libraryId: library.libraryId, assetId: a.assetId })).toMatchObject({ description: 'Hero', sourcePageUrl: 'https://example.com/a' });
    expect(service.listCollectionAssets({ libraryId: library.libraryId, collectionId: collection.collectionId, recursive: false }).map((asset) => asset.assetId)).toContain(a.assetId);
    expect(service.listTags(library.libraryId).find((item) => item.tagId === tag.tagId)?.assetCount).toBe(1);

    const undone = service.undoMoveAssets({ libraryId: library.libraryId, operationId: moved.operationId! });
    expect(undone).toMatchObject({ undoneCount: 2, skippedCount: 0 });
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Source', 'a.png'))).toBe(true);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Target', 'a.png'))).toBe(false);
    expectCode(
      () => service.undoMoveAssets({ libraryId: library.libraryId, operationId: moved.operationId! }),
      'ASSET_MOVE_CONFLICT',
    );
    service.closeAll();
  });

  it('supports keep-both, skip, and replace without silently overwriting', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Conflicts', selectedParentPath: temp });
    const left = service.createManagedFolder({ libraryId: library.libraryId, name: 'Left' });
    const right = service.createManagedFolder({ libraryId: library.libraryId, name: 'Right' });
    const leftSource = path.join(temp, 'left-source', 'same.png');
    const rightSource = path.join(temp, 'right-source', 'same.png');
    mkdirSync(path.dirname(leftSource), { recursive: true });
    mkdirSync(path.dirname(rightSource), { recursive: true });
    writeFileSync(leftSource, 'left');
    writeFileSync(rightSource, 'right');
    const leftAsset = importFile(service, library.libraryId, leftSource, left.folderId).assets[0]!;
    const rightAsset = importFile(service, library.libraryId, rightSource, right.folderId).assets[0]!;
    const skipped = service.moveAssets({ libraryId: library.libraryId, assetIds: [leftAsset.assetId], targetFolderId: right.folderId, conflictStrategy: 'skip' });
    expect(skipped).toMatchObject({ movedCount: 0, skippedCount: 1, operationId: null });
    const kept = service.moveAssets({ libraryId: library.libraryId, assetIds: [leftAsset.assetId], targetFolderId: right.folderId, conflictStrategy: 'keep-both' });
    expect(kept.assets[0]!.relativeFilePath).toBe('Right/same (2).png');
    service.undoMoveAssets({ libraryId: library.libraryId, operationId: kept.operationId! });
    const replaced = service.moveAssets({ libraryId: library.libraryId, assetIds: [leftAsset.assetId], targetFolderId: right.folderId, conflictStrategy: 'replace' });
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'Right', 'same.png'), 'utf8')).toBe('left');
    expect(service.listTrash(library.libraryId).map((asset) => asset.assetId)).toContain(rightAsset.assetId);
    service.undoMoveAssets({ libraryId: library.libraryId, operationId: replaced.operationId! });
    expect(readFileSync(path.join(library.libraryPath, 'Assets', 'Right', 'same.png'), 'utf8')).toBe('right');
    expect(service.listTrash(library.libraryId).map((asset) => asset.assetId)).not.toContain(rightAsset.assetId);
    service.closeAll();
  });

  it.each(['crash-move-after-conflict', 'crash-move-after-filesystem', 'crash-move-before-db-commit'] as const)(
    'rolls an interrupted move back on reopen at %s',
    (failurePoint) => {
      const temp = root();
      const setup = new LibraryService();
      const library = setup.createLibrary({ displayName: `Crash ${failurePoint}`, selectedParentPath: temp });
      const sourceFolder = setup.createManagedFolder({ libraryId: library.libraryId, name: 'Source' });
      const targetFolder = setup.createManagedFolder({ libraryId: library.libraryId, name: 'Target' });
      const source = path.join(temp, 'crash.png');
      writeFileSync(source, 'source');
      const asset = importFile(setup, library.libraryId, source, sourceFolder.folderId).assets[0]!;
      writeFileSync(path.join(library.libraryPath, 'Assets', 'Target', 'crash.png'), 'conflict');
      setup.closeAll();

      const crashing = new LibraryService({ failAt: failurePoint });
      crashing.openLibrary(library.libraryPath);
      expectCode(() => crashing.moveAssets({
        libraryId: library.libraryId,
        assetIds: [asset.assetId],
        targetFolderId: targetFolder.folderId,
        conflictStrategy: 'replace',
      }), 'LIBRARY_NOT_WRITABLE');
      crashing.closeAll();

      const recovered = new LibraryService();
      recovered.openLibrary(library.libraryPath);
      expect(existsSync(path.join(library.libraryPath, 'Assets', 'Source', 'crash.png'))).toBe(true);
      expect(existsSync(path.join(library.libraryPath, 'Assets', 'Target', 'crash.png'))).toBe(true);
      const database = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
      expect(database.prepare("SELECT status FROM file_operations WHERE kind = 'managed-move' ORDER BY created_at DESC LIMIT 1").get()).toEqual({ status: 'rolled_back' });
      database.close();
      recovered.closeAll();
    },
  );

  it('does not undo over a newly occupied original path without an explicit strategy', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Undo conflict', selectedParentPath: temp });
    const sourceFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Source' });
    const targetFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Target' });
    const source = path.join(temp, 'asset.png');
    writeFileSync(source, 'asset');
    const asset = importFile(service, library.libraryId, source, sourceFolder.folderId).assets[0]!;
    const moved = service.moveAssets({ libraryId: library.libraryId, assetIds: [asset.assetId], targetFolderId: targetFolder.folderId });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'Source', 'asset.png'), 'new');
    expectCode(() => service.undoMoveAssets({ libraryId: library.libraryId, operationId: moved.operationId! }), 'ASSET_MOVE_CONFLICT');
    const undone = service.undoMoveAssets({ libraryId: library.libraryId, operationId: moved.operationId!, conflictStrategy: 'keep-both' });
    expect(undone.assets[0]!.relativeFilePath).toBe('Source/asset (2).png');
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Source', 'asset.png'))).toBe(true);
    service.closeAll();
  });

  it('resolves an undo conflict when the occupying DB row has a missing file', () => {
    const temp = root();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Stale undo conflict', selectedParentPath: temp });
    const sourceFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Source' });
    const targetFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Target' });
    const source = path.join(temp, 'asset.png');
    writeFileSync(source, 'asset');
    const asset = importFile(service, library.libraryId, source, sourceFolder.folderId).assets[0]!;
    const moved = service.moveAssets({
      libraryId: library.libraryId,
      assetIds: [asset.assetId],
      targetFolderId: targetFolder.folderId,
    });

    // Recreate the original path as an active-but-missing DB row. This is the
    // race that previously made the conflict dialog retry fail immediately.
    const staleSource = path.join(temp, 'stale.png');
    writeFileSync(staleSource, 'stale');
    const stale = importFile(service, library.libraryId, staleSource, sourceFolder.folderId).assets[0]!;
    service.closeAll();
    const database = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    database
      .prepare('UPDATE assets SET relative_file_path = ?, path_identity = ?, availability = ? WHERE asset_id = ?')
      .run('Source/asset.png', 'source/asset.png', 'missing', stale.assetId);
    database.close();
    rmSync(path.join(library.libraryPath, 'Assets', 'Source', 'stale.png'), { force: true });

    const recovered = new LibraryService();
    recovered.openLibrary(library.libraryPath);
    const undone = recovered.undoMoveAssets({
      libraryId: library.libraryId,
      operationId: moved.operationId!,
      conflictStrategy: 'keep-both',
    });
    expect(undone).toMatchObject({ undoneCount: 1, skippedCount: 0 });
    expect(undone.assets[0]!.relativeFilePath).toBe('Source/asset (2).png');
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Source', 'asset (2).png'))).toBe(true);
    recovered.closeAll();
  });

  it('rolls an interrupted undo back on reopen and leaves the one-shot undo available', () => {
    const temp = root();
    const setup = new LibraryService();
    const library = setup.createLibrary({ displayName: 'Undo crash', selectedParentPath: temp });
    const sourceFolder = setup.createManagedFolder({ libraryId: library.libraryId, name: 'Source' });
    const targetFolder = setup.createManagedFolder({ libraryId: library.libraryId, name: 'Target' });
    const source = path.join(temp, 'asset.png');
    writeFileSync(source, 'asset');
    const asset = importFile(setup, library.libraryId, source, sourceFolder.folderId).assets[0]!;
    const moved = setup.moveAssets({ libraryId: library.libraryId, assetIds: [asset.assetId], targetFolderId: targetFolder.folderId });
    setup.closeAll();

    const crashing = new LibraryService({ failAt: 'crash-move-after-filesystem' });
    crashing.openLibrary(library.libraryPath);
    expectCode(() => crashing.undoMoveAssets({ libraryId: library.libraryId, operationId: moved.operationId! }), 'LIBRARY_NOT_WRITABLE');
    crashing.closeAll();

    const recovered = new LibraryService();
    recovered.openLibrary(library.libraryPath);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Target', 'asset.png'))).toBe(true);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Source', 'asset.png'))).toBe(false);
    expect(recovered.undoMoveAssets({ libraryId: library.libraryId, operationId: moved.operationId! })).toMatchObject({ undoneCount: 1 });
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Source', 'asset.png'))).toBe(true);
    recovered.closeAll();
  });

  it('keeps a move committed when the process crashes after the shared DB commit', () => {
    const temp = root();
    const setup = new LibraryService();
    const library = setup.createLibrary({ displayName: 'Post commit crash', selectedParentPath: temp });
    const sourceFolder = setup.createManagedFolder({ libraryId: library.libraryId, name: 'Source' });
    const targetFolder = setup.createManagedFolder({ libraryId: library.libraryId, name: 'Target' });
    const source = path.join(temp, 'asset.png');
    writeFileSync(source, 'asset');
    const asset = importFile(setup, library.libraryId, source, sourceFolder.folderId).assets[0]!;
    setup.closeAll();

    const crashing = new LibraryService({ failAt: 'crash-move-after-db-commit' });
    crashing.openLibrary(library.libraryPath);
    expectCode(() => crashing.moveAssets({
      libraryId: library.libraryId,
      assetIds: [asset.assetId],
      targetFolderId: targetFolder.folderId,
    }), 'LIBRARY_NOT_WRITABLE');
    crashing.closeAll();

    const recovered = new LibraryService();
    recovered.openLibrary(library.libraryPath);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Target', 'asset.png'))).toBe(true);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Source', 'asset.png'))).toBe(false);
    const database = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    expect(database.prepare("SELECT status FROM file_operations WHERE kind = 'managed-move' ORDER BY created_at DESC LIMIT 1").get()).toEqual({ status: 'committed' });
    database.close();
    recovered.closeAll();
  });
});
