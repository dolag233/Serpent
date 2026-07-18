import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService, LibraryServiceError } from '../../src/worker/library-service';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-folder-test-'));
  temporaryRoots.push(root);
  return root;
}

function expectServiceCode(operation: () => unknown, code: LibraryServiceError['code']): void {
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

describe('managed folders', () => {
  it('creates nested database folders that map exactly to disk', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Folders', selectedParentPath: root });

    const parent = service.createManagedFolder({ libraryId: library.libraryId, name: '  UI  ' });
    const child = service.createManagedFolder({
      libraryId: library.libraryId,
      parentFolderId: parent.folderId,
      name: 'Buttons',
    });

    expect(parent).toMatchObject({ name: 'UI', parentFolderId: null, relativePath: 'UI' });
    expect(child).toMatchObject({
      name: 'Buttons',
      parentFolderId: parent.folderId,
      relativePath: 'UI/Buttons',
    });
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'UI', 'Buttons'))).toBe(true);
    expect(service.listManagedFolders(library.libraryId)).toEqual([
      { ...parent, childFolderCount: 1 },
      child,
    ]);
    service.closeAll();
  });

  it('rejects unsafe names, missing parents, and disk conflicts', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Rules', selectedParentPath: root });

    expectServiceCode(
      () => service.createManagedFolder({ libraryId: library.libraryId, name: 'bad:name' }),
      'INVALID_FOLDER_NAME',
    );
    expectServiceCode(
      () =>
      service.createManagedFolder({
        libraryId: library.libraryId,
        parentFolderId: 'missing',
        name: 'Child',
      }),
      'FOLDER_NOT_FOUND',
    );

    service.createManagedFolder({ libraryId: library.libraryId, name: 'Existing' });
    expectServiceCode(
      () => service.createManagedFolder({ libraryId: library.libraryId, name: 'Existing' }),
      'FOLDER_ALREADY_EXISTS',
    );
    service.closeAll();
  });
});
