import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Dirent,
  type BigIntStats,
} from 'node:fs';
import path from 'node:path';

import { normalizeAbsolutePath } from './library-rules';

const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_ITEM_DESCRIPTION_LENGTH = 10_000;
const MAX_TAG_LENGTH = 255;
const MAX_URL_LENGTH = 8_192;

export class EagleLibraryReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EagleLibraryReadError';
  }
}

export interface EagleFolderNode {
  folderId: string;
  parentFolderId: string | null;
  name: string;
  description: string | null;
}

export interface EagleAssetCandidate {
  itemId: string;
  sourcePath: string;
  /** Eagle's still preview; videos use this as a poster instead of encoding. */
  thumbnailPath: string | null;
  fileName: string;
  byteSize: number;
  sourceModifiedAtMs: number;
  description: string | null;
  rating: number;
  sourcePageUrl: string | null;
  tags: string[];
  folderIds: string[];
  width: number | null;
  height: number | null;
}

export interface EagleLibrarySnapshot {
  displayName: string;
  sourceRootPath: string;
  folders: EagleFolderNode[];
  items: EagleAssetCandidate[];
  skippedCount: number;
  invalidCount: number;
}

export interface EagleLibraryRoot {
  displayName: string;
  sourceRootPath: string;
  folders: EagleFolderNode[];
  imagesPath: string | null;
  infoDirectoryNames: string[];
}

export type EagleItemReadResult =
  | { item: EagleAssetCandidate }
  | { skipped: true; invalid: boolean };

