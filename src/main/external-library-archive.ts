import path from 'node:path';
import { createRequire } from 'node:module';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';

import { ArchiveReader, libarchiveWasm } from 'libarchive-wasm';
import { extractZipStream, zipBombProtectionLimits } from '../worker/zip-import-stream';

// Main is emitted as CommonJS by Vite. Using the runtime filename keeps this
// resolvable in both development and packaged ASAR builds (Vite rewrites
// `import.meta.url` to an unusable empty object for this target).
const require = createRequire(__filename);

/** Non-streamable formats (RAR/7z/TAR) are loaded entirely into memory. */
const MAX_IN_MEMORY_ARCHIVE_BYTES = 1_024 * 1024 * 1024;
const MAX_LIBRARY_ROOT_DEPTH = 5;

const ARCHIVE_EXTENSIONS = new Set([
  '.zip',
  '.eaglepack',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.tbz',
  '.tbz2',
  '.xz',
  '.txz',
]);

const STREAMABLE_ZIP_EXTENSIONS = new Set(['.zip', '.billfishpack', '.eaglepack']);

export type ExternalLibraryKind = 'eagle' | 'billfish';

export class ExternalLibraryArchiveError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExternalLibraryArchiveError';
  }
}

export type MaterializedExternalLibrarySource = {
  readonly sourceRootPath: string;
  readonly archivePath?: string;
  /** Display-name fallback for formats that do not carry a library name. */
  readonly sourceDisplayName?: string;
  readonly cleanup: () => Promise<void>;
};

function isArchivePath(sourcePath: string): boolean {
  return ARCHIVE_EXTENSIONS.has(path.extname(sourcePath).toLocaleLowerCase());
}

function isBillfishPackPath(sourcePath: string): boolean {
  return sourcePath.toLocaleLowerCase().endsWith('.billfishpack');
}

function normalizeArchiveEntryPath(rawPath: string): string {
  const normalizedSlashes = rawPath.replaceAll('\\', '/');
  if (
    normalizedSlashes.includes('\u0000') ||
    normalizedSlashes.startsWith('/') ||
    /^[A-Za-z]:\//u.test(normalizedSlashes)
  ) {
    throw new ExternalLibraryArchiveError('The archive contains an unsafe absolute path.');
  }
  const normalized = path.posix.normalize(normalizedSlashes);
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new ExternalLibraryArchiveError('The archive contains a path traversal entry.');
  }
  return normalized;
}

function isDirectoryEntry(entry: { getFiletype: () => string }): boolean {
  return entry.getFiletype().toLocaleLowerCase() === 'directory';
}

function safeOutputPath(root: string, relativePath: string): string {
  const outputPath = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, outputPath);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ExternalLibraryArchiveError('The archive entry escaped the extraction directory.');
  }
  return outputPath;
}

async function extractArchive(archivePath: string, destinationRoot: string): Promise<void> {
  const archiveStat = await lstat(archivePath);
  if (!archiveStat.isFile()) {
    throw new ExternalLibraryArchiveError('The selected archive is not a regular file.');
  }
  if (STREAMABLE_ZIP_EXTENSIONS.has(path.extname(archivePath).toLocaleLowerCase())) {
    try {
      await extractZipStream({
        sourceZipPath: archivePath,
        destinationRoot,
        limits: zipBombProtectionLimits(),
      });
      return;
    } catch (error) {
      if (error instanceof ExternalLibraryArchiveError) throw error;
      throw new ExternalLibraryArchiveError('Could not read the selected ZIP archive.', { cause: error });
    }
  }

  if (archiveStat.size > MAX_IN_MEMORY_ARCHIVE_BYTES) {
    throw new ExternalLibraryArchiveError(
      'This archive format is loaded entirely into memory. Extract it to a folder first, then open that folder.',
    );
  }

  let reader: ArchiveReader | undefined;
  try {
    const data = new Int8Array(await readFile(archivePath));
    const modulePath = path.join(path.dirname(require.resolve('libarchive-wasm')), 'libarchive.wasm');
    const libarchive = await libarchiveWasm({
      locateFile: (fileName: string) => fileName === 'libarchive.wasm' ? modulePath : fileName,
    });
    reader = new ArchiveReader(libarchive, data);
    for (const entry of reader.entries()) {
      const relativePath = normalizeArchiveEntryPath(entry.getPathname());
      const outputPath = safeOutputPath(destinationRoot, relativePath);
      const symlinkTarget = entry.getSymlinkTarget();
      const hardlinkTarget = entry.getHardlinkTarget();
      if (symlinkTarget || hardlinkTarget || entry.getFiletype().toLocaleLowerCase().includes('link')) {
        throw new ExternalLibraryArchiveError('Symbolic links and hard links are not supported in external libraries.');
      }
      if (isDirectoryEntry(entry)) {
        await mkdir(outputPath, { recursive: true });
        continue;
      }
      const entrySize = entry.getSize();
      if (!Number.isSafeInteger(entrySize) || entrySize < 0) {
        throw new ExternalLibraryArchiveError('The archive contains an unreadable entry.');
      }
      const contents = entry.readData();
      if (!contents && entrySize !== 0) {
        throw new ExternalLibraryArchiveError('The archive contains an unreadable entry.');
      }
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, contents ? Buffer.from(contents) : Buffer.alloc(0));
    }
  } catch (error) {
    if (error instanceof ExternalLibraryArchiveError) throw error;
    throw new ExternalLibraryArchiveError('Could not read the selected archive.', { cause: error });
  } finally {
    reader?.free();
  }
}

