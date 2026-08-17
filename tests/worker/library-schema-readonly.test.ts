// A library written by a newer build must still open writable instead of
// throwing LIBRARY_VERSION_TOO_NEW or trapping the user in a read-only handle.
// SQLITE_READONLY from the OS or an inspection connection still maps to
// LIBRARY_READ_ONLY.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  SUPPORTED_SCHEMA_VERSION,
} from '../../src/worker/library-service';
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


/** Bump a current library to a fake newer schema (structure untouched). */
function markLibraryAsNewerVersion(libraryPath: string): void {
  const db = new Database(path.join(libraryPath, '.serpent', 'library.db'));
  const newerVersion = SUPPORTED_SCHEMA_VERSION + 1;
  db.pragma(`user_version = ${newerVersion}`);
  db.prepare(
    'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
  ).run(newerVersion, 'f'.repeat(64), new Date().toISOString());
  db.close();
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('writable open for newer-schema libraries', () => {
  it('opens a newer-schema library writable with version info', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Newer库', selectedParentPath: root });
    // createLibrary already opened the library; drop the handle so the
    // reopen below exercises the version probe from scratch.
    service.closeAll();
    markLibraryAsNewerVersion(created.libraryPath);

    const summary: InternalLibrarySummary = service.openLibrary(created.libraryPath);
    expect(summary.readOnly).toBeFalsy();
    expect(summary.libraryVersion).toBe(SUPPORTED_SCHEMA_VERSION + 1);
    expect(summary.supportedSchemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);

    service.renameLibrary({
      libraryId: summary.libraryId,
      displayName: 'Newer库已改名',
    });
    expect(service.listLibraries()).toEqual([
      expect.objectContaining({ displayName: 'Newer库已改名' }),
    ]);
  });

  it('keeps filesystem mutations available on a newer-schema library', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: '可写磁盘', selectedParentPath: root });
    const source = path.join(root, 'protected.png');
    writeFileSync(source, Buffer.from('protected asset'));
    const folder = service.createManagedFolder({
      libraryId: created.libraryId,
      name: 'Folder',
    });
    service.prepareOrExecuteImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
      targetFolderId: folder.folderId,
    });
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    service.closeAll();
    markLibraryAsNewerVersion(created.libraryPath);
    const summary = service.openLibrary(created.libraryPath);
    expect(summary.readOnly).toBeFalsy();

    expect(() => service.deleteAssetsFromDisk({
      libraryId: created.libraryId,
      assetIds: [asset.assetId],
    })).not.toThrow();
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })).toHaveLength(0);
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
    expect(summary.readOnly).toBeFalsy();
    const db = new Database(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(() =>
      db
        .prepare('INSERT INTO library (library_id, display_name, created_at) VALUES (?, ?, ?)')
        .run('00000000-0000-0000-0000-000000000000', 'y', 'now'),
    ).not.toThrow();
    db.close();
  });

  it('closes a newer-schema library and opens a different writable library', () => {
    const root = temporaryRoot();
    const service = newService();
    const newerCreated = service.createLibrary({
      displayName: '新 schema 切库源',
      selectedParentPath: root,
    });
    service.closeAll();
    markLibraryAsNewerVersion(newerCreated.libraryPath);

    const newer = service.openLibrary(newerCreated.libraryPath);
    expect(newer.readOnly).toBeFalsy();
    expect(() => service.cancelJobs(newer.libraryId)).not.toThrow();

    const writable = service.createLibrary({
      displayName: '可写切库目标',
      selectedParentPath: root,
    });
    expect(writable.readOnly).toBeFalsy();
    service.closeLibrary(newer.libraryId);
    service.renameLibrary({
      libraryId: writable.libraryId,
      displayName: '可写切库目标已改名',
    });
  });
});
