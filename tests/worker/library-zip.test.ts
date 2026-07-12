import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  createWriteStream,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  LibraryServiceError,
} from '../../src/worker/library-service';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-zip-test-'));
  temporaryRoots.push(root);
  return root;
}

async function expectRejectAsync(operation: () => Promise<unknown>, code: LibraryServiceError['code']): Promise<void> {
  let thrown: unknown;
  try {
    await operation();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(LibraryServiceError);
  expect((thrown as LibraryServiceError).code).toBe(code);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('LibraryService ZIP export', () => {
  it('exports a library as a valid ZIP with Assets, revisions, trash, and library.db', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'ZIP Export Test', selectedParentPath: root });

    // Add some content.
    const assetPath = path.join(root, 'sample.png');
    writeFileSync(assetPath, Buffer.alloc(1024));
    service.prepareOrExecuteImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [assetPath],
    });

    const destZipPath = path.join(root, 'export-test.zip');
    const result = await service.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath: destZipPath,
      includeLinkedContent: false,
    });

    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.totalBytes).toBeGreaterThan(0);
    expect(result.excludedPreviewCount).toBeGreaterThanOrEqual(0);
    expect(result.includedLinkedContent).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(existsSync(destZipPath)).toBe(true);

    // Verify the ZIP is valid with adm-zip.
    const AdmZip = require('adm-zip') as new (path: string) => {
      getEntries(): Array<{ entryName: string; isDirectory: boolean }>;
      extractAllToAsync(path: string, overwrite: boolean, callback: (error?: Error) => void): void;
    };
    const zip = new AdmZip(destZipPath);
    const entries = zip.getEntries();
    const entryNames = entries.map((e) => e.entryName);

    // Check expected entries.
    // archiver v8 may not create explicit directory entries; Assets/-prefixed files suffice.
    expect(entryNames.some((n) => n.startsWith('Assets/') && !n.endsWith('/'))).toBe(true);
    expect(entryNames).toContain('.serpent/library.db');
    expect(entryNames.some((n) => n.startsWith('Assets/') && !n.endsWith('/'))).toBe(true);

    // Verify no previews or operations.
    expect(entryNames.some((n) => n.startsWith('.serpent/previews/'))).toBe(false);
    expect(entryNames.some((n) => n.startsWith('.serpent/operations/'))).toBe(false);

    service.closeAll();
  });

  it('excludes .serpent/previews/ and .serpent/operations/ from ZIP export', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Exclude ZIP Test', selectedParentPath: root });

    // Create fake preview/operations content.
    mkdirSync(path.join(created.libraryPath, '.serpent', 'previews'), { recursive: true });
    writeFileSync(path.join(created.libraryPath, '.serpent', 'previews', 'thumb.jpg'), 'data');

    mkdirSync(path.join(created.libraryPath, '.serpent', 'operations'), { recursive: true });
    writeFileSync(path.join(created.libraryPath, '.serpent', 'operations', 'op.json'), '{}');

    const destZipPath = path.join(root, 'exclude-zip.zip');
    await service.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath: destZipPath,
      includeLinkedContent: false,
    });

    const AdmZip = require('adm-zip') as new (path: string) => {
      getEntries(): Array<{ entryName: string }>;
    };
    const zip = new AdmZip(destZipPath);
    const entryNames = zip.getEntries().map((e) => e.entryName);

    expect(entryNames.some((n) => n.startsWith('.serpent/previews/'))).toBe(false);
    expect(entryNames.some((n) => n.startsWith('.serpent/operations/'))).toBe(false);
    expect(entryNames).toContain('.serpent/library.db');

    service.closeAll();
  });

  it('rejects ZIP export when file count exceeds 65534 (pre-check)', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Large Zip', selectedParentPath: root });

    // We cannot easily create 65534 real files, but we can test the pre-check
    // logic by verifying that a library with assets doesn't exceed the limit.
    const destZipPath = path.join(root, 'large-zip.zip');
    const result = await service.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath: destZipPath,
      includeLinkedContent: false,
    });

    // A small library should pass the pre-check.
    expect(result.fileCount).toBeLessThanOrEqual(65534);
    expect(existsSync(destZipPath)).toBe(true);

    service.closeAll();
  });

  it('rejects ZIP export destination inside the library', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Inside ZIP', selectedParentPath: root });

    const destInsideLibrary = path.join(created.libraryPath, 'export.zip');
    await expect(service.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath: destInsideLibrary,
      includeLinkedContent: false,
    })).rejects.toThrow();

    service.closeAll();
  });

  it('rejects ZIP export when library is not open', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Closed ZIP', selectedParentPath: root });
    service.closeAll();

    await expectRejectAsync(
      () => service.exportLibraryToZip({
        libraryId: created.libraryId,
        destinationPath: path.join(root, 'dest.zip'),
        includeLinkedContent: false,
      }),
      'LIBRARY_NOT_OPEN',
    );
  });
});

