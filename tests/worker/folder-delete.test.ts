import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict as importFile } from './import-no-conflict';

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
    expect(emptyResult).toMatchObject({ trashedAssetCount: 0, removedFolderCount: 1 });
    expect(emptyResult.tombstoneIds).toHaveLength(1);
    expect(
      existsSync(path.join(library.libraryPath, 'Assets', 'empty')),
    ).toBe(false);

    const filledResult = service.trashManagedFolder({
      libraryId: library.libraryId,
      folderId: filled.folderId,
    });
    expect(filledResult).toMatchObject({ trashedAssetCount: 1, removedFolderCount: 2 });
    expect(filledResult.tombstoneIds).toHaveLength(2);
    expect(
      existsSync(path.join(library.libraryPath, 'Assets', 'filled')),
    ).toBe(false);

    const trash = service.listTrash(library.libraryId);
    expect(trash.map((row) => row.assetId)).toEqual([asset.assetId]);

    const tombstones = service.listTrashedFolders(library.libraryId);
    expect(tombstones.map((row) => row.name).sort()).toEqual(
      ['empty', 'filled', 'nested'].sort(),
    );
    expect(tombstones.find((row) => row.name === 'nested')?.assetCount).toBe(1);
    expect(tombstones.find((row) => row.name === 'filled')?.assetCount).toBe(0);
    expect(tombstones.find((row) => row.name === 'empty')?.assetCount).toBe(0);

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

  it('includes ignored descendants when trashing a managed folder', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'FolderTrashIgnored',
      selectedParentPath: temp,
    });
    const folder = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'hidden-content',
    });
    const source = path.join(temp, 'ignored.png');
    writeFileSync(source, 'ignored-asset-bytes');
    const asset = importFile(service, library.libraryId, source, folder.folderId).assets[0]!;

    service.setIgnore({
      libraryId: library.libraryId,
      locationKind: 'managed',
      relativePath: 'hidden-content',
      pathKind: 'folder',
      ignored: true,
    });
    expect(service.listAssets({ libraryId: library.libraryId, folderId: folder.folderId, recursive: true })).toEqual([]);

    expect(service.trashManagedFolder({ libraryId: library.libraryId, folderId: folder.folderId })).toMatchObject({
      trashedAssetCount: 1,
      removedFolderCount: 1,
    });
    expect(service.listTrash(library.libraryId).map((row) => row.assetId)).toEqual([asset.assetId]);
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

  it('includes ignored descendants when deleting a managed folder from disk', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'FolderDiskDeleteIgnored',
      selectedParentPath: temp,
    });
    const folder = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'hidden-content',
    });
    const source = path.join(temp, 'ignored.png');
    writeFileSync(source, 'ignored-disk-delete');
    const asset = importFile(service, library.libraryId, source, folder.folderId).assets[0]!;

    service.setIgnore({
      libraryId: library.libraryId,
      locationKind: 'managed',
      relativePath: 'hidden-content',
      pathKind: 'folder',
      ignored: true,
    });
    expect(service.listAssets({ libraryId: library.libraryId, folderId: folder.folderId, recursive: true })).toEqual([]);

    expect(service.deleteManagedFolderFromDisk({ libraryId: library.libraryId, folderId: folder.folderId })).toMatchObject({
      deletedAssetCount: 1,
      removedFolderCount: 1,
    });
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'hidden-content'))).toBe(false);
    const db = database(library.libraryPath);
    try {
      expect(db.prepare('SELECT asset_id FROM assets WHERE asset_id = ?').get(asset.assetId)).toBeUndefined();
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

describe('restoreTrashedManagedFolder (Serpent-qufh)', () => {
  it('recreates folder rows and restores trashed assets in the subtree', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'FolderRestore',
      selectedParentPath: temp,
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
    const asset = importFile(
      service,
      library.libraryId,
      source,
      nested.folderId,
    ).assets[0]!;

    service.trashManagedFolder({
      libraryId: library.libraryId,
      folderId: filled.folderId,
    });
    const tombstone = service
      .listTrashedFolders(library.libraryId)
      .find((row) => row.name === 'filled');
    expect(tombstone).toBeDefined();

    const result = service.restoreTrashedManagedFolder({
      libraryId: library.libraryId,
      tombstoneId: tombstone!.tombstoneId,
    });
    expect(result.restoredFolderCount).toBeGreaterThanOrEqual(2);
    expect(result.restoredAssetCount).toBe(1);
    expect(service.listTrash(library.libraryId)).toEqual([]);
    expect(service.listAssets({
      libraryId: library.libraryId,
      folderId: nested.folderId,
      recursive: true,
    }).map((item) => item.assetId)).toContain(asset.assetId);
    expect(
      existsSync(path.join(library.libraryPath, 'Assets', 'filled', 'nested')),
    ).toBe(true);

    const db = database(library.libraryPath);
    try {
      const folderIds = (
        db.prepare('SELECT folder_id FROM managed_folders').all() as Array<{
          folder_id: string;
        }>
      ).map((row) => row.folder_id);
      expect(folderIds).toContain(filled.folderId);
      expect(folderIds).toContain(nested.folderId);
      const active = db
        .prepare('SELECT deleted_at FROM assets WHERE asset_id = ?')
        .get(asset.assetId) as { deleted_at: string | null };
      expect(active.deleted_at).toBeNull();
    } finally {
      db.close();
    }
  });

  it('restores assets matched by path when folder id is null (Serpent-gz4y)', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'FolderRestoreByPath',
      selectedParentPath: temp,
    });
    const folder = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'path-only',
    });
    const source = path.join(temp, 'path.png');
    writeFileSync(source, 'path-bytes');
    const asset = importFile(
      service,
      library.libraryId,
      source,
      folder.folderId,
    ).assets[0]!;

    service.trashManagedFolder({
      libraryId: library.libraryId,
      folderId: folder.folderId,
    });
    const db = database(library.libraryPath);
    try {
      db.prepare(
        'UPDATE assets SET trashed_from_folder_id = NULL WHERE asset_id = ?',
      ).run(asset.assetId);
    } finally {
      db.close();
    }

    const tombstone = service
      .listTrashedFolders(library.libraryId)
      .find((row) => row.name === 'path-only');
    expect(tombstone).toBeDefined();

    const result = service.restoreTrashedManagedFolder({
      libraryId: library.libraryId,
      tombstoneId: tombstone!.tombstoneId,
    });
    expect(result.restoredAssetCount).toBe(1);
    expect(service.listTrash(library.libraryId)).toEqual([]);
  });
});

