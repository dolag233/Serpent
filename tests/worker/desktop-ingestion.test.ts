import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('desktop ingestion through the existing import transaction', () => {
  it('copies a dropped folder hierarchy into the selected managed folder', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-desktop-worker-'));
    roots.push(root);
    const source = path.join(root, 'Reference');
    mkdirSync(path.join(source, 'Characters'), { recursive: true });
    writeFileSync(path.join(source, 'Characters', 'hero.txt'), 'hero');

    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Desktop Drop', selectedParentPath: root });
    const target = service.createManagedFolder({ libraryId: library.libraryId, name: 'Project' });
    const completion = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      targetFolderId: target.folderId,
      sourceKind: 'folder',
      sourcePaths: [source],
    });

    expect(completion).toMatchObject({ importedCount: 1 });
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Project', 'Reference', 'Characters', 'hero.txt'))).toBe(true);
    service.closeAll();
  });

  it('merges an existing destination folder while preserving file conflicts', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-desktop-folder-merge-'));
    roots.push(root);
    const source = path.join(root, 'Reference');
    mkdirSync(path.join(source, 'Characters'), { recursive: true });
    writeFileSync(path.join(source, 'root.txt'), 'incoming root');
    writeFileSync(path.join(source, 'Characters', 'hero.txt'), 'incoming hero');

    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Desktop Folder Merge', selectedParentPath: root });
    const target = service.createManagedFolder({ libraryId: library.libraryId, name: 'Project' });
    const existing = service.createManagedFolder({
      libraryId: library.libraryId,
      parentFolderId: target.folderId,
      name: 'Reference',
    });
    writeFileSync(
      path.join(library.libraryPath, 'Assets', 'Project', 'Reference', 'existing.txt'),
      'existing',
    );

    const prepared = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      targetFolderId: target.folderId,
      sourceKind: 'folder',
      sourcePaths: [source],
    });

    expect(prepared).toMatchObject({ importedCount: 2 });
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Project', 'Reference', 'existing.txt'))).toBe(true);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Project', 'Reference', 'root.txt'))).toBe(true);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'Project', 'Reference', 'Characters', 'hero.txt'))).toBe(true);
    expect(
      service.listManagedFolders(library.libraryId).filter(
        (folder) => folder.relativePath === existing.relativePath,
      ),
    ).toHaveLength(1);
    service.closeAll();
  });

  it('keeps collection assignment explicit after a pasted image import', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-clipboard-worker-'));
    roots.push(root);
    const source = path.join(root, 'Clipboard 2026-07-13T12-34-56Z.png');
    writeFileSync(source, Buffer.from('clipboard-png'));
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Clipboard', selectedParentPath: root });
    const collection = service.createCollection({ libraryId: library.libraryId, name: 'Moodboard' });
    const completion = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });
    if ('importId' in completion) throw new Error('Unexpected conflict');
    service.addCollectionAssets({
      libraryId: library.libraryId,
      collectionId: collection.collectionId,
      assetIds: completion.assets.map((asset) => asset.assetId),
    });

    expect(service.listCollectionAssets({
      libraryId: library.libraryId,
      collectionId: collection.collectionId,
      recursive: false,
    }).map((asset) => asset.displayName)).toEqual(['Clipboard 2026-07-13T12-34-56Z.png']);
    service.closeAll();
  });
});