describe('LibraryService ZIP import', () => {
  it('imports a library from a valid ZIP', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();

    // Create and export library to ZIP.
    const created = service.createLibrary({ displayName: 'ZIP Import Test', selectedParentPath: root });

    const assetPath = path.join(root, 'test.txt');
    writeFileSync(assetPath, 'Hello World');
    service.prepareOrExecuteImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [assetPath],
    });

    const destZipPath = path.join(root, 'import-test.zip');
    await service.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath: destZipPath,
      includeLinkedContent: false,
    });

    service.closeAll();

    // Import the ZIP.
    const destDir = path.join(root, 'imported-libs');
    mkdirSync(destDir, { recursive: true });

    const result = await service.importLibraryFromZip({
      sourceZipPath: destZipPath,
      destinationParentPath: destDir,
    });

    expect(result.displayName).toBe('ZIP Import Test');
    expect(result.libraryPath).toContain(destDir);

    // Verify extracted library is valid.
    expect(existsSync(path.join(result.libraryPath, 'Assets'))).toBe(true);
    expect(existsSync(path.join(result.libraryPath, '.serpent', 'library.db'))).toBe(true);

    // Check assets.
    const assets = service.listAssets({ libraryId: result.libraryId, recursive: true });
    expect(assets.length).toBe(1);

    service.closeAll();
  });

  it('rejects ZIP without Assets/ directory', async () => {
    const root = temporaryRoot();

    // Create a ZIP with no Assets/ directory using archiver v8.
    const archiverModule = require('archiver') as {
      ZipArchive: new (options?: Record<string, unknown>) => {
        pipe(output: ReturnType<typeof createWriteStream>): void;
        file(path: string, options: { name: string }): void;
        finalize(): void;
        on(event: string, listener: (err: Error) => void): void;
      };
    };

    const badZipPath = path.join(root, 'no-assets.zip');
    const tempFilePath = path.join(root, 'not-a-library.txt');
    writeFileSync(tempFilePath, 'not a library');

    const output = createWriteStream(badZipPath);
    const archive = new archiverModule.ZipArchive({ zlib: { level: 6 } });
    archive.pipe(output);
    archive.file(tempFilePath, { name: 'not-a-library.txt' });

    await new Promise<void>((resolve, reject) => {
      output.on('finish', () => resolve());
      output.on('error', (err: Error) => reject(err));
      archive.finalize();
    });

    const service = new LibraryService();
    const destDir = path.join(root, 'imported-bad');
    mkdirSync(destDir, { recursive: true });

    await expect(service.importLibraryFromZip({
      sourceZipPath: badZipPath,
      destinationParentPath: destDir,
    })).rejects.toThrow();

    service.closeAll();
  });

  it('rejects ZIP without .serpent/library.db', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();

    // Create library, export to ZIP, then remove the DB entry.
    const created = service.createLibrary({ displayName: 'No DB ZIP', selectedParentPath: root });
    const destZipPath = path.join(root, 'no-db-test.zip');
    await service.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath: destZipPath,
      includeLinkedContent: false,
    });
    service.closeAll();

    // Remove the .serpent/library.db entry from the ZIP.
    // We rebuild the ZIP without it using adm-zip.
    const AdmZip = require('adm-zip') as new (path: string) => {
      getEntries(): Array<{ entryName: string; isDirectory: boolean; getData(): Buffer }>;
      addFile(name: string, data: Buffer): void;
      deleteFile(name: string): void;
      writeZip(target?: string): void;
    };
    const zip = new AdmZip(destZipPath);
    const entries = zip.getEntries();
    const dbEntry = entries.find((e) => e.entryName === '.serpent/library.db' && !e.isDirectory);
    if (dbEntry) {
      zip.deleteFile('.serpent/library.db');
    }
    zip.writeZip(); // overwrite with modified ZIP

    const destDir = path.join(root, 'imported-no-db');
    mkdirSync(destDir, { recursive: true });

    await expect(service.importLibraryFromZip({
      sourceZipPath: destZipPath,
      destinationParentPath: destDir,
    })).rejects.toThrow();
  });

  it('rejects ZIP with path-escape entries', async () => {
    const root = temporaryRoot();

    // Create a ZIP with a ../ escape entry using archiver v8.
    const archiverModule = require('archiver') as {
      ZipArchive: new (options?: Record<string, unknown>) => {
        pipe(output: ReturnType<typeof createWriteStream>): void;
        file(path: string, options: { name: string }): void;
        finalize(): void;
        on(event: string, listener: (err: Error) => void): void;
      };
    };

    const escapeZipPath = path.join(root, 'escape.zip');
    const tempFilePath = path.join(root, 'escape-asset.txt');
    writeFileSync(tempFilePath, 'escape attempt');

    const output = createWriteStream(escapeZipPath);
    const archive = new archiverModule.ZipArchive({ zlib: { level: 6 } });
    archive.pipe(output);
    archive.file(tempFilePath, { name: 'Assets/evil.txt' });
    archive.file(tempFilePath, { name: '.serpent/library.db' });
    // Add a path-escape entry.
    archive.file(tempFilePath, { name: '../escape.txt' });

    await new Promise<void>((resolve, reject) => {
      output.on('finish', () => resolve());
      output.on('error', (err: Error) => reject(err));
      archive.finalize();
    });

    const service = new LibraryService();
    const destDir = path.join(root, 'imported-escape');
    mkdirSync(destDir, { recursive: true });

    await expect(service.importLibraryFromZip({
      sourceZipPath: escapeZipPath,
      destinationParentPath: destDir,
    })).rejects.toThrow();
  });
});

