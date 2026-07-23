import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
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

function downgradeLibraryToV1(libraryPath: string, createMigrationBlocker = false): void {
  const database = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
  database.exec(`
    -- Reverse v6: drop FTS5 tables and triggers.
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
    -- Reverse v8: drop ai_content.
    DROP TABLE IF EXISTS ai_content;
    DROP INDEX IF EXISTS ai_content_asset_field;
    -- Reverse v9: drop revision_artifacts + jobs.
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
    -- Reverse v6: drop FTS5 tables and triggers.
    DROP TABLE IF EXISTS asset_search;
    DROP TABLE IF EXISTS asset_search_index;
    DROP TRIGGER IF EXISTS asset_search_index_ai;
    DROP TRIGGER IF EXISTS asset_search_index_ad;
    DROP TRIGGER IF EXISTS asset_search_index_au;
    DROP INDEX IF EXISTS smart_collections_library_name_unique;
    -- Reverse v5: drop organization tables (tags, collections, metadata).
    DROP TABLE IF EXISTS collection_assets;
    DROP TABLE IF EXISTS collections;
    DROP TABLE IF EXISTS smart_collections;
    DROP TABLE IF EXISTS human_asset_tags;
    DROP TABLE IF EXISTS ai_asset_tags;
    -- Reverse v8: drop ai_content.
    DROP TABLE IF EXISTS ai_content;
    DROP INDEX IF EXISTS ai_content_asset_field;
    -- Reverse v9: drop revision_artifacts + jobs.
    DROP TABLE IF EXISTS linked_ignored_assets;
    DROP TABLE IF EXISTS linked_folder_rules;
    DROP TABLE IF EXISTS trashed_managed_folders;
    DROP INDEX IF EXISTS trashed_managed_folders_trashed_at_idx;
    DROP TABLE IF EXISTS revision_artifacts;
    DROP TABLE IF EXISTS jobs;
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
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('LibraryService lifecycle', () => {
  it('creates a self-contained library and exposes it exactly once', () => {
    const root = temporaryRoot();
    const service = newService();

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
    expect(database.pragma('user_version')).toEqual([{ user_version: 20 }]);
    database.close();

    expect(service.openLibrary(created.libraryPath)).toEqual(created);
    expect(service.listLibraries()).toEqual([created]);
    service.closeAll();
  });

  it('migrates v13 Label data to v14 without changing unrelated metadata', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Retire Label', selectedParentPath: root });
    const sourcePath = path.join(root, 'legacy.png');
    writeFileSync(sourcePath, 'legacy image');
    const imported = service.prepareOrExecuteImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [sourcePath],
    });
    if ('importId' in imported) throw new Error('Unexpected import conflict.');
    const assetId = imported.assets[0]!.assetId;
    service.setAssetMetadata({
      libraryId: created.libraryId,
      assetId,
      expectedVersion: 0,
      description: 'Description survives',
      rating: 4,
      favorite: true,
    });
    service.writeAiAnalysisResult({
      libraryId: created.libraryId,
      assetId,
      description: 'AI description survives',
      tags: ['surviving-tag'],
      modelId: 'migration-test',
      modelVersion: 'v1',
      enabledFields: { description: true, tags: true, rating: false },
    });
    service.createSmartCollection({
      libraryId: created.libraryId,
      name: 'Filename Query',
      queryDefinitionJson: JSON.stringify({
        search: { clauses: [{ field: 'filename', values: ['legacy.png'], exclude: false }] },
      }),
    });
    service.closeAll();

    const databasePath = path.join(created.libraryPath, '.serpent', 'library.db');
    const database = new TestDatabase(databasePath);
    database.exec(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE asset_metadata_v13 (
        asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
        label TEXT,
        description TEXT,
        rating INTEGER NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
        favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
        palette TEXT,
        source_page_url TEXT,
        entity_version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      INSERT INTO asset_metadata_v13
        SELECT asset_id, 'Legacy Alias', description, rating, favorite, palette,
               source_page_url, entity_version, updated_at
          FROM asset_metadata;
      DROP TABLE asset_metadata;
      ALTER TABLE asset_metadata_v13 RENAME TO asset_metadata;

      CREATE TABLE ai_content_v13 (
        ai_content_id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
        revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
        field_name TEXT NOT NULL CHECK (field_name IN ('label', 'description', 'structured_metadata')),
        value TEXT NOT NULL,
        model_id TEXT NOT NULL,
        model_version TEXT NOT NULL,
        generated_at TEXT NOT NULL
      );
      INSERT INTO ai_content_v13 SELECT * FROM ai_content;
      DROP TABLE ai_content;
      ALTER TABLE ai_content_v13 RENAME TO ai_content;
      CREATE INDEX ai_content_asset_field ON ai_content(asset_id, field_name);

      DROP TRIGGER IF EXISTS asset_search_index_ai;
      DROP TRIGGER IF EXISTS asset_search_index_ad;
      DROP TRIGGER IF EXISTS asset_search_index_au;
      DROP TABLE asset_search;
      DROP TABLE IF EXISTS trashed_managed_folders;
      DROP INDEX IF EXISTS trashed_managed_folders_trashed_at_idx;
      CREATE TABLE asset_search_index_v13 (
        asset_id TEXT UNIQUE NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
        label TEXT NOT NULL DEFAULT '',
        filename TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        folder_path TEXT NOT NULL DEFAULT '',
        metadata_text TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO asset_search_index_v13
        SELECT asset_id, 'Legacy Alias', filename, tags, description, source_url,
               folder_path, metadata_text
          FROM asset_search_index;
      DROP TABLE asset_search_index;
      ALTER TABLE asset_search_index_v13 RENAME TO asset_search_index;
      CREATE VIRTUAL TABLE asset_search USING fts5(
        label, filename, tags, description, source_url, folder_path, metadata_text,
        content='asset_search_index'
      );
      INSERT INTO asset_search(asset_search) VALUES('rebuild');

      DELETE FROM schema_migrations WHERE version >= 14;
      PRAGMA user_version = 13;
    `);
    database.prepare(
      `INSERT INTO ai_content
         (ai_content_id, asset_id, revision_id, field_name, value,
          model_id, model_version, generated_at)
       SELECT ?, asset_id, current_revision_id, 'label', 'AI Legacy Alias',
              'migration-test', 'v1', ?
         FROM assets WHERE asset_id = ?`,
    ).run(randomUUID(), new Date().toISOString(), assetId);
    database.prepare(
      `INSERT INTO smart_collections
         (collection_id, library_id, name, query_definition_json, position,
          created_at, updated_at)
       VALUES (?, ?, 'Legacy Label Query', ?, 0, ?, ?)`,
    ).run(
      randomUUID(),
      created.libraryId,
      JSON.stringify({
        search: { clauses: [{ field: 'label', values: ['Legacy Alias'], exclude: false }] },
      }),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    database.close();

    const migratedService = newService();
    migratedService.openLibrary(created.libraryPath);
    const metadata = migratedService.getAssetMetadata({ libraryId: created.libraryId, assetId });
    expect(metadata).toMatchObject({
      description: 'Description survives',
      rating: 4,
      favorite: true,
    });
    expect(migratedService.getAiContent(created.libraryId, assetId)).toEqual([
      expect.objectContaining({ fieldName: 'description', value: 'AI description survives' }),
    ]);
    expect(migratedService.listSmartCollections(created.libraryId).map((item) => item.name))
      .toEqual(['Filename Query']);
    expect(migratedService.searchAssets({
      libraryId: created.libraryId,
      query: { clauses: [{ field: null, values: ['Legacy Alias'], exclude: false }] },
    }).total).toBe(0);
    expect(migratedService.searchAssets({
      libraryId: created.libraryId,
      query: { clauses: [{ field: 'description', values: ['survives'], exclude: false }] },
    }).items.map((asset) => asset.assetId)).toEqual([assetId]);
    expect(migratedService.searchAssets({
      libraryId: created.libraryId,
      query: { clauses: [{ field: 'description', values: ['AI description'], exclude: false }] },
    }).items.map((asset) => asset.assetId)).toEqual([assetId]);
    migratedService.closeAll();

    const migratedDatabase = new TestDatabase(databasePath);
    expect(migratedDatabase.pragma('user_version')).toEqual([{ user_version: 20 }]);
    expect(migratedDatabase.prepare("PRAGMA table_info('asset_metadata')").all())
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'label' })]));
    expect(migratedDatabase.prepare("PRAGMA table_info('asset_search_index')").all())
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'label' })]));
    migratedDatabase.close();
  });

  it('closes, moves, and reopens a library without changing its identity', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
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
    const first = newService();
    const created = first.createLibrary({
      displayName: 'Existing',
      selectedParentPath: root,
    });
    first.closeAll();

    const second = newService();
    expectServiceError(
      () => second.createLibrary({ displayName: 'Existing', selectedParentPath: root }),
      'LIBRARY_ALREADY_EXISTS',
    );
    expect(readdirSync(root).sort()).toEqual([path.basename(created.libraryPath)]);
  });

  it('rejects folders that are missing a required library location', () => {
    const root = temporaryRoot();
    const service = newService();

    expectServiceError(() => service.openLibrary(root), 'NOT_A_LIBRARY');
  });

  it('rejects a missing database as a non-library', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'No Database', selectedParentPath: root });
    service.closeAll();
    rmSync(path.join(created.libraryPath, '.serpent', 'library.db'));

    expectServiceError(() => service.openLibrary(created.libraryPath), 'NOT_A_LIBRARY');
  });

  it('rejects a library whose required Assets directory was removed', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Missing Assets', selectedParentPath: root });
    service.closeAll();
    rmSync(path.join(created.libraryPath, 'Assets'), { recursive: true });

    expectServiceError(() => service.openLibrary(created.libraryPath), 'NOT_A_LIBRARY');
  });

  it('rejects a database created by a newer schema version', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
    const created = service.createLibrary({ displayName: 'Migration', selectedParentPath: root });
    service.closeAll();
    downgradeLibraryToV1(created.libraryPath);

    service.openLibrary(created.libraryPath);

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(database.pragma('user_version')).toEqual([{ user_version: 20 }]);
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
    const service = newService();
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
    expect(database.pragma('user_version')).toEqual([{ user_version: 20 }]);
    expect(database.prepare('SELECT path_identity FROM assets').all()).toEqual([
      { path_identity: 'café.png' },
    ]);
    database.close();
    service.closeAll();
  });

  it('rolls back a failed v2 migration and preserves the v1 version', () => {
    const root = temporaryRoot();
    const service = newService();
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

  it('does not commit a table-rebuild migration when foreign keys are corrupt', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Foreign Key Rollback', selectedParentPath: root });
    service.closeAll();
    downgradeLibraryToV2(created.libraryPath);

    const before = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    before.pragma('foreign_keys = OFF');
    before.prepare(
      `INSERT INTO revisions
         (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
          original_filename, origin, accepted_at)
       VALUES (?, ?, NULL, 1, ?, 'orphan.png', 'import', ?)`,
    ).run(randomUUID(), randomUUID(), new Date().toISOString(), new Date().toISOString());
    before.close();

    expectServiceError(() => service.openLibrary(created.libraryPath), 'LIBRARY_CORRUPT');

    const after = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(after.pragma('user_version')).toEqual([{ user_version: 3 }]);
    expect(after.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
    ]);
    expect(after.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'linked_folders'").all()).toEqual([]);
    after.close();
  });

  it('rejects a corrupt database without leaving the library open', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Corrupt', selectedParentPath: root });
    service.closeAll();
    writeFileSync(path.join(created.libraryPath, '.serpent', 'library.db'), 'not a sqlite database');

    expectServiceError(() => service.openLibrary(created.libraryPath), 'LIBRARY_CORRUPT');
    expect(service.listLibraries()).toEqual([]);
  });

  it('does not repair internal directories before a database passes validation', () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
    const created = service.createLibrary({ displayName: 'Tampered', selectedParentPath: root });
    service.closeAll();
    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    database.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('bad');
    database.close();

    expectServiceError(() => service.openLibrary(created.libraryPath), 'LIBRARY_CORRUPT');
  });

  it.runIf(process.platform !== 'win32')(
    'does not leave a partial library when the parent is not writable',
    () => {
      // POSIX-only: chmod actually revokes the owner's write permission here.
      // On Windows chmod only toggles the read-only attribute, accessSync(W_OK)
      // still reports the owner-writable directory as writable, and mkdirSync
      // succeeds regardless — so a non-writable parent cannot be constructed
      // this way (it would require ACL/icacls manipulation). createLibrary's
      // writability probe + partial cleanup are exercised on POSIX.
      const root = temporaryRoot();
      const service = newService();
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
    },
  );

  it('reports an unknown close without changing the open set', () => {
    const service = newService();

    expectServiceError(() => service.closeLibrary('unknown-library'), 'LIBRARY_NOT_OPEN');
    expect(service.listLibraries()).toEqual([]);
  });

  it('deletes an open library root from disk and leaves linked sources (Serpent-9i8)', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({
      displayName: 'Delete Me',
      selectedParentPath: root,
    });

    const assetPath = path.join(root, 'photo.png');
    writeFileSync(assetPath, Buffer.alloc(64));
    service.prepareOrExecuteImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [assetPath],
    });

    const linkedRoot = path.join(root, 'linked-source');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'outside.png'), 'keep');
    service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: linkedRoot,
      displayName: 'Linked',
    });

    const libraryPath = created.libraryPath;
    expect(existsSync(libraryPath)).toBe(true);

    const deleted = service.deleteLibraryFromDisk(created.libraryId);
    expect(deleted.libraryId).toBe(created.libraryId);
    expect(deleted.libraryPath).toBe(libraryPath);
    expect(existsSync(libraryPath)).toBe(false);
    expect(existsSync(path.join(linkedRoot, 'outside.png'))).toBe(true);
    expectServiceError(() => service.closeLibrary(created.libraryId), 'LIBRARY_NOT_OPEN');
    expectServiceError(() => service.openLibrary(libraryPath), 'LIBRARY_NOT_FOUND');
  });
});
