// Serpent-verg review fix: the folder panel read paths (folder counts,
// cover artifacts, explicit-folder-ignored checks) must keep working on an
// older library whose auxiliary tables or artifact columns are missing.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(sql: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): {
    get(...parameters: unknown[]): unknown;
    all(...parameters: unknown[]): unknown;
  };
}

const TestDatabase = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-lenient-folder-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function libraryWithFolderAndAsset(root: string, displayName: string): {
  service: LibraryService;
  libraryId: string;
  folderId: string;
  libraryPath: string;
} {
  const service = new LibraryService();
  const library = service.createLibrary({ displayName, selectedParentPath: root });
  const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Folder' });
  const fixture = path.join(root, 'sample.png');
  writeFileSync(fixture, VALID_1X1_PNG);
  const imported = service.prepareOrExecuteImport({
    libraryId: library.libraryId,
    targetFolderId: folder.folderId,
    sourceKind: 'files',
    sourcePaths: [fixture],
  });
  if ('importId' in imported) throw new Error('unexpected conflict plan');
  return {
    service,
    libraryId: library.libraryId,
    folderId: folder.folderId,
    libraryPath: library.libraryPath,
  };
}

function dropTablesAndReopen(
  service: LibraryService,
  libraryPath: string,
  tables: string[],
  dropArtifactColumns: string[] = [],
): void {
  const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
  for (const table of tables) db.exec(`DROP TABLE ${table}`);
  if (dropArtifactColumns.length > 0) {
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'revision_artifacts' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as Array<{ name: string }>;
    for (const index of indexes) db.exec(`DROP INDEX ${index.name}`);
    for (const column of dropArtifactColumns) {
      db.exec(`ALTER TABLE revision_artifacts DROP COLUMN ${column}`);
    }
  }
  db.close();
  service.closeAll();
  service.openLibrary(libraryPath);
}

describe('folder panel lenient read (Serpent-verg review fix)', () => {
  it('folder counts and covers survive missing ignore/sequence tables', () => {
    const root = temporaryRoot();
    const { service, libraryId, folderId, libraryPath } = libraryWithFolderAndAsset(
      root,
      'FolderNoIgnore',
    );
    dropTablesAndReopen(service, libraryPath, [
      'linked_ignored_assets',
      'asset_sequence_frames',
      'explicit_ignored_paths',
      'gitignore_ignored_paths',
    ]);

    // The folder panel readers (listFolderBrowseEntries internally runs the
    // count and cover queries) must not throw on the degraded schema, and
    // the direct asset count still resolves.
    // listFolderBrowseEntries internally runs the count and cover queries.
    const entries = service.listFolderBrowseEntries({ libraryId, parentFolderId: folderId });
    expect(entries).toEqual([]);
    const rootEntries = service.listFolderBrowseEntries({ libraryId, parentFolderId: null });
    expect(rootEntries.some((entry) => entry.folderId === folderId)).toBe(true);
    service.closeAll();
  });

  it('folder cover artifacts degrade when the artifact status column is missing', () => {
    const root = temporaryRoot();
    const { service, libraryId, folderId, libraryPath } = libraryWithFolderAndAsset(
      root,
      'FolderNoStatus',
    );
    dropTablesAndReopen(service, libraryPath, [], ['status', 'width']);

    expect(() =>
      service.listFolderBrowseEntries({ libraryId, parentFolderId: folderId }),
    ).not.toThrow();
    const rootEntries = service.listFolderBrowseEntries({ libraryId, parentFolderId: null });
    expect(rootEntries.some((entry) => entry.folderId === folderId)).toBe(true);
    service.closeAll();
  });
});
