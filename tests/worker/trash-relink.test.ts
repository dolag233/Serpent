import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  LibraryServiceError,
} from '../../src/worker/library-service';
import type { ImportCompletion } from '../../src/shared/protocol/responses';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(source: string): void;
  pragma(source: string): unknown;
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
  };
}

const TestDatabase = require('better-sqlite3') as new (
  filename: string,
) => TestDatabaseConnection;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-trash-relink-test-'));
  temporaryRoots.push(root);
  return root;
}

function expectServiceError(operation: () => unknown, code: LibraryServiceError['code']): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LibraryServiceError);
  expect((thrown as LibraryServiceError).code).toBe(code);
}

function importNoConflict(service: LibraryService, libraryId: string, sourcePath: string, targetFolderId?: string): ImportCompletion {
  return service.prepareOrExecuteImport({
    libraryId,
    targetFolderId,
    sourceKind: 'files',
    sourcePaths: [sourcePath],
  }) as ImportCompletion;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('schema v8->v9 migration', () => {
  it('creates a new library at schema v9', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'V9 Test',
      selectedParentPath: root,
    });

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(database.pragma('user_version')).toEqual([{ user_version: 10 }]);

    const columns = database.prepare("PRAGMA table_info('assets')").all() as Array<{
      cid: number; name: string; type: string;
    }>;
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain('deleted_at');
    expect(columnNames).toContain('trashed_from_relative_path');
    expect(columnNames).toContain('trashed_from_folder_id');

    const indexes = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'assets_deleted%'",
    ).all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('assets_deleted_at_idx');
    expect(indexNames).toContain('assets_deleted_folder_idx');

    // Verify ai_content table exists.
    const aiContentCols = database.prepare("PRAGMA table_info('ai_content')").all() as Array<{ name: string }>;
    expect(aiContentCols.map((c) => c.name)).toEqual(
      expect.arrayContaining(['ai_content_id', 'asset_id', 'field_name', 'value', 'model_id', 'model_version', 'generated_at']),
    );

    database.close();
    service.closeAll();
  });

  it('migrates a v8 library to v9 when opening', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'V8 to V9',
      selectedParentPath: root,
    });

    const sourceFile = path.join(root, 'migrate-me.jpg');
    writeFileSync(sourceFile, 'migrate-me');
    void importNoConflict(service, created.libraryId, sourceFile);
    service.closeAll();

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    // Downgrade from v10 to v8 by removing v9+v10 migration metadata + objects.
    db.exec(`
      DROP TABLE IF EXISTS revision_artifacts;
      DROP TABLE IF EXISTS jobs;
      DELETE FROM schema_migrations WHERE version >= 9;
      PRAGMA user_version = 8;
    `);
    db.close();

    service.openLibrary(created.libraryPath);

    const db2 = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(db2.pragma('user_version')).toEqual([{ user_version: 10 }]);
    const migrationRows = db2.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
    expect(migrationRows.map((r) => r.version)).toContain(9);
    db2.close();
    service.closeAll();
  });

  it('is idempotent when reopening a v9 database', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Idemp V9', selectedParentPath: root });
    service.closeAll();
    service.openLibrary(created.libraryPath);
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(db.pragma('user_version')).toEqual([{ user_version: 10 }]);
    service.closeAll();
    service.openLibrary(created.libraryPath);
    const migrationCount = db.prepare(
      'SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 9',
    ).all() as Array<{ count: number }>;
    expect(migrationCount[0]!.count).toBe(1);
    db.close();
    service.closeAll();
  });
});