interface JsonObject {
  [key: string]: unknown;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  // Keep annotation line breaks, but remove NUL and the other non-printing
  // controls that cannot survive a portable library round-trip.
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

function stringArray(value: unknown, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const text = textValue(item, maxLength);
    if (text === '' || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function epochMilliseconds(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function ratingValue(value: unknown): number {
  const number = finiteNumber(value);
  if (number === undefined) return 0;
  return Math.max(0, Math.min(5, Math.trunc(number)));
}

function positiveDimension(value: unknown): number | null {
  const number = finiteNumber(value);
  if (number === undefined || number < 1) return null;
  const truncated = Math.trunc(number);
  return truncated >= 1 && truncated <= 1_000_000 ? truncated : null;
}

function httpUrlValue(value: unknown): string | null {
  const candidate = textValue(value, MAX_URL_LENGTH);
  if (candidate === '') return null;
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username !== ''
      || parsed.password !== ''
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

function readJsonObject(filePath: string): JsonObject {
  let stat: BigIntStats;
  try {
    stat = lstatSync(filePath, { bigint: true });
  } catch (error) {
    throw new EagleLibraryReadError(`Could not read Eagle metadata: ${filePath}`, { cause: error });
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > BigInt(MAX_METADATA_BYTES)) {
    throw new EagleLibraryReadError(`Invalid Eagle metadata file: ${filePath}`);
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!isObject(parsed)) throw new Error('metadata must be an object');
    return parsed;
  } catch (error) {
    throw new EagleLibraryReadError(`Invalid Eagle metadata JSON: ${filePath}`, { cause: error });
  }
}

function flattenFolders(
  values: unknown[],
  parentFolderId: string | null,
  folders: EagleFolderNode[],
  seenIds: Set<string>,
): void {
  for (const value of values) {
    if (!isObject(value)) continue;
    const folderId = textValue(value.id, 255);
    const name = textValue(value.name, 255);
    if (folderId === '' || name === '' || seenIds.has(folderId)) continue;
    seenIds.add(folderId);
    folders.push({
      folderId,
      parentFolderId,
      name,
      description: textValue(value.description, MAX_ITEM_DESCRIPTION_LENGTH) || null,
    });
    if (Array.isArray(value.children)) {
      flattenFolders(value.children, folderId, folders, seenIds);
    }
  }
}

function isMetadataBackupFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower === 'metadata.json'
    || lower.startsWith('metadata.')
    || lower.startsWith('metadata-');
}

function isThumbnailFile(fileName: string): boolean {
  return /(?:^|[_-])thumbnail(?:\.[^.]+)?$/iu.test(fileName);
}

function sourceCandidateScore(
  fileName: string,
  metadata: JsonObject,
): number {
  const metadataName = textValue(metadata.name, 255);
  const metadataExtension = textValue(metadata.ext, 32).replace(/^\./u, '');
  const expectedNames = new Set([
    metadataName,
    metadataExtension === '' ? '' : `${metadataName}.${metadataExtension}`,
  ].filter(Boolean));
  if (expectedNames.has(fileName)) return 100;
  if (expectedNames.has(fileName.replace(/\.[^.]+$/u, ''))) return 90;
  if (metadataName !== '' && fileName.startsWith(metadataName)) return 80;
  return 0;
}

const EAGLE_THUMBNAIL_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function inspectRegularFile(filePath: string): BigIntStats | undefined {
  try {
    const stat = lstatSync(filePath, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      return undefined;
    }
    return stat;
  } catch {
    return undefined;
  }
}

function preferredThumbnailPath(infoPath: string, metadataName: string): string | null {
  const names: string[] = [];
  if (metadataName !== '') {
    for (const extension of EAGLE_THUMBNAIL_EXTENSIONS) {
      names.push(`${metadataName}_thumbnail${extension}`);
    }
  }
  names.push('_thumbnail.png');
  for (const fileName of names) {
    const thumbnailPath = path.join(infoPath, fileName);
    const stat = inspectRegularFile(thumbnailPath);
    if (stat && stat.size > 0n) return thumbnailPath;
  }
  return null;
}

function tryPreferredSourceFile(
  infoPath: string,
  metadata: JsonObject,
): {
  sourcePath: string;
  fileName: string;
  stat: BigIntStats;
  thumbnailPath: string | null;
} | undefined {
  const metadataName = textValue(metadata.name, 255);
  const metadataExtension = textValue(metadata.ext, 32).replace(/^\./u, '');
  if (metadataName === '' || metadataExtension === '') return undefined;
  const fileName = `${metadataName}.${metadataExtension}`;
  if (isMetadataBackupFile(fileName) || isThumbnailFile(fileName)) return undefined;
  const sourcePath = path.join(infoPath, fileName);
  const stat = inspectRegularFile(sourcePath);
  if (!stat) return undefined;
  return {
    sourcePath,
    fileName,
    stat,
    thumbnailPath: preferredThumbnailPath(infoPath, metadataName),
  };
}

function metadataSourceByteSize(metadata: JsonObject): number | undefined {
  const fromMeta = finiteNumber(metadata.size);
  if (
    fromMeta === undefined
    || fromMeta <= 0
    || !Number.isSafeInteger(fromMeta)
  ) {
    return undefined;
  }
  return Math.trunc(fromMeta);
}

/** Sum source-file bytes for progress denominators without importing yet. */
export function sumEagleLibrarySourceBytes(
  imagesPath: string,
  infoDirectoryNames: readonly string[],
): number {
  let total = 0;
  for (const infoDirectoryName of infoDirectoryNames) {
    const infoPath = path.join(imagesPath, infoDirectoryName);
    let metadata: JsonObject;
    try {
      metadata = readJsonObject(path.join(infoPath, 'metadata.json'));
    } catch {
      continue;
    }
    if (metadata.isDeleted === true) continue;
    const fromMeta = metadataSourceByteSize(metadata);
    if (fromMeta !== undefined) {
      total += fromMeta;
      continue;
    }
    const selected = chooseSourceFile(infoPath, metadata);
    if (selected) total += Number(selected.stat.size);
  }
  return total;
}

function chooseSourceFile(
  infoPath: string,
  metadata: JsonObject,
): {
  sourcePath: string;
  fileName: string;
  stat: BigIntStats;
  thumbnailPath: string | null;
} | undefined {
  const preferred = tryPreferredSourceFile(infoPath, metadata);
  if (preferred) return preferred;
  let entries: Dirent[];
  try {
    entries = readdirSync(infoPath, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const candidates: Array<{
    fileName: string;
    sourcePath: string;
    stat: BigIntStats;
    score: number;
  }> = [];
  const thumbnailCandidates: Array<{ fileName: string; sourcePath: string; stat: BigIntStats }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || isMetadataBackupFile(entry.name)) {
      continue;
    }
    const sourcePath = path.join(infoPath, entry.name);
    try {
      const stat = lstatSync(sourcePath, { bigint: true });
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        continue;
      }
      if (isThumbnailFile(entry.name)) {
        thumbnailCandidates.push({ fileName: entry.name, sourcePath, stat });
        continue;
      }
      candidates.push({
        fileName: entry.name,
        sourcePath,
        stat,
        score: sourceCandidateScore(entry.name, metadata),
      });
    } catch {
      // A deleted or unreadable item is reported as skipped by the caller.
    }
  }
  candidates.sort((left, right) =>
    right.score - left.score
    || Number(right.stat.size - left.stat.size)
    || left.fileName.localeCompare(right.fileName),
  );
  const selected = candidates[0];
  thumbnailCandidates.sort(
    (left, right) => Number(right.stat.size - left.stat.size) || left.fileName.localeCompare(right.fileName),
  );
  return selected
    ? {
        sourcePath: selected.sourcePath,
        fileName: selected.fileName,
        stat: selected.stat,
        thumbnailPath: thumbnailCandidates[0]?.sourcePath ?? null,
      }
    : undefined;
}

function itemFromInfoDirectory(
  infoPath: string,
  metadata: JsonObject,
): EagleAssetCandidate | undefined {
  const selected = chooseSourceFile(infoPath, metadata);
  if (!selected) return undefined;
  const metadataModifiedAt =
    epochMilliseconds(metadata.lastModified)
    ?? epochMilliseconds(metadata.modificationTime)
    ?? Number(selected.stat.mtimeMs);
  const itemId = textValue(metadata.id, 255) || path.basename(infoPath, '.info');
  return {
    itemId,
    sourcePath: selected.sourcePath,
    thumbnailPath: selected.thumbnailPath,
    fileName: selected.fileName,
    byteSize: Number(selected.stat.size),
    sourceModifiedAtMs: metadataModifiedAt,
    description: textValue(metadata.annotation, MAX_ITEM_DESCRIPTION_LENGTH) || null,
    rating: ratingValue(metadata.star),
    sourcePageUrl: httpUrlValue(metadata.url),
    tags: stringArray(metadata.tags, MAX_TAG_LENGTH),
    folderIds: stringArray(metadata.folders, 255),
    width: positiveDimension(metadata.width),
    height: positiveDimension(metadata.height),
  };
}

function sourceRootDisplayName(sourceRootPath: string): string {
  const baseName = path.basename(sourceRootPath);
  const withoutExtension = baseName.toLowerCase().endsWith('.library')
    ? baseName.slice(0, -'.library'.length)
    : baseName;
  return textValue(withoutExtension, 255) || 'Eagle Library';
}

/**
 * Read Eagle root metadata and the images/*.info directory names only.
 * Parsing each item's metadata.json is deferred so the importer can publish
 * folders/collections before touching every asset.
 */
export function readEagleLibraryRoot(sourceRootPath: string): EagleLibraryRoot {
  let normalizedRoot: string;
  try {
    normalizedRoot = normalizeAbsolutePath(sourceRootPath);
  } catch (error) {
    throw new EagleLibraryReadError('Invalid Eagle library path.', { cause: error });
  }

  let rootStat: BigIntStats;
  try {
    rootStat = lstatSync(normalizedRoot, { bigint: true });
  } catch (error) {
    throw new EagleLibraryReadError('Eagle library path does not exist.', { cause: error });
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new EagleLibraryReadError('Eagle library path must be a directory.');
  }

  let sourceRoot: string;
  try {
    sourceRoot = realpathSync(normalizedRoot);
  } catch (error) {
    throw new EagleLibraryReadError('Could not resolve Eagle library path.', { cause: error });
  }
  const rootMetadata = readJsonObject(path.join(sourceRoot, 'metadata.json'));
  if (!Array.isArray(rootMetadata.folders)) {
    throw new EagleLibraryReadError('Eagle metadata.json has no folders array.');
  }

  const folders: EagleFolderNode[] = [];
  flattenFolders(rootMetadata.folders, null, folders, new Set());

  const imagesPath = path.join(sourceRoot, 'images');
  const infoDirectoryNames: string[] = [];
  let resolvedImagesPath: string | null = null;
  try {
    const imagesStat = lstatSync(imagesPath, { bigint: true });
    if (imagesStat.isSymbolicLink() || !imagesStat.isDirectory()) {
      throw new EagleLibraryReadError('Eagle images directory is invalid.');
    }
    resolvedImagesPath = imagesPath;
    const imageEntries = readdirSync(imagesPath, { withFileTypes: true });
    for (const entry of imageEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.toLowerCase().endsWith('.info')) {
        continue;
      }
      infoDirectoryNames.push(entry.name);
    }
  } catch (error) {
    if (error instanceof EagleLibraryReadError) throw error;
    // An empty Eagle library may not have created images/ yet.
  }

  return {
    displayName: sourceRootDisplayName(sourceRoot),
    sourceRootPath: sourceRoot,
    folders,
    imagesPath: resolvedImagesPath,
    infoDirectoryNames,
  };
}

export function readEagleAssetCandidate(
  imagesPath: string,
  infoDirectoryName: string,
): EagleItemReadResult {
  const infoPath = path.join(imagesPath, infoDirectoryName);
  const metadataPath = path.join(infoPath, 'metadata.json');
  let itemMetadata: JsonObject;
  try {
    itemMetadata = readJsonObject(metadataPath);
  } catch {
    return { skipped: true, invalid: true };
  }
  if (itemMetadata.isDeleted === true) {
    return { skipped: true, invalid: false };
  }
  const item = itemFromInfoDirectory(infoPath, itemMetadata);
  if (!item) return { skipped: true, invalid: true };
  return { item };
}

/**
 * Read Eagle's directory/JSON library format without mutating the source.
 * Item-level corruption is isolated to that item; the root metadata file is
 * the format boundary and therefore fails the import when it is unreadable.
 */
export function readEagleLibrary(sourceRootPath: string): EagleLibrarySnapshot {
  const root = readEagleLibraryRoot(sourceRootPath);
  const items: EagleAssetCandidate[] = [];
  let skippedCount = 0;
  let invalidCount = 0;
  if (root.imagesPath) {
    for (const infoDirectoryName of root.infoDirectoryNames) {
      const result = readEagleAssetCandidate(root.imagesPath, infoDirectoryName);
      if ('item' in result) {
        items.push(result.item);
        continue;
      }
      skippedCount += 1;
      if (result.invalid) invalidCount += 1;
    }
  }
  return {
    displayName: root.displayName,
    sourceRootPath: root.sourceRootPath,
    folders: root.folders,
    items,
    skippedCount,
    invalidCount,
  };
}
