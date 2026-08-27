import {
  closeSync,
  constants as fsConstants,
  createWriteStream,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';

import * as yauzl from 'yauzl';

import { pathIsWithin } from './path-utils';

const DEFAULT_MAX_ENTRIES = Number.MAX_SAFE_INTEGER;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = Number.MAX_SAFE_INTEGER;
const DEFAULT_MAX_COMPRESSION_RATIO = 100;
const DEFAULT_COMPRESSION_RATIO_MIN_SIZE = 1024 * 1024;
const FILESYSTEM_ERROR_CODES = new Set([
  'EACCES', 'EBUSY', 'EDQUOT', 'EIO', 'EMFILE', 'ENFILE', 'ENOENT', 'ENOSPC', 'ENOTDIR', 'EPERM', 'EROFS',
]);

export type ZipImportStreamErrorCode =
  | 'CANCELLED'
  | 'DESTINATION_EXISTS'
  | 'INVALID_ZIP'
  | 'IO_ERROR'
  | 'PATH_ESCAPE'
  | 'SYMBOLIC_LINK_NOT_ALLOWED'
  | 'ZIP_TOO_LARGE';

const ERROR_MESSAGES: Record<ZipImportStreamErrorCode, string> = {
  CANCELLED: 'ZIP extraction was cancelled.',
  DESTINATION_EXISTS: 'A ZIP entry would overwrite an existing destination.',
  INVALID_ZIP: 'The ZIP archive is malformed or unsupported.',
  IO_ERROR: 'The ZIP archive or extraction destination could not be accessed.',
  PATH_ESCAPE: 'A ZIP entry would escape the extraction destination.',
  SYMBOLIC_LINK_NOT_ALLOWED: 'ZIP symbolic-link entries are not allowed.',
  ZIP_TOO_LARGE: 'The ZIP archive exceeds the configured extraction limits.',
};

export class ZipImportStreamError extends Error {
  readonly code: ZipImportStreamErrorCode;

  constructor(code: ZipImportStreamErrorCode, options?: ErrorOptions) {
    super(ERROR_MESSAGES[code], options);
    this.name = 'ZipImportStreamError';
    this.code = code;
  }
}

export interface ZipImportLimits {
  maxEntries?: number;
  maxUncompressedBytes?: number;
  maxEntryUncompressedBytes?: number;
  maxCompressionRatio?: number;
  compressionRatioMinSize?: number;
}

/** Reject zip bombs; do not cap library size or entry count. */
export function zipBombProtectionLimits(): ZipImportLimits {
  return {
    maxEntries: DEFAULT_MAX_ENTRIES,
    maxUncompressedBytes: DEFAULT_MAX_UNCOMPRESSED_BYTES,
    maxEntryUncompressedBytes: DEFAULT_MAX_UNCOMPRESSED_BYTES,
    maxCompressionRatio: DEFAULT_MAX_COMPRESSION_RATIO,
    compressionRatioMinSize: DEFAULT_COMPRESSION_RATIO_MIN_SIZE,
  };
}

export interface ZipImportProgress {
  phase: 'scan' | 'extract';
  entryName?: string;
  entriesProcessed: number;
  totalEntries: number;
  bytesProcessed: number;
  totalBytes: number;
}

export interface ZipArchiveManifestEntry {
  name: string;
  isDirectory: boolean;
  compressedSize: number;
  uncompressedSize: number;
}

export interface ZipArchiveManifest {
  entries: readonly ZipArchiveManifestEntry[];
  totalBytes: number;
}

export interface ExtractZipStreamOptions {
  sourceZipPath: string;
  /** Existing directory owned and cleaned up by the caller. */
  destinationRoot: string;
  signal?: AbortSignal;
  limits?: ZipImportLimits;
  /** Runs after the full central directory is safe, but before any output is written. */
  validateManifest?: (manifest: ZipArchiveManifest) => void;
  onProgress?: (progress: ZipImportProgress) => void;
}

export interface ExtractZipStreamResult {
  entryCount: number;
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
}

interface ResolvedLimits {
  maxEntries: number;
  maxUncompressedBytes: number;
  maxEntryUncompressedBytes: number;
  maxCompressionRatio: number;
  compressionRatioMinSize: number;
}

interface PlannedEntry {
  entry: yauzl.Entry;
  portableName: string;
  isDirectory: boolean;
}

interface ArchivePlan {
  entries: PlannedEntry[];
  totalBytes: number;
  fileCount: number;
  directoryCount: number;
}

function resolvedLimits(input: ZipImportLimits | undefined): ResolvedLimits {
  const maxUncompressedBytes = input?.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;
  const limits: ResolvedLimits = {
    maxEntries: input?.maxEntries ?? DEFAULT_MAX_ENTRIES,
    maxUncompressedBytes,
    maxEntryUncompressedBytes: input?.maxEntryUncompressedBytes ?? maxUncompressedBytes,
    maxCompressionRatio: input?.maxCompressionRatio ?? DEFAULT_MAX_COMPRESSION_RATIO,
    compressionRatioMinSize:
      input?.compressionRatioMinSize ?? DEFAULT_COMPRESSION_RATIO_MIN_SIZE,
  };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('ZIP import limits must be non-negative safe integers.');
    }
  }
  if (limits.maxEntries === 0 || limits.maxUncompressedBytes === 0) {
    throw new TypeError('ZIP entry and byte limits must be greater than zero.');
  }
  return limits;
}

