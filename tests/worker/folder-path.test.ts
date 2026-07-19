import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import type { LibraryServiceError } from '../../src/worker/library-service';

const roots: string[] = [];

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
const TestDatabase = require('better-sqlite3') as new (filename: string) => {
  close(): void;
  prepare(source: string): {
    run(...parameters: unknown[]): unknown;
  };
};

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), 'serpent-folder-path-'));
  roots.push(value);
  return value;
}

function expectCode(
  run: () => unknown,
  code: LibraryServiceError['code'],
) {
  expect(run).toThrowError(expect.objectContaining({ code }));
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const value of roots.splice(0)) rmSync(value, { force: true, recursive: true });
});

describe('resolveFolderPath (REQ-MENU-006)', () => {
  it('resolves a managed folder to the library Assets root plus its relative path', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({ displayName: 'FolderPath', selectedParentPath: temp });
    const top = service.createManagedFolder({ libraryId: library.libraryId, name: 'a' });
    const nested = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'b',
      parentFolderId: top.folderId,
    });

    const assetsRoot = path.join(library.libraryPath, 'Assets');
    expect(service.resolveFolderPath(library.libraryId, top.folderId)).toBe(path.join(assetsRoot, 'a'));
    expect(service.resolveFolderPath(library.libraryId, nested.folderId)).toBe(path.join(assetsRoot, 'a', 'b'));
    service.closeAll();
  });

  it('rejects a managed folder whose directory is missing on disk', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({ displayName: 'FolderPath', selectedParentPath: temp });
    const folder = service.createManagedFolder({ libraryId: library.libraryId, name: 'gone' });

    // External deletion not yet reconciled by a refresh: the shell action must
    // fail with a typed error instead of receiving a dead path.
    rmSync(path.join(library.libraryPath, 'Assets', 'gone'), { recursive: true, force: true });
    expectCode(
      () => service.resolveFolderPath(library.libraryId, folder.folderId),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('resolves a linked folder to its canonical root path', () => {
    const temp = root();
    const sourceRoot = path.join(temp, 'source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');

    const service = newService();
    const library = service.createLibrary({ displayName: 'FolderPath', selectedParentPath: temp });
    const linked = service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: sourceRoot,
    });

    // The worker canonicalizes linked roots (realpath), matching linked assets.
    expect(service.resolveFolderPath(library.libraryId, linked.folderId)).toBe(realpathSync(sourceRoot));
    service.closeAll();
  });

  it('rejects a linked folder whose root vanished even before any refresh marks it offline', () => {
    const temp = root();
    const sourceRoot = path.join(temp, 'source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');

    const service = newService();
    const library = service.createLibrary({ displayName: 'FolderPath', selectedParentPath: temp });
    const linked = service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: sourceRoot,
    });

    rmSync(sourceRoot, { recursive: true, force: true });
    expectCode(
      () => service.resolveFolderPath(library.libraryId, linked.folderId),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('rejects a linked folder recorded as offline even if the root exists again', () => {
    const temp = root();
    const sourceRoot = path.join(temp, 'source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');

    const service = newService();
    const library = service.createLibrary({ displayName: 'FolderPath', selectedParentPath: temp });
    const linked = service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: sourceRoot,
    });

    // The renderer disables these actions from the recorded status; the worker
    // is the defensive boundary for the same state.
    const database = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    try {
      database
        .prepare("UPDATE linked_folders SET status = 'offline' WHERE folder_id = ?")
        .run(linked.folderId);
    } finally {
      database.close();
    }
    expectCode(
      () => service.resolveFolderPath(library.libraryId, linked.folderId),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('rejects a linked root replaced by a symbolic link', () => {
    const temp = root();
    const sourceRoot = path.join(temp, 'source');
    const elsewhere = path.join(temp, 'elsewhere');
    mkdirSync(sourceRoot);
    mkdirSync(elsewhere);
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');

    const service = newService();
    const library = service.createLibrary({ displayName: 'FolderPath', selectedParentPath: temp });
    const linked = service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: sourceRoot,
    });

    rmSync(sourceRoot, { recursive: true, force: true });
    symlinkSync(elsewhere, sourceRoot, 'dir');
    expectCode(
      () => service.resolveFolderPath(library.libraryId, linked.folderId),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('rejects an unknown folder id', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({ displayName: 'FolderPath', selectedParentPath: temp });

    expectCode(
      () => service.resolveFolderPath(library.libraryId, 'folder-does-not-exist'),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });
});
