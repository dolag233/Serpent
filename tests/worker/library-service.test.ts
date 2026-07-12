import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
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

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(source: string): void;
  pragma(source: string): unknown;
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
    run(...parameters: unknown[]): unknown;
  };
}

const TestDatabase = require('better-sqlite3') as new (
  filename: string,
) => TestDatabaseConnection;

function downgradeLibraryToV1(libraryPath: string, createMigrationBlocker = false): void {
  const database = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
  database.exec(`
    DROP TABLE IF EXISTS collection_assets;
    DROP TABLE IF EXISTS collections;
    DROP TABLE IF EXISTS smart_collections;
    DROP TABLE IF EXISTS human_asset_tags;
    DROP TABLE IF EXISTS ai_asset_tags;
    DROP TABLE IF EXISTS asset_metadata;
    DROP TABLE IF EXISTS tags;
    DROP TABLE file_operations;
    DROP TABLE revisions;
    DROP TABLE assets;
    DROP TABLE IF EXISTS linked_folders;
    DROP TABLE managed_folders;
    DELETE FROM schema_migrations WHERE version >= 2;
    PRAGMA user_version = 1;
    ${createMigrationBlocker ? 'CREATE TABLE managed_folders (blocker TEXT);' : ''}
  `);
  database.close();
}

