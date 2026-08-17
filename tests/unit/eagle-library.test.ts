import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ONE_PX_RED_PNG } from '../fixtures/fbx/ascii-fbx';
import {
  readEagleAssetCandidate,
  readEagleLibrary,
  readEagleLibraryRoot,
  sumEagleLibrarySourceBytes,
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
    width: 1920,
    height: 1080,
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
    expect(snapshot.items[0]?.width).toBe(1920);
    expect(snapshot.items[0]?.height).toBe(1080);
  });

  it('uses metadata name.ext without scanning extra files in the info directory', () => {
    const libraryPath = writeEagleLibrary(temporaryRoot());
    writeFileSync(
      path.join(libraryPath, 'images', 'aaa.info', 'unrelated.bin'),
      ONE_PX_RED_PNG,
    );
    const snapshot = readEagleLibrary(libraryPath);
    expect(snapshot.items[0]?.fileName).toBe('hero.png');
    expect(snapshot.items[0]?.thumbnailPath).toMatch(/hero_thumbnail\.png$/);
  });

  it('falls back to a directory scan when metadata name does not match the file', () => {
    const root = temporaryRoot();
    const libraryPath = path.join(root, 'Odd.library');
    mkdirSync(path.join(libraryPath, 'images', 'odd.info'), { recursive: true });
    writeFileSync(path.join(libraryPath, 'metadata.json'), JSON.stringify({ folders: [] }));
    writeFileSync(
      path.join(libraryPath, 'images', 'odd.info', 'metadata.json'),
      JSON.stringify({
        id: 'odd',
        name: 'does-not-match',
        ext: 'png',
      }),
    );
    writeFileSync(path.join(libraryPath, 'images', 'odd.info', 'actual.png'), ONE_PX_RED_PNG);
    writeFileSync(
      path.join(libraryPath, 'images', 'odd.info', 'actual_thumbnail.png'),
      ONE_PX_RED_PNG,
    );
    const snapshot = readEagleLibrary(libraryPath);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]?.fileName).toBe('actual.png');
    expect(snapshot.items[0]?.thumbnailPath).toMatch(/actual_thumbnail\.png$/);
  });

  it('returns invalid when an info directory has broken metadata', () => {
    const libraryPath = writeEagleLibrary(temporaryRoot());
    writeFileSync(path.join(libraryPath, 'images', 'aaa.info', 'metadata.json'), '{');
    expect(readEagleAssetCandidate(path.join(libraryPath, 'images'), 'aaa.info')).toEqual({
      skipped: true,
      invalid: true,
    });
  });

  it('sums source bytes for the whole library and skips deleted items', () => {
    const libraryPath = writeEagleLibrary(temporaryRoot());
    const root = readEagleLibraryRoot(libraryPath);
    expect(root.imagesPath).toBeTruthy();
    expect(sumEagleLibrarySourceBytes(root.imagesPath!, root.infoDirectoryNames)).toBe(
      ONE_PX_RED_PNG.byteLength * 2,
    );
  });

  it('prefers metadata size when present', () => {
    const libraryPath = writeEagleLibrary(temporaryRoot());
    writeFileSync(path.join(libraryPath, 'images', 'aaa.info', 'metadata.json'), JSON.stringify({
      id: 'aaa',
      name: 'hero',
      ext: 'png',
      size: 4096,
    }));
    const root = readEagleLibraryRoot(libraryPath);
    expect(sumEagleLibrarySourceBytes(root.imagesPath!, root.infoDirectoryNames)).toBe(
      4096 + ONE_PX_RED_PNG.byteLength,
    );
  });
});
