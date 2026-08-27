import path from 'node:path';
import { tmpdir } from 'node:os';
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

import {
  extractZipStream,
  inspectZipUncompressedBytes,
  zipBombProtectionLimits,
  ZipImportStreamError,
} from '../worker/zip-import-stream';
import type { PublicErrorCode, PublicErrorReason } from '../shared/protocol/errors';
import { publicReasonFromError } from '../shared/protocol/errors';
import {
  ensureStagingParent,
  errorHasCode,
  estimateNonZipExtractBytes,
  EXTERNAL_LIBRARY_STAGING_PREFIX,
  isInsufficientSpaceError,
  isManagedExternalLibraryStagingPath,
  isRetryableDirectoryRemoveError,
  isStagingPermissionError,
  listExternalLibraryStagingParents,
  requiredStagingBytes,
} from './disk-free-space';

const require = createRequire(__filename);

/** Non-streamable formats (RAR/7z/TAR) are loaded entirely into memory. */
const MAX_IN_MEMORY_ARCHIVE_BYTES = 1_024 * 1024 * 1024;
const MAX_LIBRARY_ROOT_DEPTH = 5;
const REMOVE_RETRY_DELAYS_MS = [50, 150, 400, 800, 1_600];

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
  readonly publicCode: PublicErrorCode;
  readonly reason?: PublicErrorReason;

  constructor(
    message: string,
    options?: {
      cause?: unknown;
      publicCode?: PublicErrorCode;
      reason?: PublicErrorReason;
    },
  ) {
    super(message, options);
    this.name = 'ExternalLibraryArchiveError';
    this.publicCode = options?.publicCode ?? 'INVALID_IMPORT_SOURCE';
    this.reason = options?.reason;
  }
}

export type MaterializedExternalLibrarySource = {
  readonly sourceRootPath: string;
  readonly archivePath?: string;
  /** Display-name fallback for formats that do not carry a library name. */
  readonly sourceDisplayName?: string;
  /** Main-owned extract root; absent when the user selected a folder. */
  readonly extractionRoot?: string;
  readonly cleanup: () => Promise<void>;
};

function isArchivePath(sourcePath: string): boolean {
  return ARCHIVE_EXTENSIONS.has(path.extname(sourcePath).toLocaleLowerCase());
}

function isBillfishPackPath(sourcePath: string): boolean {
  return sourcePath.toLocaleLowerCase().endsWith('.billfishpack');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function removeExternalLibraryStagingDirectory(directoryPath: string): Promise<void> {
  const resolved = path.resolve(directoryPath);
  if (!isManagedExternalLibraryStagingPath(resolved)) {
    throw new ExternalLibraryArchiveError('Refusing to delete a directory that is not a Serpent extract staging root.', {
      publicCode: 'INTERNAL_ERROR',
    });
  }
  let lastError: unknown;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(resolved, { recursive: true, force: true });
      return;
    } catch (error) {
      if (errorHasCode(error, 'ENOENT')) return;
      lastError = error;
      const delayMs = REMOVE_RETRY_DELAYS_MS[attempt];
      if (!isRetryableDirectoryRemoveError(error) || delayMs === undefined) {
        throw error;
      }
      await delay(delayMs);
    }
  }
}

function wrapExtractError(error: unknown, fallbackMessage: string): ExternalLibraryArchiveError {
  if (error instanceof ExternalLibraryArchiveError) return error;
  if (error instanceof ZipImportStreamError) {
    if (error.code === 'ZIP_TOO_LARGE') {
      return new ExternalLibraryArchiveError('The archive exceeds the configured extraction limits.', {
        cause: error,
        publicCode: 'ZIP_TOO_LARGE',
      });
    }
    if (error.code === 'PATH_ESCAPE') {
      return new ExternalLibraryArchiveError('The archive contains a path traversal entry.', {
        cause: error,
        publicCode: 'INVALID_IMPORT_SOURCE',
      });
    }
    if (error.code === 'SYMBOLIC_LINK_NOT_ALLOWED') {
      return new ExternalLibraryArchiveError('Symbolic links and hard links are not supported in external libraries.', {
        cause: error,
        publicCode: 'INVALID_IMPORT_SOURCE',
        reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
      });
    }
  }
  if (isInsufficientSpaceError(error) || publicReasonFromError(error) === 'DISK_FULL') {
    return new ExternalLibraryArchiveError('Not enough free space to unpack the selected library.', {
      cause: error,
      publicCode: 'DISK_FULL',
      reason: 'DISK_FULL',
    });
  }
  if (isStagingPermissionError(error)) {
    return new ExternalLibraryArchiveError('Serpent could not write the temporary extract directory.', {
      cause: error,
      publicCode: 'LIBRARY_NOT_WRITABLE',
      reason: publicReasonFromError(error),
    });
  }
  return new ExternalLibraryArchiveError(fallbackMessage, {
    cause: error,
    publicCode: 'INVALID_IMPORT_SOURCE',
  });
}

function diskFullError(cause?: unknown): ExternalLibraryArchiveError {
  return new ExternalLibraryArchiveError(
    'Not enough free space to unpack the selected library.',
    { cause, publicCode: 'DISK_FULL', reason: 'DISK_FULL' },
  );
}

function normalizeArchiveEntryPath(rawPath: string): string {
  const normalizedSlashes = rawPath.replaceAll('\\', '/');
  if (
    normalizedSlashes.includes('\u0000')
    || normalizedSlashes.startsWith('/')
    || /^[A-Za-z]:\//u.test(normalizedSlashes)
  ) {
    throw new ExternalLibraryArchiveError('The archive contains an unsafe absolute path.');
  }
  const normalized = path.posix.normalize(normalizedSlashes);
  if (
    normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.includes('/../')
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
      throw wrapExtractError(error, 'Could not read the selected ZIP archive.');
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
        throw new ExternalLibraryArchiveError('Symbolic links and hard links are not supported in external libraries.', {
          reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
        });
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
    throw wrapExtractError(error, 'Could not read the selected archive.');
  } finally {
    reader?.free();
  }
}

