// Serpent-verg.1: lenient-read infrastructure — column probing with a
// per-connection cache, whitelist intersection and degraded defaults.
import { rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import {
  columnsFor,
  degradedDefaults,
  hasTable,
  invalidateColumnProbe,
  missingColumns,
  resetColumnProbe,
  selectColumns,
} from '../../src/worker/lenient-columns';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as new (filename: string) => {
  exec(sql: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
  };
  close(): void;
};

const temporaryRoots: string[] = [];

function temporaryDatabase(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-lenient-'));
  temporaryRoots.push(root);
  return path.join(root, 'schema.db');
}

function createAssetsTable(db: { exec(sql: string): void }, extra: string[] = []): void {
  const columns = ['asset_id TEXT PRIMARY KEY', 'relative_file_path TEXT', ...extra];
  db.exec(`CREATE TABLE assets (${columns.join(', ')})`);
}

afterEach(() => {
  resetColumnProbe();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('selectColumns / missingColumns', () => {
  it('returns only the whitelist columns that exist, in wanted order', () => {
    const db = new Database(temporaryDatabase());
    createAssetsTable(db, ['byte_size INTEGER']);
    const wanted = ['asset_id', 'byte_size', 'display_name', 'width'];
    expect(selectColumns(db, 'assets', wanted)).toEqual(['asset_id', 'byte_size']);
    expect(missingColumns(db, 'assets', wanted)).toEqual(['display_name', 'width']);
    db.close();
  });

  it('returns an empty set for a missing table instead of throwing', () => {
    const db = new Database(temporaryDatabase());
    expect(columnsFor(db, 'no_such_table')).toEqual(new Set());
    expect(selectColumns(db, 'no_such_table', ['a', 'b'])).toEqual([]);
    db.close();
  });

  it('caches per table: a second probe does not re-run PRAGMA', () => {
    const db = new Database(temporaryDatabase());
    createAssetsTable(db);
    const original = db.pragma.bind(db);
    let pragmaCalls = 0;
    db.pragma = ((source: string) => {
      pragmaCalls += 1;
      return original(source);
    }) as typeof db.pragma;

    selectColumns(db, 'assets', ['asset_id']);
    selectColumns(db, 'assets', ['asset_id', 'relative_file_path']);
    expect(pragmaCalls).toBe(1);

    // A different table is probed separately.
    selectColumns(db, 'other', ['x']);
    expect(pragmaCalls).toBe(2);
    db.close();
  });

  it('re-probes after invalidateColumnProbe (migration mutates schema)', () => {
    const db = new Database(temporaryDatabase());
    createAssetsTable(db);
    expect(selectColumns(db, 'assets', ['byte_size'])).toEqual([]);

    db.prepare('ALTER TABLE assets ADD COLUMN byte_size INTEGER').run();
    invalidateColumnProbe(db);
    expect(selectColumns(db, 'assets', ['byte_size'])).toEqual(['byte_size']);
    db.close();
  });

  it('keeps per-connection caches isolated', () => {
    const dbA = new Database(temporaryDatabase());
    const dbB = new Database(temporaryDatabase());
    createAssetsTable(dbA, ['byte_size INTEGER']);
    createAssetsTable(dbB);

    expect(selectColumns(dbA, 'assets', ['byte_size'])).toEqual(['byte_size']);
    expect(selectColumns(dbB, 'assets', ['byte_size'])).toEqual([]);
    dbA.close();
    dbB.close();
  });
});

describe('hasTable', () => {
  it('detects existing and missing tables, cached', () => {
    const db = new Database(temporaryDatabase());
    createAssetsTable(db);
    expect(hasTable(db, 'assets')).toBe(true);
    expect(hasTable(db, 'collections')).toBe(false);
    // Cache hit: no sqlite_master query for the repeated probe.
    expect(hasTable(db, 'assets')).toBe(true);

    db.prepare('CREATE TABLE collections (collection_id TEXT PRIMARY KEY)').run();
    invalidateColumnProbe(db);
    expect(hasTable(db, 'collections')).toBe(true);
    db.close();
  });
});

describe('degradedDefaults', () => {
  it('fills whitelisted defaults for known columns and null otherwise', () => {
    expect(degradedDefaults('assets', ['byte_size', 'display_name', 'width', 'custom_col'])).toEqual({
      byte_size: null,
      display_name: null,
      width: null,
      custom_col: null,
    });
  });

  it('uses the non-null degraded default where defined (revision_artifacts.kind)', () => {
    expect(degradedDefaults('revision_artifacts', ['kind', 'status'])).toEqual({
      kind: '',
      status: '',
    });
  });

  it('returns an empty fill object when nothing is missing', () => {
    expect(degradedDefaults('assets', [])).toEqual({});
  });
});
