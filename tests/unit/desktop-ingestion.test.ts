import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyDroppedSourcePaths,
  cleanupClipboardImage,
  cleanupStaleClipboardImages,
  stageClipboardImage,
} from '../../src/main/desktop-ingestion';
import { resolveDroppedFilePaths } from '../../src/preload/dropped-files';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('desktop drop path resolution', () => {
  it('resolves File handles inside preload without returning duplicate paths', () => {
    const first = { opaque: 'first' };
    const duplicate = { opaque: 'duplicate' };
    const resolved = resolveDroppedFilePaths([first, duplicate], () => '/local/asset.png');
    expect(resolved).toEqual(['/local/asset.png']);
    expect(() => resolveDroppedFilePaths([], () => '/local/asset.png')).toThrow('INVALID_DROP_FILE_COUNT');
    expect(() => resolveDroppedFilePaths([first], () => '')).toThrow('INVALID_DROP_FILE_HANDLE');
  });

  it('classifies one folder separately and accepts multi-source selections', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-drop-unit-'));
    roots.push(root);
    const folder = path.join(root, 'folder');
    const secondFolder = path.join(root, 'second-folder');
    const first = path.join(root, 'first.png');
    const second = path.join(root, 'second.jpg');
    mkdirSync(folder);
    mkdirSync(secondFolder);
    writeFileSync(first, 'first');
    writeFileSync(second, 'second');
    expect(classifyDroppedSourcePaths([folder])).toBe('folder');
    expect(classifyDroppedSourcePaths([first, second])).toBe('files');
    expect(classifyDroppedSourcePaths([folder, first])).toBe('files');
    expect(classifyDroppedSourcePaths([folder, secondFolder])).toBe('files');
    expect(() => classifyDroppedSourcePaths(['relative.png'])).toThrow('INVALID_DROP_SELECTION');
    const link = path.join(root, 'linked.png');
    symlinkSync(first, link);
    expect(() => classifyDroppedSourcePaths([link])).toThrow('SYMBOLIC_LINK_NOT_ALLOWED');
  });
});

describe('clipboard staging', () => {
  it('writes private PNG staging and removes it after Worker preparation', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-clipboard-unit-'));
    roots.push(root);
    const staged = stageClipboardImage({
      isEmpty: () => false,
      toPNG: () => Buffer.from('png-bytes'),
    }, root, new Date('2026-07-13T12:34:56.000Z'));
    expect(path.basename(staged.filePath)).toBe('Clipboard 2026-07-13T12-34-56Z.png');
    expect(readFileSync(staged.filePath)).toEqual(Buffer.from('png-bytes'));
    cleanupClipboardImage(staged.directoryPath);
    expect(existsSync(staged.directoryPath)).toBe(false);
  });

  it('reports empty clipboard images and sweeps only Serpent-owned stale staging', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-clipboard-sweep-'));
    roots.push(root);
    expect(() => stageClipboardImage({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }, root))
      .toThrow('CLIPBOARD_IMAGE_NOT_FOUND');
    mkdirSync(path.join(root, 'serpent-clipboard-stale'));
    mkdirSync(path.join(root, 'someone-elses-temp'));
    expect(cleanupStaleClipboardImages(root)).toBe(1);
    expect(existsSync(path.join(root, 'someone-elses-temp'))).toBe(true);
  });
});