describe('downgrade helpers still work with v9', () => {
  it('downgrade to v1 then re-migrate through v9', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Downgrade', selectedParentPath: root });
    writeFileSync(path.join(root, 'test.png'), 'data');
    void importNoConflict(service, created.libraryId, path.join(root, 'test.png'));
    service.closeAll();

    const dbPath = path.join(created.libraryPath, '.serpent', 'library.db');
    const database = new TestDatabase(dbPath);
    database.exec(`
      DROP TABLE IF EXISTS asset_search;
      DROP TABLE IF EXISTS asset_search_index;
      DROP TRIGGER IF EXISTS asset_search_index_ai;
      DROP TRIGGER IF EXISTS asset_search_index_ad;
      DROP TRIGGER IF EXISTS asset_search_index_au;
      DROP INDEX IF EXISTS smart_collections_library_name_unique;
      DROP TABLE IF EXISTS collection_assets;
      DROP TABLE IF EXISTS collections;
      DROP TABLE IF EXISTS smart_collections;
      DROP TABLE IF EXISTS human_asset_tags;
      DROP TABLE IF EXISTS ai_asset_tags;
      DROP TABLE IF EXISTS ai_content;
      DROP INDEX IF EXISTS ai_content_asset_field;
      DROP TABLE IF EXISTS revision_artifacts;
      DROP TABLE IF EXISTS jobs;
      DROP TABLE IF EXISTS asset_metadata;
      DROP TABLE IF EXISTS tags;
      DROP TABLE file_operations;
      DROP TABLE revisions;
      DROP TABLE assets;
      DROP TABLE IF EXISTS linked_folders;
      DROP TABLE managed_folders;
      DELETE FROM schema_migrations WHERE version >= 2;
      PRAGMA user_version = 1;
    `);
    database.close();

    service.openLibrary(created.libraryPath);
    const db = new TestDatabase(dbPath);
    expect(db.pragma('user_version')).toEqual([{ user_version: 10 }]);
    db.close();
    service.closeAll();
  });
});

describe('trashAssets (soft delete)', () => {
  it('moves managed asset to .serpent/trash/ and sets deleted_at', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Trash Test', selectedParentPath: root });

    writeFileSync(path.join(root, 'photo.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'photo.jpg'));
    const assetId = r.assets[0]!.assetId;

    expect(existsSync(path.join(created.libraryPath, 'Assets', 'photo.jpg'))).toBe(true);

    const { trashedCount } = service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    expect(trashedCount).toBe(1);

    expect(existsSync(path.join(created.libraryPath, 'Assets', 'photo.jpg'))).toBe(false);
    expect(existsSync(path.join(created.libraryPath, '.serpent', 'trash', assetId, 'photo.jpg'))).toBe(true);

    const trash = service.listTrash(created.libraryId);
    expect(trash).toHaveLength(1);
    expect(trash[0]!.assetId).toBe(assetId);
    expect(trash[0]!.relativeFilePath).toContain('__trash__');
    expect(trash[0]!.deletedAt).toBeTruthy();
    expect(trash[0]!.trashedFromPath).toBe('photo.jpg');
    expect(trash[0]!.remainingDays).toBeGreaterThan(0);

    service.closeAll();
  });

  it('records trashed_from_folder_id when asset was in a folder', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Folder Trash', selectedParentPath: root });

    const folder = service.createManagedFolder({ libraryId: created.libraryId, name: 'SubFolder' });
    writeFileSync(path.join(root, 'nested.png'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'nested.png'), folder.folderId);
    const assetId = r.assets[0]!.assetId;

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });

    const trash = service.listTrash(created.libraryId);
    expect(trash[0]!.trashedFromPath).toBe('SubFolder/nested.png');
    service.closeAll();
  });

  it('rejects trashing non-managed assets', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Linked Reject', selectedParentPath: root });

    mkdirSync(path.join(root, 'linked-src'), { recursive: true });
    writeFileSync(path.join(root, 'linked-src', 'f.txt'), 'x');
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: path.join(root, 'linked-src') });

    const allAssets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const linkedAsset = allAssets.find((a) => a.managedFolderId === null);
    expect(linkedAsset).toBeTruthy();

    expectServiceError(
      () => service.trashAssets({ libraryId: created.libraryId, assetIds: [linkedAsset!.assetId] }),
      'INVALID_IMPORT_DECISION',
    );
    service.closeAll();
  });

  it('rejects trashing an already-trashed asset', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Double Trash', selectedParentPath: root });

    writeFileSync(path.join(root, 'single.jpg'), 'x');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'single.jpg'));
    service.trashAssets({ libraryId: created.libraryId, assetIds: [r.assets[0]!.assetId] });

    expectServiceError(
      () => service.trashAssets({ libraryId: created.libraryId, assetIds: [r.assets[0]!.assetId] }),
      'INVALID_IMPORT_DECISION',
    );
    service.closeAll();
  });

  it('rejects trashing a nonexistent asset', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'No Asset', selectedParentPath: root });

    expectServiceError(
      () => service.trashAssets({ libraryId: created.libraryId, assetIds: ['00000000-0000-0000-0000-000000000000'] }),
      'ASSET_NOT_FOUND',
    );
    service.closeAll();
  });

  it('rolls back filesystem if DB operation fails', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Rollback', selectedParentPath: root });

    writeFileSync(path.join(root, 'rollback-test.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'rollback-test.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    service.restoreAssets({ libraryId: created.libraryId, assetIds: [assetId] });

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets).toHaveLength(1);
    expect(assets[0]!.deletedAt).toBeNull();
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'rollback-test.jpg'))).toBe(true);
    service.closeAll();
  });
});

