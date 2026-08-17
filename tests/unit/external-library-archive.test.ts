import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import {
  ExternalLibraryArchiveError,
  materializeExternalLibrarySource,
} from '../../src/main/external-library-archive';

async function tempDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'serpent-external-library-test-'));
}

function writeZip(archivePath: string, entries: Record<string, string>): void {
  const archive = new AdmZip();
  for (const [entryPath, contents] of Object.entries(entries)) {
    archive.addFile(entryPath, Buffer.from(contents));
  }
  archive.writeZip(archivePath);
}

describe('external library archive materialization', () => {
  it('extracts a nested BillfishPack root and removes the temporary tree on cleanup', async () => {
    const root = await tempDirectory();
    const archivePath = path.join(root, 'sample.BillfishPack');
    writeZip(archivePath, {
      'Sample Billfish/.bf/billfish.db': 'placeholder',
      'Sample Billfish/reference.png': 'image',
    });

    const materialized = await materializeExternalLibrarySource({
      sourcePath: archivePath,
      kind: 'billfish',
      tempDirectory: root,
    });
    expect(materialized.sourceDisplayName).toBe('sample');
    expect(await readFile(path.join(materialized.sourceRootPath, 'reference.png'), 'utf8')).toBe('image');
    const extractionRoot = path.dirname(materialized.sourceRootPath);
    await materialized.cleanup();
    await expect(stat(extractionRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('finds an Eagle root nested inside a ZIP archive', async () => {
    const root = await tempDirectory();
    const archivePath = path.join(root, 'eagle.zip');
    writeZip(archivePath, {
      'Exported Eagle/metadata.json': JSON.stringify({ folders: [] }),
      'Exported Eagle/images/.keep': '',
    });

    const materialized = await materializeExternalLibrarySource({
      sourcePath: archivePath,
      kind: 'eagle',
      tempDirectory: root,
    });
    expect(await readdir(materialized.sourceRootPath)).toContain('images');
    await materialized.cleanup();
  });

  it('rejects unsafe archive paths and cleans the temporary directory', async () => {
    const root = await tempDirectory();
    const archivePath = path.join(root, 'unsafe.BillfishPack');
    writeZip(archivePath, {
      '../outside.txt': 'should not escape',
    });

    await expect(materializeExternalLibrarySource({
      sourcePath: archivePath,
      kind: 'billfish',
      tempDirectory: root,
    })).rejects.toBeInstanceOf(ExternalLibraryArchiveError);
    expect(await readdir(root)).toEqual(['unsafe.BillfishPack']);
  });

  it('keeps an already-selected folder and makes cleanup a no-op', async () => {
    const root = await tempDirectory();
    await writeFile(path.join(root, 'metadata.json'), JSON.stringify({ folders: [] }));
    await mkdir(path.join(root, 'images'));
    const materialized = await materializeExternalLibrarySource({ sourcePath: root, kind: 'eagle' });
    expect(materialized.sourceRootPath).toBe(path.resolve(root));
    await materialized.cleanup();
    expect(await stat(root)).toBeTruthy();
  });

  it('does not accept a Billfish directory as a substitute for a BillfishPack', async () => {
    const root = await tempDirectory();
    await expect(materializeExternalLibrarySource({ sourcePath: root, kind: 'billfish' }))
      .rejects.toThrow('.BillfishPack');
  });
});