function looksLikeLibraryRoot(kind: ExternalLibraryKind, directoryPath: string, names: Set<string>): boolean {
  if (kind === 'billfish') return names.has('.bf');
  return names.has('metadata.json') && names.has('images');
}

async function findLibraryRoot(kind: ExternalLibraryKind, extractionRoot: string): Promise<string> {
  const queue: Array<{ directoryPath: string; depth: number }> = [{
    directoryPath: extractionRoot,
    depth: 0,
  }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current.directoryPath, { withFileTypes: true });
    const names = new Set(entries.map((entry) => entry.name.toLocaleLowerCase()));
    if (looksLikeLibraryRoot(kind, current.directoryPath, names)) return current.directoryPath;
    if (current.depth >= MAX_LIBRARY_ROOT_DEPTH) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      queue.push({
        directoryPath: path.join(current.directoryPath, entry.name),
        depth: current.depth + 1,
      });
    }
  }
  throw new ExternalLibraryArchiveError(
    kind === 'billfish'
      ? 'The archive does not contain a Billfish library (.bf).'
      : 'The archive does not contain an Eagle library (metadata.json and images).',
  );
}

export async function materializeExternalLibrarySource(input: {
  readonly sourcePath: string;
  readonly kind: ExternalLibraryKind;
  readonly tempDirectory?: string;
}): Promise<MaterializedExternalLibrarySource> {
  const sourcePath = path.resolve(input.sourcePath);
  const sourceStat = await lstat(sourcePath);
  if (sourceStat.isDirectory()) {
    if (input.kind === 'billfish') {
      throw new ExternalLibraryArchiveError('Billfish libraries must be selected as a .BillfishPack file.');
    }
    return {
      sourceRootPath: sourcePath,
      cleanup: async () => undefined,
    };
  }
  const archiveAllowed = input.kind === 'billfish'
    ? isBillfishPackPath(sourcePath)
    : isArchivePath(sourcePath);
  if (!archiveAllowed) {
    throw new ExternalLibraryArchiveError(
      input.kind === 'billfish'
        ? 'Billfish libraries must be selected as a .BillfishPack file.'
        : 'Eagle libraries must be a folder or a supported archive file.',
    );
  }
  const tempRoot = await mkdtemp(path.join(input.tempDirectory ?? path.dirname(sourcePath), 'serpent-external-library-'));
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  };
  try {
    await extractArchive(sourcePath, tempRoot);
    const sourceRootPath = await findLibraryRoot(input.kind, tempRoot);
    return {
      sourceRootPath,
      archivePath: sourcePath,
      ...(input.kind === 'billfish'
        ? { sourceDisplayName: path.parse(sourcePath).name }
        : {}),
      cleanup,
    };
  } catch (error) {
    await cleanup();
    if (error instanceof ExternalLibraryArchiveError) throw error;
    throw new ExternalLibraryArchiveError('Could not prepare the external library archive.', { cause: error });
  }
}