describe('listTrash', () => {
  it('lists only trashed assets with remaining days', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Trash List', selectedParentPath: root });

    writeFileSync(path.join(root, 'keep.jpg'), 'keep');
    void importNoConflict(service, created.libraryId, path.join(root, 'keep.jpg'));

    writeFileSync(path.join(root, 'trash.jpg'), 'trash');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'trash.jpg'));
    service.trashAssets({ libraryId: created.libraryId, assetIds: [r.assets[0]!.assetId] });

    const trash = service.listTrash(created.libraryId);
    expect(trash).toHaveLength(1);
    expect(trash[0]!.deletedAt).toBeTruthy();
    expect(trash[0]!.remainingDays).toBeGreaterThan(0);
    expect(trash[0]!.remainingDays).toBeLessThanOrEqual(30);

    const active = service.listAssets({ libraryId: created.libraryId, recursive: true })
      .filter((a) => a.deletedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]!.deletedAt).toBeNull();

    service.closeAll();
  });

  it('returns empty list when no trashed assets', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Empty Trash', selectedParentPath: root });
    expect(service.listTrash(created.libraryId)).toEqual([]);
    service.closeAll();
  });
});

describe('restoreAssets', () => {
  it('restores to original location', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Restore Orig', selectedParentPath: root });

    writeFileSync(path.join(root, 'restore-me.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'restore-me.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    const { restoredCount, assets } = service.restoreAssets({ libraryId: created.libraryId, assetIds: [assetId] });

    expect(restoredCount).toBe(1);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.deletedAt).toBeNull();
    expect(assets[0]!.relativeFilePath).toBe('restore-me.jpg');
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'restore-me.jpg'))).toBe(true);
    expect(service.listTrash(created.libraryId)).toEqual([]);
    service.closeAll();
  });

  it('restores to a specified target folder', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Restore Target', selectedParentPath: root });

    const targetFolder = service.createManagedFolder({ libraryId: created.libraryId, name: 'Target' });
    writeFileSync(path.join(root, 'move-me.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'move-me.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    const { assets } = service.restoreAssets({ libraryId: created.libraryId, assetIds: [assetId], targetFolderId: targetFolder.folderId });

    expect(assets[0]!.relativeFilePath).toBe('Target/move-me.jpg');
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Target', 'move-me.jpg'))).toBe(true);
    service.closeAll();
  });

  it('handles name conflict with keep-both (default)', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Conflict', selectedParentPath: root });

    writeFileSync(path.join(root, 'clash.png'), 'first');
    void importNoConflict(service, created.libraryId, path.join(root, 'clash.png'));

    writeFileSync(path.join(root, 'clash.png'), 'second');
    const plan = service.prepareImport({ libraryId: created.libraryId, sourceKind: 'files', sourcePaths: [path.join(root, 'clash.png')] });
    const completion = service.resolveImport({ importId: plan.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' });

    const secondImported = completion.assets.find((a) => a.relativeFilePath !== 'clash.png');
    expect(secondImported).toBeTruthy();
    service.trashAssets({ libraryId: created.libraryId, assetIds: [secondImported!.assetId] });

    const { assets: restored } = service.restoreAssets({ libraryId: created.libraryId, assetIds: [secondImported!.assetId] });
    expect(restored[0]!.relativeFilePath).not.toBe('clash.png');
    expect(restored[0]!.relativeFilePath).toMatch(/clash \(.*\)\.png/);

    const assetFiles = readdirSync(path.join(created.libraryPath, 'Assets'));
    expect(assetFiles.filter((f) => f.includes('clash'))).toHaveLength(2);
    service.closeAll();
  });

  it('falls back to root when original folder is gone', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Folder Gone', selectedParentPath: root });

    const folder = service.createManagedFolder({ libraryId: created.libraryId, name: 'WillBeGone' });
    writeFileSync(path.join(root, 'orphan.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'orphan.jpg'), folder.folderId);
    const assetId = r.assets[0]!.assetId;

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    db.prepare('DELETE FROM managed_folders WHERE folder_id = ?').run(folder.folderId);
    db.close();

    const { assets } = service.restoreAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    expect(assets[0]!.relativeFilePath).toBe('orphan.jpg');
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'orphan.jpg'))).toBe(true);
    service.closeAll();
  });

  it('rejects restoring an active (non-trashed) asset', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Active Restore', selectedParentPath: root });

    writeFileSync(path.join(root, 'active.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'active.jpg'));

    expectServiceError(
      () => service.restoreAssets({ libraryId: created.libraryId, assetIds: [r.assets[0]!.assetId] }),
      'INVALID_IMPORT_DECISION',
    );
    service.closeAll();
  });
});