async function estimateExtractBytes(archivePath: string): Promise<number> {
  const archiveStat = await lstat(archivePath);
  if (STREAMABLE_ZIP_EXTENSIONS.has(path.extname(archivePath).toLocaleLowerCase())) {
    try {
      return await inspectZipUncompressedBytes(archivePath);
    } catch (error) {
      throw wrapExtractError(error, 'Could not read the selected ZIP archive.');
    }
  }
  return estimateNonZipExtractBytes(archiveStat.size);
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
    { publicCode: 'NOT_A_LIBRARY' },
  );
}

async function createStagingDirectory(
  parents: readonly string[],
  skippedPreferredForSpace: boolean,
): Promise<string> {
  let lastError: unknown;
  let sawSpaceError = skippedPreferredForSpace;
  let sawPermissionError = false;
  for (const parent of parents) {
    try {
      await ensureStagingParent(parent);
      return await mkdtemp(path.join(parent, EXTERNAL_LIBRARY_STAGING_PREFIX));
    } catch (error) {
      lastError = error;
      if (isInsufficientSpaceError(error)) {
        sawSpaceError = true;
        continue;
      }
      if (isStagingPermissionError(error)) {
        sawPermissionError = true;
        continue;
      }
      throw wrapExtractError(error, 'Could not prepare the external library archive.');
    }
  }
  if (sawSpaceError) throw diskFullError(lastError);
  if (sawPermissionError) {
    throw new ExternalLibraryArchiveError('Serpent could not write the temporary extract directory.', {
      cause: lastError,
      publicCode: 'LIBRARY_NOT_WRITABLE',
      reason: publicReasonFromError(lastError),
    });
  }
  throw wrapExtractError(lastError, 'Could not prepare the external library archive.');
}

export async function materializeExternalLibrarySource(input: {
  readonly sourcePath: string;
  readonly kind: ExternalLibraryKind;
  readonly tempDirectory?: string;
  readonly preferredTempDirectory?: string;
  readonly fallbackTempDirectory?: string;
  readonly probeFreeBytes?: (directoryPath: string) => Promise<number | undefined>;
  readonly pathsShareVolume?: (leftPath: string, rightPath: string) => Promise<boolean>;
  readonly registerStagingRoot?: (root: string) => void;
  readonly unregisterStagingRoot?: (root: string) => void;
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

  const preferredParent = path.resolve(
    input.preferredTempDirectory ?? input.tempDirectory ?? tmpdir(),
  );
  const estimatedBytes = await estimateExtractBytes(sourcePath);
  const requiredBytes = requiredStagingBytes(estimatedBytes);
  const { parents, skippedPreferredForSpace } = await listExternalLibraryStagingParents({
    preferredParent,
    fallbackParent: input.fallbackTempDirectory,
    requiredBytes,
    probeFreeBytes: input.probeFreeBytes,
    pathsShareVolume: input.pathsShareVolume,
  });
  if (parents.length === 0) throw diskFullError();

  const tempRoot = await createStagingDirectory(parents, skippedPreferredForSpace);
  input.registerStagingRoot?.(tempRoot);
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    await removeExternalLibraryStagingDirectory(tempRoot);
    cleaned = true;
    input.unregisterStagingRoot?.(tempRoot);
  };
  try {
    await extractArchive(sourcePath, tempRoot);
    const sourceRootPath = await findLibraryRoot(input.kind, tempRoot);
    return {
      sourceRootPath,
      archivePath: sourcePath,
      extractionRoot: tempRoot,
      ...(input.kind === 'billfish'
        ? { sourceDisplayName: path.parse(sourcePath).name }
        : {}),
      cleanup,
    };
  } catch (error) {
    try {
      await cleanup();
    } catch {
      // Keep the original extract error. Startup sweep retries leftovers.
    }
    throw wrapExtractError(error, 'Could not prepare the external library archive.');
  }
}

export async function sweepOrphanExternalLibraryStaging(input: {
  readonly registeredRoots: readonly string[];
  readonly searchParents?: readonly string[];
  readonly liveRoots?: ReadonlySet<string>;
  readonly removeDirectory?: (directoryPath: string) => Promise<void>;
}): Promise<{
  readonly removed: string[];
  readonly remaining: string[];
  readonly failed: string[];
}> {
  const liveRoots = input.liveRoots ?? new Set<string>();
  const remove = input.removeDirectory ?? removeExternalLibraryStagingDirectory;
  const candidates = new Set<string>();
  for (const root of input.registeredRoots) {
    if (isManagedExternalLibraryStagingPath(root)) candidates.add(path.resolve(root));
  }
  for (const searchParent of input.searchParents ?? []) {
    try {
      const entries = await readdir(searchParent, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith(EXTERNAL_LIBRARY_STAGING_PREFIX)) continue;
        candidates.add(path.resolve(searchParent, entry.name));
      }
    } catch (error) {
      if (errorHasCode(error, 'ENOENT')) continue;
      throw error;
    }
  }

  const removed: string[] = [];
  const remaining: string[] = [];
  const failed: string[] = [];
  for (const candidate of candidates) {
    if (liveRoots.has(candidate)) {
      remaining.push(candidate);
      continue;
    }
    try {
      await remove(candidate);
      removed.push(candidate);
    } catch (error) {
      if (errorHasCode(error, 'ENOENT')) {
        removed.push(candidate);
        continue;
      }
      failed.push(candidate);
      remaining.push(candidate);
    }
  }
  return { removed, remaining, failed };
}
