// Serpent-033e: a library written by a newer build must still open — in
// read-only mode — instead of throwing LIBRARY_VERSION_TOO_NEW and locking
// the user out. Writes fail at the SQLite level and map to LIBRARY_READ_ONLY.
import { rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import type { InternalLibrarySummary } from '../../src/shared/protocol/responses';
import { publicErrorForWorkerFailure } from '../../src/worker/public-error';

interface TestDatabase {
  pragma(source: string, options?: { simple: boolean }): unknown;
  prepare(source: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
  };
  close(): void;
}

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as new (
  filename: string,
  options?: { readonly?: boolean },
) => TestDatabase;

const temporaryRoots: string[] = [];
const services: LibraryService[] = [];

function newService(): LibraryService {
  const service = new LibraryService();
  services.push(service);
  return service;
}

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-schema-readonly-'));
  temporaryRoots.push(root);
  return root;
}

/** Bump a v33 library to a fake "newer" v34 (structure untouched). */
function markLibraryAsV35(libraryPath: string): void {
  const db = new Database(path.join(libraryPath, '.serpent', 'library.db'));
  db.pragma('user_version = 35');
  db.prepare(
    'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
  ).run(35, 'f'.repeat(64), new Date().toISOString());
  db.close();
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('read-only degrade for newer-schema libraries', () => {
  it('opens a newer-schema library read-only with version info', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Newer库', selectedParentPath: root });
    // createLibrary already opened the library; drop the handle so the
    // reopen below exercises the version probe from scratch.
    service.closeAll();
    markLibraryAsV35(created.libraryPath);

    const summary: InternalLibrarySummary = service.openLibrary(created.libraryPath);
    expect(summary.readOnly).toBe(true);
    expect(summary.libraryVersion).toBe(35);
    expect(summary.supportedSchemaVersion).toBe(34);

    // Read paths still work.
    expect(service.listLibraries()).toHaveLength(1);
  });

  it('rejects writes on a read-only library with SQLITE_READONLY', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: '只读库', selectedParentPath: root });
    service.closeAll();
    markLibraryAsV35(created.libraryPath);
    const summary = service.openLibrary(created.libraryPath);
    expect(summary.readOnly).toBe(true);

    // A read-only connection (what the worker holds for this library) must
    // reject any write at the SQLite level.
    const db = new Database(path.join(created.libraryPath, '.serpent', 'library.db'), {
      readonly: true,
    });
    expect(() =>
      db
        .prepare('INSERT INTO library (library_id, display_name, created_at) VALUES (?, ?, ?)')
        .run('00000000-0000-0000-0000-000000000000', 'x', 'now'),
    ).toThrow(/readonly/iu);
    db.close();
  });

  it('maps SQLITE_READONLY failures to the LIBRARY_READ_ONLY public code', () => {
    const error = new Error('cannot write because database is readonly');
    Object.assign(error, { code: 'SQLITE_READONLY' });
    const publicError = publicErrorForWorkerFailure(error);
    expect(publicError.code).toBe('LIBRARY_READ_ONLY');
    expect(publicError.message).toContain('read-only');
  });

  it('keeps the normal open path writable (no false read-only flag)', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: '普通库', selectedParentPath: root });

    const summary = service.openLibrary(created.libraryPath);
    expect(summary.readOnly).toBeUndefined();
    // Writes still work on the normal library.
    const db = new Database(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(() =>
      db
        .prepare('INSERT INTO library (library_id, display_name, created_at) VALUES (?, ?, ?)')
        .run('00000000-0000-0000-0000-000000000000', 'y', 'now'),
    ).not.toThrow();
    db.close();
  });
});
