import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const roots: string[] = [];
const services: LibraryService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function writeEagleFixture(eagleRoot: string): void {
  const rootItem = path.join(eagleRoot, 'images', 'root-item.info');
  const nestedItem = path.join(eagleRoot, 'images', 'nested-item.info');
  mkdirSync(rootItem, { recursive: true });
  mkdirSync(nestedItem, { recursive: true });
  writeFileSync(
    path.join(eagleRoot, 'metadata.json'),
    JSON.stringify({
      folders: [{ id: 'folder-1', name: 'Nested', children: [] }],
    }),
  );
  writeFileSync(
    path.join(rootItem, 'metadata.json'),
    JSON.stringify({
      id: 'root-item',
      name: 'root-item',
      ext: 'txt',
      folders: [],
      tags: ['root-tag'],
      annotation: 'root annotation',
    }),
  );
  writeFileSync(path.join(rootItem, 'root-item.txt'), 'root bytes');
  writeFileSync(
    path.join(nestedItem, 'metadata.json'),
    JSON.stringify({
      id: 'nested-item',
      name: 'nested-item',
      ext: 'txt',
      folders: ['folder-1'],
    }),
  );
  writeFileSync(path.join(nestedItem, 'nested-item.txt'), 'nested bytes');
}

describe('Eagle external-library opening (Serpent-768x.1)', () => {
  it('converts root files and nested folders into a Serpent library at the chosen parent', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-eagle-open-'));
    roots.push(root);
    const eagleParent = path.join(root, 'eagle-source');
    const destinationParent = path.join(root, 'serpent-destination');
    mkdirSync(eagleParent);
    mkdirSync(destinationParent);
    const eagleRoot = path.join(eagleParent, 'Reference.library');
    writeEagleFixture(eagleRoot);
    const sourceMetadata = readFileSync(path.join(eagleRoot, 'metadata.json'), 'utf8');

    const service = new LibraryService();
    services.push(service);
    const converted = await service.openEagleLibrary({
      sourceRootPath: eagleRoot,
      selectedParentPath: destinationParent,
      displayName: 'Reference',
    });

    expect(converted.displayName).toBe('Reference');
    expect(converted.libraryPath).toBe(
      path.join(realpathSync(destinationParent), 'Reference'),
    );
    expect(converted.libraryPath).not.toBe(
      path.join(realpathSync(eagleParent), 'Reference'),
    );
    expect(readFileSync(path.join(eagleRoot, 'metadata.json'), 'utf8')).toBe(sourceMetadata);

    const assets = service.listAssets({
      libraryId: converted.libraryId,
      recursive: true,
    });
    expect(assets.map((asset) => asset.displayName)).toEqual(
      expect.arrayContaining(['root-item.txt', 'nested-item.txt']),
    );
    expect(assets.find((asset) => asset.displayName === 'root-item.txt')?.managedFolderId)
      .toBeNull();
    expect(assets.find((asset) => asset.displayName === 'nested-item.txt')?.managedFolderId)
      .toBeNull();
    const nestedCollection = service
      .listCollections(converted.libraryId)
      .find((collection) => collection.name === 'Nested');
    expect(nestedCollection).toBeDefined();
    expect(
      service
        .listCollectionAssets({
          libraryId: converted.libraryId,
          collectionId: nestedCollection!.collectionId,
          recursive: true,
        })
        .map((asset) => asset.displayName),
    ).toContain('nested-item.txt');
    expect(service.listTags(converted.libraryId).map((tag) => tag.name)).toContain('root-tag');
  });

  it('returns the Eagle library name for the rename panel and honors a custom display name', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-eagle-open-rename-'));
    roots.push(root);
    const eagleRoot = path.join(root, 'Reference.library');
    const destinationParent = path.join(root, 'serpent-destination');
    mkdirSync(eagleRoot, { recursive: true });
    mkdirSync(destinationParent);
    writeEagleFixture(eagleRoot);

    const service = new LibraryService();
    services.push(service);
    expect(service.inspectEagleLibrary(eagleRoot)).toEqual({ displayName: 'Reference' });

    const converted = await service.openEagleLibrary({
      sourceRootPath: eagleRoot,
      selectedParentPath: destinationParent,
      displayName: 'Studio refs',
    });
    expect(converted.displayName).toBe('Studio refs');
    expect(converted.libraryPath).toBe(
      path.join(realpathSync(destinationParent), 'Studio refs'),
    );
  });

  it('rejects inspect when the folder is not an Eagle library', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-eagle-inspect-invalid-'));
    roots.push(root);
    const service = new LibraryService();
    services.push(service);
    let thrown: unknown;
    try {
      service.inspectEagleLibrary(root);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'INVALID_IMPORT_SOURCE' });
  });

  it('rejects a destination inside the Eagle source directory', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-eagle-open-inside-'));
    roots.push(root);
    const eagleRoot = path.join(root, 'Reference.library');
    writeEagleFixture(eagleRoot);

    const service = new LibraryService();
    services.push(service);
    await expect(
      service.openEagleLibrary({
        sourceRootPath: eagleRoot,
        selectedParentPath: eagleRoot,
        displayName: 'Reference',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_LIBRARY_PATH' });
  });
});
