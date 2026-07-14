import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  extractZipStream,
  ZipImportStreamError,
  type ZipImportProgress,
} from '../../src/worker/zip-import-stream';

const require = createRequire(import.meta.url);
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-stream-zip-test-'));
  temporaryRoots.push(root);
  return root;
}

async function createZip(
  zipPath: string,
  entries: Array<{ name: string; data: Buffer }>,
): Promise<void> {
  const archiverModule = require('archiver') as {
    ZipArchive: new (options?: Record<string, unknown>) => {
      append(data: Buffer, options: { name: string }): void;
      finalize(): void;
      on(event: string, listener: (error: Error) => void): void;
      pipe(output: ReturnType<typeof createWriteStream>): void;
    };
  };
  const output = createWriteStream(zipPath);
  const archive = new archiverModule.ZipArchive({ zlib: { level: 6 } });
  archive.pipe(output);
  for (const entry of entries) archive.append(entry.data, { name: entry.name });
  await new Promise<void>((resolve, reject) => {
    archive.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
    archive.finalize();
  });
}

function replaceZipEntryName(zipPath: string, originalName: string, replacementName: string): void {
  const original = Buffer.from(originalName);
  const replacement = Buffer.from(replacementName);
  expect(replacement.length).toBe(original.length);
  const archive = readFileSync(zipPath);
  let replacements = 0;
  for (
    let offset = archive.indexOf(original);
    offset >= 0;
    offset = archive.indexOf(original, offset + replacement.length)
  ) {
    replacement.copy(archive, offset);
    replacements += 1;
  }
  expect(replacements).toBeGreaterThanOrEqual(2);
  writeFileSync(zipPath, archive);
}

