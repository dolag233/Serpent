import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  LibraryServiceError,
  openConfiguredDatabase,
} from '../../src/worker/library-service';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-security-test-'));
  temporaryRoots.push(root);
  return root;
}

function expectCode(operation: () => unknown, code: LibraryServiceError['code']): void {
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
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('database and path hardening', () => {
  it('rejects a crafted operation id before it can escape the operations directory', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Crafted', selectedParentPath: root });
    service.closeAll();
    const sentinel = path.join(root, 'sentinel.txt');
    writeFileSync(sentinel, 'keep');
    const database = openConfiguredDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    const now = new Date().toISOString();
    database.prepare(
      `INSERT INTO file_operations
         (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
       VALUES (?, 'import', 'applying', ?, NULL, ?, ?)`,
    ).run('../../../sentinel.txt', JSON.stringify({ version: 1, files: [], directories: [] }), now, now);
    database.close();

    expectCode(() => new LibraryService().openLibrary(library.libraryPath), 'LIBRARY_CORRUPT');
    expect(existsSync(sentinel)).toBe(true);
    expect(readFileSync(sentinel, 'utf8')).toBe('keep');
  });

  it('rejects a restore manifest path escape without moving either file', () => {
    const root = temporaryRoot();
    const setup = new LibraryService();
    const library = setup.createLibrary({ displayName: 'Restore Manifest Escape', selectedParentPath: root });
    setup.closeAll();

    const operationId = '33333333-3333-4333-8333-333333333333';
    const assetId = '44444444-4444-4444-8444-444444444444';
    const operationPath = path.join(library.libraryPath, '.serpent', 'operations', operationId);
    mkdirSync(path.join(operationPath, 'backup'), { recursive: true });
    const sentinel = path.join(library.libraryPath, 'sentinel.txt');
    writeFileSync(sentinel, 'keep');
    const database = openConfiguredDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    const now = new Date().toISOString();
    database.prepare(
      `INSERT INTO file_operations
         (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
       VALUES (?, 'restore', 'applying', ?, NULL, ?, ?)`,
    ).run(operationId, JSON.stringify({
      version: 3,
      kind: 'restore',
      files: [{
        assetId,
        backupDestinationRelativePath: null,
        backupName: '0',
        conflictingAssetId: null,
        destinationRelativePath: '../sentinel.txt',
        hadDestination: false,
        trashFilename: 'asset.png',
      }],
    }), now, now);
    database.close();

    expectCode(() => new LibraryService().openLibrary(library.libraryPath), 'LIBRARY_CORRUPT');
    expect(readFileSync(sentinel, 'utf8')).toBe('keep');
    expect(existsSync(path.join(operationPath, 'backup'))).toBe(true);
  });

  it('uses WAL, FULL synchronous mode, and foreign key enforcement', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Pragmas', selectedParentPath: root });
    service.closeAll();
    const database = openConfiguredDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.pragma('synchronous', { simple: true })).toBe(2);
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.pragma('busy_timeout', { simple: true })).toBe(5_000);
    database.close();
  });

  it('rejects an Assets symlink and a symlinked destination ancestor', () => {
    const root = temporaryRoot();
    const external = path.join(root, 'external');
    const source = path.join(root, 'source.png');
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Links', selectedParentPath: root });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Target' });
    rmSync(path.join(library.libraryPath, 'Assets', 'Target'), { recursive: true });
    symlinkSync(external, path.join(library.libraryPath, 'Assets', 'Target'));
    writeFileSync(source, 'source');
    expectCode(
      () => service.prepareImport({ libraryId: library.libraryId, targetFolderId: folder.folderId, sourceKind: 'files', sourcePaths: [source] }),
      'INVALID_LIBRARY_PATH',
    );
    service.closeAll();

    rmSync(path.join(library.libraryPath, 'Assets'), { recursive: true });
    symlinkSync(external, path.join(library.libraryPath, 'Assets'));
    expectCode(() => new LibraryService().openLibrary(library.libraryPath), 'NOT_A_LIBRARY');
  });

  it('rejects a symlinked operations root without reading or deleting the victim directory', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Operations Link', selectedParentPath: root });
    service.closeAll();
    const victim = path.join(root, 'victim');
    mkdirSync(victim);
    writeFileSync(path.join(victim, 'do-not-delete.txt'), 'keep');
    symlinkSync(victim, path.join(library.libraryPath, '.serpent', 'operations'));

    expectCode(() => new LibraryService().openLibrary(library.libraryPath), 'LIBRARY_CORRUPT');
    expect(readFileSync(path.join(victim, 'do-not-delete.txt'), 'utf8')).toBe('keep');
  });

  it('rejects symlinked .serpent metadata and library.db files', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Metadata Links', selectedParentPath: root });
    service.closeAll();
    const database = path.join(library.libraryPath, '.serpent', 'library.db');
    const databaseBackup = path.join(root, 'library-backup.db');
    copyFileSync(database, databaseBackup);
    rmSync(database);
    symlinkSync(databaseBackup, database);
    expectCode(() => new LibraryService().openLibrary(library.libraryPath), 'NOT_A_LIBRARY');

    rmSync(path.join(library.libraryPath, '.serpent'), { recursive: true });
    const metadataVictim = path.join(root, 'metadata-victim');
    mkdirSync(metadataVictim);
    copyFileSync(databaseBackup, path.join(metadataVictim, 'library.db'));
    symlinkSync(metadataVictim, path.join(library.libraryPath, '.serpent'));
    expectCode(() => new LibraryService().openLibrary(library.libraryPath), 'NOT_A_LIBRARY');
  });

  it('preserves the only backup and marks the operation failed when rollback restoration fails', () => {
    const root = temporaryRoot();
    const originalDir = path.join(root, 'original');
    const incomingDir = path.join(root, 'incoming');
    rmSync(originalDir, { force: true, recursive: true });
    rmSync(incomingDir, { force: true, recursive: true });
    const setup = new LibraryService();
    const library = setup.createLibrary({ displayName: 'Rollback Failure', selectedParentPath: root });
    writeFileSync(path.join(root, 'same.png'), 'old');
    const first = setup.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [path.join(root, 'same.png')] });
    setup.resolveImport({ importId: first.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' });
    setup.closeAll();
    writeFileSync(path.join(root, 'same.png'), 'incoming content');

    const failing = new LibraryService({ failAt: ['after-place', 'rollback-restore'] });
    const opened = failing.openLibrary(library.libraryPath);
    const plan = failing.prepareImport({ libraryId: opened.libraryId, sourceKind: 'files', sourcePaths: [path.join(root, 'same.png')] });
    expectCode(
      () => failing.resolveImport({ importId: plan.importId, suspectedDuplicate: 'merge', nameConflict: 'replace' }),
      'IMPORT_APPLY_FAILED',
    );
    const operationPath = path.join(opened.libraryPath, '.serpent', 'operations', plan.importId);
    expect(existsSync(path.join(operationPath, 'backup', '0'))).toBe(true);
    failing.closeAll();
    const database = openConfiguredDatabase(path.join(opened.libraryPath, '.serpent', 'library.db'));
    expect(database.prepare('SELECT status FROM file_operations WHERE operation_id = ?').get(plan.importId)).toEqual({ status: 'failed' });
    database.close();
    expect(existsSync(operationPath)).toBe(true);
    expectCode(
      () => new LibraryService({ failAt: 'recovery-restore' }).openLibrary(opened.libraryPath),
      'LIBRARY_CORRUPT',
    );
    expect(existsSync(path.join(operationPath, 'backup', '0'))).toBe(true);
    const reopened = new LibraryService();
    const recoveredLibrary = reopened.openLibrary(opened.libraryPath);
    expect(readFileSync(path.join(recoveredLibrary.libraryPath, 'Assets', 'same.png'), 'utf8')).toBe('old');
    expect(existsSync(operationPath)).toBe(false);
    reopened.closeAll();
  });

  it('leaves an applying operation intact when recovery itself fails, then retries safely', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'same.png');
    writeFileSync(source, 'old');
    const setup = new LibraryService();
    const library = setup.createLibrary({ displayName: 'Recovery Failure', selectedParentPath: root });
    const first = setup.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });
    setup.resolveImport({ importId: first.importId, suspectedDuplicate: 'skip', nameConflict: 'keep-both' });
    setup.closeAll();
    writeFileSync(source, 'incoming content');

    const crashing = new LibraryService({ failAt: 'crash-after-place' });
    const opened = crashing.openLibrary(library.libraryPath);
    const plan = crashing.prepareImport({ libraryId: opened.libraryId, sourceKind: 'files', sourcePaths: [source] });
    expectCode(
      () => crashing.resolveImport({ importId: plan.importId, suspectedDuplicate: 'merge', nameConflict: 'replace' }),
      'IMPORT_APPLY_FAILED',
    );
    crashing.closeAll();
    const operationPath = path.join(opened.libraryPath, '.serpent', 'operations', plan.importId);
    expectCode(
      () => new LibraryService({ failAt: 'recovery-restore' }).openLibrary(opened.libraryPath),
      'LIBRARY_CORRUPT',
    );
    expect(existsSync(path.join(operationPath, 'backup', '0'))).toBe(true);

    const recovered = new LibraryService();
    const reopened = recovered.openLibrary(opened.libraryPath);
    expect(readFileSync(path.join(reopened.libraryPath, 'Assets', 'same.png'), 'utf8')).toBe('old');
    recovered.closeAll();
  });
});