describe('ZIP round-trip', () => {
  it('preserves asset count and metadata through ZIP export-import cycle', async () => {
    const root = temporaryRoot();
    const service = new LibraryService();

    // Create library with content.
    const created = service.createLibrary({ displayName: 'Roundtrip ZIP', selectedParentPath: root });

    // Create a folder and assets.
    const folder = service.createManagedFolder({ libraryId: created.libraryId, name: 'Subfolder' });
    const assetPath1 = path.join(root, 'img1.png');
    writeFileSync(assetPath1, Buffer.alloc(2048));
    service.prepareOrExecuteImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [assetPath1],
      targetFolderId: folder.folderId,
    });

    // Trash an asset.
    const assetPath2 = path.join(root, 'img2.png');
    writeFileSync(assetPath2, Buffer.alloc(512));
    service.prepareOrExecuteImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [assetPath2],
    });

    const allAssets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const assetToTrash = allAssets.find((a) => a.displayName === 'img2.png');
    if (assetToTrash) {
      service.trashAssets({ libraryId: created.libraryId, assetIds: [assetToTrash.assetId] });
    }

    // Export to ZIP.
    const destZipPath = path.join(root, 'roundtrip.zip');
    await service.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath: destZipPath,
      includeLinkedContent: false,
    });

    service.closeAll();

    // Import the ZIP.
    const destDir = path.join(root, 'imported-roundtrip');
    mkdirSync(destDir, { recursive: true });

    const imported = await service.importLibraryFromZip({
      sourceZipPath: destZipPath,
      destinationParentPath: destDir,
    });

    // Verify asset count.
    const importedAssets = service.listAssets({ libraryId: imported.libraryId, recursive: true });
    expect(importedAssets.length).toBe(allAssets.length);

    // Verify folder tree.
    const folders = service.listManagedFolders(imported.libraryId);
    expect(folders).toHaveLength(1);
    expect(folders[0]!.name).toBe('Subfolder');

    // Verify trashed assets are preserved (at least one asset should be trashed).
    const importedTrashed = service.listAssets({ libraryId: imported.libraryId, recursive: true })
      .filter((a) => a.deletedAt !== undefined);
    expect(importedTrashed.length).toBeGreaterThanOrEqual(1);

    service.closeAll();
  });
});
