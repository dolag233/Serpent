import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import type { ImportCompletion } from '../../src/shared/protocol/responses';

const roots: string[] = [];
const services: LibraryService[] = [];
const require = createRequire(import.meta.url);
const TestDatabase = require('better-sqlite3') as new (filename: string) => {
  close(): void;
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
  };
};

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), 'serpent-folder-delete-'));
  roots.push(value);
  return value;
}

// LibraryService holds SQLite connections and recursive fs watchers; on
// Windows those open handles block rm of the temp tree (POSIX unlinks open
// files, which is why the leak is invisible on macOS). Always close first.
function newService(
  ...args: ConstructorParameters<typeof LibraryService>
): LibraryService {
  const service = new LibraryService(...args);
  services.push(service);
  return service;
}

function importFile(
  service: LibraryService,
  libraryId: string,
  sourcePath: string,
  targetFolderId?: string,
) {
  return service.prepareOrExecuteImport({
    libraryId,
    sourceKind: 'files',
    sourcePaths: [sourcePath],
    targetFolderId,
  }) as ImportCompletion;
}

function database(libraryPath: string) {
  return new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const value of roots.splice(0)) rmSync(value, { force: true, recursive: true });
});

describe('trashManagedFolder (clarification #7 / Serpent-ekj)', () => {
  it('trashes assets in an empty and non-empty managed folder the same way', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'FolderTrash',
      selectedParentPath: temp,
    });
    const empty = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'empty',
    });
    const filled = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'filled',
    });
    const nested = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'nested',
      parentFolderId: filled.folderId,
    });
    const source = path.join(temp, 'a.png');
    writeFileSync(source, 'asset-bytes');
    const asset = importFile(service, library.libraryId, source, nested.folderId).assets[0]!;

    const emptyResult = service.trashManagedFolder({
      libraryId: library.libraryId,
      folderId: empty.folderId,
    });
    expect(emptyResult).toEqual({ trashedAssetCount: 0, removedFolderCount: 1 });
    expect(
      existsSync(path.join(library.libraryPath, 'Assets', 'empty')),
    ).toBe(false);

    const filledResult = service.trashManagedFolder({
      libraryId: library.libraryId,
      folderId: filled.folderId,
    });
    expect(filledResult).toEqual({ trashedAssetCount: 1, removedFolderCount: 2 });
    expect(
      existsSync(path.join(library.libraryPath, 'Assets', 'filled')),
    ).toBe(false);

    const trash = service.listTrash(library.libraryId);
    expect(trash.map((row) => row.assetId)).toEqual([asset.assetId]);

    const db = database(library.libraryPath);
    try {
      const folders = db
        .prepare('SELECT folder_id FROM managed_folders')
        .all() as Array<{ folder_id: string }>;
      expect(folders.map((row) => row.folder_id)).not.toContain(filled.folderId);
      expect(folders.map((row) => row.folder_id)).not.toContain(nested.folderId);
    } finally {
      db.close();
    }
  });
});

describe('deleteAssetsFromDisk (clarification #7 / Serpent-9zc)', () => {
  it('permanently removes managed asset bytes and DB rows without trash', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'AssetDiskDelete',
      selectedParentPath: temp,
    });
    const source = path.join(temp, 'solo.png');
    writeFileSync(source, 'asset-disk-delete');
    const asset = importFile(service, library.libraryId, source).assets[0]!;
    const assetPath = path.join(library.libraryPath, 'Assets', 'solo.png');
    expect(existsSync(assetPath)).toBe(true);

    const result = service.deleteAssetsFromDisk({
      libraryId: library.libraryId,
      assetIds: [asset.assetId],
    });
    expect(result).toEqual({ deletedCount: 1 });
    expect(existsSync(assetPath)).toBe(false);
    expect(service.listTrash(library.libraryId)).toEqual([]);

    const db = database(library.libraryPath);
    try {
      const assetRow = db
        .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
        .get(asset.assetId);
      expect(assetRow).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('rejects linked or already-trashed assets', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'AssetDiskDeleteReject',
      selectedParentPath: temp,
    });
    const source = path.join(temp, 't.png');
    writeFileSync(source, 'trash-then-disk');
    const asset = importFile(service, library.libraryId, source).assets[0]!;
    service.trashAssets({
      libraryId: library.libraryId,
      assetIds: [asset.assetId],
    });
    expect(() =>
      service.deleteAssetsFromDisk({
        libraryId: library.libraryId,
        assetIds: [asset.assetId],
      }),
    ).toThrow();
  });
});