describe('deleteAssetsPermanent', () => {
  it('removes trash file and DB row with cascade', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Perm Delete', selectedParentPath: root });

    writeFileSync(path.join(root, 'delete-me.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'delete-me.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    expect(service.listTrash(created.libraryId)).toHaveLength(1);

    const { deletedCount, skippedCount } = service.deleteAssetsPermanent({ libraryId: created.libraryId, assetIds: [assetId] });
    expect(deletedCount).toBe(1);
    expect(skippedCount).toBe(0);

    expect(existsSync(path.join(created.libraryPath, '.serpent', 'trash', assetId))).toBe(false);
    expect(service.listTrash(created.libraryId)).toEqual([]);

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const revCount = db.prepare('SELECT COUNT(*) AS count FROM revisions WHERE asset_id = ?').get(assetId) as { count: number };
    expect(revCount.count).toBe(0);
    db.close();

    service.closeAll();
  });

  it('skips already-deleted trash directory (ENOENT ok)', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'ENOENT', selectedParentPath: root });

    writeFileSync(path.join(root, 'gone-already.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'gone-already.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    rmSync(path.join(created.libraryPath, '.serpent', 'trash', assetId), { recursive: true });

    const { deletedCount, skippedCount } = service.deleteAssetsPermanent({ libraryId: created.libraryId, assetIds: [assetId] });
    expect(deletedCount).toBe(1);
    expect(skippedCount).toBe(0);
    expect(service.listTrash(created.libraryId)).toEqual([]);
    service.closeAll();
  });

  it('rejects deleting an active asset', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Active Del', selectedParentPath: root });

    writeFileSync(path.join(root, 'active-perm.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'active-perm.jpg'));

    expectServiceError(
      () => service.deleteAssetsPermanent({ libraryId: created.libraryId, assetIds: [r.assets[0]!.assetId] }),
      'INVALID_IMPORT_DECISION',
    );
    service.closeAll();
  });
});

describe('purgeExpiredTrash', () => {
  it('purges assets older than 30 days', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Purge Test', selectedParentPath: root });

    writeFileSync(path.join(root, 'old.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'old.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const pastDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE assets SET deleted_at = ? WHERE asset_id = ?').run(pastDate, assetId);
    db.close();

    const { purgedCount } = service.purgeExpiredTrash(created.libraryId);
    expect(purgedCount).toBe(1);
    expect(service.listTrash(created.libraryId)).toEqual([]);
    expect(existsSync(path.join(created.libraryPath, '.serpent', 'trash', assetId))).toBe(false);
    service.closeAll();
  });

  it('does not purge assets younger than 30 days', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Recent', selectedParentPath: root });

    writeFileSync(path.join(root, 'recent.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'recent.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    const { purgedCount } = service.purgeExpiredTrash(created.libraryId);
    expect(purgedCount).toBe(0);
    expect(service.listTrash(created.libraryId)).toHaveLength(1);
    service.closeAll();
  });

  it('runs on library open without blocking', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Open Purge', selectedParentPath: root });
    service.closeAll();
    service.openLibrary(created.libraryPath);
    expect(service.listTrash(created.libraryId)).toEqual([]);
    service.closeAll();
  });
});

describe('deleteLinkedAssets', () => {
  it('deletes linked asset DB row when deleteSourceFile is false', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Linked Del', selectedParentPath: root });

    mkdirSync(path.join(root, 'linked-del'), { recursive: true });
    writeFileSync(path.join(root, 'linked-del', 'to-delete.txt'), 'x');
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: path.join(root, 'linked-del') });

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const linkedAsset = assets.find((a) => a.managedFolderId === null);
    expect(linkedAsset).toBeTruthy();

    const { deletedCount } = service.deleteLinkedAssets({ libraryId: created.libraryId, assetIds: [linkedAsset!.assetId], deleteSourceFile: false });
    expect(deletedCount).toBe(1);
    expect(existsSync(path.join(root, 'linked-del', 'to-delete.txt'))).toBe(true);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })).toHaveLength(0);
    service.closeAll();
  });

  it('throws for deleteSourceFile=true (trash package not available)', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Linked Src', selectedParentPath: root });

    mkdirSync(path.join(root, 'linked-del-src'), { recursive: true });
    writeFileSync(path.join(root, 'linked-del-src', 'keep.txt'), 'x');
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: path.join(root, 'linked-del-src') });

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const linkedAsset = assets.find((a) => a.managedFolderId === null);

    expectServiceError(
      () => service.deleteLinkedAssets({ libraryId: created.libraryId, assetIds: [linkedAsset!.assetId], deleteSourceFile: true }),
      'LIBRARY_NOT_WRITABLE',
    );
    service.closeAll();
  });

  it('rejects deleting a managed asset with linked delete', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Managed via Linked', selectedParentPath: root });

    writeFileSync(path.join(root, 'managed.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'managed.jpg'));

    expectServiceError(
      () => service.deleteLinkedAssets({ libraryId: created.libraryId, assetIds: [r.assets[0]!.assetId], deleteSourceFile: false }),
      'INVALID_IMPORT_DECISION',
    );
    service.closeAll();
  });
});