function downgradeLibraryToV2(libraryPath: string): void {
  const database = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
  database.exec(`
    -- better-sqlite3 defaults foreign_keys = ON (unlike SQLite's default OFF);
    -- disable during this raw downgrade so DROP TABLE assets does not cascade
    -- through revisions.asset_id ON DELETE CASCADE and orphan every asset.
    PRAGMA foreign_keys = OFF;
    -- Reverse v5: drop organization tables (tags, collections, metadata).
    DROP TABLE IF EXISTS collection_assets;
    DROP TABLE IF EXISTS collections;
    DROP TABLE IF EXISTS smart_collections;
    DROP TABLE IF EXISTS human_asset_tags;
    DROP TABLE IF EXISTS ai_asset_tags;
    DROP TABLE IF EXISTS asset_metadata;
    DROP TABLE IF EXISTS tags;
    -- Reverse v4: drop linked-related objects and rebuild assets to v2 shape
    -- (no path_identity, no linked_folder_id, location_kind='managed',
    -- relative_file_path UNIQUE column constraint).
    DROP TABLE IF EXISTS linked_folders;
    DROP INDEX IF EXISTS assets_linked_folder_path_idx;
    DROP INDEX IF EXISTS assets_managed_relative_unique;
    DROP INDEX IF EXISTS assets_managed_path_identity_unique;
    DROP INDEX IF EXISTS assets_linked_relative_unique;
    DROP INDEX IF EXISTS assets_linked_path_identity_unique;
    DROP TRIGGER IF EXISTS assets_path_identity_required_insert;
    DROP TRIGGER IF EXISTS assets_path_identity_required_update;
    CREATE TABLE assets_v2 (
      asset_id TEXT PRIMARY KEY,
      location_kind TEXT NOT NULL CHECK (location_kind = 'managed'),
      managed_folder_id TEXT REFERENCES managed_folders(folder_id) ON DELETE RESTRICT,
      relative_file_path TEXT NOT NULL UNIQUE,
      current_revision_id TEXT,
      availability TEXT NOT NULL CHECK (availability IN ('available', 'missing')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO assets_v2 (
      asset_id, location_kind, managed_folder_id, relative_file_path,
      current_revision_id, availability, created_at, updated_at
    )
    SELECT
      asset_id, 'managed', managed_folder_id, relative_file_path,
      current_revision_id, availability, created_at, updated_at
    FROM assets;
    DROP TABLE assets;
    ALTER TABLE assets_v2 RENAME TO assets;
    CREATE INDEX assets_folder_path_idx ON assets(managed_folder_id, relative_file_path);
    -- Reverse v3: drop managed_folders path_identity.
    DROP TRIGGER IF EXISTS managed_folders_path_identity_required_insert;
    DROP TRIGGER IF EXISTS managed_folders_path_identity_required_update;
    DROP INDEX IF EXISTS managed_folders_path_identity_unique;
    ALTER TABLE managed_folders DROP COLUMN path_identity;
    DELETE FROM schema_migrations WHERE version >= 3;
    PRAGMA user_version = 2;
  `);
  database.close();
}

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-library-test-'));
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
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('LibraryService lifecycle', () => {
  it('creates a self-contained library and exposes it exactly once', () => {
    const root = temporaryRoot();
    const service = new LibraryService();

    const created = service.createLibrary({
      displayName: '  概念设计  ',
      selectedParentPath: root,
    });

    expect(created.displayName).toBe('概念设计');
    expect(created.libraryPath).toBe(realpathSync(path.join(root, '概念设计')));
    expect(created.libraryId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(statSync(path.join(created.libraryPath, 'Assets')).isDirectory()).toBe(true);
    expect(statSync(path.join(created.libraryPath, '.serpent', 'library.db')).isFile()).toBe(
      true,
    );
    expect(statSync(path.join(created.libraryPath, '.serpent', 'previews')).isDirectory()).toBe(
      true,
    );
    expect(service.listLibraries()).toEqual([created]);

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(database.pragma('user_version')).toEqual([{ user_version: 5 }]);
    database.close();

    expect(service.openLibrary(created.libraryPath)).toEqual(created);
    expect(service.listLibraries()).toEqual([created]);
    service.closeAll();
  });

  it('closes, moves, and reopens a library without changing its identity', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'Reference',
      selectedParentPath: root,
    });

    service.closeLibrary(created.libraryId);
    expect(service.listLibraries()).toEqual([]);

    const movedPath = path.join(root, 'Moved Reference');
    renameSync(created.libraryPath, movedPath);
    const reopened = service.openLibrary(movedPath);

    expect(reopened).toEqual({ ...created, libraryPath: realpathSync(movedPath) });
    service.closeAll();
  });

  it('recreates regenerable directories when reopening a closed library', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'Textures',
      selectedParentPath: root,
    });
    service.closeLibrary(created.libraryId);
    rmSync(path.join(created.libraryPath, '.serpent', 'previews'), { recursive: true });
    rmSync(path.join(created.libraryPath, '.serpent', 'trash'), { recursive: true });

    service.openLibrary(created.libraryPath);

    expect(statSync(path.join(created.libraryPath, '.serpent', 'previews')).isDirectory()).toBe(
      true,
    );
    expect(statSync(path.join(created.libraryPath, '.serpent', 'trash')).isDirectory()).toBe(
      true,
    );
    service.closeAll();
  });

  it('rejects a conflicting target without leaving a creation partial', () => {
    const root = temporaryRoot();
    const first = new LibraryService();
    const created = first.createLibrary({
      displayName: 'Existing',
      selectedParentPath: root,
    });
    first.closeAll();

    const second = new LibraryService();
    expectServiceError(
      () => second.createLibrary({ displayName: 'Existing', selectedParentPath: root }),
      'LIBRARY_ALREADY_EXISTS',
    );
    expect(readdirSync(root).sort()).toEqual([path.basename(created.libraryPath)]);
  });

  it('rejects folders that are missing a required library location', () => {
    const root = temporaryRoot();
    const service = new LibraryService();

    expectServiceError(() => service.openLibrary(root), 'NOT_A_LIBRARY');
  });

  it('rejects a missing database as a non-library', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'No Database', selectedParentPath: root });
    service.closeAll();
    rmSync(path.join(created.libraryPath, '.serpent', 'library.db'));

    expectServiceError(() => service.openLibrary(created.libraryPath), 'NOT_A_LIBRARY');
  });

  it('rejects a library whose required Assets directory was removed', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Missing Assets', selectedParentPath: root });
    service.closeAll();
    rmSync(path.join(created.libraryPath, 'Assets'), { recursive: true });

    expectServiceError(() => service.openLibrary(created.libraryPath), 'NOT_A_LIBRARY');
  });

  it('rejects a database created by a newer schema version', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Future', selectedParentPath: root });
    service.closeAll();
    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    database.pragma('user_version = 999');
    database.close();

    expectServiceError(
      () => service.openLibrary(created.libraryPath),
      'LIBRARY_VERSION_TOO_NEW',
    );
  });

  it('migrates a valid v1 library through v2 to v3 when opening', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Migration', selectedParentPath: root });
    service.closeAll();
    downgradeLibraryToV1(created.libraryPath);

    service.openLibrary(created.libraryPath);

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(database.pragma('user_version')).toEqual([{ user_version: 5 }]);
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assets'")
        .all(),
    ).toEqual([{ name: 'assets' }]);
    database.close();
    service.closeAll();
  });

  it('migrates a populated v2 library to portable path identities', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'Café.PNG');
    writeFileSync(source, 'asset');
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Portable Migration', selectedParentPath: root });
    service.prepareOrExecuteImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });
    service.closeAll();
    downgradeLibraryToV2(created.libraryPath);

    const reopened = service.openLibrary(created.libraryPath);
    expect(service.listAssets({ libraryId: reopened.libraryId, recursive: true })[0])
      .toMatchObject({ relativeFilePath: 'Café.PNG' });
    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(database.pragma('user_version')).toEqual([{ user_version: 5 }]);
    expect(database.prepare('SELECT path_identity FROM assets').all()).toEqual([
      { path_identity: 'café.png' },
    ]);
    database.close();
    service.closeAll();
  });

  it('rolls back a failed v2 migration and preserves the v1 version', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Rollback', selectedParentPath: root });
    service.closeAll();
    downgradeLibraryToV1(created.libraryPath, true);

    expectServiceError(() => service.openLibrary(created.libraryPath), 'LIBRARY_CORRUPT');

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(database.pragma('user_version')).toEqual([{ user_version: 1 }]);
    expect(database.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([
      { version: 1 },
    ]);
    database.close();
  });

  it('rejects a corrupt database without leaving the library open', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Corrupt', selectedParentPath: root });
    service.closeAll();
    writeFileSync(path.join(created.libraryPath, '.serpent', 'library.db'), 'not a sqlite database');

    expectServiceError(() => service.openLibrary(created.libraryPath), 'LIBRARY_CORRUPT');
    expect(service.listLibraries()).toEqual([]);
  });

  it('does not repair internal directories before a database passes validation', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Read First', selectedParentPath: root });
    service.closeAll();
    const previewsPath = path.join(created.libraryPath, '.serpent', 'previews');
    rmSync(previewsPath, { recursive: true });
    writeFileSync(path.join(created.libraryPath, '.serpent', 'library.db'), 'not sqlite');

    expectServiceError(() => service.openLibrary(created.libraryPath), 'LIBRARY_CORRUPT');
    expect(existsSync(previewsPath)).toBe(false);
  });

  it('rejects a tampered migration audit record', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Tampered', selectedParentPath: root });
    service.closeAll();
    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    database.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('bad');
    database.close();

    expectServiceError(() => service.openLibrary(created.libraryPath), 'LIBRARY_CORRUPT');
  });

  it('does not leave a partial library when the parent is not writable', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    chmodSync(root, 0o500);
    try {
      expectServiceError(
        () => service.createLibrary({ displayName: 'Denied', selectedParentPath: root }),
        'LIBRARY_NOT_WRITABLE',
      );
      expect(readdirSync(root)).toEqual([]);
    } finally {
      chmodSync(root, 0o700);
    }
  });

  it('reports an unknown close without changing the open set', () => {
    const service = new LibraryService();

    expectServiceError(() => service.closeLibrary('unknown-library'), 'LIBRARY_NOT_OPEN');
    expect(service.listLibraries()).toEqual([]);
  });
});
