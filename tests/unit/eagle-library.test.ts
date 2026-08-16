import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ONE_PX_RED_PNG } from '../fixtures/fbx/ascii-fbx';
import {
  readEagleAssetCandidate,
  readEagleLibrary,
  readEagleLibraryRoot,
} from '../../src/worker/eagle-library';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-eagle-reader-'));
  temporaryRoots.push(root);
  return root;
}

function writeEagleLibrary(root: string): string {
  const libraryPath = path.join(root, 'Demo.library');
  mkdirSync(path.join(libraryPath, 'images', 'aaa.info'), { recursive: true });
  mkdirSync(path.join(libraryPath, 'images', 'bbb.info'), { recursive: true });
  mkdirSync(path.join(libraryPath, 'images', 'deleted.info'), { recursive: true });
  writeFileSync(path.join(libraryPath, 'metadata.json'), JSON.stringify({
    folders: [
      {
        id: 'folder-characters',
        name: 'Characters',
        children: [{ id: 'folder-heroes', name: 'Heroes', children: [] }],
      },
    ],
  }));
  writeFileSync(path.join(libraryPath, 'images', 'aaa.info', 'metadata.json'), JSON.stringify({
    id: 'aaa',
    name: 'hero',
    ext: 'png',
    annotation: 'lead',
    star: 4,
    tags: ['red'],
    folders: ['folder-heroes'],
    url: 'https://example.test/hero',
  }));
  writeFileSync(path.join(libraryPath, 'images', 'aaa.info', 'hero.png'), ONE_PX_RED_PNG);
  writeFileSync(path.join(libraryPath, 'images', 'aaa.info', 'hero_thumbnail.png'), ONE_PX_RED_PNG);
  writeFileSync(path.join(libraryPath, 'images', 'bbb.info', 'metadata.json'), JSON.stringify({
    id: 'bbb',
    name: 'prop',
    ext: 'png',
    tags: ['blue'],
    folders: ['folder-characters'],
  }));
  writeFileSync(path.join(libraryPath, 'images', 'bbb.info', 'prop.png'), ONE_PX_RED_PNG);
  writeFileSync(path.join(libraryPath, 'images', 'deleted.info', 'metadata.json'), JSON.stringify({
    id: 'deleted',
    name: 'gone',
    ext: 'png',
    isDeleted: true,
  }));
  writeFileSync(path.join(libraryPath, 'images', 'deleted.info', 'gone.png'), ONE_PX_RED_PNG);
  return libraryPath;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('Eagle library reader', () => {
  it('lists folders and info directory names before parsing item metadata', () => {
    const libraryPath = writeEagleLibrary(temporaryRoot());
    const root = readEagleLibraryRoot(libraryPath);
    expect(root.displayName).toBe('Demo');
    expect(root.folders.map((folder) => folder.name)).toEqual(['Characters', 'Heroes']);
    expect(root.infoDirectoryNames).toEqual(['aaa.info', 'bbb.info', 'deleted.info']);
    expect(root.imagesPath).toMatch(/images$/);
  });

  it('isolates a deleted item without dropping valid neighbors', () => {
    const libraryPath = writeEagleLibrary(temporaryRoot());
    const snapshot = readEagleLibrary(libraryPath);
    expect(snapshot.items.map((item) => item.fileName)).toEqual(['hero.png', 'prop.png']);
    expect(snapshot.skippedCount).toBe(1);
    expect(snapshot.invalidCount).toBe(0);
    expect(snapshot.items[0]?.thumbnailPath).toMatch(/hero_thumbnail\.png$/);
  });

  it('returns invalid when an info directory has broken metadata', () => {
    const libraryPath = writeEagleLibrary(temporaryRoot());
    writeFileSync(path.join(libraryPath, 'images', 'aaa.info', 'metadata.json'), '{');
    expect(readEagleAssetCandidate(path.join(libraryPath, 'images'), 'aaa.info')).toEqual({
      skipped: true,
      invalid: true,
    });
  });
});
