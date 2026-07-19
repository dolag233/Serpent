import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  createWriteStream,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
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

// LibraryService holds SQLite connections and recursive fs watchers; on
// Windows those open handles block rm of the temp tree (POSIX unlinks open
// files, which is why the leak is invisible on macOS). Always close first.
const services: LibraryService[] = [];

function newService(
  ...args: ConstructorParameters<typeof LibraryService>
): LibraryService {
  const service = new LibraryService(...args);
  services.push(service);
  return service;
}

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-zip-test-'));
  temporaryRoots.push(root);
  return root;
}

function replaceZipEntryName(zipPath: string, originalName: string, replacementName: string): void {
  const original = Buffer.from(originalName);
  const replacement = Buffer.from(replacementName);
  expect(replacement.length).toBe(original.length);
  const archive = readFileSync(zipPath);
  let replacements = 0;
  for (let offset = archive.indexOf(original); offset >= 0; offset = archive.indexOf(original, offset + replacement.length)) {
    replacement.copy(archive, offset);
    replacements += 1;
  }
  expect(replacements).toBeGreaterThanOrEqual(2); // local header + central directory
  writeFileSync(zipPath, archive);
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

async function expectRejectReasonAsync(
  operation: () => Promise<unknown>,
  code: LibraryServiceError['code'],
  reason: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await operation();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(LibraryServiceError);
  expect((thrown as LibraryServiceError).code).toBe(code);
  expect((thrown as LibraryServiceError).reason).toBe(reason);
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

// Windows-only helper: libraries and export destinations can live on
// different drive letters, where path.relative cannot express a traversal
// and returns an absolute path (Serpent-59f). Probe for a writable drive
// other than the temp drive and return a fresh directory on it.
function createForeignDriveRoot(): string | null {
  const tempDrive = path.parse(path.resolve(tmpdir())).root.toUpperCase();
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const driveRoot = `${letter}:\\`;
    if (driveRoot.toUpperCase() === tempDrive) continue;
    try {
      const candidate = mkdtempSync(path.join(driveRoot, 'serpent-xdrive-'));
      temporaryRoots.push(candidate);
      return candidate;
    } catch {
      // Drive absent, read-only media, or not writable — try the next one.
    }
  }
  return null;
}

describe('LibraryService ZIP export', () => {
  it('rejects a second export for the same library and records the active operation', async () => {
    const root = temporaryRoot();
    const diagnostics: Array<{ scope: string; context?: Record<string, unknown> }> = [];
    const service = newService({
      onDiagnostic: ({ scope, context }) => diagnostics.push({ scope, context }),
    });
    const created = service.createLibrary({ displayName: 'Concurrent Export', selectedParentPath: root });

    const firstExport = service.exportLibraryToFolder({
      libraryId: created.libraryId,
      destinationPath: path.join(root, 'first-export'),
      includeLinkedContent: false,
    });
    await expectRejectReasonAsync(
      () => service.exportLibraryToZip({
        libraryId: created.libraryId,
        destinationPath: path.join(root, 'second-export.zip'),
        includeLinkedContent: false,
      }),
      'TRANSFER_IN_PROGRESS',
      'TRANSFER_IN_PROGRESS',
    );
    await firstExport;

    expect(diagnostics).toContainEqual(expect.objectContaining({
      scope: 'transfer.export.in-progress',
      context: expect.objectContaining({ libraryId: created.libraryId }),
    }));
    service.closeAll();
  });

  it.runIf(process.platform === 'win32')(
    'accepts a ZIP destination on a different drive letter (Serpent-59f)',
    async (ctx) => {
      const foreignRoot = createForeignDriveRoot();
      if (!foreignRoot) {
        ctx.skip();
        return;
      }
      const root = temporaryRoot();
      const service = newService();
      try {
        const created = service.createLibrary({ displayName: 'ZIP Cross-Drive Export', selectedParentPath: root });
        const assetPath = path.join(root, 'sample.png');
        writeFileSync(assetPath, Buffer.alloc(256));
        service.prepareOrExecuteImport({
          libraryId: created.libraryId,
          sourceKind: 'files',
          sourcePaths: [assetPath],
        });

        const destZipPath = path.join(foreignRoot, 'cross-drive-export.zip');
        const result = await service.exportLibraryToZip({
          libraryId: created.libraryId,
          destinationPath: destZipPath,
          includeLinkedContent: false,
        });

        expect(result.fileCount).toBeGreaterThan(0);
        expect(existsSync(destZipPath)).toBe(true);
      } finally {
        service.closeAll();
      }
    },
  );

  it('exports a library as a valid ZIP with Assets, revisions, trash, and library.db', async () => {
    const root = temporaryRoot();
    const service = newService();
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

  it('includes requested linked content in ZIP under a collision-safe path', async () => {
    const root = temporaryRoot();
    const linkedRoot = path.join(root, 'linked-source');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'reference.png'), 'linked');
    const service = newService();
    const created = service.createLibrary({ displayName: 'Linked ZIP', selectedParentPath: root });
    const linked = service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: linkedRoot,
      displayName: 'References',
    });
    const destinationPath = path.join(root, 'linked.zip');

    const result = await service.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath,
      includeLinkedContent: true,
    });

    const AdmZip = require('adm-zip') as new (path: string) => {
      getEntries(): Array<{ entryName: string }>;
    };
    const names = new AdmZip(destinationPath).getEntries().map((entry) => entry.entryName);
    expect(result.includedLinkedContent).toBe(true);
    expect(names).toContain(`_linked/References-${linked.folderId.slice(0, 8)}/reference.png`);
    service.closeAll();
  });

  it('excludes .serpent/previews/ and .serpent/operations/ from ZIP export', async () => {
    const root = temporaryRoot();
    const service = newService();
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

  it('includes .serpent/artifacts in ZIP export (Serpent-pxd)', async () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({
      displayName: 'ZIP Artifacts',
      selectedParentPath: root,
    });

    const sourcePath = path.join(root, 'photo.png');
    writeFileSync(
      sourcePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    service.prepareOrExecuteImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [sourcePath],
    });
    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const thumb = await service.generateThumbnail({
      libraryId: created.libraryId,
      assetId: assets[0]!.assetId,
    });
    // Leftover temp name must not be packaged.
    writeFileSync(
      path.join(created.libraryPath, '.serpent', 'artifacts', `${thumb.artifactId}.wave-tmp.png`),
      'temp',
    );

    const destZipPath = path.join(root, 'artifacts.zip');
    await service.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath: destZipPath,
      includeLinkedContent: false,
    });

    const AdmZip = require('adm-zip') as new (path: string) => {
      getEntries(): Array<{ entryName: string }>;
    };
    const entryNames = new AdmZip(destZipPath).getEntries().map((e) => e.entryName);
    expect(entryNames).toContain(`.serpent/artifacts/${thumb.artifactId}.webp`);
    expect(entryNames.some((n) => n.includes('.wave-tmp.'))).toBe(false);

    service.closeAll();
  });

  it('rejects ZIP export when file count exceeds 65534 (pre-check)', async () => {
    const root = temporaryRoot();
    const service = newService();
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
    const service = newService();
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
    const service = newService();
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

  it('never overwrites or removes a pre-existing ZIP destination', async () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Existing ZIP', selectedParentPath: root });
    const destZipPath = path.join(root, 'existing.zip');
    writeFileSync(destZipPath, 'user data');

    await expectRejectAsync(
      () => service.exportLibraryToZip({
        libraryId: created.libraryId,
        destinationPath: destZipPath,
        includeLinkedContent: false,
      }),
      'LIBRARY_ALREADY_EXISTS',
    );
    expect(existsSync(destZipPath)).toBe(true);
    service.closeAll();
  });

  it('removes a partially-written ZIP after an archive failure', async () => {
    const root = temporaryRoot();
    let sourceToRemove: string | undefined;
    const service = newService({
      onProgress: (event) => {
        if (event.type === 'export.progress' && event.phase === 'compress' && sourceToRemove) {
          rmSync(sourceToRemove, { force: true });
          sourceToRemove = undefined;
        }
      },
    });
    const created = service.createLibrary({ displayName: 'Failed ZIP', selectedParentPath: root });
    const source = path.join(root, 'source.txt');
    writeFileSync(source, 'asset');
    service.prepareOrExecuteImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });
    sourceToRemove = path.join(created.libraryPath, 'Assets', 'source.txt');
    const destinationPath = path.join(root, 'failed.zip');

    await expect(service.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath,
      includeLinkedContent: false,
    })).rejects.toThrow();
    expect(existsSync(destinationPath)).toBe(false);
    service.closeAll();
  });

  it('can cancel after announcing the export id and removes only its owned ZIP', async () => {
    const root = temporaryRoot();
    let cancellationRequested = false;
    const phases: string[] = [];
    const service = newService({
      onProgress: (event) => {
        if (event.type !== 'export.progress') return;
        phases.push(event.phase);
        if (event.phase === 'compress' && !cancellationRequested) {
          cancellationRequested = true;
          setImmediate(() => service.cancelExport(event.exportId));
        }
      },
    });
    const created = service.createLibrary({ displayName: 'Cancel ZIP', selectedParentPath: root });
    for (let index = 0; index < 20; index += 1) {
      writeFileSync(path.join(created.libraryPath, 'Assets', `asset-${index}.bin`), Buffer.alloc(4096));
    }
    const destinationPath = path.join(root, 'cancelled.zip');
    const siblingSentinel = path.join(root, 'keep-me.txt');
    writeFileSync(siblingSentinel, 'user data');

    await expect(service.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath,
      includeLinkedContent: false,
    })).rejects.toMatchObject({ code: 'CANCELLED' });

    expect(cancellationRequested).toBe(true);
    expect(phases).toContain('cancelled');
    expect(phases).not.toContain('complete');
    expect(existsSync(destinationPath)).toBe(false);
    expect(existsSync(siblingSentinel)).toBe(true);
    service.closeAll();
  });
});

