// Serpent-verg.2: the search main query (searchAssets) must keep working on
// an older library whose whitelisted columns or auxiliary tables are
// missing — degraded defaults and conditional joins/subqueries instead of
// failing (0031 §1).
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
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-lenient-search-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function libraryWithOneAsset(root: string, displayName: string): {
  service: LibraryService;
  libraryId: string;
  libraryPath: string;
} {
  const service = new LibraryService();
  const library = service.createLibrary({ displayName, selectedParentPath: root });
  const fixture = path.join(root, 'sample.png');
  writeFileSync(fixture, VALID_1X1_PNG);
  const imported = service.prepareOrExecuteImport({
    libraryId: library.libraryId,
    sourceKind: 'files',
    sourcePaths: [fixture],
  });
  if ('importId' in imported) throw new Error('unexpected conflict plan');
  return { service, libraryId: library.libraryId, libraryPath: library.libraryPath };
}

/** Drop whitelisted columns / auxiliary tables to simulate an older library. */
function mutateSchema(
  dbPath: string,
  drops: Array<[string, string[]]>,
  dropTables: string[] = [],
): void {
  const db = new TestDatabase(dbPath);
  for (const [table, columns] of drops) {
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'",
      )
      .all(table) as Array<{ name: string }>;
    for (const index of indexes) db.exec(`DROP INDEX ${index.name}`);
    for (const column of columns) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
  for (const table of dropTables) db.exec(`DROP TABLE ${table}`);
  db.close();
}

function reopenAfterMutating(
  service: LibraryService,
  libraryPath: string,
  drops: Array<[string, string[]]>,
  dropTables: string[] = [],
): void {
  mutateSchema(path.join(libraryPath, '.serpent', 'library.db'), drops, dropTables);
  service.closeAll();
  service.openLibrary(libraryPath);
}

describe('searchAssets lenient read (Serpent-verg.2)', () => {
  it('returns assets on a current library (baseline)', () => {
    const root = temporaryRoot();
    const { service, libraryId } = libraryWithOneAsset(root, 'SearchBaseline');
    const result = service.searchAssets({ libraryId, limit: 50, offset: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.relativeFilePath).toBe('sample.png');
    expect(result.total).toBe(1);
    service.closeAll();
  });

  it('searches and sorts with degraded defaults when columns are missing', () => {
    const root = temporaryRoot();
    const { service, libraryId, libraryPath } = libraryWithOneAsset(root, 'SearchDegraded');
    reopenAfterMutating(service, libraryPath, [
      ['revision_artifacts', ['status', 'width', 'height', 'duration_ms', 'dominant_hue', 'dominant_lightness']],
      ['asset_metadata', ['rating', 'favorite', 'author']],
      ['revisions', ['byte_size', 'modified_at']],
      ['assets', ['trashed_from_relative_path', 'trashed_from_tombstone_id']],
    ]);

    // Plain browse.
    const plain = service.searchAssets({ libraryId, limit: 50, offset: 0 });
    expect(plain.items).toHaveLength(1);
    expect(plain.items[0]!.byteSize).toBe(0);
    expect(plain.items[0]!.favorite).toBe(false);

    // Sort by columns that no longer exist degrades to name sort.
    const sorted = service.searchAssets({
      libraryId,
      limit: 50,
      offset: 0,
      sort: { field: 'rating', order: 'desc' },
    });
    expect(sorted.items).toHaveLength(1);
    expect(sorted.items[0]!.assetId).toBe(plain.items[0]!.assetId);

    // Keyword query still works through the contextual substring path.
    const searched = service.searchAssets({
      libraryId,
      limit: 50,
      offset: 0,
      query: { clauses: [{ field: 'filename', values: ['sample'], exclude: false }] },
    });
    expect(searched.items).toHaveLength(1);
    service.closeAll();
  });

  it('browses and searches when auxiliary tables are missing', () => {
    const root = temporaryRoot();
    const { service, libraryId, libraryPath } = libraryWithOneAsset(root, 'SearchNoTables');
    // linked_ignored_assets and asset_sequence_frames postdate the earliest
    // schemas; asset_search_index/asset_search are the FTS tables.
    reopenAfterMutating(
      service,
      libraryPath,
      [],
      ['linked_ignored_assets', 'asset_sequence_frames', 'asset_search_index', 'asset_search'],
    );

    const result = service.searchAssets({ libraryId, limit: 50, offset: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);

    const searched = service.searchAssets({
      libraryId,
      limit: 50,
      offset: 0,
      query: { clauses: [{ field: 'filename', values: ['sample'], exclude: false }] },
    });
    expect(searched.items).toHaveLength(1);
    service.closeAll();
  });
});
