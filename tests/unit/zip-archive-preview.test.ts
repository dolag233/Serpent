import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';

import { listZipArchiveFiles, readZipArchiveEntry } from '../../src/worker/zip-archive-preview';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let directory: string | undefined;

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

function writeArchive(): string {
  directory = mkdtempSync(path.join(tmpdir(), 'serpent-zip-view-'));
  const zipPath = path.join(directory, 'bundle.zip');
  const zip = new AdmZip();
  zip.addFile('notes/readme.txt', Buffer.from('hello from zip'));
  zip.addFile('photo.png', PNG);
  zip.addFile('notes/', Buffer.alloc(0));
  zip.writeZip(zipPath);
  return zipPath;
}

describe('zip archive preview', () => {
  it('lists files inside a zip and reads an image and a text file', async () => {
    const zipPath = writeArchive();
    const listing = await listZipArchiveFiles(zipPath);
    expect(listing.status).toBe('ready');
    expect(listing.files.map((file) => file.name).sort()).toEqual([
      'notes/readme.txt',
      'photo.png',
    ]);

    const photo = listing.files.find((file) => file.name === 'photo.png');
    const notes = listing.files.find((file) => file.name === 'notes/readme.txt');
    expect(photo).toBeDefined();
    expect(notes).toBeDefined();

    const image = await readZipArchiveEntry(zipPath, photo!.index);
    expect(image?.kind).toBe('image');
    expect(image?.mimeType).toBe('image/png');
    expect(Buffer.from(image?.bytesBase64 ?? '', 'base64')).toEqual(PNG);

    const text = await readZipArchiveEntry(zipPath, notes!.index);
    expect(text).toMatchObject({
      kind: 'text',
      text: 'hello from zip',
    });
  });

  it('does not treat a non-zip as a readable archive', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'serpent-zip-view-'));
    const zipPath = path.join(directory, 'not-zip.bin');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(zipPath, Buffer.from('this is not a zip'));
    const listing = await listZipArchiveFiles(zipPath);
    expect(listing).toEqual({ status: 'unreadable', truncated: false, files: [] });
  });
});