describe('relinkAsset (single missing asset)', () => {
  it('relinks a missing asset to a new file and creates a relink revision', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Relink', selectedParentPath: root });

    writeFileSync(path.join(root, 'orig-relink.jpg'), 'orig');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'orig-relink.jpg'));
    const assetId = r.assets[0]!.assetId;

    rmSync(path.join(created.libraryPath, 'Assets', 'orig-relink.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const before = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(before[0]!.availability).toBe('missing');

    writeFileSync(path.join(root, 'new-location.jpg'), 'new');
    const { asset } = service.relinkAsset({ libraryId: created.libraryId, assetId, newAbsolutePath: path.join(root, 'new-location.jpg') });

    expect(asset.assetId).toBe(assetId);
    expect(asset.availability).toBe('available');

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const revisions = db.prepare("SELECT origin FROM revisions WHERE asset_id = ? ORDER BY accepted_at DESC").all(assetId) as Array<{ origin: string }>;
    expect(revisions[0]!.origin).toBe('relink');
    db.close();

    service.closeAll();
  });

  it('preserves metadata and tags after relink', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Relink Meta', selectedParentPath: root });

    writeFileSync(path.join(root, 'with-meta.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'with-meta.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.setAssetMetadata({ libraryId: created.libraryId, assetId, expectedVersion: 0, label: 'Test Label', rating: 4, favorite: true });

    rmSync(path.join(created.libraryPath, 'Assets', 'with-meta.jpg'));
    service.refreshManagedAssets(created.libraryId);

    writeFileSync(path.join(root, 'relinked-meta.jpg'), 'data');
    const { asset } = service.relinkAsset({ libraryId: created.libraryId, assetId, newAbsolutePath: path.join(root, 'relinked-meta.jpg') });

    expect(asset.availability).toBe('available');
    expect(asset.label).toBe('Test Label');
    expect(asset.rating).toBe(4);
    expect(asset.favorite).toBe(true);

    service.closeAll();
  });

  it('rejects relinking an available asset', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Avail Relink', selectedParentPath: root });

    writeFileSync(path.join(root, 'available.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'available.jpg'));

    writeFileSync(path.join(root, 'new-avail.jpg'), 'new');
    expectServiceError(
      () => service.relinkAsset({ libraryId: created.libraryId, assetId: r.assets[0]!.assetId, newAbsolutePath: path.join(root, 'new-avail.jpg') }),
      'INVALID_IMPORT_DECISION',
    );
    service.closeAll();
  });

  it('rejects relinking to a path inside the managed space', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Escape', selectedParentPath: root });

    writeFileSync(path.join(root, 'escape.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'escape.jpg'));
    const assetId = r.assets[0]!.assetId;

    rmSync(path.join(created.libraryPath, 'Assets', 'escape.jpg'));
    service.refreshManagedAssets(created.libraryId);

    writeFileSync(path.join(created.libraryPath, 'Assets', 'not-allowed.jpg'), 'x');
    expectServiceError(
      () => service.relinkAsset({ libraryId: created.libraryId, assetId, newAbsolutePath: path.join(created.libraryPath, 'Assets', 'not-allowed.jpg') }),
      'INVALID_IMPORT_SOURCE',
    );
    service.closeAll();
  });

  it('rejects relinking to a nonexistent file', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Ghost', selectedParentPath: root });

    writeFileSync(path.join(root, 'ghost.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'ghost.jpg'));
    const assetId = r.assets[0]!.assetId;

    rmSync(path.join(created.libraryPath, 'Assets', 'ghost.jpg'));
    service.refreshManagedAssets(created.libraryId);

    expectServiceError(
      () => service.relinkAsset({ libraryId: created.libraryId, assetId, newAbsolutePath: path.join(root, 'does-not-exist.jpg') }),
      'INVALID_IMPORT_SOURCE',
    );
    service.closeAll();
  });

  it('rejects relinking a trashed asset', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Trashed Relink', selectedParentPath: root });

    writeFileSync(path.join(root, 'trashed-relink.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'trashed-relink.jpg'));
    const assetId = r.assets[0]!.assetId;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });

    expectServiceError(
      () => service.relinkAsset({ libraryId: created.libraryId, assetId, newAbsolutePath: path.join(root, 'any.jpg') }),
      'INVALID_IMPORT_DECISION',
    );
    service.closeAll();
  });
});

describe('relinkBatchPreview', () => {
  it('returns matched/unmatched counts without absolute paths', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Batch Preview', selectedParentPath: root });

    writeFileSync(path.join(root, 'batch1.jpg'), 'data');
    void importNoConflict(service, created.libraryId, path.join(root, 'batch1.jpg'));

    const subFolder = service.createManagedFolder({ libraryId: created.libraryId, name: 'sub' });
    writeFileSync(path.join(root, 'batch2.jpg'), 'data');
    void importNoConflict(service, created.libraryId, path.join(root, 'batch2.jpg'), subFolder.folderId);

    rmSync(path.join(created.libraryPath, 'Assets', 'batch1.jpg'));
    rmSync(path.join(created.libraryPath, 'Assets', 'sub', 'batch2.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const newRoot = path.join(root, 'new-root');
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(path.join(newRoot, 'batch1.jpg'), 'matched');
    mkdirSync(path.join(newRoot, 'sub'), { recursive: true });
    writeFileSync(path.join(newRoot, 'sub', 'batch2.jpg'), 'matched');

    const preview = service.relinkBatchPreview({ libraryId: created.libraryId, newRootPath: newRoot });
    expect(preview.totalCount).toBe(2);
    expect(preview.matchedCount).toBe(2);
    expect(preview.unmatchedCount).toBe(0);

    for (const example of preview.examples) {
      expect(example.relativeFilePath).not.toContain(root);
      expect(example.relativeFilePath).not.toContain(newRoot);
      expect(path.isAbsolute(example.relativeFilePath)).toBe(false);
    }
    service.closeAll();
  });

  it('shows unmatched when files are missing in new root', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Unmatched', selectedParentPath: root });

    writeFileSync(path.join(root, 'only.jpg'), 'data');
    void importNoConflict(service, created.libraryId, path.join(root, 'only.jpg'));

    rmSync(path.join(created.libraryPath, 'Assets', 'only.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const emptyRoot = path.join(root, 'empty-root');
    mkdirSync(emptyRoot, { recursive: true });
    const preview = service.relinkBatchPreview({ libraryId: created.libraryId, newRootPath: emptyRoot });
    expect(preview.totalCount).toBe(1);
    expect(preview.matchedCount).toBe(0);
    expect(preview.unmatchedCount).toBe(1);
    service.closeAll();
  });

  it('rejects a nonexistent new root', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Bad Root', selectedParentPath: root });

    expectServiceError(
      () => service.relinkBatchPreview({ libraryId: created.libraryId, newRootPath: path.join(root, 'nonexistent') }),
      'INVALID_IMPORT_SOURCE',
    );
    service.closeAll();
  });
});

describe('relinkBatchApply', () => {
  it('restores matched assets and leaves unmatched as missing', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Batch Apply', selectedParentPath: root });

    writeFileSync(path.join(root, 'match.jpg'), 'data');
    void importNoConflict(service, created.libraryId, path.join(root, 'match.jpg'));

    writeFileSync(path.join(root, 'nomatch.jpg'), 'data');
    void importNoConflict(service, created.libraryId, path.join(root, 'nomatch.jpg'));

    rmSync(path.join(created.libraryPath, 'Assets', 'match.jpg'));
    rmSync(path.join(created.libraryPath, 'Assets', 'nomatch.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const newRoot = path.join(root, 'new-root-batch');
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(path.join(newRoot, 'match.jpg'), 'matched');

    const result = service.relinkBatchApply({ libraryId: created.libraryId, newRootPath: newRoot, keepMetadata: true });
    expect(result.restoredCount).toBe(1);
    expect(result.unchangedMissingCount).toBe(1);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.availability).toBe('available');

    const allAssets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(allAssets.filter((a) => a.availability === 'available')).toHaveLength(1);
    expect(allAssets.filter((a) => a.availability === 'missing')).toHaveLength(1);
    service.closeAll();
  });

  it('keepMetadata=true preserves labels, rating, tags, collections', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Keep Meta', selectedParentPath: root });

    writeFileSync(path.join(root, 'keepmeta.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'keepmeta.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.setAssetMetadata({ libraryId: created.libraryId, assetId, expectedVersion: 0, label: 'Important', rating: 5, favorite: true, sourcePageUrl: 'https://example.com' });
    const tag = service.createTag({ libraryId: created.libraryId, name: 'keep-tag' });
    service.assignTags({ libraryId: created.libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    rmSync(path.join(created.libraryPath, 'Assets', 'keepmeta.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const newRoot = path.join(root, 'root-keep');
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(path.join(newRoot, 'keepmeta.jpg'), 'relinked');

    service.relinkBatchApply({ libraryId: created.libraryId, newRootPath: newRoot, keepMetadata: true });

    const meta = service.getAssetMetadata({ libraryId: created.libraryId, assetId });
    expect(meta.label).toBe('Important');
    expect(meta.rating).toBe(5);
    expect(meta.favorite).toBe(true);
    expect(meta.sourcePageUrl).toBe('https://example.com');

    const tags = service.listTags(created.libraryId);
    expect(tags.find((t) => t.name === 'keep-tag')!.assetCount).toBeGreaterThan(0);
    service.closeAll();
  });

  it('keepMetadata=false clears labels, rating, tags, and collections', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Clear Meta', selectedParentPath: root });

    writeFileSync(path.join(root, 'clearmeta.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'clearmeta.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.setAssetMetadata({ libraryId: created.libraryId, assetId, expectedVersion: 0, label: 'Will Clear', rating: 4, favorite: true, sourcePageUrl: 'https://gone.com' });
    const tag = service.createTag({ libraryId: created.libraryId, name: 'clear-tag' });
    service.assignTags({ libraryId: created.libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    const col = service.createCollection({ libraryId: created.libraryId, name: 'Clear Col' });
    service.addCollectionAssets({ libraryId: created.libraryId, collectionId: col.collectionId, assetIds: [assetId] });

    rmSync(path.join(created.libraryPath, 'Assets', 'clearmeta.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const newRoot = path.join(root, 'root-clear');
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(path.join(newRoot, 'clearmeta.jpg'), 'relinked');

    service.relinkBatchApply({ libraryId: created.libraryId, newRootPath: newRoot, keepMetadata: false });

    const meta = service.getAssetMetadata({ libraryId: created.libraryId, assetId });
    expect(meta.label).toBeNull();
    expect(meta.rating).toBe(0);
    expect(meta.favorite).toBe(false);
    expect(meta.sourcePageUrl).toBeNull();

    expect(service.listTags(created.libraryId).find((t) => t.name === 'clear-tag')!.assetCount).toBe(0);
    expect(service.listCollectionAssets({ libraryId: created.libraryId, collectionId: col.collectionId, recursive: false })).toHaveLength(0);
    service.closeAll();
  });

  it('creates only one file_operations row for the entire batch', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Batch FO', selectedParentPath: root });

    writeFileSync(path.join(root, 'fo1.jpg'), 'data');
    void importNoConflict(service, created.libraryId, path.join(root, 'fo1.jpg'));

    writeFileSync(path.join(root, 'fo2.jpg'), 'data');
    void importNoConflict(service, created.libraryId, path.join(root, 'fo2.jpg'));

    rmSync(path.join(created.libraryPath, 'Assets', 'fo1.jpg'));
    rmSync(path.join(created.libraryPath, 'Assets', 'fo2.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const newRoot = path.join(root, 'fo-root');
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(path.join(newRoot, 'fo1.jpg'), 'data');
    writeFileSync(path.join(newRoot, 'fo2.jpg'), 'data');

    service.relinkBatchApply({ libraryId: created.libraryId, newRootPath: newRoot, keepMetadata: true });

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const relinkRows = db.prepare("SELECT operation_id, kind FROM file_operations WHERE kind = 'relink-batch'").all() as Array<{ operation_id: string; kind: string }>;
    expect(relinkRows).toHaveLength(1);
    expect(relinkRows[0]!.kind).toBe('relink-batch');
    db.close();
    service.closeAll();
  });
});

describe('active assets should not expose trashed fields', () => {
  it('active assets have null deletedAt/trashedFromPath/remainingDays', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Active Nulls', selectedParentPath: root });

    writeFileSync(path.join(root, 'active-null.jpg'), 'data');
    void importNoConflict(service, created.libraryId, path.join(root, 'active-null.jpg'));

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets).toHaveLength(1);
    expect(assets[0]!.deletedAt).toBeNull();
    expect(assets[0]!.trashedFromPath).toBeNull();
    expect(assets[0]!.remainingDays).toBeNull();
    service.closeAll();
  });
});

describe('refreshManagedAssets skips trashed assets', () => {
  it('does not reconcile files for trashed assets', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Skip Trash', selectedParentPath: root });

    writeFileSync(path.join(root, 'skip-refresh.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'skip-refresh.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    const refresh = service.refreshManagedAssets(created.libraryId);
    expect(refresh.changedCount).toBe(0);
    service.closeAll();
  });
});