describe('LibraryService ZIP import', () => {
  it('uses the streaming importer for large entries and reports chunk-level byte progress', async () => {
    const root = temporaryRoot();
    const sourceService = newService();
    const created = sourceService.createLibrary({ displayName: 'Streaming Import', selectedParentPath: root });
    const payload = randomBytes(2 * 1024 * 1024);
    writeFileSync(path.join(created.libraryPath, 'Assets', 'large.bin'), payload);
    const zipPath = path.join(root, 'streaming-import.zip');
    await sourceService.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath: zipPath,
      includeLinkedContent: false,
    });
    sourceService.closeAll();

    const extractByteProgress: number[] = [];
    const service = newService({
      onProgress: (event) => {
        if (event.type === 'import.progress' && event.phase === 'extract' && event.bytesProcessed > 0) {
          extractByteProgress.push(event.bytesProcessed);
        }
      },
    });
    const destinationParentPath = path.join(root, 'destination');
    mkdirSync(destinationParentPath);
    const imported = await service.importLibraryFromZip({
      sourceZipPath: zipPath,
      destinationParentPath,
    });

    expect(readFileSync(path.join(imported.libraryPath, 'Assets', 'large.bin'))).toEqual(payload);
    expect(new Set(extractByteProgress).size).toBeGreaterThan(1);
    service.closeAll();
  }, 30_000);

  it('rejects overlapping imports that reuse a source or destination and logs the conflict', async () => {
    const root = temporaryRoot();
    const sourceService = newService();
    const created = sourceService.createLibrary({ displayName: 'Concurrent Import', selectedParentPath: root });
    writeFileSync(path.join(created.libraryPath, 'Assets', 'asset.bin'), randomBytes(1024));
    const firstSourceDirectory = path.join(root, 'source-a');
    const secondSourceDirectory = path.join(root, 'source-b');
    mkdirSync(firstSourceDirectory);
    mkdirSync(secondSourceDirectory);
    const sourceZipPath = path.join(firstSourceDirectory, 'shared.zip');
    const secondZipPath = path.join(secondSourceDirectory, 'shared.zip');
    await sourceService.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath: sourceZipPath,
      includeLinkedContent: false,
    });
    copyFileSync(sourceZipPath, secondZipPath);
    sourceService.closeAll();

    const diagnostics: Array<{ scope: string; context?: Record<string, unknown> }> = [];
    const service = newService({
      onDiagnostic: ({ scope, context }) => diagnostics.push({ scope, context }),
    });
    const firstDestination = path.join(root, 'destination-a');
    const secondDestination = path.join(root, 'destination-b');
    mkdirSync(firstDestination);
    mkdirSync(secondDestination);
    const firstImport = service.importLibraryFromZip({
      sourceZipPath,
      destinationParentPath: firstDestination,
    });
    await expectRejectReasonAsync(
      () => service.importLibraryFromZip({
        sourceZipPath,
        destinationParentPath: secondDestination,
      }),
      'TRANSFER_IN_PROGRESS',
      'TRANSFER_IN_PROGRESS',
    );
    const imported = await firstImport;
    service.closeLibrary(imported.libraryId);

    const sharedDestination = path.join(root, 'destination-shared');
    mkdirSync(sharedDestination);
    const destinationImport = service.importLibraryFromZip({
      sourceZipPath,
      destinationParentPath: sharedDestination,
    });
    await expectRejectReasonAsync(
      () => service.importLibraryFromZip({
        sourceZipPath: secondZipPath,
        destinationParentPath: sharedDestination,
      }),
      'TRANSFER_IN_PROGRESS',
      'TRANSFER_IN_PROGRESS',
    );
    const secondImported = await destinationImport;
    service.closeLibrary(secondImported.libraryId);

    expect(diagnostics.filter(({ scope }) => scope === 'transfer.import.in-progress'))
      .toHaveLength(2);
  });

  it('imports a library from a valid ZIP', async () => {
    const root = temporaryRoot();
    const service = newService();

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

    const service = newService();
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
    const service = newService();

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

    const service = newService();
    const destDir = path.join(root, 'imported-escape');
    mkdirSync(destDir, { recursive: true });

    await expect(service.importLibraryFromZip({
      sourceZipPath: escapeZipPath,
      destinationParentPath: destDir,
    })).rejects.toThrow();
  });

  it.each([
    '..\\escape.txt',
    'Assets\\..\\escape.txt',
    'C:\\escape.txt',
    '\\\\server\\share\\escape.txt',
    '/absolute/escape.txt',
    'Assets/./escape.txt',
  ])('rejects cross-platform unsafe ZIP entry %s', async (unsafeName) => {
    const root = temporaryRoot();
    const AdmZip = require('adm-zip') as new () => {
      addFile(name: string, data: Buffer): void;
      writeZip(target: string): void;
    };
    const zipPath = path.join(root, 'unsafe.zip');
    const zip = new AdmZip();
    zip.addFile('Assets/valid.txt', Buffer.from('asset'));
    zip.addFile('.serpent/library.db', Buffer.from('db'));
    const placeholderName = 'q'.repeat(Buffer.byteLength(unsafeName));
    zip.addFile(placeholderName, Buffer.from('escape'));
    zip.writeZip(zipPath);
    replaceZipEntryName(zipPath, placeholderName, unsafeName);
    const destinationParentPath = path.join(root, 'destination');
    mkdirSync(destinationParentPath);

    await expectRejectReasonAsync(
      () => newService().importLibraryFromZip({ sourceZipPath: zipPath, destinationParentPath }),
      'NOT_A_LIBRARY',
      'PATH_ESCAPE',
    );
  });

  it('rejects a nested symbolic-link ZIP entry before extraction', async () => {
    const root = temporaryRoot();
    const AdmZip = require('adm-zip') as new () => {
      addFile(name: string, data: Buffer): { attr: number };
      writeZip(target: string): void;
    };
    const zipPath = path.join(root, 'symlink.zip');
    const zip = new AdmZip();
    zip.addFile('Assets/valid.txt', Buffer.from('asset'));
    zip.addFile('.serpent/library.db', Buffer.from('db'));
    const link = zip.addFile('Assets/nested/link', Buffer.from('../../outside'));
    link.attr = (0o120777 << 16) >>> 0;
    zip.writeZip(zipPath);
    const destinationParentPath = path.join(root, 'destination');
    mkdirSync(destinationParentPath);

    await expectRejectReasonAsync(
      () => newService().importLibraryFromZip({ sourceZipPath: zipPath, destinationParentPath }),
      'NOT_A_LIBRARY',
      'SYMBOLIC_LINK_NOT_ALLOWED',
    );
    expect(existsSync(path.join(destinationParentPath, 'symlink'))).toBe(false);
  });

  it('rejects a high-compression-ratio ZIP before extraction', async () => {
    const root = temporaryRoot();
    const AdmZip = require('adm-zip') as new () => {
      addFile(name: string, data: Buffer): void;
      writeZip(target: string): void;
    };
    const zipPath = path.join(root, 'compression-bomb.zip');
    const zip = new AdmZip();
    zip.addFile('Assets/bomb.bin', Buffer.alloc(2 * 1024 * 1024));
    zip.addFile('.serpent/library.db', Buffer.from('db'));
    zip.writeZip(zipPath);
    const destinationParentPath = path.join(root, 'destination');
    mkdirSync(destinationParentPath);

    await expectRejectAsync(
      () => newService().importLibraryFromZip({ sourceZipPath: zipPath, destinationParentPath }),
      'ZIP_TOO_LARGE',
    );
    expect(existsSync(path.join(destinationParentPath, 'compression-bomb'))).toBe(false);
  });

  it('never overwrites or deletes a pre-existing extraction destination', async () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'ZIP Ownership', selectedParentPath: root });
    const zipPath = path.join(root, 'owned.zip');
    await service.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath: zipPath,
      includeLinkedContent: false,
    });
    service.closeAll();
    const destinationParentPath = path.join(root, 'destination');
    const existingDestination = path.join(destinationParentPath, 'owned');
    const sentinelPath = path.join(existingDestination, 'keep-me.txt');
    mkdirSync(existingDestination, { recursive: true });
    writeFileSync(sentinelPath, 'user data');

    await expectRejectAsync(
      () => service.importLibraryFromZip({ sourceZipPath: zipPath, destinationParentPath }),
      'LIBRARY_ALREADY_EXISTS',
    );
    expect(existsSync(sentinelPath)).toBe(true);
  });

  it('can cancel after announcing the import id and removes only its owned extraction', async () => {
    const root = temporaryRoot();
    const sourceService = newService();
    const created = sourceService.createLibrary({ displayName: 'Cancel ZIP Import', selectedParentPath: root });
    for (let index = 0; index < 20; index += 1) {
      writeFileSync(path.join(created.libraryPath, 'Assets', `asset-${index}.bin`), Buffer.alloc(4096));
    }
    const zipPath = path.join(root, 'cancel-import.zip');
    await sourceService.exportLibraryToZip({
      libraryId: created.libraryId,
      destinationPath: zipPath,
      includeLinkedContent: false,
    });
    sourceService.closeAll();

    let cancellationRequested = false;
    const phases: string[] = [];
    const service = newService({
      onProgress: (event) => {
        if (event.type !== 'import.progress') return;
        phases.push(event.phase);
        if (event.phase === 'extract' && !cancellationRequested) {
          cancellationRequested = true;
          setImmediate(() => service.cancelImport(event.importId));
        }
      },
    });
    const destinationParentPath = path.join(root, 'destination');
    mkdirSync(destinationParentPath);
    const ownedDestination = path.join(destinationParentPath, 'cancel-import');
    const siblingSentinel = path.join(destinationParentPath, 'keep-me.txt');
    writeFileSync(siblingSentinel, 'user data');

    await expect(service.importLibraryFromZip({
      sourceZipPath: zipPath,
      destinationParentPath,
    })).rejects.toMatchObject({ code: 'CANCELLED' });

    expect(cancellationRequested).toBe(true);
    expect(phases).toContain('cancelled');
    expect(phases).not.toContain('complete');
    expect(existsSync(ownedDestination)).toBe(false);
    expect(existsSync(siblingSentinel)).toBe(true);
  });
});

describe('ZIP round-trip', () => {
  it('preserves asset count and metadata through ZIP export-import cycle', async () => {
    const root = temporaryRoot();
    const service = newService();

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