describe('syncTrashedFolderTombstones (Serpent-kqqy)', () => {
  it('removes folder tombstones after permanent delete empties them', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'TombstoneCleanup',
      selectedParentPath: temp,
    });
    const folder = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'solo',
    });
    const source = path.join(temp, 'solo.png');
    writeFileSync(source, 'solo-bytes');
    const asset = importFile(service, library.libraryId, source, folder.folderId)
      .assets[0]!;

    service.trashManagedFolder({
      libraryId: library.libraryId,
      folderId: folder.folderId,
    });
    expect(service.listTrashedFolders(library.libraryId).length).toBeGreaterThan(0);

    service.deleteAssetsPermanent({
      libraryId: library.libraryId,
      assetIds: [asset.assetId],
    });
    expect(service.listTrashedFolders(library.libraryId)).toEqual([]);
  });
});

describe('same-name trash folders (Serpent-whvm)', () => {
  it('binds assets to distinct tombstones and restores only one subtree', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'SameNameTrash',
      selectedParentPath: temp,
    });

    const first = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'photos',
    });
    const firstSource = path.join(temp, 'first.png');
    writeFileSync(firstSource, 'first-bytes');
    const firstAsset = importFile(
      service,
      library.libraryId,
      firstSource,
      first.folderId,
    ).assets[0]!;
    service.trashManagedFolder({
      libraryId: library.libraryId,
      folderId: first.folderId,
    });

    const second = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'photos',
    });
    const secondSource = path.join(temp, 'second.png');
    writeFileSync(secondSource, 'second-bytes');
    const secondAsset = importFile(
      service,
      library.libraryId,
      secondSource,
      second.folderId,
    ).assets[0]!;
    service.trashManagedFolder({
      libraryId: library.libraryId,
      folderId: second.folderId,
    });

    const tombstones = service
      .listTrashedFolders(library.libraryId)
      .filter((row) => row.name === 'photos')
      .sort((a, b) => a.trashedAt.localeCompare(b.trashedAt));
    expect(tombstones).toHaveLength(2);

    const db = database(library.libraryPath);
    try {
      const bindings = db
        .prepare(
          `SELECT asset_id, trashed_from_tombstone_id
             FROM assets
            WHERE asset_id IN (?, ?)
            ORDER BY asset_id`,
        )
        .all(firstAsset.assetId, secondAsset.assetId) as Array<{
        asset_id: string;
        trashed_from_tombstone_id: string | null;
      }>;
      expect(bindings).toHaveLength(2);
      expect(bindings[0]!.trashed_from_tombstone_id).toBeTruthy();
      expect(bindings[1]!.trashed_from_tombstone_id).toBeTruthy();
      expect(bindings[0]!.trashed_from_tombstone_id).not.toBe(
        bindings[1]!.trashed_from_tombstone_id,
      );
      expect(
        new Set(bindings.map((row) => row.trashed_from_tombstone_id)),
      ).toEqual(new Set(tombstones.map((row) => row.tombstoneId)));
    } finally {
      db.close();
    }

    const restoreFirst = service.restoreTrashedManagedFolder({
      libraryId: library.libraryId,
      tombstoneId: tombstones[0]!.tombstoneId,
    });
    expect(restoreFirst.restoredAssetCount).toBe(1);
    expect(
      service.listTrash(library.libraryId).map((asset) => asset.assetId),
    ).toEqual([secondAsset.assetId]);
    expect(
      service.listTrashedFolders(library.libraryId).map((row) => row.tombstoneId),
    ).toEqual([tombstones[1]!.tombstoneId]);
  });

  it('refuses restore when the original folder path is occupied', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'RestoreConflict',
      selectedParentPath: temp,
    });
    const folder = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'photos',
    });
    const source = path.join(temp, 'keep.png');
    writeFileSync(source, 'keep-bytes');
    importFile(service, library.libraryId, source, folder.folderId);
    service.trashManagedFolder({
      libraryId: library.libraryId,
      folderId: folder.folderId,
    });

    service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'photos',
    });
    const tombstone = service
      .listTrashedFolders(library.libraryId)
      .find((row) => row.name === 'photos');
    expect(tombstone).toBeDefined();

    expect(() =>
      service.restoreTrashedManagedFolder({
        libraryId: library.libraryId,
        tombstoneId: tombstone!.tombstoneId,
      }),
    ).toThrow(/FOLDER_ALREADY_EXISTS/);
  });
});
