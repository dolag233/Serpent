import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyDroppedSourcePaths,
  cleanupClipboardImage,
  cleanupStaleClipboardImages,
  extractClipboardHtmlImageSources,
  readClipboardImage,
  stageClipboardImage,
  wrapDibInBmp,
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

describe('windows clipboard image extraction', () => {
  const pngBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('rest-of-png'),
  ]);

  function fakeImage(bytes: Buffer) {
    return {
      isEmpty: () => bytes.length === 0,
      toPNG: () => bytes,
    };
  }

  function createDeps(overrides: {
    image?: Buffer;
    buffers?: Record<string, Buffer>;
    html?: string;
    files?: Record<string, Buffer>;
  }) {
    const created: Buffer[] = [];
    return {
      created,
      deps: {
        readImage: () => fakeImage(overrides.image ?? Buffer.alloc(0)),
        readBuffer: (format: string) => overrides.buffers?.[format] ?? Buffer.alloc(0),
        readHTML: () => overrides.html ?? '',
        createFromBuffer: (buffer: Buffer) => {
          created.push(buffer);
          return fakeImage(buffer);
        },
        // When no file map is supplied, leave readFile undefined so the
        // reader falls back to the real fs (temp-file HTML references).
        ...(overrides.files === undefined
          ? {}
          : {
              readFile: (filePath: string) => {
                const bytes = overrides.files?.[filePath];
                if (bytes === undefined) throw new Error('ENOENT');
                return bytes;
              },
            }),
      },
    };
  }

  function oneByOneDib(overrides: { compression?: number } = {}): Buffer {
    const dib = Buffer.alloc(44);
    dib.writeUInt32LE(40, 0); // biSize
    dib.writeInt32LE(1, 4); // width
    dib.writeInt32LE(1, 8); // height
    dib.writeUInt16LE(1, 12); // planes
    dib.writeUInt16LE(32, 14); // bitCount
    dib.writeUInt32LE(overrides.compression ?? 0, 16); // compression
    dib.writeUInt32LE(4, 20); // sizeImage
    dib.writeUInt32LE(0, 32); // biClrUsed
    dib.writeUInt32LE(0xffcc0088, 40); // pixel (BGRA)
    return dib;
  }

  it('prefers the Chromium readImage path when it yields an image', () => {
    const { created, deps } = createDeps({ image: Buffer.from('dib-image') });
    expect(readClipboardImage(deps)).toMatchObject({ source: 'readImage' });
    expect(created).toHaveLength(0);
  });

  it('falls back to the registered PNG clipboard format when readImage is empty', () => {
    const { created, deps } = createDeps({
      buffers: { PNG: pngBytes, 'image/png': Buffer.alloc(0) },
    });
    expect(readClipboardImage(deps)).toMatchObject({ source: 'readBuffer:PNG' });
    expect(created[0]).toEqual(pngBytes);
  });

  it('wraps a bare CF_DIB into a BMP container Chromium can decode', () => {
    const dib = oneByOneDib();
    const bmp = wrapDibInBmp(dib)!;
    expect(bmp).not.toBeNull();
    expect(bmp.subarray(0, 2).toString('ascii')).toBe('BM');
    expect(bmp.readUInt32LE(2)).toBe(14 + dib.length);
    expect(bmp.readUInt32LE(10)).toBe(54); // 14-byte file header + 40-byte info header
    expect(bmp.subarray(54)).toEqual(dib.subarray(40));

    const { created, deps } = createDeps({ buffers: { CF_DIB: dib } });
    expect(readClipboardImage(deps)).toMatchObject({ source: 'readBuffer:CF_DIB' });
    expect(created[0]).toEqual(bmp);
  });

  it('rejects compressed and truncated DIBs instead of emitting broken bitmaps', () => {
    expect(wrapDibInBmp(oneByOneDib({ compression: 1 }))).toBeNull(); // BI_RLE8
    expect(wrapDibInBmp(Buffer.alloc(20))).toBeNull();
    expect(wrapDibInBmp(Buffer.alloc(44))).toBeNull(); // width/height 0
  });

  it('reads images referenced as temp files inside the HTML Format', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-clipboard-html-'));
    roots.push(root);
    const imagePath = path.join(root, 'staged.png');
    writeFileSync(imagePath, pngBytes);
    const html = `<html><body><!--StartFragment--><img src="file:///${imagePath.replace(/\\/g, '/')}"><!--EndFragment--></body></html>`;
    const { created, deps } = createDeps({ html });
    expect(readClipboardImage(deps)).toMatchObject({ source: 'html:file' });
    expect(created[0]).toEqual(pngBytes);
  });

  it('reads inline base64 data URLs from the HTML Format', () => {
    const html = `<img src="data:image/png;base64,${pngBytes.toString('base64')}">`;
    const { created, deps } = createDeps({ html });
    expect(readClipboardImage(deps)).toMatchObject({ source: 'html:data-url' });
    expect(created[0]).toEqual(pngBytes);
  });

  it('returns null without throwing when the clipboard holds no image at all', () => {
    const { deps } = createDeps({
      buffers: { PNG: Buffer.from('not-a-png') },
      html: '<p>plain text only</p>',
    });
    expect(readClipboardImage(deps)).toBeNull();
  });

  it('extracts html image sources with entity decoding', () => {
    const sources = extractClipboardHtmlImageSources(
      '<img src="file:///C:/temp/a&amp;b.png"><img src="data:image/jpeg;base64,AAA">',
    );
    expect(sources.filePaths).toEqual(['C:/temp/a&b.png']);
    expect(sources.dataUrls).toHaveLength(1);
  });
});
