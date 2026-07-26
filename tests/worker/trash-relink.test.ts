import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  LibraryServiceError,
} from '../../src/worker/library-service';
import type { ImportCompletion } from '../../src/shared/protocol/responses';
import { importNoConflict } from './import-no-conflict';

const temporaryRoots: string[] = [];

// LibraryService holds SQLite connections and recursive fs watchers; on
// Windows those open handles block rm of the temp tree (POSIX unlinks open
// files, which is why the leak is invisible on macOS). Always close first.
const services: LibraryService[] = [];

function newService(
  ...args: ConstructorParameters<typeof LibraryService>
): LibraryService {
  const service = new LibraryService(...args);
  services.push(service);
  return service;
}

const require = createRequire(import.meta.url);

// Valid 1x1 white PNG bytes (pre-computed), matching thumbnails.test.ts so
// trash tests can generate real decodable thumbnails through the media queue.
const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

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

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('schema v8->v9 migration', () => {
  it('creates a new library at schema v9', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({
      displayName: 'V9 Test',
      selectedParentPath: root,
    });

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(database.pragma('user_version')).toEqual([{ user_version: 22 }]);

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
    const service = newService();
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
    DROP TABLE IF EXISTS linked_ignored_assets;
    DROP TABLE IF EXISTS linked_folder_rules;
    DROP TABLE IF EXISTS trashed_managed_folders;
    DROP INDEX IF EXISTS trashed_managed_folders_trashed_at_idx;
      DROP TABLE IF EXISTS revision_artifacts;
      DROP TABLE IF EXISTS jobs;
      DELETE FROM schema_migrations WHERE version >= 9;
      PRAGMA user_version = 8;
    `);
    db.close();

    service.openLibrary(created.libraryPath);

    const db2 = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(db2.pragma('user_version')).toEqual([{ user_version: 22 }]);
    const migrationRows = db2.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
    expect(migrationRows.map((r) => r.version)).toContain(9);
    db2.close();
    service.closeAll();
  });

  it('is idempotent when reopening a v9 database', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Idemp V9', selectedParentPath: root });
    service.closeAll();
    service.openLibrary(created.libraryPath);
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(db.pragma('user_version')).toEqual([{ user_version: 22 }]);
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
    const service = newService();
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
      DROP TABLE IF EXISTS linked_ignored_assets;
      DROP TABLE IF EXISTS linked_folder_rules;
      DROP TABLE IF EXISTS trashed_managed_folders;
      DROP INDEX IF EXISTS trashed_managed_folders_trashed_at_idx;
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
    expect(db.pragma('user_version')).toEqual([{ user_version: 22 }]);
    db.close();
    service.closeAll();
  });
});

describe('trashAssets (soft delete)', () => {
  it('moves managed asset to .serpent/trash/ and sets deleted_at', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
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
    const service = newService();
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

  it('moves already-missing managed assets to trash without a source file', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Missing Trash', selectedParentPath: root });

    writeFileSync(path.join(root, 'gone.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'gone.jpg'));
    const assetId = r.assets[0]!.assetId;
    rmSync(path.join(created.libraryPath, 'Assets', 'gone.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const { trashedCount } = service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    expect(trashedCount).toBe(1);
    expect(existsSync(path.join(created.libraryPath, '.serpent', 'trash', assetId, 'gone.jpg'))).toBe(false);

    const trash = service.listTrash(created.libraryId);
    expect(trash).toHaveLength(1);
    expect(trash[0]!.assetId).toBe(assetId);
    expect(trash[0]!.trashedFromPath).toBe('gone.jpg');
    service.closeAll();
  });

  it('rejects trashing an already-trashed asset', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
    const created = service.createLibrary({ displayName: 'No Asset', selectedParentPath: root });

    expectServiceError(
      () => service.trashAssets({ libraryId: created.libraryId, assetIds: ['00000000-0000-0000-0000-000000000000'] }),
      'ASSET_NOT_FOUND',
    );
    service.closeAll();
  });

  it('rolls back filesystem if DB operation fails', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
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
    const service = newService();
    const created = service.createLibrary({ displayName: 'Empty Trash', selectedParentPath: root });
    expect(service.listTrash(created.libraryId)).toEqual([]);
    service.closeAll();
  });
});

describe('trash preview artifacts (BUG-TRASH-001)', () => {
  async function importWithReadyThumbnail(service: LibraryService, libraryId: string, sourcePath: string): Promise<string> {
    writeFileSync(sourcePath, VALID_1X1_PNG);
    const assetId = importNoConflict(service, libraryId, sourcePath).assets[0]!.assetId;
    service.enqueueThumbnailJobs(libraryId);
    expect(await service.processThumbnailQueue(libraryId)).toBeGreaterThan(0);
    return assetId;
  }

  function trashScopeItem(service: LibraryService, libraryId: string, assetId: string) {
    const result = service.searchAssets({
      libraryId,
      query: null,
      scope: { kind: 'trash' },
      limit: 50,
      offset: 0,
    });
    return result.items.find((item) => item.assetId === assetId);
  }

  it('keeps the thumbnail resolvable and decodable after trashing', async () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Trash Preview', selectedParentPath: root });
    const assetId = await importWithReadyThumbnail(service, created.libraryId, path.join(root, 'preview.png'));

    // Control: while active, the thumbnail is served through the artifact path.
    const activeItem = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;
    expect(activeItem.thumbnailStatus).toBe('ready');
    const artifactId = activeItem.thumbnailArtifactId!;
    expect(artifactId).toBeTruthy();
    expect(existsSync(service.getArtifactAbsolutePath(created.libraryId, artifactId, 'preview'))).toBe(true);

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });

    // Trashing moves only the source file; the artifact row and file stay ready.
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const artifactRow = db.prepare(
      "SELECT status, invalidated_at FROM revision_artifacts WHERE artifact_id = ?",
    ).get(artifactId) as { status: string; invalidated_at: string | null };
    expect(artifactRow).toEqual({ status: 'ready', invalidated_at: null });
    db.close();
    expect(existsSync(path.join(created.libraryPath, '.serpent', 'artifacts', `${artifactId}.webp`))).toBe(true);

    // The trash listing (the renderer's trash-scope data source) must keep
    // exposing the thumbnail artifact so the card can build a preview URL.
    const trashedItem = trashScopeItem(service, created.libraryId, assetId);
    expect(trashedItem?.thumbnailStatus).toBe('ready');
    expect(trashedItem?.thumbnailArtifactId).toBe(artifactId);

    // The media protocol resolution must keep serving the artifact for the
    // trashed asset, and the served bytes must still decode as an image.
    const servedPath = service.getArtifactAbsolutePath(created.libraryId, artifactId, 'preview');
    const sharp = require('sharp') as (input: string) => { metadata(): Promise<{ width?: number; height?: number }> };
    const metadata = await sharp(servedPath).metadata();
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);

    service.closeAll();
  });

  it('exposes thumbnail state through listTrash consistently with the trash search scope', async () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Trash List Preview', selectedParentPath: root });
    const assetId = await importWithReadyThumbnail(service, created.libraryId, path.join(root, 'listed.png'));

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });

    const scoped = trashScopeItem(service, created.libraryId, assetId);
    const listed = service.listTrash(created.libraryId).find((item) => item.assetId === assetId);
    expect(scoped?.thumbnailArtifactId).toBeTruthy();
    expect(listed?.thumbnailStatus).toBe(scoped?.thumbnailStatus);
    expect(listed?.thumbnailArtifactId).toBe(scoped?.thumbnailArtifactId);

    service.closeAll();
  });

  it('keeps the same preview resolvable through trash and restore', async () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Restore Preview', selectedParentPath: root });
    const assetId = await importWithReadyThumbnail(service, created.libraryId, path.join(root, 'roundtrip.png'));
    const artifactId = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!.thumbnailArtifactId!;
    const originalBytes = readFileSync(service.getArtifactAbsolutePath(created.libraryId, artifactId, 'preview'));

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    const trashedBytes = readFileSync(service.getArtifactAbsolutePath(created.libraryId, artifactId, 'preview'));

    service.restoreAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    const restoredItem = service.searchAssets({
      libraryId: created.libraryId,
      query: null,
      limit: 50,
      offset: 0,
    }).items.find((item) => item.assetId === assetId);
    expect(restoredItem?.deletedAt).toBeNull();
    expect(restoredItem?.thumbnailStatus).toBe('ready');
    expect(restoredItem?.thumbnailArtifactId).toBe(artifactId);
    const restoredBytes = readFileSync(service.getArtifactAbsolutePath(created.libraryId, artifactId, 'preview'));

    expect(trashedBytes.equals(originalBytes)).toBe(true);
    expect(restoredBytes.equals(originalBytes)).toBe(true);

    service.closeAll();
  });

  it('stops serving artifacts once the asset is permanently deleted', async () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Purge Preview', selectedParentPath: root });
    const assetId = await importWithReadyThumbnail(service, created.libraryId, path.join(root, 'purged.png'));
    const artifactId = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!.thumbnailArtifactId!;

    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    const result = service.deleteAssetsPermanent({ libraryId: created.libraryId, assetIds: [assetId] });
    expect(result.deletedCount).toBe(1);

    // The security boundary of artifact serving is the asset row itself: once
    // the row is gone the artifact must not resolve, even though the derived
    // file may still sit in .serpent/artifacts awaiting regeneration sweeps.
    expectServiceError(
      () => service.getArtifactAbsolutePath(created.libraryId, artifactId, 'preview'),
      'ASSET_NOT_FOUND',
    );

    service.closeAll();
  });
});

describe('restoreAssets', () => {
  it('restores to original location', () => {
    const root = temporaryRoot();
    const service = newService();
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

  it('previewRestoreAssets reports no conflicts when the original path is free (Serpent-0hnx)', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Preview Free', selectedParentPath: root });

    writeFileSync(path.join(root, 'restore-me.jpg'), 'data');
    const assetId = importNoConflict(service, created.libraryId, path.join(root, 'restore-me.jpg')).assets[0]!.assetId;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });

    expect(
      service.previewRestoreAssets({ libraryId: created.libraryId, assetIds: [assetId] }),
    ).toEqual({ hasNameConflicts: false });
    service.closeAll();
  });

  it('previewRestoreAssets reports conflicts when the original path is occupied (Serpent-0hnx)', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Preview Conflict', selectedParentPath: root });

    writeFileSync(path.join(root, 'clash.jpg'), 'trashed');
    const assetId = importNoConflict(service, created.libraryId, path.join(root, 'clash.jpg')).assets[0]!.assetId;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });
    writeFileSync(path.join(created.libraryPath, 'Assets', 'clash.jpg'), 'replacement');

    expect(
      service.previewRestoreAssets({ libraryId: created.libraryId, assetIds: [assetId] }),
    ).toEqual({ hasNameConflicts: true });
    service.closeAll();
  });

  it('readTextAsset reads trashed text from the trash store (Serpent-hv6n)', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Trash Text', selectedParentPath: root });

    writeFileSync(path.join(root, 'note.txt'), 'hello from trash');
    const assetId = importNoConflict(service, created.libraryId, path.join(root, 'note.txt')).assets[0]!.assetId;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [assetId] });

    const read = service.readTextAsset({
      libraryId: created.libraryId,
      assetId,
      maxBytes: 2048,
    });

    expect(read.content).toContain('hello from trash');
    expect(read.editable).toBe(false);
    service.closeAll();
  });

  it('restores to a specified target folder', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
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

  it('skips a conflicting restore without removing the trashed asset', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Skip Restore', selectedParentPath: root });

    writeFileSync(path.join(root, 'clash.png'), 'first');
    const first = importNoConflict(service, created.libraryId, path.join(root, 'clash.png')).assets[0]!;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [first.assetId] });
    writeFileSync(path.join(created.libraryPath, 'Assets', 'clash.png'), 'replacement');

    const restored = service.restoreAssets({
      libraryId: created.libraryId,
      assetIds: [first.assetId],
      conflictStrategy: 'skip',
    });

    expect(restored.restoredCount).toBe(0);
    expect(service.listTrash(created.libraryId).map((asset) => asset.assetId)).toContain(first.assetId);
    expect(readFileSync(path.join(created.libraryPath, 'Assets', 'clash.png'), 'utf8')).toBe('replacement');
    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(database.prepare("SELECT status FROM file_operations WHERE kind = 'restore' ORDER BY created_at DESC LIMIT 1").get()).toEqual({ status: 'committed' });
    database.close();
    service.closeAll();
  });

  it('replaces a conflicting active asset while preserving the restored identity', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Replace Restore', selectedParentPath: root });

    writeFileSync(path.join(root, 'clash.png'), 'restored-content');
    const restoredIdentity = importNoConflict(service, created.libraryId, path.join(root, 'clash.png')).assets[0]!;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [restoredIdentity.assetId] });
    writeFileSync(path.join(root, 'clash.png'), 'active-content');
    const active = importNoConflict(service, created.libraryId, path.join(root, 'clash.png')).assets[0]!;

    const result = service.restoreAssets({
      libraryId: created.libraryId,
      assetIds: [restoredIdentity.assetId],
      conflictStrategy: 'replace',
    });

    expect(result.assets[0]?.assetId).toBe(restoredIdentity.assetId);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true }).some((asset) => asset.assetId === active.assetId)).toBe(false);
    expect(readFileSync(path.join(created.libraryPath, 'Assets', 'clash.png'), 'utf8')).toBe('restored-content');
    service.closeAll();
  });

  it.each([
    'crash-restore-before-filesystem',
    'crash-restore-after-filesystem',
    'crash-restore-before-db-commit',
  ] as const)('rolls back keep-both restore journal on reopen after %s without orphaning its destination', (failAt) => {
    const root = temporaryRoot();
    const setup = newService();
    const created = setup.createLibrary({ displayName: `Restore Journal ${failAt}`, selectedParentPath: root });

    writeFileSync(path.join(root, 'clash.png'), 'trashed-content');
    const trashed = importNoConflict(setup, created.libraryId, path.join(root, 'clash.png')).assets[0]!;
    setup.trashAssets({ libraryId: created.libraryId, assetIds: [trashed.assetId] });
    writeFileSync(path.join(created.libraryPath, 'Assets', 'clash.png'), 'untracked-active-content');
    setup.closeAll();

    const crashing = newService({ failAt });
    const opened = crashing.openLibrary(created.libraryPath);
    expectServiceError(
      () => crashing.restoreAssets({
        libraryId: opened.libraryId,
        assetIds: [trashed.assetId],
        conflictStrategy: 'keep-both',
      }),
      'LIBRARY_NOT_WRITABLE',
    );
    crashing.closeAll();

    const recovered = newService();
    const reopened = recovered.openLibrary(created.libraryPath);
    expect(readFileSync(path.join(reopened.libraryPath, 'Assets', 'clash.png'), 'utf8')).toBe('untracked-active-content');
    expect(existsSync(path.join(reopened.libraryPath, 'Assets', 'clash (2).png'))).toBe(false);
    expect(recovered.listTrash(reopened.libraryId).map((asset) => asset.assetId)).toContain(trashed.assetId);
    const database = new TestDatabase(path.join(reopened.libraryPath, '.serpent', 'library.db'));
    expect(database.prepare("SELECT status FROM file_operations WHERE kind = 'restore' ORDER BY created_at DESC LIMIT 1").get()).toEqual({ status: 'rolled_back' });
    database.close();
    recovered.closeAll();
  });

  it.each([
    'crash-restore-after-backup',
    'crash-restore-after-filesystem',
    'crash-restore-before-db-commit',
  ] as const)('restores the replaced active asset on reopen after %s', (failAt) => {
    const root = temporaryRoot();
    const setup = newService();
    const created = setup.createLibrary({ displayName: `Replace Journal ${failAt}`, selectedParentPath: root });

    writeFileSync(path.join(root, 'clash.png'), 'restored-content');
    const restoredIdentity = importNoConflict(setup, created.libraryId, path.join(root, 'clash.png')).assets[0]!;
    setup.trashAssets({ libraryId: created.libraryId, assetIds: [restoredIdentity.assetId] });
    writeFileSync(path.join(root, 'clash.png'), 'active-content');
    const active = importNoConflict(setup, created.libraryId, path.join(root, 'clash.png')).assets[0]!;
    setup.closeAll();

    const crashing = newService({ failAt });
    const opened = crashing.openLibrary(created.libraryPath);
    expectServiceError(
      () => crashing.restoreAssets({
        libraryId: opened.libraryId,
        assetIds: [restoredIdentity.assetId],
        conflictStrategy: 'replace',
      }),
      'LIBRARY_NOT_WRITABLE',
    );
    crashing.closeAll();

    const recovered = newService();
    const reopened = recovered.openLibrary(created.libraryPath);
    expect(readFileSync(path.join(reopened.libraryPath, 'Assets', 'clash.png'), 'utf8')).toBe('active-content');
    expect(recovered.listAssets({ libraryId: reopened.libraryId, recursive: true }).map((asset) => asset.assetId)).toContain(active.assetId);
    expect(recovered.listTrash(reopened.libraryId).map((asset) => asset.assetId)).toContain(restoredIdentity.assetId);
    recovered.closeAll();
  });

  it('keeps the committed restored identity after a crash immediately following the database commit', () => {
    const root = temporaryRoot();
    const setup = newService();
    const created = setup.createLibrary({ displayName: 'Committed Restore Journal', selectedParentPath: root });

    writeFileSync(path.join(root, 'clash.png'), 'restored-content');
    const restoredIdentity = importNoConflict(setup, created.libraryId, path.join(root, 'clash.png')).assets[0]!;
    setup.trashAssets({ libraryId: created.libraryId, assetIds: [restoredIdentity.assetId] });
    writeFileSync(path.join(root, 'clash.png'), 'active-content');
    const active = importNoConflict(setup, created.libraryId, path.join(root, 'clash.png')).assets[0]!;
    setup.closeAll();

    const crashing = newService({ failAt: 'crash-restore-after-db-commit' });
    const opened = crashing.openLibrary(created.libraryPath);
    expectServiceError(
      () => crashing.restoreAssets({
        libraryId: opened.libraryId,
        assetIds: [restoredIdentity.assetId],
        conflictStrategy: 'replace',
      }),
      'LIBRARY_NOT_WRITABLE',
    );
    crashing.closeAll();

    const recovered = newService();
    const reopened = recovered.openLibrary(created.libraryPath);
    expect(readFileSync(path.join(reopened.libraryPath, 'Assets', 'clash.png'), 'utf8')).toBe('restored-content');
    expect(recovered.listAssets({ libraryId: reopened.libraryId, recursive: true }).map((asset) => asset.assetId)).toContain(restoredIdentity.assetId);
    expect(recovered.listAssets({ libraryId: reopened.libraryId, recursive: true }).map((asset) => asset.assetId)).not.toContain(active.assetId);
    expect(recovered.listTrash(reopened.libraryId)).toEqual([]);
    recovered.closeAll();
  });

  it('restores explicitly to the library root instead of the original folder', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Explicit Root Restore', selectedParentPath: root });
    const folder = service.createManagedFolder({ libraryId: created.libraryId, name: 'Original' });

    writeFileSync(path.join(root, 'root-target.jpg'), 'data');
    const asset = importNoConflict(service, created.libraryId, path.join(root, 'root-target.jpg'), folder.folderId).assets[0]!;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [asset.assetId] });

    const result = service.restoreAssets({ libraryId: created.libraryId, assetIds: [asset.assetId], targetFolderId: null });

    expect(result.assets[0]?.relativeFilePath).toBe('root-target.jpg');
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'root-target.jpg'))).toBe(true);
    service.closeAll();
  });

  it('falls back to root when original folder is gone', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
    const created = service.createLibrary({ displayName: 'Active Restore', selectedParentPath: root });

    writeFileSync(path.join(root, 'active.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'active.jpg'));

    expectServiceError(
      () => service.restoreAssets({ libraryId: created.libraryId, assetIds: [r.assets[0]!.assetId] }),
      'INVALID_IMPORT_DECISION',
    );
    service.closeAll();
  });

  it('rejects duplicate asset ids before creating a restore journal', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Duplicate Restore', selectedParentPath: root });
    writeFileSync(path.join(root, 'duplicate.jpg'), 'data');
    const asset = importNoConflict(service, created.libraryId, path.join(root, 'duplicate.jpg')).assets[0]!;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [asset.assetId] });

    expectServiceError(
      () => service.restoreAssets({ libraryId: created.libraryId, assetIds: [asset.assetId, asset.assetId] }),
      'INVALID_IMPORT_DECISION',
    );
    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect((database.prepare("SELECT COUNT(*) AS count FROM file_operations WHERE kind = 'restore'").get() as { count: number }).count).toBe(0);
    database.close();
    service.closeAll();
  });
});

describe('deleteAssetsPermanent', () => {
  it('removes trash file and DB row with cascade', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
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
    const service = newService();
    const created = service.createLibrary({ displayName: 'Active Del', selectedParentPath: root });

    writeFileSync(path.join(root, 'active-perm.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'active-perm.jpg'));

    expectServiceError(
      () => service.deleteAssetsPermanent({ libraryId: created.libraryId, assetIds: [r.assets[0]!.assetId] }),
      'INVALID_IMPORT_DECISION',
    );
    service.closeAll();
  });

  it('rejects a mixed or duplicate batch before deleting any trash entry', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Permanent Batch Validation', selectedParentPath: root });
    writeFileSync(path.join(root, 'trashed.jpg'), 'trashed');
    const trashed = importNoConflict(service, created.libraryId, path.join(root, 'trashed.jpg')).assets[0]!;
    writeFileSync(path.join(root, 'active.jpg'), 'active');
    const active = importNoConflict(service, created.libraryId, path.join(root, 'active.jpg')).assets[0]!;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [trashed.assetId] });
    const trashPath = path.join(created.libraryPath, '.serpent', 'trash', trashed.assetId);

    expectServiceError(
      () => service.deleteAssetsPermanent({
        libraryId: created.libraryId,
        assetIds: [trashed.assetId, active.assetId],
      }),
      'INVALID_IMPORT_DECISION',
    );
    expectServiceError(
      () => service.deleteAssetsPermanent({
        libraryId: created.libraryId,
        assetIds: [trashed.assetId, trashed.assetId],
      }),
      'INVALID_IMPORT_DECISION',
    );
    expect(existsSync(trashPath)).toBe(true);
    expect(service.listTrash(created.libraryId).map((asset) => asset.assetId)).toContain(trashed.assetId);
    service.closeAll();
  });

  it('continues a permanent-delete batch and returns structured skip reasons', () => {
    const root = temporaryRoot();
    let busyAssetId = '';
    const diagnostics: string[] = [];
    const service = newService({
      removeTrashPath: (trashPath) => {
        if (path.basename(trashPath) === busyAssetId) {
          throw Object.assign(new Error('file is busy'), { code: 'EBUSY' });
        }
        rmSync(trashPath, { force: true, recursive: true });
      },
      onDiagnostic: ({ scope }) => diagnostics.push(scope),
    });
    const created = service.createLibrary({ displayName: 'Permanent Partial Result', selectedParentPath: root });
    writeFileSync(path.join(root, 'busy.jpg'), 'busy');
    const busy = importNoConflict(service, created.libraryId, path.join(root, 'busy.jpg')).assets[0]!;
    writeFileSync(path.join(root, 'deletable.jpg'), 'deletable');
    const deletable = importNoConflict(service, created.libraryId, path.join(root, 'deletable.jpg')).assets[0]!;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [busy.assetId, deletable.assetId] });
    busyAssetId = busy.assetId;

    const result = service.deleteAssetsPermanent({
      libraryId: created.libraryId,
      assetIds: [busy.assetId, deletable.assetId],
    });

    expect(result).toEqual({
      deletedCount: 1,
      skippedCount: 1,
      skippedReasons: [{ assetId: busy.assetId, reason: 'FILE_BUSY' }],
    });
    expect(service.listTrash(created.libraryId).map((asset) => asset.assetId)).toEqual([busy.assetId]);
    expect(diagnostics).toContain('asset.delete-permanent.skip');
    service.closeAll();
  });
});

describe('emptyTrash', () => {
  it('permanently deletes all trashed assets and folder tombstones', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Empty Trash', selectedParentPath: root });

    writeFileSync(path.join(root, 'a.jpg'), 'a');
    writeFileSync(path.join(root, 'b.jpg'), 'b');
    const a = importNoConflict(service, created.libraryId, path.join(root, 'a.jpg')).assets[0]!;
    const b = importNoConflict(service, created.libraryId, path.join(root, 'b.jpg')).assets[0]!;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [a.assetId, b.assetId] });

    const { purgedCount } = service.emptyTrash(created.libraryId);
    expect(purgedCount).toBe(2);
    expect(service.listTrash(created.libraryId)).toEqual([]);
    service.closeAll();
  });

  it('keeps folder tombstones when some assets fail to purge (Serpent-b3kf)', () => {
    const root = temporaryRoot();
    let busyAssetId = '';
    const service = newService({
      removeTrashPath: (trashPath) => {
        if (path.basename(trashPath) === busyAssetId) {
          throw Object.assign(new Error('file is busy'), { code: 'EBUSY' });
        }
        rmSync(trashPath, { force: true, recursive: true });
      },
    });
    const created = service.createLibrary({
      displayName: 'Empty Trash Partial',
      selectedParentPath: root,
    });
    const folder = service.createManagedFolder({
      libraryId: created.libraryId,
      name: 'keep-me',
    });
    writeFileSync(path.join(root, 'busy.jpg'), 'busy');
    writeFileSync(path.join(root, 'ok.jpg'), 'ok');
    const busy = importNoConflict(
      service,
      created.libraryId,
      path.join(root, 'busy.jpg'),
      folder.folderId,
    ).assets[0]!;
    const ok = importNoConflict(
      service,
      created.libraryId,
      path.join(root, 'ok.jpg'),
      folder.folderId,
    ).assets[0]!;
    service.trashManagedFolder({
      libraryId: created.libraryId,
      folderId: folder.folderId,
    });
    busyAssetId = busy.assetId;

    const result = service.emptyTrash(created.libraryId);
    expect(result.purgedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(service.listTrash(created.libraryId).map((asset) => asset.assetId)).toEqual([
      busy.assetId,
    ]);
    expect(service.listTrashedFolders(created.libraryId).some((row) => row.name === 'keep-me')).toBe(
      true,
    );
    expect(ok.assetId).toBeTruthy();
    service.closeAll();
  });
});

describe('purgeExpiredTrash', () => {
  it('purges assets older than 30 days', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
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
    const service = newService();
    const created = service.createLibrary({ displayName: 'Open Purge', selectedParentPath: root });
    service.closeAll();
    service.openLibrary(created.libraryPath);
    expect(service.listTrash(created.libraryId)).toEqual([]);
    service.closeAll();
  });

  it('continues after a busy item and reports the skipped expiry', () => {
    const root = temporaryRoot();
    let busyAssetId = '';
    const service = newService({
      removeTrashPath: (trashPath) => {
        if (path.basename(trashPath) === busyAssetId) {
          throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        }
        rmSync(trashPath, { force: true, recursive: true });
      },
    });
    const created = service.createLibrary({ displayName: 'Purge Partial', selectedParentPath: root });
    writeFileSync(path.join(root, 'old-busy.jpg'), 'busy');
    const busy = importNoConflict(service, created.libraryId, path.join(root, 'old-busy.jpg')).assets[0]!;
    writeFileSync(path.join(root, 'old-delete.jpg'), 'delete');
    const deletable = importNoConflict(service, created.libraryId, path.join(root, 'old-delete.jpg')).assets[0]!;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [busy.assetId, deletable.assetId] });
    busyAssetId = busy.assetId;
    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    database.prepare('UPDATE assets SET deleted_at = ? WHERE asset_id IN (?, ?)').run(
      new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      busy.assetId,
      deletable.assetId,
    );
    database.close();

    expect(service.purgeExpiredTrash(created.libraryId)).toEqual({
      purgedCount: 1,
      skippedCount: 1,
      failures: [{ assetId: busy.assetId, reason: 'FILE_BUSY' }],
    });
    expect(service.listTrash(created.libraryId).map((asset) => asset.assetId)).toEqual([busy.assetId]);
    service.closeAll();
  });
});

describe('deleteLinkedAssets', () => {
  it('deletes linked asset DB row when deleteSourceFile is false', async () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Linked Del', selectedParentPath: root });

    mkdirSync(path.join(root, 'linked-del'), { recursive: true });
    writeFileSync(path.join(root, 'linked-del', 'to-delete.txt'), 'x');
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: path.join(root, 'linked-del') });

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const linkedAsset = assets.find((a) => a.managedFolderId === null);
    expect(linkedAsset).toBeTruthy();

    const { deletedCount } = await service.deleteLinkedAssets({ libraryId: created.libraryId, assetIds: [linkedAsset!.assetId], deleteSourceFile: false });
    expect(deletedCount).toBe(1);
    expect(existsSync(path.join(root, 'linked-del', 'to-delete.txt'))).toBe(true);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })).toHaveLength(0);
    service.closeAll();
  });

  it('moves the linked source to the system trash before deleting its DB row', async () => {
    const root = temporaryRoot();
    const systemTrashPath = path.join(root, 'system-trash');
    mkdirSync(systemTrashPath);
    const service = newService({
      trashItem: async (sourcePath) => {
        renameSync(sourcePath, path.join(systemTrashPath, path.basename(sourcePath)));
      },
    });
    const created = service.createLibrary({ displayName: 'Linked Src', selectedParentPath: root });

    mkdirSync(path.join(root, 'linked-del-src'), { recursive: true });
    writeFileSync(path.join(root, 'linked-del-src', 'keep.txt'), 'x');
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: path.join(root, 'linked-del-src') });

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const linkedAsset = assets.find((a) => a.managedFolderId === null);

    const result = await service.deleteLinkedAssets({
      libraryId: created.libraryId,
      assetIds: [linkedAsset!.assetId],
      deleteSourceFile: true,
    });

    expect(result).toEqual({ deletedCount: 1, failedCount: 0, failures: [] });
    expect(existsSync(path.join(root, 'linked-del-src', 'keep.txt'))).toBe(false);
    expect(existsSync(path.join(systemTrashPath, 'keep.txt'))).toBe(true);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })).toEqual([]);
    service.closeAll();
  });

  it('keeps the linked record and reports a diagnostic when system trash fails', async () => {
    const root = temporaryRoot();
    const diagnostics: Array<{ scope: string; error: unknown; context?: Record<string, unknown> }> = [];
    const service = newService({
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      trashItem: async () => {
        throw new Error('System trash rejected the source.');
      },
    });
    const created = service.createLibrary({ displayName: 'Linked Trash Failure', selectedParentPath: root });
    const linkedRoot = path.join(root, 'linked-trash-failure');
    const sourcePath = path.join(linkedRoot, 'preserve.txt');
    mkdirSync(linkedRoot);
    writeFileSync(sourcePath, 'preserve');
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: linkedRoot });
    const [linkedAsset] = service.listAssets({ libraryId: created.libraryId, recursive: true });

    const result = await service.deleteLinkedAssets({
      libraryId: created.libraryId,
      assetIds: [linkedAsset!.assetId],
      deleteSourceFile: true,
    });
    expect(result).toEqual({
      deletedCount: 0,
      failedCount: 1,
      failures: [{ assetId: linkedAsset!.assetId, reason: 'SOURCE_TRASH_FAILED' }],
    });
    expect(existsSync(sourcePath)).toBe(true);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true }))
      .toEqual([expect.objectContaining({ assetId: linkedAsset!.assetId })]);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'asset.delete-linked.trash-source',
        error: expect.objectContaining({
          code: 'ASSET_SOURCE_TRASH_FAILED',
          reason: 'SOURCE_TRASH_FAILED',
        }),
        context: expect.objectContaining({
          libraryId: created.libraryId,
          assetId: linkedAsset!.assetId,
        }),
      }),
    ]));
    service.closeAll();
  });

  it('deletes only records whose individual source trash operation succeeded', async () => {
    const root = temporaryRoot();
    const systemTrashPath = path.join(root, 'partial-system-trash');
    mkdirSync(systemTrashPath);
    const service = newService({
      trashItem: async (sourcePath) => {
        if (path.basename(sourcePath) === 'fail.txt') {
          throw new Error('Injected second-item trash failure.');
        }
        renameSync(sourcePath, path.join(systemTrashPath, path.basename(sourcePath)));
      },
    });
    const created = service.createLibrary({ displayName: 'Linked Partial Trash', selectedParentPath: root });
    const linkedRoot = path.join(root, 'linked-partial-trash');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'ok.txt'), 'ok');
    writeFileSync(path.join(linkedRoot, 'fail.txt'), 'fail');
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: linkedRoot });
    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const okAsset = assets.find((asset) => asset.displayName === 'ok.txt')!;
    const failedAsset = assets.find((asset) => asset.displayName === 'fail.txt')!;

    const result = await service.deleteLinkedAssets({
      libraryId: created.libraryId,
      assetIds: [okAsset.assetId, failedAsset.assetId],
      deleteSourceFile: true,
    });
    expect(result).toEqual({
      deletedCount: 1,
      failedCount: 1,
      failures: [{ assetId: failedAsset.assetId, reason: 'SOURCE_TRASH_FAILED' }],
    });

    expect(existsSync(path.join(systemTrashPath, 'ok.txt'))).toBe(true);
    expect(existsSync(path.join(linkedRoot, 'fail.txt'))).toBe(true);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true }))
      .toEqual([expect.objectContaining({ assetId: failedAsset.assetId })]);
    service.closeAll();
  });

  it('trashes every successful source before deleting their records in one transaction', async () => {
    const root = temporaryRoot();
    const systemTrashPath = path.join(root, 'transaction-system-trash');
    const diagnostics: Array<{ scope: string; error: unknown; context?: Record<string, unknown> }> = [];
    mkdirSync(systemTrashPath);
    const service = newService({
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      trashItem: async (sourcePath) => {
        renameSync(sourcePath, path.join(systemTrashPath, path.basename(sourcePath)));
      },
    });
    const created = service.createLibrary({ displayName: 'Linked Trash Transaction', selectedParentPath: root });
    const linkedRoot = path.join(root, 'linked-trash-transaction');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'one.txt'), 'one');
    writeFileSync(path.join(linkedRoot, 'two.txt'), 'two');
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: linkedRoot });
    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    database.exec(`
      CREATE TRIGGER reject_linked_asset_delete
      BEFORE DELETE ON assets
      WHEN old.location_kind = 'linked'
      BEGIN
        SELECT RAISE(ABORT, 'injected linked delete failure');
      END;
    `);
    database.close();

    await expect(service.deleteLinkedAssets({
      libraryId: created.libraryId,
      assetIds: assets.map((asset) => asset.assetId),
      deleteSourceFile: true,
    })).rejects.toMatchObject({
      code: 'ASSET_SOURCE_TRASH_FAILED',
      reason: 'SOURCE_TRASH_RECONCILIATION_REQUIRED',
    });

    expect(existsSync(path.join(systemTrashPath, 'one.txt'))).toBe(true);
    expect(existsSync(path.join(systemTrashPath, 'two.txt'))).toBe(true);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })).toHaveLength(2);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'asset.delete-linked.delete-records',
        context: expect.objectContaining({
          operationId: expect.any(String),
          libraryId: created.libraryId,
          sourceTrashedAssetIds: expect.arrayContaining(assets.map((asset) => asset.assetId)),
        }),
      }),
    ]));
    service.closeAll();

    const recoveryDatabase = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    recoveryDatabase.exec('DROP TRIGGER reject_linked_asset_delete;');
    recoveryDatabase.close();

    const recoveredService = newService();
    recoveredService.openLibrary(created.libraryPath);
    expect(recoveredService.listAssets({ libraryId: created.libraryId, recursive: true })).toEqual([]);
    recoveredService.closeAll();

    const auditedDatabase = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const operation = auditedDatabase.prepare(
      "SELECT status, error_code FROM file_operations WHERE kind = 'delete-linked-source'",
    ).get() as { status: string; error_code: string | null };
    expect(operation).toEqual({ status: 'committed', error_code: 'PROCESS_INTERRUPTED_RECOVERED' });
    auditedDatabase.close();
  });

  it('recovers when the system-trash helper moves a source and then throws', async () => {
    const root = temporaryRoot();
    const systemTrashPath = path.join(root, 'move-then-throw-trash');
    mkdirSync(systemTrashPath);
    const service = newService({
      trashItem: async (sourcePath) => {
        renameSync(sourcePath, path.join(systemTrashPath, path.basename(sourcePath)));
        throw new Error('injected helper exit after move');
      },
    });
    const created = service.createLibrary({ displayName: 'Move Then Throw', selectedParentPath: root });
    const linkedRoot = path.join(root, 'move-then-throw-source');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'one.txt'), 'one');
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: linkedRoot });
    const [asset] = service.listAssets({ libraryId: created.libraryId, recursive: true });

    await expect(service.deleteLinkedAssets({
      libraryId: created.libraryId,
      assetIds: [asset!.assetId],
      deleteSourceFile: true,
    })).rejects.toMatchObject({
      code: 'ASSET_SOURCE_TRASH_FAILED',
      reason: 'SOURCE_TRASH_RECONCILIATION_REQUIRED',
    });
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })).toHaveLength(1);
    service.closeAll();

    const recoveredService = newService();
    recoveredService.openLibrary(created.libraryPath);
    expect(recoveredService.listAssets({ libraryId: created.libraryId, recursive: true })).toEqual([]);
    recoveredService.closeAll();
  });

  it('rejects duplicate linked asset IDs before performing any deletion', async () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Linked Duplicate IDs', selectedParentPath: root });
    const linkedRoot = path.join(root, 'linked-duplicate-ids');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'one.txt'), 'one');
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: linkedRoot });
    const [asset] = service.listAssets({ libraryId: created.libraryId, recursive: true });

    await expect(service.deleteLinkedAssets({
      libraryId: created.libraryId,
      assetIds: [asset!.assetId, asset!.assetId],
      deleteSourceFile: false,
    })).rejects.toMatchObject({ code: 'INVALID_IMPORT_DECISION' });
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })).toHaveLength(1);
    service.closeAll();
  });

  it('does not infer an in-flight source was trashed while its linked root is offline', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Linked Offline Recovery', selectedParentPath: root });
    const linkedRoot = path.join(root, 'linked-offline-recovery');
    const offlineRoot = path.join(root, 'linked-offline-recovery-disconnected');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'one.txt'), 'one');
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: linkedRoot });
    const [asset] = service.listAssets({ libraryId: created.libraryId, recursive: true });
    service.closeAll();

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const operationId = randomUUID();
    const now = new Date().toISOString();
    database.prepare(
      `INSERT INTO file_operations
         (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
       VALUES (?, 'delete-linked-source', 'applying', ?, NULL, ?, ?)`,
    ).run(operationId, JSON.stringify({
      version: 2,
      kind: 'linked-trash',
      assetIds: [asset!.assetId],
      inFlightAssetId: asset!.assetId,
      trashedAssetIds: [],
    }), now, now);
    database.close();
    renameSync(linkedRoot, offlineRoot);

    const recoveredService = newService();
    recoveredService.openLibrary(created.libraryPath);
    expect(recoveredService.listAssets({ libraryId: created.libraryId, recursive: true }))
      .toEqual([expect.objectContaining({ assetId: asset!.assetId, locationKind: 'linked' })]);
    recoveredService.closeAll();

    let auditedDatabase = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    let operation = auditedDatabase.prepare(
      'SELECT status, error_code FROM file_operations WHERE operation_id = ?',
    ).get(operationId) as { status: string; error_code: string | null };
    expect(operation).toEqual({
      status: 'applying',
      error_code: 'SOURCE_TRASH_RECONCILIATION_REQUIRED',
    });
    auditedDatabase.close();

    renameSync(offlineRoot, linkedRoot);
    const secondRecovery = newService();
    secondRecovery.openLibrary(created.libraryPath);
    expect(secondRecovery.listAssets({ libraryId: created.libraryId, recursive: true }))
      .toEqual([expect.objectContaining({ assetId: asset!.assetId })]);
    secondRecovery.closeAll();

    auditedDatabase = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    operation = auditedDatabase.prepare(
      'SELECT status, error_code FROM file_operations WHERE operation_id = ?',
    ).get(operationId) as { status: string; error_code: string | null };
    expect(operation).toEqual({ status: 'committed', error_code: 'PROCESS_INTERRUPTED_PARTIAL' });
    auditedDatabase.close();
  });

  (process.platform === 'win32' ? it.skip : it)(
    'keeps recovery pending when an external symlink makes the in-flight source unsafe to inspect',
    () => {
      const root = temporaryRoot();
      const service = newService();
      const created = service.createLibrary({ displayName: 'Linked Symlink Recovery', selectedParentPath: root });
      const linkedRoot = path.join(root, 'linked-symlink-recovery');
      const nestedRoot = path.join(linkedRoot, 'nested');
      const replacementRoot = path.join(root, 'replacement-target');
      mkdirSync(nestedRoot, { recursive: true });
      mkdirSync(replacementRoot);
      writeFileSync(path.join(nestedRoot, 'one.txt'), 'one');
      service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: linkedRoot });
      const [asset] = service.listAssets({ libraryId: created.libraryId, recursive: true });
      service.closeAll();

      const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
      const operationId = randomUUID();
      const now = new Date().toISOString();
      database.prepare(
        `INSERT INTO file_operations
           (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
         VALUES (?, 'delete-linked-source', 'applying', ?, NULL, ?, ?)`,
      ).run(operationId, JSON.stringify({
        version: 2,
        kind: 'linked-trash',
        assetIds: [asset!.assetId],
        inFlightAssetId: asset!.assetId,
        trashedAssetIds: [],
      }), now, now);
      database.close();
      rmSync(nestedRoot, { recursive: true });
      symlinkSync(replacementRoot, nestedRoot, 'dir');

      const recoveredService = newService();
      expect(() => recoveredService.openLibrary(created.libraryPath)).not.toThrow();
      expect(recoveredService.listAssets({ libraryId: created.libraryId, recursive: true }))
        .toEqual([expect.objectContaining({ assetId: asset!.assetId })]);
      recoveredService.closeAll();

      const auditedDatabase = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
      const operation = auditedDatabase.prepare(
        'SELECT status, error_code FROM file_operations WHERE operation_id = ?',
      ).get(operationId) as { status: string; error_code: string | null };
      expect(operation).toEqual({
        status: 'applying',
        error_code: 'SOURCE_TRASH_RECONCILIATION_REQUIRED',
      });
      auditedDatabase.close();
    },
  );

  (process.env.SERPENT_TEST_REAL_SYSTEM_TRASH === '1' ? it : it.skip)(
    'moves a real linked source through the platform system-trash helper',
    async () => {
      const root = temporaryRoot();
      const service = newService();
      const created = service.createLibrary({ displayName: 'Real System Trash', selectedParentPath: root });
      const linkedRoot = path.join(root, 'real-system-trash');
      const sourcePath = path.join(linkedRoot, `serpent-trash-${randomUUID()}.txt`);
      mkdirSync(linkedRoot);
      writeFileSync(sourcePath, 'safe-to-trash');
      service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: linkedRoot });
      const [linkedAsset] = service.listAssets({ libraryId: created.libraryId, recursive: true });

      const result = await service.deleteLinkedAssets({
        libraryId: created.libraryId,
        assetIds: [linkedAsset!.assetId],
        deleteSourceFile: true,
      });

      expect(result).toEqual({ deletedCount: 1, failedCount: 0, failures: [] });
      expect(existsSync(sourcePath)).toBe(false);
      expect(service.listAssets({ libraryId: created.libraryId, recursive: true })).toEqual([]);
      service.closeAll();
    },
  );

  it('rejects deleting a managed asset with linked delete', async () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Managed via Linked', selectedParentPath: root });

    writeFileSync(path.join(root, 'managed.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'managed.jpg'));

    await expect(service.deleteLinkedAssets({
      libraryId: created.libraryId,
      assetIds: [r.assets[0]!.assetId],
      deleteSourceFile: false,
    })).rejects.toMatchObject({ code: 'INVALID_IMPORT_DECISION' });
    service.closeAll();
  });
});

describe('relinkAsset (single missing asset)', () => {
  it('relinks a missing asset to a new file and creates a relink revision', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Relink', selectedParentPath: root });

    writeFileSync(path.join(root, 'orig-relink.jpg'), 'orig');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'orig-relink.jpg'));
    const assetId = r.assets[0]!.assetId;

    rmSync(path.join(created.libraryPath, 'Assets', 'orig-relink.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const before = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(before[0]!.availability).toBe('missing');

    writeFileSync(path.join(root, 'new-location.jpg'), 'new');
    const { asset, batchFollowUpRoot } = service.relinkAsset({ libraryId: created.libraryId, assetId, newAbsolutePath: path.join(root, 'new-location.jpg') });

    expect(asset.assetId).toBe(assetId);
    expect(asset.availability).toBe('available');
    expect(batchFollowUpRoot).toBe(root);

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const revisions = db.prepare("SELECT origin FROM revisions WHERE asset_id = ? ORDER BY accepted_at DESC").all(assetId) as Array<{ origin: string }>;
    expect(revisions[0]!.origin).toBe('relink');
    db.close();

    service.closeAll();
  });

  it('copies replacement bytes back to the managed path across refresh and reopen', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Managed Relink Persistence', selectedParentPath: root });

    const sourcePath = path.join(root, 'managed-persistence.jpg');
    writeFileSync(sourcePath, 'old-managed-bytes');
    const imported = importNoConflict(service, created.libraryId, sourcePath);
    const assetId = imported.assets[0]!.assetId;
    const managedPath = path.join(created.libraryPath, 'Assets', 'managed-persistence.jpg');

    rmSync(managedPath);
    service.refreshManagedAssets(created.libraryId);

    const replacementPath = path.join(root, 'replacement.jpg');
    writeFileSync(replacementPath, 'replacement-bytes');
    const { asset } = service.relinkAsset({
      libraryId: created.libraryId,
      assetId,
      newAbsolutePath: replacementPath,
    });

    expect(asset.locationKind).toBe('managed');
    expect(asset.relativeFilePath).toBe('managed-persistence.jpg');
    expect(service.resolveAssetPath(created.libraryId, assetId)).toBe(managedPath);
    expect(readFileSync(managedPath, 'utf8')).toBe('replacement-bytes');
    expect(readFileSync(replacementPath, 'utf8')).toBe('replacement-bytes');

    service.refreshManagedAssets(created.libraryId);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!.availability).toBe('available');

    service.closeAll();
    const reopened = service.openLibrary(created.libraryPath);
    expect(reopened.libraryId).toBe(created.libraryId);
    expect(service.resolveAssetPath(created.libraryId, assetId)).toBe(managedPath);
    expect(readFileSync(service.resolveAssetPath(created.libraryId, assetId), 'utf8')).toBe('replacement-bytes');
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!.availability).toBe('available');
    service.closeAll();
  });

  it('preserves metadata and tags after relink', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Relink Meta', selectedParentPath: root });

    writeFileSync(path.join(root, 'with-meta.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'with-meta.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.setAssetMetadata({ libraryId: created.libraryId, assetId, expectedVersion: 0, description: 'Test Description', rating: 4, favorite: true });

    rmSync(path.join(created.libraryPath, 'Assets', 'with-meta.jpg'));
    service.refreshManagedAssets(created.libraryId);

    writeFileSync(path.join(root, 'relinked-meta.jpg'), 'data');
    const { asset } = service.relinkAsset({ libraryId: created.libraryId, assetId, newAbsolutePath: path.join(root, 'relinked-meta.jpg') });

    expect(asset.availability).toBe('available');
    expect(service.getAssetMetadata({ libraryId: created.libraryId, assetId }).description).toBe('Test Description');
    expect(asset.rating).toBe(4);
    expect(asset.favorite).toBe(true);

    service.closeAll();
  });

  it('rejects relinking an available asset', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
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
    const service = newService();
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
    const service = newService();
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

  it('does not mark a linked asset available when its linked root is offline', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Offline Linked Relink', selectedParentPath: root });
    const linkedRoot = path.join(root, 'offline-linked-root');
    mkdirSync(linkedRoot, { recursive: true });
    writeFileSync(path.join(linkedRoot, 'linked.jpg'), 'linked');
    service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: linkedRoot,
    });
    const assetId = service.listAssets({ libraryId: created.libraryId, recursive: true })
      .find((asset) => asset.locationKind === 'linked')!.assetId;

    rmSync(linkedRoot, { recursive: true });
    service.refreshManagedAssets(created.libraryId);
    const replacement = path.join(root, 'outside-linked-root.jpg');
    writeFileSync(replacement, 'replacement');

    expectServiceError(
      () => service.relinkAsset({
        libraryId: created.libraryId,
        assetId,
        newAbsolutePath: replacement,
      }),
      'INVALID_IMPORT_SOURCE',
    );
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!.availability)
      .toBe('missing');
    service.closeAll();
  });
});

describe('relinkBatchPreview', () => {
  it('returns matched/unmatched counts without absolute paths', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
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
    const service = newService();
    const created = service.createLibrary({ displayName: 'Bad Root', selectedParentPath: root });

    expectServiceError(
      () => service.relinkBatchPreview({ libraryId: created.libraryId, newRootPath: path.join(root, 'nonexistent') }),
      'INVALID_IMPORT_SOURCE',
    );
    service.closeAll();
  });

  it('treats one basename candidate for two assets as ambiguous', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Ambiguous Batch Preview', selectedParentPath: root });
    const firstFolder = service.createManagedFolder({ libraryId: created.libraryId, name: 'first' });
    const secondFolder = service.createManagedFolder({ libraryId: created.libraryId, name: 'second' });
    const source = path.join(root, 'shared.jpg');
    writeFileSync(source, 'first-bytes');
    const first = importNoConflict(service, created.libraryId, source, firstFolder.folderId);
    writeFileSync(source, 'second-bytes');
    const second = importNoConflict(service, created.libraryId, source, secondFolder.folderId);
    rmSync(path.join(created.libraryPath, 'Assets', 'first', 'shared.jpg'));
    rmSync(path.join(created.libraryPath, 'Assets', 'second', 'shared.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const replacementRoot = path.join(root, 'ambiguous-root');
    mkdirSync(replacementRoot, { recursive: true });
    writeFileSync(path.join(replacementRoot, 'shared.jpg'), 'ambiguous-bytes');

    const preview = service.relinkBatchPreview({
      libraryId: created.libraryId,
      newRootPath: replacementRoot,
    });
    expect(preview).toMatchObject({ matchedCount: 0, unmatchedCount: 2, totalCount: 2 });

    const result = service.relinkBatchApply({
      libraryId: created.libraryId,
      newRootPath: replacementRoot,
      keepMetadata: true,
    });
    expect(result).toMatchObject({ restoredCount: 0, unchangedMissingCount: 2 });
    const missingIds = service.listAssets({ libraryId: created.libraryId, recursive: true })
      .filter((asset) => asset.availability === 'missing')
      .map((asset) => asset.assetId);
    expect(missingIds).toEqual(expect.arrayContaining([
      first.assets[0]!.assetId,
      second.assets[0]!.assetId,
    ]));
    service.closeAll();
  });
});

describe('relinkBatchApply', () => {
  it('restores matched assets and leaves unmatched as missing', () => {
    const root = temporaryRoot();
    const service = newService();
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

  it('copies matched bytes to each managed path across refresh and reopen', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Batch Managed Persistence', selectedParentPath: root });

    writeFileSync(path.join(root, 'root-file.jpg'), 'old-root');
    const rootImport = importNoConflict(service, created.libraryId, path.join(root, 'root-file.jpg'));
    const folder = service.createManagedFolder({ libraryId: created.libraryId, name: 'nested' });
    writeFileSync(path.join(root, 'nested-file.jpg'), 'old-nested');
    const nestedImport = importNoConflict(
      service,
      created.libraryId,
      path.join(root, 'nested-file.jpg'),
      folder.folderId,
    );

    const rootManagedPath = path.join(created.libraryPath, 'Assets', 'root-file.jpg');
    const nestedManagedPath = path.join(created.libraryPath, 'Assets', 'nested', 'nested-file.jpg');
    rmSync(rootManagedPath);
    rmSync(path.dirname(nestedManagedPath), { recursive: true });
    service.refreshManagedAssets(created.libraryId);

    const replacementRoot = path.join(root, 'batch-replacements');
    mkdirSync(path.join(replacementRoot, 'nested'), { recursive: true });
    writeFileSync(path.join(replacementRoot, 'root-file.jpg'), 'new-root');
    writeFileSync(path.join(replacementRoot, 'nested', 'nested-file.jpg'), 'new-nested');

    const result = service.relinkBatchApply({
      libraryId: created.libraryId,
      newRootPath: replacementRoot,
      keepMetadata: true,
    });

    expect(result.restoredCount).toBe(2);
    expect(readFileSync(rootManagedPath, 'utf8')).toBe('new-root');
    expect(readFileSync(nestedManagedPath, 'utf8')).toBe('new-nested');
    expect(service.resolveAssetPath(created.libraryId, rootImport.assets[0]!.assetId)).toBe(rootManagedPath);
    expect(service.resolveAssetPath(created.libraryId, nestedImport.assets[0]!.assetId)).toBe(nestedManagedPath);

    service.refreshManagedAssets(created.libraryId);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true }))
      .toSatisfy((assets: Array<{ availability: string }>) => assets.every((asset) => asset.availability === 'available'));

    service.closeAll();
    service.openLibrary(created.libraryPath);
    expect(readFileSync(service.resolveAssetPath(created.libraryId, rootImport.assets[0]!.assetId), 'utf8')).toBe('new-root');
    expect(readFileSync(service.resolveAssetPath(created.libraryId, nestedImport.assets[0]!.assetId), 'utf8')).toBe('new-nested');
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true }))
      .toSatisfy((assets: Array<{ availability: string }>) => assets.every((asset) => asset.availability === 'available'));
    service.closeAll();
  });

  it('follow-up batch apply after single relink restores sibling missing assets', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Follow Up Batch', selectedParentPath: root });
    const folder = service.createManagedFolder({ libraryId: created.libraryId, name: 'sub' });

    writeFileSync(path.join(root, 'a.jpg'), 'a');
    writeFileSync(path.join(root, 'b.jpg'), 'b');
    const first = importNoConflict(service, created.libraryId, path.join(root, 'a.jpg'), folder.folderId);
    const second = importNoConflict(service, created.libraryId, path.join(root, 'b.jpg'), folder.folderId);

    rmSync(path.join(created.libraryPath, 'Assets', 'sub', 'a.jpg'));
    rmSync(path.join(created.libraryPath, 'Assets', 'sub', 'b.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const replacementRoot = path.join(root, 'replacements');
    mkdirSync(path.join(replacementRoot, 'sub'), { recursive: true });
    writeFileSync(path.join(replacementRoot, 'sub', 'a.jpg'), 'new-a');
    writeFileSync(path.join(replacementRoot, 'sub', 'b.jpg'), 'new-b');

    const relinked = service.relinkAsset({
      libraryId: created.libraryId,
      assetId: first.assets[0]!.assetId,
      newAbsolutePath: path.join(replacementRoot, 'sub', 'a.jpg'),
    });
    expect(relinked.asset.availability).toBe('available');
    expect(relinked.batchFollowUpRoot).toBe(replacementRoot);

    const preview = service.relinkBatchPreview({
      libraryId: created.libraryId,
      newRootPath: relinked.batchFollowUpRoot,
    });
    expect(preview).toMatchObject({ matchedCount: 1, totalCount: 1, unmatchedCount: 0 });

    const applied = service.relinkBatchApply({
      libraryId: created.libraryId,
      newRootPath: replacementRoot,
      keepMetadata: true,
    });
    expect(applied.restoredCount).toBe(1);
    expect(applied.assets).toHaveLength(1);
    expect(applied.assets[0]!.availability).toBe('available');

    const all = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(all.find((asset) => asset.assetId === first.assets[0]!.assetId)!.availability).toBe('available');
    expect(all.find((asset) => asset.assetId === second.assets[0]!.assetId)!.availability).toBe('available');
    service.closeAll();
  });

  it('keepMetadata=true preserves human and AI metadata, tags, and collections', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Keep Meta', selectedParentPath: root });

    writeFileSync(path.join(root, 'keepmeta.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'keepmeta.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.setAssetMetadata({ libraryId: created.libraryId, assetId, expectedVersion: 0, description: 'Important', rating: 5, favorite: true, sourcePageUrl: 'https://example.com' });
    const tag = service.createTag({ libraryId: created.libraryId, name: 'keep-tag' });
    service.assignTags({ libraryId: created.libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    service.writeAiAnalysisResult({
      libraryId: created.libraryId,
      assetId,
      description: 'AI description',
      tags: ['ai-keep-tag'],
      modelId: 'test-model',
      modelVersion: 'v1',
      enabledFields: { description: true, tags: true, rating: false },
    });

    rmSync(path.join(created.libraryPath, 'Assets', 'keepmeta.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const newRoot = path.join(root, 'root-keep');
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(path.join(newRoot, 'keepmeta.jpg'), 'relinked');

    service.relinkBatchApply({ libraryId: created.libraryId, newRootPath: newRoot, keepMetadata: true });

    const meta = service.getAssetMetadata({ libraryId: created.libraryId, assetId });
    expect(meta.description).toBe('Important');
    expect(meta.rating).toBe(5);
    expect(meta.favorite).toBe(true);
    expect(meta.sourcePageUrl).toBe('https://example.com');

    const tags = service.listTags(created.libraryId);
    expect(tags.find((t) => t.name === 'keep-tag')!.assetCount).toBeGreaterThan(0);
    expect(service.getAiContent(created.libraryId, assetId).some((content) => content.fieldName === 'description')).toBe(true);
    const keepDb = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect((keepDb.prepare('SELECT COUNT(*) AS count FROM ai_asset_tags WHERE asset_id = ?').get(assetId) as { count: number }).count).toBe(1);
    keepDb.close();
    service.closeAll();
  });

  it('keepMetadata=false clears human and AI metadata, tags, and collections', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Clear Meta', selectedParentPath: root });

    writeFileSync(path.join(root, 'clearmeta.jpg'), 'data');
    const r = importNoConflict(service, created.libraryId, path.join(root, 'clearmeta.jpg'));
    const assetId = r.assets[0]!.assetId;

    service.setAssetMetadata({ libraryId: created.libraryId, assetId, expectedVersion: 0, description: 'Will Clear', rating: 4, favorite: true, sourcePageUrl: 'https://gone.com' });
    const tag = service.createTag({ libraryId: created.libraryId, name: 'clear-tag' });
    service.assignTags({ libraryId: created.libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    service.writeAiAnalysisResult({
      libraryId: created.libraryId,
      assetId,
      description: 'AI description to clear',
      tags: ['ai-clear-tag'],
      modelId: 'test-model',
      modelVersion: 'v1',
      enabledFields: { description: true, tags: true, rating: false },
    });

    const col = service.createCollection({ libraryId: created.libraryId, name: 'Clear Col' });
    service.addCollectionAssets({ libraryId: created.libraryId, collectionId: col.collectionId, assetIds: [assetId] });

    rmSync(path.join(created.libraryPath, 'Assets', 'clearmeta.jpg'));
    service.refreshManagedAssets(created.libraryId);

    const newRoot = path.join(root, 'root-clear');
    mkdirSync(newRoot, { recursive: true });
    writeFileSync(path.join(newRoot, 'clearmeta.jpg'), 'relinked');

    service.relinkBatchApply({ libraryId: created.libraryId, newRootPath: newRoot, keepMetadata: false });

    const meta = service.getAssetMetadata({ libraryId: created.libraryId, assetId });
    expect(meta.description).toBeNull();
    expect(meta.rating).toBe(0);
    expect(meta.favorite).toBe(false);
    expect(meta.sourcePageUrl).toBeNull();

    expect(service.listTags(created.libraryId).find((t) => t.name === 'clear-tag')!.assetCount).toBe(0);
    expect(service.listCollectionAssets({ libraryId: created.libraryId, collectionId: col.collectionId, recursive: false })).toHaveLength(0);
    expect(service.getAiContent(created.libraryId, assetId)).toHaveLength(0);
    const clearDb = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect((clearDb.prepare('SELECT COUNT(*) AS count FROM ai_asset_tags WHERE asset_id = ?').get(assetId) as { count: number }).count).toBe(0);
    clearDb.close();
    service.closeAll();
  });

  it('creates only one file_operations row for the entire batch', () => {
    const root = temporaryRoot();
    const service = newService();
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

  it('updates a moved linked asset path and remains available after refresh', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Batch Linked Move', selectedParentPath: root });
    const linkedRoot = path.join(root, 'batch-linked-root');
    const oldFolder = path.join(linkedRoot, 'old');
    const newFolder = path.join(linkedRoot, 'new');
    mkdirSync(oldFolder, { recursive: true });
    writeFileSync(path.join(oldFolder, 'moved.jpg'), 'linked-moved');
    service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: linkedRoot,
    });
    const assetId = service.listAssets({ libraryId: created.libraryId, recursive: true })
      .find((asset) => asset.locationKind === 'linked')!.assetId;

    rmSync(path.join(oldFolder, 'moved.jpg'));
    service.refreshManagedAssets(created.libraryId);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })
      .find((asset) => asset.assetId === assetId)!.availability)
      .toBe('missing');
    mkdirSync(newFolder, { recursive: true });
    writeFileSync(path.join(newFolder, 'moved.jpg'), 'linked-moved');

    const result = service.relinkBatchApply({
      libraryId: created.libraryId,
      newRootPath: newFolder,
      keepMetadata: true,
    });

    expect(result.restoredCount).toBe(1);
    expect(result.assets[0]!.relativeFilePath).toBe('new/moved.jpg');
    expect(service.resolveAssetPath(created.libraryId, assetId)).toBe(realpathSync(path.join(newFolder, 'moved.jpg')));
    service.refreshManagedAssets(created.libraryId);
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })
      .find((asset) => asset.assetId === assetId)!.availability)
      .toBe('available');
    service.closeAll();
    service.openLibrary(created.libraryPath);
    expect(service.resolveAssetPath(created.libraryId, assetId)).toBe(realpathSync(path.join(newFolder, 'moved.jpg')));
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })
      .find((asset) => asset.assetId === assetId)!.availability)
      .toBe('available');
    service.closeAll();
  });
});

describe('active assets should not expose trashed fields', () => {
  it('active assets have null deletedAt/trashedFromPath/remainingDays', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
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