describe('deleteManagedFolderFromDisk (clarification #7 / Serpent-ekj)', () => {
  it('permanently removes the folder tree and assets without leaving trash rows', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'FolderDiskDelete',
      selectedParentPath: temp,
    });
    const folder = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'gone',
    });
    const source = path.join(temp, 'b.png');
    writeFileSync(source, 'disk-delete');
    const asset = importFile(service, library.libraryId, source, folder.folderId).assets[0]!;
    const assetPath = path.join(library.libraryPath, 'Assets', 'gone', 'b.png');
    expect(existsSync(assetPath)).toBe(true);

    const result = service.deleteManagedFolderFromDisk({
      libraryId: library.libraryId,
      folderId: folder.folderId,
    });
    expect(result).toEqual({ deletedAssetCount: 1, removedFolderCount: 1 });
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'gone'))).toBe(false);
    expect(service.listTrash(library.libraryId)).toEqual([]);

    const db = database(library.libraryPath);
    try {
      const assetRow = db
        .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
        .get(asset.assetId);
      expect(assetRow).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

describe('removeLinkedFolder (clarification #7 / Serpent-ekj)', () => {
  it('removes the linked root index and keeps the external source directory', () => {
    const temp = root();
    const external = path.join(temp, 'external-root');
    mkdirSync(external);
    const externalFile = path.join(external, 'c.png');
    writeFileSync(externalFile, 'linked-bytes');

    const service = newService();
    const library = service.createLibrary({
      displayName: 'LinkedRemove',
      selectedParentPath: temp,
    });
    const linked = service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: external,
      displayName: '外部',
    });
    expect(
      service.listAssets({
        libraryId: library.libraryId,
        folderId: linked.folderId,
        recursive: true,
      }).length,
    ).toBeGreaterThan(0);

    const result = service.removeLinkedFolder({
      libraryId: library.libraryId,
      folderId: linked.folderId,
    });
    expect(result.removedAssetCount).toBeGreaterThan(0);
    expect(existsSync(externalFile)).toBe(true);
    expect(service.listLinkedFolders(library.libraryId)).toEqual([]);
  });
});

describe('deleteLinkedFolderSubtree (clarification #7 / Serpent-ekj)', () => {
  it('moves a linked child path to the OS trash by default', async () => {
    const temp = root();
    const external = path.join(temp, 'linked-tree');
    const child = path.join(external, 'child');
    mkdirSync(child, { recursive: true });
    writeFileSync(path.join(child, 'd.png'), 'child-bytes');
    writeFileSync(path.join(external, 'root.png'), 'root-bytes');

    const trashed: string[] = [];
    const service = newService({
      trashItem: async (sourcePath: string) => {
        trashed.push(sourcePath);
        rmSync(sourcePath, { force: true, recursive: true });
      },
    });
    const library = service.createLibrary({
      displayName: 'LinkedSubtree',
      selectedParentPath: temp,
    });
    const linked = service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: external,
      displayName: '树',
    });

    const trashResult = await service.deleteLinkedFolderSubtree({
      libraryId: library.libraryId,
      linkedFolderId: linked.folderId,
      relativePath: 'child',
      deleteFromDisk: false,
    });
    expect(trashResult.deletedAssetCount).toBe(1);
    expect(trashed.some((entry) => entry.includes(`${path.sep}child`))).toBe(true);
    expect(existsSync(path.join(external, 'root.png'))).toBe(true);
  });

  it('permanently deletes a linked child directory tree from disk', async () => {
    const temp = root();
    const external = path.join(temp, 'linked-perm');
    const child = path.join(external, 'props');
    mkdirSync(child, { recursive: true });
    writeFileSync(path.join(child, 'f.png'), 'perm');
    writeFileSync(path.join(external, 'keep.png'), 'keep');

    const service = newService();
    const library = service.createLibrary({
      displayName: 'LinkedPerm',
      selectedParentPath: temp,
    });
    const linked = service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: external,
      displayName: '永久',
    });

    const result = await service.deleteLinkedFolderSubtree({
      libraryId: library.libraryId,
      linkedFolderId: linked.folderId,
      relativePath: 'props',
      deleteFromDisk: true,
    });
    expect(result).toEqual({ deletedAssetCount: 1, failedCount: 0 });
    expect(existsSync(child)).toBe(false);
    expect(existsSync(path.join(external, 'keep.png'))).toBe(true);

    const remaining = service.listAssets({
      libraryId: library.libraryId,
      folderId: linked.folderId,
      recursive: true,
    });
    expect(remaining.map((asset) => asset.relativeFilePath)).toEqual(['keep.png']);
  });
});