function cancelled(cause?: unknown): ZipImportStreamError {
  return new ZipImportStreamError('CANCELLED', cause === undefined ? undefined : { cause });
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw cancelled(signal.reason);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

function archiveError(error: unknown): ZipImportStreamError {
  if (error instanceof ZipImportStreamError) return error;
  if (isAbortError(error)) return cancelled(error);
  const message = error instanceof Error ? error.message : String(error);
  if (
    /invalid relative path|absolute path|invalid characters in fileName|backslash|\.\.[/\\]/iu.test(message)
  ) {
    return new ZipImportStreamError('PATH_ESCAPE', { cause: error });
  }
  return new ZipImportStreamError('INVALID_ZIP', { cause: error });
}

function extractionError(error: unknown): ZipImportStreamError {
  if (error instanceof ZipImportStreamError || isAbortError(error)) return archiveError(error);
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (typeof code === 'string' && FILESYSTEM_ERROR_CODES.has(code)) {
    return new ZipImportStreamError('IO_ERROR', { cause: error });
  }
  return archiveError(error);
}

function portableEntryName(fileName: string): { name: string; directoryByName: boolean } {
  if (fileName.length === 0 || fileName.includes('\0') || fileName.includes('\\')) {
    throw new ZipImportStreamError('PATH_ESCAPE');
  }
  if (fileName.startsWith('/') || fileName.startsWith('//') || /^[A-Za-z]:/u.test(fileName)) {
    throw new ZipImportStreamError('PATH_ESCAPE');
  }
  const directoryByName = fileName.endsWith('/');
  const withoutTrailingSlash = directoryByName ? fileName.slice(0, -1) : fileName;
  const segments = withoutTrailingSlash.split('/');
  if (
    withoutTrailingSlash.length === 0
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new ZipImportStreamError('PATH_ESCAPE');
  }
  const normalized = path.posix.normalize(withoutTrailingSlash);
  if (normalized !== withoutTrailingSlash || path.posix.isAbsolute(normalized)) {
    throw new ZipImportStreamError('PATH_ESCAPE');
  }
  return { name: normalized, directoryByName };
}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Some BillfishPack files contain UTF-8 names but omit ZIP's UTF-8 flag.
 * yauzl quite correctly treats an unflagged name as CP437, which turns
 * otherwise valid Chinese names into mojibake. Prefer a verified Unicode Path
 * extra field, then valid UTF-8, and retain yauzl's CP437 decoder as the
 * compatibility fallback for older archives.
 */
function decodeZipEntryName(entry: yauzl.Entry): string {
  const rawName = entry.fileNameRaw;
  const unicodePath = entry.extraFields.find((field) => field.id === 0x7075);
  if (unicodePath && unicodePath.data.length >= 5 && unicodePath.data[0] === 1) {
    const expectedCrc = unicodePath.data.readUInt32LE(1);
    if ((crc32(rawName) >>> 0) === expectedCrc) {
      try {
        return UTF8_DECODER.decode(unicodePath.data.subarray(5));
      } catch {
        // Fall through to the raw-name decoding path.
      }
    }
  }
  if ((entry.generalPurposeBitFlag & 0x800) !== 0) {
    return rawName.toString('utf8');
  }
  try {
    return UTF8_DECODER.decode(rawName);
  } catch {
    return yauzl.getFileNameLowLevel(
      entry.generalPurposeBitFlag,
      rawName,
      entry.extraFields,
      false,
    );
  }
}

function unixEntryType(entry: yauzl.Entry): number {
  return ((entry.externalFileAttributes >>> 16) & 0xffff) & 0o170000;
}

function collisionKey(portableName: string): string {
  return portableName.normalize('NFC').toLowerCase();
}

function validateEntry(
  entry: yauzl.Entry,
  limits: ResolvedLimits,
  totalBytes: number,
): { planned: PlannedEntry; nextTotalBytes: number } {
  const { name, directoryByName } = portableEntryName(decodeZipEntryName(entry));
  const entryType = unixEntryType(entry);
  if (entryType === 0o120000) {
    throw new ZipImportStreamError('SYMBOLIC_LINK_NOT_ALLOWED');
  }
  if (entryType !== 0 && entryType !== 0o040000 && entryType !== 0o100000) {
    throw new ZipImportStreamError('INVALID_ZIP');
  }
  const isDirectory = directoryByName || entryType === 0o040000;
  if (entry.isEncrypted() || !entry.canDecodeFileData()) {
    throw new ZipImportStreamError('INVALID_ZIP');
  }
  if (
    !Number.isSafeInteger(entry.uncompressedSize)
    || !Number.isSafeInteger(entry.compressedSize)
    || entry.uncompressedSize < 0
    || entry.compressedSize < 0
  ) {
    throw new ZipImportStreamError('ZIP_TOO_LARGE');
  }
  if (isDirectory && entry.uncompressedSize !== 0) {
    throw new ZipImportStreamError('INVALID_ZIP');
  }
  if (!isDirectory && entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
    throw new ZipImportStreamError('ZIP_TOO_LARGE');
  }
  const nextTotalBytes = totalBytes + entry.uncompressedSize;
  if (!Number.isSafeInteger(nextTotalBytes) || nextTotalBytes > limits.maxUncompressedBytes) {
    throw new ZipImportStreamError('ZIP_TOO_LARGE');
  }
  if (
    !isDirectory
    && entry.uncompressedSize >= limits.compressionRatioMinSize
    && entry.uncompressedSize / Math.max(entry.compressedSize, 1) > limits.maxCompressionRatio
  ) {
    throw new ZipImportStreamError('ZIP_TOO_LARGE');
  }
  return {
    planned: { entry, portableName: name, isDirectory },
    nextTotalBytes,
  };
}

async function planArchive(
  zipFile: yauzl.ZipFile,
  limits: ResolvedLimits,
  signal: AbortSignal | undefined,
): Promise<ArchivePlan> {
  if (zipFile.entryCount > limits.maxEntries) throw new ZipImportStreamError('ZIP_TOO_LARGE');
  const entries: PlannedEntry[] = [];
  const fileKeys = new Set<string>();
  const directoryKeys = new Set<string>();
  let totalBytes = 0;
  let fileCount = 0;
  let directoryCount = 0;

  try {
    for await (const entry of zipFile.eachEntry()) {
      throwIfCancelled(signal);
      if (entries.length >= limits.maxEntries) throw new ZipImportStreamError('ZIP_TOO_LARGE');
      const validated = validateEntry(entry, limits, totalBytes);
      const planned = validated.planned;
      totalBytes = validated.nextTotalBytes;
      const key = collisionKey(planned.portableName);
      const segments = key.split('/');
      for (let index = 1; index < segments.length; index += 1) {
        const parentKey = segments.slice(0, index).join('/');
        if (fileKeys.has(parentKey)) throw new ZipImportStreamError('INVALID_ZIP');
        directoryKeys.add(parentKey);
      }
      if (planned.isDirectory) {
        if (fileKeys.has(key)) throw new ZipImportStreamError('INVALID_ZIP');
        directoryKeys.add(key);
        directoryCount += 1;
      } else {
        if (fileKeys.has(key) || directoryKeys.has(key)) {
          throw new ZipImportStreamError('INVALID_ZIP');
        }
        fileKeys.add(key);
        fileCount += 1;
      }
      entries.push(planned);
    }
  } catch (error) {
    throw extractionError(error);
  }

  return { entries, totalBytes, fileCount, directoryCount };
}

function verifyDestinationRoot(destinationRoot: string): string {
  try {
    const stat = lstatSync(destinationRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new ZipImportStreamError('PATH_ESCAPE');
    }
    return realpathSync(destinationRoot);
  } catch (error) {
    if (error instanceof ZipImportStreamError) throw error;
    throw new ZipImportStreamError('IO_ERROR', { cause: error });
  }
}

function ensureDirectory(rootPath: string, portableDirectory: string): string {
  let currentPath = rootPath;
  if (portableDirectory.length === 0) return currentPath;
  for (const segment of portableDirectory.split('/')) {
    currentPath = path.join(currentPath, segment);
    try {
      const stat = lstatSync(currentPath);
      if (stat.isSymbolicLink()) throw new ZipImportStreamError('PATH_ESCAPE');
      if (!stat.isDirectory()) throw new ZipImportStreamError('DESTINATION_EXISTS');
    } catch (error) {
      if (error instanceof ZipImportStreamError) throw error;
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code !== 'ENOENT') throw new ZipImportStreamError('IO_ERROR', { cause: error });
      try {
        mkdirSync(currentPath);
      } catch (mkdirError) {
        const mkdirCode = mkdirError instanceof Error && 'code' in mkdirError
          ? mkdirError.code
          : undefined;
        if (mkdirCode !== 'EEXIST') {
          throw new ZipImportStreamError('IO_ERROR', { cause: mkdirError });
        }
      }
      const createdStat = lstatSync(currentPath);
      if (createdStat.isSymbolicLink()) throw new ZipImportStreamError('PATH_ESCAPE');
      if (!createdStat.isDirectory()) throw new ZipImportStreamError('DESTINATION_EXISTS');
    }
    const realCurrentPath = realpathSync(currentPath);
    if (!pathIsWithin(rootPath, realCurrentPath)) throw new ZipImportStreamError('PATH_ESCAPE');
  }
  return currentPath;
}

