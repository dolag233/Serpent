import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  sqliteAllInChunks,
  sqliteRunInChunks,
  withSqliteInPredicate,
} from '../../src/worker/sqlite-in';
import { openConfiguredDatabase } from '../../src/worker/library-service';
import { LibraryService } from '../../src/worker/library-service';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-sqlite-in-test-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('SQLite IN chunking', () => {
  it('returns all rows and keeps every IN statement at or below the bind limit', () => {
    const root = temporaryRoot();
    const sqlParamCounts: number[] = [];
    const database = openConfiguredDatabase(path.join(root, 'rows.db'), 5_000, {
      trace: (sql) => {
        if (sql.includes('IN (')) sqlParamCounts.push((sql.match(/\?/gu) ?? []).length);
      },
    });
    database.exec('CREATE TABLE rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    const insert = database.prepare('INSERT INTO rows (id, value) VALUES (?, ?)');
    database.transaction(() => {
      for (let id = 1; id <= 2_500; id += 1) insert.run(id, `value-${id}`);
    })();

    const ids = Array.from({ length: 2_500 }, (_, index) => index + 1);
    const rows = sqliteAllInChunks<number, { id: number; value: string }>({
      connection: database,
      values: ids,
      buildSql: (placeholders) => `SELECT id, value FROM rows WHERE id IN (${placeholders})`,
    });
    expect(rows).toHaveLength(2_500);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2_500);

    expect(sqliteRunInChunks({
      connection: database,
      values: ids,
      buildSql: (placeholders) => `DELETE FROM rows WHERE id IN (${placeholders})`,
    })).toBe(2_500);
    expect(database.prepare('SELECT COUNT(*) AS count FROM rows').get()).toEqual({ count: 0 });
    expect(sqlParamCounts.length).toBeGreaterThan(1);
    expect(Math.max(...sqlParamCounts)).toBeLessThanOrEqual(900);
    database.close();
  });

  it('keeps a single SELECT under the bind limit for 2500 ids via a TEMP table', () => {
    const root = temporaryRoot();
    const sqlParamCounts: number[] = [];
    const database = openConfiguredDatabase(path.join(root, 'predicate.db'), 5_000, {
      trace: (sql) => {
        if (sql.includes('FROM rows WHERE')) {
          sqlParamCounts.push((sql.match(/\?/gu) ?? []).length);
        }
      },
    });
    database.exec('CREATE TABLE rows (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const insert = database.prepare('INSERT INTO rows (id, value) VALUES (?, ?)');
    const ids = Array.from({ length: 2_500 }, (_, index) => `id-${index + 1}`);
    database.transaction(() => {
      for (const id of ids) insert.run(id, id);
    })();

    const rows = withSqliteInPredicate(
      database,
      'id',
      ids,
      (sql, params) =>
        database.prepare(`SELECT id, value FROM rows WHERE ${sql}`).all(...params) as Array<{
          id: string;
          value: string;
        }>,
    );
    expect(rows).toHaveLength(2_500);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2_500);
    expect(sqlParamCounts.length).toBeGreaterThan(0);
    expect(Math.max(...sqlParamCounts)).toBe(0);
    database.close();
  });

  it('completes a managed import larger than one SQLite IN chunk', () => {
    const root = temporaryRoot();
    const incoming = path.join(root, 'incoming');
    mkdirSync(incoming);
    const sourcePaths: string[] = [];
    for (let index = 0; index < 901; index += 1) {
      const sourcePath = path.join(incoming, `asset-${index}.txt`);
      writeFileSync(sourcePath, `asset-${index}`);
      sourcePaths.push(sourcePath);
    }

    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Large Import', selectedParentPath: root });
    const plan = service.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths,
    });
    const completion = service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });

    expect(completion).toMatchObject({
      importedCount: 901,
      fileCount: 901,
      assetCount: 901,
      skippedCount: 0,
      replacedCount: 0,
    });
    expect(service.refreshManagedAssets(library.libraryId, {
      assetIds: completion.assets.map((asset) => asset.assetId),
      discoverSources: false,
      includeAssets: true,
    })).toMatchObject({ changedCount: 0, missingCount: 0 });
    service.closeAll();
  });
});