async function expectCode(
  operation: () => Promise<unknown>,
  code: ZipImportStreamError['code'],
): Promise<ZipImportStreamError> {
  let thrown: unknown;
  try {
    await operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ZipImportStreamError);
  expect((thrown as ZipImportStreamError).code).toBe(code);
  return thrown as ZipImportStreamError;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('extractZipStream', () => {
  it('keeps a missing source as an observable filesystem error with a cause', async () => {
    const root = temporaryRoot();
    const destinationRoot = path.join(root, 'destination');
    mkdirSync(destinationRoot);

    const error = await expectCode(
      () => extractZipStream({
        sourceZipPath: path.join(root, 'missing.zip'),
        destinationRoot,
      }),
      'IO_ERROR',
    );
    expect(error.cause).toMatchObject({ code: 'ENOENT' });
  });

  it('streams a large entry to disk and reports incremental byte progress', async () => {
    const root = temporaryRoot();
    const zipPath = path.join(root, 'large.zip');
    const destinationRoot = path.join(root, 'destination');
    mkdirSync(destinationRoot);
    const payload = randomBytes(2 * 1024 * 1024);
    await createZip(zipPath, [{ name: 'Assets/large.bin', data: payload }]);
    const progress: ZipImportProgress[] = [];

    const result = await extractZipStream({
      sourceZipPath: zipPath,
      destinationRoot,
      onProgress: (event) => progress.push(event),
    });

    expect(result).toEqual({ entryCount: 1, fileCount: 1, directoryCount: 0, totalBytes: payload.length });
    expect(readFileSync(path.join(destinationRoot, 'Assets', 'large.bin'))).toEqual(payload);
    expect(progress.filter((event) => event.phase === 'extract' && event.bytesProcessed > 0).length)
      .toBeGreaterThan(1);
  }, 30_000);

  it('rejects a path-escape entry before writing any archive content', async () => {
    const root = temporaryRoot();
    const zipPath = path.join(root, 'escape.zip');
    const destinationRoot = path.join(root, 'destination');
    mkdirSync(destinationRoot);
    const unsafeName = '../escape.txt';
    const placeholder = 'q'.repeat(Buffer.byteLength(unsafeName));
    await createZip(zipPath, [
      { name: 'Assets/safe.txt', data: Buffer.from('safe') },
      { name: placeholder, data: Buffer.from('escape') },
    ]);
    replaceZipEntryName(zipPath, placeholder, unsafeName);

    await expectCode(
      () => extractZipStream({ sourceZipPath: zipPath, destinationRoot }),
      'PATH_ESCAPE',
    );
    expect(existsSync(path.join(destinationRoot, 'Assets', 'safe.txt'))).toBe(false);
    expect(existsSync(path.join(root, 'escape.txt'))).toBe(false);
  });

  it.each(['..\\escape.txt', '/absolute.txt', 'C:\\drive.txt'])(
    'rejects the cross-platform path-escape form %s',
    async (unsafeName) => {
      const root = temporaryRoot();
      const zipPath = path.join(root, 'portable-escape.zip');
      const destinationRoot = path.join(root, 'destination');
      mkdirSync(destinationRoot);
      const placeholder = 'q'.repeat(Buffer.byteLength(unsafeName));
      await createZip(zipPath, [{ name: placeholder, data: Buffer.from('escape') }]);
      replaceZipEntryName(zipPath, placeholder, unsafeName);

      await expectCode(
        () => extractZipStream({ sourceZipPath: zipPath, destinationRoot }),
        'PATH_ESCAPE',
      );
    },
  );

  it('rejects symbolic-link entries during central-directory validation', async () => {
    const root = temporaryRoot();
    const zipPath = path.join(root, 'symlink.zip');
    const destinationRoot = path.join(root, 'destination');
    mkdirSync(destinationRoot);
    const AdmZip = require('adm-zip') as new () => {
      addFile(name: string, data: Buffer): { attr: number };
      writeZip(target: string): void;
    };
    const zip = new AdmZip();
    zip.addFile('Assets/safe.txt', Buffer.from('safe'));
    const link = zip.addFile('Assets/link', Buffer.from('../../outside'));
    link.attr = (0o120777 << 16) >>> 0;
    zip.writeZip(zipPath);

    await expectCode(
      () => extractZipStream({ sourceZipPath: zipPath, destinationRoot }),
      'SYMBOLIC_LINK_NOT_ALLOWED',
    );
    expect(existsSync(path.join(destinationRoot, 'Assets', 'safe.txt'))).toBe(false);
  });

  it('rejects a high compression ratio before writing any archive content', async () => {
    const root = temporaryRoot();
    const zipPath = path.join(root, 'bomb.zip');
    const destinationRoot = path.join(root, 'destination');
    mkdirSync(destinationRoot);
    await createZip(zipPath, [
      { name: 'Assets/safe.txt', data: Buffer.from('safe') },
      { name: 'Assets/bomb.bin', data: Buffer.alloc(2 * 1024 * 1024) },
    ]);

    await expectCode(
      () => extractZipStream({ sourceZipPath: zipPath, destinationRoot }),
      'ZIP_TOO_LARGE',
    );
    expect(existsSync(path.join(destinationRoot, 'Assets', 'safe.txt'))).toBe(false);
  });

  it('enforces central-directory entry and total-uncompressed-byte limits before writing', async () => {
    const root = temporaryRoot();
    const zipPath = path.join(root, 'limits.zip');
    await createZip(zipPath, [
      { name: 'Assets/one.bin', data: randomBytes(512) },
      { name: 'Assets/two.bin', data: randomBytes(512) },
    ]);

    const entryDestination = path.join(root, 'entry-destination');
    mkdirSync(entryDestination);
    await expectCode(
      () => extractZipStream({
        sourceZipPath: zipPath,
        destinationRoot: entryDestination,
        limits: { maxEntries: 1 },
      }),
      'ZIP_TOO_LARGE',
    );
    expect(existsSync(path.join(entryDestination, 'Assets'))).toBe(false);

    const byteDestination = path.join(root, 'byte-destination');
    mkdirSync(byteDestination);
    await expectCode(
      () => extractZipStream({
        sourceZipPath: zipPath,
        destinationRoot: byteDestination,
        limits: { maxUncompressedBytes: 700 },
      }),
      'ZIP_TOO_LARGE',
    );
    expect(existsSync(path.join(byteDestination, 'Assets'))).toBe(false);
  });

  it('cancels while streaming a chunk and removes only the incomplete file', async () => {
    const root = temporaryRoot();
    const zipPath = path.join(root, 'cancel.zip');
    const destinationRoot = path.join(root, 'destination');
    mkdirSync(destinationRoot);
    const controller = new AbortController();
    await createZip(zipPath, [{ name: 'Assets/large.bin', data: randomBytes(2 * 1024 * 1024) }]);

    await expectCode(
      () => extractZipStream({
        sourceZipPath: zipPath,
        destinationRoot,
        signal: controller.signal,
        onProgress: (event) => {
          if (event.phase === 'extract' && event.bytesProcessed > 0) controller.abort();
        },
      }),
      'CANCELLED',
    );
    expect(existsSync(destinationRoot)).toBe(true);
    expect(existsSync(path.join(destinationRoot, 'Assets', 'large.bin'))).toBe(false);
  });

  it('never overwrites or deletes an existing destination file', async () => {
    const root = temporaryRoot();
    const zipPath = path.join(root, 'existing.zip');
    const destinationRoot = path.join(root, 'destination');
    const destinationFile = path.join(destinationRoot, 'Assets', 'existing.bin');
    mkdirSync(path.dirname(destinationFile), { recursive: true });
    writeFileSync(destinationFile, 'user data');
    await createZip(zipPath, [{ name: 'Assets/existing.bin', data: Buffer.from('archive data') }]);

    await expectCode(
      () => extractZipStream({ sourceZipPath: zipPath, destinationRoot }),
      'DESTINATION_EXISTS',
    );
    expect(readFileSync(destinationFile, 'utf-8')).toBe('user data');
  });

  it('leaves completed entries for caller-controlled cleanup after a later failure', async () => {
    const root = temporaryRoot();
    const zipPath = path.join(root, 'partial.zip');
    const destinationRoot = path.join(root, 'destination');
    const existingFile = path.join(destinationRoot, 'Assets', 'existing.bin');
    mkdirSync(path.dirname(existingFile), { recursive: true });
    writeFileSync(existingFile, 'user data');
    await createZip(zipPath, [
      { name: 'Assets/completed.bin', data: Buffer.from('completed') },
      { name: 'Assets/existing.bin', data: Buffer.from('archive data') },
    ]);

    await expectCode(
      () => extractZipStream({ sourceZipPath: zipPath, destinationRoot }),
      'DESTINATION_EXISTS',
    );
    expect(readFileSync(path.join(destinationRoot, 'Assets', 'completed.bin'), 'utf-8'))
      .toBe('completed');
    expect(readFileSync(existingFile, 'utf-8')).toBe('user data');
  });
});