function exclusiveOutputFile(destinationPath: string, rootPath: string): number {
  const noFollow = 'O_NOFOLLOW' in fsConstants ? fsConstants.O_NOFOLLOW : 0;
  let fileDescriptor: number;
  try {
    fileDescriptor = openSync(
      destinationPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
      0o600,
    );
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'EEXIST' || code === 'EISDIR') {
      throw new ZipImportStreamError('DESTINATION_EXISTS', { cause: error });
    }
    if (code === 'ELOOP') throw new ZipImportStreamError('PATH_ESCAPE', { cause: error });
    throw new ZipImportStreamError('IO_ERROR', { cause: error });
  }
  try {
    if (!pathIsWithin(rootPath, realpathSync(destinationPath))) {
      throw new ZipImportStreamError('PATH_ESCAPE');
    }
    return fileDescriptor;
  } catch (error) {
    try { closeSync(fileDescriptor); } catch { /* Preserve the validation error. */ }
    try { rmSync(destinationPath, { force: true }); } catch { /* The caller still owns root cleanup. */ }
    if (error instanceof ZipImportStreamError) throw error;
    throw new ZipImportStreamError('IO_ERROR', { cause: error });
  }
}

async function extractFile(
  zipFile: yauzl.ZipFile,
  planned: PlannedEntry,
  destinationPath: string,
  destinationRoot: string,
  signal: AbortSignal | undefined,
  limits: ResolvedLimits,
  progress: {
    entriesProcessed: number;
    bytesProcessed: number;
    totalEntries: number;
    totalBytes: number;
    onProgress?: (progress: ZipImportProgress) => void;
  },
): Promise<number> {
  throwIfCancelled(signal);
  let readStream: Readable;
  try {
    readStream = await zipFile.openReadStreamPromise(planned.entry);
  } catch (error) {
    throw extractionError(error);
  }
  let fileDescriptor: number;
  try {
    throwIfCancelled(signal);
    fileDescriptor = exclusiveOutputFile(destinationPath, destinationRoot);
  } catch (error) {
    readStream.destroy();
    throw error;
  }
  let ownsDestination = true;
  let entryBytes = 0;
  let checksum = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        throwIfCancelled(signal);
        entryBytes += chunk.byteLength;
        const nextTotal = progress.bytesProcessed + entryBytes;
        if (
          entryBytes > planned.entry.uncompressedSize
          || entryBytes > limits.maxEntryUncompressedBytes
          || nextTotal > limits.maxUncompressedBytes
        ) {
          callback(new ZipImportStreamError('ZIP_TOO_LARGE'));
          return;
        }
        checksum = crc32(chunk, checksum);
        progress.onProgress?.({
          phase: 'extract',
          entryName: planned.portableName,
          entriesProcessed: progress.entriesProcessed,
          totalEntries: progress.totalEntries,
          bytesProcessed: nextTotal,
          totalBytes: progress.totalBytes,
        });
        throwIfCancelled(signal);
        callback(null, chunk);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
  const writer = createWriteStream(destinationPath, {
    fd: fileDescriptor,
    autoClose: true,
  });

  try {
    await pipeline(readStream, meter, writer, signal ? { signal } : {});
    if (
      entryBytes !== planned.entry.uncompressedSize
      || (checksum >>> 0) !== (planned.entry.crc32 >>> 0)
    ) {
      throw new ZipImportStreamError('INVALID_ZIP');
    }
    ownsDestination = false;
    return entryBytes;
  } catch (error) {
    throw extractionError(error);
  } finally {
    if (!writer.closed) {
      try { writer.destroy(); } catch { /* Preserve the primary error. */ }
    }
    if (ownsDestination) {
      try { rmSync(destinationPath, { force: true }); } catch { /* Caller still owns root cleanup. */ }
    }
  }
}

