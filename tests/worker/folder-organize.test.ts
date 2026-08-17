import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import type { LibraryServiceError } from '../../src/worker/library-service';
import { importNoConflict as importFile } from './import-no-conflict';

const roots: string[] = [];
const services: LibraryService[] = [];

function root(): string {
  const value = mkdtempSync(path.join(tmpdir(), 'serpent-folder-organize-'));
  roots.push(value);
  return value;
}

function newService(): LibraryService {
  const service = new LibraryService();
  services.push(service);
  return service;
}

function expectCode(run: () => unknown, code: LibraryServiceError['code']) {
  expect(run).toThrowError(expect.objectContaining({ code }));
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const value of roots.splice(0)) rmSync(value, { force: true, recursive: true });
});

describe('cloneManagedFolder / moveManagedFolders (Serpent-vgp)', () => {
  it('clones a folder tree with assets as a sibling copy', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Clone',
      selectedParentPath: temp,
    });
    const parent = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'Hero',
    });
    const child = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'Props',
      parentFolderId: parent.folderId,
    });
    const source = path.join(temp, 'a.png');
    writeFileSync(source, 'payload-a');
    importFile(service, library.libraryId, source, child.folderId);

    const cloned = service.cloneManagedFolder({
      libraryId: library.libraryId,
      folderId: parent.folderId,
    });
    expect(cloned.folder.name).toBe('Hero copy');
    expect(cloned.folder.parentFolderId).toBeNull();
    expect(cloned.clonedFolderCount).toBe(2);
    expect(cloned.clonedAssetCount).toBe(1);
    expect(
      existsSync(path.join(library.libraryPath, 'Assets', 'Hero', 'Props', 'a.png')),
    ).toBe(true);
    expect(
      existsSync(
        path.join(library.libraryPath, 'Assets', 'Hero copy', 'Props', 'a.png'),
      ),
    ).toBe(true);
    expect(
      readFileSync(
        path.join(library.libraryPath, 'Assets', 'Hero copy', 'Props', 'a.png'),
        'utf8',
      ),
    ).toBe('payload-a');
  });

  it('moves a folder under another parent and rewrites asset paths', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Move',
      selectedParentPath: temp,
    });
    const alpha = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'Alpha',
    });
    const beta = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'Beta',
    });
    const source = path.join(temp, 'shot.png');
    writeFileSync(source, 'shot');
    const imported = importFile(
      service,
      library.libraryId,
      source,
      alpha.folderId,
    ).assets[0]!;

    const moved = service.moveManagedFolders({
      libraryId: library.libraryId,
      folderIds: [alpha.folderId],
      targetParentFolderId: beta.folderId,
      conflictStrategy: 'keep-both',
    });
    expect(moved.movedCount).toBe(1);
    expect(moved.folders[0]).toMatchObject({
      folderId: alpha.folderId,
      parentFolderId: beta.folderId,
      relativePath: 'Beta/Alpha',
    });
    expect(
      existsSync(path.join(library.libraryPath, 'Assets', 'Beta', 'Alpha', 'shot.png')),
    ).toBe(true);
    const assets = service.listAssets({
      libraryId: library.libraryId,
      folderId: alpha.folderId,
      recursive: true,
    });
    expect(assets.find((item) => item.assetId === imported.assetId)?.relativeFilePath).toBe(
      'Beta/Alpha/shot.png',
    );
  });

  it('refuses moving a folder into its own descendant', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'MoveRefuse',
      selectedParentPath: temp,
    });
    const parent = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'Parent',
    });
    const child = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'Child',
      parentFolderId: parent.folderId,
    });
    expectCode(
      () =>
        service.moveManagedFolders({
          libraryId: library.libraryId,
          folderIds: [parent.folderId],
          targetParentFolderId: child.folderId,
        }),
      'FOLDER_NAME_CONFLICT',
    );
  });

  it('keep-both renames when the destination already has the same folder name', () => {
    const temp = root();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'MoveConflict',
      selectedParentPath: temp,
    });
    const dest = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'Dest',
    });
    service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'Shared',
      parentFolderId: dest.folderId,
    });
    const source = service.createManagedFolder({
      libraryId: library.libraryId,
      name: 'Shared',
    });

    const moved = service.moveManagedFolders({
      libraryId: library.libraryId,
      folderIds: [source.folderId],
      targetParentFolderId: dest.folderId,
      conflictStrategy: 'keep-both',
    });
    expect(moved.movedCount).toBe(1);
    expect(moved.folders[0]?.name).toBe('Shared copy');
    expect(moved.folders[0]?.relativePath).toBe('Dest/Shared copy');
  });
});