/**
 * Validate a ZIP central directory, then stream each file into an existing
 * caller-owned destination. Completed entries and directories are deliberately
 * left in place on failure so the caller retains cleanup policy and ownership.
 */
export async function extractZipStream(
  options: ExtractZipStreamOptions,
): Promise<ExtractZipStreamResult> {
  const limits = resolvedLimits(options.limits);
  throwIfCancelled(options.signal);
  const destinationRoot = verifyDestinationRoot(options.destinationRoot);
  let zipFile: yauzl.ZipFile;
  try {
    zipFile = await yauzl.openPromise(options.sourceZipPath, {
      autoClose: false,
      lazyEntries: true,
      // Decode names ourselves. BillfishPack archives in the wild can store
      // UTF-8 bytes without setting the ZIP UTF-8 flag.
      decodeStrings: false,
      validateEntrySizes: true,
      strictFileNames: false,
    });
  } catch (error) {
    throw extractionError(error);
  }

  try {
    const plan = await planArchive(zipFile, limits, options.signal);
    options.validateManifest?.({
      entries: plan.entries.map(({ entry, portableName, isDirectory }) => ({
        name: portableName,
        isDirectory,
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
      })),
      totalBytes: plan.totalBytes,
    });
    options.onProgress?.({
      phase: 'scan',
      entriesProcessed: 0,
      totalEntries: plan.entries.length,
      bytesProcessed: 0,
      totalBytes: plan.totalBytes,
    });
    throwIfCancelled(options.signal);

    let entriesProcessed = 0;
    let bytesProcessed = 0;
    for (const planned of plan.entries) {
      throwIfCancelled(options.signal);
      const parentName = path.posix.dirname(planned.portableName);
      if (planned.isDirectory) {
        ensureDirectory(destinationRoot, planned.portableName);
      } else {
        const parentPath = ensureDirectory(
          destinationRoot,
          parentName === '.' ? '' : parentName,
        );
        const realParent = realpathSync(parentPath);
        if (!pathIsWithin(destinationRoot, realParent)) {
          throw new ZipImportStreamError('PATH_ESCAPE');
        }
        const destinationPath = path.join(parentPath, path.posix.basename(planned.portableName));
        const written = await extractFile(
          zipFile,
          planned,
          destinationPath,
          destinationRoot,
          options.signal,
          limits,
          {
            entriesProcessed,
            bytesProcessed,
            totalEntries: plan.entries.length,
            totalBytes: plan.totalBytes,
            onProgress: options.onProgress,
          },
        );
        bytesProcessed += written;
      }
      entriesProcessed += 1;
      options.onProgress?.({
        phase: 'extract',
        entryName: planned.portableName,
        entriesProcessed,
        totalEntries: plan.entries.length,
        bytesProcessed,
        totalBytes: plan.totalBytes,
      });
    }

    return {
      entryCount: plan.entries.length,
      fileCount: plan.fileCount,
      directoryCount: plan.directoryCount,
      totalBytes: bytesProcessed,
    };
  } catch (error) {
    throw archiveError(error);
  } finally {
    try { zipFile.close(); } catch { /* Preserve the primary operation result. */ }
  }
}

/**
 * Sum uncompressed sizes from the ZIP central directory without writing files.
 * Used to preflight staging-disk space before Eagle/Billfish archive extract.
 */
export async function inspectZipUncompressedBytes(sourceZipPath: string): Promise<number> {
  let zipFile: yauzl.ZipFile;
  try {
    zipFile = await yauzl.openPromise(sourceZipPath, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: false,
      validateEntrySizes: true,
      strictFileNames: false,
    });
  } catch (error) {
    throw extractionError(error);
  }
  try {
    const plan = await planArchive(zipFile, resolvedLimits(zipBombProtectionLimits()), undefined);
    return plan.totalBytes;
  } catch (error) {
    throw archiveError(error);
  } finally {
    try { zipFile.close(); } catch { /* Preserve the primary operation result. */ }
  }
}
