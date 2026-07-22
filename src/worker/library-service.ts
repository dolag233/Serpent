import { randomUUID, createHash } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
  copyFileSync,
  createWriteStream,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
  writeSync,
  type BigIntStats,
  type Stats,
} from 'node:fs';
import path from 'node:path';
import {
  execFile,
  execFileSync,
  spawn,
  type ChildProcess,
} from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import BetterSqlite3 from 'better-sqlite3';

import {
  resolveFfmpegPath,
  resolveFfprobePath,
  resolveOiiotoolPath,
} from './binary-resolver';
import {
  dominantColorMetrics,
  extractRepresentativePalette,
  type RepresentativeColor,
} from './palette-extractor';
import { pathIsWithin } from './path-utils';

import { smartCollectionQueryDefinitionSchema, extractedVideoMetadataSchema, type AssetMetadataResult, type ExtractedMetadataResult, type ExtractedVideoMetadata, type AssetSummary, type CollectionSummary, type FilterClause, type FolderBrowseEntry, type LinkedFolderRule, type LinkedFolderSummary, type ManagedFolderSummary, type SearchScope, type SmartCollectionQueryDefinition, type SmartCollectionSummary, type TagCooccurrenceGraph, type TagSummary, type TrashedFolderSummary } from '../shared/asset-types';
import { sanitizeAiDescription } from '../shared/ai-analysis-settings';
import { hasMeaningfulSmartCollectionCondition } from '../shared/smart-collection-query';
import {
  colorFilterSql,
  parseColorFilterIds,
} from '../shared/color-filter-presets';
import type { TagOperationSkip } from '../shared/protocol/responses';

// sharp is an optional N-API dependency (no rebuild needed for Electron).
// The Worker loads it lazily so it can still start if sharp is missing.
export interface SharpModule {
  (input: string, options?: { page?: number }): SharpInstance;
  cache?(options: boolean | { files?: number }): unknown;
}
export interface SharpInstance {
  metadata(): Promise<{
    width?: number;
    height?: number;
    format?: string;
    orientation?: number;
    pages?: number;
    delay?: number[];
    loop?: number;
  }>;
  rotate(): SharpInstance;
  toColourspace(colourspace: 'srgb'): SharpInstance;
  resize(options: {
    width?: number;
    height?: number;
    fit?: 'inside' | 'cover' | 'fill' | 'outside';
    withoutEnlargement?: boolean;
  }): SharpInstance;
  /** Replace transparent pixels with a solid background (audio waveform covers). */
  flatten?(options: {
    background: { r: number; g: number; b: number };
  }): SharpInstance;
  png?(options?: { quality?: number }): SharpInstance;
  raw?(): SharpInstance;
  toBuffer?(options: { resolveWithObject: true }): Promise<{
    data: Uint8Array;
    info: { channels: number };
  }>;
  webp(options: { quality?: number }): SharpInstance;
  toFile(output: string): Promise<unknown>;
}

interface PaletteSharpInstance {
  rotate(): PaletteSharpInstance;
  toColourspace(colourspace: 'srgb'): PaletteSharpInstance;
  resize(options: {
    width?: number;
    height?: number;
    fit?: 'inside' | 'cover' | 'fill' | 'outside';
    withoutEnlargement?: boolean;
  }): PaletteSharpInstance;
  ensureAlpha(): PaletteSharpInstance;
  raw(): PaletteSharpInstance;
  toBuffer(options: { resolveWithObject: true }): Promise<{
    data: Uint8Array;
    info: { channels: number };
  }>;
}

interface PaletteSharpModule {
  (input: string): PaletteSharpInstance;
}

let sharpModule: SharpModule | undefined;
function requireSharp(): SharpModule {
  if (!sharpModule) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sharpModule = require('sharp') as SharpModule;
      // libvips keeps recently used input files open in its file cache. On
      // Windows an open handle blocks delete/rename, which breaks asset
      // trash/move/rename right after a thumbnail or palette was generated
      // (POSIX unlinks open files, so this never surfaced on macOS). Keep the
      // decoded-operation cache but never hold source files open.
      sharpModule.cache?.({ files: 0 });
    } catch (error) {
      throw new LibraryServiceError('INTERNAL_ERROR', {
        reason: 'SHARP_UNAVAILABLE',
        cause: error,
      });
    }
  }
  return sharpModule;
}

const SHARP_VERSION = '0.35.3';
/** Bumped when GIF still-page selection changes so stale black page-0 thumbs requeue. */
const SHARP_THUMBNAIL_GENERATOR = `sharp@${SHARP_VERSION}-gifstill1`;
const OIIO_VERSION = '3.1.12.0';
const FFMPEG_VERSION = '8.1';
/** Opaque ≈4:3 light-stage covers (Serpent-dxk); stale strip/dark covers requeue. */
const AUDIO_WAVEFORM_GENERATOR = `ffmpeg@${FFMPEG_VERSION}+${AUDIO_WAVEFORM_COVER_GENERATOR_TAG}`;
const MAX_WEBM_PROXY_BYTES = 512 * 1024 * 1024;
const SERPENT_OCIO_CONFIG = 'ocio://studio-config-v4.0.0_aces-v2.0_ocio-v2.5';
const DEFAULT_OIIO_INPUT_COLOR_SPACE = 'scene_linear';
const MEDIA_JOB_KINDS = [
  'generate_thumbnail',
  'generate_video_poster',
  'generate_contact_sheet',
  'generate_webm_proxy',
  'extract_palette',
] as const;
type MediaJobKind = (typeof MEDIA_JOB_KINDS)[number];
type MediaJobStatus = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';

function safeMediaJobErrorDetail(errorCode: string): string {
  switch (errorCode) {
    case 'FFMPEG_REQUIRED':
      return 'The media component needed for video thumbnails is unavailable. Reinstall or repair Serpent.';
    case 'OIIO_REQUIRED':
      return 'The OpenImageIO component is unavailable. Reinstall or repair Serpent.';
    case 'STALE_REVISION':
      return 'The source changed before media processing finished. Retry the current revision.';
    case 'PALETTE_SOURCE_NOT_READY':
      return 'The current preview image is not ready. Regenerate the thumbnail or video poster first.';
    case 'PALETTE_EXTRACTION_FAILED':
      return 'Local palette extraction failed. See the local Serpent log for diagnostic details.';
    default:
      return 'Media processing failed. See the local Serpent log for diagnostic details.';
  }
}

type OiioArtifactErrorCode =
  | 'OIIO_REQUIRED'
  | 'OIIO_COLOR_TRANSFORM_FAILED'
  | 'OIIO_GENERATION_FAILED';

class OiioInvocationError extends Error {
  constructor(
    readonly artifactErrorCode: OiioArtifactErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OiioInvocationError';
  }
}
import type { PublicErrorCode } from '../shared/protocol/errors';
import { publicReasonFromError, type PublicErrorReason } from '../shared/protocol/errors';
import type {
  NameConflictDecision,
  SuspectedDuplicateDecision,
} from '../shared/protocol/requests';
import { assetAuthorSchema, sourcePageUrlSchema } from '../shared/protocol/requests';
import { extractAuthorFromExif } from './author-from-exif';
import type {
  ImportCompletion,
  ImportConflictPlan,
  InternalLibrarySummary,
  ExportProgressEvent,
  ImportProgressEvent,
} from '../shared/protocol/responses';
import {
  copyNameForIndex,
  LibraryInputError,
  normalizeAbsolutePath,
  normalizeAssetFileBaseName,
  normalizeFolderName,
  normalizeRelativeAssetPath,
  portablePathIdentity,
  portablePathSegmentIdentity,
  targetLibraryPath,
} from './library-rules';
import {
  buildFts5Query,
  tokenizeForFts,
  type SearchClause,
} from './search-query';
import {
  GIF_THUMBNAIL_PROBE_SIZE,
  pickBestGifPage,
  sampleGifPageIndices,
  scoreRawRgbFrame,
} from './gif-thumbnail-page';
import { buildGifExtractedMetadata, type GifExtractedMetadata } from './gif-metadata';
import {
  AUDIO_EXTENSION_NAMES,
  AUDIO_WAVEFORM_COVER_BACKGROUND,
  AUDIO_WAVEFORM_COVER_GENERATOR_TAG,
  AUDIO_WAVEFORM_COVER_HEIGHT,
  AUDIO_WAVEFORM_COVER_STROKE,
  AUDIO_WAVEFORM_COVER_WIDTH,
  AUDIO_WAVEFORM_VIEWER_HEIGHT,
  AUDIO_WAVEFORM_VIEWER_WIDTH,
  audioMimeForExtension,
  isAudioFileName,
} from '../shared/audio-media';
import {
  countTextLines,
  expandFormatFilterTokens,
  isTextFileName,
  TEXT_SAVE_MAX_BYTES,
  TEXT_VIEWER_MAX_BYTES,
  textMimeForExtension,
} from '../shared/text-media';
import {
  extractZipStream,
  ZipImportStreamError,
  type ZipArchiveManifest,
} from './zip-import-stream';
import {
  defaultPinnedHttpTransport,
  type DnsLookup,
  type PinnedHttpTransport,
  type ResolvedAddress,
} from './secure-http-download';
import {
  extensionForRemoteContentType,
  filenameMatchesRemoteContentType,
  normalizeRemoteContentType,
  remoteMediaValidationFailure,
  RemoteMediaMagicProbe,
} from './remote-media-validation';

interface RunResult {
  changes: number;
}

interface Statement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): RunResult;
}

interface DatabaseConnection {
  backup(filename: string, options?: {
    progress?: (progress: { remainingPages: number; totalPages: number }) => number | void;
  }): Promise<{ remainingPages: number; totalPages: number }>;
  close(): void;
  exec(sql: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(sql: string): Statement;
  transaction<T>(operation: () => T): () => T;
}

interface DatabaseConstructor {
  new (filename: string): DatabaseConnection;
}

const Database = BetterSqlite3 as DatabaseConstructor;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const REQUIRED_DIRECTORIES = ['Assets'] as const;
const REGENERABLE_DIRECTORIES = ['previews', 'revisions', 'trash', 'artifacts'] as const;

const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_REDIRECTS = 30;

function extensionForContentType(contentType: string): string | undefined {
  return extensionForRemoteContentType(contentType.toLowerCase());
}

function cleanFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\x00-\x1f<>:"/\\|?*\x7f]+/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim() || 'download';
}

function prohibitedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function prohibitedIpAddress(rawAddress: string): boolean {
  const address = rawAddress.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]!;
  const family = isIP(address);
  if (family === 4) return prohibitedIpv4(address);
  if (family !== 6) return true;

  let normalized = address;
  const dottedTail = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (dottedTail) {
    const octets = dottedTail.split('.').map(Number);
    normalized = normalized.slice(0, -dottedTail.length) +
      `${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const [leftText, rightText = ''] = normalized.split('::');
  const left = leftText ? leftText.split(':') : [];
  const right = rightText ? rightText.split(':') : [];
  const missing = 8 - left.length - right.length;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right]
    .map((group) => Number.parseInt(group || '0', 16));
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group))) return true;
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
  const first = groups[0]!;
  if ((first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xffc0) === 0xfec0 ||
      (first & 0xff00) === 0xff00 ||
      (first === 0x2001 && groups[1] === 0x0db8)) return true;
  const embeddedV4 = groups.slice(0, 5).every((group) => group === 0) &&
    (groups[5] === 0 || groups[5] === 0xffff);
  if (embeddedV4) {
    const ipv4 = `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`;
    return prohibitedIpv4(ipv4);
  }
  return false;
}

function parseContentDispositionFilename(header: string): string | undefined {
  const utf8Match = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].trim());
  }
  const match = header.match(/filename="?([^";\n]+)"?/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  return undefined;
}

function filenameFromUrl(urlString: string, contentType?: string): string {
  try {
    const url = new URL(urlString);
    const name = path.posix.basename(url.pathname);
    if (name && name !== '/') return cleanFilename(name);
  } catch {
    // Invalid URL; fall through to default.
  }
  const ext = contentType ? (extensionForContentType(contentType) ?? '') : '';
  return `download${ext}`;
}

function sanitizedUrlForDiagnostic(urlString: string): string {
  try {
    const url = new URL(urlString);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

function sanitizedUrlDiagnosticText(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/giu, (candidate) =>
    sanitizedUrlForDiagnostic(candidate));
}

function sanitizedUrlDiagnosticError(error: unknown, depth = 0): Error {
  if (depth > 5) return new Error('URL import error chain truncated.');
  if (!(error instanceof Error)) {
    return new Error(sanitizedUrlDiagnosticText(String(error)));
  }
  const sanitized = new Error(sanitizedUrlDiagnosticText(error.message));
  sanitized.name = error.name;
  if (error.stack) sanitized.stack = sanitizedUrlDiagnosticText(error.stack);
  const original = error as Error & { code?: unknown; reason?: unknown };
  const copy = sanitized as Error & { code?: string; reason?: string; cause?: unknown };
  if (typeof original.code === 'string') copy.code = original.code;
  if (typeof original.reason === 'string') copy.reason = original.reason;
  if (error.cause !== undefined) {
    copy.cause = sanitizedUrlDiagnosticError(error.cause, depth + 1);
  }
  return sanitized;
}

const DEFAULT_LINKED_FOLDER_RULES: ReadonlyArray<Omit<LinkedFolderRule, 'ruleId'>> = [
  ...['.git', 'node_modules', '.svn', '.hg', '__pycache__'].map((pattern) => ({
    action: 'exclude' as const, target: 'folder' as const, pattern, enabled: true,
  })),
  ...['.DS_Store', 'Thumbs.db', 'desktop.ini'].map((pattern) => ({
    action: 'exclude' as const, target: 'filename' as const, pattern, enabled: true,
  })),
];

const DEFAULT_IGNORED_ASSET_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '__pycache__',
  'node_modules',
]);
const DEFAULT_IGNORED_ASSET_FILES = new Set([
  '.ds_store',
  'desktop.ini',
  'thumbs.db',
]);
const ALWAYS_IGNORED_ASSET_FILES = new Set([
  '.ds_store',
  'desktop.ini',
  'thumbs.db',
]);

function isDefaultIgnoredAssetEntry(name: string, kind: 'directory' | 'file'): boolean {
  const normalized = name.toLocaleLowerCase('en-US');
  if (kind === 'directory') return DEFAULT_IGNORED_ASSET_DIRECTORIES.has(normalized);
  return DEFAULT_IGNORED_ASSET_FILES.has(normalized) || normalized.startsWith('._');
}

function isAlwaysIgnoredAssetPath(relativePath: string): boolean {
  const filename = relativePath.replaceAll('\\', '/').split('/').filter(Boolean).at(-1);
  if (!filename) return false;
  const normalized = filename.toLocaleLowerCase('en-US');
  return ALWAYS_IGNORED_ASSET_FILES.has(normalized) || normalized.startsWith('._');
}

const INITIAL_SCHEMA_SQL = `
  CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE library (
    library_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;
const INITIAL_SCHEMA_CHECKSUM = createHash('sha256').update(INITIAL_SCHEMA_SQL).digest('hex');

const ASSET_SCHEMA_SQL = `
  CREATE TABLE managed_folders (
    folder_id TEXT PRIMARY KEY,
    parent_folder_id TEXT REFERENCES managed_folders(folder_id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    relative_path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE assets (
    asset_id TEXT PRIMARY KEY,
    location_kind TEXT NOT NULL CHECK (location_kind = 'managed'),
    managed_folder_id TEXT REFERENCES managed_folders(folder_id) ON DELETE RESTRICT,
    relative_file_path TEXT NOT NULL UNIQUE,
    current_revision_id TEXT,
    availability TEXT NOT NULL CHECK (availability IN ('available', 'missing')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE revisions (
    revision_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    parent_revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    modified_at TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('import', 'external_change', 'replace')),
    accepted_at TEXT NOT NULL
  );

  CREATE TABLE file_operations (
    operation_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('preparing', 'applying', 'committed', 'rolled_back', 'failed')
    ),
    manifest_json TEXT NOT NULL,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX assets_folder_path_idx
    ON assets(managed_folder_id, relative_file_path);
  CREATE INDEX revisions_asset_accepted_idx
    ON revisions(asset_id, accepted_at);
`;
const ASSET_SCHEMA_CHECKSUM = createHash('sha256').update(ASSET_SCHEMA_SQL).digest('hex');

const PORTABLE_PATH_SCHEMA_BEFORE_BACKFILL_SQL = `
  ALTER TABLE managed_folders ADD COLUMN path_identity TEXT;
  ALTER TABLE assets ADD COLUMN path_identity TEXT;
`;
const PORTABLE_PATH_SCHEMA_AFTER_BACKFILL_SQL = `
  CREATE UNIQUE INDEX managed_folders_path_identity_unique
    ON managed_folders(path_identity);
  CREATE UNIQUE INDEX assets_path_identity_unique
    ON assets(path_identity);
  CREATE TRIGGER managed_folders_path_identity_required_insert
    BEFORE INSERT ON managed_folders
    WHEN NEW.path_identity IS NULL
    BEGIN SELECT RAISE(ABORT, 'managed folder path identity is required'); END;
  CREATE TRIGGER managed_folders_path_identity_required_update
    BEFORE UPDATE OF path_identity ON managed_folders
    WHEN NEW.path_identity IS NULL
    BEGIN SELECT RAISE(ABORT, 'managed folder path identity is required'); END;
  CREATE TRIGGER assets_path_identity_required_insert
    BEFORE INSERT ON assets
    WHEN NEW.path_identity IS NULL
    BEGIN SELECT RAISE(ABORT, 'asset path identity is required'); END;
  CREATE TRIGGER assets_path_identity_required_update
    BEFORE UPDATE OF path_identity ON assets
    WHEN NEW.path_identity IS NULL
    BEGIN SELECT RAISE(ABORT, 'asset path identity is required'); END;
`;
const PORTABLE_PATH_BACKFILL_AUDIT_ID =
  'portable-path-identity:nfc-per-segment:ecmascript-upper-lower-casefold:v1';
const PORTABLE_PATH_SCHEMA_CHECKSUM = createHash('sha256')
  .update(PORTABLE_PATH_SCHEMA_BEFORE_BACKFILL_SQL)
  .update(PORTABLE_PATH_BACKFILL_AUDIT_ID)
  .update(PORTABLE_PATH_SCHEMA_AFTER_BACKFILL_SQL)
  .digest('hex');

const LINKED_FOLDERS_SCHEMA_SQL = `
  CREATE TABLE linked_folders (
    folder_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES library(library_id),
    display_name TEXT NOT NULL,
    absolute_root_path TEXT NOT NULL,
    source_device_hint TEXT,
    status TEXT NOT NULL CHECK (status IN ('available', 'offline')),
    path_identity TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- SQLite cannot ALTER a CHECK constraint, so the assets table is rebuilt to
  -- relax location_kind to 'managed' | 'linked', add linked_folder_id, and
  -- replace the global UNIQUE on relative_file_path / path_identity with
  -- location-scoped partial unique indexes: a linked asset's relative path is
  -- relative to its linked root, not globally unique across the library.
  CREATE TABLE assets_v4 (
    asset_id TEXT PRIMARY KEY,
    location_kind TEXT NOT NULL CHECK (location_kind IN ('managed', 'linked')),
    managed_folder_id TEXT REFERENCES managed_folders(folder_id) ON DELETE RESTRICT,
    linked_folder_id TEXT REFERENCES linked_folders(folder_id) ON DELETE RESTRICT,
    relative_file_path TEXT NOT NULL,
    current_revision_id TEXT,
    availability TEXT NOT NULL CHECK (availability IN ('available', 'missing')),
    path_identity TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (location_kind = 'managed' AND linked_folder_id IS NULL) OR
      (location_kind = 'linked' AND managed_folder_id IS NULL AND linked_folder_id IS NOT NULL)
    )
  );

  INSERT INTO assets_v4 (
    asset_id, location_kind, managed_folder_id, linked_folder_id,
    relative_file_path, current_revision_id, availability, path_identity,
    created_at, updated_at
  )
  SELECT
    asset_id, location_kind, managed_folder_id, NULL,
    relative_file_path, current_revision_id, availability, path_identity,
    created_at, updated_at
  FROM assets;

  DROP INDEX IF EXISTS assets_folder_path_idx;
  DROP INDEX IF EXISTS assets_path_identity_unique;
  DROP TRIGGER IF EXISTS assets_path_identity_required_insert;
  DROP TRIGGER IF EXISTS assets_path_identity_required_update;
  DROP TABLE assets;
  ALTER TABLE assets_v4 RENAME TO assets;

  CREATE INDEX assets_folder_path_idx
    ON assets(managed_folder_id, relative_file_path);
  CREATE INDEX assets_linked_folder_path_idx
    ON assets(linked_folder_id, relative_file_path);
  CREATE UNIQUE INDEX assets_managed_relative_unique
    ON assets(relative_file_path) WHERE location_kind = 'managed';
  CREATE UNIQUE INDEX assets_managed_path_identity_unique
    ON assets(path_identity) WHERE location_kind = 'managed';
  CREATE UNIQUE INDEX assets_linked_relative_unique
    ON assets(linked_folder_id, relative_file_path) WHERE location_kind = 'linked';
  CREATE UNIQUE INDEX assets_linked_path_identity_unique
    ON assets(linked_folder_id, path_identity) WHERE location_kind = 'linked';
  CREATE TRIGGER assets_path_identity_required_insert
    BEFORE INSERT ON assets WHEN NEW.path_identity IS NULL
    BEGIN SELECT RAISE(ABORT, 'asset path identity is required'); END;
  CREATE TRIGGER assets_path_identity_required_update
    BEFORE UPDATE OF path_identity ON assets WHEN NEW.path_identity IS NULL
    BEGIN SELECT RAISE(ABORT, 'asset path identity is required'); END;
`;
const LINKED_FOLDERS_SCHEMA_CHECKSUM = createHash('sha256')
  .update(LINKED_FOLDERS_SCHEMA_SQL)
  .digest('hex');

const ORGANIZATION_SCHEMA_SQL = `
  CREATE TABLE tags (
    tag_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES library(library_id),
    name TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL,
    UNIQUE (library_id, name COLLATE NOCASE)
  );

  CREATE TABLE human_asset_tags (
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
    PRIMARY KEY (asset_id, tag_id)
  );

  -- AI tag relationships are structurally ready but not written until slice 0009.
  CREATE TABLE ai_asset_tags (
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    PRIMARY KEY (asset_id, tag_id)
  );

  CREATE TABLE asset_metadata (
    asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
    label TEXT,
    description TEXT,
    rating INTEGER NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    palette TEXT,
    source_page_url TEXT,
    entity_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE collections (
    collection_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES library(library_id),
    parent_id TEXT REFERENCES collections(collection_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    cover_asset_id TEXT REFERENCES assets(asset_id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE collection_assets (
    collection_id TEXT NOT NULL REFERENCES collections(collection_id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, asset_id)
  );

  CREATE TABLE smart_collections (
    smart_collection_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES library(library_id),
    name TEXT NOT NULL,
    query_definition TEXT NOT NULL,
    sort_definition TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX tags_library_idx ON tags(library_id);
  CREATE INDEX human_asset_tags_tag_idx ON human_asset_tags(tag_id);
  CREATE INDEX ai_asset_tags_tag_idx ON ai_asset_tags(tag_id);
  CREATE INDEX collections_library_parent_idx ON collections(library_id, parent_id);
  CREATE INDEX collection_assets_asset_idx ON collection_assets(asset_id);
  CREATE INDEX smart_collections_library_idx ON smart_collections(library_id);
`;
const ORGANIZATION_SCHEMA_CHECKSUM = createHash('sha256')
  .update(ORGANIZATION_SCHEMA_SQL)
  .digest('hex');

const SEARCH_SCHEMA_SQL = `
  CREATE TABLE asset_search_index (
    asset_id TEXT UNIQUE NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '',
    filename TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    folder_path TEXT NOT NULL DEFAULT '',
    metadata_text TEXT NOT NULL DEFAULT ''
  );

  CREATE VIRTUAL TABLE asset_search USING fts5(
    label,
    filename,
    tags,
    description,
    source_url,
    folder_path,
    metadata_text,
    content='asset_search_index'
  );

  CREATE TRIGGER asset_search_index_ai AFTER INSERT ON asset_search_index BEGIN
    INSERT INTO asset_search(rowid, label, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES (new.rowid, new.label, new.filename, new.tags, new.description,
            new.source_url, new.folder_path, new.metadata_text);
  END;

  CREATE TRIGGER asset_search_index_ad AFTER DELETE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, label, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.label, old.filename, old.tags, old.description,
            old.source_url, old.folder_path, old.metadata_text);
  END;

  CREATE TRIGGER asset_search_index_au AFTER UPDATE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, label, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.label, old.filename, old.tags, old.description,
            old.source_url, old.folder_path, old.metadata_text);
    INSERT INTO asset_search(rowid, label, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES (new.rowid, new.label, new.filename, new.tags, new.description,
            new.source_url, new.folder_path, new.metadata_text);
  END;

  -- Rebuild smart_collections for v6 shape (collection_id pk, query_definition_json,
  -- position, UNIQUE(library_id, name)). Requires FK disable as DROP TABLE cascades.
  CREATE TABLE smart_collections_v6 (
    collection_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES library(library_id),
    name TEXT NOT NULL,
    query_definition_json TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT INTO smart_collections_v6 (collection_id, library_id, name, query_definition_json, position, created_at, updated_at)
  SELECT
    smart_collection_id,
    library_id,
    name,
    '{"query":' || json_quote(query_definition) || ',"sort":' || json_quote(sort_definition) || '}',
    0,
    created_at,
    updated_at
  FROM smart_collections;

  DROP TABLE smart_collections;
  ALTER TABLE smart_collections_v6 RENAME TO smart_collections;

  CREATE UNIQUE INDEX smart_collections_library_name_unique
    ON smart_collections(library_id, name);
`;
const SEARCH_SCHEMA_CHECKSUM = createHash('sha256')
  .update(SEARCH_SCHEMA_SQL)
  .digest('hex');

const TRASH_SCHEMA_SQL = `
  ALTER TABLE assets ADD COLUMN deleted_at TEXT;
  ALTER TABLE assets ADD COLUMN trashed_from_relative_path TEXT;
  ALTER TABLE assets ADD COLUMN trashed_from_folder_id TEXT
    REFERENCES managed_folders(folder_id) ON DELETE SET NULL;

  CREATE INDEX assets_deleted_at_idx ON assets(deleted_at) WHERE deleted_at IS NOT NULL;
  CREATE INDEX assets_deleted_folder_idx ON assets(trashed_from_folder_id) WHERE deleted_at IS NOT NULL;

  -- The v7 migration is additive on assets but must relax the revisions.origin
  -- CHECK constraint to include 'relink'. SQLite cannot ALTER a CHECK constraint,
  -- so the revisions table is rebuilt. FK relationships (asset_id REFERENCES
  -- assets, parent_revision_id REFERENCES revisions) must be preserved.
  -- PRAGMA foreign_keys is OFF during this migration to prevent DROP TABLE from
  -- cascading through child FKs; assets rows are NOT touched by this rebuild.
  CREATE TABLE revisions_v7 (
    revision_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    parent_revision_id TEXT REFERENCES revisions_v7(revision_id) ON DELETE SET NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    modified_at TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('import', 'external_change', 'replace', 'relink')),
    accepted_at TEXT NOT NULL
  );

  INSERT INTO revisions_v7
    (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
     original_filename, origin, accepted_at)
  SELECT revision_id, asset_id, parent_revision_id, byte_size, modified_at,
         original_filename, origin, accepted_at
    FROM revisions;

  DROP TABLE revisions;
  ALTER TABLE revisions_v7 RENAME TO revisions;

  DROP INDEX IF EXISTS revisions_asset_accepted_idx;
  CREATE INDEX revisions_asset_accepted_idx
    ON revisions(asset_id, accepted_at);
`;
const TRASH_SCHEMA_CHECKSUM = createHash('sha256')
  .update(TRASH_SCHEMA_SQL)
  .digest('hex');

const AI_CONTENT_SCHEMA_SQL = `
  CREATE TABLE ai_content (
    ai_content_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    field_name TEXT NOT NULL CHECK (field_name IN ('label', 'description', 'structured_metadata')),
    value TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );

  CREATE INDEX ai_content_asset_field ON ai_content(asset_id, field_name);
`;
const AI_CONTENT_SCHEMA_CHECKSUM = createHash('sha256')
  .update(AI_CONTENT_SCHEMA_SQL)
  .digest('hex');

const THUMBNAIL_SCHEMA_SQL = `
  CREATE TABLE revision_artifacts (
    artifact_id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('thumbnail', 'video_poster', 'contact_sheet', 'webm_proxy',
               'extracted_metadata', 'extracted_palette')
    ),
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    file_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    generator_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'generating', 'ready', 'failed')
    ),
    error_code TEXT,
    generated_at TEXT,
    invalidated_at TEXT
  );

  CREATE UNIQUE INDEX revision_artifacts_current
    ON revision_artifacts(revision_id, kind)
    WHERE invalidated_at IS NULL;

  CREATE TABLE jobs (
    job_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    asset_id TEXT REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (
      kind IN ('generate_thumbnail', 'generate_video_poster',
               'generate_contact_sheet', 'generate_webm_proxy',
               'extract_metadata', 'extract_palette')
    ),
    status TEXT NOT NULL CHECK (
      status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')
    ),
    priority INTEGER NOT NULL DEFAULT 0,
    progress REAL DEFAULT 0.0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX jobs_library_status_priority
    ON jobs(library_id, status, priority DESC, created_at);
`;
const THUMBNAIL_SCHEMA_CHECKSUM = createHash('sha256')
  .update(THUMBNAIL_SCHEMA_SQL)
  .digest('hex');

// Migration v10: add AI analysis job kinds to the jobs table CHECK constraint.
// SQLite cannot ALTER a CHECK constraint; we recreate the table in-place.
const AI_JOBS_SCHEMA_SQL = `
  CREATE TABLE jobs_new (
    job_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    asset_id TEXT REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (
      kind IN ('generate_thumbnail', 'generate_video_poster',
               'generate_contact_sheet', 'generate_webm_proxy',
               'extract_metadata', 'extract_palette',
               'ai.image.analysis', 'ai.video.analysis')
    ),
    status TEXT NOT NULL CHECK (
      status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')
    ),
    priority INTEGER NOT NULL DEFAULT 0,
    progress REAL DEFAULT 0.0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT INTO jobs_new SELECT * FROM jobs;
  DROP TABLE jobs;
  ALTER TABLE jobs_new RENAME TO jobs;

  CREATE INDEX jobs_library_status_priority
    ON jobs(library_id, status, priority DESC, created_at);
`;
const AI_JOBS_SCHEMA_CHECKSUM = createHash('sha256')
  .update(AI_JOBS_SCHEMA_SQL)
  .digest('hex');

const MEDIA_DURATION_SCHEMA_SQL = `
  ALTER TABLE revision_artifacts ADD COLUMN duration_ms INTEGER
    CHECK (duration_ms IS NULL OR duration_ms >= 0);
  CREATE INDEX revision_artifacts_duration_idx
    ON revision_artifacts(duration_ms)
    WHERE kind = 'extracted_metadata' AND status = 'ready' AND invalidated_at IS NULL;
`;
const MEDIA_DURATION_SCHEMA_CHECKSUM = createHash('sha256')
  .update(MEDIA_DURATION_SCHEMA_SQL)
  .digest('hex');

const PALETTE_SORT_SCHEMA_SQL = `
  ALTER TABLE revision_artifacts ADD COLUMN dominant_hue REAL
    CHECK (dominant_hue IS NULL OR (dominant_hue >= 0 AND dominant_hue < 360));
  ALTER TABLE revision_artifacts ADD COLUMN dominant_lightness REAL
    CHECK (dominant_lightness IS NULL OR (dominant_lightness >= 0 AND dominant_lightness <= 1));
  CREATE INDEX revision_artifacts_palette_sort_idx
    ON revision_artifacts(dominant_hue, dominant_lightness)
    WHERE kind = 'extracted_palette' AND status = 'ready' AND invalidated_at IS NULL;
`;
const PALETTE_SORT_SCHEMA_CHECKSUM = createHash('sha256')
  .update(PALETTE_SORT_SCHEMA_SQL)
  .digest('hex');

const LINKED_FOLDER_RULES_SCHEMA_SQL = `
  CREATE TABLE linked_folder_rules (
    rule_id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL REFERENCES linked_folders(folder_id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    action TEXT NOT NULL CHECK (action IN ('include', 'exclude')),
    target TEXT NOT NULL CHECK (target IN ('path', 'filename', 'extension', 'folder')),
    pattern TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    UNIQUE(folder_id, position)
  );
  CREATE INDEX linked_folder_rules_folder ON linked_folder_rules(folder_id, position);

  CREATE TABLE linked_ignored_assets (
    asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
    ignored_at TEXT NOT NULL
  );

  INSERT INTO linked_folder_rules(rule_id, folder_id, position, action, target, pattern, enabled)
    SELECT folder_id || ':default:0', folder_id, 0, 'exclude', 'folder', '.git', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:1', folder_id, 1, 'exclude', 'folder', 'node_modules', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:2', folder_id, 2, 'exclude', 'folder', '.svn', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:3', folder_id, 3, 'exclude', 'folder', '.hg', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:4', folder_id, 4, 'exclude', 'folder', '__pycache__', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:5', folder_id, 5, 'exclude', 'filename', '.DS_Store', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:6', folder_id, 6, 'exclude', 'filename', 'Thumbs.db', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:7', folder_id, 7, 'exclude', 'filename', 'desktop.ini', 1 FROM linked_folders;
`;
const LINKED_FOLDER_RULES_SCHEMA_CHECKSUM = createHash('sha256')
  .update(LINKED_FOLDER_RULES_SCHEMA_SQL)
  .digest('hex');

// Migration v14: retire the pre-release asset Label concept. Real filenames,
// descriptions, ratings, favorites, palettes, source URLs, and tag relations
// remain intact. Label values are intentionally discarded rather than mapped
// to filenames or tags because neither mapping preserves their semantics.
const RETIRE_ASSET_LABEL_SCHEMA_SQL = `
  -- A saved query that explicitly depended on Label cannot be translated to
  -- filename, tags, or description without changing user intent. Delete these
  -- pre-release smart collections instead of leaving a silently empty result.
  DELETE FROM smart_collections
   WHERE json_valid(query_definition_json)
     AND EXISTS (
       SELECT 1
         FROM json_tree(smart_collections.query_definition_json)
        WHERE json_tree.key = 'field' AND json_tree.value = 'label'
     );

  CREATE TABLE asset_metadata_v14 (
    asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
    description TEXT,
    rating INTEGER NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    palette TEXT,
    source_page_url TEXT,
    entity_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  INSERT INTO asset_metadata_v14
    (asset_id, description, rating, favorite, palette, source_page_url,
     entity_version, updated_at)
  SELECT asset_id, description, rating, favorite, palette, source_page_url,
         entity_version, updated_at
    FROM asset_metadata;
  DROP TABLE asset_metadata;
  ALTER TABLE asset_metadata_v14 RENAME TO asset_metadata;

  CREATE TABLE ai_content_v14 (
    ai_content_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    field_name TEXT NOT NULL CHECK (field_name IN ('description', 'structured_metadata')),
    value TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );
  INSERT INTO ai_content_v14
    (ai_content_id, asset_id, revision_id, field_name, value,
     model_id, model_version, generated_at)
  SELECT ai_content_id, asset_id, revision_id, field_name, value,
         model_id, model_version, generated_at
    FROM ai_content
   WHERE field_name <> 'label';
  DROP TABLE ai_content;
  ALTER TABLE ai_content_v14 RENAME TO ai_content;
  CREATE INDEX ai_content_asset_field ON ai_content(asset_id, field_name);

  DROP TRIGGER IF EXISTS asset_search_index_ai;
  DROP TRIGGER IF EXISTS asset_search_index_ad;
  DROP TRIGGER IF EXISTS asset_search_index_au;
  DROP TABLE asset_search;

  CREATE TABLE asset_search_index_v14 (
    asset_id TEXT UNIQUE NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    filename TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    folder_path TEXT NOT NULL DEFAULT '',
    metadata_text TEXT NOT NULL DEFAULT ''
  );
  INSERT INTO asset_search_index_v14
    (asset_id, filename, tags, description, source_url, folder_path, metadata_text)
  SELECT asset_id, filename, tags, description, source_url, folder_path, metadata_text
    FROM asset_search_index;
  DROP TABLE asset_search_index;
  ALTER TABLE asset_search_index_v14 RENAME TO asset_search_index;

  CREATE VIRTUAL TABLE asset_search USING fts5(
    filename,
    tags,
    description,
    source_url,
    folder_path,
    metadata_text,
    content='asset_search_index'
  );
  CREATE TRIGGER asset_search_index_ai AFTER INSERT ON asset_search_index BEGIN
    INSERT INTO asset_search(rowid, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES (new.rowid, new.filename, new.tags, new.description,
            new.source_url, new.folder_path, new.metadata_text);
  END;
  CREATE TRIGGER asset_search_index_ad AFTER DELETE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.filename, old.tags, old.description,
            old.source_url, old.folder_path, old.metadata_text);
  END;
  CREATE TRIGGER asset_search_index_au AFTER UPDATE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.filename, old.tags, old.description,
            old.source_url, old.folder_path, old.metadata_text);
    INSERT INTO asset_search(rowid, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES (new.rowid, new.filename, new.tags, new.description,
            new.source_url, new.folder_path, new.metadata_text);
  END;
  INSERT INTO asset_search(asset_search) VALUES('rebuild');
`;
const RETIRE_ASSET_LABEL_SCHEMA_CHECKSUM = createHash('sha256')
  .update(RETIRE_ASSET_LABEL_SCHEMA_SQL)
  .digest('hex');

// Migration v15 (Serpent-7x0): add an author/creator metadata field, editable
// by users and auto-populated from EXIF/IPTC/XMP on first thumbnail
// generation. FTS5 content tables cannot have a column appended in place, so
// the search index and its triggers are rebuilt with an `author` column
// alongside the existing `source_url` column, mirroring the v14 rebuild.
const AUTHOR_METADATA_SCHEMA_SQL = `
  ALTER TABLE asset_metadata ADD COLUMN author TEXT;

  DROP TRIGGER IF EXISTS asset_search_index_ai;
  DROP TRIGGER IF EXISTS asset_search_index_ad;
  DROP TRIGGER IF EXISTS asset_search_index_au;
  DROP TABLE asset_search;

  ALTER TABLE asset_search_index ADD COLUMN author TEXT NOT NULL DEFAULT '';

  CREATE VIRTUAL TABLE asset_search USING fts5(
    filename,
    tags,
    description,
    source_url,
    author,
    folder_path,
    metadata_text,
    content='asset_search_index'
  );
  CREATE TRIGGER asset_search_index_ai AFTER INSERT ON asset_search_index BEGIN
    INSERT INTO asset_search(rowid, filename, tags, description, source_url, author, folder_path, metadata_text)
    VALUES (new.rowid, new.filename, new.tags, new.description,
            new.source_url, new.author, new.folder_path, new.metadata_text);
  END;
  CREATE TRIGGER asset_search_index_ad AFTER DELETE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, filename, tags, description, source_url, author, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.filename, old.tags, old.description,
            old.source_url, old.author, old.folder_path, old.metadata_text);
  END;
  CREATE TRIGGER asset_search_index_au AFTER UPDATE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, filename, tags, description, source_url, author, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.filename, old.tags, old.description,
            old.source_url, old.author, old.folder_path, old.metadata_text);
    INSERT INTO asset_search(rowid, filename, tags, description, source_url, author, folder_path, metadata_text)
    VALUES (new.rowid, new.filename, new.tags, new.description,
            new.source_url, new.author, new.folder_path, new.metadata_text);
  END;
  INSERT INTO asset_search(asset_search) VALUES('rebuild');
`;
const AUTHOR_METADATA_SCHEMA_CHECKSUM = createHash('sha256')
  .update(AUTHOR_METADATA_SCHEMA_SQL)
  .digest('hex');

// Migration v16 (F8 / Serpent-1us6): AI aesthetic rating in ai_content;
// retire structured_metadata bag.
const AI_RATING_CONTENT_SCHEMA_SQL = `
  DELETE FROM ai_content WHERE field_name = 'structured_metadata';

  CREATE TABLE ai_content_v16 (
    ai_content_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    field_name TEXT NOT NULL CHECK (field_name IN ('description', 'rating')),
    value TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );
  INSERT INTO ai_content_v16
    (ai_content_id, asset_id, revision_id, field_name, value,
     model_id, model_version, generated_at)
  SELECT ai_content_id, asset_id, revision_id, field_name, value,
         model_id, model_version, generated_at
    FROM ai_content
   WHERE field_name IN ('description', 'rating');
  DROP TABLE ai_content;
  ALTER TABLE ai_content_v16 RENAME TO ai_content;
  CREATE INDEX ai_content_asset_field ON ai_content(asset_id, field_name);
`;
const AI_RATING_CONTENT_SCHEMA_CHECKSUM = createHash('sha256')
  .update(AI_RATING_CONTENT_SCHEMA_SQL)
  .digest('hex');

const TRASHED_MANAGED_FOLDERS_SCHEMA_SQL = `
  CREATE TABLE trashed_managed_folders (
    tombstone_id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_relative_path TEXT,
    trashed_at TEXT NOT NULL,
    trashed_asset_count INTEGER NOT NULL CHECK (trashed_asset_count >= 0)
  );

  CREATE INDEX trashed_managed_folders_trashed_at_idx
    ON trashed_managed_folders(trashed_at DESC);
`;
const TRASHED_MANAGED_FOLDERS_SCHEMA_CHECKSUM = createHash('sha256')
  .update(TRASHED_MANAGED_FOLDERS_SCHEMA_SQL)
  .digest('hex');

const MIGRATIONS = [
  { version: 1, sql: INITIAL_SCHEMA_SQL, checksum: INITIAL_SCHEMA_CHECKSUM },
  { version: 2, sql: ASSET_SCHEMA_SQL, checksum: ASSET_SCHEMA_CHECKSUM },
  {
    version: 3,
    sql: PORTABLE_PATH_SCHEMA_BEFORE_BACKFILL_SQL,
    checksum: PORTABLE_PATH_SCHEMA_CHECKSUM,
  },
  { version: 4, sql: LINKED_FOLDERS_SCHEMA_SQL, checksum: LINKED_FOLDERS_SCHEMA_CHECKSUM },
  { version: 5, sql: ORGANIZATION_SCHEMA_SQL, checksum: ORGANIZATION_SCHEMA_CHECKSUM },
  { version: 6, sql: SEARCH_SCHEMA_SQL, checksum: SEARCH_SCHEMA_CHECKSUM },
  { version: 7, sql: TRASH_SCHEMA_SQL, checksum: TRASH_SCHEMA_CHECKSUM },
  { version: 8, sql: AI_CONTENT_SCHEMA_SQL, checksum: AI_CONTENT_SCHEMA_CHECKSUM },
  { version: 9, sql: THUMBNAIL_SCHEMA_SQL, checksum: THUMBNAIL_SCHEMA_CHECKSUM },
  { version: 10, sql: AI_JOBS_SCHEMA_SQL, checksum: AI_JOBS_SCHEMA_CHECKSUM },
  { version: 11, sql: MEDIA_DURATION_SCHEMA_SQL, checksum: MEDIA_DURATION_SCHEMA_CHECKSUM },
  { version: 12, sql: PALETTE_SORT_SCHEMA_SQL, checksum: PALETTE_SORT_SCHEMA_CHECKSUM },
  { version: 13, sql: LINKED_FOLDER_RULES_SCHEMA_SQL, checksum: LINKED_FOLDER_RULES_SCHEMA_CHECKSUM },
  { version: 14, sql: RETIRE_ASSET_LABEL_SCHEMA_SQL, checksum: RETIRE_ASSET_LABEL_SCHEMA_CHECKSUM },
  { version: 15, sql: AUTHOR_METADATA_SCHEMA_SQL, checksum: AUTHOR_METADATA_SCHEMA_CHECKSUM },
  { version: 16, sql: AI_RATING_CONTENT_SCHEMA_SQL, checksum: AI_RATING_CONTENT_SCHEMA_CHECKSUM },
  {
    version: 17,
    sql: TRASHED_MANAGED_FOLDERS_SCHEMA_SQL,
    checksum: TRASHED_MANAGED_FOLDERS_SCHEMA_CHECKSUM,
  },
] as const;
const SUPPORTED_SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;

interface LibraryRow {
  library_id: string;
  display_name: string;
}

interface MigrationRow {
  checksum: string;
  version: number;
}

interface OpenLibrary {
  connection: DatabaseConnection;
  summary: InternalLibrarySummary;
}

interface ManagedFolderRow {
  folder_id: string;
  name: string;
  parent_folder_id: string | null;
  relative_path: string;
  path_identity: string;
}

interface AssetSummaryRow {
  asset_id: string;
  availability: 'available' | 'missing';
  byte_size: number;
  current_revision_id: string;
  managed_folder_id: string | null;
  linked_folder_id: string | null;
  location_kind: 'managed' | 'linked';
  modified_at: string;
  relative_file_path: string;
  rating: number;
  favorite: number;
}

interface BatchRelinkAssetRow {
  asset_id: string;
  location_kind: 'managed' | 'linked';
  linked_folder_id: string | null;
  managed_folder_id: string | null;
  relative_file_path: string;
  current_revision_id: string | null;
}

interface BatchRelinkMatch {
  matchedPath: string;
  resolvedRelativePath: string;
}

interface ImportSourceEntry {
  byteSize: number;
  destinationRelativePath: string;
  /** Optional metadata intent committed atomically with this imported asset. */
  sourcePageUrl?: string;
  sourceSnapshot: SourceSnapshot;
  sourcePath: string;
}

interface SourceSnapshot {
  ctimeNs: bigint;
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
  size: bigint;
}

interface ManagedRelinkPlacementIdentity {
  ctimeNs: string;
  dev: string;
  ino: string;
  mtimeNs: string;
  sha256: string;
  size: string;
}

interface ManagedRelinkPlacementManifestV3 {
  destinationRelativePath: string;
  kind: 'managed-relink-placement';
  phase: 'staged';
  stagedIdentity: ManagedRelinkPlacementIdentity;
  version: 3;
}

interface ManagedRelinkPlacedMarkerV1 {
  kind: 'managed-relink-placement-complete';
  placedIdentity: ManagedRelinkPlacementIdentity;
  version: 1;
}

interface PendingImport {
  directories: string[];
  entries: ImportSourceEntry[];
  expiryHandle?: unknown;
  libraryId: string;
  operationPath: string;
}

interface ExistingAssetRow {
  asset_id: string;
  current_revision_id: string;
}

interface ExistingDestination {
  actualRelativePath: string;
  size: number;
}

interface PortablePathRow {
  id: string;
  relative_path: string;
}

interface ImportAction {
  destinationRelativePath: string;
  entry: ImportSourceEntry;
  existingAsset?: ExistingAssetRow;
  isReplacement: boolean;
}

interface OperationManifest {
  directories: Array<{ existed: boolean; relativePath: string }>;
  files: Array<{
    backupName: string;
    destinationRelativePath: string;
    hadDestination: boolean;
    stageName: string;
  }>;
  phase?: 'prepared' | 'staging';
  version: 1;
}

interface LinkedTrashOperationManifest {
  assetIds: string[];
  inFlightAssetId: string | null;
  kind: 'linked-trash';
  trashedAssetIds: string[];
  version: 2;
}

interface RestoreOperationManifest {
  files: Array<{
    assetId: string;
    backupDestinationRelativePath: string | null;
    backupName: string;
    conflictingAssetId: string | null;
    destinationRelativePath: string;
    hadDestination: boolean;
    trashFilename: string;
  }>;
  kind: 'restore';
  version: 3;
}

interface ManagedMoveConflict {
  assetId: string | null;
  backupName: string;
  kind: 'managed' | 'untracked';
  managedFolderId: string | null;
  operationId: string;
  relativePath: string;
  trashFilename: string | null;
}

interface ManagedMoveOperationManifest {
  files: Array<{
    assetId: string;
    destinationConflict: ManagedMoveConflict | null;
    destinationFolderId: string | null;
    destinationRelativePath: string;
    restoreConflict: ManagedMoveConflict | null;
    sourceFolderId: string | null;
    sourceRelativePath: string;
  }>;
  kind: 'managed-move' | 'managed-move-undo';
  originalOperationId: string | null;
  version: 4;
}

/** Durable journal for managed-folder duplicate (Option/Alt drag copy). */
interface ManagedCopyOperationManifest {
  files: Array<{
    destinationConflict: ManagedMoveConflict | null;
    destinationFolderId: string | null;
    destinationRelativePath: string;
    newAssetId: string;
    sourceAssetId: string;
    sourceRelativePath: string;
  }>;
  kind: 'managed-copy' | 'managed-copy-undo';
  originalOperationId: string | null;
  version: 5;
}

type PersistedOperationManifest =
  | OperationManifest
  | LinkedTrashOperationManifest
  | RestoreOperationManifest
  | ManagedMoveOperationManifest
  | ManagedCopyOperationManifest;

interface OperationRow {
  error_code: string | null;
  manifest_json: string;
  operation_id: string;
  status: string;
}

export type ImportFailurePoint =
  | 'after-stage'
  | 'after-backup'
  | 'after-first-place'
  | 'after-place'
  | 'after-import-metadata'
  | 'before-db-commit'
  | 'committed-cleanup'
  | 'committed-result-list'
  | 'crash-after-backup'
  | 'crash-after-place'
  | 'crash-during-prepare-stage'
  | 'crash-restore-before-filesystem'
  | 'crash-restore-after-backup'
  | 'crash-restore-after-filesystem'
  | 'crash-restore-before-db-commit'
  | 'crash-restore-after-db-commit'
  | 'crash-move-before-filesystem'
  | 'crash-move-after-conflict'
  | 'crash-move-after-filesystem'
  | 'crash-move-before-db-commit'
  | 'crash-move-after-db-commit'
  | 'crash-linked-convert-after-filesystem'
  | 'crash-relink-before-manifest-write'
  | 'crash-relink-after-manifest-before-placement'
  | 'crash-relink-after-placement-before-manifest-update'
  | 'crash-relink-after-filesystem'
  | 'crash-relink-before-db-commit'
  | 'crash-relink-after-db-commit'
  | 'crash-relink-batch-after-first-place'
  | 'recovery-restore'
  | 'rollback-restore';

/** Result of a subprocess (ffmpeg, ffprobe, oiiotool) invocation. */
export interface SpawnResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

/** Injectable subprocess spawn function for testing. */
export type SpawnFunction = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number; signal?: AbortSignal },
) => Promise<SpawnResult>;

type MediaAutoRepairComponent = 'ffmpeg' | 'oiio';

const MEDIA_COMPONENT_PROBE_TIMEOUT_MS = 2_500;
const MEDIA_COMPONENT_PROBE_RETRY_MS = 30_000;

/**
 * Check the external media environment without starting a persistent media
 * job. This is intentionally a small capability probe: the actual generator
 * remains the source of truth for codec/filter compatibility.
 */
function defaultMediaComponentProbe(component: MediaAutoRepairComponent): boolean {
  const canRun = (command: string, args: string[]): boolean => {
    try {
      execFileSync(command, args, {
        stdio: 'ignore',
        timeout: MEDIA_COMPONENT_PROBE_TIMEOUT_MS,
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  };

  if (component === 'ffmpeg') {
    return canRun(resolveFfmpegPath(), ['-version'])
      && canRun(resolveFfprobePath(), ['-version']);
  }
  return canRun(resolveOiiotoolPath(), ['--help']);
}

const SPAWN_STDOUT_LIMIT_BYTES = 8 * 1024 * 1024;
const SPAWN_STDERR_LIMIT_BYTES = 512 * 1024;

class TailBuffer {
  private chunks: Buffer[] = [];
  private length = 0;

  constructor(private readonly limitBytes: number) {}

  append(chunk: Buffer): void {
    if (chunk.length >= this.limitBytes) {
      this.chunks = [chunk.subarray(chunk.length - this.limitBytes)];
      this.length = this.limitBytes;
      return;
    }

    this.chunks.push(chunk);
    this.length += chunk.length;
    while (this.length > this.limitBytes) {
      const first = this.chunks[0]!;
      const excess = this.length - this.limitBytes;
      if (first.length <= excess) {
        this.chunks.shift();
        this.length -= first.length;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.length -= excess;
      }
    }
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.length);
  }
}

/** Real subprocess spawn (child_process.spawn with defaults). */
export function defaultSpawnFn(
  command: string,
  args: string[],
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new DOMException('Media job was cancelled before the subprocess started.', 'AbortError'));
      return;
    }
    const timeoutMs = options?.timeoutMs ?? 120_000;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      // Escalate to SIGKILL after 5s if still running
      killTimer = setTimeout(() => {
        if (proc.exitCode === null) proc.kill('SIGKILL');
      }, 5_000);
      killTimer.unref();
    }, timeoutMs);
    timer.unref();

    const proc: ChildProcess = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const abort = (): void => {
      if (settled || aborted) return;
      aborted = true;
      proc.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (proc.exitCode === null) proc.kill('SIGKILL');
      }, 5_000);
      killTimer.unref();
    };
    options?.signal?.addEventListener('abort', abort, { once: true });

    const stdoutTail = new TailBuffer(SPAWN_STDOUT_LIMIT_BYTES);
    const stderrTail = new TailBuffer(SPAWN_STDERR_LIMIT_BYTES);

    proc.stdout?.on('data', (chunk: Buffer) => stdoutTail.append(chunk));
    proc.stderr?.on('data', (chunk: Buffer) => stderrTail.append(chunk));

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options?.signal?.removeEventListener('abort', abort);
      settled = true;
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options?.signal?.removeEventListener('abort', abort);
      settled = true;
      if (aborted) {
        reject(new DOMException('Media job cancelled; subprocess terminated.', 'AbortError'));
        return;
      }
      resolve({
        stdout: stdoutTail.toBuffer(),
        stderr: stderrTail.toBuffer().toString('utf-8'),
        exitCode: code ?? (timedOut ? -1 : (proc.signalCode ? -1 : 0)),
      });
    });
  });
}

class AsyncSemaphore {
  private active = 0;
  private readonly waiting: Array<{
    resolve: (release: () => void) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    abort?: () => void;
  }> = [];

  constructor(private readonly limit: number) {}

  async run<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal);
    try {
      if (signal?.aborted) throw new DOMException('Media job cancelled.', 'AbortError');
      return await task();
    } finally {
      release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Media job cancelled.', 'AbortError'));
    }
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.releaseFactory());
    }
    return new Promise((resolve, reject) => {
      const waiter: {
        resolve: (release: () => void) => void;
        reject: (error: unknown) => void;
        signal?: AbortSignal;
        abort?: () => void;
      } = { resolve, reject, signal };
      if (signal) {
        waiter.abort = () => {
          const index = this.waiting.indexOf(waiter);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new DOMException('Media job cancelled while waiting for a decoder.', 'AbortError'));
        };
        signal.addEventListener('abort', waiter.abort, { once: true });
      }
      this.waiting.push(waiter);
    });
  }

  private releaseFactory(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      while (this.waiting.length > 0) {
        const waiter = this.waiting.shift()!;
        waiter.signal?.removeEventListener('abort', waiter.abort!);
        if (waiter.signal?.aborted) continue;
        waiter.resolve(this.releaseFactory());
        return;
      }
      this.active -= 1;
    };
  }
}

// A Library Worker may own several open libraries. These module-level gates
// therefore cap decoder pressure across all LibraryService instances and all
// libraries in the process, not merely within one queue drain.
const sharpDecoderSemaphore = new AsyncSemaphore(2);
const ffmpegDecoderSemaphore = new AsyncSemaphore(1);
const oiioDecoderSemaphore = new AsyncSemaphore(1);

interface MediaExecutionContext {
  signal?: AbortSignal;
}

export interface LibraryServiceOptions {
  afterSourceSnapshotCopy?: (sourcePath: string) => void;
  assetLstat?: (assetPath: string) => Stats;
  beforeSourceSnapshotOpen?: (sourcePath: string) => void;
  debounceMs?: number;
  /** DNS resolver used to reject non-public URL download targets on every hop. */
  dnsLookup?: DnsLookup;
  /** HTTP(S) transport receives an already validated, pinned address per hop. */
  pinnedHttpTransport?: PinnedHttpTransport;
  destinationLstat?: (destinationPath: string) => Stats;
  failAt?: ImportFailurePoint | ImportFailurePoint[];
  importClock?: ImportExpiryClock;
  importTtlMs?: number;
  onAssetsChanged?: (event: AssetsChangedEvent) => void;
  onDiagnostic?: (diagnostic: LibraryServiceDiagnostic) => void;
  onProgress?: (event: ExportProgressEvent | ImportProgressEvent) => void;
  observerFactory?: AssetObserverFactory;
  scheduler?: DebounceScheduler;
  /** Injectable Sharp-compatible decoder for deterministic concurrency tests. */
  sharpFn?: SharpModule;
  /** Injectable raw-pixel decoder used only by local palette extraction. */
  paletteSharpFn?: PaletteSharpModule;
  /**
   * Injectable media capability probe. Production probes ffmpeg+ffprobe or
   * oiiotool before automatically re-queuing component-missing artifacts.
   */
  mediaComponentProbe?: (component: MediaAutoRepairComponent) => boolean;
  /** Injectable spawn for binary subprocesses (ffmpeg/ffprobe/oiiotool). */
  spawnFn?: SpawnFunction;
  /** Moves one absolute source path to the OS system trash. */
  trashItem?: (sourcePath: string) => Promise<void>;
  /** Removes one Serpent trash directory; injectable for platform-error tests. */
  removeTrashPath?: (trashPath: string) => void;
}

export interface LibraryServiceDiagnostic {
  context?: Record<string, unknown>;
  error: unknown;
  scope: string;
}

export interface AssetsChangedEvent {
  changedCount: number;
  libraryId: string;
  missingCount: number;
  type: 'asset.changed';
}

export interface ImportExpiryClock {
  cancel(handle: unknown): void;
  now(): number;
  schedule(callback: () => void, delayMs: number): unknown;
}

export interface AssetRefreshResult {
  assets: AssetSummary[];
  changedCount: number;
  missingCount: number;
}

export interface AssetObserver {
  close(): void;
}

export type AssetObserverFactory = (
  assetsPath: string,
  onEvent: () => void,
  onError: (error: unknown) => void,
) => AssetObserver;

export interface DebounceScheduler {
  cancel(handle: unknown): void;
  schedule(callback: () => void, delayMs: number): unknown;
}

interface LibraryWatch {
  observer: AssetObserver;
  timer?: unknown;
}

interface LinkedFolderWatch extends LibraryWatch {
  folderId: string;
  libraryId: string;
  rootPath: string;
}

const DEFAULT_DEBOUNCE_SCHEDULER: DebounceScheduler = {
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
};

const DEFAULT_IMPORT_EXPIRY_CLOCK: ImportExpiryClock = {
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    handle.unref();
    return handle;
  },
};

const DEFAULT_ASSET_OBSERVER_FACTORY: AssetObserverFactory = (assetsPath, onEvent, onError) => {
  const observer = watch(assetsPath, { recursive: true }, () => onEvent());
  observer.on('error', onError);
  return observer;
};

async function defaultTrashItem(sourcePath: string): Promise<void> {
  const binaryName = process.platform === 'darwin'
    ? 'macos-trash'
    : process.platform === 'win32'
      ? 'windows-trash.exe'
      : undefined;
  if (!binaryName) throw new Error(`System trash is unsupported on ${process.platform}.`);

  // trash@10.1.1 vendors maintained native helpers for macOS and Windows.
  // Resolve the pinned package without loading its ESM entry, then redirect the
  // helper to app.asar.unpacked because executable files cannot run from ASAR.
  const packageEntry = require.resolve('trash');
  const asarSegment = `${path.sep}app.asar${path.sep}`;
  let binaryPath = path.join(path.dirname(packageEntry), 'lib', binaryName);
  if (binaryPath.includes(asarSegment)) {
    binaryPath = binaryPath.replace(
      asarSegment,
      `${path.sep}app.asar.unpacked${path.sep}`,
    );
  }

  await new Promise<void>((resolve, reject) => {
    execFile(
      binaryPath,
      [sourcePath],
      { timeout: 15_000, windowsHide: true },
      (error) => error ? reject(error) : resolve(),
    );
  });
}

export class SimulatedCrashError extends Error {}

export class LibraryServiceError extends Error {
  constructor(
    readonly code: PublicErrorCode,
    options?: {
      cause?: unknown;
      reason?: PublicErrorReason;
      retryable?: boolean;
      currentEntityVersion?: number;
    },
  ) {
    super(code, options);
    this.name = 'LibraryServiceError';
    this.reason = options?.reason ?? publicReasonFromError(options?.cause);
    this.retryable = options?.retryable;
    this.currentEntityVersion = options?.currentEntityVersion;
  }

  readonly reason?: PublicErrorReason;
  readonly retryable?: boolean;
  readonly currentEntityVersion?: number;
}

function serviceError(error: unknown, fallback: PublicErrorCode): LibraryServiceError {
  if (error instanceof LibraryServiceError) return error;
  if (error instanceof LibraryInputError) return new LibraryServiceError(error.code, { cause: error });
  return new LibraryServiceError(fallback, { cause: error });
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

const FS_NAME_COMPONENT_LIMIT = 255;

/**
 * NTFS caps each path component at 255 UTF-16 code units (JS string length);
 * POSIX filesystems cap it at 255 bytes. Past the limit every create/rename
 * fails — POSIX with ENAMETOOLONG, Windows with ENOENT
 * (ERROR_FILENAME_EXCED_RANGE), which would otherwise be misreported as
 * SOURCE_NOT_FOUND. Validate deterministically before placement so both
 * platforms surface the same PATH_LIMIT_EXCEEDED reason.
 */
function assertNameWithinFsLimit(relativePath: string): void {
  for (const component of relativePath.split('/')) {
    if (
      component.length > FS_NAME_COMPONENT_LIMIT ||
      Buffer.byteLength(component, 'utf8') > FS_NAME_COMPONENT_LIMIT
    ) {
      throw new LibraryServiceError('IMPORT_APPLY_FAILED', { reason: 'PATH_LIMIT_EXCEEDED' });
    }
  }
}

/**
 * Existence probes in availability reconciliation must also accept EPERM as
 * "not there" on Windows: a tree in delete-pending state (removed while a
 * handle is still open) answers lstat/readdir with EPERM
 * (STATUS_DELETE_PENDING) until the last handle closes, whereas POSIX
 * reports ENOENT. Genuine permission/IO failures surface as EACCES/EIO and
 * must keep propagating instead of silently flipping availability, so the
 * tolerance is EPERM-only and win32-only.
 */
function isUnreadablePathError(error: unknown): boolean {
  return (
    isMissingPathError(error) ||
    (process.platform === 'win32' &&
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EPERM')
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  let current = error;
  const visited = new Set<unknown>();
  while (typeof current === 'object' && current !== null && !visited.has(current)) {
    visited.add(current);
    if ('code' in current && current.code === code) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

function copyNameCandidates(fileName: string, index: number): string[] {
  const extension = path.posix.extname(fileName);
  const baseName = extension.length === 0 ? fileName : fileName.slice(0, -extension.length);
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(baseName)]
    .map((part) => part.segment);
  const suffix = ` (${index})`;
  const candidates = [copyNameForIndex(fileName, index)];
  for (let length = graphemes.length - 1; length >= 0; length -= 1) {
    candidates.push(`${graphemes.slice(0, length).join('')}${suffix}${extension}`);
  }
  return [...new Set(candidates)];
}

function directoryExists(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function realDirectoryExists(directoryPath: string): boolean {
  try {
    const entry = lstatSync(directoryPath);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
}

function realFileExists(filePath: string): boolean {
  try {
    const entry = lstatSync(filePath);
    return entry.isFile() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
}

interface TransferCancelState {
  cancelled: boolean;
  onCancel?: () => void;
}

interface ActiveImportTransfer {
  importId: string;
  sourceKey: string;
  destinationKey: string;
}

/**
 * Give the UtilityProcess message loop a chance to receive a cancellation
 * command.  Transfer code uses this at file/entry boundaries, matching the
 * cancellation granularity promised by the protocol.
 */
function transferCheckpoint(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Resolves once the stream's 'close' event fires. Destroying a stream only
 * schedules the file-descriptor release; on Windows the file stays locked
 * (and undeletable) until 'close', unlike POSIX where unlinking an open file
 * is allowed. Await this before deleting a stream's target on any platform.
 */
function waitForStreamClose(stream: {
  readonly closed: boolean;
  once(event: string, listener: () => void): unknown;
}): Promise<void> {
  if (stream.closed) return Promise.resolve();
  return new Promise((resolve) => {
    stream.once('close', () => resolve());
    stream.once('error', () => resolve());
  });
}

async function copyDirRecursiveCancellable(
  sourcePath: string,
  destPath: string,
  cancelState: TransferCancelState,
): Promise<void> {
  mkdirSync(destPath, { recursive: true });
  let children;
  try {
    children = readdirSync(sourcePath, { withFileTypes: true });
  } catch (error) {
    throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
  }
  for (const child of children) {
    await transferCheckpoint();
    if (cancelState.cancelled) return;
    const childSource = path.join(sourcePath, child.name);
    const childDest = path.join(destPath, child.name);
    if (child.isSymbolicLink()) {
      throw new LibraryServiceError('NOT_A_LIBRARY', { reason: 'SYMBOLIC_LINK_NOT_ALLOWED' });
    }
    if (child.isDirectory()) {
      await copyDirRecursiveCancellable(childSource, childDest, cancelState);
    } else if (child.isFile()) {
      copyFileSync(childSource, childDest);
    }
  }
}

function assertTreeContainsNoSymlinks(rootPath: string): void {
  const visit = (directoryPath: string): void => {
    let children;
    try {
      children = readdirSync(directoryPath, { withFileTypes: true });
    } catch (error) {
      throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
    }
    for (const child of children) {
      const childPath = path.join(directoryPath, child.name);
      let entry;
      try {
        entry = lstatSync(childPath);
      } catch (error) {
        throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
      }
      if (entry.isSymbolicLink()) {
        throw new LibraryServiceError('NOT_A_LIBRARY', {
          reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
        });
      }
      if (entry.isDirectory()) visit(childPath);
    }
  };
  visit(rootPath);
}

function sourceSnapshot(stat: BigIntStats): SourceSnapshot {
  return {
    ctimeNs: stat.ctimeNs,
    dev: stat.dev,
    ino: stat.ino,
    mtimeNs: stat.mtimeNs,
    size: stat.size,
  };
}

function sameSourceSnapshot(left: SourceSnapshot, right: SourceSnapshot): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function sha256DescriptorSync(descriptor: number): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  for (;;) {
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}

function sha256FileAtPath(filePath: string): string {
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  const descriptor = openSync(filePath, flags);
  try {
    return sha256DescriptorSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function sourceChanged(cause?: unknown): LibraryServiceError {
  return new LibraryServiceError('INVALID_IMPORT_SOURCE', {
    cause,
    reason: 'SOURCE_CHANGED',
  });
}

function unsupportedSourceEntry(reason: PublicErrorReason, cause?: unknown): LibraryServiceError {
  return new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause, reason });
}

function databasePath(libraryPath: string): string {
  return path.join(libraryPath, '.serpent', 'library.db');
}

export function openConfiguredDatabase(filename: string): DatabaseConnection {
  const connection = new Database(filename);
  try {
    connection.pragma('foreign_keys = ON');
    connection.pragma('trusted_schema = ON');
    const journalMode = connection.pragma('journal_mode = WAL', { simple: true });
    connection.pragma('synchronous = FULL');
    if (
      journalMode !== 'wal' ||
      connection.pragma('foreign_keys', { simple: true }) !== 1 ||
      connection.pragma('synchronous', { simple: true }) !== 2
    ) {
      throw new Error('Required SQLite safety pragmas could not be enabled.');
    }
    return connection;
  } catch (error) {
    closeIgnoringFailure(connection);
    throw error;
  }
}

function createDirectoryLayout(libraryPath: string): void {
  mkdirSync(path.join(libraryPath, 'Assets'));
  const serpentPath = path.join(libraryPath, '.serpent');
  mkdirSync(serpentPath);
  for (const directoryName of REGENERABLE_DIRECTORIES) {
    mkdirSync(path.join(serpentPath, directoryName));
  }
}

function schemaVersion(connection: DatabaseConnection): number {
  const version = connection.pragma('user_version', { simple: true });
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  return version;
}

function verifyMigrationHistory(connection: DatabaseConnection, version: number): void {
  const migrations = connection
    .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
    .all() as MigrationRow[];
  const expected = MIGRATIONS.slice(0, version);
  if (
    migrations.length !== expected.length ||
    expected.some(
      (migration, index) =>
        migrations[index]?.version !== migration.version ||
        migrations[index]?.checksum !== migration.checksum,
    )
  ) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
}

function backfillPortablePathIdentities(connection: DatabaseConnection): void {
  const folderRows = connection
    .prepare('SELECT folder_id AS id, relative_path FROM managed_folders ORDER BY folder_id')
    .all() as PortablePathRow[];
  const assetRows = connection
    .prepare('SELECT asset_id AS id, relative_file_path AS relative_path FROM assets ORDER BY asset_id')
    .all() as PortablePathRow[];
  const allIdentities = new Map<string, { kind: 'asset' | 'folder'; path: string }>();

  const backfill = (
    rows: PortablePathRow[],
    kind: 'asset' | 'folder',
    statement: Statement,
  ): void => {
    for (const row of rows) {
      const identity = portablePathIdentity(row.relative_path);
      const existing = allIdentities.get(identity);
      if (existing && (existing.kind !== kind || existing.path !== row.relative_path)) {
        throw new Error('Existing paths are not portable-identity unique.');
      }
      allIdentities.set(identity, { kind, path: row.relative_path });
      statement.run(identity, row.id);
    }
  };

  backfill(
    folderRows,
    'folder',
    connection.prepare('UPDATE managed_folders SET path_identity = ? WHERE folder_id = ?'),
  );
  backfill(
    assetRows,
    'asset',
    connection.prepare('UPDATE assets SET path_identity = ? WHERE asset_id = ?'),
  );
}

function buildFileName(relativeFilePath: string): string {
  return path.posix.basename(relativeFilePath);
}

function buildFolderPath(relativeFilePath: string): string {
  return path.posix.dirname(relativeFilePath) === '.' ? '' : path.posix.dirname(relativeFilePath);
}

function byteSizeLabel(byteSize: number): string {
  if (byteSize < 1_000_000) return 'small';
  if (byteSize < 10_000_000) return 'medium';
  if (byteSize < 100_000_000) return 'large';
  return 'xlarge';
}

function buildMetadataText(input: {
  availability: string;
  byteSize: number;
  relativeFilePath: string;
}): string {
  const extension = path.posix.extname(input.relativeFilePath).toLowerCase();
  const parts: string[] = [];
  if (extension.length > 0) parts.push(extension);
  parts.push(byteSizeLabel(input.byteSize));
  parts.push(input.availability);
  return parts.join(' ');
}

function backfillAssetSearchContent(connection: DatabaseConnection): void {
  const assets = connection
    .prepare(
      `SELECT a.asset_id, a.relative_file_path, a.availability,
              r.byte_size, m.label, m.description, m.source_page_url
         FROM assets a
         JOIN revisions r ON r.revision_id = a.current_revision_id
         LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
        ORDER BY a.asset_id`,
    )
    .all() as Array<{
      asset_id: string;
      relative_file_path: string;
      availability: string;
      byte_size: number;
      label: string | null;
      description: string | null;
      source_page_url: string | null;
    }>;

  const tagRows = connection
    .prepare(
      `SELECT hat.asset_id, GROUP_CONCAT(t.name, ' ') AS tags
         FROM human_asset_tags hat
         JOIN tags t ON t.tag_id = hat.tag_id
        GROUP BY hat.asset_id`,
    )
    .all() as Array<{ asset_id: string; tags: string | null }>;
  const tagsByAsset = new Map<string, string>();
  for (const row of tagRows) {
    tagsByAsset.set(row.asset_id, row.tags ?? '');
  }

  const insert = connection.prepare(
    `INSERT OR IGNORE INTO asset_search_index
       (asset_id, label, filename, tags, description, source_url, folder_path, metadata_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const asset of assets) {
    insert.run(
      asset.asset_id,
      tokenizeForFts(asset.label ?? ''),
      tokenizeForFts(buildFileName(asset.relative_file_path)),
      tokenizeForFts(tagsByAsset.get(asset.asset_id) ?? ''),
      tokenizeForFts(asset.description ?? ''),
      tokenizeForFts(asset.source_page_url ?? ''),
      tokenizeForFts(buildFolderPath(asset.relative_file_path)),
      tokenizeForFts(
        buildMetadataText({
          availability: asset.availability,
          byteSize: asset.byte_size,
          relativeFilePath: asset.relative_file_path,
        }),
      ),
    );
  }
}

function migrateDatabase(connection: DatabaseConnection, allowFresh: boolean): void {
  const currentVersion = schemaVersion(connection);
  if (currentVersion > SUPPORTED_SCHEMA_VERSION) {
    throw new LibraryServiceError('LIBRARY_VERSION_TOO_NEW');
  }
  if (currentVersion === 0 && !allowFresh) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }
  if (currentVersion > 0) verifyMigrationHistory(connection, currentVersion);

  for (const migration of MIGRATIONS.slice(currentVersion)) {
    // The v4 migration rebuilds the assets table: SQLite cannot relax a CHECK
    // constraint or replace a column UNIQUE without a table rebuild. DROP TABLE
    // with foreign_keys = ON performs an implicit DELETE of every row, which
    // would cascade through revisions.asset_id ON DELETE CASCADE and orphan
    // every asset. PRAGMA foreign_keys cannot change inside a transaction, so
    // toggle it around the v4 transaction and run foreign_key_check before
    // re-enabling. asset_ids are preserved across the rebuild, so the check
    // passes and revisions remain attached.
    //
    // The v6 migration rebuilds the smart_collections table. While no other
    // table references smart_collections via FK, the table itself has an
    // outgoing FK to library(library_id). Disabling FK prevents DROP TABLE
    // from blocking and guarantees the rebuild is clean.
    const rebuildsTable = migration.version === 4 || migration.version === 6 || migration.version === 7 || migration.version === 14;
    if (rebuildsTable) connection.pragma('foreign_keys = OFF');
    try {
      connection.transaction(() => {
        connection.exec(migration.sql);
        if (migration.version === 3) {
          backfillPortablePathIdentities(connection);
          connection.exec(PORTABLE_PATH_SCHEMA_AFTER_BACKFILL_SQL);
        }
        if (migration.version === 6) {
          backfillAssetSearchContent(connection);
          connection.exec("INSERT INTO asset_search(asset_search) VALUES('rebuild')");
        }
        if (rebuildsTable) {
          const foreignKeyViolations = connection.pragma('foreign_key_check');
          if (Array.isArray(foreignKeyViolations) && foreignKeyViolations.length > 0) {
            throw new Error(
              `Migration ${migration.version} would leave ${foreignKeyViolations.length} foreign-key violation(s).`,
            );
          }
        }
        connection
          .prepare(
            'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
          )
          .run(migration.version, migration.checksum, new Date().toISOString());
        connection.pragma(`user_version = ${migration.version}`);
      })();
    } catch (error) {
      if (rebuildsTable) {
        try {
          connection.pragma('foreign_keys = ON');
        } catch {
          // The primary migration failure remains more useful than a re-enable failure.
        }
      }
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    }
    if (rebuildsTable) connection.pragma('foreign_keys = ON');
  }

  verifyMigrationHistory(connection, SUPPORTED_SCHEMA_VERSION);
}

function verifyDatabase(connection: DatabaseConnection): LibraryRow {
  const version = schemaVersion(connection);
  if (version > SUPPORTED_SCHEMA_VERSION) {
    throw new LibraryServiceError('LIBRARY_VERSION_TOO_NEW');
  }
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }

  const check = connection.pragma('quick_check(1)');
  if (
    !Array.isArray(check) ||
    check.length !== 1 ||
    typeof check[0] !== 'object' ||
    check[0] === null ||
    !('quick_check' in check[0]) ||
    check[0].quick_check !== 'ok'
  ) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }

  verifyMigrationHistory(connection, version);

  const libraryRows = connection
    .prepare('SELECT library_id, display_name FROM library ORDER BY library_id LIMIT 2')
    .all() as LibraryRow[];
  const library = libraryRows[0];
  if (
    libraryRows.length !== 1 ||
    !library ||
    typeof library.library_id !== 'string' ||
    library.library_id.length === 0 ||
    typeof library.display_name !== 'string' ||
    library.display_name.length === 0
  ) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }

  return library;
}

function closeIgnoringFailure(connection: DatabaseConnection | undefined): void {
  try {
    connection?.close();
  } catch {
    // The primary error remains more useful than a secondary close failure.
  }
}

export class LibraryService {
  private readonly openById = new Map<string, OpenLibrary>();
  private readonly openIdByPath = new Map<string, string>();
  private readonly pendingImports = new Map<string, PendingImport>();
  private readonly watchByLibraryId = new Map<string, LibraryWatch>();
  private readonly linkedWatchByKey = new Map<string, LinkedFolderWatch>();
  private readonly activeExports = new Map<string, TransferCancelState>();
  private readonly activeImports = new Map<string, TransferCancelState>();
  private readonly activeExportByLibraryId = new Map<string, string>();
  private readonly activeImportBySource = new Map<string, string>();
  private readonly activeImportByDestination = new Map<string, string>();
  private readonly activeMediaJobs = new Map<string, {
    controller: AbortController;
    libraryId: string;
  }>();
  /**
   * A missing component can be repaired while a library remains open. Once a
   * repair wave has been queued, do not requeue the same component on every
   * visible-range refresh if the replacement fails again. Closing the library
   * starts a new detection wave.
   */
  private readonly autoRepairAttemptedByLibrary = new Map<
    string,
    Set<MediaAutoRepairComponent>
  >();
  /** Avoid synchronously probing missing tools on every visible-range request. */
  private readonly autoRepairProbeFailedAtByLibrary = new Map<
    string,
    Map<MediaAutoRepairComponent, number>
  >();

  constructor(private readonly options: LibraryServiceOptions = {}) {}

  private async createConsistentDatabaseSnapshot(
    connection: DatabaseConnection,
    destinationPath: string,
    cancelState: TransferCancelState,
  ): Promise<void> {
    try {
      await connection.backup(destinationPath, {
        progress: () => {
          if (cancelState.cancelled) throw new LibraryServiceError('CANCELLED');
          return 100;
        },
      });
    } catch (error) {
      try { rmSync(destinationPath, { force: true }); } catch { /* best effort */ }
      if (error instanceof LibraryServiceError) throw error;
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    }

    let verifyConnection: DatabaseConnection | undefined;
    try {
      verifyConnection = openConfiguredDatabase(destinationPath);
      const result = verifyConnection.pragma('quick_check(1)', { simple: true });
      if (result !== 'ok') throw new LibraryServiceError('LIBRARY_CORRUPT');
    } catch (error) {
      try { rmSync(destinationPath, { force: true }); } catch { /* best effort */ }
      if (error instanceof LibraryServiceError) throw error;
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    } finally {
      closeIgnoringFailure(verifyConnection);
    }
  }

  private get spawnFn(): SpawnFunction {
    return this.options.spawnFn ?? defaultSpawnFn;
  }

  private mediaComponentAvailable(component: MediaAutoRepairComponent): boolean {
    try {
      return this.options.mediaComponentProbe?.(component)
        ?? defaultMediaComponentProbe(component);
    } catch (error) {
      this.diagnose('media-component.probe', error, { component });
      return false;
    }
  }

  private runFfmpeg(
    command: string,
    args: string[],
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<SpawnResult> {
    return ffmpegDecoderSemaphore.run(
      options.signal,
      () => this.spawnFn(command, args, options),
    );
  }

  private runOiio(
    command: string,
    args: string[],
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<SpawnResult> {
    return oiioDecoderSemaphore.run(
      options.signal,
      () => this.spawnFn(command, args, options),
    );
  }

  private diagnose(scope: string, error: unknown, context?: Record<string, unknown>): void {
    try {
      this.options.onDiagnostic?.({ scope, error, context });
    } catch {
      // Diagnostics are strictly best effort and must never replace the primary failure.
    }
  }

  reportDiagnostic(scope: string, error: unknown, context?: Record<string, unknown>): void {
    this.diagnose(scope, error, context);
  }

  private failAt(point: ImportFailurePoint): void {
    const configured = this.options.failAt;
    if (configured !== point && (!Array.isArray(configured) || !configured.includes(point))) return;
    if (point.startsWith('crash-')) throw new SimulatedCrashError(`Injected crash: ${point}`);
    throw new Error(`Injected import failure: ${point}`);
  }

  private startAssetWatcher(openLibrary: OpenLibrary): void {
    const libraryId = openLibrary.summary.libraryId;
    const observerFactory = this.options.observerFactory ?? DEFAULT_ASSET_OBSERVER_FACTORY;
    try {
      const assetsPath = this.assetsPath(openLibrary);
      const observer = observerFactory(
        assetsPath,
        () => this.scheduleAssetRefresh(libraryId),
        (error) => this.diagnose('asset-watcher.error', error, { libraryId, assetsPath }),
      );
      this.watchByLibraryId.set(libraryId, { observer });
    } catch (error) {
      this.diagnose('asset-watcher.start', error, {
        libraryId,
        assetsPath: this.assetsPath(openLibrary),
      });
      // Watching is opportunistic; library open and explicit refresh must still work.
    }
  }

  private scheduleAssetRefresh(libraryId: string): void {
    const libraryWatch = this.watchByLibraryId.get(libraryId);
    if (!libraryWatch || !this.openById.has(libraryId)) return;
    const scheduler = this.options.scheduler ?? DEFAULT_DEBOUNCE_SCHEDULER;
    try {
      if (libraryWatch.timer !== undefined) scheduler.cancel(libraryWatch.timer);
      libraryWatch.timer = scheduler.schedule(() => {
        libraryWatch.timer = undefined;
        if (!this.watchByLibraryId.has(libraryId) || !this.openById.has(libraryId)) return;
        try {
          const refresh = this.refreshManagedAssets(libraryId);
          if (refresh.changedCount > 0) {
            this.options.onAssetsChanged?.({
              type: 'asset.changed',
              libraryId,
              changedCount: refresh.changedCount,
              missingCount: refresh.missingCount,
            });
          }
        } catch (error) {
          this.diagnose('asset-watcher.refresh', error, { libraryId });
          // A watcher-triggered refresh is best effort and must never terminate the Worker.
        }
      }, this.options.debounceMs ?? 250);
    } catch (error) {
      libraryWatch.timer = undefined;
      this.diagnose('asset-watcher.schedule', error, { libraryId });
      // Scheduler failures degrade to explicit refresh without escaping an observer callback.
    }
  }

  private stopAssetWatcher(libraryId: string): void {
    const libraryWatch = this.watchByLibraryId.get(libraryId);
    if (!libraryWatch) return;
    this.watchByLibraryId.delete(libraryId);
    if (libraryWatch.timer !== undefined) {
      try {
        (this.options.scheduler ?? DEFAULT_DEBOUNCE_SCHEDULER).cancel(libraryWatch.timer);
      } catch (error) {
        this.diagnose('asset-watcher.cancel', error, { libraryId });
        // Continue closing the observer and database.
      }
    }
    try {
      libraryWatch.observer.close();
    } catch (error) {
      this.diagnose('asset-watcher.close', error, { libraryId });
      // Closing the database is still required even if the native observer already failed.
    }
  }

  private linkedWatchKey(libraryId: string, folderId: string): string {
    return `${libraryId}:${folderId}`;
  }

  private startLinkedWatcher(
    openLibrary: OpenLibrary,
    folder: { folder_id: string; absolute_root_path: string },
  ): void {
    const libraryId = openLibrary.summary.libraryId;
    const key = this.linkedWatchKey(libraryId, folder.folder_id);
    const existing = this.linkedWatchByKey.get(key);
    if (existing?.rootPath === folder.absolute_root_path) return;
    if (existing) this.stopLinkedWatcher(libraryId, folder.folder_id);
    if (this.linkedRootIsGone(folder.absolute_root_path)) return;

    const observerFactory = this.options.observerFactory ?? DEFAULT_ASSET_OBSERVER_FACTORY;
    try {
      const observer = observerFactory(
        folder.absolute_root_path,
        () => this.scheduleLinkedRefresh(libraryId, folder.folder_id),
        (error) => this.diagnose('linked-watcher.error', error, {
          libraryId,
          linkedFolderId: folder.folder_id,
          rootPath: folder.absolute_root_path,
        }),
      );
      this.linkedWatchByKey.set(key, {
        folderId: folder.folder_id,
        libraryId,
        observer,
        rootPath: folder.absolute_root_path,
      });
    } catch (error) {
      this.diagnose('linked-watcher.start', error, {
        libraryId,
        linkedFolderId: folder.folder_id,
        rootPath: folder.absolute_root_path,
      });
    }
  }

  private scheduleLinkedRefresh(libraryId: string, folderId: string): void {
    const key = this.linkedWatchKey(libraryId, folderId);
    const linkedWatch = this.linkedWatchByKey.get(key);
    if (!linkedWatch || !this.openById.has(libraryId)) return;
    const scheduler = this.options.scheduler ?? DEFAULT_DEBOUNCE_SCHEDULER;
    try {
      if (linkedWatch.timer !== undefined) scheduler.cancel(linkedWatch.timer);
      linkedWatch.timer = scheduler.schedule(() => {
        linkedWatch.timer = undefined;
        if (!this.linkedWatchByKey.has(key) || !this.openById.has(libraryId)) return;
        try {
          const refresh = this.refreshManagedAssets(libraryId);
          if (refresh.changedCount > 0) {
            this.options.onAssetsChanged?.({
              type: 'asset.changed',
              libraryId,
              changedCount: refresh.changedCount,
              missingCount: refresh.missingCount,
            });
          }
        } catch (error) {
          this.diagnose('linked-watcher.refresh', error, { libraryId, linkedFolderId: folderId });
        }
      }, this.options.debounceMs ?? 250);
    } catch (error) {
      linkedWatch.timer = undefined;
      this.diagnose('linked-watcher.schedule', error, { libraryId, linkedFolderId: folderId });
    }
  }

  private stopLinkedWatcher(libraryId: string, folderId: string): void {
    const key = this.linkedWatchKey(libraryId, folderId);
    const linkedWatch = this.linkedWatchByKey.get(key);
    if (!linkedWatch) return;
    this.linkedWatchByKey.delete(key);
    if (linkedWatch.timer !== undefined) {
      try {
        (this.options.scheduler ?? DEFAULT_DEBOUNCE_SCHEDULER).cancel(linkedWatch.timer);
      } catch (error) {
        this.diagnose('linked-watcher.cancel', error, { libraryId, linkedFolderId: folderId });
      }
    }
    try {
      linkedWatch.observer.close();
    } catch (error) {
      this.diagnose('linked-watcher.close', error, { libraryId, linkedFolderId: folderId });
    }
  }

  private reconcileLinkedWatchers(openLibrary: OpenLibrary): void {
    const libraryId = openLibrary.summary.libraryId;
    const folders = openLibrary.connection
      .prepare(
        `SELECT folder_id, absolute_root_path, status
           FROM linked_folders
          WHERE library_id = ?`,
      )
      .all(libraryId) as Array<{
        folder_id: string;
        absolute_root_path: string;
        status: 'available' | 'offline';
      }>;
    const desired = new Map(
      folders
        .filter((folder) => folder.status === 'available' && !this.linkedRootIsGone(folder.absolute_root_path))
        .map((folder) => [this.linkedWatchKey(libraryId, folder.folder_id), folder]),
    );

    for (const [key, linkedWatch] of this.linkedWatchByKey) {
      if (linkedWatch.libraryId !== libraryId) continue;
      const folder = desired.get(key);
      if (!folder || folder.absolute_root_path !== linkedWatch.rootPath) {
        this.stopLinkedWatcher(libraryId, linkedWatch.folderId);
      }
    }
    for (const folder of desired.values()) this.startLinkedWatcher(openLibrary, folder);
  }

  private stopLinkedWatchers(libraryId: string): void {
    for (const linkedWatch of [...this.linkedWatchByKey.values()]) {
      if (linkedWatch.libraryId === libraryId) {
        this.stopLinkedWatcher(libraryId, linkedWatch.folderId);
      }
    }
  }

  private assertSafeOperationsRoot(libraryPath: string): string {
    const serpentPath = path.join(libraryPath, '.serpent');
    if (!realDirectoryExists(serpentPath)) throw new LibraryServiceError('LIBRARY_CORRUPT');
    const operationsPath = path.join(serpentPath, 'operations');
    let operationsEntry;
    try {
      operationsEntry = lstatSync(operationsPath);
    } catch (error) {
      if (isMissingPathError(error)) return operationsPath;
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    }
    if (!operationsEntry.isDirectory() || operationsEntry.isSymbolicLink()) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const relation = path.relative(realpathSync(serpentPath), realpathSync(operationsPath));
    if (relation !== 'operations') throw new LibraryServiceError('LIBRARY_CORRUPT');
    return operationsPath;
  }

  private assertSafeOperationPath(operationPath: string): void {
    const operationsPath = this.assertSafeOperationsRoot(
      path.dirname(path.dirname(path.dirname(operationPath))),
    );
    const relation = path.relative(operationsPath, operationPath);
    const basename = path.basename(operationPath);
    const uuidCandidate = basename;
    if (
      !UUID.test(uuidCandidate) ||
      relation !== basename ||
      path.isAbsolute(relation)
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    let operationEntry;
    try {
      operationEntry = lstatSync(operationPath);
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    }
    if (!operationEntry.isDirectory() || operationEntry.isSymbolicLink()) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const realRelation = path.relative(realpathSync(operationsPath), realpathSync(operationPath));
    if (realRelation !== path.basename(operationPath)) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    for (const childName of ['stage', 'backup']) {
      const childPath = path.join(operationPath, childName);
      try {
        const child = lstatSync(childPath);
        if (!child.isDirectory() || child.isSymbolicLink()) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
      } catch (error) {
        if (error instanceof LibraryServiceError) throw error;
        if (!isMissingPathError(error)) {
          throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
        }
      }
    }
  }

  private removeOperation(operationPath: string): void {
    this.assertSafeOperationPath(operationPath);
    rmSync(operationPath, { force: true, recursive: true });
    try {
      rmdirSync(path.dirname(operationPath));
    } catch {
      // A sibling operation may still exist; removing this operation is sufficient.
    }
  }

  private cancelImportExpiry(pending: PendingImport): void {
    if (pending.expiryHandle === undefined) return;
    try {
      (this.options.importClock ?? DEFAULT_IMPORT_EXPIRY_CLOCK).cancel(pending.expiryHandle);
    } catch {
      // Token consumption and cleanup remain authoritative if timer cancellation fails.
    }
    pending.expiryHandle = undefined;
  }

  private updateImportOperation(
    pending: PendingImport,
    status: 'failed' | 'rolled_back',
    errorCode: string,
  ): void {
    const openLibrary = this.openById.get(pending.libraryId);
    if (!openLibrary) return;
    try {
      openLibrary.connection
        .prepare('UPDATE file_operations SET status = ?, error_code = ?, updated_at = ? WHERE operation_id = ?')
        .run(status, errorCode, new Date().toISOString(), path.basename(pending.operationPath));
    } catch {
      // Recovery can audit and finish a still-preparing row on the next open.
    }
  }

  private scheduleImportExpiry(importId: string, pending: PendingImport): void {
    const clock = this.options.importClock ?? DEFAULT_IMPORT_EXPIRY_CLOCK;
    const ttlMs = this.options.importTtlMs ?? 15 * 60 * 1_000;
    const expiresAt = clock.now() + Math.max(0, ttlMs);
    pending.expiryHandle = clock.schedule(() => {
      const current = this.pendingImports.get(importId);
      if (current !== pending) return;
      this.pendingImports.delete(importId);
      pending.expiryHandle = undefined;
      this.updateImportOperation(pending, 'rolled_back', 'IMPORT_EXPIRED');
      this.removeOperation(pending.operationPath);
    }, Math.max(0, expiresAt - clock.now()));
  }

  private parseOperationManifest(serialized: string): PersistedOperationManifest {
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch (error) {
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value)
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    if (value.version === 2) {
      const candidate = value as Record<string, unknown>;
      const assetIds = candidate.assetIds;
      const trashedAssetIds = candidate.trashedAssetIds;
      if (
        candidate.kind !== 'linked-trash' ||
        !Array.isArray(assetIds) ||
        !assetIds.every((assetId) => typeof assetId === 'string' && UUID.test(assetId)) ||
        new Set(assetIds).size !== assetIds.length ||
        !Array.isArray(trashedAssetIds) ||
        !trashedAssetIds.every((assetId) => typeof assetId === 'string' && UUID.test(assetId)) ||
        new Set(trashedAssetIds).size !== trashedAssetIds.length ||
        trashedAssetIds.some((assetId) => !assetIds.includes(assetId)) ||
        !('inFlightAssetId' in candidate) ||
        (candidate.inFlightAssetId !== null && (
          typeof candidate.inFlightAssetId !== 'string' ||
          !assetIds.includes(candidate.inFlightAssetId)
        ))
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      return value as unknown as LinkedTrashOperationManifest;
    }
    if (value.version === 3) {
      const candidate = value as Record<string, unknown>;
      if (candidate.kind !== 'restore' || !Array.isArray(candidate.files)) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const assetIds = new Set<string>();
      const backupNames = new Set<string>();
      const destinationIdentities = new Set<string>();
      for (const file of candidate.files) {
        if (typeof file !== 'object' || file === null) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        const entry = file as Record<string, unknown>;
        const relativePaths = [entry.destinationRelativePath];
        if (entry.backupDestinationRelativePath !== null) {
          relativePaths.push(entry.backupDestinationRelativePath);
        }
        if (
          typeof entry.assetId !== 'string' || !UUID.test(entry.assetId) ||
          assetIds.has(entry.assetId) ||
          typeof entry.destinationRelativePath !== 'string' ||
          typeof entry.backupName !== 'string' ||
          entry.backupName.length === 0 ||
          backupNames.has(entry.backupName) ||
          path.posix.basename(entry.backupName) !== entry.backupName ||
          path.win32.basename(entry.backupName) !== entry.backupName ||
          typeof entry.trashFilename !== 'string' ||
          entry.trashFilename.length === 0 ||
          path.posix.basename(entry.trashFilename) !== entry.trashFilename ||
          path.win32.basename(entry.trashFilename) !== entry.trashFilename ||
          typeof entry.hadDestination !== 'boolean' ||
          (entry.backupDestinationRelativePath !== null &&
            typeof entry.backupDestinationRelativePath !== 'string') ||
          entry.hadDestination !== (entry.backupDestinationRelativePath !== null) ||
          (entry.conflictingAssetId !== null &&
            (typeof entry.conflictingAssetId !== 'string' || !UUID.test(entry.conflictingAssetId))) ||
          relativePaths.some((relativePath) =>
            typeof relativePath !== 'string' ||
            relativePath.length === 0 ||
            relativePath.includes('\\') ||
            path.posix.isAbsolute(relativePath) ||
            path.posix.normalize(relativePath) !== relativePath ||
            relativePath.split('/').some((segment) => segment === '.' || segment === '..')
          )
        ) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        const destinationIdentity = portablePathIdentity(entry.destinationRelativePath);
        if (destinationIdentities.has(destinationIdentity)) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        assetIds.add(entry.assetId);
        backupNames.add(entry.backupName);
        destinationIdentities.add(destinationIdentity);
      }
      return value as unknown as RestoreOperationManifest;
    }
    if (value.version === 5) {
      const candidate = value as Record<string, unknown>;
      if (
        (candidate.kind !== 'managed-copy' && candidate.kind !== 'managed-copy-undo') ||
        !Array.isArray(candidate.files) ||
        (candidate.originalOperationId !== null &&
          (typeof candidate.originalOperationId !== 'string' || !UUID.test(candidate.originalOperationId))) ||
        (candidate.kind === 'managed-copy' && candidate.originalOperationId !== null) ||
        (candidate.kind === 'managed-copy-undo' && candidate.originalOperationId === null)
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const newAssetIds = new Set<string>();
      const destinationIdentities = new Set<string>();
      const validRelativePath = (relativePath: unknown): relativePath is string =>
        typeof relativePath === 'string' && relativePath.length > 0 &&
        !relativePath.includes('\\') && !path.posix.isAbsolute(relativePath) &&
        path.posix.normalize(relativePath) === relativePath &&
        !relativePath.split('/').some((segment) => segment === '.' || segment === '..');
      const validConflict = (conflict: unknown): boolean => {
        if (conflict === null) return true;
        if (typeof conflict !== 'object') return false;
        const entry = conflict as Record<string, unknown>;
        return (entry.kind === 'managed' || entry.kind === 'untracked') &&
          validRelativePath(entry.relativePath) &&
          typeof entry.backupName === 'string' && entry.backupName.length > 0 &&
          path.posix.basename(entry.backupName) === entry.backupName &&
          path.win32.basename(entry.backupName) === entry.backupName &&
          (entry.assetId === null || (typeof entry.assetId === 'string' && UUID.test(entry.assetId))) &&
          (entry.managedFolderId === null || (typeof entry.managedFolderId === 'string' && UUID.test(entry.managedFolderId))) &&
          typeof entry.operationId === 'string' && UUID.test(entry.operationId) &&
          (entry.trashFilename === null || (
            typeof entry.trashFilename === 'string' && entry.trashFilename.length > 0 &&
            path.posix.basename(entry.trashFilename) === entry.trashFilename &&
            path.win32.basename(entry.trashFilename) === entry.trashFilename
          )) &&
          (entry.kind !== 'managed' || (entry.assetId !== null && entry.trashFilename !== null));
      };
      for (const file of candidate.files) {
        if (typeof file !== 'object' || file === null) throw new LibraryServiceError('LIBRARY_CORRUPT');
        const entry = file as Record<string, unknown>;
        if (
          typeof entry.sourceAssetId !== 'string' || !UUID.test(entry.sourceAssetId) ||
          typeof entry.newAssetId !== 'string' || !UUID.test(entry.newAssetId) ||
          newAssetIds.has(entry.newAssetId) ||
          !validRelativePath(entry.sourceRelativePath) || !validRelativePath(entry.destinationRelativePath) ||
          (entry.destinationFolderId !== null &&
            (typeof entry.destinationFolderId !== 'string' || !UUID.test(entry.destinationFolderId))) ||
          !validConflict(entry.destinationConflict)
        ) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        const destinationIdentity = portablePathIdentity(entry.destinationRelativePath);
        if (destinationIdentities.has(destinationIdentity)) throw new LibraryServiceError('LIBRARY_CORRUPT');
        newAssetIds.add(entry.newAssetId);
        destinationIdentities.add(destinationIdentity);
      }
      return value as unknown as ManagedCopyOperationManifest;
    }
    if (value.version === 4) {
      const candidate = value as Record<string, unknown>;
      if (
        (candidate.kind !== 'managed-move' && candidate.kind !== 'managed-move-undo') ||
        !Array.isArray(candidate.files) ||
        (candidate.originalOperationId !== null &&
          (typeof candidate.originalOperationId !== 'string' || !UUID.test(candidate.originalOperationId))) ||
        (candidate.kind === 'managed-move' && candidate.originalOperationId !== null) ||
        (candidate.kind === 'managed-move-undo' && candidate.originalOperationId === null)
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const assetIds = new Set<string>();
      const destinationIdentities = new Set<string>();
      const validRelativePath = (relativePath: unknown): relativePath is string =>
        typeof relativePath === 'string' && relativePath.length > 0 &&
        !relativePath.includes('\\') && !path.posix.isAbsolute(relativePath) &&
        path.posix.normalize(relativePath) === relativePath &&
        !relativePath.split('/').some((segment) => segment === '.' || segment === '..');
      const validConflict = (conflict: unknown): boolean => {
        if (conflict === null) return true;
        if (typeof conflict !== 'object') return false;
        const entry = conflict as Record<string, unknown>;
        return (entry.kind === 'managed' || entry.kind === 'untracked') &&
          validRelativePath(entry.relativePath) &&
          typeof entry.backupName === 'string' && entry.backupName.length > 0 &&
          path.posix.basename(entry.backupName) === entry.backupName &&
          path.win32.basename(entry.backupName) === entry.backupName &&
          (entry.assetId === null || (typeof entry.assetId === 'string' && UUID.test(entry.assetId))) &&
          (entry.managedFolderId === null || (typeof entry.managedFolderId === 'string' && UUID.test(entry.managedFolderId))) &&
          typeof entry.operationId === 'string' && UUID.test(entry.operationId) &&
          (entry.trashFilename === null || (
            typeof entry.trashFilename === 'string' && entry.trashFilename.length > 0 &&
            path.posix.basename(entry.trashFilename) === entry.trashFilename &&
            path.win32.basename(entry.trashFilename) === entry.trashFilename
          )) &&
          (entry.kind !== 'managed' || (entry.assetId !== null && entry.trashFilename !== null));
      };
      for (const file of candidate.files) {
        if (typeof file !== 'object' || file === null) throw new LibraryServiceError('LIBRARY_CORRUPT');
        const entry = file as Record<string, unknown>;
        if (
          typeof entry.assetId !== 'string' || !UUID.test(entry.assetId) || assetIds.has(entry.assetId) ||
          !validRelativePath(entry.sourceRelativePath) || !validRelativePath(entry.destinationRelativePath) ||
          (entry.sourceFolderId !== null && (typeof entry.sourceFolderId !== 'string' || !UUID.test(entry.sourceFolderId))) ||
          (entry.destinationFolderId !== null && (typeof entry.destinationFolderId !== 'string' || !UUID.test(entry.destinationFolderId))) ||
          !validConflict(entry.destinationConflict) || !validConflict(entry.restoreConflict)
        ) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        const destinationIdentity = portablePathIdentity(entry.destinationRelativePath);
        if (destinationIdentities.has(destinationIdentity)) throw new LibraryServiceError('LIBRARY_CORRUPT');
        assetIds.add(entry.assetId);
        destinationIdentities.add(destinationIdentity);
      }
      return value as unknown as ManagedMoveOperationManifest;
    }
    if (
      value.version !== 1 ||
      !('files' in value) ||
      !Array.isArray(value.files) ||
      !('directories' in value) ||
      !Array.isArray(value.directories)
    ) {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    for (const file of value.files) {
      if (
        typeof file !== 'object' ||
        file === null ||
        !('destinationRelativePath' in file) ||
        typeof file.destinationRelativePath !== 'string' ||
        !('stageName' in file) ||
        typeof file.stageName !== 'string' ||
        path.basename(file.stageName) !== file.stageName ||
        !('backupName' in file) ||
        typeof file.backupName !== 'string' ||
        path.basename(file.backupName) !== file.backupName ||
        !('hadDestination' in file) ||
        typeof file.hadDestination !== 'boolean'
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
    }
    for (const directory of value.directories) {
      if (
        typeof directory !== 'object' ||
        directory === null ||
        !('relativePath' in directory) ||
        typeof directory.relativePath !== 'string' ||
        !('existed' in directory) ||
        typeof directory.existed !== 'boolean'
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
    }
    return value as unknown as OperationManifest;
  }

  private recoverLinkedTrashOperation(
    openLibrary: OpenLibrary,
    row: OperationRow,
    manifest: LinkedTrashOperationManifest,
  ): void {
    const assetIdsToDelete: string[] = [];
    let recoveryPending = false;
    const explicitlyTrashed = new Set(manifest.trashedAssetIds);
    for (const assetId of manifest.assetIds) {
      const asset = openLibrary.connection
        .prepare(
          `SELECT asset_id, linked_folder_id, relative_file_path
             FROM assets
            WHERE asset_id = ? AND location_kind = 'linked'`,
        )
        .get(assetId) as {
          asset_id: string;
          linked_folder_id: string;
          relative_file_path: string;
        } | undefined;
      if (!asset) continue;
      if (explicitlyTrashed.has(assetId)) {
        assetIdsToDelete.push(assetId);
        continue;
      }
      if (manifest.inFlightAssetId === assetId) {
        const linkedFolder = openLibrary.connection
          .prepare('SELECT absolute_root_path, status FROM linked_folders WHERE folder_id = ?')
          .get(asset.linked_folder_id) as {
            absolute_root_path: string;
            status: 'available' | 'offline';
          } | undefined;
        const linkedRootOnline = linkedFolder?.status === 'available' &&
          !this.linkedRootIsGone(linkedFolder.absolute_root_path);
        if (linkedRootOnline) {
          try {
            const sourcePath = this.linkedAssetPath(
              openLibrary,
              asset.linked_folder_id,
              asset.relative_file_path,
            );
            if (!existsSync(sourcePath)) assetIdsToDelete.push(assetId);
          } catch (error) {
            recoveryPending = true;
            this.diagnose('asset.delete-linked.recovery-inspect-source', error, {
              operationId: row.operation_id,
              libraryId: openLibrary.summary.libraryId,
              assetId,
            });
          }
        } else {
          recoveryPending = true;
        }
      }
    }

    openLibrary.connection.transaction(() => {
      for (const assetId of assetIdsToDelete) {
        openLibrary.connection.prepare('DELETE FROM assets WHERE asset_id = ?').run(assetId);
      }
      openLibrary.connection
        .prepare(
          `UPDATE file_operations
              SET status = ?, error_code = ?, updated_at = ?
            WHERE operation_id = ?`,
        )
        .run(
          recoveryPending ? 'applying' : 'committed',
          recoveryPending ? 'SOURCE_TRASH_RECONCILIATION_REQUIRED' : 'PROCESS_INTERRUPTED_RECOVERED',
          new Date().toISOString(),
          row.operation_id,
        );
    })();

    if (recoveryPending) {
      this.diagnose(
        'asset.delete-linked.recovery-pending',
        new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
          reason: 'SOURCE_TRASH_RECONCILIATION_REQUIRED',
        }),
        {
          operationId: row.operation_id,
          libraryId: openLibrary.summary.libraryId,
          inFlightAssetId: manifest.inFlightAssetId,
        },
      );
    } else if (manifest.assetIds.length > assetIdsToDelete.length) {
      openLibrary.connection
        .prepare('UPDATE file_operations SET error_code = ? WHERE operation_id = ?')
        .run('PROCESS_INTERRUPTED_PARTIAL', row.operation_id);
    }
  }

  private recoverRestoreOperation(
    openLibrary: OpenLibrary,
    row: OperationRow,
    manifest: RestoreOperationManifest,
    operationPath: string,
  ): void {
    if (row.status === 'preparing') {
      this.removeOperation(operationPath);
      openLibrary.connection
        .prepare(
          "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
        )
        .run(new Date().toISOString(), row.operation_id);
      return;
    }

    const regularFileExists = (filePath: string): boolean => {
      try {
        const entry = lstatSync(filePath);
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        return true;
      } catch (error) {
        if (error instanceof LibraryServiceError) throw error;
        if (isMissingPathError(error)) return false;
        throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
      }
    };

    for (const file of [...manifest.files].reverse()) {
      const sourcePath = this.trashPath(openLibrary, file.assetId, file.trashFilename);
      const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
      const backupPath = path.join(operationPath, 'backup', file.backupName);
      const backupDestinationPath = file.backupDestinationRelativePath === null
        ? null
        : this.folderPath(openLibrary, file.backupDestinationRelativePath);
      const sourceExists = regularFileExists(sourcePath);
      const destinationExists = regularFileExists(destinationPath);
      const backupExists = regularFileExists(backupPath);

      if (!sourceExists) {
        if (!destinationExists) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        mkdirSync(path.dirname(sourcePath), { recursive: true });
        renameSync(destinationPath, sourcePath);
      }

      if (backupExists) {
        if (backupDestinationPath === null || regularFileExists(backupDestinationPath)) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        mkdirSync(path.dirname(backupDestinationPath), { recursive: true });
        renameSync(backupPath, backupDestinationPath);
      } else if (file.hadDestination && (!sourceExists || !destinationExists)) {
        // The destination was moved out of the way but its durable backup has
        // disappeared. Do not claim recovery or discard the restored source.
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
    }

    this.removeOperation(operationPath);
    openLibrary.connection
      .prepare(
        "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
      )
      .run(new Date().toISOString(), row.operation_id);
  }

  private moveConflictHoldingPath(
    openLibrary: OpenLibrary,
    conflict: ManagedMoveConflict,
  ): string {
    if (conflict.kind === 'managed') {
      if (!conflict.assetId || !conflict.trashFilename) throw new LibraryServiceError('LIBRARY_CORRUPT');
      return this.trashPath(openLibrary, conflict.assetId, conflict.trashFilename);
    }
    const operationsRoot = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);
    const operationPath = path.join(operationsRoot, conflict.operationId);
    this.assertSafeOperationPath(operationPath);
    return path.join(operationPath, 'backup', conflict.backupName);
  }

  private recoverManagedMoveOperation(
    openLibrary: OpenLibrary,
    row: OperationRow,
    manifest: ManagedMoveOperationManifest,
    operationPath: string,
  ): void {
    if (row.status === 'preparing') {
      this.removeOperation(operationPath);
      openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
      ).run(new Date().toISOString(), row.operation_id);
      return;
    }

    for (const file of [...manifest.files].reverse()) {
      const sourcePath = this.folderPath(openLibrary, file.sourceRelativePath);
      const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
      const sourceExists = realFileExists(sourcePath);
      const destinationExists = realFileExists(destinationPath);
      const restoreHoldingPath = file.restoreConflict
        ? this.moveConflictHoldingPath(openLibrary, file.restoreConflict)
        : null;
      const restoreHoldingExists = restoreHoldingPath ? realFileExists(restoreHoldingPath) : false;
      const assetWasMoved = destinationExists && (
        !sourceExists || (file.restoreConflict !== null && !restoreHoldingExists)
      );

      // A reverse/undo operation may have restored the asset that the original
      // replace displaced. Put it back in its durable holding location before
      // returning the moved asset to its source.
      if (assetWasMoved && file.restoreConflict) {
        const holdingPath = restoreHoldingPath!;
        if (realFileExists(sourcePath)) {
          if (realFileExists(holdingPath)) throw new LibraryServiceError('LIBRARY_CORRUPT');
          mkdirSync(path.dirname(holdingPath), { recursive: true });
          renameSync(sourcePath, holdingPath);
        }
      }

      if (assetWasMoved) {
        if (realFileExists(sourcePath)) throw new LibraryServiceError('LIBRARY_CORRUPT');
        mkdirSync(path.dirname(sourcePath), { recursive: true });
        renameSync(destinationPath, sourcePath);
      }

      if (file.destinationConflict) {
        const holdingPath = this.moveConflictHoldingPath(openLibrary, file.destinationConflict);
        if (realFileExists(holdingPath)) {
          if (realFileExists(destinationPath)) throw new LibraryServiceError('LIBRARY_CORRUPT');
          mkdirSync(path.dirname(destinationPath), { recursive: true });
          renameSync(holdingPath, destinationPath);
        }
      }
    }

    this.removeOperation(operationPath);
    openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
    ).run(new Date().toISOString(), row.operation_id);
  }

  private recoverManagedCopyOperation(
    openLibrary: OpenLibrary,
    row: OperationRow,
    manifest: ManagedCopyOperationManifest,
    operationPath: string,
  ): void {
    if (row.status === 'preparing') {
      this.removeOperation(operationPath);
      openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
      ).run(new Date().toISOString(), row.operation_id);
      return;
    }

    // Incomplete copy: drop any destination files that were written before the
    // DB commit, then restore any replace-held conflict targets.
    for (const file of [...manifest.files].reverse()) {
      const newAsset = openLibrary.connection.prepare(
        'SELECT asset_id FROM assets WHERE asset_id = ?',
      ).get(file.newAssetId) as { asset_id: string } | undefined;
      if (newAsset) {
        openLibrary.connection.prepare('DELETE FROM assets WHERE asset_id = ?').run(file.newAssetId);
      }
      const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
      if (realFileExists(destinationPath)) {
        rmSync(destinationPath, { force: true });
      }
      if (file.destinationConflict) {
        const holdingPath = this.moveConflictHoldingPath(openLibrary, file.destinationConflict);
        if (realFileExists(holdingPath) && !realFileExists(destinationPath)) {
          mkdirSync(path.dirname(destinationPath), { recursive: true });
          renameSync(holdingPath, destinationPath);
        }
      }
    }

    this.removeOperation(operationPath);
    openLibrary.connection.prepare(
      "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
    ).run(new Date().toISOString(), row.operation_id);
  }

  private recoverFileOperations(openLibrary: OpenLibrary): void {
    const rows = openLibrary.connection
      .prepare(
        `SELECT operation_id, status, manifest_json, error_code
           FROM file_operations
          ORDER BY created_at`,
      )
      .all() as OperationRow[];
    const operationsPath = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);

    const retainedOperationIds = new Set<string>();
    for (const row of rows) {
      if (!UUID.test(row.operation_id) || path.basename(row.operation_id) !== row.operation_id) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const operationPath = path.resolve(operationsPath, row.operation_id);
      const operationRelation = path.relative(operationsPath, operationPath);
      if (
        operationRelation === '' ||
        operationRelation.startsWith(`..${path.sep}`) ||
        path.isAbsolute(operationRelation)
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      if (row.status === 'committed') {
        const manifest = this.parseOperationManifest(row.manifest_json);
        if (
          ((manifest.version === 4 && manifest.kind === 'managed-move') ||
            (manifest.version === 5 && manifest.kind === 'managed-copy')) &&
          row.error_code !== 'UNDONE'
        ) {
          // The committed move/copy journal backs one-shot undo. Keep it until
          // an undo consumes it.
          retainedOperationIds.add(row.operation_id);
          continue;
        }
        this.removeOperation(operationPath);
        continue;
      }
      if (row.status === 'rolled_back') {
        this.removeOperation(operationPath);
        continue;
      }
      if (
        row.status === 'failed' &&
        row.error_code !== 'IMPORT_APPLY_FAILED' &&
        row.error_code !== 'RESTORE_APPLY_FAILED' &&
        row.error_code !== 'MOVE_APPLY_FAILED' &&
        row.error_code !== 'COPY_APPLY_FAILED'
      ) {
        this.removeOperation(operationPath);
        continue;
      }
      this.assertSafeOperationPath(operationPath);
      const manifest = this.parseOperationManifest(row.manifest_json);
      if (manifest.version === 2) {
        this.recoverLinkedTrashOperation(openLibrary, row, manifest);
        continue;
      }
      if (manifest.version === 3) {
        this.recoverRestoreOperation(openLibrary, row, manifest, operationPath);
        continue;
      }
      if (manifest.version === 4) {
        this.recoverManagedMoveOperation(openLibrary, row, manifest, operationPath);
        continue;
      }
      if (manifest.version === 5) {
        this.recoverManagedCopyOperation(openLibrary, row, manifest, operationPath);
        continue;
      }
      if (
        row.status === 'preparing' &&
        (manifest.phase === 'staging' || manifest.phase === 'prepared')
      ) {
        // Preparing never owns a destination: only staged copies are safe to remove.
        // A destination may have been created by another process after planning.
        this.removeOperation(operationPath);
        openLibrary.connection
          .prepare(
            "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
          )
          .run(new Date().toISOString(), row.operation_id);
        continue;
      }
      for (const file of [...manifest.files].reverse()) {
        const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
        const backupPath = path.join(operationPath, 'backup', file.backupName);
        const stagedPath = path.join(operationPath, 'stage', file.stageName);
        let backupExists = false;
        try {
          const backup = lstatSync(backupPath);
          if (!backup.isFile() || backup.isSymbolicLink()) {
            throw new LibraryServiceError('LIBRARY_CORRUPT');
          }
          backupExists = true;
        } catch (error) {
          if (error instanceof LibraryServiceError) throw error;
          if (!isMissingPathError(error)) {
            throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
          }
        }
        if (backupExists) {
          this.failAt('recovery-restore');
          rmSync(destinationPath, { force: true, recursive: true });
          mkdirSync(path.dirname(destinationPath), { recursive: true });
          renameSync(backupPath, destinationPath);
        } else if (!file.hadDestination && !existsSync(stagedPath) && existsSync(destinationPath)) {
          rmSync(destinationPath, { force: true, recursive: true });
        }
      }
      for (const directory of [...manifest.directories].reverse()) {
        if (directory.existed) continue;
        try {
          rmdirSync(this.folderPath(openLibrary, directory.relativePath));
        } catch {
          // A restored file or an external writer may still use the directory.
        }
      }
      this.removeOperation(operationPath);
      openLibrary.connection
        .prepare(
          "UPDATE file_operations SET status = 'rolled_back', error_code = 'PROCESS_INTERRUPTED', updated_at = ? WHERE operation_id = ?",
        )
        .run(new Date().toISOString(), row.operation_id);
    }

    if (directoryExists(operationsPath)) {
      for (const child of readdirSync(operationsPath)) {
        if (retainedOperationIds.has(child)) continue;
        const orphanPath = path.join(operationsPath, child);
        if (child.startsWith('relink-')) {
          // Validate relink orphan paths separately — they use a relink-<uuid>
          // naming convention and carry a manifest.json, not stage/backup dirs.
          if (!UUID.test(child.slice('relink-'.length))) {
            throw new LibraryServiceError('LIBRARY_CORRUPT');
          }
          // Re-validate that the directory is a real directory (not a symlink)
          // directly under operations/ — same safety check as assertSafeOperationPath.
          try {
            const entry = lstatSync(orphanPath);
            if (!entry.isDirectory() || entry.isSymbolicLink()) {
              throw new LibraryServiceError('LIBRARY_CORRUPT');
            }
          } catch (error) {
            if (isMissingPathError(error)) continue;
            throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
          }
          const realRelation = path.relative(
            realpathSync(operationsPath),
            realpathSync(orphanPath),
          );
          if (realRelation !== path.basename(orphanPath)) {
            throw new LibraryServiceError('LIBRARY_CORRUPT');
          }
          if (this.recoverOrphanRelinkPlacement(openLibrary, orphanPath)) {
            continue;
          }
          rmSync(orphanPath, { force: true, recursive: true });
          continue;
        }
        this.assertSafeOperationPath(orphanPath);
        rmSync(orphanPath, { force: true, recursive: true });
      }
      try {
        rmdirSync(operationsPath);
      } catch {
        // A concurrent prepare may have created a new operation after the scan.
      }
    }
  }

  private requireOpenLibrary(libraryId: string): OpenLibrary {
    const openLibrary = this.openById.get(libraryId);
    if (!openLibrary) throw new LibraryServiceError('LIBRARY_NOT_OPEN');
    return openLibrary;
  }

  private folderPath(openLibrary: OpenLibrary, relativePath: string): string {
    const assetsPath = path.join(openLibrary.summary.libraryPath, 'Assets');
    const assetsStat = lstatSync(assetsPath);
    if (!assetsStat.isDirectory() || assetsStat.isSymbolicLink()) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    const targetPath = path.resolve(assetsPath, ...relativePath.split('/'));
    const relation = path.relative(assetsPath, targetPath);
    if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    let cursor = assetsPath;
    for (const component of relation.split(path.sep)) {
      cursor = path.join(cursor, component);
      try {
        if (lstatSync(cursor).isSymbolicLink()) {
          throw new LibraryServiceError('INVALID_LIBRARY_PATH');
        }
      } catch (error) {
        if (error instanceof LibraryServiceError) throw error;
        if (isUnreadablePathError(error)) break;
        throw new LibraryServiceError('INVALID_LIBRARY_PATH', { cause: error });
      }
    }
    return targetPath;
  }

  private linkedRootIsGone(absoluteRootPath: string): boolean {
    try {
      const entry = lstatSync(absoluteRootPath);
      if (entry.isSymbolicLink() || !entry.isDirectory()) return true;
      // Windows delete-pending: a just-removed tree can leave a directory
      // entry that lstat still sees but that rejects every access with EPERM
      // until the last open handle closes. POSIX reports ENOENT at the lstat
      // above, so only Windows needs this second check — without it the
      // refresh falls through to enumeration and crashes on the EPERM.
      accessSync(absoluteRootPath, constants.F_OK);
      return false;
    } catch {
      return true;
    }
  }

  private linkedAssetPath(
    openLibrary: OpenLibrary,
    linkedFolderId: string | null,
    relativeFilePath: string,
  ): string {
    if (!linkedFolderId) throw new LibraryServiceError('LIBRARY_CORRUPT');
    const folder = openLibrary.connection
      .prepare('SELECT absolute_root_path FROM linked_folders WHERE folder_id = ?')
      .get(linkedFolderId) as { absolute_root_path: string } | undefined;
    if (!folder) throw new LibraryServiceError('LIBRARY_CORRUPT');
    // If the root is gone, replaced, or replaced by a symlink, return a path that
    // will stat as missing so the asset reconciles to 'missing' rather than
    // aborting the refresh. A later slice flips the whole folder to 'offline'.
    let rootPath: string;
    try {
      const rootEntry = lstatSync(folder.absolute_root_path);
      if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
        return path.join(folder.absolute_root_path, ...relativeFilePath.split('/'));
      }
      rootPath = realpathSync(folder.absolute_root_path);
    } catch {
      return path.join(folder.absolute_root_path, ...relativeFilePath.split('/'));
    }
    const targetPath = path.resolve(rootPath, ...relativeFilePath.split('/'));
    const relation = path.relative(rootPath, targetPath);
    if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    let cursor = rootPath;
    for (const component of relation.split(path.sep)) {
      cursor = path.join(cursor, component);
      try {
        if (lstatSync(cursor).isSymbolicLink()) {
          throw new LibraryServiceError('INVALID_LIBRARY_PATH');
        }
      } catch (error) {
        if (error instanceof LibraryServiceError) throw error;
        if (isUnreadablePathError(error)) break;
        throw new LibraryServiceError('INVALID_LIBRARY_PATH', { cause: error });
      }
    }
    return targetPath;
  }

  private portableDiskDestination(
    openLibrary: OpenLibrary,
    relativePath: string,
  ): ExistingDestination | undefined {
    const normalized = normalizeRelativeAssetPath(relativePath);
    const segments = normalized.split('/');
    let cursor = this.assetsPath(openLibrary);
    const actualSegments: string[] = [];

    for (const [index, segment] of segments.entries()) {
      const segmentIdentity = portablePathSegmentIdentity(segment);
      let children;
      try {
        children = readdirSync(cursor, { withFileTypes: true });
      } catch (error) {
        if (isMissingPathError(error)) return undefined;
        throw error;
      }
      const matches = children.filter(
        (entry) => portablePathSegmentIdentity(entry.name) === segmentIdentity,
      );
      if (matches.length > 1) {
        throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
          reason: 'NAME_NOT_SUPPORTED',
        });
      }
      const match = matches[0];
      if (!match) {
        // Let the target filesystem, rather than a guessed constant, decide
        // whether this absent component is a valid candidate name.
        const candidatePath = path.join(cursor, segment);
        try {
          (this.options.destinationLstat ?? lstatSync)(candidatePath);
        } catch (error) {
          if (isMissingPathError(error)) return undefined;
          throw error;
        }
        throw new LibraryServiceError('IMPORT_APPLY_FAILED');
      }
      if (match.isSymbolicLink()) {
        throw new LibraryServiceError('INVALID_LIBRARY_PATH');
      }
      actualSegments.push(match.name);
      if (index < segments.length - 1) {
        if (!match.isDirectory()) {
          throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
            reason: 'NAME_NOT_SUPPORTED',
          });
        }
        cursor = path.join(cursor, match.name);
        continue;
      }
      return {
        actualRelativePath: actualSegments.join('/'),
        size: match.isFile() ? lstatSync(path.join(cursor, match.name)).size : -1,
      };
    }
    return undefined;
  }

  private assetsPath(openLibrary: OpenLibrary): string {
    return path.join(openLibrary.summary.libraryPath, 'Assets');
  }

  private targetFolder(openLibrary: OpenLibrary, folderId?: string): ManagedFolderRow | undefined {
    if (!folderId) return undefined;
    const folder = openLibrary.connection
      .prepare(
        'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
      )
      .get(folderId) as ManagedFolderRow | undefined;
    if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    return folder;
  }

  private copySourceSnapshot(entry: ImportSourceEntry, stagedPath: string): number {
    this.options.beforeSourceSnapshotOpen?.(entry.sourcePath);
    const sourceFlags =
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
    let sourceFd: number | undefined;
    let stageFd: number | undefined;
    try {
      try {
        sourceFd = openSync(entry.sourcePath, sourceFlags);
      } catch (error) {
        if (hasErrorCode(error, 'ELOOP')) {
          throw unsupportedSourceEntry('SYMBOLIC_LINK_NOT_ALLOWED', error);
        }
        throw error;
      }

      const openedStat = fstatSync(sourceFd, { bigint: true });
      let pathStat: BigIntStats;
      try {
        pathStat = lstatSync(entry.sourcePath, { bigint: true });
      } catch (error) {
        throw sourceChanged(error);
      }
      if (pathStat.isSymbolicLink()) {
        throw unsupportedSourceEntry('SYMBOLIC_LINK_NOT_ALLOWED');
      }
      if (!pathStat.isFile() || !openedStat.isFile()) {
        throw unsupportedSourceEntry('UNSUPPORTED_FILE_ENTRY');
      }
      const openedSnapshot = sourceSnapshot(openedStat);
      if (
        !sameSourceSnapshot(entry.sourceSnapshot, openedSnapshot) ||
        !sameSourceSnapshot(sourceSnapshot(pathStat), openedSnapshot)
      ) {
        throw sourceChanged();
      }

      stageFd = openSync(
        stagedPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        Number(openedStat.mode & 0o777n),
      );
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      for (;;) {
        const bytesRead = readSync(sourceFd, buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        let written = 0;
        while (written < bytesRead) {
          written += writeSync(stageFd, buffer, written, bytesRead - written);
        }
      }
      fsyncSync(stageFd);
      this.options.afterSourceSnapshotCopy?.(entry.sourcePath);

      const finalSourceStat = fstatSync(sourceFd, { bigint: true });
      if (!sameSourceSnapshot(openedSnapshot, sourceSnapshot(finalSourceStat))) {
        throw sourceChanged();
      }
      const stagedStat = fstatSync(stageFd, { bigint: true });
      if (stagedStat.size !== openedSnapshot.size) throw sourceChanged();
      const byteSize = Number(stagedStat.size);
      if (!Number.isSafeInteger(byteSize)) {
        throw unsupportedSourceEntry('UNSUPPORTED_FILE_ENTRY');
      }
      return byteSize;
    } finally {
      if (stageFd !== undefined) closeSync(stageFd);
      if (sourceFd !== undefined) closeSync(sourceFd);
    }
  }

  private enumerateImportSources(input: {
    sourceKind: 'files' | 'folder';
    sourcePaths: string[];
    targetPrefix: string;
  }): { directories: string[]; entries: ImportSourceEntry[] } {
    const directories = new Set<string>();
    const pathsByIdentity = new Map<string, { kind: 'directory' | 'file'; path: string }>();
    const entries: ImportSourceEntry[] = [];
    const assertSupportedSourceSegment = (segment: string): void => {
      if (path.sep === '/' && segment.includes('\\')) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'NAME_NOT_SUPPORTED',
        });
      }
    };
    const registerPortablePath = (
      relativePath: string,
      kind: 'directory' | 'file',
    ): void => {
      const identity = portablePathIdentity(relativePath);
      const existing = pathsByIdentity.get(identity);
      if (
        existing &&
        (existing.kind !== kind || (kind === 'directory' && existing.path !== relativePath))
      ) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'NAME_NOT_SUPPORTED',
        });
      }
      pathsByIdentity.set(identity, { kind, path: relativePath });
    };
    const addFile = (sourcePath: string, relativePath: string): void => {
      if (isDefaultIgnoredAssetEntry(path.basename(sourcePath), 'file')) return;
      let sourceStat: BigIntStats;
      try {
        sourceStat = lstatSync(sourcePath, { bigint: true });
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: sourceStat.isSymbolicLink()
            ? 'SYMBOLIC_LINK_NOT_ALLOWED'
            : 'UNSUPPORTED_FILE_ENTRY',
        });
      }
      let normalized: string;
      try {
        normalized = normalizeRelativeAssetPath(relativePath);
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      assertSupportedSourceSegment(path.basename(sourcePath));
      registerPortablePath(normalized, 'file');
      const byteSize = Number(sourceStat.size);
      if (!Number.isSafeInteger(byteSize)) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'UNSUPPORTED_FILE_ENTRY',
        });
      }
      entries.push({
        byteSize,
        destinationRelativePath: normalized,
        sourceSnapshot: sourceSnapshot(sourceStat),
        sourcePath,
      });
    };

    const visitDirectory = (directoryPath: string, relativeDirectory: string): void => {
      let directoryStat: BigIntStats;
      try {
        directoryStat = lstatSync(directoryPath, { bigint: true });
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: directoryStat.isSymbolicLink()
            ? 'SYMBOLIC_LINK_NOT_ALLOWED'
            : 'UNSUPPORTED_FILE_ENTRY',
        });
      }
      let normalizedDirectory: string;
      try {
        normalizedDirectory = normalizeRelativeAssetPath(relativeDirectory);
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      assertSupportedSourceSegment(path.basename(directoryPath));
      registerPortablePath(normalizedDirectory, 'directory');
      directories.add(normalizedDirectory);
      let children;
      try {
        children = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) =>
          left.name.localeCompare(right.name),
        );
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      // Node does not expose openat(2)/directory-handle-relative traversal, so a
      // hostile writer can still replace an ancestor between individual calls.
      // Revalidate every directory at access time and every child again before
      // opening it; no imported bytes are accepted from a pathname-only read.
      let directoryAfterRead: BigIntStats;
      try {
        directoryAfterRead = lstatSync(directoryPath, { bigint: true });
      } catch (error) {
        throw sourceChanged(error);
      }
      if (directoryAfterRead.isSymbolicLink()) {
        throw unsupportedSourceEntry('SYMBOLIC_LINK_NOT_ALLOWED');
      }
      if (
        !directoryAfterRead.isDirectory() ||
        !sameSourceSnapshot(sourceSnapshot(directoryStat), sourceSnapshot(directoryAfterRead))
      ) {
        throw sourceChanged();
      }
      for (const child of children) {
        const childKind = child.isDirectory() ? 'directory' : 'file';
        if (isDefaultIgnoredAssetEntry(child.name, childKind)) continue;
        assertSupportedSourceSegment(child.name);
        const childSourcePath = path.join(directoryPath, child.name);
        const childRelativePath = path.posix.join(relativeDirectory, child.name);
        if (child.isSymbolicLink()) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
          });
        }
        if (child.isDirectory()) visitDirectory(childSourcePath, childRelativePath);
        else if (child.isFile()) addFile(childSourcePath, childRelativePath);
        else {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'UNSUPPORTED_FILE_ENTRY',
          });
        }
      }
    };

    if (input.sourceKind === 'files') {
      for (const rawSourcePath of input.sourcePaths) {
        let sourcePath: string;
        try {
          sourcePath = normalizeAbsolutePath(rawSourcePath);
        } catch (error) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
        }
        addFile(sourcePath, path.posix.join(input.targetPrefix, path.basename(sourcePath)));
      }
    } else {
      if (input.sourcePaths.length !== 1) throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
      let sourcePath: string;
      try {
        sourcePath = normalizeAbsolutePath(input.sourcePaths[0]!);
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      visitDirectory(
        sourcePath,
        path.posix.join(input.targetPrefix, path.basename(sourcePath)),
      );
    }

    if (entries.length === 0 && directories.size === 0) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
    }
    return { directories: [...directories].sort(), entries };
  }

  createManagedFolder(input: {
    libraryId: string;
    name: string;
    parentFolderId?: string;
  }): ManagedFolderSummary {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    let name: string;
    try {
      name = normalizeFolderName(input.name);
    } catch (error) {
      throw serviceError(error, 'INVALID_FOLDER_NAME');
    }

    let parent: ManagedFolderRow | undefined;
    if (input.parentFolderId) {
      parent = openLibrary.connection
        .prepare(
          'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
        )
        .get(input.parentFolderId) as ManagedFolderRow | undefined;
      if (!parent) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }

    const relativePath = parent ? path.posix.join(parent.relative_path, name) : name;
    const pathIdentity = portablePathIdentity(relativePath);
    const targetPath = this.folderPath(openLibrary, relativePath);
    const databaseConflict =
      openLibrary.connection
        .prepare('SELECT folder_id FROM managed_folders WHERE path_identity = ?')
        .get(pathIdentity) ??
      openLibrary.connection
        .prepare('SELECT asset_id FROM assets WHERE path_identity = ?')
        .get(pathIdentity);
    if (databaseConflict || this.portableDiskDestination(openLibrary, relativePath)) {
      throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
    }

    const folder: ManagedFolderSummary = {
      folderId: randomUUID(),
      parentFolderId: parent?.folder_id ?? null,
      name,
      relativePath,
      directAssetCount: 0,
      childFolderCount: 0,
    };
    try {
      mkdirSync(targetPath);
      openLibrary.connection
        .prepare(
          `INSERT INTO managed_folders
             (folder_id, parent_folder_id, name, relative_path, path_identity, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          folder.folderId,
          folder.parentFolderId,
          folder.name,
          folder.relativePath,
          pathIdentity,
          new Date().toISOString(),
        );
      return folder;
    } catch (error) {
      try {
        if (directoryExists(targetPath)) rmdirSync(targetPath);
      } catch {
        // Preserve the primary operation failure; later reconciliation can index an empty directory.
      }
      if (error instanceof LibraryServiceError) throw error;
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }
  }

  /**
   * Renaming a managed folder renames the real directory and rewrites the
   * recorded path of every row underneath it: the folder row itself, all
   * descendant managed_folders rows, and every managed asset whose recorded
   * path lives in the subtree — including missing and already-trashed rows,
   * whose recorded paths must still follow the real directory so trash
   * restore and reconciliation keep working.
   *
   * Crash-safety convention follows renameAssetFile: rename on disk first,
   * then one DB transaction (path + FTS sync); on DB failure the disk rename
   * is rolled back best-effort. Content is untouched, so no revision row is
   * recorded.
   */
  renameManagedFolder(input: {
    libraryId: string;
    folderId: string;
    newName: string;
  }): ManagedFolderSummary {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    let name: string;
    try {
      name = normalizeFolderName(input.newName);
    } catch (error) {
      throw new LibraryServiceError('INVALID_FOLDER_NAME', {
        reason: 'NAME_NOT_SUPPORTED',
        cause: error,
      });
    }

    const row = openLibrary.connection
      .prepare(
        'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
      )
      .get(input.folderId) as ManagedFolderRow | undefined;
    if (!row) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    // Identical target (same spelling, same case): success no-op, nothing on
    // disk or in the DB is touched.
    if (name === row.name) {
      return this.summarizeManagedFolderRowRecursive(openLibrary, row);
    }

    const oldRelativePath = row.relative_path;
    const parentRelativePath = path.posix.dirname(oldRelativePath);
    const newRelativePath =
      parentRelativePath === '.' ? name : path.posix.join(parentRelativePath, name);
    const newIdentity = portablePathIdentity(newRelativePath);

    const sourcePath = this.folderPath(openLibrary, oldRelativePath);
    if (!realDirectoryExists(sourcePath)) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }

    // Conflicts are judged by portable (case-folded) identity so a case-only
    // match against a DIFFERENT entry is still a conflict on case-insensitive
    // volumes; the source directory's own entry is exempt, which is what
    // makes a pure case-change rename (a -> A) possible.
    const databaseConflict =
      openLibrary.connection
        .prepare('SELECT folder_id FROM managed_folders WHERE path_identity = ? AND folder_id != ?')
        .get(newIdentity, row.folder_id) ??
      openLibrary.connection
        .prepare(
          `SELECT asset_id FROM assets
            WHERE path_identity = ? AND location_kind = 'managed' AND deleted_at IS NULL`,
        )
        .get(newIdentity);
    if (databaseConflict) throw new LibraryServiceError('FOLDER_NAME_CONFLICT');

    const parentDirectoryPath = path.dirname(sourcePath);
    const targetSegmentIdentity = portablePathSegmentIdentity(name);
    let directoryEntries;
    try {
      directoryEntries = readdirSync(parentDirectoryPath, { withFileTypes: true });
    } catch (error) {
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }
    for (const entry of directoryEntries) {
      if (entry.name === row.name) continue;
      if (portablePathSegmentIdentity(entry.name) === targetSegmentIdentity) {
        throw new LibraryServiceError('FOLDER_NAME_CONFLICT');
      }
    }

    const destinationPath = path.join(parentDirectoryPath, name);
    const now = new Date().toISOString();
    let renamed = false;
    try {
      renameSync(sourcePath, destinationPath);
      renamed = true;
      openLibrary.connection.transaction(() => {
        const changed = openLibrary.connection
          .prepare(
            `UPDATE managed_folders
                SET name = ?, relative_path = ?, path_identity = ?
              WHERE folder_id = ?`,
          )
          .run(name, newRelativePath, newIdentity, row.folder_id);
        if (changed.changes !== 1) {
          throw new LibraryServiceError('FOLDER_NOT_FOUND', { reason: 'SOURCE_CHANGED' });
        }

        // Descendants are matched by an exact path prefix via substr (never
        // LIKE, so folder names containing LIKE wildcards stay literal).
        // SQLite substr counts characters, not UTF-16 code units, hence the
        // spread length rather than String.length.
        const prefixLength = [...oldRelativePath].length + 1;
        const oldPrefix = `${oldRelativePath}/`;
        const descendantFolders = openLibrary.connection
          .prepare(
            `SELECT folder_id, relative_path FROM managed_folders
              WHERE substr(relative_path, 1, ?) = ?`,
          )
          .all(prefixLength, oldPrefix) as Array<{
            folder_id: string;
            relative_path: string;
          }>;
        const updateDescendant = openLibrary.connection.prepare(
          `UPDATE managed_folders
              SET relative_path = ?, path_identity = ?
            WHERE folder_id = ?`,
        );
        for (const descendant of descendantFolders) {
          const rewritten = newRelativePath + descendant.relative_path.slice(oldRelativePath.length);
          updateDescendant.run(rewritten, portablePathIdentity(rewritten), descendant.folder_id);
        }

        // Every managed asset recorded under the subtree follows the real
        // directory, regardless of availability or trash state; only live
        // assets need their search content re-tokenized.
        const subtreeAssets = openLibrary.connection
          .prepare(
            `SELECT asset_id, relative_file_path, deleted_at FROM assets
              WHERE location_kind = 'managed'
                AND substr(relative_file_path, 1, ?) = ?`,
          )
          .all(prefixLength, oldPrefix) as Array<{
            asset_id: string;
            relative_file_path: string;
            deleted_at: string | null;
          }>;
        const updateAsset = openLibrary.connection.prepare(
          `UPDATE assets
              SET relative_file_path = ?, path_identity = ?, updated_at = ?
            WHERE asset_id = ?`,
        );
        for (const asset of subtreeAssets) {
          const rewritten = newRelativePath + asset.relative_file_path.slice(oldRelativePath.length);
          updateAsset.run(rewritten, portablePathIdentity(rewritten), now, asset.asset_id);
          if (asset.deleted_at === null) {
            this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
          }
        }
      })();
    } catch (error) {
      if (renamed) {
        try {
          renameSync(destinationPath, sourcePath);
        } catch (rollbackError) {
          // The DB transaction did not commit; if the filesystem rollback also
          // failed the next refresh reconciles the moved directory back into
          // the library. Never mask the primary failure.
          this.diagnose('folder.rename.rollback', rollbackError, {
            libraryId: input.libraryId,
            folderId: row.folder_id,
          });
        }
      }
      if (isMissingPathError(error)) {
        throw new LibraryServiceError('FOLDER_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND', cause: error });
      }
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }

    return this.summarizeManagedFolderRowRecursive(openLibrary, {
      ...row,
      name,
      relative_path: newRelativePath,
    });
  }

  /**
   * Clone a managed folder as a sibling (REQ-MENU-005 / Serpent-vgp).
   * Creates a new folder tree with fresh folder/asset identities; human
   * metadata + tags are cloned via copyAssets. Linked folders are refused.
   */
  cloneManagedFolder(input: {
    libraryId: string;
    folderId: string;
  }): {
    folder: ManagedFolderSummary;
    clonedFolderCount: number;
    clonedAssetCount: number;
  } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const { folder, descendantFolders, assetIds } =
      this.collectManagedFolderSubtree(openLibrary, input.folderId);

    const cloneName = this.availableSiblingFolderName(
      openLibrary,
      folder.parent_folder_id,
      folder.name,
    );
    const rootClone = this.createManagedFolder({
      libraryId: input.libraryId,
      name: cloneName,
      parentFolderId: folder.parent_folder_id ?? undefined,
    });

    const idMap = new Map<string, string>([[folder.folder_id, rootClone.folderId]]);
    // Create descendants shallow→deep so parents exist before children.
    const descendantsShallowFirst = [...descendantFolders].sort(
      (left, right) => left.relative_path.length - right.relative_path.length,
    );
    for (const descendant of descendantsShallowFirst) {
      const parentCloneId = descendant.parent_folder_id
        ? idMap.get(descendant.parent_folder_id)
        : undefined;
      if (!parentCloneId) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const created = this.createManagedFolder({
        libraryId: input.libraryId,
        name: descendant.name,
        parentFolderId: parentCloneId,
      });
      idMap.set(descendant.folder_id, created.folderId);
    }

    // Direct assets of each source folder → matching clone folder.
    let clonedAssetCount = 0;
    const foldersToCopy = [folder, ...descendantsShallowFirst];
    for (const sourceFolder of foldersToCopy) {
      const targetFolderId = idMap.get(sourceFolder.folder_id);
      if (!targetFolderId) continue;
      const directAssetIds = openLibrary.connection
        .prepare(
          `SELECT asset_id FROM assets
            WHERE location_kind = 'managed'
              AND deleted_at IS NULL
              AND availability = 'available'
              AND managed_folder_id = ?`,
        )
        .all(sourceFolder.folder_id) as Array<{ asset_id: string }>;
      if (directAssetIds.length === 0) continue;
      const copied = this.copyAssets({
        libraryId: input.libraryId,
        assetIds: directAssetIds.map((row) => row.asset_id),
        targetFolderId,
        conflictStrategy: 'keep-both',
      });
      clonedAssetCount += copied.copiedCount;
    }

    // assetIds was collected for the whole subtree; unused beyond validation.
    void assetIds;

    return {
      folder: this.summarizeManagedFolderRowRecursive(openLibrary, {
        folder_id: rootClone.folderId,
        parent_folder_id: rootClone.parentFolderId,
        name: rootClone.name,
        relative_path: rootClone.relativePath,
        path_identity: portablePathIdentity(rootClone.relativePath),
      }),
      clonedFolderCount: idMap.size,
      clonedAssetCount,
    };
  }

  /**
   * Move managed folders under a new parent (REQ-MENU-005 / Serpent-vgp).
   * Rejects moves into self/descendant. Nested selections are collapsed to
   * outermost folders so a parent move does not double-move a child.
   */
  moveManagedFolders(input: {
    libraryId: string;
    folderIds: string[];
    targetParentFolderId: string | null;
    conflictStrategy?: 'keep-both' | 'skip';
  }): {
    movedCount: number;
    skippedCount: number;
    folders: ManagedFolderSummary[];
  } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    if (
      input.folderIds.length === 0 ||
      new Set(input.folderIds).size !== input.folderIds.length
    ) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }
    const strategy = input.conflictStrategy ?? 'keep-both';
    const targetParent =
      input.targetParentFolderId === null
        ? null
        : (openLibrary.connection
            .prepare(
              'SELECT folder_id, relative_path FROM managed_folders WHERE folder_id = ?',
            )
            .get(input.targetParentFolderId) as
            | { folder_id: string; relative_path: string }
            | undefined);
    if (input.targetParentFolderId !== null && !targetParent) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }

    const rows = openLibrary.connection
      .prepare(
        `SELECT folder_id, parent_folder_id, name, relative_path, path_identity
           FROM managed_folders
          WHERE folder_id IN (${input.folderIds.map(() => '?').join(',')})`,
      )
      .all(...input.folderIds) as ManagedFolderRow[];
    if (rows.length !== input.folderIds.length) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }

    // Drop folders that are descendants of another selected folder.
    const selected = rows.filter(
      (row) =>
        !rows.some(
          (other) =>
            other.folder_id !== row.folder_id &&
            (row.relative_path === other.relative_path ||
              row.relative_path.startsWith(`${other.relative_path}/`)),
        ),
    );

    let movedCount = 0;
    let skippedCount = 0;
    const moved: ManagedFolderSummary[] = [];

    for (const row of selected) {
      // Moving onto the current parent is a no-op skip.
      const currentParent = row.parent_folder_id;
      if (
        (currentParent === null && input.targetParentFolderId === null) ||
        currentParent === input.targetParentFolderId
      ) {
        skippedCount += 1;
        continue;
      }

      // Refuse move into self or descendant.
      if (input.targetParentFolderId !== null) {
        const targetRelative = targetParent!.relative_path;
        if (
          targetRelative === row.relative_path ||
          targetRelative.startsWith(`${row.relative_path}/`)
        ) {
          throw new LibraryServiceError('FOLDER_NAME_CONFLICT');
        }
      }

      const destParentRelative = targetParent?.relative_path ?? '';
      let destName = row.name;
      let destRelative = destParentRelative
        ? path.posix.join(destParentRelative, destName)
        : destName;
      let destIdentity = portablePathIdentity(destRelative);

      const conflict =
        openLibrary.connection
          .prepare(
            'SELECT folder_id FROM managed_folders WHERE path_identity = ? AND folder_id != ?',
          )
          .get(destIdentity, row.folder_id) ??
        openLibrary.connection
          .prepare(
            `SELECT asset_id FROM assets
              WHERE path_identity = ? AND location_kind = 'managed' AND deleted_at IS NULL`,
          )
          .get(destIdentity);

      if (conflict) {
        if (strategy === 'skip') {
          skippedCount += 1;
          continue;
        }
        destName = this.availableSiblingFolderName(
          openLibrary,
          input.targetParentFolderId,
          row.name,
        );
        destRelative = destParentRelative
          ? path.posix.join(destParentRelative, destName)
          : destName;
        destIdentity = portablePathIdentity(destRelative);
      }

      const sourcePath = this.folderPath(openLibrary, row.relative_path);
      if (!realDirectoryExists(sourcePath)) {
        throw new LibraryServiceError('FOLDER_NOT_FOUND', {
          reason: 'SOURCE_NOT_FOUND',
        });
      }
      const destinationPath = this.folderPath(openLibrary, destRelative);
      if (this.portableDiskDestination(openLibrary, destRelative)) {
        if (strategy === 'skip') {
          skippedCount += 1;
          continue;
        }
        destName = this.availableSiblingFolderName(
          openLibrary,
          input.targetParentFolderId,
          row.name,
        );
        destRelative = destParentRelative
          ? path.posix.join(destParentRelative, destName)
          : destName;
        destIdentity = portablePathIdentity(destRelative);
      }
      const finalDestination = this.folderPath(openLibrary, destRelative);

      const oldRelativePath = row.relative_path;
      const now = new Date().toISOString();
      let renamed = false;
      try {
        renameSync(sourcePath, finalDestination);
        renamed = true;
        openLibrary.connection.transaction(() => {
          const changed = openLibrary.connection
            .prepare(
              `UPDATE managed_folders
                  SET parent_folder_id = ?, name = ?, relative_path = ?, path_identity = ?
                WHERE folder_id = ?`,
            )
            .run(
              input.targetParentFolderId,
              destName,
              destRelative,
              destIdentity,
              row.folder_id,
            );
          if (changed.changes !== 1) {
            throw new LibraryServiceError('FOLDER_NOT_FOUND', {
              reason: 'SOURCE_CHANGED',
            });
          }

          const prefixLength = [...oldRelativePath].length + 1;
          const oldPrefix = `${oldRelativePath}/`;
          const descendantFolders = openLibrary.connection
            .prepare(
              `SELECT folder_id, relative_path FROM managed_folders
                WHERE substr(relative_path, 1, ?) = ?`,
            )
            .all(prefixLength, oldPrefix) as Array<{
              folder_id: string;
              relative_path: string;
            }>;
          const updateDescendant = openLibrary.connection.prepare(
            `UPDATE managed_folders
                SET relative_path = ?, path_identity = ?
              WHERE folder_id = ?`,
          );
          for (const descendant of descendantFolders) {
            const rewritten =
              destRelative +
              descendant.relative_path.slice(oldRelativePath.length);
            updateDescendant.run(
              rewritten,
              portablePathIdentity(rewritten),
              descendant.folder_id,
            );
          }

          const subtreeAssets = openLibrary.connection
            .prepare(
              `SELECT asset_id, relative_file_path, deleted_at FROM assets
                WHERE location_kind = 'managed'
                  AND substr(relative_file_path, 1, ?) = ?`,
            )
            .all(prefixLength, oldPrefix) as Array<{
              asset_id: string;
              relative_file_path: string;
              deleted_at: string | null;
            }>;
          // Also rewrite assets whose managed_folder_id is the moved root and
          // whose relative path equals the old folder path prefix for files
          // stored directly in the folder (path = folder/file).
          const updateAsset = openLibrary.connection.prepare(
            `UPDATE assets
                SET relative_file_path = ?, path_identity = ?, updated_at = ?
              WHERE asset_id = ?`,
          );
          for (const asset of subtreeAssets) {
            const rewritten =
              destRelative +
              asset.relative_file_path.slice(oldRelativePath.length);
            updateAsset.run(
              rewritten,
              portablePathIdentity(rewritten),
              now,
              asset.asset_id,
            );
            if (asset.deleted_at === null) {
              this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
            }
          }

          // Direct children whose path is exactly under the old folder but
          // matched via managed_folder_id when relative path uses the folder.
          // The substr prefix match already covers `oldRelativePath/` assets;
          // also cover the rare case of the folder path itself never holding
          // an asset file named equal to the folder.
        })();
      } catch (error) {
        if (renamed) {
          try {
            renameSync(finalDestination, sourcePath);
          } catch (rollbackError) {
            this.diagnose('folder.move.rollback', rollbackError, {
              libraryId: input.libraryId,
              folderId: row.folder_id,
            });
          }
        }
        if (isMissingPathError(error)) {
          throw new LibraryServiceError('FOLDER_NOT_FOUND', {
            reason: 'SOURCE_NOT_FOUND',
            cause: error,
          });
        }
        throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
      }

      movedCount += 1;
      moved.push(
        this.summarizeManagedFolderRowRecursive(openLibrary, {
          ...row,
          parent_folder_id: input.targetParentFolderId,
          name: destName,
          relative_path: destRelative,
          path_identity: destIdentity,
        }),
      );
    }

    return { movedCount, skippedCount, folders: moved };
  }

  /** Sibling folder name that does not collide on disk or in the DB. */
  private availableSiblingFolderName(
    openLibrary: OpenLibrary,
    parentFolderId: string | null,
    baseName: string,
  ): string {
    const parentRelative =
      parentFolderId === null
        ? ''
        : (
            openLibrary.connection
              .prepare(
                'SELECT relative_path FROM managed_folders WHERE folder_id = ?',
              )
              .get(parentFolderId) as { relative_path: string } | undefined
          )?.relative_path;
    if (parentFolderId !== null && parentRelative === undefined) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }

    const candidates = [`${baseName} copy`];
    for (let index = 2; index < 10_000; index += 1) {
      candidates.push(`${baseName} copy ${index}`);
    }
    for (const candidate of candidates) {
      let name: string;
      try {
        name = normalizeFolderName(candidate);
      } catch {
        continue;
      }
      const relativePath = parentRelative
        ? path.posix.join(parentRelative, name)
        : name;
      const identity = portablePathIdentity(relativePath);
      const databaseConflict =
        openLibrary.connection
          .prepare(
            'SELECT folder_id FROM managed_folders WHERE path_identity = ?',
          )
          .get(identity) ??
        openLibrary.connection
          .prepare(
            `SELECT asset_id FROM assets
              WHERE path_identity = ? AND location_kind = 'managed' AND deleted_at IS NULL`,
          )
          .get(identity);
      if (databaseConflict) continue;
      if (this.portableDiskDestination(openLibrary, relativePath)) continue;
      return name;
    }
    throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
  }

  /**
   * Clarification #7 / Serpent-ekj: trash a managed folder (empty or not).
   * All active managed assets in the subtree move to the app trash; folder
   * rows and the real Assets/ directory tree are then removed. Restoring
   * assets falls back to the library root when the original folder is gone.
   */
  trashManagedFolder(input: {
    libraryId: string;
    folderId: string;
  }): { trashedAssetCount: number; removedFolderCount: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const { folder, descendantFolders, assetIds } =
      this.collectManagedFolderSubtree(openLibrary, input.folderId);

    let trashedAssetCount = 0;
    if (assetIds.length > 0) {
      const result = this.trashAssets({
        libraryId: input.libraryId,
        assetIds,
      });
      trashedAssetCount = result.trashedCount;
    }

    const trashedAt = new Date().toISOString();
    const tombstoneFolders = [...descendantFolders, folder];
    const folderIds = tombstoneFolders.map((row) => row.folder_id);
    const countPlaceholders = folderIds.map(() => '?').join(', ');
    const countRows =
      folderIds.length === 0
        ? []
        : (openLibrary.connection
            .prepare(
              `SELECT trashed_from_folder_id AS folder_id, COUNT(*) AS asset_count
                 FROM assets
                WHERE deleted_at IS NOT NULL
                  AND trashed_from_folder_id IN (${countPlaceholders})
                GROUP BY trashed_from_folder_id`,
            )
            .all(...folderIds) as Array<{ folder_id: string; asset_count: number }>);
    const assetCountByFolderId = new Map(
      countRows.map((row) => [row.folder_id, row.asset_count]),
    );

    openLibrary.connection.transaction(() => {
      const insert = openLibrary.connection.prepare(
        `INSERT INTO trashed_managed_folders
           (tombstone_id, folder_id, relative_path, name, parent_relative_path,
            trashed_at, trashed_asset_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of tombstoneFolders) {
        const parentRelative = path.posix.dirname(row.relative_path);
        insert.run(
          randomUUID(),
          row.folder_id,
          row.relative_path,
          row.name,
          parentRelative === '.' ? null : parentRelative,
          trashedAt,
          assetCountByFolderId.get(row.folder_id) ?? 0,
        );
      }
    })();

    const removedFolderCount = this.removeManagedFolderRowsAndDirectory(
      openLibrary,
      folder,
      descendantFolders,
    );
    return { trashedAssetCount, removedFolderCount };
  }

  /**
   * Clarification #7 / Serpent-ekj: permanently delete a managed folder and
   * every active managed asset in its subtree from disk. Irreversible.
   */
  deleteManagedFolderFromDisk(input: {
    libraryId: string;
    folderId: string;
  }): { deletedAssetCount: number; removedFolderCount: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const { folder, descendantFolders, assetIds } =
      this.collectManagedFolderSubtree(openLibrary, input.folderId);

    let deletedAssetCount = 0;
    if (assetIds.length > 0) {
      deletedAssetCount = this.deleteActiveManagedAssetsFromDisk(
        openLibrary,
        assetIds,
      );
    }

    const removedFolderCount = this.removeManagedFolderRowsAndDirectory(
      openLibrary,
      folder,
      descendantFolders,
    );
    return { deletedAssetCount, removedFolderCount };
  }

  /**
   * Clarification #7: remove a linked folder root from the library index.
   * Source files on disk are never touched. Linked child paths use
   * trashLinkedFolderSubtree / deleteLinkedFolderSubtreeFromDisk instead.
   */
  removeLinkedFolder(input: {
    libraryId: string;
    folderId: string;
  }): { removedAssetCount: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const linked = openLibrary.connection
      .prepare(
        'SELECT folder_id FROM linked_folders WHERE folder_id = ? AND library_id = ?',
      )
      .get(input.folderId, input.libraryId) as { folder_id: string } | undefined;
    if (!linked) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    const assetRows = openLibrary.connection
      .prepare(
        `SELECT asset_id FROM assets
          WHERE linked_folder_id = ? AND location_kind = 'linked' AND deleted_at IS NULL`,
      )
      .all(input.folderId) as Array<{ asset_id: string }>;

    openLibrary.connection.transaction(() => {
      for (const row of assetRows) {
        openLibrary.connection
          .prepare('DELETE FROM assets WHERE asset_id = ?')
          .run(row.asset_id);
      }
      const removed = openLibrary.connection
        .prepare('DELETE FROM linked_folders WHERE folder_id = ?')
        .run(input.folderId);
      if (removed.changes !== 1) {
        throw new LibraryServiceError('FOLDER_NOT_FOUND');
      }
    })();

    this.stopLinkedWatcher(input.libraryId, input.folderId);
    return { removedAssetCount: assetRows.length };
  }

  /**
   * Clarification #7: delete a linked *child* folder path.
   * - deleteFromDisk false: move sources to the OS trash (linked bytes are not
   *   library-owned, so they cannot enter the app trash) and drop index rows.
   * - deleteFromDisk true: irreversible rm of the child directory tree + rows.
   */
  async deleteLinkedFolderSubtree(input: {
    libraryId: string;
    linkedFolderId: string;
    relativePath: string;
    deleteFromDisk: boolean;
  }): Promise<{ deletedAssetCount: number; failedCount: number }> {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    let relativePath: string;
    try {
      relativePath = normalizeRelativeAssetPath(input.relativePath);
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION', { cause: error });
    }

    const linked = openLibrary.connection
      .prepare(
        `SELECT folder_id, absolute_root_path, status
           FROM linked_folders WHERE folder_id = ? AND library_id = ?`,
      )
      .get(input.linkedFolderId, input.libraryId) as
      | {
          folder_id: string;
          absolute_root_path: string;
          status: 'available' | 'offline';
        }
      | undefined;
    if (!linked) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    const prefix = `${relativePath}/`;
    const assetRows = openLibrary.connection
      .prepare(
        `SELECT asset_id FROM assets
          WHERE linked_folder_id = ?
            AND location_kind = 'linked'
            AND deleted_at IS NULL
            AND (relative_file_path = ? OR substr(relative_file_path, 1, ?) = ?)`,
      )
      .all(
        input.linkedFolderId,
        relativePath,
        [...prefix].length,
        prefix,
      ) as Array<{ asset_id: string }>;

    const dirPath = path.join(linked.absolute_root_path, ...relativePath.split('/'));

    if (input.deleteFromDisk) {
      if (linked.status === 'available' && existsSync(dirPath)) {
        try {
          rmSync(dirPath, { force: true, recursive: true });
        } catch (error) {
          throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
        }
      }
      if (assetRows.length > 0) {
        openLibrary.connection.transaction(() => {
          for (const row of assetRows) {
            openLibrary.connection
              .prepare('DELETE FROM assets WHERE asset_id = ?')
              .run(row.asset_id);
          }
        })();
      }
      return { deletedAssetCount: assetRows.length, failedCount: 0 };
    }

    // Default: OS trash for indexed files (chunked), then trash leftover dir.
    let deletedAssetCount = 0;
    let failedCount = 0;
    const ids = assetRows.map((row) => row.asset_id);
    for (let offset = 0; offset < ids.length; offset += 20) {
      const chunk = ids.slice(offset, offset + 20);
      const result = await this.deleteLinkedAssets({
        libraryId: input.libraryId,
        assetIds: chunk,
        deleteSourceFile: true,
      });
      deletedAssetCount += result.deletedCount;
      failedCount += result.failedCount;
    }
    if (linked.status === 'available' && existsSync(dirPath)) {
      const trashItem = this.options.trashItem ?? defaultTrashItem;
      try {
        await trashItem(dirPath);
      } catch {
        // Files already trashed; directory cleanup is best-effort.
      }
    }
    return { deletedAssetCount, failedCount };
  }

  private collectManagedFolderSubtree(
    openLibrary: OpenLibrary,
    folderId: string,
  ): {
    folder: ManagedFolderRow;
    descendantFolders: ManagedFolderRow[];
    assetIds: string[];
  } {
    const folder = openLibrary.connection
      .prepare(
        'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
      )
      .get(folderId) as ManagedFolderRow | undefined;
    if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    const prefixLength = [...folder.relative_path].length + 1;
    const oldPrefix = `${folder.relative_path}/`;
    const descendantFolders = openLibrary.connection
      .prepare(
        `SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders
          WHERE substr(relative_path, 1, ?) = ?
          ORDER BY length(relative_path) DESC`,
      )
      .all(prefixLength, oldPrefix) as ManagedFolderRow[];

    const folderIds = [folder.folder_id, ...descendantFolders.map((row) => row.folder_id)];
    const placeholders = folderIds.map(() => '?').join(', ');
    const assetRows = openLibrary.connection
      .prepare(
        `SELECT asset_id FROM assets
          WHERE location_kind = 'managed'
            AND deleted_at IS NULL
            AND (
              managed_folder_id IN (${placeholders})
              OR substr(relative_file_path, 1, ?) = ?
            )`,
      )
      .all(...folderIds, prefixLength, oldPrefix) as Array<{ asset_id: string }>;

    return {
      folder,
      descendantFolders,
      assetIds: assetRows.map((row) => row.asset_id),
    };
  }

  private removeManagedFolderRowsAndDirectory(
    openLibrary: OpenLibrary,
    folder: ManagedFolderRow,
    descendantFolders: ManagedFolderRow[],
  ): number {
    const ordered = [...descendantFolders, folder];
    const directoryPath = this.folderPath(openLibrary, folder.relative_path);

    openLibrary.connection.transaction(() => {
      for (const row of ordered) {
        const result = openLibrary.connection
          .prepare('DELETE FROM managed_folders WHERE folder_id = ?')
          .run(row.folder_id);
        if (result.changes !== 1) {
          throw new LibraryServiceError('FOLDER_NOT_FOUND', { reason: 'SOURCE_CHANGED' });
        }
      }
    })();

    try {
      if (existsSync(directoryPath)) {
        rmSync(directoryPath, { force: true, recursive: true });
      }
    } catch (error) {
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }

    return ordered.length;
  }

  private deleteActiveManagedAssetsFromDisk(
    openLibrary: OpenLibrary,
    assetIds: string[],
  ): number {
    if (assetIds.length === 0) return 0;
    const placeholders = assetIds.map(() => '?').join(', ');
    const rows = openLibrary.connection
      .prepare(
        `SELECT asset_id, relative_file_path FROM assets
          WHERE asset_id IN (${placeholders})
            AND location_kind = 'managed'
            AND deleted_at IS NULL`,
      )
      .all(...assetIds) as Array<{ asset_id: string; relative_file_path: string }>;

    if (rows.length !== assetIds.length) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    for (const row of rows) {
      const filePath = this.folderPath(openLibrary, row.relative_file_path);
      try {
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true });
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
          throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
            reason:
              code === 'EBUSY' ? 'FILE_BUSY' : 'PERMISSION_DENIED',
            cause: error,
          });
        }
        if (!isMissingPathError(error)) {
          throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
        }
      }
    }

    openLibrary.connection.transaction(() => {
      for (const row of rows) {
        openLibrary.connection
          .prepare('DELETE FROM assets WHERE asset_id = ?')
          .run(row.asset_id);
      }
    })();

    return rows.length;
  }


  listManagedFolders(libraryId: string): ManagedFolderSummary[] {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const rows = openLibrary.connection
      .prepare(
        'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders ORDER BY relative_path',
      )
      .all() as ManagedFolderRow[];
    const counts = this.managedFolderCountMaps(openLibrary);
    // Serpent-toh: ManagedFolderSummary.directAssetCount is the displayed
    // badge count = all descendants (schema field name kept for compat).
    const recursive = this.managedFolderRecursiveAssetCounts(openLibrary, rows);
    return rows.map((row) => {
      const summary = this.summarizeManagedFolderRow(openLibrary, row, counts);
      return {
        ...summary,
        directAssetCount: recursive.get(row.folder_id) ?? summary.directAssetCount,
      };
    });
  }

  /**
   * Direct child folder cards for the browse canvas (REQ-FOLDER-001/002/003).
   * Counts and covers are batched — never N+1 per card.
   */
  listFolderBrowseEntries(input: {
    libraryId: string;
    parentFolderId: string | null;
  }): FolderBrowseEntry[] {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    if (input.parentFolderId !== null) {
      const parent = openLibrary.connection
        .prepare('SELECT folder_id FROM managed_folders WHERE folder_id = ?')
        .get(input.parentFolderId) as { folder_id: string } | undefined;
      if (!parent) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }

    const children = (
      input.parentFolderId === null
        ? openLibrary.connection
            .prepare(
              `SELECT folder_id, parent_folder_id, name, relative_path, path_identity
                 FROM managed_folders
                WHERE parent_folder_id IS NULL
                ORDER BY name COLLATE NOCASE`,
            )
            .all()
        : openLibrary.connection
            .prepare(
              `SELECT folder_id, parent_folder_id, name, relative_path, path_identity
                 FROM managed_folders
                WHERE parent_folder_id = ?
                ORDER BY name COLLATE NOCASE`,
            )
            .all(input.parentFolderId)
    ) as ManagedFolderRow[];
    if (children.length === 0) return [];

    const counts = this.managedFolderCountMaps(openLibrary, children.map((row) => row.folder_id));
    const recursiveCounts = this.managedFolderRecursiveAssetCounts(
      openLibrary,
      children,
    );
    const coverMap = this.folderCoverArtifactMap(
      openLibrary,
      children.map((row) => row.folder_id),
    );

    return children.map((row) => {
      const directAssetCount = counts.directAssetCounts.get(row.folder_id) ?? 0;
      return {
        folderId: row.folder_id,
        parentFolderId: row.parent_folder_id,
        locationKind: 'managed' as const,
        name: row.name,
        relativePath: row.relative_path,
        status: 'available' as const,
        directAssetCount,
        // Serpent-toh / REQ-FOLDER-003: display all descendant assets.
        recursiveAssetCount: recursiveCounts.get(row.folder_id) ?? directAssetCount,
        childFolderCount: counts.childFolderCounts.get(row.folder_id) ?? 0,
        coverArtifactIds: coverMap.get(row.folder_id) ?? [],
      };
    });
  }

  /**
   * Count assets in each folder's full subtree (self + descendants by
   * relative_path prefix). Serpent-toh / REQ-FOLDER-003.
   */
  private managedFolderRecursiveAssetCounts(
    openLibrary: OpenLibrary,
    folders: Array<{ folder_id: string; relative_path: string }>,
  ): Map<string, number> {
    const result = new Map<string, number>();
    if (folders.length === 0) return result;

    const allFolders = openLibrary.connection
      .prepare(
        'SELECT folder_id, relative_path FROM managed_folders',
      )
      .all() as Array<{ folder_id: string; relative_path: string }>;
    const { directAssetCounts } = this.managedFolderCountMaps(openLibrary);

    for (const folder of folders) {
      const prefix = folder.relative_path;
      let total = directAssetCounts.get(folder.folder_id) ?? 0;
      for (const candidate of allFolders) {
        if (candidate.folder_id === folder.folder_id) continue;
        if (
          candidate.relative_path === prefix ||
          candidate.relative_path.startsWith(`${prefix}/`)
        ) {
          total += directAssetCounts.get(candidate.folder_id) ?? 0;
        }
      }
      result.set(folder.folder_id, total);
    }
    return result;
  }

  private managedFolderCountMaps(
    openLibrary: OpenLibrary,
    folderIds?: string[],
  ): {
    directAssetCounts: Map<string, number>;
    childFolderCounts: Map<string, number>;
  } {
    const directAssetCounts = new Map<string, number>();
    const childFolderCounts = new Map<string, number>();

    if (folderIds && folderIds.length === 0) {
      return { directAssetCounts, childFolderCounts };
    }

    if (folderIds) {
      const placeholders = folderIds.map(() => '?').join(', ');
      const assetRows = openLibrary.connection
        .prepare(
          `SELECT managed_folder_id AS folder_id, COUNT(*) AS count
             FROM assets
            WHERE managed_folder_id IN (${placeholders})
              AND deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = assets.asset_id
              )
            GROUP BY managed_folder_id`,
        )
        .all(...folderIds) as Array<{ folder_id: string; count: number }>;
      for (const row of assetRows) directAssetCounts.set(row.folder_id, row.count);

      const childRows = openLibrary.connection
        .prepare(
          `SELECT parent_folder_id AS folder_id, COUNT(*) AS count
             FROM managed_folders
            WHERE parent_folder_id IN (${placeholders})
            GROUP BY parent_folder_id`,
        )
        .all(...folderIds) as Array<{ folder_id: string; count: number }>;
      for (const row of childRows) childFolderCounts.set(row.folder_id, row.count);
      return { directAssetCounts, childFolderCounts };
    }

    const assetRows = openLibrary.connection
      .prepare(
        `SELECT managed_folder_id AS folder_id, COUNT(*) AS count
           FROM assets
          WHERE managed_folder_id IS NOT NULL
            AND deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = assets.asset_id
            )
          GROUP BY managed_folder_id`,
      )
      .all() as Array<{ folder_id: string; count: number }>;
    for (const row of assetRows) directAssetCounts.set(row.folder_id, row.count);

    const childRows = openLibrary.connection
      .prepare(
        `SELECT parent_folder_id AS folder_id, COUNT(*) AS count
           FROM managed_folders
          WHERE parent_folder_id IS NOT NULL
          GROUP BY parent_folder_id`,
      )
      .all() as Array<{ folder_id: string; count: number }>;
    for (const row of childRows) childFolderCounts.set(row.folder_id, row.count);
    return { directAssetCounts, childFolderCounts };
  }

  private folderCoverArtifactMap(
    openLibrary: OpenLibrary,
    folderIds: string[],
  ): Map<string, string[]> {
    const covers = new Map<string, string[]>();
    if (folderIds.length === 0) return covers;
    const placeholders = folderIds.map(() => '?').join(', ');
    const rows = openLibrary.connection
      .prepare(
        `SELECT a.managed_folder_id AS folder_id, ra.artifact_id AS artifact_id
           FROM assets a
           JOIN revision_artifacts ra
             ON ra.revision_id = a.current_revision_id
            AND ra.invalidated_at IS NULL
            AND ra.status = 'ready'
            AND ra.kind = CASE
              WHEN LOWER(a.relative_file_path) LIKE '%.mp4'
                OR LOWER(a.relative_file_path) LIKE '%.webm'
                OR LOWER(a.relative_file_path) LIKE '%.mov'
                OR LOWER(a.relative_file_path) LIKE '%.avi'
                OR LOWER(a.relative_file_path) LIKE '%.wmv'
              THEN 'video_poster'
              ELSE 'thumbnail'
            END
          WHERE a.managed_folder_id IN (${placeholders})
            AND a.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id
            )
          ORDER BY a.managed_folder_id, a.relative_file_path`,
      )
      .all(...folderIds) as Array<{ folder_id: string; artifact_id: string }>;

    for (const row of rows) {
      const existing = covers.get(row.folder_id) ?? [];
      if (existing.length >= 3) continue;
      existing.push(row.artifact_id);
      covers.set(row.folder_id, existing);
    }
    return covers;
  }

  private summarizeManagedFolderRow(
    openLibrary: OpenLibrary,
    row: ManagedFolderRow,
    counts?: {
      directAssetCounts: Map<string, number>;
      childFolderCounts: Map<string, number>;
    },
  ): ManagedFolderSummary {
    const resolved = counts ?? this.managedFolderCountMaps(openLibrary, [row.folder_id]);
    return {
      folderId: row.folder_id,
      parentFolderId: row.parent_folder_id,
      name: row.name,
      relativePath: row.relative_path,
      directAssetCount: resolved.directAssetCounts.get(row.folder_id) ?? 0,
      childFolderCount: resolved.childFolderCounts.get(row.folder_id) ?? 0,
    };
  }

  /**
   * Serpent-toh: single-row returns (rename no-op / normal) must show the
   * displayed recursive directAssetCount, matching listManagedFolders —
   * otherwise the badge flickers from direct-only to recursive on refresh.
   */
  private summarizeManagedFolderRowRecursive(
    openLibrary: OpenLibrary,
    row: ManagedFolderRow,
  ): ManagedFolderSummary {
    const summary = this.summarizeManagedFolderRow(openLibrary, row);
    const recursive = this.managedFolderRecursiveAssetCounts(openLibrary, [
      row,
    ]);
    return {
      ...summary,
      directAssetCount:
        recursive.get(row.folder_id) ?? summary.directAssetCount,
    };
  }

  listLinkedFolders(libraryId: string): LinkedFolderSummary[] {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const rows = openLibrary.connection
      .prepare(
        'SELECT folder_id, display_name, status, absolute_root_path FROM linked_folders WHERE library_id = ? ORDER BY display_name',
      )
      .all(libraryId) as Array<{
        folder_id: string;
        display_name: string;
        status: 'available' | 'offline';
        absolute_root_path: string;
      }>;
    return rows.map((row) => {
      const countRow = openLibrary.connection
        .prepare(`SELECT COUNT(*) AS count FROM assets a
                   WHERE a.linked_folder_id = ?
                     AND NOT EXISTS (SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id)`)
        .get(row.folder_id) as { count: number };
      return {
        folderId: row.folder_id,
        displayName: row.display_name,
        status: row.status,
        assetCount: countRow.count,
        absoluteRootPath: row.absolute_root_path,
      };
    });
  }

  getLinkedFolderRules(input: { libraryId: string; folderId: string }): LinkedFolderRule[] {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const folder = openLibrary.connection
      .prepare('SELECT folder_id FROM linked_folders WHERE folder_id = ? AND library_id = ?')
      .get(input.folderId, input.libraryId);
    if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    return (openLibrary.connection.prepare(
      `SELECT rule_id, action, target, pattern, enabled
         FROM linked_folder_rules WHERE folder_id = ? ORDER BY position`,
    ).all(input.folderId) as Array<{
      rule_id: string; action: 'include' | 'exclude'; target: LinkedFolderRule['target']; pattern: string; enabled: number;
    }>).map((row) => ({
      ruleId: row.rule_id,
      action: row.action,
      target: row.target,
      pattern: row.pattern,
      enabled: row.enabled === 1,
    }));
  }

  setLinkedFolderRules(input: {
    libraryId: string;
    folderId: string;
    rules: LinkedFolderRule[];
  }): { rules: LinkedFolderRule[]; hiddenCount: number; restoredCount: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const folder = openLibrary.connection.prepare(
      'SELECT folder_id FROM linked_folders WHERE folder_id = ? AND library_id = ?',
    ).get(input.folderId, input.libraryId);
    if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    if (input.rules.length > 200 || new Set(input.rules.map((rule) => rule.ruleId)).size !== input.rules.length) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }
    const rules = input.rules.map((rule) => this.normalizeLinkedFolderRule(rule));
    let hiddenCount = 0;
    let restoredCount = 0;
    const now = new Date().toISOString();
    openLibrary.connection.transaction(() => {
      openLibrary.connection.prepare('DELETE FROM linked_folder_rules WHERE folder_id = ?').run(input.folderId);
      const insertRule = openLibrary.connection.prepare(
        `INSERT INTO linked_folder_rules(rule_id, folder_id, position, action, target, pattern, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      rules.forEach((rule, position) => insertRule.run(
        rule.ruleId, input.folderId, position, rule.action, rule.target, rule.pattern, rule.enabled ? 1 : 0,
      ));
      const assets = openLibrary.connection.prepare(
        `SELECT a.asset_id, a.relative_file_path,
                EXISTS(SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id) AS ignored
           FROM assets a WHERE a.linked_folder_id = ?`,
      ).all(input.folderId) as Array<{ asset_id: string; relative_file_path: string; ignored: number }>;
      for (const asset of assets) {
        const ignored = this.linkedPathIsIgnored(asset.relative_file_path, rules);
        if (ignored && asset.ignored === 0) {
          openLibrary.connection.prepare(
            'INSERT OR REPLACE INTO linked_ignored_assets(asset_id, ignored_at) VALUES (?, ?)',
          ).run(asset.asset_id, now);
          hiddenCount += 1;
        } else if (!ignored && asset.ignored === 1) {
          openLibrary.connection.prepare('DELETE FROM linked_ignored_assets WHERE asset_id = ?').run(asset.asset_id);
          restoredCount += 1;
        }
      }
    })();
    this.refreshManagedAssets(input.libraryId);
    return { rules: this.getLinkedFolderRules(input), hiddenCount, restoredCount };
  }

  copyAssetsToLinkedFolder(input: {
    libraryId: string;
    folderId: string;
    assetIds: string[];
    conflictStrategy: 'keep-both' | 'replace' | 'skip';
  }): { copiedCount: number; skippedCount: number; assets: AssetSummary[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const folder = openLibrary.connection.prepare(
      `SELECT absolute_root_path, status FROM linked_folders
        WHERE folder_id = ? AND library_id = ?`,
    ).get(input.folderId, input.libraryId) as { absolute_root_path: string; status: string } | undefined;
    if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    if (folder.status !== 'available' || !realDirectoryExists(folder.absolute_root_path)) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'SOURCE_NOT_FOUND' });
    }
    const rows = openLibrary.connection.prepare(
      `SELECT a.asset_id, a.relative_file_path
         FROM assets a
        WHERE a.asset_id IN (${input.assetIds.map(() => '?').join(',')})
          AND a.location_kind = 'managed' AND a.deleted_at IS NULL AND a.availability = 'available'`,
    ).all(...input.assetIds) as Array<{ asset_id: string; relative_file_path: string }>;
    if (rows.length !== input.assetIds.length) throw new LibraryServiceError('ASSET_NOT_FOUND');
    const copiedPaths: string[] = [];
    const backups: Array<{ destination: string; backup: string }> = [];
    const operationId = randomUUID();
    const operationPath = path.join(this.assertSafeOperationsRoot(openLibrary.summary.libraryPath), operationId);
    const backupPath = path.join(operationPath, 'backup');
    let skippedCount = 0;
    try {
      mkdirSync(backupPath, { recursive: true });
      const occupied = new Set<string>();
      for (const [index, row] of rows.entries()) {
        const sourcePath = this.folderPath(openLibrary, row.relative_file_path);
        const sourceEntry = lstatSync(sourcePath);
        if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink()) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'UNSUPPORTED_FILE_ENTRY' });
        }
        const originalName = path.posix.basename(row.relative_file_path);
        let relativeDestination = normalizeRelativeAssetPath(originalName);
        let destination = path.join(folder.absolute_root_path, relativeDestination);
        const destinationExists = (): boolean => occupied.has(portablePathIdentity(relativeDestination)) || existsSync(destination);
        if (destinationExists()) {
          if (input.conflictStrategy === 'skip') {
            skippedCount += 1;
            continue;
          }
          if (input.conflictStrategy === 'keep-both') {
            let found = false;
            for (let suffix = 2; suffix < 10_000 && !found; suffix += 1) {
              for (const candidate of copyNameCandidates(originalName, suffix)) {
                relativeDestination = normalizeRelativeAssetPath(candidate);
                destination = path.join(folder.absolute_root_path, relativeDestination);
                if (!destinationExists()) { found = true; break; }
              }
            }
            if (!found) throw new LibraryServiceError('IMPORT_APPLY_FAILED', { reason: 'NAME_NOT_SUPPORTED' });
          } else {
            const destinationEntry = lstatSync(destination);
            if (!destinationEntry.isFile() || destinationEntry.isSymbolicLink()) {
              throw new LibraryServiceError('IMPORT_APPLY_FAILED', { reason: 'UNSUPPORTED_FILE_ENTRY' });
            }
            const backup = path.join(backupPath, String(index));
            renameSync(destination, backup);
            backups.push({ destination, backup });
          }
        }
        copyFileSync(sourcePath, destination, constants.COPYFILE_EXCL);
        copiedPaths.push(relativeDestination);
        occupied.add(portablePathIdentity(relativeDestination));
      }
      rmSync(operationPath, { recursive: true, force: true });
    } catch (error) {
      for (const relativePath of copiedPaths.reverse()) {
        rmSync(path.join(folder.absolute_root_path, ...relativePath.split('/')), { force: true });
      }
      for (const backup of backups.reverse()) {
        if (existsSync(backup.backup)) renameSync(backup.backup, backup.destination);
      }
      rmSync(operationPath, { recursive: true, force: true });
      this.diagnose('linked-folder.copy-assets', error, {
        libraryId: input.libraryId, linkedFolderId: input.folderId, requestedCount: input.assetIds.length,
      });
      throw serviceError(error, 'IMPORT_APPLY_FAILED');
    }
    this.refreshManagedAssets(input.libraryId);
    const copiedIdentities = new Set(copiedPaths.map(portablePathIdentity));
    const assets = this.listAssets({ libraryId: input.libraryId, folderId: input.folderId, recursive: true })
      .filter((asset) => copiedIdentities.has(portablePathIdentity(asset.relativeFilePath)));
    return { copiedCount: copiedPaths.length, skippedCount, assets };
  }

  convertLinkedFolderToManaged(input: {
    libraryId: string;
    folderId: string;
    targetFolderId?: string;
  }): { managedFolderId: string; convertedCount: number; assets: AssetSummary[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const linked = openLibrary.connection.prepare(
      `SELECT display_name, absolute_root_path, status FROM linked_folders
        WHERE folder_id = ? AND library_id = ?`,
    ).get(input.folderId, input.libraryId) as {
      display_name: string; absolute_root_path: string; status: 'available' | 'offline';
    } | undefined;
    if (!linked) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    if (linked.status !== 'available' || !realDirectoryExists(linked.absolute_root_path)) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'SOURCE_NOT_FOUND' });
    }
    const parent = input.targetFolderId
      ? openLibrary.connection.prepare(
          'SELECT folder_id, relative_path FROM managed_folders WHERE folder_id = ?',
        ).get(input.targetFolderId) as { folder_id: string; relative_path: string } | undefined
      : undefined;
    if (input.targetFolderId && !parent) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    let folderName = normalizeFolderName(linked.display_name);
    let targetPrefix = parent ? path.posix.join(parent.relative_path, folderName) : folderName;
    for (let suffix = 2; this.portableDiskDestination(openLibrary, targetPrefix) || openLibrary.connection.prepare(
      'SELECT 1 FROM managed_folders WHERE path_identity = ?',
    ).get(portablePathIdentity(targetPrefix)); suffix += 1) {
      folderName = normalizeFolderName(copyNameCandidates(linked.display_name, suffix)[0]!);
      targetPrefix = parent ? path.posix.join(parent.relative_path, folderName) : folderName;
      if (suffix > 9_999) throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
    }

    const rules = this.getLinkedFolderRules({ libraryId: input.libraryId, folderId: input.folderId });
    const entries = this.enumerateLinkedSources(linked.absolute_root_path, input.folderId, rules);
    const linkedAssets = openLibrary.connection.prepare(
      `SELECT a.asset_id, a.relative_file_path,
              EXISTS(SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id) AS ignored
         FROM assets a WHERE a.linked_folder_id = ?`,
    ).all(input.folderId) as Array<{ asset_id: string; relative_file_path: string; ignored: number }>;
    const operationId = randomUUID();
    const operationsRoot = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);
    const operationPath = path.join(operationsRoot, operationId);
    const stagePath = path.join(operationPath, 'stage');
    const directorySet = new Set<string>([targetPrefix]);
    for (const entry of entries) {
      let cursor = path.posix.dirname(path.posix.join(targetPrefix, entry.relativePath));
      while (cursor !== '.' && cursor !== path.posix.dirname(cursor)) {
        directorySet.add(cursor);
        if (cursor === targetPrefix) break;
        cursor = path.posix.dirname(cursor);
      }
    }
    const directories = [...directorySet].sort((a, b) => a.split('/').length - b.split('/').length);
    const manifest: OperationManifest = {
      version: 1,
      phase: 'prepared',
      directories: directories.map((relativePath) => ({ relativePath, existed: false })),
      files: entries.map((entry, index) => ({
        stageName: String(index), backupName: String(index), hadDestination: false,
        destinationRelativePath: path.posix.join(targetPrefix, entry.relativePath),
      })),
    };
    const now = new Date().toISOString();
    try {
      openLibrary.connection.prepare(
        `INSERT INTO file_operations(operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
         VALUES (?, 'import', 'preparing', ?, NULL, ?, ?)`,
      ).run(operationId, JSON.stringify(manifest), now, now);
      mkdirSync(stagePath, { recursive: true });
      entries.forEach((entry, index) => {
        const sourcePath = this.linkedAssetPath(openLibrary, input.folderId, entry.relativePath);
        copyFileSync(sourcePath, path.join(stagePath, String(index)), constants.COPYFILE_EXCL);
      });
      openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'applying', updated_at = ? WHERE operation_id = ?",
      ).run(new Date().toISOString(), operationId);
      for (const directory of directories) mkdirSync(this.folderPath(openLibrary, directory));
      entries.forEach((entry, index) => {
        renameSync(
          path.join(stagePath, String(index)),
          this.folderPath(openLibrary, path.posix.join(targetPrefix, entry.relativePath)),
        );
      });
      this.failAt('crash-linked-convert-after-filesystem');
      const managedFolderId = randomUUID();
      const convertedAt = new Date().toISOString();
      openLibrary.connection.transaction(() => {
        openLibrary.connection.prepare(
          `INSERT INTO managed_folders(folder_id, parent_folder_id, name, relative_path, path_identity, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          managedFolderId, parent?.folder_id ?? null, folderName, targetPrefix,
          portablePathIdentity(targetPrefix), convertedAt,
        );
        const updateAsset = openLibrary.connection.prepare(
          `UPDATE assets SET location_kind = 'managed', managed_folder_id = ?, linked_folder_id = NULL,
                  relative_file_path = ?, path_identity = ?, availability = ?, updated_at = ?
            WHERE asset_id = ?`,
        );
        for (const asset of linkedAssets) {
          const managedPath = path.posix.join(targetPrefix, asset.relative_file_path);
          const copied = !asset.ignored && entries.some((entry) =>
            portablePathIdentity(entry.relativePath) === portablePathIdentity(asset.relative_file_path));
          updateAsset.run(
            managedFolderId, managedPath, portablePathIdentity(managedPath), copied ? 'available' : 'missing',
            convertedAt, asset.asset_id,
          );
          openLibrary.connection.prepare('DELETE FROM linked_ignored_assets WHERE asset_id = ?').run(asset.asset_id);
          this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
        }
        openLibrary.connection.prepare('DELETE FROM linked_folders WHERE folder_id = ?').run(input.folderId);
        openLibrary.connection.prepare(
          "UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?",
        ).run(convertedAt, operationId);
      })();
      this.stopLinkedWatcher(input.libraryId, input.folderId);
      try {
        this.removeOperation(operationPath);
      } catch (cleanupError) {
        // The database and destination bytes committed atomically. A committed
        // operation directory is safe to retain; normal reopen recovery removes it.
        this.diagnose('linked-folder.convert.committed-cleanup', cleanupError, {
          libraryId: input.libraryId, folderId: input.folderId, operationId,
        });
      }
      const assetIds = new Set(linkedAssets.map((asset) => asset.asset_id));
      const assets = this.listAssets({ libraryId: input.libraryId, folderId: managedFolderId, recursive: true })
        .filter((asset) => assetIds.has(asset.assetId));
      return { managedFolderId, convertedCount: entries.length, assets };
    } catch (error) {
      if (error instanceof SimulatedCrashError) {
        throw new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error });
      }
      try {
        for (const entry of [...entries].reverse()) {
          rmSync(this.folderPath(openLibrary, path.posix.join(targetPrefix, entry.relativePath)), { force: true });
        }
        for (const directory of [...directories].reverse()) {
          try { rmdirSync(this.folderPath(openLibrary, directory)); } catch { /* external writer or non-empty */ }
        }
        this.removeOperation(operationPath);
        openLibrary.connection.prepare(
          "UPDATE file_operations SET status = 'rolled_back', error_code = 'IMPORT_APPLY_FAILED', updated_at = ? WHERE operation_id = ?",
        ).run(new Date().toISOString(), operationId);
      } catch (rollbackError) {
        this.diagnose('linked-folder.convert.rollback', rollbackError, { libraryId: input.libraryId, folderId: input.folderId });
      }
      this.diagnose('linked-folder.convert', error, { libraryId: input.libraryId, folderId: input.folderId });
      throw serviceError(error, 'IMPORT_APPLY_FAILED');
    }
  }

  listAssets(input: {
    libraryId: string;
    folderId?: string;
    recursive: boolean;
  }): AssetSummary[] {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const managedFolder = input.folderId
      ? openLibrary.connection
          .prepare(
            'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
          )
          .get(input.folderId) as ManagedFolderRow | undefined
      : undefined;
    const linkedFolderId = input.folderId && !managedFolder
      ? (openLibrary.connection
          .prepare('SELECT folder_id FROM linked_folders WHERE folder_id = ?')
          .get(input.folderId) as { folder_id: string } | undefined)?.folder_id
      : undefined;
    if (input.folderId && !managedFolder && !linkedFolderId) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }
    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.managed_folder_id, a.linked_folder_id, a.location_kind, a.relative_file_path,
                a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
                a.deleted_at, a.trashed_from_relative_path,
                ra.status AS thumbnail_status,
                ra.artifact_id AS thumbnail_artifact_id,
                COALESCE(ra.width, video_meta.width) AS artifact_width,
                COALESCE(ra.height, video_meta.height) AS artifact_height,
                video_meta.duration_ms AS artifact_duration_ms
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
           LEFT JOIN revision_artifacts ra
             ON ra.revision_id = a.current_revision_id
            AND ra.kind = CASE
              WHEN LOWER(a.relative_file_path) LIKE '%.mp4'
                OR LOWER(a.relative_file_path) LIKE '%.webm'
                OR LOWER(a.relative_file_path) LIKE '%.mov'
                OR LOWER(a.relative_file_path) LIKE '%.avi'
                OR LOWER(a.relative_file_path) LIKE '%.wmv'
              THEN 'video_poster'
              ELSE 'thumbnail'
            END
            AND ra.invalidated_at IS NULL
           LEFT JOIN revision_artifacts video_meta
             ON video_meta.revision_id = a.current_revision_id
            AND video_meta.kind = 'extracted_metadata'
            AND video_meta.status = 'ready'
            AND video_meta.invalidated_at IS NULL
          WHERE NOT EXISTS (SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id)
          ORDER BY a.relative_file_path`,
      )
      .all() as Array<AssetSummaryRow & {
        deleted_at: string | null;
        trashed_from_relative_path: string | null;
        thumbnail_status: 'ready' | 'pending' | 'generating' | 'failed' | null;
        thumbnail_artifact_id: string | null;
        artifact_width: number | null;
        artifact_height: number | null;
        artifact_duration_ms: number | null;
      }>;

    return rows
      .filter((row) => {
        if (managedFolder) {
          if (!input.recursive) return row.managed_folder_id === managedFolder.folder_id;
          return (
            row.relative_file_path.startsWith(`${managedFolder.relative_path}/`) ||
            row.managed_folder_id === managedFolder.folder_id
          );
        }
        if (linkedFolderId) {
          // Linked-folder scope: all assets in the linked folder (relative
          // paths already encode subdirectory structure; recursive is implied).
          return row.linked_folder_id === linkedFolderId;
        }
        return input.recursive || row.managed_folder_id === null;
      })
      .map((row) => this.assetSummaryFromRow({
        ...row,
        thumbnail_status: row.thumbnail_status === 'ready' ? 'ready'
          : row.thumbnail_status === 'failed' ? 'failed'
          : row.thumbnail_status === 'pending' || row.thumbnail_status === 'generating' ? 'pending'
          : null,
        thumbnail_artifact_id: row.thumbnail_status === 'ready' ? row.thumbnail_artifact_id : null,
        media_type: (() => {
          return LibraryService.toSummaryMediaType(
            LibraryService.detectMediaType(row.relative_file_path),
          );
        })(),
      }));
  }

  importFolderAsLinked(input: {
    libraryId: string;
    sourceRootPath: string;
    displayName?: string;
  }): LinkedFolderSummary {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    let sourceRoot: string;
    try {
      sourceRoot = normalizeAbsolutePath(input.sourceRootPath);
    } catch (error) {
      throw serviceError(error, 'INVALID_IMPORT_SOURCE');
    }

    let rootStat: BigIntStats;
    try {
      rootStat = lstatSync(sourceRoot, { bigint: true });
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    if (rootStat.isSymbolicLink()) throw unsupportedSourceEntry('SYMBOLIC_LINK_NOT_ALLOWED');
    if (!rootStat.isDirectory()) throw unsupportedSourceEntry('UNSUPPORTED_FILE_ENTRY');

    const displayName = input.displayName ?? path.basename(sourceRoot);
    let normalizedName: string;
    try {
      normalizedName = normalizeFolderName(displayName);
    } catch (error) {
      throw serviceError(error, 'INVALID_FOLDER_NAME');
    }

    let canonicalRoot: string;
    try {
      canonicalRoot = realpathSync(sourceRoot);
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    // realpath is the linked-folder identity: it canonicalizes case-insensitive
    // equivalents on APFS/NTFS and resolves any trailing-slash variants, which
    // is sufficient to prevent linking the same physical root twice. portable
    // path identity (NFC + casefold per segment) is not used here because the
    // helper rejects absolute paths; the linked root is device-specific anyway.
    const pathIdentity = canonicalRoot;

    const existing = openLibrary.connection
      .prepare('SELECT folder_id FROM linked_folders WHERE path_identity = ?')
      .get(pathIdentity);
    if (existing) throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');

    const folderId = randomUUID();
    const defaultRules = DEFAULT_LINKED_FOLDER_RULES.map((rule) => ({ ...rule, ruleId: randomUUID() }));
    const entries = this.enumerateLinkedSources(canonicalRoot, folderId, defaultRules);
    const now = new Date().toISOString();
    const sourceDeviceHint = String(rootStat.dev);

    openLibrary.connection.transaction(() => {
      openLibrary.connection
        .prepare(
          `INSERT INTO linked_folders
             (folder_id, library_id, display_name, absolute_root_path, source_device_hint,
              status, path_identity, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'available', ?, ?, ?)`,
        )
        .run(
          folderId,
          openLibrary.summary.libraryId,
          normalizedName,
          canonicalRoot,
          sourceDeviceHint,
          pathIdentity,
          now,
          now,
        );
      const insertRule = openLibrary.connection.prepare(
        `INSERT INTO linked_folder_rules(rule_id, folder_id, position, action, target, pattern, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      defaultRules.forEach((rule, position) => insertRule.run(
        rule.ruleId, folderId, position, rule.action, rule.target, rule.pattern, 1,
      ));
      const insertAsset = openLibrary.connection.prepare(
        `INSERT INTO assets
           (asset_id, location_kind, managed_folder_id, linked_folder_id, relative_file_path,
            path_identity, current_revision_id, availability, created_at, updated_at)
         VALUES (?, 'linked', NULL, ?, ?, ?, NULL, 'available', ?, ?)`,
      );
      const insertRevision = openLibrary.connection.prepare(
        `INSERT INTO revisions
           (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
            original_filename, origin, accepted_at)
         VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
      );
      const setCurrentRevision = openLibrary.connection.prepare(
        'UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?',
      );
      for (const entry of entries) {
        const assetId = randomUUID();
        const revisionId = randomUUID();
        const assetPathIdentity = portablePathIdentity(entry.relativePath);
        insertAsset.run(assetId, folderId, entry.relativePath, assetPathIdentity, now, now);
        insertRevision.run(
          revisionId,
          assetId,
          entry.byteSize,
          entry.modifiedAt,
          entry.originalFilename,
          now,
        );
        setCurrentRevision.run(revisionId, now, assetId);
        this.syncAssetSearchContent(openLibrary.connection, assetId);
      }
    })();
    this.reconcileLinkedWatchers(openLibrary);

    return {
      folderId,
      displayName: normalizedName,
      status: 'available',
      assetCount: entries.length,
      absoluteRootPath: canonicalRoot,
    };
  }

  relinkMissingFolder(input: {
    libraryId: string;
    folderId: string;
    newRootPath: string;
  }): LinkedFolderSummary {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const folder = openLibrary.connection
      .prepare(
        'SELECT folder_id, display_name FROM linked_folders WHERE folder_id = ?',
      )
      .get(input.folderId) as { folder_id: string; display_name: string } | undefined;
    if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    let newRoot: string;
    try {
      newRoot = normalizeAbsolutePath(input.newRootPath);
    } catch (error) {
      throw serviceError(error, 'INVALID_IMPORT_SOURCE');
    }
    let rootStat: BigIntStats;
    try {
      rootStat = lstatSync(newRoot, { bigint: true });
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    if (rootStat.isSymbolicLink()) throw unsupportedSourceEntry('SYMBOLIC_LINK_NOT_ALLOWED');
    if (!rootStat.isDirectory()) throw unsupportedSourceEntry('UNSUPPORTED_FILE_ENTRY');

    let canonicalNewRoot: string;
    try {
      canonicalNewRoot = realpathSync(newRoot);
    } catch (error) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    const newPathIdentity = canonicalNewRoot;
    const conflict = openLibrary.connection
      .prepare(
        'SELECT folder_id FROM linked_folders WHERE path_identity = ? AND folder_id != ?',
      )
      .get(newPathIdentity, input.folderId);
    if (conflict) throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');

    const sourceDeviceHint = String(rootStat.dev);
    const now = new Date().toISOString();

    openLibrary.connection.transaction(() => {
      openLibrary.connection
        .prepare(
          `UPDATE linked_folders
              SET absolute_root_path = ?, source_device_hint = ?, status = 'available',
                  path_identity = ?, updated_at = ?
            WHERE folder_id = ?`,
        )
        .run(canonicalNewRoot, sourceDeviceHint, newPathIdentity, now, input.folderId);

      const assets = openLibrary.connection
        .prepare(
          'SELECT asset_id, relative_file_path, current_revision_id, availability FROM assets WHERE linked_folder_id = ?',
        )
        .all(input.folderId) as Array<{
          asset_id: string;
          relative_file_path: string;
          current_revision_id: string;
          availability: 'available' | 'missing';
        }>;
      for (const asset of assets) {
        const assetPath = path.join(canonicalNewRoot, ...asset.relative_file_path.split('/'));
        let fileStat;
        try {
          // Route through the same stat seam as refreshManagedAssets so tests
          // can inject non-missing-path faults (EACCES/EIO) deterministically.
          fileStat = this.options.assetLstat
            ? this.options.assetLstat(assetPath)
            : lstatSync(assetPath, { bigint: true });
        } catch (error) {
          if (!isMissingPathError(error)) {
            this.diagnose(
              'linked-folder.relink-skip-asset',
              new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error }),
              { folderId: input.folderId, relativePath: asset.relative_file_path },
            );
          }
          fileStat = undefined;
        }
        if (!fileStat?.isFile() || fileStat.isSymbolicLink()) {
          if (asset.availability === 'available') {
            openLibrary.connection
              .prepare("UPDATE assets SET availability = 'missing', updated_at = ? WHERE asset_id = ?")
              .run(now, asset.asset_id);
          }
          continue;
        }
        const revisionId = randomUUID();
        openLibrary.connection
          .prepare(
            `INSERT INTO revisions
               (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
                original_filename, origin, accepted_at)
             VALUES (?, ?, ?, ?, ?, ?, 'external_change', ?)`,
          )
          .run(
            revisionId,
            asset.asset_id,
            asset.current_revision_id,
            Number(fileStat.size),
            fileStat.mtime.toISOString(),
            path.posix.basename(asset.relative_file_path),
            now,
          );
        openLibrary.connection
          .prepare(
            "UPDATE assets SET current_revision_id = ?, availability = 'available', updated_at = ? WHERE asset_id = ?",
          )
          .run(revisionId, now, asset.asset_id);
      }
    })();
    this.reconcileLinkedWatchers(openLibrary);

    const countRow = openLibrary.connection
      .prepare('SELECT COUNT(*) AS count FROM assets WHERE linked_folder_id = ?')
      .get(input.folderId) as { count: number };
    return {
      folderId: input.folderId,
      displayName: folder.display_name,
      status: 'available',
      assetCount: countRow.count,
      absoluteRootPath: canonicalNewRoot,
    };
  }

  // ── Tags ──────────────────────────────────────────────────────────

  createTag(input: { libraryId: string; name: string }): TagSummary {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const trimmed = input.name.trim();
    if (trimmed.length === 0) throw new LibraryServiceError('INVALID_FOLDER_NAME');

    const tagId = randomUUID();
    const now = new Date().toISOString();
    try {
      openLibrary.connection
        .prepare(
          'INSERT INTO tags (tag_id, library_id, name, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(tagId, openLibrary.summary.libraryId, trimmed, now);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
      }
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }
    return { tagId, name: trimmed, assetCount: 0 };
  }

  listTags(libraryId: string): TagSummary[] {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const rows = openLibrary.connection
      .prepare(
        `SELECT t.tag_id, t.name,
                COUNT(used.asset_id) AS asset_count
           FROM tags t
           LEFT JOIN (
             SELECT asset_id, tag_id FROM human_asset_tags
             UNION
             SELECT asset_id, tag_id FROM ai_asset_tags
           ) used ON used.tag_id = t.tag_id
          WHERE t.library_id = ?
          GROUP BY t.tag_id, t.name, t.created_at
          ORDER BY t.created_at DESC, t.name`,
      )
      .all(openLibrary.summary.libraryId) as Array<{
        tag_id: string;
        name: string;
        asset_count: number;
      }>;
    return rows.map((row) => ({
      tagId: row.tag_id,
      name: row.name,
      assetCount: row.asset_count,
    }));
  }

  renameTag(input: { libraryId: string; tagId: string; name: string }): TagSummary {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const trimmed = input.name.trim();
    if (trimmed.length === 0) throw new LibraryServiceError('INVALID_FOLDER_NAME');

    const existing = openLibrary.connection
      .prepare('SELECT tag_id FROM tags WHERE tag_id = ? AND library_id = ?')
      .get(input.tagId, openLibrary.summary.libraryId);
    if (!existing) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    const affectedAssets = openLibrary.connection
      .prepare(
        `SELECT asset_id FROM human_asset_tags WHERE tag_id = ?
         UNION
         SELECT asset_id FROM ai_asset_tags WHERE tag_id = ?`,
      )
      .all(input.tagId, input.tagId) as Array<{ asset_id: string }>;

    try {
      openLibrary.connection.transaction(() => {
        openLibrary.connection
          .prepare('UPDATE tags SET name = ? WHERE tag_id = ?')
          .run(trimmed, input.tagId);
        for (const { asset_id: assetId } of affectedAssets) {
          this.syncAssetSearchContent(openLibrary.connection, assetId);
        }
      })();
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
      }
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }

    const countRow = openLibrary.connection
      .prepare(
        `SELECT COUNT(*) AS count
           FROM (
             SELECT asset_id FROM human_asset_tags WHERE tag_id = ?
             UNION
             SELECT asset_id FROM ai_asset_tags WHERE tag_id = ?
           )`,
      )
      .get(input.tagId, input.tagId) as { count: number };
    return { tagId: input.tagId, name: trimmed, assetCount: countRow.count };
  }

  deleteTag(input: { libraryId: string; tagId: string }): string {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const existing = openLibrary.connection
      .prepare('SELECT tag_id FROM tags WHERE tag_id = ? AND library_id = ?')
      .get(input.tagId, openLibrary.summary.libraryId);
    if (!existing) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    const affectedAssets = openLibrary.connection
      .prepare(
        `SELECT asset_id FROM human_asset_tags WHERE tag_id = ?
         UNION
         SELECT asset_id FROM ai_asset_tags WHERE tag_id = ?`,
      )
      .all(input.tagId, input.tagId) as Array<{ asset_id: string }>;

    openLibrary.connection.transaction(() => {
      openLibrary.connection
        .prepare('DELETE FROM tags WHERE tag_id = ?')
        .run(input.tagId);
      for (const { asset_id: assetId } of affectedAssets) {
        this.syncAssetSearchContent(openLibrary.connection, assetId);
      }
    })();
    return input.tagId;
  }

  deleteTags(input: {
    libraryId: string;
    tagIds: string[];
  }): { deletedTagIds: string[] } {
    const uniqueTagIds = [...new Set(input.tagIds)];
    if (uniqueTagIds.length === 0) return { deletedTagIds: [] };

    this.requireOpenLibrary(input.libraryId);
    const deletedTagIds: string[] = [];
    for (const tagId of uniqueTagIds) {
      deletedTagIds.push(this.deleteTag({ libraryId: input.libraryId, tagId }));
    }
    return { deletedTagIds };
  }

  /**
   * Merge multiple tags into a newly named tag (REQ-TAG-012b / Serpent-36il.4).
   * All human/AI links from source tags move to the new tag; sources are removed.
   */
  mergeTags(input: {
    libraryId: string;
    sourceTagIds: string[];
    name: string;
  }): TagSummary {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const trimmed = input.name.trim();
    if (trimmed.length === 0) throw new LibraryServiceError('INVALID_FOLDER_NAME');

    const sourceTagIds = [...new Set(input.sourceTagIds)];
    if (sourceTagIds.length < 2) {
      throw new LibraryServiceError('INVALID_FOLDER_NAME');
    }

    const placeholders = sourceTagIds.map(() => '?').join(',');
    const tagRows = openLibrary.connection
      .prepare(
        `SELECT tag_id FROM tags WHERE tag_id IN (${placeholders}) AND library_id = ?`,
      )
      .all(...sourceTagIds, openLibrary.summary.libraryId) as Array<{
      tag_id: string;
    }>;
    if (tagRows.length !== sourceTagIds.length) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }

    const newTagId = randomUUID();
    const now = new Date().toISOString();
    const affectedAssets = openLibrary.connection
      .prepare(
        `SELECT DISTINCT asset_id FROM (
           SELECT asset_id FROM human_asset_tags WHERE tag_id IN (${placeholders})
           UNION
           SELECT asset_id FROM ai_asset_tags WHERE tag_id IN (${placeholders})
         )`,
      )
      .all(...sourceTagIds, ...sourceTagIds) as Array<{ asset_id: string }>;

    try {
      openLibrary.connection.transaction(() => {
        openLibrary.connection
          .prepare(
            'INSERT INTO tags (tag_id, library_id, name, created_at) VALUES (?, ?, ?, ?)',
          )
          .run(newTagId, openLibrary.summary.libraryId, trimmed, now);

        const insertHuman = openLibrary.connection.prepare(
          'INSERT OR IGNORE INTO human_asset_tags (asset_id, tag_id) VALUES (?, ?)',
        );
        for (const { asset_id: assetId } of affectedAssets) {
          insertHuman.run(assetId, newTagId);
        }

        openLibrary.connection
          .prepare(
            `DELETE FROM human_asset_tags WHERE tag_id IN (${placeholders})`,
          )
          .run(...sourceTagIds);
        openLibrary.connection
          .prepare(`DELETE FROM ai_asset_tags WHERE tag_id IN (${placeholders})`)
          .run(...sourceTagIds);
        openLibrary.connection
          .prepare(`DELETE FROM tags WHERE tag_id IN (${placeholders})`)
          .run(...sourceTagIds);

        for (const { asset_id: assetId } of affectedAssets) {
          this.syncAssetSearchContent(openLibrary.connection, assetId);
        }
      })();
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
      }
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }

    const countRow = openLibrary.connection
      .prepare(
        `SELECT COUNT(*) AS count
           FROM (
             SELECT asset_id FROM human_asset_tags WHERE tag_id = ?
             UNION
             SELECT asset_id FROM ai_asset_tags WHERE tag_id = ?
           )`,
      )
      .get(newTagId, newTagId) as { count: number };
    return { tagId: newTagId, name: trimmed, assetCount: countRow.count };
  }

  /**
   * Tag co-occurrence graph for the management graph view (Serpent-k6g6.1).
   * Limits node/edge counts for large libraries; edges are undirected (a < b).
   */
  getTagCooccurrenceGraph(input: {
    libraryId: string;
    minWeight?: number;
    maxNodes?: number;
    maxEdges?: number;
  }): TagCooccurrenceGraph {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const minWeight = Math.max(1, input.minWeight ?? 1);
    const maxNodes = Math.min(Math.max(1, input.maxNodes ?? 200), 500);
    const maxEdges = Math.min(Math.max(1, input.maxEdges ?? 500), 2_000);

    const totalTags = openLibrary.connection
      .prepare('SELECT COUNT(*) AS count FROM tags WHERE library_id = ?')
      .get(openLibrary.summary.libraryId) as { count: number };

    const nodeRows = openLibrary.connection
      .prepare(
        `SELECT t.tag_id, t.name,
                COUNT(DISTINCT used.asset_id) AS asset_count
           FROM tags t
           LEFT JOIN (
             SELECT asset_id, tag_id FROM human_asset_tags
             UNION
             SELECT asset_id, tag_id FROM ai_asset_tags
           ) used ON used.tag_id = t.tag_id
          WHERE t.library_id = ?
          GROUP BY t.tag_id, t.name
          ORDER BY asset_count DESC, t.name COLLATE NOCASE
          LIMIT ?`,
      )
      .all(openLibrary.summary.libraryId, maxNodes) as Array<{
      tag_id: string;
      name: string;
      asset_count: number;
    }>;

    const nodes = nodeRows.map((row) => ({
      tagId: row.tag_id,
      name: row.name,
      assetCount: row.asset_count,
    }));

    if (nodes.length < 2) {
      return { nodes, edges: [], truncated: totalTags.count > nodes.length };
    }

    const nodeIds = nodes.map((node) => node.tagId);
    const placeholders = nodeIds.map(() => '?').join(',');
    const edgeRows = openLibrary.connection
      .prepare(
        `WITH tag_usage AS (
           SELECT DISTINCT asset_id, tag_id FROM human_asset_tags
           UNION
           SELECT DISTINCT asset_id, tag_id FROM ai_asset_tags
         )
         SELECT u1.tag_id AS tag_a, u2.tag_id AS tag_b,
                COUNT(DISTINCT u1.asset_id) AS weight
           FROM tag_usage u1
           JOIN tag_usage u2
             ON u1.asset_id = u2.asset_id
            AND u1.tag_id < u2.tag_id
          WHERE u1.tag_id IN (${placeholders})
            AND u2.tag_id IN (${placeholders})
          GROUP BY u1.tag_id, u2.tag_id
         HAVING weight >= ?
          ORDER BY weight DESC
          LIMIT ?`,
      )
      .all(...nodeIds, ...nodeIds, minWeight, maxEdges) as Array<{
      tag_a: string;
      tag_b: string;
      weight: number;
    }>;

    const edges = edgeRows.map((row) => ({
      sourceTagId: row.tag_a,
      targetTagId: row.tag_b,
      weight: row.weight,
    }));

    const connectedIds = new Set<string>();
    for (const edge of edges) {
      connectedIds.add(edge.sourceTagId);
      connectedIds.add(edge.targetTagId);
    }
    const visibleNodes =
      edges.length === 0
        ? nodes
        : nodes.filter((node) => connectedIds.has(node.tagId));

    return {
      nodes: visibleNodes,
      edges,
      truncated:
        totalTags.count > maxNodes || edgeRows.length >= maxEdges,
    };
  }

  assignTags(input: {
    libraryId: string;
    assetIds: string[];
    tagIds: string[];
  }): { assignedCount: number; skipped: TagOperationSkip[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    const { eligibleAssetIds, skipped } = this.partitionKnownAssetIds(
      openLibrary.connection,
      input.assetIds,
    );

    const tagRows = openLibrary.connection
      .prepare(
        `SELECT tag_id FROM tags WHERE tag_id IN (${input.tagIds.map(() => '?').join(',')}) AND library_id = ?`,
      )
      .all(...input.tagIds, openLibrary.summary.libraryId) as Array<{ tag_id: string }>;
    if (tagRows.length !== input.tagIds.length) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    let assignedCount = 0;
    const insertStmt = openLibrary.connection.prepare(
      'INSERT OR IGNORE INTO human_asset_tags (asset_id, tag_id) VALUES (?, ?)',
    );
    openLibrary.connection.transaction(() => {
      for (const assetId of eligibleAssetIds) {
        for (const tagId of input.tagIds) {
          const result = insertStmt.run(assetId, tagId);
          assignedCount += result.changes;
        }
      }
    })();
    for (const assetId of eligibleAssetIds) {
      this.syncAssetSearchContent(openLibrary.connection, assetId);
    }
    return { assignedCount, skipped };
  }

  removeTags(input: {
    libraryId: string;
    assetIds: string[];
    tagIds: string[];
  }): { removedCount: number; skipped: TagOperationSkip[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    const { eligibleAssetIds, skipped } = this.partitionKnownAssetIds(
      openLibrary.connection,
      input.assetIds,
    );
    if (eligibleAssetIds.length === 0) return { removedCount: 0, skipped };

    const humanResult = openLibrary.connection
      .prepare(
        `DELETE FROM human_asset_tags
           WHERE asset_id IN (${eligibleAssetIds.map(() => '?').join(',')})
             AND tag_id IN (${input.tagIds.map(() => '?').join(',')})`,
      )
      .run(...eligibleAssetIds, ...input.tagIds);
    // Serpent-h2i2: removing a chip must also clear AI-authored tag links.
    const aiResult = openLibrary.connection
      .prepare(
        `DELETE FROM ai_asset_tags
           WHERE asset_id IN (${eligibleAssetIds.map(() => '?').join(',')})
             AND tag_id IN (${input.tagIds.map(() => '?').join(',')})`,
      )
      .run(...eligibleAssetIds, ...input.tagIds);
    const removedCount = humanResult.changes + aiResult.changes;
    for (const assetId of eligibleAssetIds) {
      if (removedCount > 0) this.syncAssetSearchContent(openLibrary.connection, assetId);
    }
    return { removedCount, skipped };
  }

  /**
   * Splits the requested asset ids into the ones that exist in this library
   * and per-id skip entries for the rest, so batch tag operations can apply
   * to the eligible subset instead of failing wholesale (REQ-MENU-007).
   */
  private partitionKnownAssetIds(
    connection: DatabaseConnection,
    assetIds: string[],
  ): { eligibleAssetIds: string[]; skipped: TagOperationSkip[] } {
    const requestedAssetIds = [...new Set(assetIds)];
    const assetRows = connection
      .prepare(
        `SELECT asset_id FROM assets WHERE asset_id IN (${requestedAssetIds.map(() => '?').join(',')})`,
      )
      .all(...requestedAssetIds) as Array<{ asset_id: string }>;
    const knownAssetIds = new Set(assetRows.map((row) => row.asset_id));
    const eligibleAssetIds: string[] = [];
    const skipped: TagOperationSkip[] = [];
    for (const assetId of requestedAssetIds) {
      if (knownAssetIds.has(assetId)) {
        eligibleAssetIds.push(assetId);
      } else {
        skipped.push({ assetId, reason: 'asset_not_found' });
      }
    }
    return { eligibleAssetIds, skipped };
  }

  // ── Collections ────────────────────────────────────────────────────

  createCollection(input: {
    libraryId: string;
    parentId?: string;
    name: string;
  }): CollectionSummary {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const trimmed = input.name.trim();
    if (trimmed.length === 0) throw new LibraryServiceError('INVALID_FOLDER_NAME');

    if (input.parentId) {
      const parent = openLibrary.connection
        .prepare(
          'SELECT collection_id FROM collections WHERE collection_id = ? AND library_id = ?',
        )
        .get(input.parentId, openLibrary.summary.libraryId);
      if (!parent) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }

    const maxPosRow = openLibrary.connection
      .prepare(
        input.parentId
          ? 'SELECT COALESCE(MAX(position), -1) AS max_pos FROM collections WHERE parent_id = ? AND library_id = ?'
          : 'SELECT COALESCE(MAX(position), -1) AS max_pos FROM collections WHERE parent_id IS NULL AND library_id = ?',
      )
      .get(
        ...(input.parentId
          ? [input.parentId, openLibrary.summary.libraryId]
          : [openLibrary.summary.libraryId]),
      ) as { max_pos: number };
    const position = maxPosRow.max_pos + 1;

    const collectionId = randomUUID();
    const now = new Date().toISOString();

    openLibrary.connection
      .prepare(
        `INSERT INTO collections
           (collection_id, library_id, parent_id, name, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        collectionId,
        openLibrary.summary.libraryId,
        input.parentId ?? null,
        trimmed,
        position,
        now,
        now,
      );

    return {
      collectionId,
      parentId: input.parentId ?? null,
      name: trimmed,
      description: null,
      coverAssetId: null,
      position,
      assetCount: 0,
      childCollectionCount: 0,
    };
  }

  listCollections(libraryId: string): CollectionSummary[] {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const rows = openLibrary.connection
      .prepare(
        `SELECT c.collection_id, c.parent_id, c.name, c.description,
                c.cover_asset_id, c.position,
                (SELECT COUNT(*) FROM collection_assets ca WHERE ca.collection_id = c.collection_id) AS asset_count,
                (SELECT COUNT(*) FROM collections ch WHERE ch.parent_id = c.collection_id) AS child_count
           FROM collections c
          WHERE c.library_id = ?
          ORDER BY c.position, c.name`,
      )
      .all(openLibrary.summary.libraryId) as Array<{
        collection_id: string;
        parent_id: string | null;
        name: string;
        description: string | null;
        cover_asset_id: string | null;
        position: number;
        asset_count: number;
        child_count: number;
      }>;
    return rows.map((row) => ({
      collectionId: row.collection_id,
      parentId: row.parent_id,
      name: row.name,
      description: row.description,
      coverAssetId: row.cover_asset_id,
      position: row.position,
      assetCount: row.asset_count,
      childCollectionCount: row.child_count,
    }));
  }

  updateCollection(input: {
    libraryId: string;
    collectionId: string;
    name?: string;
    description?: string | null;
    coverAssetId?: string | null;
    position?: number;
  }): CollectionSummary {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const existing = openLibrary.connection
      .prepare(
        'SELECT collection_id, parent_id, name, description, cover_asset_id, position FROM collections WHERE collection_id = ? AND library_id = ?',
      )
      .get(input.collectionId, openLibrary.summary.libraryId) as {
        collection_id: string;
        parent_id: string | null;
        name: string;
        description: string | null;
        cover_asset_id: string | null;
        position: number;
      } | undefined;
    if (!existing) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    const now = new Date().toISOString();
    const newName =
      input.name !== undefined ? input.name.trim() : existing.name;
    if (newName.length === 0) throw new LibraryServiceError('INVALID_FOLDER_NAME');
    const newDescription =
      input.description !== undefined ? input.description : existing.description;
    const newCoverAssetId =
      input.coverAssetId !== undefined ? input.coverAssetId : existing.cover_asset_id;
    const newPosition =
      input.position !== undefined ? input.position : existing.position;

    openLibrary.connection
      .prepare(
        `UPDATE collections
            SET name = ?, description = ?, cover_asset_id = ?, position = ?, updated_at = ?
          WHERE collection_id = ?`,
      )
      .run(
        newName,
        newDescription,
        newCoverAssetId,
        newPosition,
        now,
        input.collectionId,
      );

    const countRows = openLibrary.connection
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM collection_assets WHERE collection_id = ?) AS asset_count,
           (SELECT COUNT(*) FROM collections WHERE parent_id = ?) AS child_count`,
      )
      .get(input.collectionId, input.collectionId) as {
        asset_count: number;
        child_count: number;
      };

    return {
      collectionId: input.collectionId,
      parentId: existing.parent_id,
      name: newName,
      description: newDescription,
      coverAssetId: newCoverAssetId,
      position: newPosition,
      assetCount: countRows.asset_count,
      childCollectionCount: countRows.child_count,
    };
  }

  reorderCollections(input: {
    libraryId: string;
    orderedCollectionIds: string[];
  }): string[] {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const uniqueIds = new Set(input.orderedCollectionIds);
    if (uniqueIds.size !== input.orderedCollectionIds.length) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }
    const placeholders = input.orderedCollectionIds.map(() => '?').join(',');
    const rows = openLibrary.connection.prepare(
      `SELECT collection_id, parent_id
         FROM collections
        WHERE library_id = ? AND collection_id IN (${placeholders})`,
    ).all(openLibrary.summary.libraryId, ...input.orderedCollectionIds) as Array<{
      collection_id: string;
      parent_id: string | null;
    }>;
    if (rows.length !== input.orderedCollectionIds.length) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }
    const parentId = rows[0]!.parent_id;
    if (rows.some((row) => row.parent_id !== parentId)) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }
    const siblingCount = openLibrary.connection.prepare(
      `SELECT COUNT(*) AS count
         FROM collections
        WHERE library_id = ? AND parent_id IS ?`,
    ).get(openLibrary.summary.libraryId, parentId) as { count: number };
    if (siblingCount.count !== input.orderedCollectionIds.length) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }

    const now = new Date().toISOString();
    const update = openLibrary.connection.prepare(
      'UPDATE collections SET position = ?, updated_at = ? WHERE collection_id = ? AND library_id = ?',
    );
    openLibrary.connection.transaction(() => {
      input.orderedCollectionIds.forEach((collectionId, position) => {
        const result = update.run(position, now, collectionId, openLibrary.summary.libraryId);
        if (result.changes !== 1) throw new LibraryServiceError('FOLDER_NOT_FOUND');
      });
    })();
    return [...input.orderedCollectionIds];
  }

  deleteCollection(input: { libraryId: string; collectionId: string }): string {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const existing = openLibrary.connection
      .prepare(
        'SELECT collection_id FROM collections WHERE collection_id = ? AND library_id = ?',
      )
      .get(input.collectionId, openLibrary.summary.libraryId);
    if (!existing) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    openLibrary.connection
      .prepare('DELETE FROM collections WHERE collection_id = ?')
      .run(input.collectionId);
    return input.collectionId;
  }

  addCollectionAssets(input: {
    libraryId: string;
    collectionId: string;
    assetIds: string[];
  }): { collectionId: string } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const col = openLibrary.connection
      .prepare(
        'SELECT collection_id FROM collections WHERE collection_id = ? AND library_id = ?',
      )
      .get(input.collectionId, openLibrary.summary.libraryId);
    if (!col) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    const assetRows = openLibrary.connection
      .prepare(
        `SELECT asset_id FROM assets WHERE asset_id IN (${input.assetIds.map(() => '?').join(',')})`,
      )
      .all(...input.assetIds) as Array<{ asset_id: string }>;
    if (assetRows.length !== input.assetIds.length) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    const maxPosRow = openLibrary.connection
      .prepare(
        'SELECT COALESCE(MAX(position), -1) AS max_pos FROM collection_assets WHERE collection_id = ?',
      )
      .get(input.collectionId) as { max_pos: number };
    let nextPosition = maxPosRow.max_pos + 1;

    const insertStmt = openLibrary.connection.prepare(
      'INSERT OR IGNORE INTO collection_assets (collection_id, asset_id, position) VALUES (?, ?, ?)',
    );
    openLibrary.connection.transaction(() => {
      for (const assetId of input.assetIds) {
        insertStmt.run(input.collectionId, assetId, nextPosition);
        nextPosition += 1;
      }
    })();
    return { collectionId: input.collectionId };
  }

  removeCollectionAssets(input: {
    libraryId: string;
    collectionId: string;
    assetIds: string[];
  }): { collectionId: string } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    openLibrary.connection
      .prepare(
        `DELETE FROM collection_assets
           WHERE collection_id = ?
             AND asset_id IN (${input.assetIds.map(() => '?').join(',')})`,
      )
      .run(input.collectionId, ...input.assetIds);
    return { collectionId: input.collectionId };
  }

  reorderCollectionAssets(input: {
    libraryId: string;
    collectionId: string;
    orderedAssetIds: string[];
  }): { collectionId: string } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const col = openLibrary.connection
      .prepare(
        'SELECT collection_id FROM collections WHERE collection_id = ? AND library_id = ?',
      )
      .get(input.collectionId, openLibrary.summary.libraryId);
    if (!col) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    openLibrary.connection.transaction(() => {
      openLibrary.connection
        .prepare('DELETE FROM collection_assets WHERE collection_id = ?')
        .run(input.collectionId);
      const insertStmt = openLibrary.connection.prepare(
        'INSERT INTO collection_assets (collection_id, asset_id, position) VALUES (?, ?, ?)',
      );
      for (let index = 0; index < input.orderedAssetIds.length; index += 1) {
        insertStmt.run(input.collectionId, input.orderedAssetIds[index]!, index);
      }
    })();
    return { collectionId: input.collectionId };
  }

  listCollectionAssets(input: {
    libraryId: string;
    collectionId: string;
    recursive: boolean;
  }): AssetSummary[] {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const col = openLibrary.connection
      .prepare(
        'SELECT collection_id FROM collections WHERE collection_id = ? AND library_id = ?',
      )
      .get(input.collectionId, openLibrary.summary.libraryId);
    if (!col) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    let collectionIds: string[];
    if (input.recursive) {
      const descendantRows = openLibrary.connection
        .prepare(
          `WITH RECURSIVE descendants AS (
             SELECT collection_id FROM collections WHERE collection_id = ?
             UNION ALL
             SELECT c.collection_id FROM collections c JOIN descendants d ON c.parent_id = d.collection_id
           )
           SELECT collection_id FROM descendants`,
        )
        .all(input.collectionId) as Array<{ collection_id: string }>;
      collectionIds = descendantRows.map((row) => row.collection_id);
    } else {
      collectionIds = [input.collectionId];
    }

    const placeholders = collectionIds.map(() => '?').join(',');
    const rows = openLibrary.connection
      .prepare(
        `SELECT DISTINCT a.asset_id, a.location_kind, a.managed_folder_id, a.relative_file_path,
                a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
                a.deleted_at, a.trashed_from_relative_path
           FROM collection_assets ca
           JOIN assets a ON a.asset_id = ca.asset_id
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
          WHERE ca.collection_id IN (${placeholders})
            AND a.deleted_at IS NULL
          ORDER BY ca.position, a.relative_file_path`,
      )
      .all(...collectionIds) as Array<{
        asset_id: string;
        location_kind: 'managed' | 'linked';
        availability: 'available' | 'missing';
        byte_size: number;
        current_revision_id: string;
        managed_folder_id: string | null;
        modified_at: string;
        relative_file_path: string;
        rating: number;
        favorite: number;
        deleted_at: string | null;
        trashed_from_relative_path: string | null;
      }>;
    return rows.map((row) => this.assetSummaryFromRow(row));
  }

  /**
   * Direct collection memberships for the given assets (CU-B4 menu filtering).
   * Scoped to collections that belong to the open library.
   */
  listAssetCollectionMemberships(input: {
    libraryId: string;
    assetIds: string[];
  }): Array<{ assetId: string; collectionId: string }> {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const uniqueIds = [...new Set(input.assetIds)];
    if (uniqueIds.length === 0) return [];

    const placeholders = uniqueIds.map(() => '?').join(',');
    const rows = openLibrary.connection
      .prepare(
        `SELECT ca.asset_id, ca.collection_id
           FROM collection_assets ca
           JOIN collections c ON c.collection_id = ca.collection_id
          WHERE ca.asset_id IN (${placeholders})
            AND c.library_id = ?`,
      )
      .all(...uniqueIds, openLibrary.summary.libraryId) as Array<{
        asset_id: string;
        collection_id: string;
      }>;

    return rows.map((row) => ({
      assetId: row.asset_id,
      collectionId: row.collection_id,
    }));
  }

  // ── Asset Metadata ──────────────────────────────────────────────────

  private resolvedPaletteFields(
    openLibrary: OpenLibrary,
    assetId: string,
  ): Pick<AssetMetadataResult, 'automaticPalette' | 'effectivePalette' | 'paletteSource'> {
    let automaticPalette: RepresentativeColor[] = [];
    const artifact = openLibrary.connection.prepare(
      `SELECT ra.artifact_id
         FROM assets a
         JOIN revision_artifacts ra ON ra.revision_id = a.current_revision_id
        WHERE a.asset_id = ?
          AND ra.kind = 'extracted_palette'
          AND ra.status = 'ready'
          AND ra.invalidated_at IS NULL
        LIMIT 1`,
    ).get(assetId) as { artifact_id: string } | undefined;
    if (artifact) {
      try {
        const parsed = JSON.parse(
          readFileSync(
            this.getArtifactAbsolutePath(openLibrary.summary.libraryId, artifact.artifact_id),
            'utf-8',
          ),
        ) as unknown;
        if (!Array.isArray(parsed)) throw new Error('Palette artifact must contain an array.');
        automaticPalette = parsed.map((entry) => {
          if (
            typeof entry !== 'object' || entry === null ||
            !('hex' in entry) || typeof entry.hex !== 'string' ||
            !/^#[0-9A-F]{6}$/u.test(entry.hex) ||
            !('ratio' in entry) || typeof entry.ratio !== 'number' ||
            !Number.isFinite(entry.ratio) || entry.ratio < 0 || entry.ratio > 1
          ) {
            throw new Error('Palette artifact contains an invalid colour entry.');
          }
          return { hex: entry.hex, ratio: entry.ratio };
        });
      } catch (error) {
        this.diagnose('palette.artifact-read', error, {
          assetId,
          artifactId: artifact.artifact_id,
        });
      }
    }

    // Serpent-7pg: stored manual palette is ignored; effective palette is automatic-only.
    if (automaticPalette.length > 0) {
      return {
        automaticPalette,
        effectivePalette: automaticPalette.map((color) => color.hex),
        paletteSource: 'automatic',
      };
    }
    return { automaticPalette: [], effectivePalette: [], paletteSource: null };
  }

  getAssetMetadata(input: { libraryId: string; assetId: string }): AssetMetadataResult {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    const assetRow = openLibrary.connection
      .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
      .get(input.assetId) as { asset_id: string } | undefined;
    if (!assetRow) throw new LibraryServiceError('ASSET_NOT_FOUND');

    const row = openLibrary.connection
      .prepare(
        `SELECT asset_id, description, rating, favorite, palette,
                source_page_url, author, entity_version, updated_at
           FROM asset_metadata
          WHERE asset_id = ?`,
      )
      .get(input.assetId) as {
        asset_id: string;
        description: string | null;
        rating: number;
        favorite: number;
        palette: string | null;
        source_page_url: string | null;
        author: string | null;
        entity_version: number;
        updated_at: string;
      } | undefined;

    if (!row) {
      return {
        assetId: input.assetId,
        description: null,
        rating: 0,
        favorite: false,
        palette: null,
        ...this.resolvedPaletteFields(openLibrary, input.assetId),
        sourcePageUrl: null,
        author: null,
        tags: this.fetchAssetTags(openLibrary.connection, input.assetId),
        entityVersion: 0,
        updatedAt: new Date(0).toISOString(),
      };
    }

    return {
      assetId: row.asset_id,
      description: row.description,
      rating: row.rating,
      favorite: row.favorite !== 0,
      palette: row.palette,
      ...this.resolvedPaletteFields(openLibrary, input.assetId),
      sourcePageUrl: row.source_page_url,
      author: row.author,
      entityVersion: row.entity_version,
      updatedAt: row.updated_at,
      tags: this.fetchAssetTags(openLibrary.connection, input.assetId),
    };
  }

  /**
   * Read the current `extracted_metadata` artifact JSON for an asset.
   * Pending / missing / failed return a safe status with null metadata
   * so Inspector can show an empty tech line without throwing (REQ-VIEW-003).
   */
  getExtractedMetadata(input: {
    libraryId: string;
    assetId: string;
  }): ExtractedMetadataResult {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    const assetRow = openLibrary.connection
      .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
      .get(input.assetId) as { asset_id: string } | undefined;
    if (!assetRow) throw new LibraryServiceError('ASSET_NOT_FOUND');

    const artifact = this.getCurrentArtifact(
      input.libraryId,
      input.assetId,
      'extracted_metadata',
    );
    if (!artifact) {
      return {
        assetId: input.assetId,
        status: 'missing',
        metadata: null,
        errorCode: null,
      };
    }

    const status =
      artifact.status === 'ready'
        ? 'ready'
        : artifact.status === 'failed'
          ? 'failed'
          : 'pending';

    if (status !== 'ready') {
      return {
        assetId: input.assetId,
        status,
        metadata: null,
        errorCode: artifact.errorCode,
      };
    }

    try {
      const absPath = this.getArtifactAbsolutePath(
        input.libraryId,
        artifact.artifactId,
      );
      const raw = JSON.parse(readFileSync(absPath, 'utf-8')) as unknown;
      const parsed = extractedVideoMetadataSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          assetId: input.assetId,
          status: 'failed',
          metadata: null,
          errorCode: 'EXTRACTED_METADATA_INVALID',
        };
      }
      return {
        assetId: input.assetId,
        status: 'ready',
        metadata: parsed.data as ExtractedVideoMetadata,
        errorCode: null,
      };
    } catch {
      return {
        assetId: input.assetId,
        status: 'failed',
        metadata: null,
        errorCode: 'EXTRACTED_METADATA_UNREADABLE',
      };
    }
  }

  /** Return tags assigned to an asset from both human and AI sources. */
  private fetchAssetTags(
    connection: DatabaseConnection,
    assetId: string,
  ): Array<{ id: string; name: string; source: 'user' | 'ai' }> {
    const rows = connection
      .prepare(
        `WITH assigned_tags AS (
           SELECT t.tag_id, t.name, 1 AS is_user
             FROM tags t
             JOIN human_asset_tags hat ON hat.tag_id = t.tag_id
            WHERE hat.asset_id = ?
           UNION ALL
           SELECT t.tag_id, t.name, 0 AS is_user
             FROM tags t
             JOIN ai_asset_tags aat ON aat.tag_id = t.tag_id
            WHERE aat.asset_id = ?
         )
         SELECT tag_id, name,
                CASE WHEN MAX(is_user) = 1 THEN 'user' ELSE 'ai' END AS source
           FROM assigned_tags
          GROUP BY tag_id, name
          ORDER BY name COLLATE NOCASE`,
      )
      .all(assetId, assetId) as Array<{
        tag_id: string;
        name: string;
        source: 'user' | 'ai';
      }>;
    return rows.map((r) => ({ id: r.tag_id, name: r.name, source: r.source }));
  }

  setAssetMetadata(input: {
    libraryId: string;
    assetId: string;
    expectedVersion: number;
    description?: string;
    rating?: number;
    favorite?: boolean;
    palette?: string[];
    sourcePageUrl?: string;
    author?: string;
  }): AssetMetadataResult {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    // Validate the asset exists.
    const assetRow = openLibrary.connection
      .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
      .get(input.assetId) as { asset_id: string } | undefined;
    if (!assetRow) throw new LibraryServiceError('ASSET_NOT_FOUND');

    // Renderer validation is not a trust boundary. Direct Worker clients must
    // obey the same metadata contract and receive a metadata-specific error.
    if (
      input.description !== undefined && input.description.length > 10_000 ||
      input.rating !== undefined &&
        (!Number.isInteger(input.rating) || input.rating < 0 || input.rating > 5)
    ) {
      throw new LibraryServiceError('INVALID_ASSET_METADATA');
    }

    // Serpent-7pg: ignore palette writes; column retained for older libraries.
    if (input.palette !== undefined) {
      // no-op: manual palette entry removed from product surface
    }

    // Source-page URLs are either the exact empty-string clear operation or a
    // credential-free HTTP(S) URL.
    if (
      input.sourcePageUrl !== undefined &&
      !sourcePageUrlSchema.safeParse(input.sourcePageUrl).success
    ) {
      throw new LibraryServiceError('INVALID_ASSET_METADATA');
    }

    // Author mirrors sourcePageUrl's clear-with-empty-string contract, without
    // the URL-shape constraint (Serpent-7x0).
    if (
      input.author !== undefined &&
      !assetAuthorSchema.safeParse(input.author).success
    ) {
      throw new LibraryServiceError('INVALID_ASSET_METADATA');
    }

    const now = new Date().toISOString();

    // Read current state.
    const existing = openLibrary.connection
      .prepare(
        'SELECT entity_version, rating, favorite, description, palette, source_page_url, author FROM asset_metadata WHERE asset_id = ?',
      )
      .get(input.assetId) as {
        entity_version: number;
        rating: number;
        favorite: number;
        description: string | null;
        palette: string | null;
        source_page_url: string | null;
        author: string | null;
      } | undefined;

    if (existing) {
      // Row exists: optimistic lock update.
      const newDescription =
        input.description !== undefined
          ? (input.description.trim() === '' ? null : input.description.trim())
          : existing.description;
      const newRating = input.rating ?? existing.rating;
      const newFavorite = input.favorite !== undefined ? (input.favorite ? 1 : 0) : existing.favorite;
      const newPalette = existing.palette;
      const newSourcePageUrl =
        input.sourcePageUrl !== undefined
          ? (input.sourcePageUrl.trim() === '' ? null : input.sourcePageUrl.trim())
          : existing.source_page_url;
      const newAuthor =
        input.author !== undefined
          ? (input.author.trim() === '' ? null : input.author.trim())
          : existing.author;

      const result = openLibrary.connection
        .prepare(
          `UPDATE asset_metadata
              SET description = ?, rating = ?, favorite = ?,
                  palette = ?, source_page_url = ?, author = ?,
                  entity_version = entity_version + 1, updated_at = ?
            WHERE asset_id = ? AND entity_version = ?`,
        )
        .run(
          newDescription,
          newRating,
          newFavorite,
          newPalette,
          newSourcePageUrl,
          newAuthor,
          now,
          input.assetId,
          input.expectedVersion,
        );

      if (result.changes === 0) {
        // Version mismatch: return conflict with current version.
        const current = openLibrary.connection
          .prepare('SELECT entity_version FROM asset_metadata WHERE asset_id = ?')
          .get(input.assetId) as { entity_version: number };
        throw new LibraryServiceError('VERSION_CONFLICT', {
          currentEntityVersion: current.entity_version,
        });
      }

      // Fetch back the updated row.
      const updated = openLibrary.connection
        .prepare(
          `SELECT asset_id, description, rating, favorite, palette,
                  source_page_url, author, entity_version, updated_at
             FROM asset_metadata WHERE asset_id = ?`,
        )
        .get(input.assetId) as {
          asset_id: string;
          description: string | null;
          rating: number;
          favorite: number;
          palette: string | null;
          source_page_url: string | null;
          author: string | null;
          entity_version: number;
          updated_at: string;
        };

      this.syncAssetSearchContent(openLibrary.connection, input.assetId);

      return {
        assetId: updated.asset_id,
        description: updated.description,
        rating: updated.rating,
        favorite: updated.favorite !== 0,
        palette: updated.palette,
        ...this.resolvedPaletteFields(openLibrary, input.assetId),
        sourcePageUrl: updated.source_page_url,
        author: updated.author,
        tags: this.fetchAssetTags(openLibrary.connection, input.assetId),
        entityVersion: updated.entity_version,
        updatedAt: updated.updated_at,
      };
    }

    // No existing row: INSERT. expectedVersion must be 0 for a fresh row.
    if (input.expectedVersion !== 0) {
      throw new LibraryServiceError('VERSION_CONFLICT', { currentEntityVersion: 0 });
    }

    const newDescription =
      input.description !== undefined
        ? (input.description.trim() === '' ? null : input.description.trim())
        : null;
    const newRating = input.rating ?? 0;
    const newFavorite = input.favorite !== undefined && input.favorite ? 1 : 0;
    const newPalette = null;
    const newSourcePageUrl =
      input.sourcePageUrl !== undefined
        ? (input.sourcePageUrl.trim() === '' ? null : input.sourcePageUrl.trim())
        : null;
    const newAuthor =
      input.author !== undefined
        ? (input.author.trim() === '' ? null : input.author.trim())
        : null;
    const newEntityVersion = 1;

    openLibrary.connection
      .prepare(
        `INSERT INTO asset_metadata
           (asset_id, description, rating, favorite, palette,
            source_page_url, author, entity_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.assetId,
        newDescription,
        newRating,
        newFavorite,
        newPalette,
        newSourcePageUrl,
        newAuthor,
        newEntityVersion,
        now,
      );
    this.syncAssetSearchContent(openLibrary.connection, input.assetId);

    return {
      assetId: input.assetId,
      description: newDescription,
      rating: newRating,
      favorite: newFavorite !== 0,
      palette: newPalette,
      ...this.resolvedPaletteFields(openLibrary, input.assetId),
      sourcePageUrl: newSourcePageUrl,
      author: newAuthor,
      tags: this.fetchAssetTags(openLibrary.connection, input.assetId),
      entityVersion: newEntityVersion,
      updatedAt: now,
    };
  }

  backfillAssetMetadata(libraryId: string): { backfilledCount: number } {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const now = new Date().toISOString();

    const result = openLibrary.connection
      .prepare(
        `INSERT OR IGNORE INTO asset_metadata
           (asset_id, description, rating, favorite, palette,
            source_page_url, author, entity_version, updated_at)
         SELECT asset_id, NULL, 0, 0, NULL, NULL, NULL, 1, ?
           FROM assets a
          WHERE NOT EXISTS (
            SELECT 1 FROM asset_metadata m WHERE m.asset_id = a.asset_id
          )`,
      )
      .run(now);

    return { backfilledCount: result.changes };
  }

  /**
   * Best-effort EXIF/IPTC/XMP author auto-extract (Serpent-7x0). Runs after
   * the first successful thumbnail decode for an image asset. Never
   * overwrites a non-empty author (user edits and prior extractions both
   * win), and — like {@link setAssetsRating} — does not touch entity_version
   * so it never invalidates a Renderer's in-flight optimistic-lock token.
   */
  private async backfillAuthorFromExif(
    openLibrary: OpenLibrary,
    assetId: string,
    absoluteFilePath: string,
  ): Promise<void> {
    let author: string | null;
    try {
      author = await extractAuthorFromExif(absoluteFilePath);
    } catch (error) {
      this.diagnose('metadata.author-exif-extract', error, { assetId });
      return;
    }
    if (!author) return;

    const now = new Date().toISOString();
    openLibrary.connection
      .prepare(
        `INSERT INTO asset_metadata
           (asset_id, description, rating, favorite, palette,
            source_page_url, author, entity_version, updated_at)
         VALUES (?, NULL, 0, 0, NULL, NULL, ?, 1, ?)
         ON CONFLICT(asset_id) DO UPDATE SET author = excluded.author
           WHERE asset_metadata.author IS NULL OR asset_metadata.author = ''`,
      )
      .run(assetId, author, now);
    this.syncAssetSearchContent(openLibrary.connection, assetId);
  }

  /**
   * Batch rating write (REQ-MENU-007). Rating is last-write-wins: unlike
   * setAssetMetadata there is no optimistic version check, and only the
   * rating column is written — description, favorite, palette, source URL,
   * entity_version, and updated_at of existing rows are left untouched so a
   * batch rating never invalidates a renderer's cached expectedVersion or
   * overwrites concurrent field edits. Assets without a metadata row yet get
   * one with schema defaults plus the requested rating. Unknown asset ids
   * are skipped per-item, mirroring the batch tag operations.
   */
  setAssetsRating(input: {
    libraryId: string;
    assetIds: string[];
    rating: number;
  }): { updatedCount: number; skipped: TagOperationSkip[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    // Renderer validation is not a trust boundary. Direct Worker clients must
    // obey the same rating contract and receive a metadata-specific error.
    if (!Number.isInteger(input.rating) || input.rating < 0 || input.rating > 5) {
      throw new LibraryServiceError('INVALID_ASSET_METADATA');
    }

    const { eligibleAssetIds, skipped } = this.partitionKnownAssetIds(
      openLibrary.connection,
      input.assetIds,
    );
    if (eligibleAssetIds.length === 0) return { updatedCount: 0, skipped };

    const now = new Date().toISOString();
    const upsertStmt = openLibrary.connection.prepare(
      `INSERT INTO asset_metadata
         (asset_id, description, rating, favorite, palette,
          source_page_url, author, entity_version, updated_at)
       VALUES (?, NULL, ?, 0, NULL, NULL, NULL, 1, ?)
       ON CONFLICT(asset_id) DO UPDATE SET rating = excluded.rating`,
    );
    openLibrary.connection.transaction(() => {
      for (const assetId of eligibleAssetIds) {
        upsertStmt.run(assetId, input.rating, now);
      }
    })();
    // Rating is not part of the FTS content (see syncAssetSearchContent), so
    // no search-index sync is required here.
    return { updatedCount: eligibleAssetIds.length, skipped };
  }

  // ── Smart Collections ────────────────────────────────────────────────

  // ── FTS5 Search Content Sync ───────────────────────────────────────

  private syncAssetSearchContent(
    connection: DatabaseConnection,
    assetId: string,
  ): void {
    const asset = connection
      .prepare(
        `SELECT a.relative_file_path, a.availability, r.byte_size,
                m.description, m.source_page_url, m.author
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
          WHERE a.asset_id = ?`,
      )
      .get(assetId) as {
        relative_file_path: string;
        availability: string;
        byte_size: number;
        description: string | null;
        source_page_url: string | null;
        author: string | null;
      } | undefined;
    if (!asset) return;

    const tagRow = connection
      .prepare(
        `SELECT GROUP_CONCAT(all_tags.tag_name, ' ') AS tags
           FROM (
             SELECT t.name AS tag_name
               FROM human_asset_tags hat
               JOIN tags t ON t.tag_id = hat.tag_id
              WHERE hat.asset_id = ?
              UNION
             SELECT t.name AS tag_name
               FROM ai_asset_tags aat
               JOIN tags t ON t.tag_id = aat.tag_id
              WHERE aat.asset_id = ?
           ) AS all_tags`,
      )
      .get(assetId, assetId) as { tags: string | null } | undefined;

    connection
      .prepare(
        `INSERT INTO asset_search_index
           (asset_id, filename, tags, description, source_url, author, folder_path, metadata_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET
           filename = excluded.filename,
           tags = excluded.tags,
           description = excluded.description,
           source_url = excluded.source_url,
           author = excluded.author,
           folder_path = excluded.folder_path,
           metadata_text = excluded.metadata_text`,
      )
      .run(
        assetId,
        tokenizeForFts(buildFileName(asset.relative_file_path)),
        tokenizeForFts(tagRow?.tags ?? ''),
        tokenizeForFts(asset.description ?? ''),
        tokenizeForFts(asset.source_page_url ?? ''),
        tokenizeForFts(asset.author ?? ''),
        tokenizeForFts(buildFolderPath(asset.relative_file_path)),
        tokenizeForFts(
          buildMetadataText({
            availability: asset.availability,
            byteSize: asset.byte_size,
            relativeFilePath: asset.relative_file_path,
          }),
        ),
      );
  }

  // ── AI Analysis ────────────────────────────────────────────────────

  /** Return the absolute filesystem path, MIME type, and whether this is a video asset. */
  resolveAssetFilePath(libraryId: string, assetId: string): {
    filePath: string;
    mime: string;
    isVideo: boolean;
  } {
    const openLibrary = this.requireOpenLibrary(libraryId);

    const asset = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.location_kind, a.linked_folder_id,
                a.managed_folder_id, a.relative_file_path
           FROM assets a
          WHERE a.asset_id = ?`,
      )
      .get(assetId) as {
        asset_id: string;
        location_kind: 'managed' | 'linked';
        linked_folder_id: string | null;
        managed_folder_id: string | null;
        relative_file_path: string;
      } | undefined;
    if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');

    let filePath: string;
    if (asset.location_kind === 'managed') {
      filePath = this.folderPath(openLibrary, asset.relative_file_path);
    } else {
      filePath = this.linkedAssetPath(
        openLibrary,
        asset.linked_folder_id,
        asset.relative_file_path,
      );
    }

    const ext = path.extname(asset.relative_file_path).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.exr': 'image/x-exr',
      '.tga': 'image/x-tga',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.wmv': 'video/x-ms-wmv',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.oga': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      '.opus': 'audio/ogg',
    };
    const mime = mimeMap[ext] ?? 'application/octet-stream';
    const isVideo = mime.startsWith('video/');

    return { filePath, mime, isVideo };
  }

  /** List all tag names in a library for AI tag-reuse hinting. */
  listTagNames(libraryId: string): string[] {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const rows = openLibrary.connection
      .prepare('SELECT name FROM tags WHERE library_id = ? ORDER BY name')
      .all(openLibrary.summary.libraryId) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  /**
   * F8: up to 100 tag names for the analysis prompt.
   * Prefer tags used on assets in `folderId` (that folder only, no children),
   * then tags by library-wide usage count.
   */
  listTagNamesForAiPrompt(
    libraryId: string,
    folderId: string | null | undefined,
    limit = 100,
  ): string[] {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const capped = Math.min(100, Math.max(1, limit));
    const conn = openLibrary.connection;
    const libId = openLibrary.summary.libraryId;

    const usageRows = conn
      .prepare(
        `SELECT t.name AS name, COUNT(*) AS usage_count
           FROM tags t
           LEFT JOIN human_asset_tags hat ON hat.tag_id = t.tag_id
           LEFT JOIN ai_asset_tags aat ON aat.tag_id = t.tag_id
          WHERE t.library_id = ?
          GROUP BY t.tag_id
          ORDER BY usage_count DESC, t.name COLLATE NOCASE ASC`,
      )
      .all(libId) as Array<{ name: string; usage_count: number }>;

    if (!folderId) {
      return usageRows.slice(0, capped).map((row) => row.name);
    }

    const folderRows = conn
      .prepare(
        `SELECT t.name AS name, COUNT(*) AS usage_count
           FROM tags t
           INNER JOIN (
             SELECT hat.tag_id AS tag_id FROM human_asset_tags hat
               INNER JOIN assets a ON a.asset_id = hat.asset_id
              WHERE a.managed_folder_id = ?
             UNION ALL
             SELECT aat.tag_id AS tag_id FROM ai_asset_tags aat
               INNER JOIN assets a ON a.asset_id = aat.asset_id
              WHERE a.managed_folder_id = ?
           ) uses ON uses.tag_id = t.tag_id
          WHERE t.library_id = ?
          GROUP BY t.tag_id
          ORDER BY usage_count DESC, t.name COLLATE NOCASE ASC`,
      )
      .all(folderId, folderId, libId) as Array<{ name: string }>;

    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const row of folderRows) {
      if (seen.has(row.name.toLowerCase())) continue;
      seen.add(row.name.toLowerCase());
      ordered.push(row.name);
      if (ordered.length >= capped) return ordered;
    }
    for (const row of usageRows) {
      if (seen.has(row.name.toLowerCase())) continue;
      seen.add(row.name.toLowerCase());
      ordered.push(row.name);
      if (ordered.length >= capped) break;
    }
    return ordered;
  }

  /** True when the asset has a non-empty human description. */
  hasHumanDescription(libraryId: string, assetId: string): boolean {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const row = openLibrary.connection
      .prepare(
        `SELECT description FROM asset_metadata WHERE asset_id = ?`,
      )
      .get(assetId) as { description: string | null } | undefined;
    return Boolean(row?.description?.trim());
  }

  /** Managed folder id for an asset, if any (for AI tag weighting). */
  getAssetManagedFolderId(
    libraryId: string,
    assetId: string,
  ): string | null {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const row = openLibrary.connection
      .prepare(
        `SELECT managed_folder_id FROM assets WHERE asset_id = ?`,
      )
      .get(assetId) as { managed_folder_id: string | null } | undefined;
    return row?.managed_folder_id ?? null;
  }

  /**
   * Atomically write AI-generated content for an asset.
   * For tags: find-or-create by NOCASE name, then INSERT OR IGNORE into ai_asset_tags.
   * For description/rating: DELETE old row(s) + INSERT new row in ai_content
   *   (one row per (asset_id, field_name)). Never writes human asset_metadata.rating.
   * After writing, sync the asset's FTS search content.
   */
  writeAiAnalysisResult(input: {
    libraryId: string;
    assetId: string;
    description?: string;
    tags?: string[];
    /** Aesthetic score 1–5 as string or number; AI layer only. */
    rating?: number | string | null;
    modelId: string;
    modelVersion: string;
    guardJobId?: string;
    enabledFields: {
      description: boolean;
      tags: boolean;
      rating: boolean;
    };
  }): { tagsWritten: string[]; fieldsWritten: string[]; committed: boolean } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const now = new Date().toISOString();
    const tagsWritten: string[] = [];
    const fieldsWritten: string[] = [];

    const revisionRow = openLibrary.connection
      .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
      .get(input.assetId) as { current_revision_id: string | null } | undefined;
    const revisionId = revisionRow?.current_revision_id ?? null;

    const committed = openLibrary.connection.transaction(() => {
      if (input.guardJobId) {
        const job = openLibrary.connection.prepare(
          "SELECT status FROM jobs WHERE library_id = ? AND job_id = ? AND status = 'running'",
        ).get(openLibrary.summary.libraryId, input.guardJobId);
        if (!job) return false;
      }
      // A successful analysis replaces the complete enabled AI layer. Clear
      // old tags even when the provider returns an empty list so stale model
      // output cannot survive a re-analysis.
      if (input.enabledFields.tags) {
        openLibrary.connection
          .prepare('DELETE FROM ai_asset_tags WHERE asset_id = ?')
          .run(input.assetId);
      }
      if (input.enabledFields.tags && input.tags && input.tags.length > 0) {
        const findTag = openLibrary.connection.prepare(
          'SELECT tag_id, name FROM tags WHERE library_id = ? AND name = ? COLLATE NOCASE',
        );
        const insertTag = openLibrary.connection.prepare(
          'INSERT OR IGNORE INTO tags (tag_id, library_id, name, created_at) VALUES (?, ?, ?, ?)',
        );
        const insertAiTag = openLibrary.connection.prepare(
          `INSERT OR IGNORE INTO ai_asset_tags
             (asset_id, tag_id, revision_id, model_id, model_version)
           VALUES (?, ?, ?, ?, ?)`,
        );

        for (const tagName of input.tags) {
          const trimmed = tagName.trim();
          if (trimmed.length === 0) continue;

          let tag = findTag.get(openLibrary.summary.libraryId, trimmed) as
            | { tag_id: string; name: string }
            | undefined;
          if (!tag) {
            const tagId = randomUUID();
            insertTag.run(tagId, openLibrary.summary.libraryId, trimmed, now);
            tag = { tag_id: tagId, name: trimmed };
          }

          insertAiTag.run(
            input.assetId,
            tag.tag_id,
            revisionId,
            input.modelId,
            input.modelVersion,
          );
          tagsWritten.push(trimmed);
        }
      }

      // Description / rating: DELETE old row(s) + INSERT when enabled.
      const deleteOld = openLibrary.connection.prepare(
        'DELETE FROM ai_content WHERE asset_id = ? AND field_name = ?',
      );
      const insertContent = openLibrary.connection.prepare(
        `INSERT INTO ai_content
           (ai_content_id, asset_id, revision_id, field_name, value,
            model_id, model_version, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      const writeField = (fieldName: string, value: string): void => {
        insertContent.run(
          randomUUID(),
          input.assetId,
          revisionId,
          fieldName,
          value,
          input.modelId,
          input.modelVersion,
          now,
        );
        fieldsWritten.push(fieldName);
      };

      if (input.enabledFields.description) {
        deleteOld.run(input.assetId, 'description');
      }
      if (input.enabledFields.rating) {
        deleteOld.run(input.assetId, 'rating');
      }

      if (
        input.enabledFields.description &&
        input.description !== undefined
      ) {
        const cleaned = sanitizeAiDescription(input.description);
        if (cleaned.length > 0) {
          writeField('description', cleaned);
        }
      }

      if (input.enabledFields.rating && input.rating != null) {
        const score =
          typeof input.rating === 'number'
            ? input.rating
            : Number.parseInt(String(input.rating).trim(), 10);
        if (Number.isInteger(score) && score >= 1 && score <= 5) {
          writeField('rating', String(score));
        }
      }
      return true;
    })();

    if (committed) this.syncAssetSearchContent(openLibrary.connection, input.assetId);

    return { tagsWritten, fieldsWritten, committed };
  }

  /** Retrieve current AI content rows for an asset. */
  getAiContent(libraryId: string, assetId: string): Array<{
    fieldName: string;
    value: string;
    modelId: string;
    modelVersion: string;
    generatedAt: string;
  }> {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const rows = openLibrary.connection
      .prepare(
        `SELECT field_name, value, model_id, model_version, generated_at
           FROM ai_content
          WHERE asset_id = ?
          ORDER BY field_name`,
      )
      .all(assetId) as Array<{
        field_name: string;
        value: string;
        model_id: string;
        model_version: string;
        generated_at: string;
      }>;
    return rows.map((r) => ({
      fieldName: r.field_name,
      value: r.value,
      modelId: r.model_id,
      modelVersion: r.model_version,
      generatedAt: r.generated_at,
    }));
  }

  /** AI-layer tag names for an asset (ordered by name). */
  listAiTagNames(libraryId: string, assetId: string): string[] {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const rows = openLibrary.connection
      .prepare(
        `SELECT t.name AS name
           FROM ai_asset_tags aat
           JOIN tags t ON t.tag_id = aat.tag_id
          WHERE aat.asset_id = ?
          ORDER BY t.name COLLATE NOCASE ASC`,
      )
      .all(assetId) as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  /** Latest model_version stamped on AI tags for this asset, if any. */
  getAiTagModelVersion(
    libraryId: string,
    assetId: string,
  ): string | null {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const row = openLibrary.connection
      .prepare(
        `SELECT model_version
           FROM ai_asset_tags
          WHERE asset_id = ?
          ORDER BY rowid DESC
          LIMIT 1`,
      )
      .get(assetId) as { model_version: string } | undefined;
    return row?.model_version ?? null;
  }

  /**
   * Clear AI content for a scope of assets. Only deletes rows from
   * `ai_content` and `ai_asset_tags`; never touches human content,
   * human_asset_tags, or Tag entities. After clearing, re-syncs FTS.
   */
  clearAiContent(input: {
    libraryId: string;
    scope: {
      kind: 'asset' | 'selection' | 'folder' | 'library';
      assetIds?: string[];
      folderId?: string;
    };
    confirm: boolean;
    /** Omit to clear every AI layer; otherwise only the listed layers. */
    fields?: Array<'description' | 'rating' | 'tags'>;
  }): { clearedCount: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    // Batch operations require confirmation.
    if (
      (input.scope.kind === 'library' || input.scope.kind === 'folder') &&
      !input.confirm
    ) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION', {
        reason: 'PERMISSION_DENIED',
      });
    }

    const conn = openLibrary.connection;

    // Gather target asset IDs based on scope.
    let targetAssetIds: string[];
    switch (input.scope.kind) {
      case 'asset':
      case 'selection':
        targetAssetIds = input.scope.assetIds ?? [];
        break;
      case 'folder': {
        if (!input.scope.folderId) {
          throw new LibraryServiceError('INVALID_IMPORT_DECISION', {
            reason: 'SOURCE_NOT_FOUND',
          });
        }
        // Recursive: get all assets under this folder (assets.managed_folder_id).
        const folderRows = conn
          .prepare(
            `WITH RECURSIVE subfolders AS (
               SELECT folder_id FROM managed_folders WHERE folder_id = ?
               UNION ALL
               SELECT mf.folder_id
                 FROM managed_folders mf
                 JOIN subfolders sf ON mf.parent_folder_id = sf.folder_id
             )
             SELECT a.asset_id
               FROM assets a
              WHERE a.managed_folder_id IN (SELECT folder_id FROM subfolders)`,
          )
          .all(input.scope.folderId) as Array<{ asset_id: string }>;
        targetAssetIds = folderRows.map((r) => r.asset_id);
        break;
      }
      case 'library': {
        const allRows = conn
          .prepare('SELECT asset_id FROM assets')
          .all() as Array<{ asset_id: string }>;
        targetAssetIds = allRows.map((r) => r.asset_id);
        break;
      }
      default:
        throw new LibraryServiceError('INTERNAL_ERROR');
    }

    if (targetAssetIds.length === 0) {
      return { clearedCount: 0 };
    }

    const clearAll = !input.fields || input.fields.length === 0;
    const clearDescription = clearAll || input.fields!.includes('description');
    const clearRating = clearAll || input.fields!.includes('rating');
    const clearTags = clearAll || input.fields!.includes('tags');

    const deleteAiField = conn.prepare(
      'DELETE FROM ai_content WHERE asset_id = ? AND field_name = ?',
    );
    const deleteAllAiContent = conn.prepare(
      'DELETE FROM ai_content WHERE asset_id = ?',
    );
    const deleteAiTags = conn.prepare(
      'DELETE FROM ai_asset_tags WHERE asset_id = ?',
    );

    conn.transaction(() => {
      for (const assetId of targetAssetIds) {
        if (clearAll) {
          deleteAllAiContent.run(assetId);
        } else {
          if (clearDescription) deleteAiField.run(assetId, 'description');
          if (clearRating) deleteAiField.run(assetId, 'rating');
        }
        if (clearTags) deleteAiTags.run(assetId);
        this.syncAssetSearchContent(conn, assetId);
      }
    })();

    return { clearedCount: targetAssetIds.length };
  }

  /** Enqueue image jobs and video jobs whose poster/contact sheet are ready. */
  enqueueAiAnalysisJobs(input: {
    libraryId: string;
    assetIds?: string[];
    folderId?: string;
  }): { enqueued: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const conn = openLibrary.connection;
    const now = new Date().toISOString();
    const libId = openLibrary.summary.libraryId;

    // Determine target asset IDs.
    let targetAssetIds: string[];
    if (input.assetIds && input.assetIds.length > 0) {
      targetAssetIds = input.assetIds;
    } else if (input.folderId) {
      const folderRows = conn
        .prepare(
          `WITH RECURSIVE subfolders AS (
             SELECT folder_id FROM managed_folders WHERE folder_id = ?
             UNION ALL
             SELECT mf.folder_id
               FROM managed_folders mf
               JOIN subfolders sf ON mf.parent_folder_id = sf.folder_id
           )
           SELECT a.asset_id
             FROM assets a
            WHERE a.managed_folder_id IN (SELECT folder_id FROM subfolders)
               OR a.linked_folder_id = ?`,
        )
        .all(input.folderId, input.folderId) as Array<{ asset_id: string }>;
      targetAssetIds = folderRows.map((r) => r.asset_id);
    } else {
      // All library assets (single-library database, so no library_id filter needed).
      const allRows = conn
        .prepare('SELECT asset_id FROM assets')
        .all() as Array<{ asset_id: string }>;
      targetAssetIds = allRows.map((r) => r.asset_id);
    }

    const insertJob = conn.prepare(
      `INSERT INTO jobs
         (job_id, library_id, asset_id, revision_id, kind, status,
          priority, progress, attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', 0, 0.0, 0, ?, ?)`,
    );
    const getRevision = conn.prepare(
      'SELECT current_revision_id FROM assets WHERE asset_id = ?',
    );

    // Image extensions for filtering.
    const imageExts = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.tiff', '.tif',
      '.webp', '.bmp', '.svg', '.exr', '.tga',
    ]);
    const videoExts = new Set([
      '.mp4', '.mov', '.avi', '.wmv', '.webm', '.mkv', '.m4v',
    ]);
    const videoArtifactsReady = conn.prepare(
      `SELECT COUNT(DISTINCT ra.kind) AS ready_count
         FROM assets a
         JOIN revision_artifacts ra ON ra.revision_id = a.current_revision_id
        WHERE a.asset_id = ?
          AND ra.kind IN ('contact_sheet', 'video_poster')
          AND ra.status = 'ready'
          AND ra.invalidated_at IS NULL`,
    );

    let enqueued = 0;
    conn.transaction(() => {
      for (const assetId of targetAssetIds) {
        const row = conn
          .prepare(
            `SELECT relative_file_path, location_kind FROM assets
             WHERE asset_id = ?`,
          )
          .get(assetId) as {
            relative_file_path: string;
            location_kind: string;
          } | undefined;
        if (!row) continue;

        const ext = path.extname(row.relative_file_path).toLowerCase();
        const isImage = imageExts.has(ext);
        const isVideo = videoExts.has(ext);
        if (!isImage && !isVideo) continue;
        if (isVideo) {
          const artifacts = videoArtifactsReady.get(assetId) as { ready_count: number };
          if (artifacts.ready_count !== 2) continue;
        }

        // Check if there's already a pending/running AI job for this asset.
        const existingJob = conn
          .prepare(
            "SELECT job_id FROM jobs WHERE asset_id = ? AND kind IN ('ai.image.analysis', 'ai.video.analysis') AND status IN ('queued', 'running', 'paused') LIMIT 1",
          )
          .get(assetId) as { job_id: string } | undefined;
        if (existingJob) continue;

        const jobId = randomUUID();
        const revisionRow = getRevision.get(assetId) as
          | { current_revision_id: string | null }
          | undefined;
        const revisionId = revisionRow?.current_revision_id ?? null;

        insertJob.run(
          jobId,
          libId,
          assetId,
          revisionId,
          isVideo ? 'ai.video.analysis' : 'ai.image.analysis',
          now,
          now,
        );
        enqueued++;
      }
    })();

    return { enqueued };
  }

  claimNextAiJob(libraryId: string, excludedJobIds: string[] = []): {
    jobId: string;
    assetId: string;
    kind: 'ai.image.analysis' | 'ai.video.analysis';
    attemptCount: number;
  } | null {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const conn = openLibrary.connection;
    const libId = openLibrary.summary.libraryId;
    return conn.transaction(() => {
      const exclusionSql = excludedJobIds.length > 0
        ? ` AND job_id NOT IN (${excludedJobIds.map(() => '?').join(',')})`
        : '';
      const row = conn.prepare(
        `SELECT job_id, asset_id, kind, attempt_count FROM jobs
          WHERE library_id = ? AND kind IN ('ai.image.analysis', 'ai.video.analysis')
            AND status = 'queued'${exclusionSql}
          ORDER BY priority DESC, created_at ASC, job_id ASC LIMIT 1`,
      ).get(libId, ...excludedJobIds) as { job_id: string; asset_id: string; kind: 'ai.image.analysis' | 'ai.video.analysis'; attempt_count: number } | undefined;
      if (!row) return null;
      const attemptCount = row.attempt_count + 1;
      const result = conn.prepare(
        `UPDATE jobs SET status = 'running', attempt_count = ?, progress = 0.0,
          error_code = NULL, error_detail = NULL, updated_at = ?
          WHERE job_id = ? AND library_id = ? AND status = 'queued'`,
      ).run(attemptCount, new Date().toISOString(), row.job_id, libId);
      if (result.changes !== 1) return null;
      return { jobId: row.job_id, assetId: row.asset_id, kind: row.kind, attemptCount };
    })();
  }

  completeAiJob(libraryId: string, jobId: string): void {
    const openLibrary = this.requireOpenLibrary(libraryId);
    openLibrary.connection.prepare(
      `UPDATE jobs SET status = 'succeeded', progress = 1.0, error_code = NULL,
        error_detail = NULL, updated_at = ?
        WHERE library_id = ? AND job_id = ? AND status = 'running'
          AND kind IN ('ai.image.analysis', 'ai.video.analysis')`,
    ).run(new Date().toISOString(), openLibrary.summary.libraryId, jobId);
  }

  getAiJobState(libraryId: string, jobId: string): string | null {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const row = openLibrary.connection.prepare(
      `SELECT status FROM jobs WHERE library_id = ? AND job_id = ?
        AND kind IN ('ai.image.analysis', 'ai.video.analysis')`,
    ).get(openLibrary.summary.libraryId, jobId) as { status: string } | undefined;
    return row?.status ?? null;
  }

  failAiJob(
    libraryId: string,
    jobId: string,
    failure: {
      errorCode: string;
      retryable: boolean;
      maxAttempts?: number;
      /** Redacted user/developer-facing detail (Serpent-iokf). */
      errorDetail?: string | null;
    },
  ): { status: 'queued' | 'failed' } {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const conn = openLibrary.connection;
    const libId = openLibrary.summary.libraryId;
    const row = conn.prepare(
      `SELECT attempt_count FROM jobs WHERE library_id = ? AND job_id = ?
        AND status = 'running' AND kind IN ('ai.image.analysis', 'ai.video.analysis')`,
    ).get(libId, jobId) as { attempt_count: number } | undefined;
    if (!row) return { status: 'failed' };
    const status = failure.retryable && row.attempt_count < (failure.maxAttempts ?? 3) ? 'queued' : 'failed';
    const detail =
      typeof failure.errorDetail === 'string' && failure.errorDetail.trim()
        ? failure.errorDetail.trim().slice(0, 500)
        : null;
    conn.prepare(
      `UPDATE jobs SET status = ?, progress = 0.0, error_code = ?, error_detail = ?,
        updated_at = ? WHERE library_id = ? AND job_id = ? AND status = 'running'`,
    ).run(status, failure.errorCode, detail, new Date().toISOString(), libId, jobId);
    return { status };
  }

  private recoverInterruptedAiJobs(openLibrary: OpenLibrary): void {
    openLibrary.connection.prepare(
      `UPDATE jobs SET status = 'queued', progress = 0.0,
        error_code = 'PROCESS_INTERRUPTED', error_detail = NULL, updated_at = ?
        WHERE library_id = ? AND status = 'running'
          AND kind IN ('ai.image.analysis', 'ai.video.analysis')`,
    ).run(new Date().toISOString(), openLibrary.summary.libraryId);
  }

  private recoverInterruptedThumbnailJobs(openLibrary: OpenLibrary): void {
    openLibrary.connection.prepare(
      `UPDATE jobs SET status = 'queued', progress = 0.0,
        error_code = 'PROCESS_INTERRUPTED', error_detail = NULL, updated_at = ?
        WHERE library_id = ? AND status = 'running'
          AND kind IN ('generate_thumbnail', 'generate_video_poster',
                       'generate_contact_sheet', 'generate_webm_proxy',
                       'extract_palette')`,
    ).run(new Date().toISOString(), openLibrary.summary.libraryId);
  }

  // ── AI Job Queue Management ──────────────────────────────────────

  /**
   * Pause AI analysis jobs. If no jobIds provided, pauses all
   * queued/running AI jobs for the library.
   */
  pauseJobs(
    libraryId: string,
    jobIds?: string[],
  ): { pausedCount: number } {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const result = this.#updateJobStatus(
      openLibrary.connection,
      openLibrary.summary.libraryId,
      ['queued', 'running'],
      'paused',
      jobIds,
    );
    return { pausedCount: result.count };
  }

  /**
   * Resume paused AI jobs.
   */
  resumeJobs(
    libraryId: string,
    jobIds?: string[],
  ): { resumedCount: number } {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const result = this.#updateJobStatus(
      openLibrary.connection,
      openLibrary.summary.libraryId,
      ['paused'],
      'queued',
      jobIds,
    );
    return { resumedCount: result.count };
  }

  /**
   * Cancel AI analysis jobs. If no jobIds provided, cancels all
   * queued/paused/running AI jobs for the library.
   */
  cancelJobs(
    libraryId: string,
    jobIds?: string[],
  ): { cancelledCount: number } {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const result = this.#updateJobStatus(
      openLibrary.connection,
      openLibrary.summary.libraryId,
      ['queued', 'paused', 'running'],
      'cancelled',
      jobIds,
    );
    return { cancelledCount: result.count };
  }

  /**
   * Retry failed AI analysis jobs. Resets attempt_count and re-enqueues.
   */
  retryJobs(
    libraryId: string,
    jobIds: string[],
  ): { retriedCount: number } {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const libId = openLibrary.summary.libraryId;

    const result = openLibrary.connection
      .prepare(
        `UPDATE jobs
           SET status = 'queued',
               attempt_count = 0,
               error_code = NULL,
               error_detail = NULL,
               updated_at = ?
         WHERE library_id = ?
           AND kind IN ('ai.image.analysis', 'ai.video.analysis')
           AND status = 'failed'
           AND job_id IN (${jobIds.map(() => '?').join(',')})`,
      )
      .run(new Date().toISOString(), libId, ...jobIds);

    return { retriedCount: result.changes as number };
  }

  /** List all AI jobs for a library with counts by status. */
  getAiJobStatus(libraryId: string): {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    paused: number;
    cancelled: number;
    jobs: Array<{
      jobId: string;
      assetId: string;
      kind: 'ai.image.analysis' | 'ai.video.analysis';
      status: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
      errorCode: string | null;
      errorDetail: string | null;
      updatedAt: string;
    }>;
  } {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const conn = openLibrary.connection;
    const libId = openLibrary.summary.libraryId;

    const counts = conn
      .prepare(
        `SELECT status, COUNT(*) as cnt
           FROM jobs
          WHERE library_id = ?
            AND kind IN ('ai.image.analysis', 'ai.video.analysis')
          GROUP BY status`,
      )
      .all(libId) as Array<{ status: string; cnt: number }>;

    const jobs = conn
      .prepare(
        `SELECT job_id, asset_id, kind, status, error_code, error_detail, updated_at
           FROM jobs
          WHERE library_id = ?
            AND kind IN ('ai.image.analysis', 'ai.video.analysis')
          ORDER BY created_at DESC
          LIMIT 200`,
      )
      .all(libId) as Array<{
        job_id: string;
        asset_id: string;
        kind: 'ai.image.analysis' | 'ai.video.analysis';
        status: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
        error_code: string | null;
        error_detail: string | null;
        updated_at: string;
      }>;

    const statusMap: Record<string, number> = {};
    for (const c of counts) statusMap[c.status] = c.cnt;

    return {
      queued: statusMap['queued'] ?? 0,
      running: statusMap['running'] ?? 0,
      succeeded: statusMap['succeeded'] ?? 0,
      failed: statusMap['failed'] ?? 0,
      paused: statusMap['paused'] ?? 0,
      cancelled: statusMap['cancelled'] ?? 0,
      jobs: jobs.map((j) => ({
        jobId: j.job_id,
        assetId: j.asset_id,
        kind: j.kind,
        status: j.status,
        errorCode: j.error_code,
        errorDetail: j.error_detail,
        updatedAt: j.updated_at,
      })),
    };
  }

  #updateJobStatus(
    conn: { prepare(sql: string): { run(...params: unknown[]): { changes: number }; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] } },
    libId: string,
    fromStatuses: string[],
    toStatus: string,
    jobIds?: string[],
  ): { count: number } {
    const statusPlaceholders = fromStatuses.map(() => '?').join(',');
    const aiKinds = ['ai.image.analysis', 'ai.video.analysis'];
    const now = new Date().toISOString();

    let query: string;
    let params: unknown[];

    if (jobIds && jobIds.length > 0) {
      const jobPlaceholders = jobIds.map(() => '?').join(',');
      query = `UPDATE jobs
                 SET status = ?, updated_at = ?
               WHERE library_id = ?
                 AND kind IN (?, ?)
                 AND status IN (${statusPlaceholders})
                 AND job_id IN (${jobPlaceholders})`;
      params = [toStatus, now, libId, ...aiKinds, ...fromStatuses, ...jobIds];
    } else {
      query = `UPDATE jobs
                 SET status = ?, updated_at = ?
               WHERE library_id = ?
                 AND kind IN (?, ?)
                 AND status IN (${statusPlaceholders})`;
      params = [toStatus, now, libId, ...aiKinds, ...fromStatuses];
    }

    const result = conn.prepare(query).run(...params);
    return { count: result.changes as number };
  }

  // ── Media Job Queue Management ────────────────────────────────────

  listMediaJobs(libraryId: string): {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    paused: number;
    cancelled: number;
    jobs: Array<{
      jobId: string;
      assetId: string;
      revisionId: string | null;
      kind: MediaJobKind;
      status: MediaJobStatus;
      progress: number;
      attemptCount: number;
      errorCode: string | null;
      errorDetail: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  } {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const kindPlaceholders = MEDIA_JOB_KINDS.map(() => '?').join(',');
    const counts = openLibrary.connection.prepare(
      `SELECT status, COUNT(*) AS count FROM jobs
        WHERE library_id = ? AND kind IN (${kindPlaceholders})
        GROUP BY status`,
    ).all(openLibrary.summary.libraryId, ...MEDIA_JOB_KINDS) as Array<{
      status: string;
      count: number;
    }>;
    const rows = openLibrary.connection.prepare(
      `SELECT job_id, asset_id, revision_id, kind, status, progress,
              attempt_count, error_code, error_detail, created_at, updated_at
         FROM jobs
        WHERE library_id = ? AND kind IN (${kindPlaceholders})
        ORDER BY created_at DESC, job_id DESC
        LIMIT 500`,
    ).all(openLibrary.summary.libraryId, ...MEDIA_JOB_KINDS) as Array<{
      job_id: string;
      asset_id: string;
      revision_id: string | null;
      kind: MediaJobKind;
      status: MediaJobStatus;
      progress: number;
      attempt_count: number;
      error_code: string | null;
      error_detail: string | null;
      created_at: string;
      updated_at: string;
    }>;
    const statusCounts = new Map(counts.map((row) => [row.status, row.count]));
    return {
      queued: statusCounts.get('queued') ?? 0,
      running: statusCounts.get('running') ?? 0,
      succeeded: statusCounts.get('succeeded') ?? 0,
      failed: statusCounts.get('failed') ?? 0,
      paused: statusCounts.get('paused') ?? 0,
      cancelled: statusCounts.get('cancelled') ?? 0,
      jobs: rows.map((row) => ({
        jobId: row.job_id,
        assetId: row.asset_id,
        revisionId: row.revision_id,
        kind: row.kind,
        status: row.status,
        progress: row.progress,
        attemptCount: row.attempt_count,
        errorCode: row.error_code,
        errorDetail: row.error_detail,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }

  pauseMediaJobs(libraryId: string, jobIds?: string[]): { pausedCount: number } {
    const count = this.updateMediaJobStatus(libraryId, ['queued', 'running'], 'paused', jobIds);
    this.abortActiveMediaJobs(libraryId, jobIds);
    return { pausedCount: count };
  }

  resumeMediaJobs(libraryId: string, jobIds?: string[]): { resumedCount: number } {
    return {
      resumedCount: this.updateMediaJobStatus(libraryId, ['paused'], 'queued', jobIds),
    };
  }

  cancelMediaJobs(libraryId: string, jobIds?: string[]): { cancelledCount: number } {
    const count = this.updateMediaJobStatus(
      libraryId,
      ['queued', 'paused', 'running'],
      'cancelled',
      jobIds,
    );
    this.abortActiveMediaJobs(libraryId, jobIds);
    return { cancelledCount: count };
  }

  retryMediaJobs(libraryId: string, jobIds: string[]): { retriedCount: number } {
    if (jobIds.length === 0) return { retriedCount: 0 };
    const openLibrary = this.requireOpenLibrary(libraryId);
    const result = openLibrary.connection.prepare(
      `UPDATE jobs SET status = 'queued', progress = 0.0, attempt_count = 0,
              error_code = NULL, error_detail = NULL, updated_at = ?
        WHERE library_id = ?
          AND kind IN (${MEDIA_JOB_KINDS.map(() => '?').join(',')})
          AND status = 'failed'
          AND job_id IN (${jobIds.map(() => '?').join(',')})`,
    ).run(
      new Date().toISOString(),
      openLibrary.summary.libraryId,
      ...MEDIA_JOB_KINDS,
      ...jobIds,
    );
    return { retriedCount: result.changes };
  }

  private updateMediaJobStatus(
    libraryId: string,
    fromStatuses: string[],
    toStatus: 'paused' | 'queued' | 'cancelled',
    jobIds?: string[],
  ): number {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const selectedIds = jobIds && jobIds.length > 0 ? [...new Set(jobIds)] : undefined;
    const idClause = selectedIds
      ? `AND job_id IN (${selectedIds.map(() => '?').join(',')})`
      : '';
    const result = openLibrary.connection.prepare(
      `UPDATE jobs SET status = ?, progress = 0.0, updated_at = ?
        WHERE library_id = ?
          AND kind IN (${MEDIA_JOB_KINDS.map(() => '?').join(',')})
          AND status IN (${fromStatuses.map(() => '?').join(',')})
          ${idClause}`,
    ).run(
      toStatus,
      new Date().toISOString(),
      openLibrary.summary.libraryId,
      ...MEDIA_JOB_KINDS,
      ...fromStatuses,
      ...(selectedIds ?? []),
    );
    return result.changes;
  }

  private abortActiveMediaJobs(libraryId: string, jobIds?: string[]): void {
    const selected = jobIds ? new Set(jobIds) : undefined;
    for (const [jobId, active] of this.activeMediaJobs) {
      if (active.libraryId !== libraryId || (selected && !selected.has(jobId))) continue;
      active.controller.abort();
    }
  }

  private mediaJobState(libraryId: string, jobId: string): string | null {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const row = openLibrary.connection.prepare(
      `SELECT status FROM jobs WHERE library_id = ? AND job_id = ?
        AND kind IN (${MEDIA_JOB_KINDS.map(() => '?').join(',')})`,
    ).get(openLibrary.summary.libraryId, jobId, ...MEDIA_JOB_KINDS) as {
      status: string;
    } | undefined;
    return row?.status ?? null;
  }

  private mediaArtifactSnapshot(openLibrary: OpenLibrary, revisionId: string): Set<string> {
    const rows = openLibrary.connection.prepare(
      'SELECT artifact_id FROM revision_artifacts WHERE revision_id = ?',
    ).all(revisionId) as Array<{ artifact_id: string }>;
    return new Set(rows.map((row) => row.artifact_id));
  }

  private discardLateMediaArtifacts(
    openLibrary: OpenLibrary,
    revisionId: string,
    previousArtifactIds: Set<string>,
    context: { libraryId: string; jobId: string; assetId: string },
  ): void {
    const rows = openLibrary.connection.prepare(
      'SELECT artifact_id, file_path FROM revision_artifacts WHERE revision_id = ?',
    ).all(revisionId) as Array<{ artifact_id: string; file_path: string }>;
    const lateRows = rows.filter((row) => !previousArtifactIds.has(row.artifact_id));
    if (lateRows.length === 0) return;
    openLibrary.connection.transaction(() => {
      const remove = openLibrary.connection.prepare(
        'DELETE FROM revision_artifacts WHERE artifact_id = ?',
      );
      for (const row of lateRows) remove.run(row.artifact_id);
    })();
    for (const row of lateRows) {
      try {
        rmSync(path.join(this.artifactsDir(openLibrary), row.file_path), { force: true });
      } catch (error) {
        this.diagnose('media-job.cancel-cleanup', error, {
          ...context,
          artifactId: row.artifact_id,
        });
      }
    }
  }

  // ── Thumbnails & Artifacts ─────────────────────────────────────────

  /**
   * Resolve the absolute filesystem path for an asset (no MIME lookup).
   */
  resolveAssetPath(libraryId: string, assetId: string): string {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const asset = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.location_kind, a.linked_folder_id, a.managed_folder_id,
                a.relative_file_path
           FROM assets a WHERE a.asset_id = ?`,
      )
      .get(assetId) as {
        asset_id: string;
        location_kind: 'managed' | 'linked';
        linked_folder_id: string | null;
        managed_folder_id: string | null;
        relative_file_path: string;
      } | undefined;
    if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
    if (asset.location_kind === 'managed') {
      return this.folderPath(openLibrary, asset.relative_file_path);
    }
    return this.linkedAssetPath(openLibrary, asset.linked_folder_id, asset.relative_file_path);
  }

  /**
   * Resolve the absolute path of a directory-tree folder (managed or linked)
   * for Main-process shell/clipboard actions (REQ-MENU-006). The value never
   * crosses to the Renderer (REQ-COMMAND-003).
   *
   * Managed folders resolve to the library Assets root + recorded relative
   * path; linked folders resolve to their (canonicalized) root. A folder that
   * is missing on disk — or a linked root that is offline or gone — fails
   * with a typed FOLDER_NOT_FOUND instead of handing Main a dead path. The
   * renderer disables these actions for offline linked folders, so the check
   * here is the defensive boundary for stale state.
   */
  resolveFolderPath(libraryId: string, folderId: string): string {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const managed = openLibrary.connection
      .prepare('SELECT relative_path FROM managed_folders WHERE folder_id = ?')
      .get(folderId) as { relative_path: string } | undefined;
    if (managed) {
      const targetPath = this.folderPath(openLibrary, managed.relative_path);
      if (!directoryExists(targetPath)) throw new LibraryServiceError('FOLDER_NOT_FOUND');
      return targetPath;
    }
    const linked = openLibrary.connection
      .prepare('SELECT absolute_root_path, status FROM linked_folders WHERE folder_id = ?')
      .get(folderId) as { absolute_root_path: string; status: 'available' | 'offline' } | undefined;
    if (!linked) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    if (linked.status === 'offline' || this.linkedRootIsGone(linked.absolute_root_path)) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }
    try {
      return realpathSync(linked.absolute_root_path);
    } catch (error) {
      throw new LibraryServiceError('FOLDER_NOT_FOUND', { cause: error });
    }
  }

  /**
   * Return the .serpent/artifacts directory for an open library.
   */
  private artifactsDir(openLibrary: OpenLibrary): string {
    return path.join(openLibrary.summary.libraryPath, '.serpent', 'artifacts');
  }

  /**
   * Detect media type from a file extension.
   * Returns 'image' for PNG/JPEG/GIF/TIFF/WebP/BMP, 'video' for MP4/MOV/AVI/WMV/WebM,
   * 'audio' for WAV/MP3/OGG/M4A/AAC/FLAC/Opus, 'text' for common plain-text/code
   * extensions, and 'other' for everything else (including EXR/TGA which would need OIIO).
   */
  static detectMediaType(filenameOrMime: string): 'image' | 'video' | 'audio' | 'text' | 'other' {
    const lower = filenameOrMime.toLowerCase();
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') ||
        lower.endsWith('.gif') || lower.endsWith('.tiff') || lower.endsWith('.tif') ||
        lower.endsWith('.webp') || lower.endsWith('.bmp')) {
      return 'image';
    }
    if (lower.endsWith('.mp4') || lower.endsWith('.webm') ||
        lower.endsWith('.mov') || lower.endsWith('.avi') || lower.endsWith('.wmv')) {
      return 'video';
    }
    if (isAudioFileName(lower)) {
      return 'audio';
    }
    if (isTextFileName(lower)) {
      return 'text';
    }
    return 'other';
  }

  /**
   * Map detector output onto AssetSummary.mediaType.
   * searchAssets / trash listing previously collapsed audio+text to `other`
   * (Serpent-671), which hid duration badges and Inspector audio tech lines.
   */
  static toSummaryMediaType(
    detected: ReturnType<typeof LibraryService.detectMediaType>,
  ): 'image' | 'video' | 'audio' | 'text' | 'other' {
    return detected === 'image' ||
      detected === 'video' ||
      detected === 'audio' ||
      detected === 'text'
      ? detected
      : 'other';
  }

  static supportsThumbnail(filename: string): boolean {
    const mediaType = LibraryService.detectMediaType(filename);
    const extension = path.extname(filename).toLowerCase();
    // Text has no raster thumbnail job; preview is IPC-capped UTF-8 (Serpent-sh7).
    if (mediaType === 'text') return false;
    return mediaType !== 'other' || extension === '.exr' || extension === '.tga';
  }

  // ── Thumbnail Generation Dispatch ─────────────────────────────────

  /** Generate thumbnails/artifacts for an asset, dispatching by media type. */
  async generateThumbnail(input: {
    libraryId: string;
    assetId: string;
  }, execution: MediaExecutionContext = {}): Promise<{ artifactId: string }> {
    if (execution.signal?.aborted) {
      throw new DOMException('Media job cancelled before thumbnail generation.', 'AbortError');
    }
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const assetPath = this.resolveAssetPath(input.libraryId, input.assetId);

    const mediaType = LibraryService.detectMediaType(assetPath);

    // Get the current revision for this asset
    const assetRow = openLibrary.connection
      .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
      .get(input.assetId) as { current_revision_id: string | null } | undefined;
    if (!assetRow?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
    const revisionId = assetRow.current_revision_id;
    const ext = path.extname(assetPath).toLowerCase();
    const isOiioImage = ext === '.exr' || ext === '.tga';
    if (mediaType === 'other' && !isOiioImage) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION', {
        reason: 'UNSUPPORTED_FORMAT',
      });
    }

    const isGifAsset = assetPath.toLowerCase().endsWith('.gif');
    const artifactKinds = mediaType === 'video'
      ? ['extracted_metadata', 'video_poster']
      : mediaType === 'audio'
        // thumbnail = 4:3 grid cover; video_poster = wide viewer strip (Serpent-vlx)
        ? ['extracted_metadata', 'thumbnail', 'video_poster']
      : isGifAsset
        ? ['thumbnail', 'extracted_metadata']
        : ['thumbnail'];
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE revision_id = ?
            AND kind IN (${artifactKinds.map(() => '?').join(', ')})
            AND invalidated_at IS NULL`,
      )
      .run(new Date().toISOString(), revisionId, ...artifactKinds);

    if (mediaType === 'image') {
      return this.generateImageThumbnail(input, openLibrary, assetPath, revisionId, execution);
    }

    if (mediaType === 'video') {
      return this.generateVideoArtifacts(input, openLibrary, assetPath, revisionId, execution);
    }

    if (mediaType === 'audio') {
      return this.generateAudioArtifacts(input, openLibrary, assetPath, revisionId, execution);
    }

    if (isOiioImage) {
      return this.generateOiiOThumbnail(input, openLibrary, assetPath, revisionId, {}, execution);
    }

    throw new LibraryServiceError('INTERNAL_ERROR');
  }

  // ── Image thumbnail (sharp) ────────────────────────────────────────

  private async generateImageThumbnail(
    input: { libraryId: string; assetId: string },
    openLibrary: OpenLibrary,
    assetPath: string,
    revisionId: string,
    execution: MediaExecutionContext,
  ): Promise<{ artifactId: string }> {
    const artifactId = randomUUID();
    const artifactsDir = this.artifactsDir(openLibrary);
    mkdirSync(artifactsDir, { recursive: true });
    const artifactRelPath = `${artifactId}.webp`;
    const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
    let imageProcessed = false;

    try {
      const { inputWidth, inputHeight, gifMetadata } = await sharpDecoderSemaphore.run(
        execution.signal,
        async () => {
          const s = this.options.sharpFn ?? requireSharp();
          const probe = s(assetPath);
          const metadata = await probe.metadata();
          const pages = metadata.pages ?? 1;
          const isGif =
            metadata.format === 'gif' || assetPath.toLowerCase().endsWith('.gif');
          const isAnimatedGif = isGif && pages > 1;

          let page = 0;
          if (isAnimatedGif) {
            const scored: Array<{ page: number; score: number }> = [];
            for (const candidate of sampleGifPageIndices(pages)) {
              if (execution.signal?.aborted) {
                throw new DOMException('Media job cancelled during GIF page probe.', 'AbortError');
              }
              try {
                const samplePipeline = s(assetPath, { page: candidate })
                  .rotate()
                  .toColourspace('srgb')
                  .resize({
                    width: GIF_THUMBNAIL_PROBE_SIZE,
                    height: GIF_THUMBNAIL_PROBE_SIZE,
                    fit: 'inside',
                    withoutEnlargement: true,
                  });
                const rawFn = samplePipeline.raw;
                if (!rawFn) {
                  break;
                }
                const rawPipeline = rawFn.call(samplePipeline);
                const toBufferFn = rawPipeline.toBuffer;
                if (!toBufferFn) {
                  break;
                }
                const sample = await toBufferFn.call(rawPipeline, {
                  resolveWithObject: true,
                });
                scored.push({
                  page: candidate,
                  score: scoreRawRgbFrame(sample.data, sample.info.channels),
                });
              } catch (error) {
                this.diagnose('thumbnail.gif-page-probe', error, {
                  assetPath,
                  page: candidate,
                });
              }
            }
            if (scored.length > 0) {
              page = pickBestGifPage(scored, pages);
            }
          }

          const pipeline = isAnimatedGif ? s(assetPath, { page }) : s(assetPath);
          const finalMeta = isAnimatedGif ? await pipeline.metadata() : metadata;
          const swapsDimensions = finalMeta.orientation !== undefined
            && finalMeta.orientation >= 5
            && finalMeta.orientation <= 8;
          const inputWidth = swapsDimensions ? (finalMeta.height ?? 0) : (finalMeta.width ?? 0);
          const inputHeight = swapsDimensions ? (finalMeta.width ?? 0) : (finalMeta.height ?? 0);

          await pipeline
            .rotate()
            .toColourspace('srgb')
            .resize({
              width: 512,
              height: 512,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .webp({ quality: 80 })
            .toFile(artifactAbsPath);
          if (execution.signal?.aborted) {
            throw new DOMException('Media job cancelled after image decoding.', 'AbortError');
          }

          const gifMeta: GifExtractedMetadata | null = isGif
            ? buildGifExtractedMetadata({
                width: inputWidth,
                height: inputHeight,
                pages,
                delay: metadata.delay,
              })
            : null;
          return { inputWidth, inputHeight, gifMetadata: gifMeta };
        },
      );

      const outputStat = statSync(artifactAbsPath);
      let outputWidth = inputWidth;
      let outputHeight = inputHeight;
      if (inputWidth > 512 || inputHeight > 512) {
        const ratio = Math.min(512 / inputWidth, 512 / inputHeight);
        outputWidth = Math.round(inputWidth * ratio);
        outputHeight = Math.round(inputHeight * ratio);
      }
      imageProcessed = true;

      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              width, height, generator_version, status, generated_at)
           VALUES (?, ?, 'thumbnail', 'image/webp', ?, ?, ?, ?, ?, 'ready', ?)`,
        )
        .run(
          artifactId,
          revisionId,
          outputStat.size,
          artifactRelPath,
          outputWidth || null,
          outputHeight || null,
          SHARP_THUMBNAIL_GENERATOR,
          new Date().toISOString(),
        );

      if (gifMetadata) {
        this.persistGifExtractedMetadata(
          openLibrary,
          revisionId,
          gifMetadata,
        );
      }

      // Serpent-7x0: best-effort EXIF/IPTC/XMP author auto-extract on first
      // thumbnail. Never blocks or fails thumbnail generation.
      await this.backfillAuthorFromExif(openLibrary, input.assetId, assetPath);

      // Emit thumbnail-ready notification
      this.options.onAssetsChanged?.({
        type: 'asset.changed',
        libraryId: input.libraryId,
        changedCount: 1,
        missingCount: 0,
      });

      return { artifactId };
    } catch (error) {
      const extension = path.extname(assetPath).toLowerCase();
      if (!imageProcessed && (extension === '.tif' || extension === '.tiff')) {
        // libvips handles ordinary TIFFs efficiently. Complex/multi-part TIFFs
        // that it cannot decode fall back to the same OIIO + OCIO path as EXR
        // and TGA, without leaving a terminal sharp failure that would conflict
        // with the replacement thumbnail artifact.
        try {
          rmSync(artifactAbsPath, { force: true });
        } catch (cleanupError) {
          this.diagnose('thumbnail.tiff-sharp-cleanup', cleanupError, {
            libraryId: input.libraryId,
            assetId: input.assetId,
          });
        }
        this.diagnose('thumbnail.tiff-sharp-fallback', error, {
          libraryId: input.libraryId,
          assetId: input.assetId,
          extension,
        });
        return this.generateOiiOThumbnail(input, openLibrary, assetPath, revisionId, {}, execution);
      }

      // Write failed status
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              generator_version, status, error_code, generated_at)
           VALUES (?, ?, 'thumbnail', 'image/webp', 0, ?, ?, 'failed', ?, ?)`,
        )
        .run(
          artifactId,
          revisionId,
          artifactRelPath,
          `sharp@${SHARP_VERSION}`,
          typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : 'THUMBNAIL_GENERATION_FAILED',
          new Date().toISOString(),
        );

      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
  }

  /** Persist GIF duration / frame count as extracted_metadata (CU-D8). */
  private persistGifExtractedMetadata(
    openLibrary: OpenLibrary,
    revisionId: string,
    metadata: GifExtractedMetadata,
  ): void {
    const artifactId = randomUUID();
    const artifactsDir = this.artifactsDir(openLibrary);
    mkdirSync(artifactsDir, { recursive: true });
    const artifactRelPath = `${artifactId}.json`;
    const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
    try {
      writeFileSync(artifactAbsPath, JSON.stringify(metadata, null, 2), 'utf-8');
      const outputStat = statSync(artifactAbsPath);
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              width, height, duration_ms, generator_version, status, generated_at)
           VALUES (?, ?, 'extracted_metadata', 'application/json', ?, ?, ?, ?, ?, ?, 'ready', ?)`,
        )
        .run(
          artifactId,
          revisionId,
          outputStat.size,
          artifactRelPath,
          metadata.width || null,
          metadata.height || null,
          metadata.durationMs,
          `sharp-gif-meta@${SHARP_VERSION}`,
          new Date().toISOString(),
        );
    } catch (error) {
      rmSync(artifactAbsPath, { force: true });
      this.diagnose('gif.extracted-metadata', error, { revisionId });
    }
  }

  // ── Audio artifacts (ffprobe + waveform thumbnail) ─────────────────

  /**
   * Audio path (Serpent-0x5): extract metadata and render a waveform PNG stored
   * as the standard `thumbnail` artifact so grid/Inspector reuse existing cover UI.
   * Playback uses the native source via `serpent://source` — no proxy needed.
   */
  private async generateAudioArtifacts(
    input: { libraryId: string; assetId: string },
    openLibrary: OpenLibrary,
    assetPath: string,
    revisionId: string,
    execution: MediaExecutionContext,
  ): Promise<{ artifactId: string }> {
    const ffprobePath = resolveFfprobePath();
    const ffmpegPath = resolveFfmpegPath();
    const artifactsDir = this.artifactsDir(openLibrary);
    mkdirSync(artifactsDir, { recursive: true });

    try {
      await this.probeVideoAsset(
        input, openLibrary, assetPath, revisionId, ffprobePath, execution,
      );
    } catch (error) {
      this.diagnose('audio-probe', error, { libraryId: input.libraryId, assetId: input.assetId });
    }

    let waveformArtifactId: string | null = null;
    try {
      waveformArtifactId = await this.generateAudioWaveformPng(
        input,
        openLibrary,
        assetPath,
        revisionId,
        ffmpegPath,
        artifactsDir,
        execution,
        {
          kind: 'thumbnail',
          width: AUDIO_WAVEFORM_COVER_WIDTH,
          height: AUDIO_WAVEFORM_COVER_HEIGHT,
          flattenBackground: { ...AUDIO_WAVEFORM_COVER_BACKGROUND },
        },
      );
    } catch (error) {
      this.diagnose('audio-waveform', error, { libraryId: input.libraryId, assetId: input.assetId });
    }

    try {
      await this.generateAudioWaveformPng(
        input,
        openLibrary,
        assetPath,
        revisionId,
        ffmpegPath,
        artifactsDir,
        execution,
        {
          kind: 'video_poster',
          width: AUDIO_WAVEFORM_VIEWER_WIDTH,
          height: AUDIO_WAVEFORM_VIEWER_HEIGHT,
          // Viewer shell paints theme --pane; flatten to near-black so fill
          // stretch does not flash a light letterbox fringe.
          flattenBackground: { r: 0x1a, g: 0x1c, b: 0x1f },
        },
      );
    } catch (error) {
      this.diagnose('audio-waveform-viewer', error, {
        libraryId: input.libraryId,
        assetId: input.assetId,
      });
    }

    if (!waveformArtifactId) {
      throw new LibraryServiceError('INTERNAL_ERROR', {
        reason: 'MEDIA_PROCESSING_FAILED',
      });
    }

    this.options.onAssetsChanged?.({
      type: 'asset.changed',
      libraryId: input.libraryId,
      changedCount: 1,
      missingCount: 0,
    });

    return { artifactId: waveformArtifactId };
  }

  /**
   * Render a mono waveform PNG for grid cover (`thumbnail`) or viewer strip
   * (`video_poster` for audio — Serpent-vlx).
   */
  private async generateAudioWaveformPng(
    input: { libraryId: string; assetId: string },
    openLibrary: OpenLibrary,
    assetPath: string,
    revisionId: string,
    ffmpegPath: string,
    artifactsDir: string,
    execution: MediaExecutionContext,
    options: {
      kind: 'thumbnail' | 'video_poster';
      width: number;
      height: number;
      flattenBackground: { r: number; g: number; b: number };
    },
  ): Promise<string> {
    const artifactId = randomUUID();
    const artifactRelPath = `${artifactId}.png`;
    const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
    const tempAbsPath = path.join(artifactsDir, `${artifactId}.wave-tmp.png`);

    try {
      const result = await this.runFfmpeg(ffmpegPath, [
        '-y',
        '-i', assetPath,
        '-filter_complex',
        `aformat=channel_layouts=mono,compand,showwavespic=s=${options.width}x${options.height}:colors=${AUDIO_WAVEFORM_COVER_STROKE}:scale=sqrt`,
        '-frames:v', '1',
        '-update', '1',
        tempAbsPath,
      ], { timeoutMs: 120_000, signal: execution.signal });

      if (result.exitCode !== 0) {
        throw new Error(
          `ffmpeg waveform exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`,
        );
      }

      const sharp = this.options.sharpFn ?? requireSharp();
      const flatten = sharp(tempAbsPath).flatten?.({
        background: { ...options.flattenBackground },
      });
      if (!flatten?.png || !flatten.toFile) {
        throw new Error('Sharp flatten/png API unavailable for waveform covers.');
      }
      await flatten.png().toFile(artifactAbsPath);
      rmSync(tempAbsPath, { force: true });

      const outputStat = statSync(artifactAbsPath);
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              width, height, generator_version, status, generated_at)
           VALUES (?, ?, ?, 'image/png', ?, ?, ?, ?, ?, 'ready', ?)`,
        )
        .run(
          artifactId,
          revisionId,
          options.kind,
          outputStat.size,
          artifactRelPath,
          options.width,
          options.height,
          AUDIO_WAVEFORM_GENERATOR,
          new Date().toISOString(),
        );

      return artifactId;
    } catch (error) {
      rmSync(tempAbsPath, { force: true });
      rmSync(artifactAbsPath, { force: true });
      this.writeFailedArtifact(
        openLibrary,
        artifactId,
        revisionId,
        options.kind,
        'image/png',
        artifactRelPath,
        AUDIO_WAVEFORM_GENERATOR,
        error,
      );
      throw error;
    }
  }

  // ── Video artifacts (ffprobe + ffmpeg) ─────────────────────────────

  /**
   * Generate only latency-sensitive metadata and poster. Long derivatives run
   * as independent persistent jobs after the poster-ready event.
   * Returns the poster artifact ID (the primary visual thumbnail).
   */
  private async generateVideoArtifacts(
    input: { libraryId: string; assetId: string },
    openLibrary: OpenLibrary,
    assetPath: string,
    revisionId: string,
    execution: MediaExecutionContext,
  ): Promise<{ artifactId: string }> {
    const ffprobePath = resolveFfprobePath();
    const ffmpegPath = resolveFfmpegPath();
    const artifactsDir = this.artifactsDir(openLibrary);
    mkdirSync(artifactsDir, { recursive: true });

    let posterArtifactId: string | null = null;

    // 1. ffprobe metadata extraction
    try {
      await this.probeVideoAsset(
        input, openLibrary, assetPath, revisionId, ffprobePath, execution,
      );
    } catch (error) {
      this.diagnose('video-probe', error, { libraryId: input.libraryId, assetId: input.assetId });
      // Continue with remaining artifacts even if probe fails
    }

    // 2. Video poster
    try {
      posterArtifactId = await this.generateVideoPoster(
        input, openLibrary, assetPath, revisionId, ffmpegPath, artifactsDir, execution,
      );
    } catch (error) {
      this.diagnose('video-poster', error, { libraryId: input.libraryId, assetId: input.assetId });
      // Continue with remaining artifacts
    }

    if (!posterArtifactId) {
      throw new LibraryServiceError('INTERNAL_ERROR', {
        reason: 'MEDIA_PROCESSING_FAILED',
      });
    }

    // Emit thumbnail-ready notification only after the primary poster exists.
    this.options.onAssetsChanged?.({
      type: 'asset.changed',
      libraryId: input.libraryId,
      changedCount: 1,
      missingCount: 0,
    });

    return { artifactId: posterArtifactId };
  }

  private enqueueVideoDerivativeJob(
    openLibrary: OpenLibrary,
    assetId: string,
    revisionId: string,
    kind: 'generate_contact_sheet' | 'generate_webm_proxy',
    priority: number,
  ): void {
    const artifactKind = kind === 'generate_contact_sheet' ? 'contact_sheet' : 'webm_proxy';
    const terminalArtifact = openLibrary.connection.prepare(
      `SELECT artifact_id FROM revision_artifacts WHERE revision_id = ? AND kind = ?
        AND status IN ('ready', 'failed') AND invalidated_at IS NULL LIMIT 1`,
    ).get(revisionId, artifactKind);
    if (terminalArtifact) return;
    const now = new Date().toISOString();
    const active = openLibrary.connection.prepare(
      `SELECT job_id FROM jobs WHERE asset_id = ? AND revision_id = ? AND kind = ?
        AND status IN ('queued', 'running', 'paused') LIMIT 1`,
    ).get(assetId, revisionId, kind);
    if (active) return;
    openLibrary.connection.prepare(
      `INSERT INTO jobs
         (job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
          attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, 0.0, 0, ?, ?)`,
    ).run(randomUUID(), openLibrary.summary.libraryId, assetId, revisionId, kind, priority, now, now);
  }

  private enqueuePaletteJob(
    openLibrary: OpenLibrary,
    assetId: string,
    revisionId: string,
    priority: number,
  ): boolean {
    const source = openLibrary.connection.prepare(
      `SELECT artifact_id FROM revision_artifacts
        WHERE revision_id = ?
          AND kind IN ('thumbnail', 'video_poster')
          AND status = 'ready'
          AND invalidated_at IS NULL
        LIMIT 1`,
    ).get(revisionId);
    if (!source) return false;
    const terminal = openLibrary.connection.prepare(
      `SELECT artifact_id FROM revision_artifacts
        WHERE revision_id = ? AND kind = 'extracted_palette'
          AND status IN ('ready', 'failed') AND invalidated_at IS NULL LIMIT 1`,
    ).get(revisionId);
    if (terminal) return false;
    const active = openLibrary.connection.prepare(
      `SELECT job_id FROM jobs WHERE asset_id = ? AND revision_id = ?
        AND kind = 'extract_palette' AND status IN ('queued', 'running', 'paused') LIMIT 1`,
    ).get(assetId, revisionId);
    if (active) return false;
    const now = new Date().toISOString();
    const result = openLibrary.connection.prepare(
      `INSERT INTO jobs
         (job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
          attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'extract_palette', 'queued', ?, 0.0, 0, ?, ?)`,
    ).run(randomUUID(), openLibrary.summary.libraryId, assetId, revisionId, priority, now, now);
    return result.changes > 0;
  }

  private async generateQueuedPaletteArtifact(
    libraryId: string,
    assetId: string,
    queuedRevisionId: string,
    execution: MediaExecutionContext,
  ): Promise<boolean> {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const asset = openLibrary.connection.prepare(
      'SELECT current_revision_id FROM assets WHERE asset_id = ?',
    ).get(assetId) as { current_revision_id: string | null } | undefined;
    if (!asset?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
    if (asset.current_revision_id !== queuedRevisionId) return false;

    const source = openLibrary.connection.prepare(
      `SELECT artifact_id FROM revision_artifacts
        WHERE revision_id = ?
          AND kind IN ('thumbnail', 'video_poster')
          AND status = 'ready'
          AND invalidated_at IS NULL
        ORDER BY CASE kind WHEN 'thumbnail' THEN 0 ELSE 1 END
        LIMIT 1`,
    ).get(queuedRevisionId) as { artifact_id: string } | undefined;
    if (!source) {
      throw new LibraryServiceError('INTERNAL_ERROR', { reason: 'PALETTE_SOURCE_NOT_READY' });
    }
    const sourcePath = this.getArtifactAbsolutePath(libraryId, source.artifact_id);
    const artifactId = randomUUID();
    const artifactRelPath = `${artifactId}.json`;
    const artifactAbsPath = path.join(this.artifactsDir(openLibrary), artifactRelPath);

    openLibrary.connection.prepare(
      `UPDATE revision_artifacts SET invalidated_at = ?
        WHERE revision_id = ? AND kind = 'extracted_palette' AND invalidated_at IS NULL`,
    ).run(new Date().toISOString(), queuedRevisionId);

    try {
      const palette = await sharpDecoderSemaphore.run(execution.signal, async () => {
        const sharp = this.options.paletteSharpFn
          ?? (requireSharp() as unknown as PaletteSharpModule);
        const decoded = await sharp(sourcePath)
          .rotate()
          .toColourspace('srgb')
          .resize({ width: 64, height: 64, fit: 'inside', withoutEnlargement: true })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        if (execution.signal?.aborted) {
          throw new DOMException('Media job cancelled after palette decoding.', 'AbortError');
        }
        return extractRepresentativePalette(decoded.data, decoded.info.channels, 6);
      });
      if (palette.length === 0) {
        throw new Error('The decoded preview contains no visible pixels.');
      }
      const dominant = dominantColorMetrics(palette[0]!.hex);
      writeFileSync(artifactAbsPath, JSON.stringify(palette), 'utf-8');
      if (execution.signal?.aborted) {
        throw new DOMException('Media job cancelled after palette serialization.', 'AbortError');
      }
      const outputStat = statSync(artifactAbsPath);
      openLibrary.connection.prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            generator_version, status, generated_at, dominant_hue, dominant_lightness)
         VALUES (?, ?, 'extracted_palette', 'application/json', ?, ?, ?, 'ready', ?, ?, ?)`,
      ).run(
        artifactId,
        queuedRevisionId,
        outputStat.size,
        artifactRelPath,
        `serpent-palette@1;sharp@${SHARP_VERSION}`,
        new Date().toISOString(),
        dominant.hue,
        dominant.lightness,
      );
      this.options.onAssetsChanged?.({
        type: 'asset.changed',
        libraryId,
        changedCount: 1,
        missingCount: 0,
      });
      return true;
    } catch (error) {
      rmSync(artifactAbsPath, { force: true });
      if (execution.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        throw error;
      }
      openLibrary.connection.prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            generator_version, status, error_code, generated_at)
         VALUES (?, ?, 'extracted_palette', 'application/json', 0, ?, ?, 'failed',
                 'PALETTE_EXTRACTION_FAILED', ?)`,
      ).run(
        artifactId,
        queuedRevisionId,
        artifactRelPath,
        `serpent-palette@1;sharp@${SHARP_VERSION}`,
        new Date().toISOString(),
      );
      throw error;
    }
  }

  private async generateQueuedVideoArtifact(
    libraryId: string,
    assetId: string,
    queuedRevisionId: string,
    kind: 'generate_contact_sheet' | 'generate_webm_proxy',
    execution: MediaExecutionContext,
  ): Promise<boolean> {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const assetPath = this.resolveAssetPath(libraryId, assetId);
    const asset = openLibrary.connection.prepare(
      'SELECT current_revision_id FROM assets WHERE asset_id = ?',
    ).get(assetId) as { current_revision_id: string | null } | undefined;
    if (!asset?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
    if (asset.current_revision_id !== queuedRevisionId) return false;
    const revisionId = queuedRevisionId;
    const ffmpegPath = resolveFfmpegPath();
    const artifactsDir = this.artifactsDir(openLibrary);
    mkdirSync(artifactsDir, { recursive: true });
    if (kind === 'generate_webm_proxy') {
      await this.generateWebmProxy({ libraryId, assetId }, openLibrary, assetPath, revisionId, ffmpegPath, artifactsDir, execution);
      return true;
    }
    let durationSec = 0;
    const metadata = this.getCurrentArtifact(libraryId, assetId, 'extracted_metadata');
    if (metadata?.status === 'ready') {
      try {
        const parsed = JSON.parse(
          readFileSync(path.join(artifactsDir, metadata.filePath), 'utf-8'),
        ) as { durationMs?: number };
        durationSec = (parsed.durationMs ?? 0) / 1000;
      } catch {
        // Optional contact sheets can be skipped when metadata cache vanished.
      }
    }
    if (durationSec > 1) {
      await this.generateContactSheet(
        { libraryId, assetId }, openLibrary, assetPath, revisionId, ffmpegPath, artifactsDir, durationSec, execution,
      );
    }
    return true;
  }

  /** Run ffprobe and store extracted_metadata artifact. */
  private async probeVideoAsset(
    input: { libraryId: string; assetId: string },
    openLibrary: OpenLibrary,
    assetPath: string,
    revisionId: string,
    ffprobePath: string,
    execution: MediaExecutionContext,
  ): Promise<{ durationSec: number; width: number | null; height: number | null }> {
    const artifactId = randomUUID();
    const artifactsDir = this.artifactsDir(openLibrary);
    mkdirSync(artifactsDir, { recursive: true });
    const artifactRelPath = `${artifactId}.json`;
    const artifactAbsPath = path.join(artifactsDir, artifactRelPath);

    try {
      const result = await this.runFfmpeg(ffprobePath, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        assetPath,
      ], { timeoutMs: 60_000, signal: execution.signal });

      if (result.exitCode !== 0) {
        throw new Error(`ffprobe exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`);
      }

      const probeJson = JSON.parse(result.stdout.toString('utf-8'));
      const videoStream = probeJson.streams?.find(
        (s: { codec_type: string }) => s.codec_type === 'video',
      );
      const audioStream = probeJson.streams?.find(
        (s: { codec_type: string }) => s.codec_type === 'audio',
      );

      const durationSec = parseFloat(probeJson.format?.duration || '0') || 0;
      const width: number | null = videoStream?.width ?? null;
      const height: number | null = videoStream?.height ?? null;
      const framerate = videoStream?.r_frame_rate || null;

      // Retrieve rotation side_data if present
      let rotation = 0;
      if (videoStream?.side_data_list) {
        for (const sd of videoStream.side_data_list) {
          if (sd.rotation !== undefined) {
            rotation = sd.rotation;
            break;
          }
        }
      }

      // Store structured metadata as extracted_metadata artifact
      const metadata = {
        container: probeJson.format?.format_name || null,
        durationMs: Math.round(durationSec * 1000),
        width: width ?? 0,
        height: height ?? 0,
        framerate,
        rotation: rotation !== 0 ? rotation : undefined,
        videoCodec: videoStream?.codec_name || null,
        videoBitrate: videoStream?.bit_rate || null,
        pixelFormat: videoStream?.pix_fmt || null,
        hasAudio: !!audioStream,
        audioCodec: audioStream?.codec_name || null,
        audioBitrate: audioStream?.bit_rate || null,
        sampleRate: audioStream?.sample_rate || null,
        channels: audioStream?.channels || null,
        containerBitrate: probeJson.format?.bit_rate || null,
      };

      writeFileSync(artifactAbsPath, JSON.stringify(metadata, null, 2), 'utf-8');
      const outputStat = statSync(artifactAbsPath);

      openLibrary.connection
        .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              width, height, duration_ms, generator_version, status, generated_at)
           VALUES (?, ?, 'extracted_metadata', 'application/json', ?, ?, ?, ?, ?, ?, 'ready', ?)`,
        )
        .run(
          artifactId, revisionId, outputStat.size, artifactRelPath,
          width, height, metadata.durationMs,
          `ffprobe@${FFMPEG_VERSION}`,
          new Date().toISOString(),
        );

      return { durationSec, width, height };
    } catch (error) {
      // Write failed artifact
      this.writeFailedArtifact(openLibrary, artifactId, revisionId, 'extracted_metadata',
        'application/json', artifactRelPath, `ffprobe@${FFMPEG_VERSION}`, error);
      throw error;
    }
  }

  /** Generate a video poster frame using ffmpeg thumbnail filter. */
  private async generateVideoPoster(
    input: { libraryId: string; assetId: string },
    openLibrary: OpenLibrary,
    assetPath: string,
    revisionId: string,
    ffmpegPath: string,
    artifactsDir: string,
    execution: MediaExecutionContext,
  ): Promise<string> {
    const artifactId = randomUUID();
    const artifactRelPath = `${artifactId}.jpg`;
    const artifactAbsPath = path.join(artifactsDir, artifactRelPath);

    try {
      const result = await this.runFfmpeg(ffmpegPath, [
        '-y',
        '-i', assetPath,
        // A low fps stage makes short clips yield no filtered frames while
        // FFmpeg still exits 0. thumbnail+scale always emits the selected frame.
        '-vf', 'thumbnail=300,scale=640:-1',
        '-frames:v', '1',
        '-q:v', '3',
        artifactAbsPath,
      ], { timeoutMs: 120_000, signal: execution.signal });

      if (result.exitCode !== 0) {
        throw new Error(`ffmpeg poster exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`);
      }

      const outputStat = statSync(artifactAbsPath);
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              generator_version, status, generated_at)
           VALUES (?, ?, 'video_poster', 'image/jpeg', ?, ?, ?, 'ready', ?)`,
        )
        .run(artifactId, revisionId, outputStat.size, artifactRelPath,
          `ffmpeg@${FFMPEG_VERSION}`, new Date().toISOString());

      return artifactId;
    } catch (error) {
      this.writeFailedArtifact(openLibrary, artifactId, revisionId, 'video_poster',
        'image/jpeg', artifactRelPath, `ffmpeg@${FFMPEG_VERSION}`, error);
      throw error;
    }
  }

  /** Generate a contact sheet (grid of sampled frames). */
  private async generateContactSheet(
    input: { libraryId: string; assetId: string },
    openLibrary: OpenLibrary,
    assetPath: string,
    revisionId: string,
    ffmpegPath: string,
    artifactsDir: string,
    durationSec: number,
    execution: MediaExecutionContext,
  ): Promise<string> {
    const artifactId = randomUUID();
    const artifactRelPath = `${artifactId}.jpg`;
    const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
    const frameCount = 16;
    const interval = Math.max(0.5, durationSec / frameCount);
    const columns = 4;
    const rows = Math.ceil(frameCount / columns);

    // The LGPL bundle disables fontconfig. Until Serpent ships a licensed font,
    // avoid drawtext rather than depending on a platform-specific system font.
    const filterGraph = [
      `fps=1/${interval}`,
      'scale=320:-1:flags=lanczos',
      `tile=${columns}x${rows}:margin=2:padding=2:color=#1a1a1a`,
    ].join(',');

    try {
      const result = await this.runFfmpeg(ffmpegPath, [
        '-y',
        '-i', assetPath,
        '-vf', filterGraph,
        '-frames:v', '1',
        '-q:v', '5',
        '-update', '1',
        artifactAbsPath,
      ], { timeoutMs: 180_000, signal: execution.signal });

      if (result.exitCode !== 0) {
        throw new Error(`ffmpeg contact sheet exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`);
      }

      const outputStat = statSync(artifactAbsPath);
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              generator_version, status, generated_at)
           VALUES (?, ?, 'contact_sheet', 'image/jpeg', ?, ?, ?, 'ready', ?)`,
        )
        .run(artifactId, revisionId, outputStat.size, artifactRelPath,
          `ffmpeg@${FFMPEG_VERSION}`, new Date().toISOString());

      return artifactId;
    } catch (error) {
      this.writeFailedArtifact(openLibrary, artifactId, revisionId, 'contact_sheet',
        'image/jpeg', artifactRelPath, `ffmpeg@${FFMPEG_VERSION}`, error);
      throw error;
    }
  }

  /** Generate a WebM VP9/Opus proxy for playback. */
  private async generateWebmProxy(
    input: { libraryId: string; assetId: string },
    openLibrary: OpenLibrary,
    assetPath: string,
    revisionId: string,
    ffmpegPath: string,
    artifactsDir: string,
    execution: MediaExecutionContext,
  ): Promise<string> {
    const artifactId = randomUUID();
    const artifactRelPath = `${artifactId}.webm`;
    const artifactAbsPath = path.join(artifactsDir, artifactRelPath);

    try {
      const result = await this.runFfmpeg(ffmpegPath, [
        '-y',
        '-i', assetPath,
        '-c:v', 'libvpx-vp9',
        '-b:v', '1M',
        '-c:a', 'libopus',
        '-vf', 'scale=w=min(720\\,iw):h=min(720\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2',
        '-g', '60',
        '-row-mt', '1',
        artifactAbsPath,
      ], { timeoutMs: 600_000, signal: execution.signal });

      if (result.exitCode !== 0) {
        throw new Error(`ffmpeg webm proxy exited with code ${result.exitCode}: ${result.stderr.slice(-200)}`);
      }

      const outputStat = statSync(artifactAbsPath);
      if (outputStat.size > MAX_WEBM_PROXY_BYTES) {
        rmSync(artifactAbsPath, { force: true });
        const error = new Error(
          `Generated WebM proxy exceeds the 512 MiB safety limit (${outputStat.size} bytes).`,
        ) as Error & { code: string };
        error.code = 'MEDIA_PROCESSING_FAILED';
        throw error;
      }
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              generator_version, status, generated_at)
           VALUES (?, ?, 'webm_proxy', 'video/webm', ?, ?, ?, 'ready', ?)`,
        )
        .run(artifactId, revisionId, outputStat.size, artifactRelPath,
          `ffmpeg@${FFMPEG_VERSION}`, new Date().toISOString());

      return artifactId;
    } catch (error) {
      this.writeFailedArtifact(openLibrary, artifactId, revisionId, 'webm_proxy',
        'video/webm', artifactRelPath, `ffmpeg@${FFMPEG_VERSION}`, error);
      throw error;
    }
  }

  // ── OIIO thumbnail (EXR/TGA and complex TIFF fallback) ─────────────

  private async generateOiiOThumbnail(
    input: { libraryId: string; assetId: string },
    openLibrary: OpenLibrary,
    assetPath: string,
    revisionId: string,
    options: { exposureStops?: number; inputColorSpace?: string } = {},
    execution: MediaExecutionContext = {},
  ): Promise<{ artifactId: string }> {
    const oiiotoolPath = resolveOiiotoolPath();
    const artifactId = randomUUID();
    const artifactsDir = this.artifactsDir(openLibrary);
    mkdirSync(artifactsDir, { recursive: true });
    const artifactRelPath = `${artifactId}.png`;
    const artifactAbsPath = path.join(artifactsDir, artifactRelPath);

    try {
      const exposureStops = Number.isFinite(options.exposureStops)
        ? Math.max(-10, Math.min(10, options.exposureStops ?? 0))
        : 0;
      const exposureMultiplier = 2 ** exposureStops;
      const inputColorSpace = options.inputColorSpace?.trim()
        || DEFAULT_OIIO_INPUT_COLOR_SPACE;
      const exposureValues = [
        exposureMultiplier,
        exposureMultiplier,
        exposureMultiplier,
        1,
      ].join(',');

      // OpenImageIO 3.1's ociodisplay action accepts OCIO built-in config URIs,
      // explicit input roles, and "default" display/view selectors. Keep the
      // exposure multiplier in the command even at zero stops so a future
      // preview control can regenerate a deterministic variant through this
      // existing parameter seam.
      const args: string[] = [
        '--colorconfig', SERPENT_OCIO_CONFIG,
        assetPath,
        '--iscolorspace', inputColorSpace,
        // Preserve alpha while applying exposure to RGB color channels.
        '--mulc', exposureValues,
        // Empty display/view select the OCIO config defaults. Literal "default"
        // would instead request names that the selected config may not define.
        `--ociodisplay:from=${inputColorSpace}:unpremult=1`, '', '',
        '--resize', '0x512',
        '-o', artifactAbsPath,
      ];

      const result = await this.runOiio(oiiotoolPath, args, {
        timeoutMs: 60_000,
        signal: execution.signal,
      });

      if (result.exitCode !== 0) {
        throw new OiioInvocationError(
          'OIIO_COLOR_TRANSFORM_FAILED',
          `oiiotool OCIO display transform exited with code ${result.exitCode}: ${result.stderr.slice(-8192)}`,
        );
      }

      const outputStat = statSync(artifactAbsPath);
      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              generator_version, status, generated_at)
           VALUES (?, ?, 'thumbnail', 'image/png', ?, ?, ?, 'ready', ?)`,
        )
        .run(artifactId, revisionId, outputStat.size, artifactRelPath,
          `oiio@${OIIO_VERSION};ocio=studio-v4-aces2;exposure=${exposureStops}`,
          new Date().toISOString());

      this.options.onAssetsChanged?.({
        type: 'asset.changed',
        libraryId: input.libraryId,
        changedCount: 1,
        missingCount: 0,
      });

      return { artifactId };
    } catch (error) {
      const errorCode: OiioArtifactErrorCode = isMissingPathError(error)
        ? 'OIIO_REQUIRED'
        : error instanceof OiioInvocationError
          ? error.artifactErrorCode
          : 'OIIO_GENERATION_FAILED';

      this.diagnose('oiio.thumbnail', error, {
        libraryId: input.libraryId,
        assetId: input.assetId,
        extension: path.extname(assetPath).toLowerCase(),
        errorCode,
        ocioConfig: SERPENT_OCIO_CONFIG,
      });

      openLibrary.connection
        .prepare(
          `INSERT INTO revision_artifacts
             (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
              generator_version, status, error_code, generated_at)
           VALUES (?, ?, 'thumbnail', 'image/png', 0, ?, ?, 'failed', ?, ?)`,
        )
        .run(
          artifactId, revisionId, artifactRelPath,
          `oiio@${OIIO_VERSION};ocio=studio-v4-aces2`, errorCode,
          new Date().toISOString(),
        );

      throw new LibraryServiceError('INTERNAL_ERROR', {
        cause: error,
        reason: errorCode === 'OIIO_REQUIRED' ? 'OIIO_REQUIRED' : 'MEDIA_PROCESSING_FAILED',
      });
    }
  }

  /** Write a failed revision_artifact row. Used across video and OIIO paths. */
  private writeFailedArtifact(
    openLibrary: OpenLibrary,
    artifactId: string,
    revisionId: string,
    kind: string,
    mimeType: string,
    filePath: string,
    generatorVersion: string,
    error: unknown,
  ): void {
    let errorCode: string;
    if (isMissingPathError(error) || (typeof error === 'object' && error !== null && 'code' in error && (error as Record<string, unknown>).code === 'ENOENT')) {
      errorCode = kind === 'extracted_metadata' || kind === 'video_poster' || kind === 'contact_sheet' || kind === 'webm_proxy'
        ? 'FFMPEG_REQUIRED' : 'OIIO_REQUIRED';
    } else if (typeof error === 'object' && error !== null && 'code' in error) {
      errorCode = String((error as Record<string, unknown>).code);
    } else {
      errorCode = `${kind.toUpperCase()}_GENERATION_FAILED`;
    }
    openLibrary.connection
      .prepare(
        `INSERT INTO revision_artifacts
           (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
            generator_version, status, error_code, generated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, 'failed', ?, ?)`,
      )
      .run(artifactId, revisionId, kind, mimeType, filePath, generatorVersion, errorCode, new Date().toISOString());
  }

  /** Return the current (invalidated_at IS NULL) thumbnail artifact for an asset's current revision. */
  getThumbnailArtifact(
    libraryId: string,
    assetId: string,
  ): {
    artifactId: string;
    filePath: string;
    width: number | null;
    height: number | null;
  } | null {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const assetRow = openLibrary.connection
      .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
      .get(assetId) as { current_revision_id: string | null } | undefined;
    if (!assetRow?.current_revision_id) return null;

    const row = openLibrary.connection
      .prepare(
        `SELECT artifact_id, file_path, width, height
           FROM revision_artifacts
          WHERE revision_id = ?
            AND kind = 'thumbnail'
            AND status = 'ready'
            AND invalidated_at IS NULL
          LIMIT 1`,
      )
      .get(assetRow.current_revision_id) as {
        artifact_id: string;
        file_path: string;
        width: number | null;
        height: number | null;
      } | undefined;

    return row
      ? {
          artifactId: row.artifact_id,
          filePath: row.file_path,
          width: row.width,
          height: row.height,
        }
      : null;
  }

  /**
   * Return the current (invalidated_at IS NULL) artifact of a given kind
   * for an asset's current revision. Returns null if none exists.
   * Unlike getThumbnailArtifact, this also returns the raw status so
   * callers can distinguish ready vs failed artifacts.
   */
  getCurrentArtifact(
    libraryId: string,
    assetId: string,
    kind: string,
  ): { artifactId: string; filePath: string; mimeType: string; status: string; errorCode: string | null } | null {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const assetRow = openLibrary.connection
      .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
      .get(assetId) as { current_revision_id: string | null } | undefined;
    if (!assetRow?.current_revision_id) return null;

    const row = openLibrary.connection
      .prepare(
        `SELECT artifact_id, file_path, mime_type, status, error_code
           FROM revision_artifacts
          WHERE revision_id = ?
            AND kind = ?
            AND invalidated_at IS NULL
          LIMIT 1`,
      )
      .get(assetRow.current_revision_id, kind) as {
        artifact_id: string;
        file_path: string;
        mime_type: string;
        status: string;
        error_code: string | null;
      } | undefined;

    return row
      ? {
          artifactId: row.artifact_id,
          filePath: row.file_path,
          mimeType: row.mime_type,
          status: row.status,
          errorCode: row.error_code,
        }
      : null;
  }

  /**
   * Resolve the renderer-safe preview state for an asset. The renderer receives
   * only an opaque artifact id; absolute and library-relative paths stay in the
   * Worker/Main boundary.
   */
  getPreviewArtifact(
    libraryId: string,
    assetId: string,
  ): {
    mediaType: 'image' | 'video' | 'audio' | 'text' | 'other';
    status: 'ready' | 'pending' | 'failed' | 'missing';
    kind: 'thumbnail' | 'webm_proxy';
    artifactId?: string;
    mimeType: string;
    errorCode?: string;
    posterArtifactId?: string;
    playbackMode?: 'source' | 'proxy';
    sourceRevisionId?: string;
    sourceMimeType?: string;
    sourceContainer?: 'mp4' | 'mov' | 'webm';
    sourceCodecs?: string[];
  } {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const asset = openLibrary.connection
      .prepare(
        `SELECT relative_file_path, current_revision_id, availability
           FROM assets
          WHERE asset_id = ? AND deleted_at IS NULL`,
      )
      .get(assetId) as { relative_file_path: string; current_revision_id: string; availability: 'available' | 'missing' } | undefined;
    if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
    if (asset.availability === 'missing') {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }

    const mediaType = LibraryService.detectMediaType(asset.relative_file_path);
    const kind = mediaType === 'video' ? 'webm_proxy' : 'thumbnail';
    const mimeType = mediaType === 'video'
      ? 'video/webm'
      : mediaType === 'audio'
        ? 'audio/mpeg'
        : mediaType === 'text'
          ? 'text/plain'
        : 'image/webp';
    if (mediaType === 'other') {
      return {
        mediaType,
        status: 'missing',
        kind,
        mimeType,
        errorCode: 'UNSUPPORTED_FORMAT',
      };
    }

    // Text assets are previewed via capped IPC (asset.text.read), not serpent://.
    // Still mark ready so the viewer can open without a thumbnail job.
    if (mediaType === 'text' && asset.current_revision_id) {
      const extension = path.extname(asset.relative_file_path).toLowerCase();
      const textMime = textMimeForExtension(extension) ?? 'text/plain';
      return {
        mediaType,
        status: 'ready',
        kind,
        mimeType: textMime,
        playbackMode: 'source',
        sourceRevisionId: asset.current_revision_id,
        sourceMimeType: textMime,
      };
    }

    const extension = path.extname(asset.relative_file_path).toLowerCase();
    const nativeMimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.oga': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      '.opus': 'audio/ogg',
    };
    const nativeMimeType = nativeMimeTypes[extension];
    // Audio: viewer uses wide `video_poster` strip; fall back to 4:3 thumbnail
    // until cover6 regeneration lands (Serpent-vlx).
    const poster = mediaType === 'video'
      ? this.getCurrentArtifact(libraryId, assetId, 'video_poster')
      : mediaType === 'audio'
        ? (this.getCurrentArtifact(libraryId, assetId, 'video_poster')
          ?? this.getCurrentArtifact(libraryId, assetId, 'thumbnail'))
      : null;
    const posterArtifactId = poster?.status === 'ready' ? poster.artifactId : undefined;
    const artifact = this.getCurrentArtifact(libraryId, assetId, kind);
    if (artifact) {
      const status = artifact.status === 'generating' ? 'pending' : artifact.status;
      // Prefer a ready derivative, except native images always use the original
      // (REQ-VIEW-002: uncompressed source in the viewer). Audio always plays
      // the source; waveform thumbnail is exposed via posterArtifactId.
      if (
        status === 'ready' &&
        !(mediaType === 'image' && nativeMimeType) &&
        mediaType !== 'audio'
      ) {
        return {
          mediaType,
          status,
          kind,
          artifactId: artifact.artifactId,
          mimeType: artifact.mimeType,
          ...(mediaType === 'video' ? { playbackMode: 'proxy' as const } : {}),
          ...(posterArtifactId ? { posterArtifactId } : {}),
        };
      }
      // Non-native formats have no Chromium-playable source: surface derivative
      // pending/failed. Native formats fall through to source below.
      if (!nativeMimeType) {
        if (status === 'failed') {
          return {
            mediaType,
            status,
            kind,
            artifactId: artifact.artifactId,
            mimeType: artifact.mimeType,
            errorCode: artifact.errorCode ?? 'MEDIA_PROCESSING_FAILED',
            ...(posterArtifactId ? { posterArtifactId } : {}),
          };
        }
        return {
          mediaType,
          status: 'pending',
          kind,
          artifactId: artifact.artifactId,
          mimeType: artifact.mimeType,
          ...(posterArtifactId ? { posterArtifactId } : {}),
        };
      }
    }

    // Browsing the original and generating derivatives are independent. Native
    // Chromium formats remain immediately viewable while thumbnail/proxy work
    // is queued, running, paused, or has failed.
    if (nativeMimeType && asset.current_revision_id) {
        let sourceCodecs: string[] = [];
        const metadataArtifact = mediaType === 'video'
          ? this.getCurrentArtifact(libraryId, assetId, 'extracted_metadata')
          : null;
        if (mediaType === 'video' && metadataArtifact?.status === 'ready') {
          try {
            const descriptor = JSON.parse(
              readFileSync(path.join(this.artifactsDir(openLibrary), metadataArtifact.filePath), 'utf-8'),
            ) as { videoCodec?: string | null; audioCodec?: string | null };
            const videoCodec = descriptor.videoCodec === 'h264' ? 'avc1.42E01E'
              : descriptor.videoCodec === 'vp9' ? 'vp09.00.10.08'
              : descriptor.videoCodec ?? undefined;
            const audioCodec = descriptor.audioCodec === 'aac' ? 'mp4a.40.2'
              : descriptor.audioCodec === 'opus' ? 'opus'
              : descriptor.audioCodec ?? undefined;
            sourceCodecs = [videoCodec, audioCodec].filter((codec): codec is string => Boolean(codec));
          } catch {
            // The base container MIME remains a valid conservative descriptor.
          }
        }
        return {
          mediaType,
          status: 'ready',
          kind,
          mimeType: nativeMimeType,
          ...(mediaType === 'video' &&
          (artifact?.status === 'failed' || poster?.status === 'failed')
            ? {
                errorCode:
                  (artifact?.status === 'failed'
                    ? artifact.errorCode
                    : poster?.errorCode) ?? 'MEDIA_PROCESSING_FAILED',
              }
            : {}),
          ...(posterArtifactId ? { posterArtifactId } : {}),
          playbackMode: 'source',
          sourceRevisionId: asset.current_revision_id,
          sourceMimeType: nativeMimeType,
          ...(mediaType === 'video'
            ? {
                sourceContainer: extension.slice(1) as 'mp4' | 'mov' | 'webm',
                ...(sourceCodecs.length > 0 ? { sourceCodecs } : {}),
              }
            : {}),
        };
    }

    const activeJob = openLibrary.connection
      .prepare(
        `SELECT status
           FROM jobs
          WHERE asset_id = ?
            AND kind IN ('generate_thumbnail', 'generate_webm_proxy')
            AND status IN ('queued', 'running', 'paused')
          ORDER BY updated_at DESC
          LIMIT 1`,
      )
      .get(assetId) as { status: 'queued' | 'running' | 'paused' } | undefined;
    if (activeJob) {
      return {
        mediaType,
        status: 'pending',
        kind,
        mimeType,
        ...(posterArtifactId ? { posterArtifactId } : {}),
      };
    }
    if (mediaType === 'video' && poster?.status === 'failed') {
      return {
        mediaType,
        status: 'failed',
        kind,
        mimeType,
        errorCode: poster.errorCode ?? 'MEDIA_PROCESSING_FAILED',
      };
    }

    return {
      mediaType,
      status: 'missing',
      kind,
      mimeType,
      ...(posterArtifactId ? { posterArtifactId } : {}),
    };
  }

  /** Queue an artifact retry and return before any decoder subprocess starts. */
  enqueueArtifactRetry(input: {
    libraryId: string;
    assetId: string;
    kind: 'thumbnail' | 'webm_proxy';
  }): string {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const asset = openLibrary.connection
      .prepare(
        `SELECT relative_file_path, current_revision_id, availability
           FROM assets
          WHERE asset_id = ? AND deleted_at IS NULL`,
      )
      .get(input.assetId) as {
        relative_file_path: string;
        current_revision_id: string | null;
        availability: 'available' | 'missing';
      } | undefined;
    if (!asset?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
    if (asset.availability !== 'available') {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }
    const expectedKind = LibraryService.detectMediaType(asset.relative_file_path) === 'video'
      ? 'webm_proxy'
      : 'thumbnail';
    if (input.kind !== expectedKind) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION', { reason: 'UNSUPPORTED_FORMAT' });
    }
    const jobKind = input.kind === 'webm_proxy' ? 'generate_webm_proxy' : 'generate_thumbnail';

    return openLibrary.connection.transaction(() => {
      const active = openLibrary.connection
        .prepare(
          `SELECT job_id
             FROM jobs
            WHERE asset_id = ?
              AND kind = ?
              AND status IN ('queued', 'running', 'paused')
            ORDER BY updated_at DESC
            LIMIT 1`,
        )
        .get(input.assetId, jobKind) as { job_id: string } | undefined;
      if (active) {
        openLibrary.connection.prepare(
          'UPDATE jobs SET priority = MAX(priority, 300), updated_at = ? WHERE job_id = ?',
        ).run(new Date().toISOString(), active.job_id);
        return active.job_id;
      }

      if (input.kind === 'webm_proxy') {
        openLibrary.connection.prepare(
          `UPDATE revision_artifacts SET invalidated_at = ?
            WHERE revision_id = ? AND kind = 'webm_proxy' AND invalidated_at IS NULL`,
        ).run(new Date().toISOString(), asset.current_revision_id);
      }

      const jobId = randomUUID();
      const now = new Date().toISOString();
      openLibrary.connection
        .prepare(
          `INSERT INTO jobs
             (job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
              attempt_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'queued', 300, 0.0, 0, ?, ?)`,
        )
        .run(jobId, input.libraryId, input.assetId, asset.current_revision_id, jobKind, now, now);
      return jobId;
    })();
  }

  /** Get the absolute filesystem path for an artifact. */
  getArtifactAbsolutePath(
    libraryId: string,
    artifactId: string,
    usage?: 'preview' | 'proxy',
  ): string {
    const openLibrary = this.requireOpenLibrary(libraryId);
    // The join against the asset's current revision is the serving boundary:
    // permanently deleted assets lose their row and stop resolving here, while
    // trashed assets keep resolving so the trash scope can show a decodable
    // preview (the derived artifact is not moved or invalidated by trashing).
    const row = openLibrary.connection
      .prepare(
        `SELECT ra.artifact_id, ra.file_path, ra.kind
           FROM revision_artifacts ra
           JOIN assets a ON a.current_revision_id = ra.revision_id
          WHERE ra.artifact_id = ?
            AND ra.status = 'ready'
            AND ra.invalidated_at IS NULL`,
      )
      .get(artifactId) as { artifact_id: string; file_path: string; kind: string } | undefined;
    if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
    if (usage) {
      const allowedKinds = usage === 'proxy'
        ? new Set(['webm_proxy'])
        : new Set(['thumbnail', 'video_poster']);
      if (!allowedKinds.has(row.kind)) throw new LibraryServiceError('ASSET_NOT_FOUND');
    }

    const artifactsDir = this.artifactsDir(openLibrary);
    let artifactsRoot: string;
    try {
      const rootEntry = lstatSync(artifactsDir);
      if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
        throw new LibraryServiceError('INVALID_LIBRARY_PATH');
      }
      artifactsRoot = realpathSync(artifactsDir);
    } catch (error) {
      if (error instanceof LibraryServiceError) throw error;
      throw new LibraryServiceError('INVALID_LIBRARY_PATH', { cause: error });
    }
    const targetPath = path.resolve(artifactsRoot, ...row.file_path.split('/'));
    const relation = path.relative(artifactsRoot, targetPath);
    if (
      relation === '' ||
      relation.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relation)
    ) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    try {
      const targetEntry = lstatSync(targetPath);
      if (!targetEntry.isFile() || targetEntry.isSymbolicLink()) {
        throw new LibraryServiceError('INVALID_LIBRARY_PATH');
      }
      const realTarget = realpathSync(targetPath);
      const realRelation = path.relative(artifactsRoot, realTarget);
      if (
        realRelation === '' ||
        realRelation.startsWith(`..${path.sep}`) ||
        path.isAbsolute(realRelation)
      ) {
        throw new LibraryServiceError('INVALID_LIBRARY_PATH');
      }
      return realTarget;
    } catch (error) {
      if (error instanceof LibraryServiceError) throw error;
      throw new LibraryServiceError('ASSET_NOT_FOUND', { cause: error });
    }
  }

  getCurrentMediaSource(
    libraryId: string,
    assetId: string,
    revisionId: string,
  ): { absolutePath: string; mimeType: string } {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const asset = openLibrary.connection.prepare(
      `SELECT relative_file_path, current_revision_id, availability, deleted_at
         FROM assets WHERE asset_id = ?`,
    ).get(assetId) as {
      relative_file_path: string;
      current_revision_id: string | null;
      availability: 'available' | 'missing';
      deleted_at: string | null;
    } | undefined;
    if (!asset || asset.deleted_at || asset.availability !== 'available') {
      throw new LibraryServiceError('ASSET_NOT_FOUND');
    }
    if (asset.current_revision_id !== revisionId) {
      throw new LibraryServiceError('ASSET_NOT_FOUND');
    }
    const extension = path.extname(asset.relative_file_path).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.wmv': 'video/x-ms-wmv',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.oga': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      '.opus': 'audio/ogg',
    };
    const mimeType = mimeTypes[extension] ?? audioMimeForExtension(extension) ?? undefined;
    if (!mimeType) throw new LibraryServiceError('INVALID_IMPORT_DECISION', { reason: 'UNSUPPORTED_FORMAT' });
    return { absolutePath: this.resolveAssetPath(libraryId, assetId), mimeType };
  }

  /** @deprecated Use getCurrentMediaSource; kept for protocol and test compatibility. */
  getCurrentVideoSource(
    libraryId: string,
    assetId: string,
    revisionId: string,
  ): { absolutePath: string; mimeType: string } {
    return this.getCurrentMediaSource(libraryId, assetId, revisionId);
  }

  private enqueueReadyPaletteJobs(
    openLibrary: OpenLibrary,
    options: { assetIds?: string[]; limit?: number; priority?: number },
  ): number {
    const selectedIds = [...new Set(options.assetIds ?? [])].slice(0, 500);
    if (options.assetIds && selectedIds.length === 0) return 0;
    const selectedSql = selectedIds.length > 0
      ? `AND a.asset_id IN (${selectedIds.map(() => '?').join(',')})`
      : '';
    const limit = options.limit === undefined
      ? 500
      : Math.max(0, Math.min(500, Math.trunc(options.limit)));
    if (limit === 0) return 0;
    const rows = openLibrary.connection.prepare(
      `SELECT a.asset_id, a.current_revision_id
         FROM assets a
        WHERE a.deleted_at IS NULL
          AND a.availability = 'available'
          AND a.current_revision_id IS NOT NULL
          ${selectedSql}
          AND EXISTS (
            SELECT 1 FROM revision_artifacts source
             WHERE source.revision_id = a.current_revision_id
               AND source.kind IN ('thumbnail', 'video_poster')
               AND source.status = 'ready'
               AND source.invalidated_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM revision_artifacts palette
             WHERE palette.revision_id = a.current_revision_id
               AND palette.kind = 'extracted_palette'
               AND palette.status IN ('ready', 'failed')
               AND palette.invalidated_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM jobs job
             WHERE job.asset_id = a.asset_id
               AND job.revision_id = a.current_revision_id
               AND job.kind = 'extract_palette'
               AND job.status IN ('queued', 'running', 'paused')
          )
        ORDER BY a.relative_file_path
        LIMIT ?`,
    ).all(...selectedIds, limit) as Array<{
      asset_id: string;
      current_revision_id: string;
    }>;
    let enqueued = 0;
    for (const row of rows) {
      if (this.enqueuePaletteJob(
        openLibrary,
        row.asset_id,
        row.current_revision_id,
        options.priority ?? -10,
      )) enqueued += 1;
    }
    return enqueued;
  }

  /**
   * Invalidate ready artifacts whose files are missing under `.serpent/artifacts`.
   * Used after import/open when an older export omitted the artifacts tree while
   * the DB still recorded status=ready (Serpent-pxd).
   */
  private reconcileMissingArtifactFiles(openLibrary: OpenLibrary): number {
    const artifactsDir = this.artifactsDir(openLibrary);
    let artifactsRoot: string;
    try {
      const rootEntry = lstatSync(artifactsDir);
      if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) return 0;
      artifactsRoot = realpathSync(artifactsDir);
    } catch {
      return 0;
    }

    const rows = openLibrary.connection
      .prepare(
        `SELECT ra.artifact_id, ra.file_path
           FROM revision_artifacts ra
           JOIN assets a ON a.current_revision_id = ra.revision_id
          WHERE ra.status = 'ready'
            AND ra.invalidated_at IS NULL
            AND a.deleted_at IS NULL`,
      )
      .all() as Array<{ artifact_id: string; file_path: string }>;
    if (rows.length === 0) return 0;

    const now = new Date().toISOString();
    const invalidate = openLibrary.connection.prepare(
      `UPDATE revision_artifacts
          SET invalidated_at = ?
        WHERE artifact_id = ?
          AND invalidated_at IS NULL`,
    );

    const artifactFilePresent = (filePath: string): boolean => {
      // Same containment rules as getArtifactAbsolutePath — escape / symlink → treat missing.
      const targetPath = path.resolve(artifactsRoot, ...filePath.split('/'));
      const relation = path.relative(artifactsRoot, targetPath);
      if (
        relation === '' ||
        relation.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relation)
      ) {
        return false;
      }
      try {
        const targetEntry = lstatSync(targetPath);
        if (!targetEntry.isFile() || targetEntry.isSymbolicLink()) return false;
        const realTarget = realpathSync(targetPath);
        const realRelation = path.relative(artifactsRoot, realTarget);
        if (
          realRelation === '' ||
          realRelation.startsWith(`..${path.sep}`) ||
          path.isAbsolute(realRelation)
        ) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    };

    let invalidated = 0;
    openLibrary.connection.transaction(() => {
      for (const row of rows) {
        if (artifactFilePresent(row.file_path)) continue;
        invalidate.run(now, row.artifact_id);
        invalidated += 1;
      }
    })();
    return invalidated;
  }

  /**
   * Find component-related failures that are eligible for one automatic
   * repair wave. Other failures (corrupt input, unsupported codecs, missing
   * source files, and so on) remain terminal until the user explicitly retries.
   */
  private availableAutoRepairComponents(
    openLibrary: OpenLibrary,
  ): Set<MediaAutoRepairComponent> {
    const rows = openLibrary.connection
      .prepare(
        `SELECT DISTINCT ra.error_code
           FROM revision_artifacts ra
           JOIN assets a ON a.current_revision_id = ra.revision_id
          WHERE a.deleted_at IS NULL
            AND a.availability = 'available'
            AND ra.kind IN ('thumbnail', 'video_poster')
            AND ra.status = 'failed'
            AND ra.invalidated_at IS NULL
            AND ra.error_code IN ('FFMPEG_REQUIRED', 'OIIO_REQUIRED')`,
      )
      .all() as Array<{ error_code: string }>;
    if (rows.length === 0) return new Set();

    const needed = new Set<MediaAutoRepairComponent>();
    for (const row of rows) {
      if (row.error_code === 'FFMPEG_REQUIRED') needed.add('ffmpeg');
      if (row.error_code === 'OIIO_REQUIRED') needed.add('oiio');
    }
    const attempted = this.autoRepairAttemptedByLibrary.get(
      openLibrary.summary.libraryId,
    ) ?? new Set<MediaAutoRepairComponent>();
    const failedProbes = this.autoRepairProbeFailedAtByLibrary.get(
      openLibrary.summary.libraryId,
    ) ?? new Map<MediaAutoRepairComponent, number>();
    const now = Date.now();
    const available = new Set<MediaAutoRepairComponent>();
    for (const component of needed) {
      if (attempted.has(component)) continue;
      const failedAt = failedProbes.get(component);
      if (failedAt !== undefined && now - failedAt < MEDIA_COMPONENT_PROBE_RETRY_MS) {
        continue;
      }
      if (this.mediaComponentAvailable(component)) {
        failedProbes.delete(component);
        available.add(component);
      } else {
        failedProbes.set(component, now);
      }
    }
    if (failedProbes.size > 0) {
      this.autoRepairProbeFailedAtByLibrary.set(
        openLibrary.summary.libraryId,
        failedProbes,
      );
    }
    return available;
  }

  /**
   * Requeue every current preview whose failure was specifically caused by a
   * missing external component. This is separate from the normal bounded
   * startup scan so a library with many old failures can repair them all while
   * normal missing-thumbnail work remains bounded.
   */
  private enqueueFailedMediaRepairs(
    openLibrary: OpenLibrary,
    components: Set<MediaAutoRepairComponent>,
    priority: number,
  ): number {
    const failureConditions: string[] = [];
    if (components.has('ffmpeg')) failureConditions.push("ra.error_code = 'FFMPEG_REQUIRED'");
    if (components.has('oiio')) failureConditions.push("ra.error_code = 'OIIO_REQUIRED'");
    if (failureConditions.length === 0) return 0;

    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.current_revision_id
           FROM assets a
           JOIN revision_artifacts ra ON ra.revision_id = a.current_revision_id
          WHERE a.deleted_at IS NULL
            AND a.availability = 'available'
            AND a.current_revision_id IS NOT NULL
            AND ra.kind IN ('thumbnail', 'video_poster')
            AND ra.status = 'failed'
            AND ra.invalidated_at IS NULL
            AND (${failureConditions.join(' OR ')})
            AND NOT EXISTS (
              SELECT 1
                FROM jobs active
               WHERE active.asset_id = a.asset_id
                 AND active.revision_id = a.current_revision_id
                 AND active.kind = 'generate_thumbnail'
                 AND active.status IN ('queued', 'running', 'paused')
            )
          GROUP BY a.asset_id, a.current_revision_id
          ORDER BY a.relative_file_path`,
      )
      .all() as Array<{ asset_id: string; current_revision_id: string }>;
    if (rows.length === 0) return 0;

    const now = new Date().toISOString();
    const findFailedJob = openLibrary.connection.prepare(
      `SELECT job_id
         FROM jobs
        WHERE asset_id = ?
          AND revision_id = ?
          AND kind = 'generate_thumbnail'
          AND status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 1`,
    );
    const resetFailedJob = openLibrary.connection.prepare(
      `UPDATE jobs
          SET status = 'queued',
              priority = MAX(priority, ?),
              progress = 0.0,
              attempt_count = 0,
              error_code = NULL,
              error_detail = NULL,
              updated_at = ?
        WHERE job_id = ?`,
    );
    const insertJob = openLibrary.connection.prepare(
      `INSERT INTO jobs
         (job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
          attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', ?, 0.0, 0, ?, ?)`,
    );

    let enqueued = 0;
    openLibrary.connection.transaction(() => {
      for (const row of rows) {
        const failedJob = findFailedJob.get(
          row.asset_id,
          row.current_revision_id,
        ) as { job_id: string } | undefined;
        if (failedJob) {
          enqueued += resetFailedJob.run(priority, now, failedJob.job_id).changes;
        } else {
          enqueued += insertJob.run(
            randomUUID(),
            openLibrary.summary.libraryId,
            row.asset_id,
            row.current_revision_id,
            priority,
            now,
            now,
          ).changes;
        }
      }
    })();
    return enqueued;
  }

  /**
   * Enqueue thumbnail jobs for supported assets whose current revision has no
   * terminal artifact. Callers may pass the currently visible asset ids and a
   * limit so opening a large library never materializes or queues the whole
   * catalogue at once.
   */
  enqueueThumbnailJobs(
    libraryId: string,
    options: {
      assetIds?: string[];
      limit?: number;
      priority?: number;
      repairFailed?: boolean;
    } = {},
  ): number {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const selectedIds = [...new Set(options.assetIds ?? [])].slice(0, 500);
    const limit = options.limit === undefined
      ? undefined
      : Math.max(0, Math.min(500, Math.trunc(options.limit)));
    if (limit === 0 || (options.assetIds && selectedIds.length === 0)) return 0;
    const repairComponents = options.repairFailed
      ? this.availableAutoRepairComponents(openLibrary)
      : new Set<MediaAutoRepairComponent>();
    const repairEnqueued = options.repairFailed
      ? this.enqueueFailedMediaRepairs(
        openLibrary,
        repairComponents,
        options.priority ?? 0,
      )
      : 0;
    if (options.repairFailed && repairComponents.size > 0) {
      this.diagnose(
        'media-auto-repair.enqueued',
        new Error('Automatic media repair wave evaluated.'),
        {
          libraryId,
          components: [...repairComponents],
          enqueuedCount: repairEnqueued,
        },
      );
    }
    if (repairComponents.size > 0) {
      const attempted = this.autoRepairAttemptedByLibrary.get(libraryId)
        ?? new Set<MediaAutoRepairComponent>();
      for (const component of repairComponents) attempted.add(component);
      this.autoRepairAttemptedByLibrary.set(libraryId, attempted);
    }
    let enqueued = repairEnqueued;
    const supportedExtensions = [
      'png', 'jpg', 'jpeg', 'gif', 'tiff', 'tif', 'webp', 'bmp',
      'mp4', 'webm', 'mov', 'avi', 'wmv', 'exr', 'tga',
      ...AUDIO_EXTENSION_NAMES,
    ];
    // CU-D7: invalidate pre-gifstill GIF thumbs so page-0 black frames requeue.
    const nowInvalidate = new Date().toISOString();
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE kind = 'thumbnail'
            AND status = 'ready'
            AND invalidated_at IS NULL
            AND generator_version NOT LIKE '%gifstill%'
            AND revision_id IN (
              SELECT current_revision_id FROM assets
               WHERE deleted_at IS NULL
                 AND current_revision_id IS NOT NULL
                 AND LOWER(relative_file_path) LIKE '%.gif'
            )`,
      )
      .run(nowInvalidate);
    // Serpent-dxk / vlx: requeue stale audio covers + missing/stale viewer strips.
    const audioExtensionSql = AUDIO_EXTENSION_NAMES
      .map(() => 'LOWER(a.relative_file_path) LIKE ?')
      .join(' OR ');
    const audioExtensionParams = AUDIO_EXTENSION_NAMES.map(
      (extension) => `%.${extension}`,
    );
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE kind IN ('thumbnail', 'video_poster')
            AND status = 'ready'
            AND invalidated_at IS NULL
            AND generator_version NOT LIKE ?
            AND revision_id IN (
              SELECT a.current_revision_id FROM assets a
               WHERE a.deleted_at IS NULL
                 AND a.current_revision_id IS NOT NULL
                 AND (${audioExtensionSql})
            )`,
      )
      .run(
        nowInvalidate,
        `%${AUDIO_WAVEFORM_COVER_GENERATOR_TAG}%`,
        ...audioExtensionParams,
      );
    // Thumbnail ready but no viewer strip yet → invalidate thumb so both regenerate.
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE kind = 'thumbnail'
            AND status = 'ready'
            AND invalidated_at IS NULL
            AND revision_id IN (
              SELECT a.current_revision_id FROM assets a
               WHERE a.deleted_at IS NULL
                 AND a.current_revision_id IS NOT NULL
                 AND (${audioExtensionSql})
                 AND NOT EXISTS (
                   SELECT 1 FROM revision_artifacts poster
                    WHERE poster.revision_id = a.current_revision_id
                      AND poster.kind = 'video_poster'
                      AND poster.status = 'ready'
                      AND poster.invalidated_at IS NULL
                 )
            )`,
      )
      .run(nowInvalidate, ...audioExtensionParams);
    // Serpent-051: viewer strip ready but no 4:3 grid cover → requeue.
    // Do not serve video_poster in the browse grid (wide aspect).
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE kind = 'video_poster'
            AND status = 'ready'
            AND invalidated_at IS NULL
            AND revision_id IN (
              SELECT a.current_revision_id FROM assets a
               WHERE a.deleted_at IS NULL
                 AND a.current_revision_id IS NOT NULL
                 AND (${audioExtensionSql})
                 AND NOT EXISTS (
                   SELECT 1 FROM revision_artifacts thumb
                    WHERE thumb.revision_id = a.current_revision_id
                      AND thumb.kind = 'thumbnail'
                      AND thumb.status = 'ready'
                      AND thumb.invalidated_at IS NULL
                 )
            )`,
      )
      .run(nowInvalidate, ...audioExtensionParams);
    // CU-D8: GIFs with a ready thumb but no duration/frame metadata requeue once.
    openLibrary.connection
      .prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE kind = 'thumbnail'
            AND status = 'ready'
            AND invalidated_at IS NULL
            AND revision_id IN (
              SELECT a.current_revision_id
                FROM assets a
               WHERE a.deleted_at IS NULL
                 AND a.current_revision_id IS NOT NULL
                 AND LOWER(a.relative_file_path) LIKE '%.gif'
                 AND NOT EXISTS (
                   SELECT 1 FROM revision_artifacts meta
                    WHERE meta.revision_id = a.current_revision_id
                      AND meta.kind = 'extracted_metadata'
                      AND meta.status = 'ready'
                      AND meta.invalidated_at IS NULL
                 )
            )`,
      )
      .run(nowInvalidate);
    const selectedSql = selectedIds.length > 0
      ? `AND a.asset_id IN (${selectedIds.map(() => '?').join(',')})`
      : '';
    const extensionSql = supportedExtensions
      .map(() => 'LOWER(a.relative_file_path) LIKE ?')
      .join(' OR ');
    const queryLimit = limit === undefined ? '' : 'LIMIT ?';
    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.current_revision_id
           FROM assets a
          WHERE a.deleted_at IS NULL
            AND a.current_revision_id IS NOT NULL
            AND a.availability = 'available'
            ${selectedSql}
            AND (${extensionSql})
            AND NOT EXISTS (
              SELECT 1 FROM revision_artifacts ra
              WHERE ra.revision_id = a.current_revision_id
                AND ra.kind IN ('thumbnail', 'video_poster')
                AND ra.status IN ('ready', 'failed')
                AND ra.invalidated_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM jobs j
              WHERE j.asset_id = a.asset_id
                AND j.kind = 'generate_thumbnail'
                AND j.status IN ('queued', 'running', 'paused')
            )
          ORDER BY a.relative_file_path
          ${queryLimit}`,
      )
      .all(
        ...selectedIds,
        ...supportedExtensions.map((extension) => `%.${extension}`),
        ...(limit === undefined ? [] : [limit]),
      ) as Array<{ asset_id: string; current_revision_id: string }>;

    const now = new Date().toISOString();
    const insert = openLibrary.connection.prepare(
      `INSERT OR IGNORE INTO jobs
         (job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
          attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', ?, 0.0, 0, ?, ?)`,
    );

    for (const row of rows) {
      const inserted = insert.run(
        randomUUID(), libraryId, row.asset_id, row.current_revision_id,
        options.priority ?? 0, now, now,
      );
      enqueued += inserted.changes;
    }

    // Existing ready thumbnails/posters (for example after reopening a library
    // created by an older build) receive their missing local palettes too.
    this.enqueueReadyPaletteJobs(openLibrary, options);

    return enqueued;
  }

  /**
   * Process queued thumbnail jobs one at a time. Returns the number of jobs
   * processed (success + failure + an in-flight pause/cancel).
   */
  async processThumbnailQueue(
    libraryId: string,
    options: {
      maxJobs?: number;
      onResult?: (result: {
        assetId: string;
        artifactId?: string;
        errorCode?: string;
      }) => void;
    } = {},
  ): Promise<number> {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const nextJob = openLibrary.connection.prepare(
      `SELECT job_id, asset_id, revision_id, kind, attempt_count
         FROM jobs
        WHERE library_id = ?
          AND kind IN ('generate_thumbnail', 'generate_video_poster',
                       'generate_contact_sheet', 'generate_webm_proxy',
                       'extract_palette')
          AND status = 'queued'
        ORDER BY priority DESC, created_at
        LIMIT 1`,
    );

    let processed = 0;
    const maxJobs = Math.max(1, Math.min(20, options.maxJobs ?? 20));
    while (processed < maxJobs) {
      const job = nextJob.get(libraryId) as {
        job_id: string;
        asset_id: string;
        revision_id: string;
        kind: MediaJobKind;
        attempt_count: number;
      } | undefined;
      if (!job) break;
      const now = new Date().toISOString();
      const claimed = openLibrary.connection
        .prepare(
          "UPDATE jobs SET status = 'running', attempt_count = ?, updated_at = ? WHERE job_id = ? AND status = 'queued'",
        )
        .run(job.attempt_count + 1, now, job.job_id);
      if (claimed.changes === 0) continue;

      const controller = new AbortController();
      this.activeMediaJobs.set(job.job_id, { controller, libraryId });
      const previousArtifacts = this.mediaArtifactSnapshot(openLibrary, job.revision_id);

      try {
        if (job.kind === 'generate_thumbnail' || job.kind === 'generate_video_poster') {
          const generated = await this.generateThumbnail(
            { libraryId, assetId: job.asset_id },
            { signal: controller.signal },
          );
          if (controller.signal.aborted || this.mediaJobState(libraryId, job.job_id) !== 'running') {
            this.discardLateMediaArtifacts(openLibrary, job.revision_id, previousArtifacts, {
              libraryId,
              jobId: job.job_id,
              assetId: job.asset_id,
            });
            processed += 1;
            continue;
          }
          const asset = openLibrary.connection.prepare(
            'SELECT relative_file_path FROM assets WHERE asset_id = ?',
          ).get(job.asset_id) as { relative_file_path: string } | undefined;
          if (asset && LibraryService.detectMediaType(asset.relative_file_path) === 'video') {
            this.enqueueVideoDerivativeJob(openLibrary, job.asset_id, job.revision_id, 'generate_contact_sheet', -100);
            const extension = path.extname(asset.relative_file_path).toLowerCase();
            if (extension === '.avi' || extension === '.wmv') {
              this.enqueueVideoDerivativeJob(openLibrary, job.asset_id, job.revision_id, 'generate_webm_proxy', 100);
            }
          }
          this.enqueuePaletteJob(openLibrary, job.asset_id, job.revision_id, -10);
          options.onResult?.({ assetId: job.asset_id, artifactId: generated.artifactId });
        } else if (job.kind === 'extract_palette') {
          const current = await this.generateQueuedPaletteArtifact(
            libraryId,
            job.asset_id,
            job.revision_id,
            { signal: controller.signal },
          );
          if (!current) {
            openLibrary.connection.prepare(
              "UPDATE jobs SET status = 'cancelled', error_code = 'STALE_REVISION', updated_at = ? WHERE job_id = ?",
            ).run(new Date().toISOString(), job.job_id);
            processed += 1;
            continue;
          }
        } else {
          const current = await this.generateQueuedVideoArtifact(
            libraryId, job.asset_id, job.revision_id, job.kind,
            { signal: controller.signal },
          );
          if (!current) {
            openLibrary.connection.prepare(
              "UPDATE jobs SET status = 'cancelled', error_code = 'STALE_REVISION', updated_at = ? WHERE job_id = ?",
            ).run(new Date().toISOString(), job.job_id);
            processed += 1;
            continue;
          }
        }
        if (controller.signal.aborted || this.mediaJobState(libraryId, job.job_id) !== 'running') {
          this.discardLateMediaArtifacts(openLibrary, job.revision_id, previousArtifacts, {
            libraryId,
            jobId: job.job_id,
            assetId: job.asset_id,
          });
          processed += 1;
          continue;
        }
        openLibrary.connection
          .prepare("UPDATE jobs SET status = 'succeeded', progress = 1.0, error_code = NULL, error_detail = NULL, updated_at = ? WHERE job_id = ? AND status = 'running'")
          .run(new Date().toISOString(), job.job_id);
      } catch (error) {
        const state = this.mediaJobState(libraryId, job.job_id);
        if (controller.signal.aborted || state === 'paused' || state === 'cancelled') {
          this.discardLateMediaArtifacts(openLibrary, job.revision_id, previousArtifacts, {
            libraryId,
            jobId: job.job_id,
            assetId: job.asset_id,
          });
          this.diagnose('media-job.interrupted', error, {
            libraryId,
            jobId: job.job_id,
            assetId: job.asset_id,
            kind: job.kind,
            status: state,
          });
          processed += 1;
          continue;
        }
        const failedKind = job.kind === 'extract_palette'
          ? 'extracted_palette'
          : job.kind === 'generate_contact_sheet'
            ? 'contact_sheet'
            : job.kind === 'generate_webm_proxy'
              ? 'webm_proxy'
              : null;
        const failedArtifact = openLibrary.connection
          .prepare(
            `SELECT error_code FROM revision_artifacts
              WHERE revision_id = ? AND invalidated_at IS NULL AND status = 'failed'
                AND (? IS NULL OR kind = ?)
              ORDER BY generated_at DESC LIMIT 1`,
          )
          .get(job.revision_id, failedKind, failedKind) as { error_code: string | null } | undefined;
        const errorCode = failedArtifact?.error_code
          ?? (job.kind === 'generate_thumbnail'
            ? 'THUMBNAIL_GENERATION_FAILED'
            : job.kind === 'extract_palette'
              ? 'PALETTE_EXTRACTION_FAILED'
              : 'MEDIA_PROCESSING_FAILED');
        openLibrary.connection
          .prepare(
            `UPDATE jobs
                SET status = 'failed', error_code = ?, error_detail = ?, updated_at = ?
              WHERE job_id = ? AND status = 'running'`,
          )
          .run(
            errorCode,
            safeMediaJobErrorDetail(errorCode),
            new Date().toISOString(),
            job.job_id,
          );
        this.diagnose('media-job.failed', error, {
          libraryId,
          jobId: job.job_id,
          assetId: job.asset_id,
          kind: job.kind,
          attemptCount: job.attempt_count + 1,
          errorCode,
        });
        if (job.kind === 'generate_thumbnail' || job.kind === 'generate_video_poster') {
          options.onResult?.({
            assetId: job.asset_id,
            errorCode,
          });
        }
      } finally {
        this.activeMediaJobs.delete(job.job_id);
      }
      processed += 1;
    }

    return processed;
  }

  /** Return current image-thumbnail or video-poster state for asset summaries. */
  private thumbnailArtifactMap(
    libraryId: string,
    assetIds: string[],
  ): Map<string, {
    status: 'ready' | 'pending' | 'failed' | null;
    artifactId: string | null;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  }> {
    const openLibrary = this.requireOpenLibrary(libraryId);
    if (assetIds.length === 0) return new Map();

    const placeholders = assetIds.map(() => '?').join(',');
    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, ra.status AS thumbnail_status,
                ra.artifact_id AS thumbnail_artifact_id,
                COALESCE(ra.width, video_meta.width) AS artifact_width,
                COALESCE(ra.height, video_meta.height) AS artifact_height,
                video_meta.duration_ms AS artifact_duration_ms
           FROM assets a
           LEFT JOIN revision_artifacts ra
             ON ra.revision_id = a.current_revision_id
            AND ra.kind = CASE
              WHEN LOWER(a.relative_file_path) LIKE '%.mp4'
                OR LOWER(a.relative_file_path) LIKE '%.webm'
                OR LOWER(a.relative_file_path) LIKE '%.mov'
                OR LOWER(a.relative_file_path) LIKE '%.avi'
                OR LOWER(a.relative_file_path) LIKE '%.wmv'
              THEN 'video_poster'
              ELSE 'thumbnail'
            END
            AND ra.invalidated_at IS NULL
           LEFT JOIN revision_artifacts video_meta
             ON video_meta.revision_id = a.current_revision_id
            AND video_meta.kind = 'extracted_metadata'
            AND video_meta.status = 'ready'
            AND video_meta.invalidated_at IS NULL
          WHERE a.asset_id IN (${placeholders})`,
      )
      .all(...assetIds) as Array<{
        asset_id: string;
        thumbnail_status: 'ready' | 'pending' | 'generating' | 'failed' | null;
        thumbnail_artifact_id: string | null;
        artifact_width: number | null;
        artifact_height: number | null;
        artifact_duration_ms: number | null;
      }>;

    const map = new Map<string, {
      status: 'ready' | 'pending' | 'failed' | null;
      artifactId: string | null;
      width: number | null;
      height: number | null;
      durationMs: number | null;
    }>();
    for (const row of rows) {
      const status = row.thumbnail_status === 'ready' ? 'ready'
        : row.thumbnail_status === 'failed' ? 'failed'
        : row.thumbnail_status === 'generating' || row.thumbnail_status === 'pending' ? 'pending'
        : null;
      map.set(row.asset_id, {
        status,
        artifactId: status === 'ready' ? row.thumbnail_artifact_id : null,
        width: row.artifact_width,
        height: row.artifact_height,
        durationMs: row.artifact_duration_ms,
      });
    }

    return map;
  }

  /** Return only statuses for callers that do not need artifact ids. */
  private thumbnailStatusMap(
    libraryId: string,
    assetIds: string[],
  ): Map<string, 'ready' | 'pending' | 'failed' | null> {
    return new Map(
      [...this.thumbnailArtifactMap(libraryId, assetIds)]
        .map(([assetId, artifact]) => [assetId, artifact.status]),
    );
  }

  // ── Search ──────────────────────────────────────────────────────────

  private buildFilterWhere(
    filters: FilterClause[],
  ): { sql: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    for (const filter of filters) {
      if ('ranges' in filter) {
        const width = 'COALESCE(duration_meta.width, technical_thumbnail.width)';
        const height = 'COALESCE(duration_meta.height, technical_thumbnail.height)';
        // long_edge (REQ-FILTER-010): resolution buckets are defined on the
        // longer side so portrait and landscape assets share one definition.
        // Both dimensions missing -> NULLIF(...,0) -> NULL, so positive
        // filters omit metadata-less assets like the other numeric fields.
        const longEdge =
          `NULLIF(MAX(COALESCE(${width}, 0), COALESCE(${height}, 0)), 0)`;
        const column = filter.field === 'width'
          ? width
          : filter.field === 'height'
            ? height
            : filter.field === 'duration_ms'
              ? 'duration_meta.duration_ms'
              : filter.field === 'long_edge'
                ? longEdge
                : `(CAST(${width} AS REAL) / NULLIF(${height}, 0))`;
        const rangeClauses = filter.ranges.map((range) => {
          const bounds: string[] = [];
          if (range.min !== undefined) {
            bounds.push(`${column} >= ?`);
            params.push(range.min);
          }
          if (range.max !== undefined) {
            bounds.push(`${column} <= ?`);
            params.push(range.max);
          }
          return `(${bounds.join(' AND ')})`;
        });
        const matchesAnyRange = `(${rangeClauses.join(' OR ')})`;
        // SQL comparisons with NULL evaluate to UNKNOWN. A positive technical
        // filter intentionally omits assets whose metadata has not been
        // extracted; an exclusion filter retains them because they do not
        // belong to the excluded numeric range.
        conditions.push(filter.exclude
          ? `(${column} IS NULL OR NOT ${matchesAnyRange})`
          : matchesAnyRange);
        continue;
      }
      // favorite + source_url are existence/boolean filters: they take no
      // values (the presence/absence IS the filter). Handle before the
      // empty-values skip so `values: []` does not silently drop them.
      if (filter.field === 'favorite') {
        conditions.push(
          filter.exclude ? `(COALESCE(m.favorite, 0) != 1)` : `(COALESCE(m.favorite, 0) = 1)`,
        );
        continue;
      }
      if (filter.field === 'source_url') {
        const hasUrl = `(m.source_page_url IS NOT NULL AND m.source_page_url != '')`;
        conditions.push(filter.exclude ? `(NOT ${hasUrl})` : `(${hasUrl})`);
        continue;
      }
      if (filter.values.length === 0) continue;

      switch (filter.field) {
        case 'format': {
          const formatValues = expandFormatFilterTokens(filter.values);
          if (formatValues.length === 0) break;
          const likes = formatValues.map(() => `LOWER(a.relative_file_path) LIKE ?`);
          const clause = filter.exclude
            ? `NOT (${likes.join(' OR ')})`
            : `(${likes.join(' OR ')})`;
          conditions.push(clause);
          for (const v of formatValues) {
            params.push(`%.${v.toLowerCase()}`);
          }
          break;
        }
        case 'tag': {
          // Match listTags: human + AI tags both count (Serpent-5cvr).
          const taggedAssetsSubquery = (nameParamCount: number) => {
            const phs = Array.from({ length: nameParamCount }, () => '?').join(',');
            return `SELECT hat.asset_id FROM human_asset_tags hat
                      JOIN tags t ON t.tag_id = hat.tag_id
                      WHERE t.name COLLATE NOCASE IN (${phs})
                    UNION
                    SELECT aat.asset_id FROM ai_asset_tags aat
                      JOIN tags t ON t.tag_id = aat.tag_id
                      WHERE t.name COLLATE NOCASE IN (${phs})`;
          };
          if (filter.exclude && filter.values.length > 1) {
            const notClauses = filter.values.map(
              () => `a.asset_id NOT IN (${taggedAssetsSubquery(1)})`,
            );
            conditions.push(`(${notClauses.join(' AND ')})`);
            for (const value of filter.values) {
              params.push(value, value);
            }
          } else if (filter.exclude) {
            conditions.push(
              `(a.asset_id NOT IN (${taggedAssetsSubquery(1)}))`,
            );
            params.push(filter.values[0]!, filter.values[0]!);
          } else {
            conditions.push(
              `(a.asset_id IN (${taggedAssetsSubquery(filter.values.length)}))`,
            );
            params.push(...filter.values, ...filter.values);
          }
          break;
        }
        case 'rating': {
          const phs = filter.values.map(() => '?').join(',');
          const clause = filter.exclude
            ? `COALESCE(m.rating, 0) NOT IN (${phs})`
            : `COALESCE(m.rating, 0) IN (${phs})`;
          conditions.push(`(${clause})`);
          for (const v of filter.values) {
            params.push(Number(v));
          }
          break;
        }
        case 'availability': {
          const phs = filter.values.map(() => '?').join(',');
          const clause = filter.exclude
            ? `a.availability NOT IN (${phs})`
            : `a.availability IN (${phs})`;
          conditions.push(`(${clause})`);
          params.push(...filter.values);
          break;
        }
        case 'color': {
          const ids = parseColorFilterIds(filter.values.join(','));
          const built = colorFilterSql(
            'palette_meta.dominant_hue',
            ids,
            filter.exclude,
          );
          if (!built) {
            conditions.push('1 = 0');
            break;
          }
          conditions.push(built.sql);
          params.push(...built.params);
          break;
        }
        default:
          // Unknown field: force no results.
          conditions.push('1 = 0');
      }
    }

    return { sql: conditions.length > 0 ? conditions.join(' AND ') : '', params };
  }

  searchAssets(input: {
    libraryId: string;
    query?: { clauses: SearchClause[] } | null;
    filters?: FilterClause[] | null;
    scope?: SearchScope | null;
    sort?: { field: string; order: 'asc' | 'desc' } | null;
    limit?: number | null;
    offset?: number | null;
  }): {
    items: AssetSummary[];
    total: number;
    offset: number;
    snippets?: Array<{ assetId: string; text: string }>;
  } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const connection = openLibrary.connection;
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;

    const hasQuery =
      input.query !== null &&
      input.query !== undefined &&
      input.query.clauses.length > 0;
    const hasPositiveQuery = hasQuery && input.query!.clauses.some((clause) => !clause.exclude);
    const isExcludeOnlyQuery = hasQuery && !hasPositiveQuery;
    const fts5Query = hasQuery
      ? buildFts5Query(isExcludeOnlyQuery
        ? input.query!.clauses.map((clause) => ({ ...clause, exclude: false }))
        : input.query!.clauses)
      : null;
    const { sql: filterWhere, params: filterParams } = this.buildFilterWhere(
      input.filters ?? [],
    );

    // Build ORDER BY clause. Parameters used by a correlated ordering
    // expression appear after WHERE parameters in the final data query.
    let orderBy: string;
    const orderParams: unknown[] = [];
    if (hasPositiveQuery && !input.sort) {
      // When searching, order by BM25 relevance with per-column weights
      // (filename 10, tags 8, description 5, source_url 3, author 3,
      // folder_path 2, metadata_text 1) per ADR-0009. The FTS5 `rank` hidden
      // column uses default weights (all 1.0); explicit bm25() is required to
      // apply the weighted ranking. This sacrifices the rank-column snippet
      // lazy-evaluation optimization (restorable later via a custom rank fn).
      orderBy = `bm25(asset_search, 10.0, 8.0, 5.0, 3.0, 3.0, 2.0, 1.0) ASC, a.asset_id ASC`;
    } else if (input.sort) {
      const sortField = input.sort.field;
      const dir = input.sort.order === 'desc' ? 'DESC' : 'ASC';
      switch (sortField) {
        case 'name':
          orderBy = `a.relative_file_path ${dir}, a.asset_id ASC`;
          break;
        case 'modified_at':
          orderBy = `r.modified_at ${dir}, a.asset_id ASC`;
          break;
        case 'created_at':
          orderBy = `a.created_at ${dir}, a.asset_id ASC`;
          break;
        case 'byte_size':
          orderBy = `r.byte_size ${dir}, a.asset_id ASC`;
          break;
        case 'long_edge': {
          // Same long-edge expression as REQ-FILTER-010 numeric filters.
          const width =
            'COALESCE(duration_meta.width, technical_thumbnail.width)';
          const height =
            'COALESCE(duration_meta.height, technical_thumbnail.height)';
          const longEdge =
            `NULLIF(MAX(COALESCE(${width}, 0), COALESCE(${height}, 0)), 0)`;
          orderBy = `${longEdge} IS NULL ASC, ${longEdge} ${dir}, a.asset_id ASC`;
          break;
        }
        case 'duration':
          orderBy = `duration_meta.duration_ms IS NULL ASC, duration_meta.duration_ms ${dir}, a.asset_id ASC`;
          break;
        case 'rating':
          orderBy = `COALESCE(m.rating, 0) ${dir}, a.asset_id ASC`;
          break;
        case 'author':
          orderBy = `COALESCE(m.author, '') = '' ASC, COALESCE(m.author, '') COLLATE NOCASE ${dir}, a.asset_id ASC`;
          break;
        case 'color':
          orderBy = `palette_meta.dominant_hue IS NULL ASC,
                     palette_meta.dominant_hue ${dir},
                     palette_meta.dominant_lightness ${dir},
                     a.asset_id ASC`;
          break;
        default:
          orderBy = `a.relative_file_path ASC, a.asset_id ASC`;
      }
    } else if (input.scope?.kind === 'collection') {
      if (input.scope.recursive) {
        orderBy = `(SELECT MIN(ca.position)
                      FROM collection_assets ca
                     WHERE ca.asset_id = a.asset_id
                       AND ca.collection_id IN (
                         WITH RECURSIVE descendants(collection_id) AS (
                           SELECT collection_id FROM collections WHERE collection_id = ? AND library_id = ?
                           UNION ALL
                           SELECT child.collection_id FROM collections child
                             JOIN descendants parent ON child.parent_id = parent.collection_id
                            WHERE child.library_id = ?
                         )
                         SELECT collection_id FROM descendants
                       )) ASC, a.relative_file_path ASC, a.asset_id ASC`;
        orderParams.push(
          input.scope.collectionId,
          openLibrary.summary.libraryId,
          openLibrary.summary.libraryId,
        );
      } else {
        orderBy = `(SELECT ca.position
                      FROM collection_assets ca
                     WHERE ca.asset_id = a.asset_id
                       AND ca.collection_id = ?) ASC, a.relative_file_path ASC, a.asset_id ASC`;
        orderParams.push(input.scope.collectionId);
      }
    } else if (input.scope?.kind === 'trash') {
      orderBy = `a.deleted_at DESC, a.asset_id ASC`;
    } else {
      orderBy = `a.relative_file_path ASC, a.asset_id ASC`;
    }

    // Build the base FROM + JOIN clauses.
    const baseFrom = hasPositiveQuery
      ? `FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
           LEFT JOIN revision_artifacts duration_meta
             ON duration_meta.revision_id = a.current_revision_id
            AND duration_meta.kind = 'extracted_metadata'
            AND duration_meta.status = 'ready'
            AND duration_meta.invalidated_at IS NULL
           LEFT JOIN revision_artifacts palette_meta
             ON palette_meta.revision_id = a.current_revision_id
            AND palette_meta.kind = 'extracted_palette'
            AND palette_meta.status = 'ready'
            AND palette_meta.invalidated_at IS NULL
           LEFT JOIN revision_artifacts technical_thumbnail
             ON technical_thumbnail.revision_id = a.current_revision_id
            AND technical_thumbnail.kind = CASE
              WHEN LOWER(a.relative_file_path) LIKE '%.mp4'
                OR LOWER(a.relative_file_path) LIKE '%.webm'
                OR LOWER(a.relative_file_path) LIKE '%.mov'
                OR LOWER(a.relative_file_path) LIKE '%.avi'
                OR LOWER(a.relative_file_path) LIKE '%.wmv'
              THEN 'video_poster'
              ELSE 'thumbnail'
            END
            AND technical_thumbnail.status = 'ready'
            AND technical_thumbnail.invalidated_at IS NULL
           JOIN asset_search_index sc ON a.asset_id = sc.asset_id
           JOIN asset_search s ON sc.rowid = s.rowid`
      : `FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
           LEFT JOIN revision_artifacts duration_meta
             ON duration_meta.revision_id = a.current_revision_id
            AND duration_meta.kind = 'extracted_metadata'
            AND duration_meta.status = 'ready'
            AND duration_meta.invalidated_at IS NULL
           LEFT JOIN revision_artifacts palette_meta
             ON palette_meta.revision_id = a.current_revision_id
            AND palette_meta.kind = 'extracted_palette'
            AND palette_meta.status = 'ready'
            AND palette_meta.invalidated_at IS NULL
           LEFT JOIN revision_artifacts technical_thumbnail
             ON technical_thumbnail.revision_id = a.current_revision_id
            AND technical_thumbnail.kind = CASE
              WHEN LOWER(a.relative_file_path) LIKE '%.mp4'
                OR LOWER(a.relative_file_path) LIKE '%.webm'
                OR LOWER(a.relative_file_path) LIKE '%.mov'
                OR LOWER(a.relative_file_path) LIKE '%.avi'
                OR LOWER(a.relative_file_path) LIKE '%.wmv'
              THEN 'video_poster'
              ELSE 'thumbnail'
            END
            AND technical_thumbnail.status = 'ready'
            AND technical_thumbnail.invalidated_at IS NULL`;

    // WHERE clause.
    const whereParts: string[] = [];
    const allParams: unknown[] = [];

    if (hasPositiveQuery) {
      whereParts.push(
        `asset_search MATCH ? AND rank MATCH 'bm25(10.0, 8.0, 5.0, 3.0, 3.0, 2.0, 1.0)'`,
      );
      allParams.push(fts5Query);
    } else if (isExcludeOnlyQuery) {
      whereParts.push(
        `a.asset_id NOT IN (
           SELECT excluded.asset_id
             FROM asset_search_index excluded
             JOIN asset_search ON excluded.rowid = asset_search.rowid
            WHERE asset_search MATCH ?
         )`,
      );
      allParams.push(fts5Query);
    }

    // Soft-deleted assets retain their organization relationships for restore.
    // They are only exposed through the explicit trash scope; every other
    // discovery query excludes them.
    whereParts.push(input.scope?.kind === 'trash'
      ? 'a.deleted_at IS NOT NULL'
      : 'a.deleted_at IS NULL');
    whereParts.push('NOT EXISTS (SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id)');

    if (filterWhere.length > 0) {
      whereParts.push(filterWhere);
      allParams.push(...filterParams);
    }

    if (input.scope?.kind === 'folder') {
      if (input.scope.folderId === null) {
        whereParts.push(`a.location_kind = 'managed' AND a.managed_folder_id IS NULL`);
      } else {
        const folderId = input.scope.folderId;
        const managed = connection
          // A library database owns exactly one library, so managed_folders
          // intentionally has no library_id column. linked_folders does.
          .prepare('SELECT folder_id FROM managed_folders WHERE folder_id = ?')
          .get(folderId);
        const linked = connection
          .prepare('SELECT folder_id FROM linked_folders WHERE folder_id = ? AND library_id = ?')
          .get(folderId, openLibrary.summary.libraryId);
        if (managed) {
          if (input.scope.recursive) {
            whereParts.push(`a.managed_folder_id IN (
              WITH RECURSIVE descendants(folder_id) AS (
                SELECT folder_id FROM managed_folders WHERE folder_id = ?
                UNION ALL
                SELECT child.folder_id FROM managed_folders child
                  JOIN descendants parent ON child.parent_folder_id = parent.folder_id
              )
              SELECT folder_id FROM descendants
            )`);
            allParams.push(folderId);
          } else {
            whereParts.push('a.managed_folder_id = ?');
            allParams.push(folderId);
          }
        } else if (linked) {
          whereParts.push('a.linked_folder_id = ?');
          allParams.push(folderId);
        } else {
          throw new LibraryServiceError('FOLDER_NOT_FOUND');
        }
      }
    } else if (input.scope?.kind === 'collection') {
      const collection = connection
        .prepare('SELECT collection_id FROM collections WHERE collection_id = ? AND library_id = ?')
        .get(input.scope.collectionId, openLibrary.summary.libraryId);
      if (!collection) throw new LibraryServiceError('FOLDER_NOT_FOUND');
      if (input.scope.recursive) {
        whereParts.push(`a.asset_id IN (
          WITH RECURSIVE descendants(collection_id) AS (
            SELECT collection_id FROM collections WHERE collection_id = ? AND library_id = ?
            UNION ALL
            SELECT child.collection_id FROM collections child
              JOIN descendants parent ON child.parent_id = parent.collection_id
             WHERE child.library_id = ?
          )
          SELECT ca.asset_id FROM collection_assets ca
            JOIN descendants d ON d.collection_id = ca.collection_id
        )`);
        allParams.push(input.scope.collectionId, openLibrary.summary.libraryId, openLibrary.summary.libraryId);
      } else {
        whereParts.push('a.asset_id IN (SELECT asset_id FROM collection_assets WHERE collection_id = ?)');
        allParams.push(input.scope.collectionId);
      }
    }

    const whereClause =
      whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    // Columns for data query.
    const dataColumns = hasPositiveQuery
      ? `a.asset_id, a.location_kind, a.managed_folder_id, a.relative_file_path, a.current_revision_id,
         a.availability, r.byte_size, r.modified_at,
         COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
         a.deleted_at, a.trashed_from_relative_path,
         snippet(asset_search, -1, '<b>', '</b>', '...', 32) AS snippet_text`
      : `a.asset_id, a.location_kind, a.managed_folder_id, a.relative_file_path, a.current_revision_id,
         a.availability, r.byte_size, r.modified_at,
         COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
         a.deleted_at, a.trashed_from_relative_path`;

    // Total count query.
    const countSql = `SELECT COUNT(*) AS total ${baseFrom} ${whereClause}`;
    const countRow = connection.prepare(countSql).get(...allParams) as {
      total: number;
    };
    const total = countRow.total;

    // Data query.
    const dataSql = `SELECT ${dataColumns} ${baseFrom} ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    const rows = connection
      .prepare(dataSql)
      .all(...allParams, ...orderParams, limit, offset) as Array<{
        asset_id: string;
        location_kind: 'managed' | 'linked';
        managed_folder_id: string | null;
        relative_file_path: string;
        current_revision_id: string;
        availability: 'available' | 'missing';
        byte_size: number;
        modified_at: string;
        rating: number;
        favorite: number;
        deleted_at?: string | null;
        trashed_from_relative_path?: string | null;
        snippet_text?: string;
      }>;

    const artifactMap = this.thumbnailArtifactMap(
      input.libraryId,
      rows.map((row) => row.asset_id),
    );
    const items: AssetSummary[] = rows.map((row) => {
      const artifact = artifactMap.get(row.asset_id);
      const detectedMediaType = LibraryService.detectMediaType(row.relative_file_path);
      return this.assetSummaryFromRow({
        ...row,
        thumbnail_status: artifact?.status ?? null,
        thumbnail_artifact_id: artifact?.artifactId ?? null,
        artifact_width: artifact?.width ?? null,
        artifact_height: artifact?.height ?? null,
        artifact_duration_ms: artifact?.durationMs ?? null,
        media_type: LibraryService.toSummaryMediaType(detectedMediaType),
      });
    });

    const snippets: Array<{ assetId: string; text: string }> | undefined =
      hasPositiveQuery
        ? rows
            .filter((r) => r.snippet_text && r.snippet_text.length > 0)
            .map((r) => ({ assetId: r.asset_id, text: r.snippet_text! }))
        : undefined;

    return { items, total, offset, snippets };
  }

  // ── Smart Collections (v6) ──────────────────────────────────────────

  createSmartCollection(input: {
    libraryId: string;
    name: string;
    queryDefinitionJson: string;
  }): SmartCollectionSummary {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const trimmed = input.name.trim();
    if (trimmed.length === 0) throw new LibraryServiceError('INVALID_FOLDER_NAME');

    // Serpent-era: create may start as a draft with empty `{}` query; the
    // settings dialog attaches a meaningful condition afterwards. Updates that
    // change the query still assert via updateSmartCollection.
    const definition = this.parseSmartCollectionDefinition(
      input.queryDefinitionJson,
      'INVALID_IMPORT_DECISION',
    );

    const collectionId = randomUUID();
    const now = new Date().toISOString();

    try {
      openLibrary.connection
        .prepare(
          `INSERT INTO smart_collections
             (collection_id, library_id, name, query_definition_json, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          collectionId,
          openLibrary.summary.libraryId,
          trimmed,
          input.queryDefinitionJson,
          now,
          now,
        );
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
      }
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }

    return {
      collectionId,
      name: trimmed,
      queryDefinition: input.queryDefinitionJson,
      position: 0,
      assetCount: this.countSmartCollectionMatches(input.libraryId, definition),
    };
  }

  listSmartCollections(libraryId: string): SmartCollectionSummary[] {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const rows = openLibrary.connection
      .prepare(
        `SELECT collection_id, name, query_definition_json, position
           FROM smart_collections
          WHERE library_id = ?
          ORDER BY position, name`,
      )
      .all(openLibrary.summary.libraryId) as Array<{
        collection_id: string;
        name: string;
        query_definition_json: string;
        position: number;
      }>;
    // Batch counts inside one list call so the renderer avoids N+1 execute RPCs (CU-M6).
    return rows.map((row) => {
      let assetCount: number;
      try {
        const definition = this.parseSmartCollectionDefinition(
          row.query_definition_json,
          'LIBRARY_CORRUPT',
        );
        assetCount = this.countSmartCollectionMatches(libraryId, definition);
      } catch {
        assetCount = 0;
      }
      return {
        collectionId: row.collection_id,
        name: row.name,
        queryDefinition: row.query_definition_json,
        position: row.position,
        assetCount,
      };
    });
  }

  updateSmartCollection(input: {
    libraryId: string;
    collectionId: string;
    name?: string;
    queryDefinitionJson?: string;
    position?: number;
  }): SmartCollectionSummary {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const existing = openLibrary.connection
      .prepare(
        'SELECT collection_id, name, query_definition_json, position FROM smart_collections WHERE collection_id = ? AND library_id = ?',
      )
      .get(input.collectionId, openLibrary.summary.libraryId) as {
        collection_id: string;
        name: string;
        query_definition_json: string;
        position: number;
      } | undefined;
    if (!existing) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    const now = new Date().toISOString();
    const newName =
      input.name !== undefined ? input.name.trim() : existing.name;
    if (newName.length === 0) throw new LibraryServiceError('INVALID_FOLDER_NAME');
    const newQueryDefinitionJson =
      input.queryDefinitionJson ?? existing.query_definition_json;
    const newPosition = input.position ?? existing.position;

    // Validate queryDefinitionJson if provided (CU-M5: require search/filter).
    let definition: SmartCollectionQueryDefinition | null = null;
    if (input.queryDefinitionJson !== undefined) {
      definition = this.parseSmartCollectionDefinition(
        input.queryDefinitionJson,
        'INVALID_IMPORT_DECISION',
      );
      this.assertMeaningfulSmartCollectionDefinition(definition);
    }

    try {
      openLibrary.connection
        .prepare(
          `UPDATE smart_collections
              SET name = ?, query_definition_json = ?, position = ?, updated_at = ?
            WHERE collection_id = ?`,
        )
        .run(newName, newQueryDefinitionJson, newPosition, now, input.collectionId);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
      }
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }

    let assetCount: number;
    try {
      const counted =
        definition ??
        this.parseSmartCollectionDefinition(
          newQueryDefinitionJson,
          'LIBRARY_CORRUPT',
        );
      assetCount = this.countSmartCollectionMatches(input.libraryId, counted);
    } catch {
      assetCount = 0;
    }

    return {
      collectionId: input.collectionId,
      name: newName,
      queryDefinition: newQueryDefinitionJson,
      position: newPosition,
      assetCount,
    };
  }

  deleteSmartCollection(input: {
    libraryId: string;
    collectionId: string;
  }): string {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const existing = openLibrary.connection
      .prepare(
        'SELECT collection_id FROM smart_collections WHERE collection_id = ? AND library_id = ?',
      )
      .get(input.collectionId, openLibrary.summary.libraryId);
    if (!existing) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    openLibrary.connection
      .prepare('DELETE FROM smart_collections WHERE collection_id = ?')
      .run(input.collectionId);
    return input.collectionId;
  }

  executeSmartCollection(input: {
    libraryId: string;
    collectionId: string;
    limit?: number;
    offset?: number;
  }): { items: AssetSummary[]; total: number; offset: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const sc = openLibrary.connection
      .prepare(
        'SELECT collection_id, query_definition_json FROM smart_collections WHERE collection_id = ? AND library_id = ?',
      )
      .get(input.collectionId, openLibrary.summary.libraryId) as {
        collection_id: string;
        query_definition_json: string;
      } | undefined;
    if (!sc) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    const definition = this.parseSmartCollectionDefinition(sc.query_definition_json, 'LIBRARY_CORRUPT');

    return this.searchAssets({
      libraryId: input.libraryId,
      query: definition.search ?? null,
      filters: definition.filters ?? null,
      sort: definition.sort ?? null,
      limit: input.limit ?? 50,
      offset: input.offset ?? 0,
    });
  }

  private parseSmartCollectionDefinition(
    value: string,
    errorCode: 'INVALID_IMPORT_DECISION' | 'LIBRARY_CORRUPT',
  ): SmartCollectionQueryDefinition {
    if (value.length > 65_536) throw new LibraryServiceError(errorCode);
    try {
      return smartCollectionQueryDefinitionSchema.parse(JSON.parse(value));
    } catch {
      throw new LibraryServiceError(errorCode);
    }
  }

  private assertMeaningfulSmartCollectionDefinition(
    definition: SmartCollectionQueryDefinition,
  ): void {
    if (!hasMeaningfulSmartCollectionCondition(definition)) {
      throw new LibraryServiceError('INVALID_SMART_COLLECTION_QUERY');
    }
  }

  /** Count-only search (limit 0) for sidebar badges without fetching rows. */
  private countSmartCollectionMatches(
    libraryId: string,
    definition: SmartCollectionQueryDefinition,
  ): number {
    return this.searchAssets({
      libraryId,
      query: definition.search ?? null,
      filters: definition.filters ?? null,
      sort: null,
      limit: 0,
      offset: 0,
    }).total;
  }

  // ── Trash & Relink (v7) ───────────────────────────────────────────

  private trashPath(openLibrary: OpenLibrary, assetId: string, filename: string): string {
    return path.join(openLibrary.summary.libraryPath, '.serpent', 'trash', assetId, filename);
  }

  private assertNotInManagedSpace(
    openLibrary: OpenLibrary,
    absolutePath: string,
  ): void {
    const assetsPath = this.assetsPath(openLibrary);
    const relation = path.relative(assetsPath, absolutePath);
    if (relation === '' || (!relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation))) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: 'NAME_NOT_SUPPORTED',
      });
    }
  }

  private assertNoSymlinkEscape(absolutePath: string): void {
    const filePath = absolutePath;
    try {
      const lstat = lstatSync(filePath);
      if (lstat.isSymbolicLink()) throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
      });
    } catch (error) {
      if (error instanceof LibraryServiceError) throw error;
      if (isMissingPathError(error)) return;
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    const directory = path.dirname(absolutePath);
    try {
      const resolved = realpathSync(directory);
      const dirName = path.basename(directory);
      let current = resolved;
      for (const component of dirName.split(path.sep).filter(Boolean)) {
        current = path.join(current, component);
        try {
          if (lstatSync(current).isSymbolicLink()) {
            throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
              reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
            });
          }
        } catch (error) {
          if (error instanceof LibraryServiceError) throw error;
          if (isMissingPathError(error)) break;
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof LibraryServiceError) throw error;
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
  }

  private placeManagedRelinkFile(
    openLibrary: OpenLibrary,
    sourcePath: string,
    destinationRelativePath: string,
  ): {
    destinationPath: string;
    operationPath: string;
    placedIdentity: ManagedRelinkPlacementIdentity;
    stat: Stats;
  } {
    const destinationPath = this.folderPath(openLibrary, destinationRelativePath);
    if (existsSync(destinationPath)) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION', {
        reason: 'SOURCE_CHANGED',
      });
    }

    let sourceStat: BigIntStats;
    try {
      sourceStat = lstatSync(sourcePath, { bigint: true });
    } catch (error) {
      throw serviceError(error, 'INVALID_IMPORT_SOURCE');
    }
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: sourceStat.isSymbolicLink()
          ? 'SYMBOLIC_LINK_NOT_ALLOWED'
          : 'UNSUPPORTED_FILE_ENTRY',
      });
    }

    const operationPath = path.join(
      openLibrary.summary.libraryPath,
      '.serpent',
      'operations',
      `relink-${randomUUID()}`,
    );
    const stagedPath = path.join(operationPath, 'replacement');
    let stagedIdentity: ManagedRelinkPlacementIdentity;
    try {
      mkdirSync(operationPath, { recursive: true });
      this.copySourceSnapshot({
        byteSize: Number(sourceStat.size),
        destinationRelativePath,
        sourcePath,
        sourceSnapshot: sourceSnapshot(sourceStat),
      }, stagedPath);
      stagedIdentity = this.managedRelinkPlacementIdentity(stagedPath);
      this.failAt('crash-relink-before-manifest-write');
      this.writeManagedRelinkPlacementManifest(operationPath, {
        version: 3,
        kind: 'managed-relink-placement',
        phase: 'staged',
        destinationRelativePath,
        stagedIdentity,
      });
      this.failAt('crash-relink-after-manifest-before-placement');
    } catch (error) {
      if (error instanceof SimulatedCrashError) throw error;
      rmSync(operationPath, { force: true, recursive: true });
      throw serviceError(error, 'INVALID_IMPORT_SOURCE');
    }

    let placed = false;
    try {
      mkdirSync(path.dirname(destinationPath), { recursive: true });
      // Re-validate after creating a missing original directory hierarchy so a
      // symlink introduced between validation and placement cannot escape Assets/.
      if (this.folderPath(openLibrary, destinationRelativePath) !== destinationPath) {
        throw new LibraryServiceError('INVALID_LIBRARY_PATH');
      }
      if (existsSync(destinationPath)) {
        throw new LibraryServiceError('INVALID_IMPORT_DECISION', {
          reason: 'SOURCE_CHANGED',
        });
      }
      renameSync(stagedPath, destinationPath);
      placed = true;
      this.failAt('crash-relink-after-placement-before-manifest-update');
      const placedIdentity = this.managedRelinkPlacementIdentity(destinationPath);
      this.writeDurableRelinkJournalFile(operationPath, 'placed.json', {
        version: 1,
        kind: 'managed-relink-placement-complete',
        placedIdentity,
      } satisfies ManagedRelinkPlacedMarkerV1);
      return {
        destinationPath,
        operationPath,
        placedIdentity,
        stat: statSync(destinationPath),
      };
    } catch (error) {
      if (error instanceof SimulatedCrashError) throw error;
      if (placed) {
        // No durable placed marker means ownership is ambiguous. A concurrent
        // writer may already have replaced or modified the path, so preserve it.
        this.diagnose('asset.relink.placement-marker-failed', error, {
          destinationPath,
        });
      }
      rmSync(operationPath, { force: true, recursive: true });
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
  }

  private managedRelinkPlacementIdentity(filePath: string): ManagedRelinkPlacementIdentity {
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
    const descriptor = openSync(filePath, flags);
    try {
      const before = fstatSync(descriptor, { bigint: true });
      const pathEntry = lstatSync(filePath, { bigint: true });
      if (
        !before.isFile() || !pathEntry.isFile() || pathEntry.isSymbolicLink() ||
        !sameSourceSnapshot(sourceSnapshot(before), sourceSnapshot(pathEntry))
      ) {
        throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
          reason: pathEntry.isSymbolicLink() ? 'SYMBOLIC_LINK_NOT_ALLOWED' : 'SOURCE_CHANGED',
        });
      }
      const sha256 = sha256DescriptorSync(descriptor);
      const after = fstatSync(descriptor, { bigint: true });
      if (!sameSourceSnapshot(sourceSnapshot(before), sourceSnapshot(after))) {
        throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { reason: 'SOURCE_CHANGED' });
      }
      return {
        ctimeNs: String(after.ctimeNs),
        dev: String(after.dev),
        ino: String(after.ino),
        mtimeNs: String(after.mtimeNs),
        sha256,
        size: String(after.size),
      };
    } finally {
      closeSync(descriptor);
    }
  }

  private writeManagedRelinkPlacementManifest(
    operationPath: string,
    manifest: ManagedRelinkPlacementManifestV3,
  ): void {
    this.writeDurableRelinkJournalFile(operationPath, 'manifest.json', manifest);
  }

  private writeDurableRelinkJournalFile(
    operationPath: string,
    filename: 'manifest.json' | 'placed.json',
    value: ManagedRelinkPlacementManifestV3 | ManagedRelinkPlacedMarkerV1,
  ): void {
    const finalPath = path.join(operationPath, filename);
    const temporaryPath = path.join(operationPath, `${filename}.tmp`);
    const payload = Buffer.from(JSON.stringify(value), 'utf8');
    let descriptor: number | undefined;
    try {
      descriptor = openSync(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      );
      let written = 0;
      while (written < payload.length) {
        written += writeSync(descriptor, payload, written, payload.length - written);
      }
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      // Both journal records are immutable and created exactly once. Renaming
      // onto an absent path avoids platform-specific replace semantics.
      renameSync(temporaryPath, finalPath);

      // Directory fsync makes both the manifest rename and the newly-created
      // relink operation directory durable on filesystems that support it.
      // Windows does not provide a portable directory fsync through Node.
      if (process.platform !== 'win32') {
        for (const directoryPath of [operationPath, path.dirname(operationPath)]) {
          let directoryDescriptor: number | undefined;
          try {
            directoryDescriptor = openSync(directoryPath, constants.O_RDONLY);
            fsyncSync(directoryDescriptor);
          } finally {
            if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
          }
        }
      }
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  private cleanupManagedRelinkPlacement(
    placement: {
      destinationPath: string;
      operationPath: string;
      placedIdentity: ManagedRelinkPlacementIdentity;
    },
    removeDestination: boolean,
  ): void {
    let preserveOperation = false;
    if (removeDestination) {
      try {
        const removal = this.quarantineManagedRelinkPlacementForRemoval(
          placement.destinationPath,
          placement.operationPath,
          placement.placedIdentity,
        );
        preserveOperation = removal.preserveOperation;
        if (!removal.owned) {
          this.diagnose(
            'asset.relink.rollback-file-mismatch',
            new LibraryServiceError('LIBRARY_NOT_WRITABLE', { reason: 'SOURCE_CHANGED' }),
            { destinationPath: placement.destinationPath },
          );
        }
      } catch (error) {
        this.diagnose('asset.relink.rollback-file', error, {
          destinationPath: placement.destinationPath,
        });
      }
    }
    if (preserveOperation) return;
    try {
      rmSync(placement.operationPath, { force: true, recursive: true });
    } catch (error) {
      this.diagnose('asset.relink.cleanup-operation', error, {
        operationPath: placement.operationPath,
      });
    }
  }

  private recoverOrphanRelinkPlacement(openLibrary: OpenLibrary, operationPath: string): boolean {
    const manifestPath = path.join(operationPath, 'manifest.json');
    if (!existsSync(manifestPath)) return false;
    let destinationRelativePath: string;
    let placedIdentity: ManagedRelinkPlacementIdentity | undefined;
    let manifestVersion: 1 | 2 | 3;
    let phase: 'legacy' | 'staged' | 'placed' = 'legacy';
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
      if (
        typeof parsed !== 'object' || parsed === null ||
        typeof (parsed as { destinationRelativePath?: unknown }).destinationRelativePath !== 'string'
      ) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      const version = (parsed as { version?: unknown }).version;
      if (version !== 1 && version !== 2 && version !== 3) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      manifestVersion = version;
      const rawPath = (parsed as { destinationRelativePath: string }).destinationRelativePath;
      destinationRelativePath = normalizeRelativeAssetPath(rawPath);
      if (destinationRelativePath !== rawPath) throw new LibraryServiceError('LIBRARY_CORRUPT');
      if (version === 3) {
        const candidate = parsed as {
          kind?: unknown;
          phase?: unknown;
          stagedIdentity?: unknown;
        };
        if (
          candidate.kind !== 'managed-relink-placement' ||
          candidate.phase !== 'staged' ||
          !this.isManagedRelinkPlacementIdentity(candidate.stagedIdentity)
        ) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }
        phase = 'staged';
      }
    } catch (error) {
      // A malformed/partially-written relink manifest can never authorize a
      // destination deletion. Preserve all files and discard only the isolated
      // operation directory so one bad journal cannot prevent the library opening.
      this.diagnose('asset.relink.recovery-manifest-invalid', error, {
        libraryId: openLibrary.summary.libraryId,
        operationPath,
      });
      rmSync(operationPath, { force: true, recursive: true });
      return true;
    }

    if (manifestVersion === 3) {
      const placedMarkerPath = path.join(operationPath, 'placed.json');
      if (existsSync(placedMarkerPath)) {
        try {
          const marker = JSON.parse(readFileSync(placedMarkerPath, 'utf8')) as {
            kind?: unknown;
            placedIdentity?: unknown;
            version?: unknown;
          };
          if (
            marker.version !== 1 ||
            marker.kind !== 'managed-relink-placement-complete' ||
            !this.isManagedRelinkPlacementIdentity(marker.placedIdentity)
          ) {
            throw new LibraryServiceError('LIBRARY_CORRUPT');
          }
          placedIdentity = marker.placedIdentity;
          phase = 'placed';
        } catch (error) {
          // A missing or malformed completion marker means the rename cannot be
          // proven. Keep phase=staged so the destination is preserved.
          this.diagnose('asset.relink.recovery-marker-invalid', error, {
            libraryId: openLibrary.summary.libraryId,
            destinationRelativePath,
          });
        }
      }
    }

    const destinationPath = this.folderPath(openLibrary, destinationRelativePath);
    const destinationExists = existsSync(destinationPath);
    let ownsDestination = false;
    if (destinationExists && manifestVersion === 3 && phase === 'placed' && placedIdentity) {
      try {
        ownsDestination = this.matchesManagedRelinkPlacementIdentity(
          destinationPath,
          placedIdentity,
        );
      } catch (error) {
        this.diagnose('asset.relink.recovery-file-mismatch', error, {
          libraryId: openLibrary.summary.libraryId,
          destinationRelativePath,
        });
      }
      if (!ownsDestination) {
        this.diagnose(
          'asset.relink.recovery-file-mismatch',
          new LibraryServiceError('LIBRARY_NOT_WRITABLE', { reason: 'SOURCE_CHANGED' }),
          { libraryId: openLibrary.summary.libraryId, destinationRelativePath },
        );
      }
    } else if (destinationExists) {
      // v1/v2 journals and v3 staged journals do not carry durable post-rename
      // ownership. They may be leftovers from the historical rename->v2 crash
      // window, or another writer may have created the path. Preserve the file.
      this.diagnose(
        'asset.relink.recovery-ownership-unknown',
        new LibraryServiceError('LIBRARY_NOT_WRITABLE', { reason: 'SOURCE_CHANGED' }),
        {
          libraryId: openLibrary.summary.libraryId,
          destinationRelativePath,
          manifestVersion,
          phase,
        },
      );
    }

    const asset = openLibrary.connection
      .prepare(
        `SELECT availability FROM assets
          WHERE location_kind = 'managed' AND path_identity = ? AND deleted_at IS NULL`,
      )
      .get(portablePathIdentity(destinationRelativePath)) as { availability: 'available' | 'missing' } | undefined;
    const databaseCommitted = asset?.availability === 'available';
    let preserveOperation = false;
    if (destinationExists && ownsDestination && !databaseCommitted) {
      const removal = this.quarantineManagedRelinkPlacementForRemoval(
        destinationPath,
        operationPath,
        placedIdentity!,
      );
      ownsDestination = removal.owned;
      preserveOperation = removal.preserveOperation;
    }
    if (!preserveOperation) rmSync(operationPath, { force: true, recursive: true });
    this.diagnose(
      databaseCommitted
        ? 'asset.relink.recovered-committed-placement'
        : ownsDestination
          ? 'asset.relink.recovered-orphan-placement'
          : 'asset.relink.recovered-preserved-placement',
      new LibraryServiceError('LIBRARY_NOT_WRITABLE', { reason: 'IO_ERROR' }),
      { libraryId: openLibrary.summary.libraryId, destinationRelativePath },
    );
    return true;
  }

  private isManagedRelinkPlacementIdentity(
    value: unknown,
  ): value is ManagedRelinkPlacementIdentity {
    if (typeof value !== 'object' || value === null) return false;
    const identity = value as Partial<Record<keyof ManagedRelinkPlacementIdentity, unknown>>;
    const decimal = /^\d+$/;
    return (
      typeof identity.ctimeNs === 'string' && decimal.test(identity.ctimeNs) &&
      typeof identity.dev === 'string' && decimal.test(identity.dev) &&
      typeof identity.ino === 'string' && decimal.test(identity.ino) &&
      typeof identity.mtimeNs === 'string' && decimal.test(identity.mtimeNs) &&
      typeof identity.size === 'string' && decimal.test(identity.size) &&
      typeof identity.sha256 === 'string' && /^[a-f0-9]{64}$/.test(identity.sha256)
    );
  }

  private matchesManagedRelinkPlacementIdentity(
    destinationPath: string,
    expected: ManagedRelinkPlacementIdentity,
  ): boolean {
    // Some network/removable filesystems report inode or device as zero. In that
    // case identity is ambiguous, so recovery must preserve rather than delete.
    if (expected.dev === '0' || expected.ino === '0') return false;
    const current = this.managedRelinkPlacementIdentity(destinationPath);
    return (
      current.ctimeNs === expected.ctimeNs &&
      current.dev === expected.dev &&
      current.ino === expected.ino &&
      current.mtimeNs === expected.mtimeNs &&
      current.size === expected.size &&
      current.sha256 === expected.sha256
    );
  }

  private quarantineManagedRelinkPlacementForRemoval(
    destinationPath: string,
    operationPath: string,
    expected: ManagedRelinkPlacementIdentity,
  ): { owned: boolean; preserveOperation: boolean } {
    if (!this.matchesManagedRelinkPlacementIdentity(destinationPath, expected)) {
      return { owned: false, preserveOperation: false };
    }

    const candidatePath = path.join(operationPath, 'rollback-candidate');
    try {
      renameSync(destinationPath, candidatePath);
    } catch {
      // The path changed after verification or could not be moved. It remains in
      // place, so preserving it and cleaning the journal is safe.
      return { owned: false, preserveOperation: false };
    }

    const candidateOwned = (() => {
      try {
        const candidate = this.managedRelinkPlacementIdentity(candidatePath);
        // Moving into quarantine changes ctime on several filesystems. The stable
        // inode/device plus size, mtime and content hash prove this is the same
        // verified file; any path replacement races produce a different inode.
        return (
          candidate.dev === expected.dev &&
          candidate.ino === expected.ino &&
          candidate.mtimeNs === expected.mtimeNs &&
          candidate.size === expected.size &&
          candidate.sha256 === expected.sha256
        );
      } catch {
        return false;
      }
    })();
    if (candidateOwned) return { owned: true, preserveOperation: false };

    // A writer won the verification->rename race. Restore the moved file when
    // possible. If the original path was claimed again, retain the entire
    // operation under .serpent/recovered so neither file is overwritten.
    if (!existsSync(destinationPath)) {
      try {
        renameSync(candidatePath, destinationPath);
        return { owned: false, preserveOperation: false };
      } catch {
        // Fall through to preserving the operation directory.
      }
    }
    const recoveredRoot = path.join(path.dirname(path.dirname(operationPath)), 'recovered');
    try {
      mkdirSync(recoveredRoot, { recursive: true });
      renameSync(operationPath, path.join(recoveredRoot, path.basename(operationPath)));
    } catch {
      // Leave the operation directory in place. The caller must not remove it.
    }
    return { owned: false, preserveOperation: true };
  }

  private assetSummaryFromRow(
    row: {
      asset_id: string;
      location_kind: 'managed' | 'linked';
      managed_folder_id: string | null;
      relative_file_path: string;
      current_revision_id: string;
      availability: 'available' | 'missing';
      byte_size: number;
      modified_at: string;
      rating: number;
      favorite: number;
      deleted_at?: string | null;
      trashed_from_relative_path?: string | null;
      thumbnail_status?: 'ready' | 'pending' | 'failed' | null;
      thumbnail_artifact_id?: string | null;
      media_type?: 'image' | 'video' | 'audio' | 'text' | 'other' | null;
      artifact_width?: number | null;
      artifact_height?: number | null;
      artifact_duration_ms?: number | null;
    },
  ): AssetSummary {
    let remainingDays: number | null = null;
    if (row.deleted_at) {
      const deletedMs = new Date(row.deleted_at).getTime();
      const expiryMs = deletedMs + 30 * 24 * 60 * 60 * 1000;
      remainingDays = Math.max(0, Math.ceil((expiryMs - Date.now()) / (24 * 60 * 60 * 1000)));
    }
    return {
      assetId: row.asset_id,
      locationKind: row.location_kind,
      managedFolderId: row.managed_folder_id,
      relativeFilePath: row.relative_file_path,
      displayName: path.posix.basename(row.relative_file_path),
      currentRevisionId: row.current_revision_id,
      byteSize: row.byte_size,
      modifiedAt: row.modified_at,
      availability: row.availability,
      rating: row.rating,
      favorite: row.favorite !== 0,
      deletedAt: row.deleted_at ?? null,
      trashedFromPath: row.trashed_from_relative_path ?? null,
      remainingDays,
      thumbnailStatus: row.thumbnail_status ?? null,
      thumbnailArtifactId: row.thumbnail_artifact_id ?? null,
      mediaType: row.media_type ?? 'other',
      // Probe writes width/height 0 for audio-only streams; AssetSummary
      // requires positive-or-null, so coerce zeros before IPC validation.
      width:
        row.artifact_width != null && row.artifact_width > 0
          ? row.artifact_width
          : null,
      height:
        row.artifact_height != null && row.artifact_height > 0
          ? row.artifact_height
          : null,
      durationMs: row.artifact_duration_ms ?? null,
    };
  }

  private managedMoveSummaries(openLibrary: OpenLibrary, assetIds: string[]): AssetSummary[] {
    return assetIds.flatMap((assetId) => {
      const row = openLibrary.connection.prepare(
        `SELECT a.asset_id, a.managed_folder_id, a.linked_folder_id, a.location_kind,
                a.relative_file_path, a.current_revision_id, a.availability,
                r.byte_size, r.modified_at,
                COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
                a.deleted_at, a.trashed_from_relative_path
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
          WHERE a.asset_id = ?`,
      ).get(assetId) as Parameters<LibraryService['assetSummaryFromRow']>[0] | undefined;
      return row ? [this.assetSummaryFromRow(row)] : [];
    });
  }

  private applyManagedMoveOperation(
    openLibrary: OpenLibrary,
    operationId: string,
    manifest: ManagedMoveOperationManifest,
  ): void {
    const operationsRoot = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);
    const operationPath = path.join(operationsRoot, operationId);
    mkdirSync(path.join(operationPath, 'backup'), { recursive: true });
    this.assertSafeOperationPath(operationPath);
    const now = new Date().toISOString();
    openLibrary.connection.prepare(
      `INSERT INTO file_operations
         (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
       VALUES (?, ?, 'preparing', ?, NULL, ?, ?)`,
    ).run(operationId, manifest.kind, JSON.stringify(manifest), now, now);

    try {
      this.failAt('crash-move-before-filesystem');
      const applying = openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'applying', updated_at = ? WHERE operation_id = ? AND status = 'preparing'",
      ).run(new Date().toISOString(), operationId);
      if (applying.changes !== 1) throw new LibraryServiceError('LIBRARY_CORRUPT');

      for (const file of manifest.files) {
        if (!file.destinationConflict) continue;
        const destinationPath = this.folderPath(openLibrary, file.destinationConflict.relativePath);
        const holdingPath = this.moveConflictHoldingPath(openLibrary, file.destinationConflict);
        mkdirSync(path.dirname(holdingPath), { recursive: true });
        renameSync(destinationPath, holdingPath);
      }
      this.failAt('crash-move-after-conflict');

      for (const file of manifest.files) {
        const sourcePath = this.folderPath(openLibrary, file.sourceRelativePath);
        const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
        mkdirSync(path.dirname(destinationPath), { recursive: true });
        renameSync(sourcePath, destinationPath);
      }
      for (const file of manifest.files) {
        if (!file.restoreConflict) continue;
        const holdingPath = this.moveConflictHoldingPath(openLibrary, file.restoreConflict);
        const restorePath = this.folderPath(openLibrary, file.sourceRelativePath);
        mkdirSync(path.dirname(restorePath), { recursive: true });
        renameSync(holdingPath, restorePath);
      }
      this.failAt('crash-move-after-filesystem');

      openLibrary.connection.transaction(() => {
        for (const file of manifest.files) {
          const conflict = file.destinationConflict;
          if (!conflict || conflict.kind !== 'managed' || !conflict.assetId || !conflict.trashFilename) continue;
          const trashRelativePath = `__trash__/${conflict.assetId}/${conflict.trashFilename}`;
          const changed = openLibrary.connection.prepare(
            `UPDATE assets SET relative_file_path = ?, managed_folder_id = NULL, path_identity = ?,
                    deleted_at = ?, trashed_from_relative_path = ?, trashed_from_folder_id = ?, updated_at = ?
              WHERE asset_id = ? AND deleted_at IS NULL`,
          ).run(trashRelativePath, portablePathIdentity(trashRelativePath), now,
            conflict.relativePath, conflict.managedFolderId, now, conflict.assetId);
          if (changed.changes !== 1) throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
          this.syncAssetSearchContent(openLibrary.connection, conflict.assetId);
        }
        for (const file of manifest.files) {
          const changed = openLibrary.connection.prepare(
            `UPDATE assets SET relative_file_path = ?, managed_folder_id = ?, path_identity = ?, updated_at = ?
              WHERE asset_id = ? AND location_kind = 'managed' AND deleted_at IS NULL`,
          ).run(file.destinationRelativePath, file.destinationFolderId,
            portablePathIdentity(file.destinationRelativePath), now, file.assetId);
          if (changed.changes !== 1) throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
          this.syncAssetSearchContent(openLibrary.connection, file.assetId);
        }
        for (const file of manifest.files) {
          const conflict = file.restoreConflict;
          if (!conflict || conflict.kind !== 'managed' || !conflict.assetId) continue;
          const changed = openLibrary.connection.prepare(
            `UPDATE assets SET relative_file_path = ?, managed_folder_id = ?, path_identity = ?,
                    deleted_at = NULL, trashed_from_relative_path = NULL,
                    trashed_from_folder_id = NULL, updated_at = ?
              WHERE asset_id = ? AND deleted_at IS NOT NULL`,
          ).run(conflict.relativePath, conflict.managedFolderId,
            portablePathIdentity(conflict.relativePath), now, conflict.assetId);
          if (changed.changes !== 1) throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
          this.syncAssetSearchContent(openLibrary.connection, conflict.assetId);
        }
        if (manifest.originalOperationId) {
          const consumed = openLibrary.connection.prepare(
            `UPDATE file_operations SET error_code = 'UNDONE', updated_at = ?
              WHERE operation_id = ? AND kind = 'managed-move' AND status = 'committed' AND error_code IS NULL`,
          ).run(now, manifest.originalOperationId);
          if (consumed.changes !== 1) throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
        }
        this.failAt('crash-move-before-db-commit');
        openLibrary.connection.prepare(
          "UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?",
        ).run(new Date().toISOString(), operationId);
      })();
      this.failAt('crash-move-after-db-commit');

      if (manifest.kind === 'managed-move-undo') {
        this.removeOperation(operationPath);
        if (manifest.originalOperationId) this.removeOperation(path.join(operationsRoot, manifest.originalOperationId));
      }
    } catch (error) {
      if (error instanceof SimulatedCrashError) throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
      const row = openLibrary.connection.prepare(
        'SELECT status, manifest_json, error_code, operation_id FROM file_operations WHERE operation_id = ?',
      ).get(operationId) as OperationRow | undefined;
      if (row?.status === 'committed') {
        this.diagnose('asset.move.post-commit', error, { operationId, libraryId: openLibrary.summary.libraryId });
        return;
      }
      if (row) {
        try {
          this.recoverManagedMoveOperation(openLibrary, row, manifest, operationPath);
        } catch (recoveryError) {
          openLibrary.connection.prepare(
            "UPDATE file_operations SET status = 'failed', error_code = 'MOVE_APPLY_FAILED', updated_at = ? WHERE operation_id = ?",
          ).run(new Date().toISOString(), operationId);
          this.diagnose('asset.move.rollback', recoveryError, { operationId, libraryId: openLibrary.summary.libraryId });
        }
      }
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
  }

  private managedMoveConflict(
    openLibrary: OpenLibrary,
    operationId: string,
    backupName: string,
    relativePath: string,
    excludedAssetId: string,
  ): ManagedMoveConflict | null {
    const identity = portablePathIdentity(relativePath);
    const active = openLibrary.connection.prepare(
      `SELECT asset_id, managed_folder_id, relative_file_path FROM assets
        WHERE path_identity = ? AND location_kind = 'managed' AND deleted_at IS NULL AND asset_id != ?`,
    ).get(identity, excludedAssetId) as {
      asset_id: string;
      managed_folder_id: string | null;
      relative_file_path: string;
    } | undefined;
    const disk = this.portableDiskDestination(openLibrary, relativePath);
    if (!active && !disk) return null;
    if (active && !disk) throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_NOT_FOUND' });
    if (disk && disk.size < 0) throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'UNSUPPORTED_FILE_ENTRY' });
    if (active) {
      return {
        assetId: active.asset_id,
        backupName,
        kind: 'managed',
        managedFolderId: active.managed_folder_id,
        operationId,
        relativePath: disk!.actualRelativePath,
        trashFilename: path.posix.basename(active.relative_file_path),
      };
    }
    return {
      assetId: null,
      backupName,
      kind: 'untracked',
      managedFolderId: null,
      operationId,
      relativePath: disk!.actualRelativePath,
      trashFilename: null,
    };
  }

  private availableMoveDestination(
    openLibrary: OpenLibrary,
    relativePath: string,
    planned: Set<string>,
  ): string {
    const parent = path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath);
    const filename = path.posix.basename(relativePath);
    const extension = path.posix.extname(filename);
    const base = extension ? filename.slice(0, -extension.length) : filename;
    for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
      const name = `${base} (${index})${extension}`;
      const candidate = parent ? path.posix.join(parent, name) : name;
      const identity = portablePathIdentity(candidate);
      if (planned.has(identity)) continue;
      const dbConflict = openLibrary.connection.prepare(
        "SELECT asset_id FROM assets WHERE path_identity = ? AND location_kind = 'managed' AND deleted_at IS NULL",
      ).get(identity);
      if (!dbConflict && !this.portableDiskDestination(openLibrary, candidate)) return candidate;
    }
    throw new LibraryServiceError('LIBRARY_NOT_WRITABLE');
  }

  moveAssets(input: {
    libraryId: string;
    assetIds: string[];
    targetFolderId: string | null;
    conflictStrategy?: 'keep-both' | 'replace' | 'skip';
  }): { movedCount: number; skippedCount: number; operationId: string | null; assets: AssetSummary[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    if (input.assetIds.length === 0 || new Set(input.assetIds).size !== input.assetIds.length) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }
    const targetFolder = input.targetFolderId === null ? undefined : this.targetFolder(openLibrary, input.targetFolderId);
    const rows = openLibrary.connection.prepare(
      `SELECT asset_id, relative_file_path, managed_folder_id, availability FROM assets
        WHERE asset_id IN (${input.assetIds.map(() => '?').join(',')})
          AND location_kind = 'managed' AND deleted_at IS NULL`,
    ).all(...input.assetIds) as Array<{
      asset_id: string;
      relative_file_path: string;
      managed_folder_id: string | null;
      availability: 'available' | 'missing';
    }>;
    const byId = new Map(rows.map((row) => [row.asset_id, row]));
    for (const assetId of input.assetIds) {
      const row = byId.get(assetId);
      if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
      if (row.availability !== 'available') throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }

    const operationId = randomUUID();
    const selectedIds = new Set(input.assetIds);
    const planned = new Set<string>();
    const strategy = input.conflictStrategy ?? 'keep-both';
    const files: ManagedMoveOperationManifest['files'] = [];
    let skippedCount = 0;
    const targetPrefix = targetFolder?.relative_path ?? '';

    for (const assetId of input.assetIds) {
      const row = byId.get(assetId)!;
      if (!realFileExists(this.folderPath(openLibrary, row.relative_file_path))) {
        throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
      }
      const filename = path.posix.basename(row.relative_file_path);
      let destinationRelativePath = targetPrefix ? path.posix.join(targetPrefix, filename) : filename;
      let identity = portablePathIdentity(destinationRelativePath);
      if (identity === portablePathIdentity(row.relative_file_path)) {
        skippedCount += 1;
        planned.add(identity);
        continue;
      }
      let conflict = this.managedMoveConflict(openLibrary, operationId, String(files.length), destinationRelativePath, assetId);
      const selectedConflict = conflict?.assetId ? selectedIds.has(conflict.assetId) : false;
      const batchConflict = planned.has(identity) || selectedConflict;
      if (batchConflict || conflict) {
        if (strategy === 'skip') {
          skippedCount += 1;
          continue;
        }
        if (strategy === 'keep-both' || batchConflict) {
          destinationRelativePath = this.availableMoveDestination(openLibrary, destinationRelativePath, planned);
          identity = portablePathIdentity(destinationRelativePath);
          conflict = null;
        }
      }
      planned.add(identity);
      files.push({
        assetId,
        destinationConflict: strategy === 'replace' ? conflict : null,
        destinationFolderId: targetFolder?.folder_id ?? null,
        destinationRelativePath,
        restoreConflict: null,
        sourceFolderId: row.managed_folder_id,
        sourceRelativePath: row.relative_file_path,
      });
    }

    if (files.length === 0) return { movedCount: 0, skippedCount, operationId: null, assets: [] };
    const manifest: ManagedMoveOperationManifest = {
      files,
      kind: 'managed-move',
      originalOperationId: null,
      version: 4,
    };
    this.applyManagedMoveOperation(openLibrary, operationId, manifest);
    return { movedCount: files.length, skippedCount, operationId,
      assets: this.managedMoveSummaries(openLibrary, files.map((file) => file.assetId)) };
  }

  undoMoveAssets(input: {
    libraryId: string;
    operationId: string;
    conflictStrategy?: 'error' | 'keep-both' | 'replace' | 'skip';
  }): { undoneCount: number; skippedCount: number; assets: AssetSummary[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const operation = openLibrary.connection.prepare(
      `SELECT operation_id, status, manifest_json, error_code FROM file_operations
        WHERE operation_id = ? AND kind = 'managed-move'`,
    ).get(input.operationId) as OperationRow | undefined;
    if (!operation || operation.status !== 'committed' || operation.error_code !== null) {
      throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
    }
    const original = this.parseOperationManifest(operation.manifest_json);
    if (original.version !== 4 || original.kind !== 'managed-move') throw new LibraryServiceError('LIBRARY_CORRUPT');
    const undoOperationId = randomUUID();
    const strategy = input.conflictStrategy ?? 'error';
    const planned = new Set<string>();
    const files: ManagedMoveOperationManifest['files'] = [];
    let skippedCount = 0;

    for (const originalFile of original.files) {
      const current = openLibrary.connection.prepare(
        `SELECT relative_file_path, managed_folder_id, availability FROM assets
          WHERE asset_id = ? AND location_kind = 'managed' AND deleted_at IS NULL`,
      ).get(originalFile.assetId) as {
        relative_file_path: string;
        managed_folder_id: string | null;
        availability: 'available' | 'missing';
      } | undefined;
      if (!current || current.availability !== 'available' ||
        portablePathIdentity(current.relative_file_path) !== portablePathIdentity(originalFile.destinationRelativePath) ||
        !realFileExists(this.folderPath(openLibrary, current.relative_file_path))) {
        throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
      }
      if (originalFile.destinationConflict &&
        !realFileExists(this.moveConflictHoldingPath(openLibrary, originalFile.destinationConflict))) {
        throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
      }

      let destinationRelativePath = originalFile.sourceRelativePath;
      let identity = portablePathIdentity(destinationRelativePath);
      let conflict = this.managedMoveConflict(openLibrary, undoOperationId, String(files.length), destinationRelativePath, originalFile.assetId);
      const hasConflict = planned.has(identity) || conflict !== null;
      if (hasConflict && strategy === 'error') throw new LibraryServiceError('ASSET_MOVE_CONFLICT');
      if (hasConflict && strategy === 'skip') {
        skippedCount += 1;
        continue;
      }
      if (hasConflict && strategy === 'keep-both') {
        destinationRelativePath = this.availableMoveDestination(openLibrary, destinationRelativePath, planned);
        identity = portablePathIdentity(destinationRelativePath);
        conflict = null;
      }
      planned.add(identity);
      files.push({
        assetId: originalFile.assetId,
        destinationConflict: strategy === 'replace' ? conflict : null,
        destinationFolderId: originalFile.sourceFolderId,
        destinationRelativePath,
        restoreConflict: originalFile.destinationConflict,
        sourceFolderId: current.managed_folder_id,
        sourceRelativePath: originalFile.destinationRelativePath,
      });
    }

    const manifest: ManagedMoveOperationManifest = {
      files,
      kind: 'managed-move-undo',
      originalOperationId: input.operationId,
      version: 4,
    };
    this.applyManagedMoveOperation(openLibrary, undoOperationId, manifest);
    return { undoneCount: files.length, skippedCount,
      assets: this.managedMoveSummaries(openLibrary, files.map((file) => file.assetId)) };
  }

  /**
   * Duplicate managed assets into a target folder (Option/Alt drag copy).
   * Creates new asset identities; clones human metadata + tags; does not clone
   * AI content, collections, or thumbnail binaries (regenerated via jobs).
   */
  copyAssets(input: {
    libraryId: string;
    assetIds: string[];
    targetFolderId: string | null;
    conflictStrategy?: 'keep-both' | 'replace' | 'skip';
  }): { copiedCount: number; skippedCount: number; operationId: string | null; assets: AssetSummary[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    if (input.assetIds.length === 0 || new Set(input.assetIds).size !== input.assetIds.length) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }
    const targetFolder = input.targetFolderId === null
      ? undefined
      : this.targetFolder(openLibrary, input.targetFolderId);
    const rows = openLibrary.connection.prepare(
      `SELECT asset_id, relative_file_path, managed_folder_id, availability FROM assets
        WHERE asset_id IN (${input.assetIds.map(() => '?').join(',')})
          AND location_kind = 'managed' AND deleted_at IS NULL`,
    ).all(...input.assetIds) as Array<{
      asset_id: string;
      relative_file_path: string;
      managed_folder_id: string | null;
      availability: 'available' | 'missing';
    }>;
    const byId = new Map(rows.map((row) => [row.asset_id, row]));
    for (const assetId of input.assetIds) {
      const row = byId.get(assetId);
      if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
      if (row.availability !== 'available') {
        throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
      }
    }

    const operationId = randomUUID();
    const selectedIds = new Set(input.assetIds);
    const planned = new Set<string>();
    const strategy = input.conflictStrategy ?? 'keep-both';
    const files: ManagedCopyOperationManifest['files'] = [];
    let skippedCount = 0;
    const targetPrefix = targetFolder?.relative_path ?? '';

    for (const assetId of input.assetIds) {
      const row = byId.get(assetId)!;
      if (!realFileExists(this.folderPath(openLibrary, row.relative_file_path))) {
        throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
      }
      const filename = path.posix.basename(row.relative_file_path);
      let destinationRelativePath = targetPrefix
        ? path.posix.join(targetPrefix, filename)
        : filename;
      let identity = portablePathIdentity(destinationRelativePath);
      // Same-folder / same-path always needs a keep-both style rename.
      const sameAsSource = identity === portablePathIdentity(row.relative_file_path);
      let conflict = sameAsSource
        ? null
        : this.managedMoveConflict(
            openLibrary,
            operationId,
            String(files.length),
            destinationRelativePath,
            assetId,
          );
      const selectedConflict = conflict?.assetId ? selectedIds.has(conflict.assetId) : false;
      const batchConflict = planned.has(identity) || selectedConflict || sameAsSource;
      if (batchConflict || conflict) {
        if (strategy === 'skip' && !sameAsSource) {
          skippedCount += 1;
          continue;
        }
        if (strategy === 'keep-both' || batchConflict || sameAsSource) {
          destinationRelativePath = this.availableMoveDestination(
            openLibrary,
            destinationRelativePath,
            planned,
          );
          identity = portablePathIdentity(destinationRelativePath);
          conflict = null;
        }
      }
      planned.add(identity);
      files.push({
        sourceAssetId: assetId,
        newAssetId: randomUUID(),
        destinationConflict: strategy === 'replace' && !sameAsSource ? conflict : null,
        destinationFolderId: targetFolder?.folder_id ?? null,
        destinationRelativePath,
        sourceRelativePath: row.relative_file_path,
      });
    }

    if (files.length === 0) {
      return { copiedCount: 0, skippedCount, operationId: null, assets: [] };
    }
    const manifest: ManagedCopyOperationManifest = {
      files,
      kind: 'managed-copy',
      originalOperationId: null,
      version: 5,
    };
    this.applyManagedCopyOperation(openLibrary, operationId, manifest);
    return {
      copiedCount: files.length,
      skippedCount,
      operationId,
      assets: this.managedMoveSummaries(
        openLibrary,
        files.map((file) => file.newAssetId),
      ),
    };
  }

  undoCopyAssets(input: {
    libraryId: string;
    operationId: string;
    conflictStrategy?: 'error' | 'keep-both' | 'replace' | 'skip';
  }): { undoneCount: number; skippedCount: number; assets: AssetSummary[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const operation = openLibrary.connection.prepare(
      `SELECT operation_id, status, manifest_json, error_code FROM file_operations
        WHERE operation_id = ? AND kind = 'managed-copy'`,
    ).get(input.operationId) as OperationRow | undefined;
    if (!operation || operation.status !== 'committed' || operation.error_code !== null) {
      throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
    }
    const original = this.parseOperationManifest(operation.manifest_json);
    if (original.version !== 5 || original.kind !== 'managed-copy') {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const strategy = input.conflictStrategy ?? 'error';
    const toDelete: string[] = [];
    let skippedCount = 0;

    for (const file of original.files) {
      const current = openLibrary.connection.prepare(
        `SELECT relative_file_path, availability FROM assets
          WHERE asset_id = ? AND location_kind = 'managed' AND deleted_at IS NULL`,
      ).get(file.newAssetId) as {
        relative_file_path: string;
        availability: 'available' | 'missing';
      } | undefined;
      const pathMatches = current
        && portablePathIdentity(current.relative_file_path)
          === portablePathIdentity(file.destinationRelativePath);
      if (!current || current.availability !== 'available' || !pathMatches) {
        if (strategy === 'skip') {
          skippedCount += 1;
          continue;
        }
        throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
      }
      if (!realFileExists(this.folderPath(openLibrary, current.relative_file_path))) {
        if (strategy === 'skip') {
          skippedCount += 1;
          continue;
        }
        throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
      }
      toDelete.push(file.newAssetId);
    }

    if (toDelete.length === 0) {
      return { undoneCount: 0, skippedCount, assets: [] };
    }

    const summaries = this.managedMoveSummaries(openLibrary, toDelete);
    this.deleteActiveManagedAssetsFromDisk(openLibrary, toDelete);
    const now = new Date().toISOString();
    const consumed = openLibrary.connection.prepare(
      `UPDATE file_operations SET error_code = 'UNDONE', updated_at = ?
        WHERE operation_id = ? AND kind = 'managed-copy' AND status = 'committed' AND error_code IS NULL`,
    ).run(now, input.operationId);
    if (consumed.changes !== 1) {
      throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
    }
    const operationsRoot = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);
    this.removeOperation(path.join(operationsRoot, input.operationId));
    return { undoneCount: toDelete.length, skippedCount, assets: summaries };
  }

  private applyManagedCopyOperation(
    openLibrary: OpenLibrary,
    operationId: string,
    manifest: ManagedCopyOperationManifest,
  ): void {
    const operationsRoot = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);
    const operationPath = path.join(operationsRoot, operationId);
    mkdirSync(path.join(operationPath, 'backup'), { recursive: true });
    this.assertSafeOperationPath(operationPath);
    const now = new Date().toISOString();
    openLibrary.connection.prepare(
      `INSERT INTO file_operations
         (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
       VALUES (?, ?, 'preparing', ?, NULL, ?, ?)`,
    ).run(operationId, manifest.kind, JSON.stringify(manifest), now, now);

    const copiedPaths: string[] = [];
    try {
      const applying = openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'applying', updated_at = ? WHERE operation_id = ? AND status = 'preparing'",
      ).run(new Date().toISOString(), operationId);
      if (applying.changes !== 1) throw new LibraryServiceError('LIBRARY_CORRUPT');

      for (const file of manifest.files) {
        if (!file.destinationConflict) continue;
        const destinationPath = this.folderPath(openLibrary, file.destinationConflict.relativePath);
        const holdingPath = this.moveConflictHoldingPath(openLibrary, file.destinationConflict);
        mkdirSync(path.dirname(holdingPath), { recursive: true });
        renameSync(destinationPath, holdingPath);
      }

      for (const file of manifest.files) {
        const sourcePath = this.folderPath(openLibrary, file.sourceRelativePath);
        const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
        mkdirSync(path.dirname(destinationPath), { recursive: true });
        copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL);
        copiedPaths.push(file.destinationRelativePath);
      }

      openLibrary.connection.transaction(() => {
        for (const file of manifest.files) {
          const conflict = file.destinationConflict;
          if (!conflict || conflict.kind !== 'managed' || !conflict.assetId || !conflict.trashFilename) {
            continue;
          }
          const trashRelativePath = `__trash__/${conflict.assetId}/${conflict.trashFilename}`;
          const changed = openLibrary.connection.prepare(
            `UPDATE assets SET relative_file_path = ?, managed_folder_id = NULL, path_identity = ?,
                    deleted_at = ?, trashed_from_relative_path = ?, trashed_from_folder_id = ?, updated_at = ?
              WHERE asset_id = ? AND deleted_at IS NULL`,
          ).run(
            trashRelativePath,
            portablePathIdentity(trashRelativePath),
            now,
            conflict.relativePath,
            conflict.managedFolderId,
            now,
            conflict.assetId,
          );
          if (changed.changes !== 1) {
            throw new LibraryServiceError('ASSET_MOVE_CONFLICT', { reason: 'SOURCE_CHANGED' });
          }
          this.syncAssetSearchContent(openLibrary.connection, conflict.assetId);
        }

        for (const file of manifest.files) {
          const destinationPath = this.folderPath(openLibrary, file.destinationRelativePath);
          const fileStat = lstatSync(destinationPath, { bigint: true });
          const fileByteSize = Number(fileStat.size);
          if (!Number.isSafeInteger(fileByteSize)) {
            throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
              reason: 'UNSUPPORTED_FILE_ENTRY',
            });
          }
          const fileModifiedAt = new Date(Number(fileStat.mtimeMs)).toISOString();
          const revisionId = randomUUID();
          const pathIdentity = portablePathIdentity(file.destinationRelativePath);
          openLibrary.connection.prepare(
            `INSERT INTO assets
               (asset_id, location_kind, managed_folder_id, relative_file_path,
                path_identity, current_revision_id, availability, created_at, updated_at)
             VALUES (?, 'managed', ?, ?, ?, NULL, 'available', ?, ?)`,
          ).run(
            file.newAssetId,
            file.destinationFolderId,
            file.destinationRelativePath,
            pathIdentity,
            now,
            now,
          );
          openLibrary.connection.prepare(
            `INSERT INTO revisions
               (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
                original_filename, origin, accepted_at)
             VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
          ).run(
            revisionId,
            file.newAssetId,
            fileByteSize,
            fileModifiedAt,
            path.posix.basename(file.destinationRelativePath),
            now,
          );
          openLibrary.connection.prepare(
            `UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?`,
          ).run(revisionId, now, file.newAssetId);

          const metadata = openLibrary.connection.prepare(
            `SELECT description, rating, favorite, palette, source_page_url, author
               FROM asset_metadata WHERE asset_id = ?`,
          ).get(file.sourceAssetId) as {
            description: string | null;
            rating: number;
            favorite: number;
            palette: string | null;
            source_page_url: string | null;
            author: string | null;
          } | undefined;
          if (metadata) {
            openLibrary.connection.prepare(
              `INSERT INTO asset_metadata
                 (asset_id, description, rating, favorite, palette,
                  source_page_url, author, entity_version, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            ).run(
              file.newAssetId,
              metadata.description,
              metadata.rating,
              metadata.favorite,
              metadata.palette,
              metadata.source_page_url,
              metadata.author,
              now,
            );
          }

          const tags = openLibrary.connection.prepare(
            'SELECT tag_id FROM human_asset_tags WHERE asset_id = ?',
          ).all(file.sourceAssetId) as Array<{ tag_id: string }>;
          const insertTag = openLibrary.connection.prepare(
            'INSERT OR IGNORE INTO human_asset_tags (asset_id, tag_id) VALUES (?, ?)',
          );
          for (const tag of tags) {
            insertTag.run(file.newAssetId, tag.tag_id);
          }

          this.syncAssetSearchContent(openLibrary.connection, file.newAssetId);
        }

        openLibrary.connection.prepare(
          "UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?",
        ).run(new Date().toISOString(), operationId);
      })();
    } catch (error) {
      for (const relativePath of copiedPaths.reverse()) {
        rmSync(this.folderPath(openLibrary, relativePath), { force: true });
      }
      for (const file of manifest.files) {
        if (!file.destinationConflict) continue;
        const holdingPath = this.moveConflictHoldingPath(openLibrary, file.destinationConflict);
        const restorePath = this.folderPath(openLibrary, file.destinationConflict.relativePath);
        if (existsSync(holdingPath) && !existsSync(restorePath)) {
          mkdirSync(path.dirname(restorePath), { recursive: true });
          renameSync(holdingPath, restorePath);
        }
      }
      openLibrary.connection.prepare(
        "UPDATE file_operations SET status = 'failed', error_code = 'COPY_APPLY_FAILED', updated_at = ? WHERE operation_id = ?",
      ).run(new Date().toISOString(), operationId);
      this.diagnose('asset.copy.rollback', error, {
        operationId,
        libraryId: openLibrary.summary.libraryId,
      });
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
  }

  /**
   * Read UTF-8 text for a text-classified asset with a hard byte cap (Serpent-sh7).
   * Linked assets are readable; only managed assets are editable via saveTextAsset.
   */
  readTextAsset(input: {
    libraryId: string;
    assetId: string;
    maxBytes?: number;
  }): {
    assetId: string;
    revisionId: string;
    content: string;
    truncated: boolean;
    byteSize: number;
    lineCount: number;
    editable: boolean;
    mimeType: string;
  } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const row = openLibrary.connection
      .prepare(
        `SELECT asset_id, location_kind, relative_file_path, current_revision_id,
                availability, deleted_at
           FROM assets WHERE asset_id = ?`,
      )
      .get(input.assetId) as {
        asset_id: string;
        location_kind: 'managed' | 'linked';
        relative_file_path: string;
        current_revision_id: string | null;
        availability: 'available' | 'missing';
        deleted_at: string | null;
      } | undefined;
    if (!row || row.deleted_at || row.availability !== 'available' || !row.current_revision_id) {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }
    if (LibraryService.detectMediaType(row.relative_file_path) !== 'text') {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION', { reason: 'UNSUPPORTED_FORMAT' });
    }

    const absolutePath = this.resolveAssetPath(input.libraryId, input.assetId);
    const maxBytes = Math.min(
      Math.max(1, input.maxBytes ?? TEXT_VIEWER_MAX_BYTES),
      TEXT_VIEWER_MAX_BYTES,
    );
    let buffer: Buffer;
    try {
      const fd = openSync(absolutePath, 'r');
      try {
        const stat = fstatSync(fd);
        const toRead = Math.min(Number(stat.size), maxBytes + 1);
        buffer = Buffer.alloc(toRead);
        const bytesRead = readSync(fd, buffer, 0, toRead, 0);
        buffer = buffer.subarray(0, bytesRead);
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      throw new LibraryServiceError('ASSET_NOT_FOUND', {
        reason: 'SOURCE_NOT_FOUND',
        cause: error,
      });
    }

    if (buffer.includes(0)) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION', { reason: 'UNSUPPORTED_FORMAT' });
    }

    const truncated = buffer.length > maxBytes;
    const slice = truncated ? buffer.subarray(0, maxBytes) : buffer;
    const content = slice.toString('utf8');
    const extension = path.extname(row.relative_file_path).toLowerCase();
    return {
      assetId: row.asset_id,
      revisionId: row.current_revision_id,
      content,
      truncated,
      byteSize: truncated ? maxBytes : buffer.length,
      lineCount: countTextLines(content),
      editable: row.location_kind === 'managed',
      mimeType: textMimeForExtension(extension) ?? 'text/plain',
    };
  }

  /**
   * Save UTF-8 text back to a managed asset source. Linked assets are rejected
   * with LIBRARY_NOT_WRITABLE so the UI can show a clear read-only reason.
   */
  saveTextAsset(input: {
    libraryId: string;
    assetId: string;
    content: string;
    expectedRevisionId?: string;
  }): {
    asset: AssetSummary;
    revisionId: string;
    byteSize: number;
    lineCount: number;
  } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    if (Buffer.byteLength(input.content, 'utf8') > TEXT_SAVE_MAX_BYTES) {
      throw new LibraryServiceError('INVALID_ASSET_METADATA');
    }

    const row = openLibrary.connection
      .prepare(
        `SELECT asset_id, location_kind, relative_file_path, current_revision_id,
                availability, deleted_at
           FROM assets WHERE asset_id = ?`,
      )
      .get(input.assetId) as {
        asset_id: string;
        location_kind: 'managed' | 'linked';
        relative_file_path: string;
        current_revision_id: string | null;
        availability: 'available' | 'missing';
        deleted_at: string | null;
      } | undefined;
    if (!row || row.deleted_at || row.availability !== 'available' || !row.current_revision_id) {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }
    if (row.location_kind !== 'managed') {
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE');
    }
    if (LibraryService.detectMediaType(row.relative_file_path) !== 'text') {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION', { reason: 'UNSUPPORTED_FORMAT' });
    }
    if (
      input.expectedRevisionId &&
      input.expectedRevisionId !== row.current_revision_id
    ) {
      throw new LibraryServiceError('VERSION_CONFLICT');
    }

    const absolutePath = this.resolveAssetPath(input.libraryId, input.assetId);
    const dir = path.dirname(absolutePath);
    const tmpPath = path.join(dir, `.serpent-text-edit-${randomUUID()}.tmp`);
    const payload = Buffer.from(input.content, 'utf8');
    try {
      writeFileSync(tmpPath, payload);
      const fd = openSync(tmpPath, 'r+');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmpPath, absolutePath);
    } catch (error) {
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        // Best-effort cleanup.
      }
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }

    const now = new Date().toISOString();
    const revisionId = row.current_revision_id;
    openLibrary.connection.transaction(() => {
      openLibrary.connection
        .prepare(
          `UPDATE revisions
              SET byte_size = ?, modified_at = ?
            WHERE revision_id = ?`,
        )
        .run(payload.length, now, revisionId);
      openLibrary.connection
        .prepare(`UPDATE assets SET updated_at = ? WHERE asset_id = ?`)
        .run(now, input.assetId);
      openLibrary.connection
        .prepare(
          `UPDATE revision_artifacts
              SET invalidated_at = ?
            WHERE revision_id = ?
              AND invalidated_at IS NULL`,
        )
        .run(now, revisionId);
      this.syncAssetSearchContent(openLibrary.connection, input.assetId);
    })();

    const [asset] = this.managedMoveSummaries(openLibrary, [input.assetId]);
    if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
    this.options.onAssetsChanged?.({
      type: 'asset.changed',
      libraryId: input.libraryId,
      changedCount: 1,
      missingCount: 0,
    });
    return {
      asset,
      revisionId,
      byteSize: payload.length,
      lineCount: countTextLines(input.content),
    };
  }

  /**
   * REQ-MENU-002 / REQ-LABEL-002: renaming an asset's display name IS renaming
   * its real file, so this goes through file-operation semantics. The
   * extension always stays as-is (Eagle behavior: a rename must never
   * reclassify the asset type). Only the base name changes, inside the same
   * directory, for both managed and online linked assets.
   *
   * Crash-safety convention follows trashAssets for single-scope file moves:
   * rename on disk first, then one DB transaction (path + FTS sync); on DB
   * failure the disk rename is rolled back best-effort. Content is untouched,
   * so — exactly like moveAssets/trashAssets — no revision row is recorded.
   */
  renameAssetFile(input: {
    libraryId: string;
    assetId: string;
    newBaseName: string;
  }): { asset: AssetSummary } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    let baseName: string;
    try {
      baseName = normalizeAssetFileBaseName(input.newBaseName);
    } catch (error) {
      throw new LibraryServiceError('INVALID_ASSET_FILE_NAME', {
        reason: 'NAME_NOT_SUPPORTED',
        cause: error,
      });
    }

    const row = openLibrary.connection
      .prepare(
        `SELECT asset_id, location_kind, linked_folder_id, relative_file_path,
                availability, deleted_at
           FROM assets
          WHERE asset_id = ?`,
      )
      .get(input.assetId) as {
        asset_id: string;
        location_kind: 'managed' | 'linked';
        linked_folder_id: string | null;
        relative_file_path: string;
        availability: 'available' | 'missing';
        deleted_at: string | null;
      } | undefined;
    if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');
    // Trashed, missing, and otherwise unavailable assets are rejected with the
    // same typed shape moveAssets uses for non-available sources.
    if (row.deleted_at !== null || row.availability !== 'available') {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }
    if (row.location_kind === 'linked') {
      const linkedFolder = openLibrary.connection
        .prepare('SELECT absolute_root_path, status FROM linked_folders WHERE folder_id = ?')
        .get(row.linked_folder_id) as {
          absolute_root_path: string;
          status: 'available' | 'offline';
        } | undefined;
      if (
        !linkedFolder ||
        linkedFolder.status !== 'available' ||
        this.linkedRootIsGone(linkedFolder.absolute_root_path)
      ) {
        throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
      }
    }

    const currentFileName = path.posix.basename(row.relative_file_path);
    const extension = path.posix.extname(currentFileName);
    const newFileName = `${baseName}${extension}`;
    // The filesystem limit applies to the whole component, not just the base.
    if (Buffer.byteLength(newFileName, 'utf8') > 255) {
      throw new LibraryServiceError('INVALID_ASSET_FILE_NAME', {
        reason: 'NAME_NOT_SUPPORTED',
        cause: new LibraryInputError(
          'INVALID_ASSET_FILE_NAME',
          'File name with its extension must not exceed 255 bytes.',
        ),
      });
    }
    const currentDirectory = path.posix.dirname(row.relative_file_path);
    const newRelativePath =
      currentDirectory === '.' ? newFileName : path.posix.join(currentDirectory, newFileName);

    // Identical target (same spelling, same case): success no-op, nothing on
    // disk or in the DB is touched.
    if (newFileName === currentFileName) {
      const [asset] = this.managedMoveSummaries(openLibrary, [row.asset_id]);
      if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
      return { asset };
    }

    const sourcePath = row.location_kind === 'managed'
      ? this.folderPath(openLibrary, row.relative_file_path)
      : this.linkedAssetPath(openLibrary, row.linked_folder_id, row.relative_file_path);
    if (!realFileExists(sourcePath)) {
      throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND' });
    }

    // Conflicts are judged by portable (case-folded) identity so a case-only
    // match against a DIFFERENT file is still a conflict on case-insensitive
    // volumes; the source file's own directory entry is exempt, which is what
    // makes a pure case-change rename (a.png -> A.png) possible.
    const newIdentity = portablePathIdentity(newRelativePath);
    const dbConflict = row.location_kind === 'managed'
      ? openLibrary.connection
          .prepare(
            `SELECT asset_id FROM assets
              WHERE path_identity = ? AND location_kind = 'managed'
                AND deleted_at IS NULL AND asset_id != ?`,
          )
          .get(newIdentity, row.asset_id)
      : openLibrary.connection
          .prepare(
            `SELECT asset_id FROM assets
              WHERE linked_folder_id = ? AND path_identity = ? AND location_kind = 'linked'
                AND deleted_at IS NULL AND asset_id != ?`,
          )
          .get(row.linked_folder_id, newIdentity, row.asset_id);
    if (dbConflict) throw new LibraryServiceError('ASSET_FILE_NAME_CONFLICT');

    const parentDirectoryPath = path.dirname(sourcePath);
    const targetSegmentIdentity = portablePathSegmentIdentity(newFileName);
    let directoryEntries;
    try {
      directoryEntries = readdirSync(parentDirectoryPath, { withFileTypes: true });
    } catch (error) {
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
    }
    for (const entry of directoryEntries) {
      if (entry.name === currentFileName) continue;
      if (portablePathSegmentIdentity(entry.name) === targetSegmentIdentity) {
        throw new LibraryServiceError('ASSET_FILE_NAME_CONFLICT');
      }
    }

    const destinationPath = path.join(parentDirectoryPath, newFileName);
    const now = new Date().toISOString();
    let renamed = false;
    try {
      renameSync(sourcePath, destinationPath);
      renamed = true;
      openLibrary.connection.transaction(() => {
        const changed = openLibrary.connection
          .prepare(
            `UPDATE assets
                SET relative_file_path = ?, path_identity = ?, updated_at = ?
              WHERE asset_id = ? AND deleted_at IS NULL`,
          )
          .run(newRelativePath, newIdentity, now, row.asset_id);
        if (changed.changes !== 1) {
          throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_CHANGED' });
        }
        this.syncAssetSearchContent(openLibrary.connection, row.asset_id);
      })();
    } catch (error) {
      if (renamed) {
        try {
          renameSync(destinationPath, sourcePath);
        } catch (rollbackError) {
          // The DB transaction did not commit; if the filesystem rollback also
          // failed the asset reconciles to 'missing' on the next refresh and
          // can be relinked. Never mask the primary failure.
          this.diagnose('asset.rename-file.rollback', rollbackError, {
            libraryId: input.libraryId,
            assetId: row.asset_id,
          });
        }
      }
      if (isMissingPathError(error)) {
        throw new LibraryServiceError('ASSET_NOT_FOUND', { reason: 'SOURCE_NOT_FOUND', cause: error });
      }
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }

    const [asset] = this.managedMoveSummaries(openLibrary, [row.asset_id]);
    if (!asset) throw new LibraryServiceError('ASSET_NOT_FOUND');
    return { asset };
  }

  trashAssets(input: {
    libraryId: string;
    assetIds: string[];
  }): { trashedCount: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const assetIds = input.assetIds;
    if (assetIds.length === 0 || new Set(assetIds).size !== assetIds.length) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    // Validate all assets are managed, active, and exist.
    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.relative_file_path, a.managed_folder_id
           FROM assets a
          WHERE a.asset_id IN (${assetIds.map(() => '?').join(',')})
            AND a.location_kind = 'managed'
            AND a.deleted_at IS NULL`,
      )
      .all(...assetIds) as Array<{
        asset_id: string;
        relative_file_path: string;
        managed_folder_id: string | null;
      }>;

    const foundIds = new Set(rows.map((r) => r.asset_id));
    for (const id of assetIds) {
      if (!foundIds.has(id)) {
        const exists = openLibrary.connection
          .prepare('SELECT location_kind, deleted_at FROM assets WHERE asset_id = ?')
          .get(id) as { location_kind: string; deleted_at: string | null } | undefined;
        if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
        if (exists.location_kind !== 'managed') throw new LibraryServiceError('INVALID_IMPORT_DECISION');
        if (exists.deleted_at !== null) throw new LibraryServiceError('INVALID_IMPORT_DECISION');
      }
    }

    const movedEntries: Array<{
      assetId: string;
      originalPath: string;
      trashName: string;
    }> = [];

    try {
      // Phase 1: move files to trash
      for (const row of rows) {
        const filename = path.posix.basename(row.relative_file_path);
        const sourcePath = this.folderPath(openLibrary, row.relative_file_path);
        const trashDir = path.join(openLibrary.summary.libraryPath, '.serpent', 'trash', row.asset_id);
        mkdirSync(trashDir, { recursive: true });
        const trashFilePath = path.join(trashDir, filename);
        renameSync(sourcePath, trashFilePath);
        movedEntries.push({
          assetId: row.asset_id,
          originalPath: sourcePath,
          trashName: filename,
        });
      }

      // Phase 2: write file_operations + update DB in a single transaction
      const operationId = randomUUID();
      const now = new Date().toISOString();
      const trashRelativePrefix = '__trash__';

      openLibrary.connection.transaction(() => {
        const manifest: OperationManifest = {
          version: 1,
          files: rows.map((row) => ({
            backupName: row.asset_id,
            destinationRelativePath: `${trashRelativePrefix}/${row.asset_id}/${path.posix.basename(row.relative_file_path)}`,
            hadDestination: false,
            stageName: row.asset_id,
          })),
          directories: [],
        };

        openLibrary.connection
          .prepare(
            `INSERT INTO file_operations
               (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
             VALUES (?, 'trash', 'committed', ?, NULL, ?, ?)`,
          )
          .run(operationId, JSON.stringify(manifest), now, now);

        for (const row of rows) {
          const filename = path.posix.basename(row.relative_file_path);
          const trashRelativePath = `${trashRelativePrefix}/${row.asset_id}/${filename}`;
          const trashPathIdentity = portablePathIdentity(trashRelativePath);

          openLibrary.connection
            .prepare(
              `UPDATE assets
                  SET relative_file_path = ?, managed_folder_id = NULL,
                      path_identity = ?, deleted_at = ?,
                      trashed_from_relative_path = ?, trashed_from_folder_id = ?,
                      updated_at = ?
                WHERE asset_id = ?`,
            )
            .run(
              trashRelativePath,
              trashPathIdentity,
              now,
              row.relative_file_path,
              row.managed_folder_id,
              now,
              row.asset_id,
            );
          this.syncAssetSearchContent(openLibrary.connection, row.asset_id);
        }
      })();

      return { trashedCount: rows.length };
    } catch (error) {
      // Rollback filesystem: move trashed files back
      for (const entry of [...movedEntries].reverse()) {
        try {
          const trashDir = path.join(openLibrary.summary.libraryPath, '.serpent', 'trash', entry.assetId);
          const trashFilePath = path.join(trashDir, entry.trashName);
          if (existsSync(trashFilePath)) {
            mkdirSync(path.dirname(entry.originalPath), { recursive: true });
            renameSync(trashFilePath, entry.originalPath);
          }
        } catch {
          // Best-effort rollback; the DB transaction was not committed.
        }
      }
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
  }

  restoreAssets(input: {
    libraryId: string;
    assetIds: string[];
    targetFolderId?: string | null;
    conflictStrategy?: 'keep-both' | 'replace' | 'skip';
  }): { restoredCount: number; assets: AssetSummary[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const assetIds = input.assetIds;
    if (assetIds.length === 0 || new Set(assetIds).size !== assetIds.length) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    // Validate all assets are trashed (deleted_at IS NOT NULL).
    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.relative_file_path, a.deleted_at,
                a.trashed_from_relative_path, a.trashed_from_folder_id, a.current_revision_id,
                r.byte_size, r.modified_at
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
          WHERE a.asset_id IN (${assetIds.map(() => '?').join(',')})
            AND a.deleted_at IS NOT NULL`,
      )
      .all(...assetIds) as Array<{
        asset_id: string;
        relative_file_path: string;
        deleted_at: string;
        trashed_from_relative_path: string;
        trashed_from_folder_id: string | null;
        current_revision_id: string;
        byte_size: number;
        modified_at: string;
      }>;

    const foundIds = new Set(rows.map((r) => r.asset_id));
    for (const id of assetIds) {
      if (!foundIds.has(id)) {
        const exists = openLibrary.connection
          .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
          .get(id);
        if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
        throw new LibraryServiceError('INVALID_IMPORT_DECISION');
      }
    }

    const rowById = new Map(rows.map((row) => [row.asset_id, row]));
    const orderedRows = assetIds.map((assetId) => rowById.get(assetId)!);

    // Resolve target folder
    const hasExplicitTarget = input.targetFolderId !== undefined;
    let targetFolder: ManagedFolderRow | undefined;
    if (typeof input.targetFolderId === 'string') {
      targetFolder = this.targetFolder(openLibrary, input.targetFolderId);
    }
    const conflictStrategy = input.conflictStrategy ?? 'keep-both';

    type RestorePlan = {
      assetId: string;
      backupDestinationRelativePath: string | null;
      backupName: string;
      conflictingAssetId: string | null;
      destinationRelativePath: string;
      managedFolderId: string | null;
      trashFilename: string;
    };
    const plans: RestorePlan[] = [];
    const plannedDestinations = new Set<string>();

    try {
      // Planning is side-effect free. The complete plan is persisted before the
      // first source or conflicting destination is moved.
      for (const row of orderedRows) {
        const filename = path.posix.basename(row.trashed_from_relative_path);
        const trashFilePath = this.trashPath(openLibrary, row.asset_id, filename);
        let trashEntry: Stats;
        try {
          trashEntry = lstatSync(trashFilePath);
        } catch (error) {
          if (!isMissingPathError(error)) throw error;
          throw new LibraryServiceError('ASSET_NOT_FOUND');
        }
        if (!trashEntry.isFile() || trashEntry.isSymbolicLink()) {
          throw new LibraryServiceError('LIBRARY_CORRUPT');
        }

        // Determine target folder path
        let targetFolderPath = '';
        let resolvedFolderId: string | null = null;
        if (targetFolder) {
          targetFolderPath = targetFolder.relative_path;
          resolvedFolderId = targetFolder.folder_id;
        } else if (!hasExplicitTarget && row.trashed_from_folder_id) {
          const origFolder = openLibrary.connection
            .prepare('SELECT folder_id, relative_path FROM managed_folders WHERE folder_id = ?')
            .get(row.trashed_from_folder_id) as { folder_id: string; relative_path: string } | undefined;
          if (origFolder) {
            targetFolderPath = origFolder.relative_path;
            resolvedFolderId = origFolder.folder_id;
          }
        }

        let destRelativePath = targetFolderPath
          ? path.posix.join(targetFolderPath, filename)
          : filename;

        // Handle name conflicts
        const destIdentity = portablePathIdentity(destRelativePath);
        let activeConflict = openLibrary.connection
          .prepare(
            `SELECT asset_id FROM assets
              WHERE path_identity = ? AND location_kind = 'managed'
                AND deleted_at IS NULL AND asset_id != ?`,
          )
          .get(destIdentity, row.asset_id) as { asset_id: string } | undefined;

        let diskConflict = this.portableDiskDestination(openLibrary, destRelativePath);
        const conflictsWithRestoreBatch = plannedDestinations.has(destIdentity);
        if ((activeConflict || diskConflict || conflictsWithRestoreBatch) && conflictStrategy === 'skip') {
          continue;
        }

        let backupDestinationRelativePath: string | null = null;
        let conflictingAssetId: string | null = null;
        if (
          (activeConflict || diskConflict)
          && !conflictsWithRestoreBatch
          && conflictStrategy === 'replace'
          && (!diskConflict || diskConflict.size >= 0)
        ) {
          const actualRelativePath = diskConflict?.actualRelativePath ?? destRelativePath;
          if (diskConflict) {
            backupDestinationRelativePath = actualRelativePath;
          }
          conflictingAssetId = activeConflict?.asset_id ?? null;
          activeConflict = undefined;
          diskConflict = undefined;
        }

        if (activeConflict || diskConflict || conflictsWithRestoreBatch) {
          // Keep both is the default. A duplicate destination inside the same
          // restore batch also receives a suffix so the batch remains atomic.
          const extension = path.posix.extname(filename);
          const baseName = extension.length === 0 ? filename : filename.slice(0, -extension.length);
          for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
            const candidateName = `${baseName} (${index})${extension}`;
            destRelativePath = targetFolderPath
              ? path.posix.join(targetFolderPath, candidateName)
              : candidateName;
            const candidateIdentity = portablePathIdentity(destRelativePath);
            const candidateConflict = openLibrary.connection
              .prepare(
                `SELECT asset_id FROM assets
                  WHERE path_identity = ? AND location_kind = 'managed'
                    AND deleted_at IS NULL AND asset_id != ?`,
              )
              .get(candidateIdentity, row.asset_id);
            if (
              !candidateConflict &&
              !plannedDestinations.has(candidateIdentity) &&
              this.portableDiskDestination(openLibrary, destRelativePath) === undefined
            ) {
              break;
            }
          }
        }

        plannedDestinations.add(portablePathIdentity(destRelativePath));
        plans.push({
          assetId: row.asset_id,
          backupDestinationRelativePath,
          backupName: String(plans.length),
          conflictingAssetId,
          destinationRelativePath: destRelativePath,
          managedFolderId: resolvedFolderId,
          trashFilename: filename,
        });
      }

      const operationId = randomUUID();
      const operationsPath = this.assertSafeOperationsRoot(openLibrary.summary.libraryPath);
      const operationPath = path.join(operationsPath, operationId);
      const backupPath = path.join(operationPath, 'backup');
      const manifest: RestoreOperationManifest = {
        version: 3,
        kind: 'restore',
        files: plans.map((plan) => ({
          assetId: plan.assetId,
          backupDestinationRelativePath: plan.backupDestinationRelativePath,
          backupName: plan.backupName,
          conflictingAssetId: plan.conflictingAssetId,
          destinationRelativePath: plan.destinationRelativePath,
          hadDestination: plan.backupDestinationRelativePath !== null,
          trashFilename: plan.trashFilename,
        })),
      };

      mkdirSync(backupPath, { recursive: true });
      this.assertSafeOperationPath(operationPath);
      const now = new Date().toISOString();
      openLibrary.connection
        .prepare(
          `INSERT INTO file_operations
             (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
           VALUES (?, 'restore', 'preparing', ?, NULL, ?, ?)`,
        )
        .run(operationId, JSON.stringify(manifest), now, now);

      try {
        this.failAt('crash-restore-before-filesystem');
        const applying = openLibrary.connection
          .prepare(
            "UPDATE file_operations SET status = 'applying', updated_at = ? WHERE operation_id = ? AND status = 'preparing'",
          )
          .run(new Date().toISOString(), operationId);
        if (applying.changes !== 1) throw new Error('Restore operation is not preparing.');

        for (const plan of plans) {
          if (plan.backupDestinationRelativePath === null) continue;
          const destinationPath = this.folderPath(openLibrary, plan.backupDestinationRelativePath);
          renameSync(destinationPath, path.join(backupPath, plan.backupName));
        }
        this.failAt('crash-restore-after-backup');

        for (const plan of plans) {
          const sourcePath = this.trashPath(openLibrary, plan.assetId, plan.trashFilename);
          const destinationPath = this.folderPath(openLibrary, plan.destinationRelativePath);
          mkdirSync(path.dirname(destinationPath), { recursive: true });
          renameSync(sourcePath, destinationPath);
        }
        this.failAt('crash-restore-after-filesystem');

        // The database mutation and committed marker share one SQLite commit.
        // Startup recovery therefore never has to guess whether DB state won.
        openLibrary.connection.transaction(() => {
          for (const plan of plans) {
            if (plan.conflictingAssetId) {
              openLibrary.connection.prepare('DELETE FROM assets WHERE asset_id = ?').run(plan.conflictingAssetId);
            }
          }
          for (const plan of plans) {
            const pathIdentity = portablePathIdentity(plan.destinationRelativePath);
            openLibrary.connection
              .prepare(
                `UPDATE assets
                    SET relative_file_path = ?, managed_folder_id = ?,
                        path_identity = ?, deleted_at = NULL,
                        trashed_from_relative_path = NULL, trashed_from_folder_id = NULL,
                        updated_at = ?
                  WHERE asset_id = ?`,
              )
              .run(
                plan.destinationRelativePath,
                plan.managedFolderId,
                pathIdentity,
                now,
                plan.assetId,
              );
            this.syncAssetSearchContent(openLibrary.connection, plan.assetId);
          }
          this.failAt('crash-restore-before-db-commit');
          openLibrary.connection
            .prepare("UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?")
            .run(new Date().toISOString(), operationId);
        })();
        this.failAt('crash-restore-after-db-commit');

        try {
          this.removeOperation(operationPath);
        } catch (error) {
          // The committed row makes cleanup retryable on the next open.
          this.diagnose('asset.restore.cleanup-operation', error, {
            libraryId: input.libraryId,
            operationId,
          });
        }
      } catch (error) {
        if (error instanceof SimulatedCrashError) {
          throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
        }

        const operation = openLibrary.connection
          .prepare('SELECT status, manifest_json, error_code, operation_id FROM file_operations WHERE operation_id = ?')
          .get(operationId) as OperationRow | undefined;
        if (operation?.status === 'committed') {
          this.diagnose('asset.restore.post-commit', error, { libraryId: input.libraryId, operationId });
        } else if (operation) {
          try {
            this.recoverRestoreOperation(openLibrary, operation, manifest, operationPath);
          } catch (recoveryError) {
            openLibrary.connection
              .prepare(
                "UPDATE file_operations SET status = 'failed', error_code = 'RESTORE_APPLY_FAILED', updated_at = ? WHERE operation_id = ?",
              )
              .run(new Date().toISOString(), operationId);
            this.diagnose('asset.restore.rollback', recoveryError, {
              libraryId: input.libraryId,
              operationId,
            });
          }
          throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
        } else {
          throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
        }
      }

      const restoredAssets: AssetSummary[] = [];
      for (const plan of plans) {
        const assetRow = openLibrary.connection
          .prepare(
            `SELECT a.asset_id, a.managed_folder_id, a.linked_folder_id, a.location_kind, a.relative_file_path,
                    a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                    COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
                    a.deleted_at, a.trashed_from_relative_path
               FROM assets a
               JOIN revisions r ON r.revision_id = a.current_revision_id
               LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
              WHERE a.asset_id = ?`,
          )
          .get(plan.assetId) as AssetSummaryRow & {
            deleted_at: string | null;
            trashed_from_relative_path: string | null;
          } | undefined;
        if (assetRow) restoredAssets.push(this.assetSummaryFromRow(assetRow));
      }

      return { restoredCount: plans.length, assets: restoredAssets };
    } catch (error) {
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
  }

  /**
   * Clarification #7 / Serpent-9zc: permanently delete active managed assets
   * from disk (not via app trash). Irreversible; shares confirm preference
   * with folder disk-delete.
   */
  deleteAssetsFromDisk(input: {
    libraryId: string;
    assetIds: string[];
  }): { deletedCount: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const assetIds = input.assetIds;
    if (assetIds.length === 0 || new Set(assetIds).size !== assetIds.length) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    const rows = openLibrary.connection
      .prepare(
        `SELECT asset_id, relative_file_path
           FROM assets
          WHERE asset_id IN (${assetIds.map(() => '?').join(',')})
            AND location_kind = 'managed'
            AND deleted_at IS NULL`,
      )
      .all(...assetIds) as Array<{
        asset_id: string;
        relative_file_path: string;
      }>;

    if (rows.length !== assetIds.length) {
      for (const id of assetIds) {
        const exists = openLibrary.connection
          .prepare(
            'SELECT asset_id, location_kind, deleted_at FROM assets WHERE asset_id = ?',
          )
          .get(id) as
          | { asset_id: string; location_kind: string; deleted_at: string | null }
          | undefined;
        if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
        if (exists.location_kind !== 'managed' || exists.deleted_at !== null) {
          throw new LibraryServiceError('INVALID_IMPORT_DECISION');
        }
      }
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    return {
      deletedCount: this.deleteActiveManagedAssetsFromDisk(openLibrary, assetIds),
    };
  }

  deleteAssetsPermanent(input: {
    libraryId: string;
    assetIds: string[];
  }): { deletedCount: number; skippedCount: number; skippedReasons: Array<{ assetId: string; reason: PublicErrorReason }> } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const assetIds = input.assetIds;
    if (assetIds.length === 0 || new Set(assetIds).size !== assetIds.length) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    const rows = openLibrary.connection
      .prepare(
        `SELECT asset_id, relative_file_path
           FROM assets
          WHERE asset_id IN (${assetIds.map(() => '?').join(',')})
            AND deleted_at IS NOT NULL`,
      )
      .all(...assetIds) as Array<{
        asset_id: string;
        relative_file_path: string;
      }>;

    if (rows.length !== assetIds.length) {
      // Validate the complete batch before touching the filesystem. A mixed
      // active/trashed or unknown batch must never partially delete the valid
      // subset while silently ignoring the rest.
      for (const id of assetIds) {
        const exists = openLibrary.connection
          .prepare('SELECT asset_id, deleted_at FROM assets WHERE asset_id = ?')
          .get(id) as { asset_id: string; deleted_at: string | null } | undefined;
        if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
        if (exists.deleted_at === null) throw new LibraryServiceError('INVALID_IMPORT_DECISION');
      }
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    let deletedCount = 0;
    const skippedReasons: Array<{ assetId: string; reason: PublicErrorReason }> = [];
    const deletedAssetIds: string[] = [];

    for (const row of rows) {
      // Remove trash directory
      const trashDir = path.join(openLibrary.summary.libraryPath, '.serpent', 'trash', row.asset_id);
      let skipReason: PublicErrorReason | undefined;
      try {
        (this.options.removeTrashPath ?? ((trashPath: string) => {
          rmSync(trashPath, { force: true, recursive: true });
        }))(trashDir);
      } catch (error) {
        if (isMissingPathError(error)) {
          // Already gone, proceed with DB delete
        } else {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'EBUSY') {
            skipReason = 'FILE_BUSY';
          } else if (code === 'EPERM' || code === 'EACCES') {
            skipReason = 'PERMISSION_DENIED';
          } else {
            throw error;
          }
        }
      }

      if (skipReason) {
        skippedReasons.push({ assetId: row.asset_id, reason: skipReason });
        this.diagnose(
          'asset.delete-permanent.skip',
          new LibraryServiceError('LIBRARY_NOT_WRITABLE', { reason: skipReason }),
          { libraryId: input.libraryId, assetId: row.asset_id },
        );
      } else {
        deletedAssetIds.push(row.asset_id);
      }
    }

    // Delete DB rows (cascades to revisions, metadata, tags, collections)
    if (deletedAssetIds.length > 0) {
      openLibrary.connection.transaction(() => {
        for (const assetId of deletedAssetIds) {
          openLibrary.connection
            .prepare('DELETE FROM assets WHERE asset_id = ?')
            .run(assetId);
        }
      })();
      deletedCount = deletedAssetIds.length;
    }

    this.syncTrashedFolderTombstones(openLibrary);

    return {
      deletedCount,
      skippedCount: rows.length - deletedCount,
      skippedReasons,
    };
  }

  private syncTrashedFolderTombstones(openLibrary: OpenLibrary): void {
    openLibrary.connection.transaction(() => {
      // Serpent-b3kf / gz4y: managed_folders DELETE SET NULL clears
      // trashed_from_folder_id, so count by path prefix as well.
      openLibrary.connection
        .prepare(
          `UPDATE trashed_managed_folders
              SET trashed_asset_count = (
                SELECT COUNT(*)
                  FROM assets
                 WHERE deleted_at IS NOT NULL
                   AND (
                     trashed_from_folder_id = trashed_managed_folders.folder_id
                     OR trashed_from_relative_path = trashed_managed_folders.relative_path
                     OR trashed_from_relative_path LIKE
                          (trashed_managed_folders.relative_path || '/%')
                   )
              )`,
        )
        .run();
      openLibrary.connection
        .prepare(
          `DELETE FROM trashed_managed_folders WHERE trashed_asset_count = 0`,
        )
        .run();
    })();
  }

  /**
   * Recreate managed folder rows (and disk paths) from trash tombstones, then
   * restore trashed assets that belonged to the subtree (Serpent-qufh).
   */
  restoreTrashedManagedFolder(input: {
    libraryId: string;
    tombstoneId: string;
  }): {
    restoredFolderCount: number;
    restoredAssetCount: number;
    folders: ManagedFolderSummary[];
  } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const root = openLibrary.connection
      .prepare(
        `SELECT tombstone_id, folder_id, relative_path, name, parent_relative_path,
                trashed_at, trashed_asset_count
           FROM trashed_managed_folders
          WHERE tombstone_id = ?`,
      )
      .get(input.tombstoneId) as
      | {
          tombstone_id: string;
          folder_id: string;
          relative_path: string;
          name: string;
          parent_relative_path: string | null;
          trashed_at: string;
          trashed_asset_count: number;
        }
      | undefined;
    if (!root) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    const tombstones = openLibrary.connection
      .prepare(
        `SELECT tombstone_id, folder_id, relative_path, name, parent_relative_path,
                trashed_at, trashed_asset_count
           FROM trashed_managed_folders
          WHERE trashed_at = ?
            AND (relative_path = ? OR substr(relative_path, 1, ?) = ?)
          ORDER BY length(relative_path) ASC`,
      )
      .all(
        root.trashed_at,
        root.relative_path,
        root.relative_path.length + 1,
        `${root.relative_path}/`,
      ) as Array<{
        tombstone_id: string;
        folder_id: string;
        relative_path: string;
        name: string;
        parent_relative_path: string | null;
        trashed_at: string;
        trashed_asset_count: number;
      }>;

    const folderIds = tombstones.map((row) => row.folder_id);

    // Serpent-gz4y: resolve assets before recreating folders so a match miss
    // cannot leave an empty restored folder + deleted tombstones.
    const restoreAssetIds: string[] = [];
    const seenRestoreAssetIds = new Set<string>();
    const rememberRestoreAssetId = (assetId: string) => {
      if (seenRestoreAssetIds.has(assetId)) return;
      seenRestoreAssetIds.add(assetId);
      restoreAssetIds.push(assetId);
    };

    if (folderIds.length > 0) {
      const byFolderId = openLibrary.connection
        .prepare(
          `SELECT asset_id FROM assets
            WHERE deleted_at IS NOT NULL
              AND trashed_from_folder_id IN (${folderIds.map(() => '?').join(', ')})`,
        )
        .all(...folderIds) as Array<{ asset_id: string }>;
      for (const row of byFolderId) rememberRestoreAssetId(row.asset_id);
    }

    const folderIdSet = new Set(folderIds);
    const tombstoneRelativePaths = tombstones.map((row) => row.relative_path);
    const trashedAssetRows = openLibrary.connection
      .prepare(
        `SELECT asset_id, trashed_from_relative_path, trashed_from_folder_id
           FROM assets
          WHERE deleted_at IS NOT NULL`,
      )
      .all() as Array<{
        asset_id: string;
        trashed_from_relative_path: string | null;
        trashed_from_folder_id: string | null;
      }>;
    for (const row of trashedAssetRows) {
      if (
        row.trashed_from_folder_id !== null &&
        folderIdSet.has(row.trashed_from_folder_id)
      ) {
        rememberRestoreAssetId(row.asset_id);
        continue;
      }
      if (!row.trashed_from_relative_path) continue;
      const parentPath = path.posix.dirname(row.trashed_from_relative_path);
      const matchesSubtree = tombstoneRelativePaths.some(
        (folderPath) =>
          parentPath === folderPath ||
          parentPath.startsWith(`${folderPath}/`) ||
          row.trashed_from_relative_path === folderPath ||
          row.trashed_from_relative_path!.startsWith(`${folderPath}/`),
      );
      if (matchesSubtree) rememberRestoreAssetId(row.asset_id);
    }

    const expectedAssetCount = tombstones.reduce(
      (sum, row) => sum + row.trashed_asset_count,
      0,
    );
    if (expectedAssetCount > 0 && restoreAssetIds.length === 0) {
      throw new LibraryServiceError('ASSET_NOT_FOUND', {
        reason: 'SOURCE_CHANGED',
      });
    }

    const restoredFolders: ManagedFolderSummary[] = [];
    const now = new Date().toISOString();

    try {
      openLibrary.connection.transaction(() => {
        for (const row of tombstones) {
          const existing = openLibrary.connection
            .prepare(
              'SELECT folder_id FROM managed_folders WHERE folder_id = ?',
            )
            .get(row.folder_id) as { folder_id: string } | undefined;
          if (existing) {
            const inserted = openLibrary.connection
              .prepare(
                'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
              )
              .get(row.folder_id) as ManagedFolderRow;
            restoredFolders.push(
              this.summarizeManagedFolderRow(
                openLibrary,
                inserted,
                this.managedFolderCountMaps(openLibrary, [row.folder_id]),
              ),
            );
            continue;
          }

          let parentFolderId: string | null = null;
          if (row.parent_relative_path) {
            const parent = openLibrary.connection
              .prepare(
                'SELECT folder_id FROM managed_folders WHERE relative_path = ?',
              )
              .get(row.parent_relative_path) as { folder_id: string } | undefined;
            if (!parent) {
              throw new LibraryServiceError('FOLDER_NOT_FOUND', {
                reason: 'SOURCE_CHANGED',
              });
            }
            parentFolderId = parent.folder_id;
          }

          const targetPath = this.folderPath(openLibrary, row.relative_path);
          const pathIdentity = portablePathIdentity(row.relative_path);
          const conflict =
            openLibrary.connection
              .prepare('SELECT folder_id FROM managed_folders WHERE path_identity = ?')
              .get(pathIdentity) ??
            openLibrary.connection
              .prepare(
                'SELECT asset_id FROM assets WHERE path_identity = ? AND deleted_at IS NULL',
              )
              .get(pathIdentity) ??
            this.portableDiskDestination(openLibrary, row.relative_path);
          if (conflict) {
            throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');
          }

          mkdirSync(targetPath, { recursive: true });
          openLibrary.connection
            .prepare(
              `INSERT INTO managed_folders
                 (folder_id, parent_folder_id, name, relative_path, path_identity, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              row.folder_id,
              parentFolderId,
              row.name,
              row.relative_path,
              pathIdentity,
              now,
            );
          const inserted = openLibrary.connection
            .prepare(
              'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders WHERE folder_id = ?',
            )
            .get(row.folder_id) as ManagedFolderRow;
          restoredFolders.push(
            this.summarizeManagedFolderRow(
              openLibrary,
              inserted,
              this.managedFolderCountMaps(openLibrary, [row.folder_id]),
            ),
          );
        }
      })();
    } catch (error) {
      if (error instanceof LibraryServiceError) throw error;
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }

    let restoredAssetCount = 0;
    try {
      if (restoreAssetIds.length > 0) {
        const result = this.restoreAssets({
          libraryId: input.libraryId,
          assetIds: restoreAssetIds,
        });
        restoredAssetCount = result.restoredCount;
      }
    } catch (error) {
      // Folders may already exist on disk/DB; keep tombstones so the user can
      // retry instead of orphaning trashed assets without folder metadata.
      throw error instanceof LibraryServiceError
        ? error
        : serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }

    if (tombstones.length > 0) {
      openLibrary.connection
        .prepare(
          `DELETE FROM trashed_managed_folders
            WHERE tombstone_id IN (${tombstones.map(() => '?').join(', ')})`,
        )
        .run(...tombstones.map((row) => row.tombstone_id));
    }

    return {
      restoredFolderCount: tombstones.length,
      restoredAssetCount,
      folders: restoredFolders,
    };
  }

  /** Permanently delete trashed assets by id; shared by emptyTrash and purgeExpiredTrash. */
  private purgeTrashedAssetsById(
    libraryId: string,
    assetIds: string[],
  ): {
    purgedCount: number;
    skippedCount: number;
    failures: Array<{ assetId: string; reason: PublicErrorReason }>;
  } {
    let purgedCount = 0;
    let skippedCount = 0;
    const failures: Array<{ assetId: string; reason: PublicErrorReason }> = [];

    for (const assetId of assetIds) {
      const result = this.deleteAssetsPermanent({ libraryId, assetIds: [assetId] });
      purgedCount += result.deletedCount;
      skippedCount += result.skippedCount;
      failures.push(...result.skippedReasons);
    }

    return { purgedCount, skippedCount, failures };
  }

  /** Permanently delete every item currently in Trash (user-initiated empty). */
  emptyTrash(libraryId: string): {
    purgedCount: number;
    skippedCount: number;
    failures: Array<{ assetId: string; reason: PublicErrorReason }>;
  } {
    const openLibrary = this.requireOpenLibrary(libraryId);

    const rows = openLibrary.connection
      .prepare(`SELECT asset_id FROM assets WHERE deleted_at IS NOT NULL`)
      .all() as Array<{ asset_id: string }>;

    const result = this.purgeTrashedAssetsById(
      libraryId,
      rows.map((row) => row.asset_id),
    );

    // Serpent-b3kf: never wipe all tombstones when some assets remain in trash.
    if (result.skippedCount === 0) {
      openLibrary.connection.prepare('DELETE FROM trashed_managed_folders').run();
    } else {
      this.syncTrashedFolderTombstones(openLibrary);
    }

    return result;
  }

  purgeExpiredTrash(libraryId: string): {
    purgedCount: number;
    skippedCount: number;
    failures: Array<{ assetId: string; reason: PublicErrorReason }>;
  } {
    const openLibrary = this.requireOpenLibrary(libraryId);

    const expiryDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rows = openLibrary.connection
      .prepare(
        `SELECT asset_id FROM assets WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
      )
      .all(expiryDate) as Array<{ asset_id: string }>;

    if (rows.length === 0) return { purgedCount: 0, skippedCount: 0, failures: [] };

    const result = this.purgeTrashedAssetsById(
      libraryId,
      rows.map((row) => row.asset_id),
    );

    openLibrary.connection
      .prepare('DELETE FROM trashed_managed_folders WHERE trashed_at < ?')
      .run(expiryDate);

    return result;
  }

  listTrashedFolders(libraryId: string): TrashedFolderSummary[] {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const rows = openLibrary.connection
      .prepare(
        `SELECT tombstone_id, folder_id, relative_path, name, parent_relative_path,
                trashed_at, trashed_asset_count
           FROM trashed_managed_folders
          ORDER BY trashed_at DESC, relative_path COLLATE NOCASE`,
      )
      .all() as Array<{
        tombstone_id: string;
        folder_id: string;
        relative_path: string;
        name: string;
        parent_relative_path: string | null;
        trashed_at: string;
        trashed_asset_count: number;
      }>;

    return rows.map((row) => ({
      tombstoneId: row.tombstone_id,
      folderId: row.folder_id,
      relativePath: row.relative_path,
      name: row.name,
      parentRelativePath: row.parent_relative_path,
      trashedAt: row.trashed_at,
      assetCount: row.trashed_asset_count,
    }));
  }

  listTrash(libraryId: string): AssetSummary[] {
    const openLibrary = this.requireOpenLibrary(libraryId);

    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.managed_folder_id, a.linked_folder_id, a.location_kind, a.relative_file_path,
                a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
                a.deleted_at, a.trashed_from_relative_path
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
          WHERE a.deleted_at IS NOT NULL
          ORDER BY a.deleted_at DESC`,
      )
      .all() as Array<AssetSummaryRow & {
        deleted_at: string | null;
        trashed_from_relative_path: string | null;
      }>;

    // Expose the same thumbnail state as the trash search scope so every
    // trash listing path can render a preview for a trashed asset.
    const artifactMap = this.thumbnailArtifactMap(
      libraryId,
      rows.map((row) => row.asset_id),
    );
    return rows.map((row) => {
      const artifact = artifactMap.get(row.asset_id);
      const detectedMediaType = LibraryService.detectMediaType(row.relative_file_path);
      return this.assetSummaryFromRow({
        ...row,
        thumbnail_status: artifact?.status ?? null,
        thumbnail_artifact_id: artifact?.artifactId ?? null,
        artifact_width: artifact?.width ?? null,
        artifact_height: artifact?.height ?? null,
        artifact_duration_ms: artifact?.durationMs ?? null,
        media_type: LibraryService.toSummaryMediaType(detectedMediaType),
      });
    });
  }

  async deleteLinkedAssets(input: {
    libraryId: string;
    assetIds: string[];
    deleteSourceFile: boolean;
  }): Promise<{
    deletedCount: number;
    failedCount: number;
    failures: Array<{ assetId: string; reason: PublicErrorReason }>;
  }> {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    if (input.assetIds.length === 0 || input.assetIds.length > 20) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }
    if (new Set(input.assetIds).size !== input.assetIds.length) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.linked_folder_id, a.relative_file_path
           FROM assets a
          WHERE a.asset_id IN (${input.assetIds.map(() => '?').join(',')})
            AND a.location_kind = 'linked'
            AND a.deleted_at IS NULL`,
      )
      .all(...input.assetIds) as Array<{
        asset_id: string;
        linked_folder_id: string;
        relative_file_path: string;
      }>;

    const foundIds = new Set(rows.map((r) => r.asset_id));
    for (const id of input.assetIds) {
      if (!foundIds.has(id)) {
        const exists = openLibrary.connection
          .prepare('SELECT location_kind FROM assets WHERE asset_id = ?')
          .get(id) as { location_kind: string } | undefined;
        if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
        throw new LibraryServiceError('INVALID_IMPORT_DECISION');
      }
    }

    const rowById = new Map(rows.map((row) => [row.asset_id, row]));
    const orderedRows = input.assetIds.map((assetId) => rowById.get(assetId)!);

    if (!input.deleteSourceFile) {
      openLibrary.connection.transaction(() => {
        for (const row of orderedRows) {
          openLibrary.connection
            .prepare('DELETE FROM assets WHERE asset_id = ?')
            .run(row.asset_id);
        }
      })();
      return { deletedCount: orderedRows.length, failedCount: 0, failures: [] };
    }

    const trashItem = this.options.trashItem ?? defaultTrashItem;
    const operationId = randomUUID();
    const now = new Date().toISOString();
    const manifest: LinkedTrashOperationManifest = {
      version: 2,
      kind: 'linked-trash',
      assetIds: orderedRows.map((row) => row.asset_id),
      inFlightAssetId: null,
      trashedAssetIds: [],
    };
    const trashedRows: typeof orderedRows = [];
    const failures: Array<{ assetId: string; reason: PublicErrorReason }> = [];

    openLibrary.connection
      .prepare(
        `INSERT INTO file_operations
           (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
         VALUES (?, 'delete-linked-source', 'applying', ?, NULL, ?, ?)`,
      )
      .run(operationId, JSON.stringify(manifest), now, now);

    for (const row of orderedRows) {
      let sourcePath: string | undefined;
      let trashAttempted = false;
      try {
        manifest.inFlightAssetId = row.asset_id;
        openLibrary.connection
          .prepare('UPDATE file_operations SET manifest_json = ?, updated_at = ? WHERE operation_id = ?')
          .run(JSON.stringify(manifest), new Date().toISOString(), operationId);
        sourcePath = this.linkedAssetPath(
          openLibrary,
          row.linked_folder_id,
          row.relative_file_path,
        );
        const sourceEntry = lstatSync(sourcePath);
        if (sourceEntry.isSymbolicLink() || !sourceEntry.isFile()) {
          throw new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
            reason: 'UNSUPPORTED_FILE_ENTRY',
          });
        }
        trashAttempted = true;
        await trashItem(sourcePath);
        if (existsSync(sourcePath)) {
          throw new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
            reason: 'SOURCE_TRASH_FAILED',
          });
        }
        manifest.trashedAssetIds.push(row.asset_id);
        manifest.inFlightAssetId = null;
        openLibrary.connection
          .prepare('UPDATE file_operations SET manifest_json = ?, updated_at = ? WHERE operation_id = ?')
          .run(JSON.stringify(manifest), new Date().toISOString(), operationId);
      } catch (error) {
        const linkedFolder = openLibrary.connection
          .prepare('SELECT absolute_root_path, status FROM linked_folders WHERE folder_id = ?')
          .get(row.linked_folder_id) as {
            absolute_root_path: string;
            status: 'available' | 'offline';
          } | undefined;
        const linkedRootOnline = linkedFolder?.status === 'available' &&
          !this.linkedRootIsGone(linkedFolder.absolute_root_path);
        const sourceMissing = trashAttempted && sourcePath !== undefined && !existsSync(sourcePath);
        const sourceWasTrashed = manifest.trashedAssetIds.includes(row.asset_id) ||
          (sourceMissing && linkedRootOnline);
        const sourceStateUncertain = sourceMissing && !linkedRootOnline;
        if (sourceWasTrashed && !manifest.trashedAssetIds.includes(row.asset_id)) {
          manifest.trashedAssetIds.push(row.asset_id);
        }
        manifest.inFlightAssetId = sourceStateUncertain ? row.asset_id : null;
        try {
          openLibrary.connection
            .prepare('UPDATE file_operations SET manifest_json = ?, updated_at = ? WHERE operation_id = ?')
            .run(JSON.stringify(manifest), new Date().toISOString(), operationId);
        } catch {
          // The applying journal remains authoritative. Recovery only infers a
          // trashed in-flight item while its linked root is confirmed online.
        }
        if (sourceWasTrashed || sourceStateUncertain) {
          const failure = new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
            cause: error,
            reason: 'SOURCE_TRASH_RECONCILIATION_REQUIRED',
          });
          this.diagnose('asset.delete-linked.persist-trash-progress', failure, {
            operationId,
            libraryId: input.libraryId,
            assetId: row.asset_id,
          });
          throw failure;
        }
        const failure = error instanceof LibraryServiceError
          && error.code === 'ASSET_SOURCE_TRASH_FAILED'
          ? error
          : new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
              cause: error,
              reason: publicReasonFromError(error) ?? 'SOURCE_TRASH_FAILED',
            });
        const reason = failure.reason ?? 'SOURCE_TRASH_FAILED';
        failures.push({ assetId: row.asset_id, reason });
        this.diagnose('asset.delete-linked.trash-source', failure, {
          operationId,
          libraryId: input.libraryId,
          assetId: row.asset_id,
        });
        continue;
      }
      trashedRows.push(row);
    }

    try {
      openLibrary.connection.transaction(() => {
        for (const row of trashedRows) {
          openLibrary.connection
            .prepare('DELETE FROM assets WHERE asset_id = ?')
            .run(row.asset_id);
        }
        openLibrary.connection
          .prepare(
            `UPDATE file_operations
                SET status = 'committed', manifest_json = ?, error_code = NULL, updated_at = ?
              WHERE operation_id = ?`,
          )
          .run(JSON.stringify(manifest), new Date().toISOString(), operationId);
      })();
    } catch (error) {
      const failure = new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
        cause: error,
        reason: 'SOURCE_TRASH_RECONCILIATION_REQUIRED',
      });
      this.diagnose('asset.delete-linked.delete-records', failure, {
        operationId,
        libraryId: input.libraryId,
        sourceTrashedAssetIds: trashedRows.map((row) => row.asset_id),
      });
      throw failure;
    }

    const deletedAssetIds = trashedRows.map((row) => row.asset_id);

    if (failures.length > 0) {
      this.diagnose(
        'asset.delete-linked.partial-failure',
        new LibraryServiceError('ASSET_SOURCE_TRASH_FAILED', {
          reason: failures[0]!.reason,
        }),
        {
          operationId,
          libraryId: input.libraryId,
          succeededAssetIds: deletedAssetIds,
          failedAssetIds: failures.map(({ assetId }) => assetId),
        },
      );
    }

    return {
      deletedCount: deletedAssetIds.length,
      failedCount: failures.length,
      failures,
    };
  }

  relinkAsset(input: {
    libraryId: string;
    assetId: string;
    newAbsolutePath: string;
  }): { asset: AssetSummary } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    // Validate asset is missing and not trashed
    const assetRow = openLibrary.connection
      .prepare(
        `SELECT asset_id, location_kind, managed_folder_id, linked_folder_id,
                relative_file_path, current_revision_id, availability, deleted_at
           FROM assets WHERE asset_id = ?`,
      )
      .get(input.assetId) as {
        asset_id: string;
        location_kind: 'managed' | 'linked';
        managed_folder_id: string | null;
        linked_folder_id: string | null;
        relative_file_path: string;
        current_revision_id: string | null;
        availability: 'available' | 'missing';
        deleted_at: string | null;
      } | undefined;
    if (!assetRow) throw new LibraryServiceError('ASSET_NOT_FOUND');
    if (assetRow.deleted_at !== null) throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    if (assetRow.availability !== 'missing') throw new LibraryServiceError('INVALID_IMPORT_DECISION');

    // Validate new file
    let newPath: string;
    try {
      newPath = normalizeAbsolutePath(input.newAbsolutePath);
    } catch (error) {
      throw serviceError(error, 'INVALID_IMPORT_SOURCE');
    }

    if (!realFileExists(newPath)) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: 'UNSUPPORTED_FILE_ENTRY',
      });
    }

    // Reject if in managed space
    this.assertNotInManagedSpace(openLibrary, newPath);
    this.assertNoSymlinkEscape(newPath);

    let managedPlacement:
      | {
          destinationPath: string;
          operationPath: string;
          placedIdentity: ManagedRelinkPlacementIdentity;
          stat: Stats;
        }
      | undefined;
    let fileStat: Stats;
    try {
      fileStat = assetRow.location_kind === 'managed'
        ? (managedPlacement = this.placeManagedRelinkFile(
            openLibrary,
            newPath,
            assetRow.relative_file_path,
          )).stat
        : statSync(newPath);
    } catch (error) {
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }

    const now = new Date().toISOString();
    let resolvedRelativePath = assetRow.relative_file_path;

    // For linked assets, verify the file is within the linked root
    if (assetRow.location_kind === 'linked') {
      if (!assetRow.linked_folder_id) throw new LibraryServiceError('LIBRARY_CORRUPT');
      const linkedFolder = openLibrary.connection
        .prepare('SELECT absolute_root_path FROM linked_folders WHERE folder_id = ?')
        .get(assetRow.linked_folder_id) as { absolute_root_path: string } | undefined;
      if (!linkedFolder) throw new LibraryServiceError('LIBRARY_CORRUPT');
      let canonicalRoot: string;
      let canonicalNew: string;
      try {
        canonicalRoot = realpathSync(linkedFolder.absolute_root_path);
        canonicalNew = realpathSync(newPath);
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          cause: error,
          reason: 'SOURCE_NOT_FOUND',
        });
      }
      const relation = path.relative(canonicalRoot, canonicalNew);
      if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'NAME_NOT_SUPPORTED',
        });
      }
      resolvedRelativePath = normalizeRelativeAssetPath(relation.split(path.sep).join('/'));
    }
    const originalFilename = path.posix.basename(resolvedRelativePath);

    try {
      openLibrary.connection.transaction(() => {
        this.failAt('crash-relink-after-filesystem');
        const revisionId = randomUUID();
        openLibrary.connection
          .prepare(
            `INSERT INTO revisions
               (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
                original_filename, origin, accepted_at)
             VALUES (?, ?, ?, ?, ?, ?, 'relink', ?)`,
          )
          .run(
            revisionId,
            input.assetId,
            assetRow.current_revision_id ?? null,
            fileStat.size,
            fileStat.mtime.toISOString(),
            originalFilename,
            now,
          );

        openLibrary.connection
          .prepare(
            `UPDATE assets
                SET current_revision_id = ?, availability = 'available',
                    relative_file_path = ?, path_identity = ?, updated_at = ?
              WHERE asset_id = ?`,
          )
          .run(
            revisionId,
            resolvedRelativePath,
            portablePathIdentity(resolvedRelativePath),
            now,
            input.assetId,
          );

        if (assetRow.current_revision_id) {
          openLibrary.connection
            .prepare(
              `UPDATE revision_artifacts
                  SET invalidated_at = ?
                WHERE revision_id = ? AND invalidated_at IS NULL`,
            )
            .run(now, assetRow.current_revision_id);
        }
        openLibrary.connection
          .prepare(
            `INSERT OR IGNORE INTO jobs
               (job_id, library_id, asset_id, revision_id, kind, status, priority,
                progress, attempt_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', 0, 0.0, 0, ?, ?)`,
          )
          .run(randomUUID(), input.libraryId, input.assetId, revisionId, now, now);

        this.syncAssetSearchContent(openLibrary.connection, input.assetId);
        this.failAt('crash-relink-before-db-commit');
      })();
      this.failAt('crash-relink-after-db-commit');
    } catch (error) {
      if (managedPlacement && !(error instanceof SimulatedCrashError)) {
        this.cleanupManagedRelinkPlacement(managedPlacement, true);
      }
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
    if (managedPlacement) this.cleanupManagedRelinkPlacement(managedPlacement, false);

    // Fetch the updated asset
    const updated = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.managed_folder_id, a.linked_folder_id, a.location_kind, a.relative_file_path,
                a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
                a.deleted_at, a.trashed_from_relative_path
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
          WHERE a.asset_id = ?`,
      )
      .get(input.assetId) as AssetSummaryRow & {
        deleted_at: string | null;
        trashed_from_relative_path: string | null;
      } | undefined;
    if (!updated) throw new LibraryServiceError('ASSET_NOT_FOUND');

    return { asset: this.assetSummaryFromRow(updated) };
  }

  private batchRelinkRows(openLibrary: OpenLibrary): BatchRelinkAssetRow[] {
    return openLibrary.connection
      .prepare(
        `SELECT asset_id, location_kind, linked_folder_id, managed_folder_id,
                relative_file_path, current_revision_id
           FROM assets
          WHERE availability = 'missing' AND deleted_at IS NULL
          ORDER BY relative_file_path`,
      )
      .all() as BatchRelinkAssetRow[];
  }

  private batchRelinkMatches(
    openLibrary: OpenLibrary,
    newRoot: string,
    rows: BatchRelinkAssetRow[],
  ): Map<string, BatchRelinkMatch> {
    const proposed = new Map<string, BatchRelinkMatch & { candidateIdentity: string }>();
    const candidateUseCount = new Map<string, number>();

    for (const asset of rows) {
      const segments = asset.relative_file_path.split('/');
      let matchedPath: string | undefined;
      for (let n = Math.min(segments.length, 5); n >= 1; n -= 1) {
        const candidatePath = path.join(newRoot, ...segments.slice(-n));
        try {
          const entry = lstatSync(candidatePath);
          if (entry.isFile() && !entry.isSymbolicLink()) {
            matchedPath = realpathSync(candidatePath);
            break;
          }
        } catch {
          // Continue trying a shorter suffix.
        }
      }
      if (!matchedPath) continue;

      let resolvedRelativePath = asset.relative_file_path;
      if (asset.location_kind === 'linked') {
        if (!asset.linked_folder_id) continue;
        const linkedFolder = openLibrary.connection
          .prepare('SELECT absolute_root_path FROM linked_folders WHERE folder_id = ?')
          .get(asset.linked_folder_id) as { absolute_root_path: string } | undefined;
        if (!linkedFolder) continue;
        try {
          const canonicalRoot = realpathSync(linkedFolder.absolute_root_path);
          const relation = path.relative(canonicalRoot, matchedPath);
          if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
            continue;
          }
          resolvedRelativePath = normalizeRelativeAssetPath(relation.split(path.sep).join('/'));
        } catch {
          continue;
        }
        const identityConflict = openLibrary.connection
          .prepare(
            `SELECT asset_id FROM assets
              WHERE linked_folder_id = ? AND path_identity = ?
                AND deleted_at IS NULL AND asset_id != ?`,
          )
          .get(
            asset.linked_folder_id,
            portablePathIdentity(resolvedRelativePath),
            asset.asset_id,
          );
        if (identityConflict) continue;
      }

      const candidateIdentity = matchedPath.normalize('NFC');
      proposed.set(asset.asset_id, { matchedPath, resolvedRelativePath, candidateIdentity });
      candidateUseCount.set(candidateIdentity, (candidateUseCount.get(candidateIdentity) ?? 0) + 1);
    }

    const matches = new Map<string, BatchRelinkMatch>();
    for (const [assetId, match] of proposed) {
      // One physical candidate must never be rebound to multiple asset
      // identities merely because their final basenames are equal.
      if (candidateUseCount.get(match.candidateIdentity) !== 1) continue;
      matches.set(assetId, {
        matchedPath: match.matchedPath,
        resolvedRelativePath: match.resolvedRelativePath,
      });
    }
    return matches;
  }

  relinkBatchPreview(input: {
    libraryId: string;
    newRootPath: string;
  }): { matchedCount: number; unmatchedCount: number; totalCount: number; examples: Array<{ relativeFilePath: string; matched: boolean }> } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    let newRoot: string;
    try {
      newRoot = normalizeAbsolutePath(input.newRootPath);
    } catch (error) {
      throw serviceError(error, 'INVALID_IMPORT_SOURCE');
    }

    if (!realDirectoryExists(newRoot)) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
    }
    this.assertNoSymlinkEscape(newRoot);

    const rows = this.batchRelinkRows(openLibrary);
    const matches = this.batchRelinkMatches(openLibrary, newRoot, rows);

    let matchedCount = 0;
    let unmatchedCount = 0;
    const examples: Array<{ relativeFilePath: string; matched: boolean }> = [];

    for (const row of rows) {
      const matched = matches.has(row.asset_id);

      if (matched) matchedCount += 1;
      else unmatchedCount += 1;

      if (examples.length < 8) {
        // Use only relative fragment (not absolute)
        const displaySegments = row.relative_file_path.split('/');
        const fragment = displaySegments.slice(-2).join('/');
        examples.push({ relativeFilePath: fragment, matched });
      }
    }

    return {
      matchedCount,
      unmatchedCount,
      totalCount: rows.length,
      examples,
    };
  }

  relinkBatchApply(input: {
    libraryId: string;
    newRootPath: string;
    keepMetadata: boolean;
  }): { restoredCount: number; unchangedMissingCount: number; assets: AssetSummary[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    let newRoot: string;
    try {
      newRoot = normalizeAbsolutePath(input.newRootPath);
    } catch (error) {
      throw serviceError(error, 'INVALID_IMPORT_SOURCE');
    }

    if (!realDirectoryExists(newRoot)) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
    }
    this.assertNoSymlinkEscape(newRoot);

    const rows = this.batchRelinkRows(openLibrary);
    const matches = this.batchRelinkMatches(openLibrary, newRoot, rows);

    const now = new Date().toISOString();
    const operationId = randomUUID();
    let restoredCount = 0;
    const restoredAssets: AssetSummary[] = [];
    const managedPlacements: Array<{
      destinationPath: string;
      operationPath: string;
      placedIdentity: ManagedRelinkPlacementIdentity;
      stat: Stats;
    }> = [];

    try {
      openLibrary.connection.transaction(() => {
        const manifest: OperationManifest = {
          version: 1,
          files: [],
          directories: [],
        };
        openLibrary.connection
          .prepare(
            `INSERT INTO file_operations
               (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
             VALUES (?, 'relink-batch', 'committed', ?, NULL, ?, ?)`,
          )
          .run(operationId, JSON.stringify(manifest), now, now);

        for (const asset of rows) {
          const match = matches.get(asset.asset_id);
          if (!match) continue;
          const { matchedPath, resolvedRelativePath } = match;

          const fileStat = asset.location_kind === 'managed'
            ? (() => {
                const placement = this.placeManagedRelinkFile(
                  openLibrary,
                  matchedPath,
                  asset.relative_file_path,
                );
                managedPlacements.push(placement);
                return placement.stat;
              })()
            : statSync(matchedPath);
          if (restoredCount === 0) this.failAt('crash-relink-batch-after-first-place');
          const revisionId = randomUUID();
          openLibrary.connection
            .prepare(
              `INSERT INTO revisions
                 (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
                  original_filename, origin, accepted_at)
               VALUES (?, ?, ?, ?, ?, ?, 'relink', ?)`,
            )
            .run(
              revisionId,
              asset.asset_id,
              asset.current_revision_id ?? null,
              fileStat.size,
              fileStat.mtime.toISOString(),
              path.posix.basename(resolvedRelativePath),
              now,
            );

          openLibrary.connection
            .prepare(
              `UPDATE assets
                  SET current_revision_id = ?, availability = 'available',
                      relative_file_path = ?, path_identity = ?, updated_at = ?
                WHERE asset_id = ?`,
            )
            .run(
              revisionId,
              resolvedRelativePath,
              portablePathIdentity(resolvedRelativePath),
              now,
              asset.asset_id,
            );

          if (asset.current_revision_id) {
            openLibrary.connection
              .prepare(
                `UPDATE revision_artifacts
                    SET invalidated_at = ?
                  WHERE revision_id = ? AND invalidated_at IS NULL`,
              )
              .run(now, asset.current_revision_id);
          }
          openLibrary.connection
            .prepare(
              `INSERT OR IGNORE INTO jobs
                 (job_id, library_id, asset_id, revision_id, kind, status, priority,
                  progress, attempt_count, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', 0, 0.0, 0, ?, ?)`,
            )
            .run(randomUUID(), input.libraryId, asset.asset_id, revisionId, now, now);

          if (!input.keepMetadata) {
            // Clear human metadata
            openLibrary.connection
              .prepare(
                `UPDATE asset_metadata
                    SET description = NULL, rating = 0, favorite = 0,
                        palette = NULL, source_page_url = NULL, author = NULL,
                        entity_version = entity_version + 1, updated_at = ?
                  WHERE asset_id = ?`,
              )
              .run(now, asset.asset_id);
            openLibrary.connection
              .prepare('DELETE FROM human_asset_tags WHERE asset_id = ?')
              .run(asset.asset_id);
            openLibrary.connection
              .prepare('DELETE FROM collection_assets WHERE asset_id = ?')
              .run(asset.asset_id);
            openLibrary.connection
              .prepare('DELETE FROM ai_asset_tags WHERE asset_id = ?')
              .run(asset.asset_id);
            openLibrary.connection
              .prepare('DELETE FROM ai_content WHERE asset_id = ?')
              .run(asset.asset_id);
          }

          this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
          restoredCount += 1;
        }
        this.failAt('crash-relink-before-db-commit');
      })();
      this.failAt('crash-relink-after-db-commit');
    } catch (error) {
      if (!(error instanceof SimulatedCrashError)) {
        for (const placement of managedPlacements) {
          this.cleanupManagedRelinkPlacement(placement, true);
        }
      }
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
    for (const placement of managedPlacements) {
      this.cleanupManagedRelinkPlacement(placement, false);
    }

    // Fetch restored assets
    if (restoredCount > 0) {
      const restoredAssetIds = rows
        .filter((r) => {
          // Re-check which ones succeeded (transaction committed)
          const updated = openLibrary.connection
            .prepare(
              "SELECT asset_id FROM assets WHERE asset_id = ? AND availability = 'available'",
            )
            .get(r.asset_id);
          return !!updated;
        })
        .map((r) => r.asset_id);

      for (const assetId of restoredAssetIds) {
        const updated = openLibrary.connection
          .prepare(
            `SELECT a.asset_id, a.managed_folder_id, a.linked_folder_id, a.location_kind, a.relative_file_path,
                    a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                    COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
                    a.deleted_at, a.trashed_from_relative_path
               FROM assets a
               JOIN revisions r ON r.revision_id = a.current_revision_id
               LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
              WHERE a.asset_id = ?`,
          )
          .get(assetId) as AssetSummaryRow & {
            deleted_at: string | null;
            trashed_from_relative_path: string | null;
          } | undefined;
        if (updated) {
          restoredAssets.push(this.assetSummaryFromRow(updated));
        }
      }
    }

    const unchangedMissingCount =
      rows.filter((r) => {
        const still = openLibrary.connection
          .prepare(
            "SELECT asset_id FROM assets WHERE asset_id = ? AND availability = 'missing'",
          )
          .get(r.asset_id);
        return !!still;
      }).length;

    return { restoredCount, unchangedMissingCount, assets: restoredAssets };
  }

  private normalizeLinkedFolderRule(rule: LinkedFolderRule): LinkedFolderRule {
    const pattern = rule.pattern.trim().normalize('NFC');
    if (pattern.length === 0 || pattern.length > 512 || pattern.includes('\0')) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }
    if (rule.target === 'path') {
      try {
        return { ...rule, pattern: normalizeRelativeAssetPath(pattern) };
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_DECISION', { cause: error });
      }
    }
    if (pattern.includes('/') || pattern.includes('\\') || pattern === '.' || pattern === '..') {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }
    const normalizedPattern = rule.target === 'extension'
      ? pattern.replace(/^\.+/u, '').toLowerCase()
      : pattern;
    if (normalizedPattern.length === 0) throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    return { ...rule, pattern: normalizedPattern };
  }

  private linkedPathIsIgnored(relativePath: string, rules: LinkedFolderRule[]): boolean {
    const normalizedPath = normalizeRelativeAssetPath(relativePath);
    if (isAlwaysIgnoredAssetPath(normalizedPath)) return true;
    const segments = normalizedPath.split('/');
    const filename = segments.at(-1)!;
    const folders = segments.slice(0, -1);
    const extension = path.posix.extname(filename).replace(/^\./u, '');
    const fold = (value: string): string => value.normalize('NFC').toLocaleLowerCase('en-US');
    let ignored = false;
    for (const rawRule of rules) {
      if (!rawRule.enabled) continue;
      const rule = this.normalizeLinkedFolderRule(rawRule);
      const pattern = fold(rule.pattern);
      const matches = rule.target === 'path'
        ? fold(normalizedPath) === pattern || fold(normalizedPath).startsWith(`${pattern}/`)
        : rule.target === 'filename'
          ? fold(filename) === pattern
          : rule.target === 'extension'
            ? fold(extension) === pattern
            : folders.some((folder) => fold(folder) === pattern);
      if (matches) ignored = rule.action === 'exclude';
    }
    return ignored;
  }

  private enumerateLinkedSources(rootPath: string, linkedFolderId?: string, suppliedRules?: LinkedFolderRule[]): Array<{
    relativePath: string;
    byteSize: number;
    modifiedAt: string;
    originalFilename: string;
  }> {
    const entries: Array<{
      relativePath: string;
      byteSize: number;
      modifiedAt: string;
      originalFilename: string;
    }> = [];
    const rules = suppliedRules ?? (linkedFolderId
      ? this.getLinkedFolderRules({
          libraryId: [...this.openById.values()].find((open) => open.connection.prepare(
            'SELECT folder_id FROM linked_folders WHERE folder_id = ?',
          ).get(linkedFolderId))?.summary.libraryId ?? '',
          folderId: linkedFolderId,
        })
      : []);
    const visit = (directoryPath: string, relativeDirectory: string): void => {
      let children;
      try {
        children = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) =>
          left.name.localeCompare(right.name),
        );
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      for (const child of children) {
        const childRelative =
          relativeDirectory === ''
            ? child.name
            : path.posix.join(relativeDirectory, child.name);
        // Symlinks are neither followed nor registered; this prevents a linked
        // root from pulling in bytes outside itself via a hostile link.
        if (child.isSymbolicLink()) {
          this.diagnose(
            'linked-folder.symlink-skipped',
            new LibraryServiceError('INVALID_IMPORT_SOURCE', {
              reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
            }),
            { linkedFolderId, rootPath, relativePath: childRelative },
          );
          continue;
        }
        if (child.isDirectory()) {
          const canPrune = !rules.some((rule) => rule.enabled && rule.action === 'include')
            && this.linkedPathIsIgnored(path.posix.join(childRelative, '__serpent_probe__'), rules);
          if (canPrune) continue;
          visit(path.join(directoryPath, child.name), childRelative);
          continue;
        }
        if (!child.isFile()) continue;
        const childPath = path.join(directoryPath, child.name);
        let stat: BigIntStats;
        try {
          stat = lstatSync(childPath, { bigint: true });
        } catch (error) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
        }
        if (stat.isSymbolicLink()) {
          this.diagnose(
            'linked-folder.symlink-skipped',
            new LibraryServiceError('INVALID_IMPORT_SOURCE', {
              reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
            }),
            { linkedFolderId, rootPath, relativePath: childRelative },
          );
          continue;
        }
        if (!stat.isFile()) continue;
        let normalized: string;
        try {
          normalized = normalizeRelativeAssetPath(childRelative);
        } catch (error) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
        }
        if (this.linkedPathIsIgnored(normalized, rules)) continue;
        const byteSize = Number(stat.size);
        if (!Number.isSafeInteger(byteSize)) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'UNSUPPORTED_FILE_ENTRY',
          });
        }
        entries.push({
          relativePath: normalized,
          byteSize,
          modifiedAt: stat.mtime.toISOString(),
          originalFilename: child.name,
        });
      }
    };
    visit(rootPath, '');
    return entries;
  }

  /**
   * Copy external paths into a linked folder root and register via refresh
   * (Serpent-d3h / LINK-005). Returns an ImportCompletion-shaped result when
   * called from prepareOrExecuteImport; prepareImport routes linked targets
   * here via a zero-conflict plan + immediate resolve is not used — instead
   * prepareOrExecuteImport short-circuits.
   */
  importPathsIntoLinkedFolder(input: {
    libraryId: string;
    linkedFolderId: string;
    sourceKind: 'files' | 'folder';
    sourcePaths: string[];
  }): ImportCompletion {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const folder = openLibrary.connection
      .prepare(
        `SELECT folder_id, absolute_root_path, status
           FROM linked_folders
          WHERE folder_id = ? AND library_id = ?`,
      )
      .get(input.linkedFolderId, input.libraryId) as
      | { folder_id: string; absolute_root_path: string; status: string }
      | undefined;
    if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    if (folder.status !== 'available' || !realDirectoryExists(folder.absolute_root_path)) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
        reason: 'SOURCE_NOT_FOUND',
      });
    }

    const { entries } = this.enumerateImportSources({
      sourceKind: input.sourceKind,
      sourcePaths: input.sourcePaths,
      targetPrefix: '',
    });
    if (entries.length === 0) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
    }

    const occupied = new Set<string>();
    const written: string[] = [];
    try {
      for (const entry of entries) {
        const originalRelative = normalizeRelativeAssetPath(
          entry.destinationRelativePath,
        );
        const originalName = path.posix.basename(originalRelative);
        const parentRelative = path.posix.dirname(originalRelative);
        let relativeDestination = originalRelative;
        let destination = path.join(
          folder.absolute_root_path,
          ...relativeDestination.split('/'),
        );
        const destinationExists = (): boolean =>
          occupied.has(portablePathIdentity(relativeDestination)) ||
          existsSync(destination);
        if (destinationExists()) {
          let found = false;
          for (let suffix = 2; suffix < 10_000 && !found; suffix += 1) {
            for (const candidate of copyNameCandidates(originalName, suffix)) {
              relativeDestination = normalizeRelativeAssetPath(
                parentRelative === '.'
                  ? candidate
                  : path.posix.join(parentRelative, candidate),
              );
              destination = path.join(
                folder.absolute_root_path,
                ...relativeDestination.split('/'),
              );
              if (!destinationExists()) {
                found = true;
                break;
              }
            }
          }
          if (!found) {
            throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
              reason: 'NAME_NOT_SUPPORTED',
            });
          }
        }
        mkdirSync(path.dirname(destination), { recursive: true });
        copyFileSync(entry.sourcePath, destination, constants.COPYFILE_EXCL);
        written.push(relativeDestination);
        occupied.add(portablePathIdentity(relativeDestination));
      }
    } catch (error) {
      for (const relativePath of written.reverse()) {
        rmSync(
          path.join(folder.absolute_root_path, ...relativePath.split('/')),
          { force: true },
        );
      }
      throw serviceError(error, 'IMPORT_APPLY_FAILED');
    }

    this.refreshManagedAssets(input.libraryId);
    const identities = new Set(written.map(portablePathIdentity));
    const assets = this.listAssets({
      libraryId: input.libraryId,
      folderId: input.linkedFolderId,
      recursive: true,
    }).filter((asset) =>
      identities.has(portablePathIdentity(asset.relativeFilePath)),
    );
    return {
      importedCount: assets.length,
      skippedCount: Math.max(0, entries.length - assets.length),
      replacedCount: 0,
      assets,
    };
  }

  private linkedFolderRowForImport(
    openLibrary: OpenLibrary,
    folderId: string | undefined,
  ): { folder_id: string; absolute_root_path: string; status: string } | null {
    if (!folderId) return null;
    const row = openLibrary.connection
      .prepare(
        `SELECT folder_id, absolute_root_path, status
           FROM linked_folders
          WHERE folder_id = ? AND library_id = ?`,
      )
      .get(folderId, openLibrary.summary.libraryId) as
      | { folder_id: string; absolute_root_path: string; status: string }
      | undefined;
    return row ?? null;
  }

  private findActiveManagedAssetIdByContent(
    openLibrary: OpenLibrary,
    byteSize: number,
    sha256: string,
    contentHashCache: Map<string, string>,
  ): string | null {
    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.relative_file_path
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
          WHERE a.deleted_at IS NULL
            AND a.location_kind = 'managed'
            AND r.byte_size = ?`,
      )
      .all(byteSize) as Array<{ asset_id: string; relative_file_path: string }>;

    for (const row of rows) {
      const absolutePath = this.folderPath(openLibrary, row.relative_file_path);
      let fileHash = contentHashCache.get(absolutePath);
      if (fileHash === undefined) {
        try {
          fileHash = sha256FileAtPath(absolutePath);
          contentHashCache.set(absolutePath, fileHash);
        } catch {
          continue;
        }
      }
      if (fileHash === sha256) return row.asset_id;
    }
    return null;
  }

  private classifyImportEntryConflict(input: {
    openLibrary: OpenLibrary;
    entry: ImportSourceEntry;
    entrySha256: string;
    existingSize: number | undefined;
    existingAbsolutePath: string | undefined;
    contentHashCache: Map<string, string>;
    seenContentHashes: Set<string>;
  }): 'none' | 'suspected-duplicate' | 'name-conflict' {
    const {
      openLibrary,
      entry,
      entrySha256,
      existingSize,
      existingAbsolutePath,
      contentHashCache,
      seenContentHashes,
    } = input;

    if (seenContentHashes.has(entrySha256)) return 'suspected-duplicate';

    if (existingSize !== undefined) {
      if (existingSize === -1) return 'name-conflict';
      if (existingSize !== entry.byteSize) return 'name-conflict';
      if (!existingAbsolutePath) return 'name-conflict';
      let destinationHash = contentHashCache.get(existingAbsolutePath);
      if (destinationHash === undefined) {
        try {
          destinationHash = sha256FileAtPath(existingAbsolutePath);
          contentHashCache.set(existingAbsolutePath, destinationHash);
        } catch {
          return 'name-conflict';
        }
      }
      return destinationHash === entrySha256 ? 'suspected-duplicate' : 'name-conflict';
    }

    if (
      this.findActiveManagedAssetIdByContent(
        openLibrary,
        entry.byteSize,
        entrySha256,
        contentHashCache,
      ) !== null
    ) {
      return 'suspected-duplicate';
    }

    return 'none';
  }

  prepareImport(input: {
    libraryId: string;
    targetFolderId?: string;
    sourceKind: 'files' | 'folder';
    sourcePaths: string[];
  }): ImportConflictPlan {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    if (this.linkedFolderRowForImport(openLibrary, input.targetFolderId)) {
      // Linked imports skip the managed staging pipeline; callers should use
      // prepareOrExecuteImport. Surface a clear error if prepareImport is used alone.
      throw new LibraryServiceError('INVALID_IMPORT_DECISION', {
        reason: 'SOURCE_NOT_FOUND',
      });
    }
    const targetFolder = this.targetFolder(openLibrary, input.targetFolderId);
    const { directories, entries } = this.enumerateImportSources({
      sourceKind: input.sourceKind,
      sourcePaths: input.sourcePaths,
      targetPrefix: targetFolder?.relative_path ?? '',
    });
    const importId = randomUUID();
    const operationPath = path.join(
      openLibrary.summary.libraryPath,
      '.serpent',
      'operations',
      importId,
    );
    const stagePath = path.join(operationPath, 'stage');
    let preparingManifest: OperationManifest;
    try {
      preparingManifest = {
        version: 1,
        phase: 'staging',
        files: entries.map((entry, index) => ({
          backupName: String(index),
          destinationRelativePath: entry.destinationRelativePath,
          hadDestination:
            this.portableDiskDestination(openLibrary, entry.destinationRelativePath) !== undefined,
          stageName: String(index),
        })),
        directories: directories.map((relativePath) => ({
          existed: this.portableDiskDestination(openLibrary, relativePath) !== undefined,
          relativePath,
        })),
      };
    } catch (error) {
      throw serviceError(error, 'INVALID_IMPORT_SOURCE');
    }
    try {
      const now = new Date().toISOString();
      openLibrary.connection
        .prepare(
          `INSERT INTO file_operations
             (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
           VALUES (?, 'import', 'preparing', ?, NULL, ?, ?)`,
        )
        .run(importId, JSON.stringify(preparingManifest), now, now);
    } catch (error) {
      throw serviceError(error, 'IMPORT_APPLY_FAILED');
    }
    let stagedEntries: ImportSourceEntry[];
    try {
      mkdirSync(stagePath, { recursive: true });
      stagedEntries = [];
      entries.forEach((entry, index) => {
        const stagedPath = path.join(stagePath, String(index));
        const byteSize = this.copySourceSnapshot(entry, stagedPath);
        stagedEntries.push({ ...entry, byteSize, sourcePath: stagedPath });
        if (index === 0) this.failAt('crash-during-prepare-stage');
      });
    } catch (error) {
      if (error instanceof SimulatedCrashError) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      this.removeOperation(operationPath);
      openLibrary.connection
        .prepare("UPDATE file_operations SET status = 'failed', error_code = 'PREPARE_FAILED', updated_at = ? WHERE operation_id = ?")
        .run(new Date().toISOString(), importId);
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
    }
    const seenDestinations = new Map<string, number>();
    const contentHashCache = new Map<string, string>();
    const seenContentHashes = new Set<string>();
    let suspectedDuplicateCount = 0;
    let libraryDuplicateCount = 0;
    let nameConflictCount = 0;
    const examples: ImportConflictPlan['examples'] = [];

    try {
      for (const entry of stagedEntries) {
        const entrySha256 = sha256FileAtPath(entry.sourcePath);
        const identity = portablePathIdentity(entry.destinationRelativePath);
        let existingSize = seenDestinations.get(identity);
        let existingAbsolutePath: string | undefined;
        if (existingSize === undefined) {
          const destination = this.portableDiskDestination(
            openLibrary,
            entry.destinationRelativePath,
          );
          existingSize = destination?.size;
          if (destination && destination.size !== -1) {
            existingAbsolutePath = this.folderPath(openLibrary, destination.actualRelativePath);
          }
        }
        const conflictKind = this.classifyImportEntryConflict({
          openLibrary,
          entry,
          entrySha256,
          existingSize,
          existingAbsolutePath,
          contentHashCache,
          seenContentHashes,
        });

        if (conflictKind === 'suspected-duplicate') {
          suspectedDuplicateCount += 1;
          const isLibraryScope = existingSize === undefined;
          if (isLibraryScope) libraryDuplicateCount += 1;
          if (examples.length < 8) {
            examples.push({
              displayName: path.posix.basename(entry.destinationRelativePath),
              kind: isLibraryScope ? 'library-duplicate' : 'suspected-duplicate',
            });
          }
          continue;
        }
        if (conflictKind === 'name-conflict') {
          nameConflictCount += 1;
          if (examples.length < 8) {
            examples.push({
              displayName: path.posix.basename(entry.destinationRelativePath),
              kind: 'name-conflict',
            });
          }
          continue;
        }

        seenContentHashes.add(entrySha256);
        seenDestinations.set(identity, entry.byteSize);
      }
    } catch (error) {
      this.removeOperation(operationPath);
      openLibrary.connection
        .prepare("UPDATE file_operations SET status = 'failed', error_code = 'PREPARE_FAILED', updated_at = ? WHERE operation_id = ?")
        .run(new Date().toISOString(), importId);
      throw serviceError(error, 'INVALID_IMPORT_SOURCE');
    }

    const preparedManifest: OperationManifest = { ...preparingManifest, phase: 'prepared' };
    openLibrary.connection
      .prepare('UPDATE file_operations SET manifest_json = ?, updated_at = ? WHERE operation_id = ?')
      .run(JSON.stringify(preparedManifest), new Date().toISOString(), importId);
    const pending: PendingImport = {
      directories,
      entries: stagedEntries,
      libraryId: input.libraryId,
      operationPath,
    };
    this.pendingImports.set(importId, pending);
    this.scheduleImportExpiry(importId, pending);
    const plan: ImportConflictPlan = {
      importId,
      fileCount: stagedEntries.length,
      totalBytes: stagedEntries.reduce((total, entry) => total + entry.byteSize, 0),
      suspectedDuplicateCount,
      libraryDuplicateCount,
      nameConflictCount,
      examples,
    };
    return plan;
  }

  prepareOrExecuteImport(input: {
    libraryId: string;
    targetFolderId?: string;
    sourceKind: 'files' | 'folder';
    sourcePaths: string[];
  }): ImportConflictPlan | ImportCompletion {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const linked = this.linkedFolderRowForImport(
      openLibrary,
      input.targetFolderId,
    );
    if (linked) {
      return this.importPathsIntoLinkedFolder({
        libraryId: input.libraryId,
        linkedFolderId: linked.folder_id,
        sourceKind: input.sourceKind,
        sourcePaths: input.sourcePaths,
      });
    }
    const plan = this.prepareImport(input);
    if (plan.suspectedDuplicateCount !== 0 || plan.nameConflictCount !== 0) return plan;
    return this.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
  }

  abandonImport(importId: string): string {
    const pending = this.pendingImports.get(importId);
    if (!pending) throw new LibraryServiceError('IMPORT_NOT_FOUND');
    this.pendingImports.delete(importId);
    this.cancelImportExpiry(pending);
    this.updateImportOperation(pending, 'rolled_back', 'IMPORT_ABANDONED');
    this.removeOperation(pending.operationPath);
    return importId;
  }

  resolveImport(input: {
    importId: string;
    suspectedDuplicate: SuspectedDuplicateDecision;
    nameConflict: NameConflictDecision;
  }): ImportCompletion {
    const pending = this.pendingImports.get(input.importId);
    if (!pending) throw new LibraryServiceError('IMPORT_NOT_FOUND');
    this.pendingImports.delete(input.importId);
    this.cancelImportExpiry(pending);
    if (
      !['skip', 'merge', 'create-copy'].includes(input.suspectedDuplicate) ||
      !['keep-both', 'replace', 'skip'].includes(input.nameConflict)
    ) {
      this.updateImportOperation(pending, 'rolled_back', 'INVALID_IMPORT_DECISION');
      this.removeOperation(pending.operationPath);
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    const openLibrary = this.requireOpenLibrary(pending.libraryId);
    const directoryByIdentity = new Map<string, string>();
    let resolvedDirectories: string[];
    try {
      resolvedDirectories = [...pending.directories]
        .sort((left, right) => left.split('/').length - right.split('/').length)
        .map((relativeDirectory) => {
        const parent = path.posix.dirname(relativeDirectory);
        const resolvedParent =
          parent === '.' ? '.' : (directoryByIdentity.get(portablePathIdentity(parent)) ?? parent);
        const candidate =
          resolvedParent === '.'
            ? path.posix.basename(relativeDirectory)
            : path.posix.join(resolvedParent, path.posix.basename(relativeDirectory));
        const existing = this.portableDiskDestination(openLibrary, candidate);
        if (existing && existing.size !== -1) {
          throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
            reason: 'NAME_NOT_SUPPORTED',
          });
        }
        const resolved = existing?.actualRelativePath ?? candidate;
        directoryByIdentity.set(portablePathIdentity(relativeDirectory), resolved);
          return resolved;
        });
    } catch (error) {
      this.removeOperation(pending.operationPath);
      throw serviceError(error, 'IMPORT_APPLY_FAILED');
    }
    const occupied = new Map<string, ExistingDestination>();
    const actionIndexByIdentity = new Map<string, number>();
    const actions: ImportAction[] = [];
    const mergedAssetIds = new Set<string>();
    let skippedCount = 0;

    const destination = (relativePath: string): ExistingDestination | undefined => {
      const identity = portablePathIdentity(relativePath);
      return occupied.get(identity) ?? this.portableDiskDestination(openLibrary, relativePath);
    };
    const copyPath = (relativePath: string): string => {
      const directory = path.posix.dirname(relativePath);
      const fileName = path.posix.basename(relativePath);
      for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
        let allCandidatesExceededNameLimit = true;
        let finalNameLimitError: unknown;
        for (const candidateName of copyNameCandidates(fileName, index)) {
          const candidate =
            directory === '.' ? candidateName : path.posix.join(directory, candidateName);
          try {
            const existing = destination(candidate);
            allCandidatesExceededNameLimit = false;
            if (existing === undefined) return candidate;
            break;
          } catch (error) {
            if (hasErrorCode(error, 'ENAMETOOLONG')) {
              finalNameLimitError = error;
              continue;
            }
            throw error;
          }
        }
        if (allCandidatesExceededNameLimit) throw finalNameLimitError;
      }
      throw new LibraryServiceError('IMPORT_APPLY_FAILED');
    };

    try {
      const contentHashCache = new Map<string, string>();
      const seenContentHashes = new Set<string>();
      for (const entry of pending.entries) {
        const entrySha256 = sha256FileAtPath(entry.sourcePath);
        const requestedDirectory = path.posix.dirname(entry.destinationRelativePath);
        const resolvedDirectory =
          requestedDirectory === '.'
            ? '.'
            : (directoryByIdentity.get(portablePathIdentity(requestedDirectory)) ??
              requestedDirectory);
        const requestedDestination =
          resolvedDirectory === '.'
            ? path.posix.basename(entry.destinationRelativePath)
            : path.posix.join(resolvedDirectory, path.posix.basename(entry.destinationRelativePath));
        const existingDestination = destination(requestedDestination);
        const existingSize = existingDestination?.size;
        const existingAbsolutePath =
          existingDestination && existingDestination.size !== -1
            ? this.folderPath(openLibrary, existingDestination.actualRelativePath)
            : undefined;
        const classified = this.classifyImportEntryConflict({
          openLibrary,
          entry,
          entrySha256,
          existingSize,
          existingAbsolutePath,
          contentHashCache,
          seenContentHashes,
        });
        const conflictKind =
          classified === 'none' ? undefined : classified;
        let destinationRelativePath =
          existingDestination?.actualRelativePath ?? requestedDestination;
        let isReplacement = false;
        if (conflictKind === 'suspected-duplicate') {
          if (input.suspectedDuplicate === 'skip') {
            skippedCount += 1;
            continue;
          }
          if (input.suspectedDuplicate === 'create-copy') {
            // Path-level duplicate: destination occupied → auto-number.
            // Library-level duplicate with a free destination basename: keep the
            // requested name (Serpent-hy1n); only renumber when the path is taken.
            const requestedIdentity = portablePathIdentity(requestedDestination);
            const destinationFree =
              existingDestination === undefined &&
              !occupied.has(requestedIdentity);
            destinationRelativePath = destinationFree
              ? requestedDestination
              : copyPath(requestedDestination);
          } else {
            const retainedAssetId = existingDestination
              ? (
                  openLibrary.connection
                    .prepare(
                      'SELECT asset_id FROM assets WHERE path_identity = ?',
                    )
                    .get(portablePathIdentity(destinationRelativePath)) as
                    | { asset_id: string }
                    | undefined
                )?.asset_id
              : this.findActiveManagedAssetIdByContent(
                  openLibrary,
                  entry.byteSize,
                  entrySha256,
                  contentHashCache,
                );
            if (retainedAssetId) mergedAssetIds.add(retainedAssetId);
            else skippedCount += 1;
            continue;
          }
        } else if (conflictKind === 'name-conflict') {
          if (input.nameConflict === 'skip') {
            skippedCount += 1;
            continue;
          }
          if (input.nameConflict === 'keep-both') {
            destinationRelativePath = copyPath(requestedDestination);
          } else {
            if (existingSize === -1) {
              throw new LibraryServiceError('IMPORT_APPLY_FAILED');
            }
            isReplacement = true;
            const identity = portablePathIdentity(destinationRelativePath);
            const earlierActionIndex = actionIndexByIdentity.get(identity);
            if (earlierActionIndex !== undefined) {
              const earlierAction = actions[earlierActionIndex]!;
              actions[earlierActionIndex] = { ...earlierAction, entry };
              occupied.set(identity, {
                actualRelativePath: destinationRelativePath,
                size: entry.byteSize,
              });
              continue;
            }
          }
        }

        const pathIdentity = portablePathIdentity(destinationRelativePath);
        const existingAsset = openLibrary.connection
          .prepare(
            'SELECT asset_id, current_revision_id FROM assets WHERE path_identity = ?',
          )
          .get(pathIdentity) as ExistingAssetRow | undefined;
        occupied.set(pathIdentity, {
          actualRelativePath: destinationRelativePath,
          size: entry.byteSize,
        });
        actionIndexByIdentity.set(pathIdentity, actions.length);
        actions.push({
          destinationRelativePath,
          entry,
          existingAsset,
          isReplacement,
        });
        seenContentHashes.add(entrySha256);
      }
    } catch (error) {
      this.removeOperation(pending.operationPath);
      throw serviceError(error, 'IMPORT_APPLY_FAILED');
    }

    const operationId = input.importId;
    const operationPath = pending.operationPath;
    const backupPath = path.join(operationPath, 'backup');
    const stagedPaths = actions.map((action) => action.entry.sourcePath);
    const placedPaths: string[] = [];
    const backups: Array<{ backupPath: string; destinationPath: string }> = [];
    const createdDirectories: string[] = [];
    const directoryPaths = new Set(resolvedDirectories);
    for (const action of actions) {
      const directory = path.posix.dirname(action.destinationRelativePath);
      if (directory !== '.') directoryPaths.add(directory);
    }
    for (const directory of [...directoryPaths]) {
      let current = directory;
      while (current !== '.') {
        directoryPaths.add(current);
        current = path.posix.dirname(current);
      }
    }
    const sortedDirectories = [...directoryPaths].sort(
      (left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right),
    );
    // Fail fast on over-limit names before any filesystem side effects (see
    // assertNameWithinFsLimit for why this cannot rely on OS error codes).
    for (const action of actions) {
      assertNameWithinFsLimit(action.destinationRelativePath);
    }
    const manifest: OperationManifest = {
      version: 1,
      files: actions.map((action, index) => ({
        backupName: String(index),
        destinationRelativePath: action.destinationRelativePath,
        hadDestination: existsSync(this.folderPath(openLibrary, action.destinationRelativePath)),
        stageName: path.basename(action.entry.sourcePath),
      })),
      directories: sortedDirectories.map((relativePath) => ({
        existed: existsSync(this.folderPath(openLibrary, relativePath)),
        relativePath,
      })),
    };

    try {
      const now = new Date().toISOString();
      const updated = openLibrary.connection
        .prepare(
          `UPDATE file_operations
              SET status = 'applying', manifest_json = ?, error_code = NULL, updated_at = ?
            WHERE operation_id = ? AND status = 'preparing'`,
        )
        .run(JSON.stringify(manifest), now, operationId);
      if (updated.changes !== 1) throw new Error('Pending operation is not preparing.');
    } catch (error) {
      this.removeOperation(operationPath);
      throw serviceError(error, 'IMPORT_APPLY_FAILED');
    }

    const rollbackFiles = (): boolean => {
      let succeeded = true;
      for (const destinationPath of [...placedPaths].reverse()) {
        try {
          rmSync(destinationPath, { force: true, recursive: true });
        } catch {
          succeeded = false;
        }
      }
      for (const backup of [...backups].reverse()) {
        try {
          if (existsSync(backup.backupPath)) {
            this.failAt('rollback-restore');
            renameSync(backup.backupPath, backup.destinationPath);
          }
        } catch {
          succeeded = false;
        }
      }
      for (const directoryPath of [...createdDirectories].reverse()) {
        try {
          rmdirSync(directoryPath);
        } catch {
          succeeded = false;
        }
      }
      if (succeeded) this.removeOperation(operationPath);
      return succeeded;
    };

    const affectedAssetIds: string[] = [];
    let importedCount = 0;
    let replacedCount = 0;
    let committed = false;
    try {
      mkdirSync(backupPath, { recursive: true });
      this.failAt('after-stage');

      for (const relativeDirectory of sortedDirectories) {
        const directoryPath = this.folderPath(openLibrary, relativeDirectory);
        if (!existsSync(directoryPath)) {
          mkdirSync(directoryPath);
          createdDirectories.push(directoryPath);
        } else if (!lstatSync(directoryPath).isDirectory()) {
          throw new Error('An imported directory conflicts with a file.');
        }
      }

      actions.forEach((action, index) => {
        const destinationPath = this.folderPath(openLibrary, action.destinationRelativePath);
        if (existsSync(destinationPath)) {
          const existingBackupPath = path.join(backupPath, String(index));
          renameSync(destinationPath, existingBackupPath);
          backups.push({ backupPath: existingBackupPath, destinationPath });
        }
      });
      this.failAt('after-backup');
      this.failAt('crash-after-backup');
      actions.forEach((action, index) => {
        const destinationPath = this.folderPath(openLibrary, action.destinationRelativePath);
        renameSync(stagedPaths[index]!, destinationPath);
        placedPaths.push(destinationPath);
        if (index === 0) this.failAt('after-first-place');
      });
      this.failAt('after-place');
      this.failAt('crash-after-place');

      // Serpent-yqrl: commit folders first, then each asset in its own
      // transaction so the canvas can refresh as items become durable.
      // failAt('before-db-commit') still fires before the first asset commit
      // (import-planning rollback tests). After ≥1 asset commits, later
      // failures keep those assets and return a partial completion.
      const now = new Date().toISOString();
      const folderRows = openLibrary.connection
        .prepare(
          'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders ORDER BY relative_path',
        )
        .all() as ManagedFolderRow[];
      const foldersByPath = new Map(folderRows.map((folder) => [folder.path_identity, folder]));
      openLibrary.connection.transaction(() => {
        for (const relativeDirectory of sortedDirectories) {
          const directoryIdentity = portablePathIdentity(relativeDirectory);
          if (foldersByPath.has(directoryIdentity)) continue;
          const parentPath = path.posix.dirname(relativeDirectory);
          const parentIdentity = parentPath === '.' ? undefined : portablePathIdentity(parentPath);
          const folder: ManagedFolderRow = {
            folder_id: randomUUID(),
            parent_folder_id:
              parentIdentity === undefined
                ? null
                : (foldersByPath.get(parentIdentity)?.folder_id ?? null),
            name: path.posix.basename(relativeDirectory),
            relative_path: relativeDirectory,
            path_identity: directoryIdentity,
          };
          if (parentPath !== '.' && folder.parent_folder_id === null) {
            throw new Error('Imported folder parent is missing.');
          }
          openLibrary.connection
            .prepare(
              `INSERT INTO managed_folders
                 (folder_id, parent_folder_id, name, relative_path, path_identity, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              folder.folder_id,
              folder.parent_folder_id,
              folder.name,
              folder.relative_path,
              folder.path_identity,
              now,
            );
          foldersByPath.set(directoryIdentity, folder);
        }
      })();

      for (const action of actions) {
        this.failAt('before-db-commit');
        let committedAssetId: string | null = null;
        openLibrary.connection.transaction(() => {
          const destinationPath = this.folderPath(openLibrary, action.destinationRelativePath);
          // Persist the exact same millisecond representation used by watcher
          // refreshes. Mixing Stats.mtime (Date) with BigIntStats.mtimeMs can
          // manufacture a phantom external revision for freshly imported files
          // on filesystems that retain sub-millisecond timestamps.
          const fileStat = lstatSync(destinationPath, { bigint: true });
          const fileByteSize = Number(fileStat.size);
          if (!Number.isSafeInteger(fileByteSize)) {
            throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
              reason: 'UNSUPPORTED_FILE_ENTRY',
            });
          }
          const fileModifiedAt = new Date(Number(fileStat.mtimeMs)).toISOString();
          const directory = path.posix.dirname(action.destinationRelativePath);
          const managedFolderId =
            directory === '.'
              ? null
              : (foldersByPath.get(portablePathIdentity(directory))?.folder_id ?? null);
          const assetId = action.existingAsset?.asset_id ?? randomUUID();
          const revisionId = randomUUID();
          const pathIdentity = portablePathIdentity(action.destinationRelativePath);
          if (!action.existingAsset) {
            openLibrary.connection
              .prepare(
                `INSERT INTO assets
                 (asset_id, location_kind, managed_folder_id, relative_file_path,
                    path_identity, current_revision_id, availability, created_at, updated_at)
                 VALUES (?, 'managed', ?, ?, ?, NULL, 'available', ?, ?)`,
              )
              .run(
                assetId,
                managedFolderId,
                action.destinationRelativePath,
                pathIdentity,
                now,
                now,
              );
            importedCount += 1;
            if (action.isReplacement) replacedCount += 1;
          } else {
            replacedCount += 1;
          }
          openLibrary.connection
            .prepare(
              `INSERT INTO revisions
                 (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
                  original_filename, origin, accepted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              revisionId,
              assetId,
              action.existingAsset?.current_revision_id ?? null,
              fileByteSize,
              fileModifiedAt,
              path.posix.basename(action.entry.destinationRelativePath),
              action.existingAsset ? 'replace' : 'import',
              now,
            );
          openLibrary.connection
            .prepare(
              `UPDATE assets
                  SET managed_folder_id = ?, relative_file_path = ?, path_identity = ?,
                      current_revision_id = ?, availability = 'available', updated_at = ?
                WHERE asset_id = ?`,
            )
            .run(
              managedFolderId,
              action.destinationRelativePath,
              pathIdentity,
              revisionId,
              now,
              assetId,
            );
          if (action.entry.sourcePageUrl !== undefined) {
            const sourcePageUrl = action.entry.sourcePageUrl.trim();
            if (sourcePageUrl === '') {
              throw new LibraryServiceError('IMPORT_APPLY_FAILED');
            }
            openLibrary.connection
              .prepare(
                `INSERT INTO asset_metadata
                   (asset_id, description, rating, favorite, palette,
                    source_page_url, entity_version, updated_at)
                 VALUES (?, NULL, 0, 0, NULL, ?, 1, ?)
                 ON CONFLICT(asset_id) DO UPDATE SET
                   source_page_url = excluded.source_page_url,
                   entity_version = asset_metadata.entity_version + 1,
                   updated_at = excluded.updated_at`,
              )
              .run(assetId, sourcePageUrl, now);
            this.failAt('after-import-metadata');
          }
          this.syncAssetSearchContent(openLibrary.connection, assetId);
          committedAssetId = assetId;
        })();
        if (committedAssetId) {
          affectedAssetIds.push(committedAssetId);
          this.options.onAssetsChanged?.({
            type: 'asset.changed',
            libraryId: pending.libraryId,
            changedCount: 1,
            missingCount: 0,
          });
        }
      }

      openLibrary.connection
        .prepare("UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?")
        .run(new Date().toISOString(), operationId);
      committed = true;

      const affected = new Set([...affectedAssetIds, ...mergedAssetIds]);
      // The SQLite commit is the point of no return. Cleanup is recoverable from the
      // committed operation row and must never enter the pre-commit rollback path.
      try {
        this.failAt('committed-cleanup');
        this.removeOperation(operationPath);
      } catch {
        // recoverFileOperations removes committed operation data on the next open.
      }
      let assets: AssetSummary[] = [];
      try {
        this.failAt('committed-result-list');
        const allAssets = this.listAssets({ libraryId: pending.libraryId, recursive: true });
        assets = allAssets.filter((asset) => affected.has(asset.assetId));
      } catch {
        // A committed import is still success. A later list/refresh supplies cards.
      }
      return {
        importedCount,
        skippedCount,
        replacedCount,
        assets,
      };
    } catch (error) {
      if (committed) {
        return { importedCount, skippedCount, replacedCount, assets: [] };
      }
      if (affectedAssetIds.length > 0) {
        // Partial durable import: keep committed rows/files and finish the op.
        try {
          openLibrary.connection
            .prepare("UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?")
            .run(new Date().toISOString(), operationId);
          this.removeOperation(operationPath);
        } catch {
          // Recovery can finalize a stale applying row on the next open.
        }
        committed = true;
        const affected = new Set([...affectedAssetIds, ...mergedAssetIds]);
        let assets: AssetSummary[] = [];
        try {
          const allAssets = this.listAssets({ libraryId: pending.libraryId, recursive: true });
          assets = allAssets.filter((asset) => affected.has(asset.assetId));
        } catch {
          // Committed rows remain; later list/refresh supplies cards.
        }
        return {
          importedCount,
          skippedCount,
          replacedCount,
          assets,
        };
      }
      if (error instanceof SimulatedCrashError) {
        throw new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error });
      }
      const rolledBack = rollbackFiles();
      try {
        openLibrary.connection
          .prepare(
            `UPDATE file_operations
                SET status = ?, error_code = 'IMPORT_APPLY_FAILED', updated_at = ?
              WHERE operation_id = ?`,
          )
          .run(rolledBack ? 'rolled_back' : 'failed', new Date().toISOString(), operationId);
      } catch {
        // The filesystem rollback is authoritative; recovery can retry a stale applying row.
      }
      throw serviceError(error, 'IMPORT_APPLY_FAILED');
    }
  }

  refreshManagedAssets(libraryId: string): AssetRefreshResult {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const before = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.location_kind, a.linked_folder_id, a.relative_file_path,
                a.current_revision_id, a.availability, r.byte_size, r.modified_at
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
          WHERE a.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id)
          ORDER BY a.relative_file_path`,
      )
      .all() as Array<{
        asset_id: string;
        location_kind: 'managed' | 'linked';
        linked_folder_id: string | null;
        relative_file_path: string;
        current_revision_id: string;
        availability: 'available' | 'missing';
        byte_size: number;
        modified_at: string;
      }>;
    let changedCount = 0;
    let missingCount = 0;

    openLibrary.connection.transaction(() => {
      // Reconcile linked folder statuses: a folder whose root is gone flips to
      // offline; a folder whose root came back (e.g. a remounted volume) flips
      // to available. Asset-level reconciliation below handles the file rows.
      const linkedFolders = openLibrary.connection
        .prepare('SELECT folder_id, absolute_root_path, status FROM linked_folders')
        .all() as Array<{
          folder_id: string;
          absolute_root_path: string;
          status: 'available' | 'offline';
        }>;
      const folderNow = new Date().toISOString();
      for (const folder of linkedFolders) {
        const rootGone = this.linkedRootIsGone(folder.absolute_root_path);
        if (rootGone && folder.status === 'available') {
          openLibrary.connection
            .prepare("UPDATE linked_folders SET status = 'offline', updated_at = ? WHERE folder_id = ?")
            .run(folderNow, folder.folder_id);
        } else if (!rootGone && folder.status === 'offline') {
          openLibrary.connection
            .prepare("UPDATE linked_folders SET status = 'available', updated_at = ? WHERE folder_id = ?")
            .run(folderNow, folder.folder_id);
        }
        if (rootGone) continue;

        const existingIdentities = new Set(
          (openLibrary.connection
            .prepare('SELECT path_identity FROM assets WHERE linked_folder_id = ?')
            .all(folder.folder_id) as Array<{ path_identity: string }> )
            .map((row) => row.path_identity),
        );
        const insertAsset = openLibrary.connection.prepare(
          `INSERT INTO assets
             (asset_id, location_kind, managed_folder_id, linked_folder_id, relative_file_path,
              path_identity, current_revision_id, availability, created_at, updated_at)
           VALUES (?, 'linked', NULL, ?, ?, ?, NULL, 'available', ?, ?)`,
        );
        const insertRevision = openLibrary.connection.prepare(
          `INSERT INTO revisions
             (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
              original_filename, origin, accepted_at)
           VALUES (?, ?, NULL, ?, ?, ?, 'external_change', ?)`,
        );
        const setCurrentRevision = openLibrary.connection.prepare(
          'UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?',
        );
        for (const entry of this.enumerateLinkedSources(folder.absolute_root_path, folder.folder_id)) {
          const pathIdentity = portablePathIdentity(entry.relativePath);
          if (existingIdentities.has(pathIdentity)) continue;
          const assetId = randomUUID();
          const revisionId = randomUUID();
          insertAsset.run(
            assetId,
            folder.folder_id,
            entry.relativePath,
            pathIdentity,
            folderNow,
            folderNow,
          );
          insertRevision.run(
            revisionId,
            assetId,
            entry.byteSize,
            entry.modifiedAt,
            entry.originalFilename,
            folderNow,
          );
          setCurrentRevision.run(revisionId, folderNow, assetId);
          existingIdentities.add(pathIdentity);
          this.syncAssetSearchContent(openLibrary.connection, assetId);
          changedCount += 1;
        }
      }

      for (const asset of before) {
        const assetPath =
          asset.location_kind === 'linked'
            ? this.linkedAssetPath(openLibrary, asset.linked_folder_id, asset.relative_file_path)
            : this.folderPath(openLibrary, asset.relative_file_path);
        let fileStat: BigIntStats | Stats | undefined;
        try {
          fileStat = this.options.assetLstat
            ? this.options.assetLstat(assetPath)
            : lstatSync(assetPath, { bigint: true });
        } catch (error) {
          if (isUnreadablePathError(error)) {
            fileStat = undefined;
          } else {
            throw new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error });
          }
        }
        if (!fileStat?.isFile() || fileStat.isSymbolicLink()) {
          if (asset.availability === 'available') {
            openLibrary.connection
              .prepare("UPDATE assets SET availability = 'missing', updated_at = ? WHERE asset_id = ?")
              .run(new Date().toISOString(), asset.asset_id);
            changedCount += 1;
            missingCount += 1;
          }
          continue;
        }

        const byteSize = Number(fileStat.size);
        if (!Number.isSafeInteger(byteSize)) {
          throw new LibraryServiceError('IMPORT_APPLY_FAILED', {
            reason: 'UNSUPPORTED_FILE_ENTRY',
          });
        }
        // BigIntStats exposes integer mtimeMs while Stats may retain a fractional
        // value whose prebuilt Date rounds differently. Normalize both to the
        // filesystem millisecond used when linked/import revisions are created.
        const modifiedAt = new Date(Number(fileStat.mtimeMs)).toISOString();
        // On APFS, fs.utimes() can restore an ISO millisecond as one microsecond
        // less (for example .178000 -> .177999), which crosses the Date floor and
        // used to create a phantom revision when a missing file reappeared. Only
        // tolerate that one-millisecond representation edge while restoring a
        // missing asset; available-file refreshes retain exact change detection.
        const reappearanceTimestampEquivalent = asset.availability === 'missing'
          && Math.abs(Date.parse(modifiedAt) - Date.parse(asset.modified_at)) <= 1;
        const statChanged = byteSize !== asset.byte_size
          || (modifiedAt !== asset.modified_at && !reappearanceTimestampEquivalent);
        const now = new Date().toISOString();
        if (statChanged) {
          const revisionId = randomUUID();
          openLibrary.connection
            .prepare(
              `INSERT INTO revisions
                 (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
                  original_filename, origin, accepted_at)
               VALUES (?, ?, ?, ?, ?, ?, 'external_change', ?)`,
            )
            .run(
              revisionId,
              asset.asset_id,
              asset.current_revision_id,
              byteSize,
              modifiedAt,
              path.posix.basename(asset.relative_file_path),
              now,
            );
          openLibrary.connection
            .prepare(
              `UPDATE assets
                  SET current_revision_id = ?, availability = 'available', updated_at = ?
                WHERE asset_id = ?`,
            )
            .run(revisionId, now, asset.asset_id);
          // Invalidate old revision artifacts
          openLibrary.connection
            .prepare(
              `UPDATE revision_artifacts
                  SET invalidated_at = ?
                WHERE revision_id = ?
                  AND invalidated_at IS NULL`,
            )
            .run(now, asset.current_revision_id);
          // Enqueue only decodable media; unsupported assets keep their normal
          // file icon and never churn through a permanently failing queue.
          if (LibraryService.supportsThumbnail(asset.relative_file_path)) {
            openLibrary.connection
              .prepare(
                `INSERT OR IGNORE INTO jobs
                   (job_id, library_id, asset_id, revision_id, kind, status, priority,
                    progress, attempt_count, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', 0, 0.0, 0, ?, ?)`,
              )
              .run(randomUUID(), libraryId, asset.asset_id, revisionId, now, now);
          }
          changedCount += 1;
          this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
        } else if (asset.availability === 'missing') {
          openLibrary.connection
            .prepare("UPDATE assets SET availability = 'available', updated_at = ? WHERE asset_id = ?")
            .run(now, asset.asset_id);
          changedCount += 1;
          this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
        }
      }
    })();
    this.reconcileLinkedWatchers(openLibrary);

    return {
      changedCount,
      missingCount,
      assets: this.listAssets({ libraryId, recursive: true }),
    };
  }

  createLibrary(input: {
    displayName: string;
    selectedParentPath: string;
  }): InternalLibrarySummary {
    let finalPath: string;
    try {
      finalPath = targetLibraryPath(input.selectedParentPath, input.displayName);
    } catch (error) {
      throw serviceError(error, 'INVALID_LIBRARY_PATH');
    }

    const displayName = path.basename(finalPath);
    const parentPath = path.dirname(finalPath);
    try {
      if (!directoryExists(parentPath)) throw new LibraryServiceError('INVALID_LIBRARY_PATH');
      accessSync(parentPath, constants.W_OK);
    } catch (error) {
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
    if (existsSync(finalPath)) throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS');

    const partialPath = path.join(parentPath, `.serpent-create-${randomUUID()}.partial`);
    let connection: DatabaseConnection | undefined;
    let renamed = false;

    try {
      mkdirSync(partialPath);
      createDirectoryLayout(partialPath);
      connection = openConfiguredDatabase(databasePath(partialPath));
      migrateDatabase(connection, true);
      connection
        .prepare('INSERT INTO library (library_id, display_name, created_at) VALUES (?, ?, ?)')
        .run(randomUUID(), displayName, new Date().toISOString());
      verifyDatabase(connection);
      connection.close();
      connection = undefined;

      const verificationConnection = openConfiguredDatabase(databasePath(partialPath));
      try {
        verifyDatabase(verificationConnection);
      } finally {
        verificationConnection.close();
      }

      renameSync(partialPath, finalPath);
      renamed = true;
      return this.openLibrary(finalPath);
    } catch (error) {
      closeIgnoringFailure(connection);
      const cleanupPath = renamed ? finalPath : partialPath;
      try {
        if (existsSync(cleanupPath)) {
          if (renamed) renameSync(finalPath, partialPath);
          rmSync(partialPath, { force: true, recursive: true });
        }
      } catch (cleanupError) {
        throw new LibraryServiceError('LIBRARY_CLEANUP_FAILED', { cause: cleanupError });
      }
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
  }

  private reconcileDefaultIgnoredAssets(openLibrary: OpenLibrary): void {
    const rows = openLibrary.connection.prepare(
      'SELECT asset_id, relative_file_path FROM assets WHERE deleted_at IS NULL',
    ).all() as Array<{ asset_id: string; relative_file_path: string }>;
    const ignoredIds = rows
      .filter((row) => isAlwaysIgnoredAssetPath(row.relative_file_path))
      .map((row) => row.asset_id);
    if (ignoredIds.length === 0) return;
    openLibrary.connection.transaction(() => {
      const remove = openLibrary.connection.prepare('DELETE FROM assets WHERE asset_id = ?');
      for (const assetId of ignoredIds) remove.run(assetId);
    })();
  }

  openLibrary(selectedLibraryPath: string): InternalLibrarySummary {
    let selectedPath: string;
    try {
      selectedPath = normalizeAbsolutePath(selectedLibraryPath);
    } catch (error) {
      throw serviceError(error, 'INVALID_LIBRARY_PATH');
    }

    if (!existsSync(selectedPath)) throw new LibraryServiceError('LIBRARY_NOT_FOUND');
    if (!directoryExists(selectedPath)) throw new LibraryServiceError('NOT_A_LIBRARY');

    let canonicalPath: string;
    try {
      canonicalPath = realpathSync(selectedPath);
    } catch (error) {
      throw serviceError(error, 'LIBRARY_NOT_FOUND');
    }
    const alreadyOpenId = this.openIdByPath.get(canonicalPath);
    if (alreadyOpenId) return this.openById.get(alreadyOpenId)!.summary;

    for (const directoryName of REQUIRED_DIRECTORIES) {
      if (!realDirectoryExists(path.join(canonicalPath, directoryName))) {
        throw new LibraryServiceError('NOT_A_LIBRARY');
      }
    }
    const serpentPath = path.join(canonicalPath, '.serpent');
    if (!realDirectoryExists(serpentPath) || !realFileExists(databasePath(canonicalPath))) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }

    let connection: DatabaseConnection | undefined;
    try {
      connection = openConfiguredDatabase(databasePath(canonicalPath));
      migrateDatabase(connection, false);
      const library = verifyDatabase(connection);
      try {
        for (const directoryName of REGENERABLE_DIRECTORIES) {
          mkdirSync(path.join(serpentPath, directoryName), { recursive: true });
        }
      } catch (error) {
        throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
      }
      const existingIdentity = this.openById.get(library.library_id);
      if (existingIdentity) {
        closeIgnoringFailure(connection);
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }

      const summary: InternalLibrarySummary = {
        libraryId: library.library_id,
        displayName: library.display_name,
        libraryPath: canonicalPath,
      };
      const openLibrary = { connection, summary };
      this.openById.set(summary.libraryId, openLibrary);
      this.openIdByPath.set(canonicalPath, summary.libraryId);
      this.recoverFileOperations(openLibrary);
      this.recoverInterruptedAiJobs(openLibrary);
      this.recoverInterruptedThumbnailJobs(openLibrary);
      this.reconcileDefaultIgnoredAssets(openLibrary);
      // Serpent-pxd: exports that omitted `.serpent/artifacts` (or partial copies)
      // leave ready rows pointing at missing files → broken <img>. Invalidate so
      // enqueueThumbnailJobs below can regenerate.
      this.reconcileMissingArtifactFiles(openLibrary);
      // Purge expired trash on open (best-effort, single busy file does not abort)
      try {
        this.purgeExpiredTrash(summary.libraryId);
      } catch (error) {
        this.diagnose('trash.purge-on-open', error, { libraryId: summary.libraryId });
      }
      this.startAssetWatcher(openLibrary);
      this.reconcileLinkedWatchers(openLibrary);
      // Persist only the first visible batch. The Worker runtime drains these
      // asynchronously and later list/search requests raise the priority of
      // whatever the user is actually looking at.
      this.enqueueThumbnailJobs(summary.libraryId, {
        limit: 50,
        priority: 100,
        repairFailed: true,
      });
      return summary;
    } catch (error) {
      closeIgnoringFailure(connection);
      throw serviceError(error, 'LIBRARY_CORRUPT');
    }
  }

  private async resolvePublicDownloadTarget(url: URL): Promise<ResolvedAddress> {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: Array<{ address: string; family: number }>;
    if (isIP(hostname) !== 0) {
      addresses = [{ address: hostname, family: isIP(hostname) }];
    } else {
      const resolver = this.options.dnsLookup ?? (async (name: string) =>
        dnsLookup(name, { all: true, verbatim: true }));
      try {
        addresses = await resolver(hostname);
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR', cause: error });
      }
    }
    if (addresses.length === 0 || addresses.some(({ address, family }) =>
      prohibitedIpAddress(address) || isIP(address) !== family)) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'PERMISSION_DENIED' });
    }
    return addresses[0]!;
  }

  async saveAssetFromUrl(input: {
    libraryId: string;
    targetFolderId?: string;
    sourcePageUrl?: string;
    mediaUrl: string;
    mediaType?: string;
  }): Promise<{ asset: AssetSummary }> {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const targetFolder = this.targetFolder(openLibrary, input.targetFolderId);

    // Validate HTTP scheme on mediaUrl (already Zod-validated but defense in depth).
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(input.mediaUrl);
    } catch {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'PERMISSION_DENIED' });
    }

    const operationId = randomUUID();
    const operationPath = path.join(
      openLibrary.summary.libraryPath,
      '.serpent',
      'operations',
      operationId,
    );
    const stagePath = path.join(operationPath, 'stage');
    const backupPath = path.join(operationPath, 'backup');

    // Create file_operations row.
    const now = new Date().toISOString();
    try {
      openLibrary.connection
        .prepare(
          `INSERT INTO file_operations
             (operation_id, kind, status, manifest_json, error_code, created_at, updated_at)
           VALUES (?, 'import', 'preparing', ?, NULL, ?, ?)`,
        )
        .run(operationId, JSON.stringify({ version: 1, phase: 'staging', files: [], directories: [] }), now, now);
    } catch (error) {
      throw serviceError(error, 'IMPORT_APPLY_FAILED');
    }

    let downloaded = false;
    let downloadTimer: ReturnType<typeof setTimeout> | undefined;
    let response: Awaited<ReturnType<PinnedHttpTransport>> | undefined;
    try {
      mkdirSync(operationPath, { recursive: true });
      mkdirSync(stagePath);
      mkdirSync(backupPath);

      // Download the media URL. The deadline covers DNS, redirects, headers,
      // and the complete response body rather than only the initial fetch.
      const controller = new AbortController();
      downloadTimer = setTimeout(() => controller.abort(new Error('Download timed out.')), DOWNLOAD_TIMEOUT_MS);

      let finalUrl = parsedUrl;
      try {
        for (let redirectCount = 0; ; redirectCount += 1) {
          const resolvedAddress = await this.resolvePublicDownloadTarget(finalUrl);
          response = await (this.options.pinnedHttpTransport ?? defaultPinnedHttpTransport)({
            address: resolvedAddress.address,
            family: resolvedAddress.family,
            url: finalUrl,
            signal: controller.signal,
            headers: { 'User-Agent': 'Serpent/1.0' },
          });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          response.cancel();
          if (redirectCount >= MAX_DOWNLOAD_REDIRECTS) {
            throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
          }
          const location = response.headers.get('location');
          if (!location) {
            throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
          }
          finalUrl = new URL(location, finalUrl);
          if ((finalUrl.protocol !== 'http:' && finalUrl.protocol !== 'https:') ||
              finalUrl.username || finalUrl.password) {
            throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'PERMISSION_DENIED' });
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
        }
        if (error instanceof LibraryServiceError) throw error;
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR', cause: error });
      }

      if (!response) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
      }

      // Validate HTTP status.
      if (response.status < 200 || response.status >= 300) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'IO_ERROR',
          cause: new Error(`HTTP ${response.status}`),
        });
      }

      // Validate Content-Type.
      const contentType = normalizeRemoteContentType(response.headers.get('content-type'));
      const contentTypeFailure = remoteMediaValidationFailure(contentType);
      if (contentTypeFailure) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: contentTypeFailure,
          cause: new Error(contentTypeFailure === 'MIME_TYPE_MISSING'
            ? 'The response did not declare Content-Type.'
            : `Unsupported Content-Type: ${contentType}`),
        });
      }

      const declaredLengthText = response.headers.get('content-length');
      if (declaredLengthText !== null) {
        const declaredLength = Number(declaredLengthText);
        if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_DOWNLOAD_BYTES) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'UNSUPPORTED_FILE_ENTRY',
            cause: new Error('Invalid or oversized Content-Length.'),
          });
        }
      }

      // Determine filename.
      let filename: string;
      const contentDisposition = response.headers.get('content-disposition');
      if (contentDisposition) {
        const cdFilename = parseContentDispositionFilename(contentDisposition);
        if (cdFilename) {
          filename = cleanFilename(cdFilename);
        } else {
          filename = filenameFromUrl(finalUrl.href, contentType);
        }
      } else {
        filename = filenameFromUrl(finalUrl.href, contentType);
      }

      // Ensure filename has a reasonable extension that matches content-type.
      const fileExt = path.posix.extname(filename).toLowerCase();
      if (fileExt === '' || fileExt === '.') {
        const ctExt = extensionForContentType(contentType);
        if (ctExt) filename = `${filename}${ctExt}`;
      } else if (!filenameMatchesRemoteContentType(filename, contentType)) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'MIME_EXTENSION_MISMATCH',
          cause: new Error(`Filename extension ${fileExt} does not match ${contentType}.`),
        });
      }

      // Stream directly to the stage file with a running size limit.
      const stageFilePath = path.join(stagePath, 'stage-file');
      if (!response.body) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
      }
      const writer = createWriteStream(stageFilePath, { flags: 'wx' });
      let writerFailure: Error | undefined;
      writer.on('error', (error) => { writerFailure = error; });
      const waitForWriter = (event: 'drain' | 'finish'): Promise<void> =>
        new Promise((resolve, reject) => {
          const onReady = () => { cleanup(); resolve(); };
          const onError = (error: Error) => { cleanup(); reject(error); };
          const cleanup = () => {
            writer.removeListener(event, onReady);
            writer.removeListener('error', onError);
          };
          writer.once(event, onReady);
          writer.once('error', onError);
        });
      let totalBytes = 0;
      const magicProbe = new RemoteMediaMagicProbe();
      let magicValidated = false;
      try {
        for await (const value of response.body) {
          if (writerFailure) throw writerFailure;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_DOWNLOAD_BYTES) {
            response.cancel();
            throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
              reason: 'UNSUPPORTED_FILE_ENTRY',
              cause: new Error('File exceeds 500 MB limit.'),
            });
          }
          magicProbe.add(value);
          if (!magicValidated && magicProbe.canValidate(contentType)) {
            if (!magicProbe.matches(contentType)) {
              response.cancel();
              throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
                reason: 'MAGIC_BYTES_MISMATCH',
                cause: new Error(`File signature does not match ${contentType}.`),
              });
            }
            magicValidated = true;
          }
          if (!writer.write(Buffer.from(value))) {
            await waitForWriter('drain');
          }
        }
        if (!magicValidated && !magicProbe.matches(contentType)) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
            reason: 'MAGIC_BYTES_MISMATCH',
            cause: new Error(`File signature does not match ${contentType}.`),
          });
        }
        writer.end();
        if (writerFailure) throw writerFailure;
        await waitForWriter('finish');
        if (writerFailure) throw writerFailure;
      } finally {
        try { response.cancel(); } catch { /* Already released. */ }
        if (!writer.closed) writer.destroy();
        if (downloadTimer) clearTimeout(downloadTimer);
        downloadTimer = undefined;
      }
      downloaded = true;

      // Build destination path.
      const targetPrefix = targetFolder?.relative_path ?? '';
      const destinationRelativePath = targetPrefix
        ? path.posix.join(targetPrefix, filename)
        : filename;
      const normalizedDestination = normalizeRelativeAssetPath(destinationRelativePath);

      // Stat the stage file.
      const stageStat = statSync(stageFilePath);
      const byteSize = stageStat.size;

      // Build ImportSourceEntry for the staged file.
      const entry: ImportSourceEntry = {
        byteSize,
        destinationRelativePath: normalizedDestination,
        ...(input.sourcePageUrl ? { sourcePageUrl: input.sourcePageUrl } : {}),
        sourcePath: stageFilePath,
        sourceSnapshot: sourceSnapshot(
          lstatSync(stageFilePath, { bigint: true }) as BigIntStats,
        ),
      };

      // Create PendingImport and register.
      const pending: PendingImport = {
        directories: [],
        entries: [entry],
        libraryId: input.libraryId,
        operationPath,
      };

      // Update manifest to include the file.
      const manifest: OperationManifest = {
        version: 1,
        phase: 'prepared',
        files: [{
          backupName: '0',
          destinationRelativePath: normalizedDestination,
          hadDestination:
            this.portableDiskDestination(openLibrary, normalizedDestination) !== undefined,
          stageName: 'stage-file',
        }],
        directories: [],
      };
      openLibrary.connection
        .prepare('UPDATE file_operations SET manifest_json = ?, updated_at = ? WHERE operation_id = ?')
        .run(JSON.stringify(manifest), new Date().toISOString(), operationId);

      this.pendingImports.set(operationId, pending);
      this.scheduleImportExpiry(operationId, pending);

      // Resolve import: always create-copy for suspected duplicates, keep-both for name conflicts.
      const completion = this.resolveImport({
        importId: operationId,
        suspectedDuplicate: 'create-copy',
        nameConflict: 'keep-both',
      });
      return { asset: completion.assets[0]! };
    } catch (error) {
      if (downloadTimer) clearTimeout(downloadTimer);
      try { response?.cancel(); } catch { /* Best effort socket cleanup. */ }
      this.diagnose('extension-save.failed', sanitizedUrlDiagnosticError(error), {
        libraryId: input.libraryId,
        targetHost: parsedUrl.hostname,
        ...(input.sourcePageUrl
          ? { sourcePageUrl: sanitizedUrlForDiagnostic(input.sourcePageUrl) }
          : {}),
        mediaUrl: sanitizedUrlForDiagnostic(input.mediaUrl),
      });
      // Clean up on failure.
      if (this.pendingImports.has(operationId)) {
        this.pendingImports.delete(operationId);
        this.cancelImportExpiry({ operationPath, libraryId: input.libraryId, directories: [], entries: [] } as PendingImport);
      }
      if (!downloaded) {
        try {
          openLibrary.connection
            .prepare("UPDATE file_operations SET status = 'failed', error_code = ?, updated_at = ? WHERE operation_id = ?")
            .run('PREPARE_FAILED', new Date().toISOString(), operationId);
        } catch {
          // Best effort.
        }
      }
      let preserveOperationForRecovery: boolean;
      try {
        const operation = openLibrary.connection
          .prepare('SELECT status FROM file_operations WHERE operation_id = ?')
          .get(operationId) as { status: string } | undefined;
        preserveOperationForRecovery = operation?.status === 'applying' ||
          (downloaded && operation?.status === 'failed');
      } catch {
        // If the operation state cannot be read, keep the durable manifest. The
        // next library open can then recover it instead of risking an orphan.
        preserveOperationForRecovery = existsSync(operationPath);
      }
      if (!preserveOperationForRecovery) this.removeOperation(operationPath);
      throw serviceError(error, 'INVALID_IMPORT_SOURCE');
    }
  }

  // ── Library Export / Import ────────────────────────────────────────

  private emitProgress(event: ExportProgressEvent | ImportProgressEvent): void {
    try {
      this.options.onProgress?.(event);
    } catch {
      // Progress is best effort and must never throw back into an operation.
    }
  }

  private transferPathKey(candidatePath: string): string {
    let existingAncestor = path.resolve(candidatePath);
    const missingSegments: string[] = [];
    while (true) {
      try {
        existingAncestor = path.join(realpathSync(existingAncestor), ...missingSegments.reverse());
        break;
      } catch {
        const parentPath = path.dirname(existingAncestor);
        if (parentPath === existingAncestor) {
          existingAncestor = path.resolve(candidatePath);
          break;
        }
        missingSegments.push(path.basename(existingAncestor));
        existingAncestor = parentPath;
      }
    }
    const normalized = path.normalize(existingAncestor).normalize('NFC');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  private transferInProgress(
    scope: string,
    context: Record<string, unknown>,
  ): never {
    const error = new LibraryServiceError('TRANSFER_IN_PROGRESS', {
      reason: 'TRANSFER_IN_PROGRESS',
    });
    this.diagnose(scope, error, context);
    throw error;
  }

  private acquireExportTransfer(
    libraryId: string,
    exportId: string,
    cancelState: TransferCancelState,
  ): void {
    const activeExportId = this.activeExportByLibraryId.get(libraryId);
    if (activeExportId) {
      this.transferInProgress('transfer.export.in-progress', {
        libraryId,
        activeExportId,
        requestedExportId: exportId,
      });
    }
    this.activeExportByLibraryId.set(libraryId, exportId);
    this.activeExports.set(exportId, cancelState);
  }

  private releaseExportTransfer(libraryId: string, exportId: string): void {
    this.activeExports.delete(exportId);
    if (this.activeExportByLibraryId.get(libraryId) === exportId) {
      this.activeExportByLibraryId.delete(libraryId);
    }
  }

  private acquireImportTransfer(
    importId: string,
    sourcePath: string,
    destinationPath: string,
    cancelState: TransferCancelState,
  ): ActiveImportTransfer {
    const sourceKey = this.transferPathKey(sourcePath);
    const destinationKey = this.transferPathKey(destinationPath);
    const activeSourceImportId = this.activeImportBySource.get(sourceKey);
    const activeDestinationImportId = this.activeImportByDestination.get(destinationKey);
    if (activeSourceImportId || activeDestinationImportId) {
      this.transferInProgress('transfer.import.in-progress', {
        requestedImportId: importId,
        activeImportId: activeSourceImportId ?? activeDestinationImportId,
        sourcePath,
        destinationPath,
        sourceConflict: Boolean(activeSourceImportId),
        destinationConflict: Boolean(activeDestinationImportId),
      });
    }
    this.activeImportBySource.set(sourceKey, importId);
    this.activeImportByDestination.set(destinationKey, importId);
    this.activeImports.set(importId, cancelState);
    return { importId, sourceKey, destinationKey };
  }

  private releaseImportTransfer(transfer: ActiveImportTransfer): void {
    this.activeImports.delete(transfer.importId);
    if (this.activeImportBySource.get(transfer.sourceKey) === transfer.importId) {
      this.activeImportBySource.delete(transfer.sourceKey);
    }
    if (this.activeImportByDestination.get(transfer.destinationKey) === transfer.importId) {
      this.activeImportByDestination.delete(transfer.destinationKey);
    }
  }

  private mapZipImportError(error: ZipImportStreamError): LibraryServiceError {
    switch (error.code) {
      case 'CANCELLED':
        return new LibraryServiceError('CANCELLED', { cause: error });
      case 'ZIP_TOO_LARGE':
        return new LibraryServiceError('ZIP_TOO_LARGE', {
          cause: error,
          reason: 'ZIP_TOO_LARGE',
        });
      case 'PATH_ESCAPE':
        return new LibraryServiceError('NOT_A_LIBRARY', {
          cause: error,
          reason: 'PATH_ESCAPE',
        });
      case 'SYMBOLIC_LINK_NOT_ALLOWED':
        return new LibraryServiceError('NOT_A_LIBRARY', {
          cause: error,
          reason: 'SYMBOLIC_LINK_NOT_ALLOWED',
        });
      case 'DESTINATION_EXISTS':
      case 'INVALID_ZIP':
      case 'IO_ERROR':
        return new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
    }
  }

  private removeOwnedTransferPath(
    scope: string,
    targetPath: string,
    recursive: boolean,
  ): void {
    try {
      rmSync(targetPath, { force: true, recursive });
    } catch (error) {
      this.diagnose(scope, error, { targetPath });
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
        reason: publicReasonFromError(error),
        cause: error,
      });
    }
  }

  async exportLibraryToFolder(input: {
    libraryId: string;
    destinationPath: string;
    includeLinkedContent: boolean;
  }): Promise<{
    exportId: string;
    fileCount: number;
    totalBytes: number;
    excludedPreviewCount: number;
    includedLinkedContent: boolean;
    durationMs: number;
  }> {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const exportId = randomUUID();

    // The destination is owned by this operation only if it did not exist and
    // this call created it. Never merge into a user-owned directory.
    if (existsSync(input.destinationPath)) {
      throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS');
    }
    let canonicalDest: string;
    let canonicalLib: string;
    try {
      const canonicalParent = realpathSync(path.dirname(input.destinationPath));
      canonicalDest = path.join(canonicalParent, path.basename(input.destinationPath));
      canonicalLib = realpathSync(openLibrary.summary.libraryPath);
    } catch (error) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH', { cause: error });
    }
    if (pathIsWithin(canonicalLib, canonicalDest)) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }

    const cancelState: TransferCancelState = { cancelled: false };
    this.acquireExportTransfer(input.libraryId, exportId, cancelState);
    const startedAt = Date.now();
    let destinationOwned = false;

    try {
      mkdirSync(canonicalDest);
      destinationOwned = true;

      const libPath = openLibrary.summary.libraryPath;

      // Phase 1: snapshot-db
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'snapshot-db', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });
      await transferCheckpoint();
      if (cancelState.cancelled) throw new LibraryServiceError('CANCELLED');

      const tempDbPath = path.join(canonicalDest, `.serpent-export-${exportId}.db`);
      // Online Backup yields between page batches, allowing the live library to
      // continue serving reads and writes while SQLite maintains a consistent
      // snapshot for the exported database.
      await this.createConsistentDatabaseSnapshot(openLibrary.connection, tempDbPath, cancelState);

      // Phase 2: enumerate
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'enumerate', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });

      interface ExportEntry {
        sourcePath: string;
        relativePath: string;
        byteSize: number;
      }
      const entries: ExportEntry[] = [];
      let excludedPreviewCount = 0;

      const walkDir = async (dirPath: string, relPrefix: string): Promise<void> => {
        if (cancelState.cancelled) return;
        let children;
        try {
          children = readdirSync(dirPath, { withFileTypes: true });
        } catch (error) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
        }
        for (const child of children) {
          await transferCheckpoint();
          if (cancelState.cancelled) return;
          const childPath = path.join(dirPath, child.name);
          const childRel = relPrefix ? path.posix.join(relPrefix, child.name) : child.name;

          if (child.isSymbolicLink()) continue; // Never follow symlinks in export.

          if (child.isDirectory()) {
            // Exclude .serpent/previews and .serpent/operations.
            if (childRel === '.serpent/previews' || childRel === '.serpent/operations') {
              if (childRel === '.serpent/previews') {
                // Count preview files for excludedPreviewCount.
                try {
                  excludedPreviewCount = countFilesRecursive(childPath);
                } catch {
                  // Best effort count.
                }
              }
              continue;
            }
            await walkDir(childPath, childRel);
          } else if (child.isFile()) {
            // Exclude AI temp files.
            const lowerName = child.name.toLowerCase();
            if (
              lowerName.endsWith('.tmp') ||
              lowerName.includes('.wave-tmp.') ||
              lowerName.includes('-tmp.') ||
              (lowerName.startsWith('.') && (
                lowerName.includes('temp') || lowerName.includes('cache') ||
                lowerName.startsWith('.ds_store') || lowerName === 'thumbs.db'
              ))
            ) {
              continue;
            }
            // Exclude WAL/SHM files for the temp backup (just in case).
            if (childPath === `${tempDbPath}-wal` || childPath === `${tempDbPath}-shm`) continue;

            const stat = lstatSync(childPath);
            if (stat.isSymbolicLink()) continue;
            entries.push({
              sourcePath: childPath,
              relativePath: childRel,
              byteSize: stat.size,
            });
          }
        }
      };

      function countFilesRecursive(dirPath: string): number {
        let count = 0;
        try {
          for (const child of readdirSync(dirPath, { withFileTypes: true })) {
            if (child.isSymbolicLink()) continue;
            const childPath = path.join(dirPath, child.name);
            if (child.isDirectory()) {
              count += countFilesRecursive(childPath);
            } else if (child.isFile()) {
              count += 1;
            }
          }
        } catch {
          // Best effort.
        }
        return count;
      }

      // Walk Assets/.
      await walkDir(path.join(libPath, 'Assets'), 'Assets');

      // Walk .serpent/revisions/.
      const revisionsDir = path.join(libPath, '.serpent', 'revisions');
      if (directoryExists(revisionsDir)) {
        await walkDir(revisionsDir, '.serpent/revisions');
      }

      // Walk .serpent/trash/.
      const trashDir = path.join(libPath, '.serpent', 'trash');
      if (directoryExists(trashDir)) {
        await walkDir(trashDir, '.serpent/trash');
      }

      // Serpent-pxd: include ready thumbnails/proxies so import does not show
      // broken images while DB still says status=ready. Legacy `.serpent/previews`
      // remains excluded (regenerable / unused by current protocol).
      const artifactsDir = path.join(libPath, '.serpent', 'artifacts');
      if (directoryExists(artifactsDir)) {
        await walkDir(artifactsDir, '.serpent/artifacts');
      }

      // Include .serpent/library.db (snapshot).
      const snapStat = statSync(tempDbPath);
      entries.push({
        sourcePath: tempDbPath,
        relativePath: '.serpent/library.db',
        byteSize: snapStat.size,
      });

      // Optionally include linked folder source content in the same manifest as
      // managed files so progress, cancellation, and summaries stay accurate.
      // A short stable id suffix prevents two equally named linked roots from
      // being merged in the exported backup.
      let includedLinkedContent = false;
      if (input.includeLinkedContent) {
        const linkedFolders = openLibrary.connection
          .prepare('SELECT folder_id, display_name, absolute_root_path, status FROM linked_folders WHERE library_id = ?')
          .all(openLibrary.summary.libraryId) as Array<{
            folder_id: string;
            display_name: string;
            absolute_root_path: string;
            status: 'available' | 'offline';
          }>;
        if (linkedFolders.length > 0) {
          includedLinkedContent = true;
          for (const lf of linkedFolders) {
            if (cancelState.cancelled) break;
            if (lf.status !== 'available' || !realDirectoryExists(lf.absolute_root_path)) {
              throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
                reason: 'SOURCE_NOT_FOUND',
              });
            }
            const exportName = `${cleanFilename(lf.display_name)}-${lf.folder_id.slice(0, 8)}`;
            await walkDir(lf.absolute_root_path, `_linked/${exportName}`);
          }
        }
      }

      const totalFiles = entries.length;
      let totalBytes = 0;
      for (const entry of entries) {
        totalBytes += entry.byteSize;
      }

      // Phase 3: copy
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'copy', filesProcessed: 0, totalFiles,
        bytesProcessed: 0, totalBytes,
      });

      let filesProcessed = 0;
      let bytesProcessed = 0;
      let lastEmitTime = Date.now();
      const BATCH_SIZE = 50;
      const THROTTLE_MS = 200;

      for (const entry of entries) {
        await transferCheckpoint();
        if (cancelState.cancelled) break;
        const destPath = path.join(canonicalDest, ...entry.relativePath.split('/'));
        mkdirSync(path.dirname(destPath), { recursive: true });
        copyFileSync(entry.sourcePath, destPath);
        filesProcessed += 1;
        bytesProcessed += entry.byteSize;

        if (
          filesProcessed % BATCH_SIZE === 0 ||
          Date.now() - lastEmitTime >= THROTTLE_MS
        ) {
          this.emitProgress({
            type: 'export.progress', exportId,
            libraryId: input.libraryId,
            phase: 'copy', filesProcessed, totalFiles,
            bytesProcessed, totalBytes,
          });
          lastEmitTime = Date.now();
        }
      }

      // Remove the temp DB snapshot.
      rmSync(tempDbPath, { force: true });

      if (cancelState.cancelled) {
        this.emitProgress({
          type: 'export.progress', exportId,
          libraryId: input.libraryId,
          phase: 'cancelled', filesProcessed, totalFiles,
          bytesProcessed, totalBytes,
        });
        // Clean up the destination.
        this.removeOwnedTransferPath('export.cancel.cleanup-destination', canonicalDest, true);
        throw new LibraryServiceError('CANCELLED');
      }

      // Phase 4: complete
      const durationMs = Date.now() - startedAt;
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'complete', filesProcessed, totalFiles,
        bytesProcessed, totalBytes,
      });

      return {
        exportId,
        fileCount: totalFiles,
        totalBytes,
        excludedPreviewCount,
        includedLinkedContent,
        durationMs,
      };
    } catch (error) {
      if (cancelState.cancelled) {
        this.emitProgress({
          type: 'export.progress', exportId,
          libraryId: input.libraryId,
          phase: 'cancelled', filesProcessed: 0, totalFiles: 0,
          bytesProcessed: 0, totalBytes: 0,
        });
      }
      if (destinationOwned) {
        this.removeOwnedTransferPath('export.failure.cleanup-destination', canonicalDest, true);
      }
      throw error;
    } finally {
      this.releaseExportTransfer(input.libraryId, exportId);
    }
  }

  cancelExport(exportId: string): void {
    const state = this.activeExports.get(exportId);
    if (!state) throw new LibraryServiceError('IMPORT_NOT_FOUND');
    state.cancelled = true;
    state.onCancel?.();
  }

  async importLibraryFromFolder(input: {
    sourceFolderPath: string;
    copyToParentPath?: string;
  }): Promise<{
    importId: string;
    libraryId: string;
    displayName: string;
    libraryPath: string;
  }> {
    const importId = randomUUID();
    const cancelState: TransferCancelState = { cancelled: false };
    const importDestinationPath = input.copyToParentPath
      ? path.join(input.copyToParentPath, path.basename(input.sourceFolderPath))
      : input.sourceFolderPath;
    const importTransfer = this.acquireImportTransfer(
      importId,
      input.sourceFolderPath,
      importDestinationPath,
      cancelState,
    );
    let ownedDestinationPath: string | undefined;
    let completed = false;

    try {
      // Phase 1: validate source.
      this.emitProgress({
        type: 'import.progress', importId,
        phase: 'validate', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });
      await transferCheckpoint();
      if (cancelState.cancelled) throw new LibraryServiceError('CANCELLED');

      // Validate sourceFolderPath is a readable directory (not a symlink).
      let sourceStat;
      try {
        sourceStat = lstatSync(input.sourceFolderPath);
      } catch (error) {
        throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
      }
      if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
        throw new LibraryServiceError('NOT_A_LIBRARY');
      }

      // Validate Assets/ exists (real directory, not symlink).
      const assetsPath = path.join(input.sourceFolderPath, 'Assets');
      if (!realDirectoryExists(assetsPath)) {
        throw new LibraryServiceError('NOT_A_LIBRARY');
      }

      // Validate .serpent/library.db exists (real file, not symlink).
      const dbPath = path.join(input.sourceFolderPath, '.serpent', 'library.db');
      if (!realFileExists(dbPath)) {
        throw new LibraryServiceError('NOT_A_LIBRARY');
      }

      assertTreeContainsNoSymlinks(input.sourceFolderPath);

      let libraryPath: string;

      if (input.copyToParentPath) {
        // Phase 2: copy.
        this.emitProgress({
          type: 'import.progress', importId,
          phase: 'copy', filesProcessed: 0, totalFiles: 0,
          bytesProcessed: 0, totalBytes: 0,
        });

        const baseName = path.basename(input.sourceFolderPath);
        libraryPath = path.join(input.copyToParentPath, baseName);

        if (existsSync(libraryPath)) {
          throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS');
        }
        try {
          mkdirSync(libraryPath);
          ownedDestinationPath = libraryPath;
        } catch (error) {
          if (hasErrorCode(error, 'EEXIST')) {
            throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS', { cause: error });
          }
          throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
        }

        if (cancelState.cancelled) {
          this.emitProgress({ type: 'import.progress', importId, phase: 'cancelled', filesProcessed: 0, totalFiles: 0, bytesProcessed: 0, totalBytes: 0 });
          throw new LibraryServiceError('CANCELLED');
        }

        try {
          await copyDirRecursiveCancellable(input.sourceFolderPath, libraryPath, cancelState);
        } catch (error) {
          // Clean up incomplete copy.
          this.removeOwnedTransferPath('import.copy.failure.cleanup', libraryPath, true);
          if (error instanceof LibraryServiceError && error.code === 'CANCELLED') {
            this.emitProgress({ type: 'import.progress', importId, phase: 'cancelled', filesProcessed: 0, totalFiles: 0, bytesProcessed: 0, totalBytes: 0 });
          }
          throw error;
        }

        if (cancelState.cancelled) {
          this.removeOwnedTransferPath('import.copy.cancel.cleanup', libraryPath, true);
          this.emitProgress({ type: 'import.progress', importId, phase: 'cancelled', filesProcessed: 0, totalFiles: 0, bytesProcessed: 0, totalBytes: 0 });
          throw new LibraryServiceError('CANCELLED');
        }
      } else {
        // Open in place.
        libraryPath = input.sourceFolderPath;
      }

      // Phase 3: open.
      this.emitProgress({
        type: 'import.progress', importId,
        phase: 'open', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });

      const summary = this.openLibrary(libraryPath);

      // Phase 4: complete.
      this.emitProgress({
        type: 'import.progress', importId,
        phase: 'complete', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });

      completed = true;
      return {
        importId,
        libraryId: summary.libraryId,
        displayName: summary.displayName,
        libraryPath: summary.libraryPath,
      };
    } catch (error) {
      if (cancelState.cancelled) {
        this.emitProgress({
          type: 'import.progress', importId,
          phase: 'cancelled', filesProcessed: 0, totalFiles: 0,
          bytesProcessed: 0, totalBytes: 0,
        });
      }
      if (error instanceof LibraryServiceError) throw error;
      throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
    } finally {
      if (ownedDestinationPath && !completed) {
        this.removeOwnedTransferPath('import.failure.cleanup-destination', ownedDestinationPath, true);
      }
      this.releaseImportTransfer(importTransfer);
    }
  }

  cancelImport(importId: string): void {
    const state = this.activeImports.get(importId);
    if (!state) throw new LibraryServiceError('IMPORT_NOT_FOUND');
    state.cancelled = true;
    state.onCancel?.();
  }

  // ── ZIP export ───────────────────────────────────────────────────────────

  /** Maximum total size for a standard (non-ZIP64) ZIP archive: 4 GiB = 4,294,967,296 bytes. */
  private static readonly ZIP_MAX_BYTES = 4 * 1024 * 1024 * 1024;
  /** Maximum entry count for a standard (non-ZIP64) ZIP archive: 65535. */
  private static readonly ZIP_MAX_ENTRIES = 65534;
  /** Import budget for uncompressed standard-ZIP content. */
  private static readonly ZIP_IMPORT_MAX_UNCOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024;
  /** Reject highly compressible payloads commonly used as decompression bombs. */
  private static readonly ZIP_IMPORT_MAX_COMPRESSION_RATIO = 100;
  private static readonly ZIP_COMPRESSION_RATIO_MIN_SIZE = 1024 * 1024;

  async exportLibraryToZip(input: {
    libraryId: string;
    destinationPath: string;
    includeLinkedContent: boolean;
  }): Promise<{
    exportId: string;
    fileCount: number;
    totalBytes: number;
    excludedPreviewCount: number;
    includedLinkedContent: boolean;
    durationMs: number;
  }> {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const exportId = randomUUID();

    // Ensure the destination file does not exist yet (prevent accidental overwrite).
    if (existsSync(input.destinationPath)) {
      throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS');
    }

    // Reject destination inside the library.
    const libPath = openLibrary.summary.libraryPath;
    let canonicalLib: string;
    try {
      canonicalLib = realpathSync(libPath);
    } catch {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const destDir = path.dirname(input.destinationPath);
    let canonicalDestDir: string;
    try {
      canonicalDestDir = realpathSync(destDir);
    } catch {
      canonicalDestDir = destDir;
    }
    if (pathIsWithin(canonicalLib, canonicalDestDir)) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }

    const cancelState: TransferCancelState = { cancelled: false };
    this.acquireExportTransfer(input.libraryId, exportId, cancelState);
    const startedAt = Date.now();

    const tempDir = path.join(path.dirname(input.destinationPath), `.serpent-zip-export-${exportId}`);
    let tempDbPath: string | undefined;
    let tempDirOwned = false;
    let destinationOwned = false;

    function countFilesRecursive(dirPath: string): number {
      let count = 0;
      try {
        for (const child of readdirSync(dirPath, { withFileTypes: true })) {
          if (child.isSymbolicLink()) continue;
          const childPath = path.join(dirPath, child.name);
          if (child.isDirectory()) {
            count += countFilesRecursive(childPath);
          } else if (child.isFile()) {
            count += 1;
          }
        }
      } catch {
        // Best effort.
      }
      return count;
    }

    try {
      mkdirSync(tempDir);
      tempDirOwned = true;

      // Phase 1: snapshot-db
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'snapshot-db', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });
      await transferCheckpoint();
      if (cancelState.cancelled) throw new LibraryServiceError('CANCELLED');

      tempDbPath = path.join(tempDir, `library-${exportId}.db`);
      await this.createConsistentDatabaseSnapshot(openLibrary.connection, tempDbPath, cancelState);

      // Phase 2: enumerate
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'enumerate', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });

      interface ZipEntry {
        sourcePath: string;
        relativePath: string;
        byteSize: number;
      }
      const entries: ZipEntry[] = [];
      let excludedPreviewCount = 0;

      const walkDir = async (dirPath: string, relPrefix: string): Promise<void> => {
        if (cancelState.cancelled) return;
        let children;
        try {
          children = readdirSync(dirPath, { withFileTypes: true });
        } catch (error) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
        }
        for (const child of children) {
          await transferCheckpoint();
          if (cancelState.cancelled) return;
          const childPath = path.join(dirPath, child.name);
          const childRel = relPrefix ? path.posix.join(relPrefix, child.name) : child.name;

          if (child.isSymbolicLink()) continue;

          if (child.isDirectory()) {
            if (childRel === '.serpent/previews' || childRel === '.serpent/operations') {
              if (childRel === '.serpent/previews') {
                try {
                  excludedPreviewCount += countFilesRecursive(childPath);
                } catch {
                  // Best effort.
                }
              }
              continue;
            }
            await walkDir(childPath, childRel);
          } else if (child.isFile()) {
            const lowerName = child.name.toLowerCase();
            if (
              lowerName.endsWith('.tmp') ||
              lowerName.includes('.wave-tmp.') ||
              lowerName.includes('-tmp.') ||
              (lowerName.startsWith('.') && (
                lowerName.includes('temp') || lowerName.includes('cache') ||
                lowerName.startsWith('.ds_store') || lowerName === 'thumbs.db'
              ))
            ) {
              continue;
            }
            const stat = lstatSync(childPath);
            if (stat.isSymbolicLink()) continue;
            entries.push({
              sourcePath: childPath,
              relativePath: childRel,
              byteSize: stat.size,
            });
          }
        }
      };

      // Walk Assets/.
      await walkDir(path.join(libPath, 'Assets'), 'Assets');

      // Walk .serpent/revisions/.
      const revisionsDir = path.join(libPath, '.serpent', 'revisions');
      if (directoryExists(revisionsDir)) {
        await walkDir(revisionsDir, '.serpent/revisions');
      }

      // Walk .serpent/trash/.
      const trashDir = path.join(libPath, '.serpent', 'trash');
      if (directoryExists(trashDir)) {
        await walkDir(trashDir, '.serpent/trash');
      }

      // Serpent-pxd: same artifacts contract as folder export.
      const artifactsDir = path.join(libPath, '.serpent', 'artifacts');
      if (directoryExists(artifactsDir)) {
        await walkDir(artifactsDir, '.serpent/artifacts');
      }

      // Add .serpent/library.db (snapshot).
      const snapStat = statSync(tempDbPath);
      entries.push({
        sourcePath: tempDbPath,
        relativePath: '.serpent/library.db',
        byteSize: snapStat.size,
      });

      // ZIP exports follow the same linked-content contract as folder exports.
      // Linked sources remain supplemental backup material under _linked/; the
      // database retains its original roots so unavailable roots reopen offline.
      let includedLinkedContent = false;
      if (input.includeLinkedContent) {
        const linkedFolders = openLibrary.connection
          .prepare('SELECT folder_id, display_name, absolute_root_path, status FROM linked_folders WHERE library_id = ?')
          .all(openLibrary.summary.libraryId) as Array<{
            folder_id: string;
            display_name: string;
            absolute_root_path: string;
            status: 'available' | 'offline';
          }>;
        if (linkedFolders.length > 0) {
          includedLinkedContent = true;
          for (const linkedFolder of linkedFolders) {
            if (cancelState.cancelled) break;
            if (linkedFolder.status !== 'available' || !realDirectoryExists(linkedFolder.absolute_root_path)) {
              throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'SOURCE_NOT_FOUND' });
            }
            const exportName = `${cleanFilename(linkedFolder.display_name)}-${linkedFolder.folder_id.slice(0, 8)}`;
            await walkDir(linkedFolder.absolute_root_path, `_linked/${exportName}`);
          }
        }
      }

      const totalFiles = entries.length;
      let totalBytes = 0;
      for (const entry of entries) {
        totalBytes += entry.byteSize;
      }

      // ZIP pre-check: reject if total size > 4 GiB or entry count > 65534.
      if (totalBytes > LibraryService.ZIP_MAX_BYTES || totalFiles > LibraryService.ZIP_MAX_ENTRIES) {
        throw new LibraryServiceError('ZIP_TOO_LARGE', { reason: 'ZIP_TOO_LARGE' });
      }

      // Phase 3: compress
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'compress', filesProcessed: 0, totalFiles,
        bytesProcessed: 0, totalBytes,
      });

      // Dynamically import archiver (CJS module).
      interface ZipArchiverInstance {
        pipe(output: ReturnType<typeof createWriteStream>): void;
        file(path: string, options: { name: string }): void;
        finalize(): void;
        abort(): void;
        on(event: string, listener: (err: Error) => void): void;
      }
      // archiver v8 exports named classes; ZipArchive is the ZIP-specific one.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const archiverModule = require('archiver') as {
        ZipArchive: new (options?: Record<string, unknown>) => ZipArchiverInstance;
      };

      const destZipPath = input.destinationPath;
      // Ensure parent directory exists.
      mkdirSync(path.dirname(destZipPath), { recursive: true });

      // Reserve the final path atomically. From this point onward cleanup may
      // remove it because this operation demonstrably owns it.
      try {
        const destinationHandle = openSync(destZipPath, 'wx');
        closeSync(destinationHandle);
        destinationOwned = true;
      } catch (error) {
        if (hasErrorCode(error, 'EEXIST')) {
          throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS', { cause: error });
        }
        throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
      }

      const output = createWriteStream(destZipPath);
      const archive = new archiverModule.ZipArchive({ zlib: { level: 6 }, forceZip64: false });

      let archiverError: Error | undefined;
      archive.on('error', (err: Error) => {
        archiverError = err;
      });
      archive.on('warning', (err: Error) => {
        // Missing or unreadable source entries make the export incomplete and
        // therefore must fail rather than producing a silently truncated ZIP.
        archiverError = err;
      });

      // Pipe archive data to the destination file.
      archive.pipe(output);

      let filesProcessed = 0;
      let bytesProcessed = 0;
      let lastEmitTime = Date.now();
      const BATCH_SIZE = 50;
      const THROTTLE_MS = 200;

      for (const entry of entries) {
        await transferCheckpoint();
        if (cancelState.cancelled) break;
        if (archiverError) throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: archiverError });

        archive.file(entry.sourcePath, { name: entry.relativePath });

        filesProcessed += 1;
        bytesProcessed += entry.byteSize;

        if (
          filesProcessed % BATCH_SIZE === 0 ||
          Date.now() - lastEmitTime >= THROTTLE_MS
        ) {
          this.emitProgress({
            type: 'export.progress', exportId,
            libraryId: input.libraryId,
            phase: 'compress', filesProcessed, totalFiles,
            bytesProcessed, totalBytes,
          });
          lastEmitTime = Date.now();
        }
      }

      if (cancelState.cancelled) {
        // Destroy streams, then wait for the destination handle to close
        // before deleting the file: the release is asynchronous, and on
        // Windows an immediate rm hits EPERM and masks CANCELLED with
        // LIBRARY_NOT_WRITABLE (POSIX unlinks open files, hiding this).
        const outputClosed = waitForStreamClose(output);
        archive.abort();
        output.destroy();
        await outputClosed;
        // Remove the temp db and temp dir.
        this.removeOwnedTransferPath('export.zip.cancel.cleanup-temp', tempDir, true);
        tempDirOwned = false;
        // Remove the destination file.
        this.removeOwnedTransferPath('export.zip.cancel.cleanup-destination', destZipPath, false);
        destinationOwned = false;
        this.emitProgress({
          type: 'export.progress', exportId,
          libraryId: input.libraryId,
          phase: 'cancelled', filesProcessed, totalFiles,
          bytesProcessed, totalBytes,
        });
        throw new LibraryServiceError('CANCELLED');
      }

      // Finalize the archive (wait for the output stream to finish).
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (operation: () => void): void => {
          if (settled) return;
          settled = true;
          cancelState.onCancel = undefined;
          operation();
        };
        cancelState.onCancel = () => {
          archive.abort();
          output.destroy();
        };
        output.on('close', () => {
          if (cancelState.cancelled) settle(() => reject(new LibraryServiceError('CANCELLED')));
        });
        output.on('finish', () => {
          if (archiverError) {
            settle(() => reject(new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: archiverError })));
            return;
          }
          settle(resolve);
        });
        output.on('error', (err: Error) => {
          if (cancelState.cancelled) {
            settle(() => reject(new LibraryServiceError('CANCELLED', { cause: err })));
            return;
          }
          settle(() => reject(new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: err })));
        });
        void archive.finalize();
      });

      // Clean up temp dir.
      this.removeOwnedTransferPath('export.zip.complete.cleanup-temp', tempDir, true);
      tempDirOwned = false;

      // Final progress.
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'compress', filesProcessed, totalFiles,
        bytesProcessed, totalBytes,
      });

      // Phase 4: complete
      const durationMs = Date.now() - startedAt;
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'complete', filesProcessed, totalFiles,
        bytesProcessed, totalBytes,
      });

      return {
        exportId,
        fileCount: totalFiles,
        totalBytes,
        excludedPreviewCount,
        includedLinkedContent,
        durationMs,
      };
    } catch (error) {
      if (cancelState.cancelled) {
        this.emitProgress({
          type: 'export.progress', exportId,
          libraryId: input.libraryId,
          phase: 'cancelled', filesProcessed: 0, totalFiles: 0,
          bytesProcessed: 0, totalBytes: 0,
        });
      }
      if (destinationOwned) {
        this.removeOwnedTransferPath('export.zip.failure.cleanup-destination', input.destinationPath, false);
      }
      if (tempDirOwned) {
        this.removeOwnedTransferPath('export.zip.failure.cleanup-temp', tempDir, true);
      }
      throw error;
    } finally {
      this.releaseExportTransfer(input.libraryId, exportId);
    }
  }

  // ── ZIP import ───────────────────────────────────────────────────────────

  async importLibraryFromZip(input: {
    sourceZipPath: string;
    destinationParentPath: string;
  }): Promise<{
    importId: string;
    libraryId: string;
    displayName: string;
    libraryPath: string;
  }> {
    const importId = randomUUID();
    const cancelState: TransferCancelState = { cancelled: false };
    const baseName = path.basename(input.sourceZipPath, path.extname(input.sourceZipPath));
    const extractPath = path.join(input.destinationParentPath, baseName);
    const importTransfer = this.acquireImportTransfer(
      importId,
      input.sourceZipPath,
      extractPath,
      cancelState,
    );
    let ownedExtractPath: string | undefined;
    let completed = false;
    let totalEntries = 0;
    let totalUncompressedBytes = 0;
    let extractedBytes = 0;
    let manifestValidationError: LibraryServiceError | undefined;

    try {
      if (existsSync(extractPath)) {
        throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS');
      }
      // Phase 1: validate
      this.emitProgress({
        type: 'import.progress', importId,
        phase: 'validate', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });
      await transferCheckpoint();
      if (cancelState.cancelled) throw new LibraryServiceError('CANCELLED');

      // Phase 2: extract
      try {
        mkdirSync(extractPath);
        ownedExtractPath = extractPath;
      } catch (error) {
        if (hasErrorCode(error, 'EEXIST')) {
          throw new LibraryServiceError('LIBRARY_ALREADY_EXISTS', { cause: error });
        }
        throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', { cause: error });
      }

      if (cancelState.cancelled) {
        this.emitProgress({ type: 'import.progress', importId, phase: 'cancelled', filesProcessed: 0, totalFiles: 0, bytesProcessed: 0, totalBytes: 0 });
        throw new LibraryServiceError('CANCELLED');
      }

      this.emitProgress({
        type: 'import.progress', importId,
        phase: 'extract', filesProcessed: 0, totalFiles: totalEntries,
        bytesProcessed: 0, totalBytes: 0,
      });

      const abortController = new AbortController();
      cancelState.onCancel = () => abortController.abort();
      try {
        await extractZipStream({
          sourceZipPath: input.sourceZipPath,
          destinationRoot: extractPath,
          signal: abortController.signal,
          limits: {
            maxEntries: LibraryService.ZIP_MAX_ENTRIES,
            maxUncompressedBytes: LibraryService.ZIP_IMPORT_MAX_UNCOMPRESSED_BYTES,
            maxEntryUncompressedBytes: LibraryService.ZIP_IMPORT_MAX_UNCOMPRESSED_BYTES,
            maxCompressionRatio: LibraryService.ZIP_IMPORT_MAX_COMPRESSION_RATIO,
            compressionRatioMinSize: LibraryService.ZIP_COMPRESSION_RATIO_MIN_SIZE,
          },
          validateManifest: (manifest: ZipArchiveManifest) => {
            const hasAssetFiles = manifest.entries.some(
              (entry) => !entry.isDirectory && entry.name.startsWith('Assets/'),
            );
            const hasDatabase = manifest.entries.some(
              (entry) => !entry.isDirectory && entry.name === '.serpent/library.db',
            );
            if (!hasAssetFiles || !hasDatabase) {
              manifestValidationError = new LibraryServiceError('NOT_A_LIBRARY', {
                reason: 'NOT_A_LIBRARY',
              });
              throw new ZipImportStreamError('INVALID_ZIP');
            }
          },
          onProgress: (progress) => {
            totalEntries = progress.totalEntries;
            totalUncompressedBytes = progress.totalBytes;
            extractedBytes = progress.bytesProcessed;
            this.emitProgress({
              type: 'import.progress', importId,
              phase: 'extract', filesProcessed: progress.entriesProcessed,
              totalFiles: progress.totalEntries,
              bytesProcessed: progress.bytesProcessed,
              totalBytes: progress.totalBytes,
            });
          },
        });
      } finally {
        cancelState.onCancel = undefined;
      }

      if (cancelState.cancelled) {
        this.removeOwnedTransferPath('import.zip.cancel.cleanup-destination', extractPath, true);
        this.emitProgress({ type: 'import.progress', importId, phase: 'cancelled', filesProcessed: 0, totalFiles: totalEntries, bytesProcessed: 0, totalBytes: 0 });
        throw new LibraryServiceError('CANCELLED');
      }

      // Phase 3: verify
      this.emitProgress({
        type: 'import.progress', importId,
        phase: 'verify', filesProcessed: 0, totalFiles: totalEntries,
        bytesProcessed: 0, totalBytes: 0,
      });

      // Validate the extracted folder is a valid library.
      // Canonicalize the extract path so symlink checks compare against
      // the real path (important on macOS where /var -> /private/var).
      let canonicalExtractPath: string;
      try {
        canonicalExtractPath = realpathSync(extractPath);
      } catch {
        canonicalExtractPath = extractPath;
      }
      assertTreeContainsNoSymlinks(canonicalExtractPath);
      this.validateImportSource(canonicalExtractPath);

      // Phase 4: open
      this.emitProgress({
        type: 'import.progress', importId,
        phase: 'open', filesProcessed: 0, totalFiles: totalEntries,
        bytesProcessed: 0, totalBytes: 0,
      });

      const summary = this.openLibrary(canonicalExtractPath);

      // Phase 5: complete
      this.emitProgress({
        type: 'import.progress', importId,
        phase: 'complete', filesProcessed: totalEntries, totalFiles: totalEntries,
        bytesProcessed: extractedBytes, totalBytes: totalUncompressedBytes,
      });

      completed = true;
      return {
        importId,
        libraryId: summary.libraryId,
        displayName: summary.displayName,
        libraryPath: summary.libraryPath,
      };
    } catch (error) {
      if (cancelState.cancelled) {
        this.emitProgress({
          type: 'import.progress', importId,
          phase: 'cancelled', filesProcessed: 0, totalFiles: 0,
          bytesProcessed: 0, totalBytes: 0,
        });
      }
      if (ownedExtractPath && !completed) {
        this.removeOwnedTransferPath('import.zip.failure.cleanup-destination', ownedExtractPath, true);
      }
      if (error instanceof LibraryServiceError) throw error;
      if (manifestValidationError) throw manifestValidationError;
      if (error instanceof ZipImportStreamError) throw this.mapZipImportError(error);
      throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
    } finally {
      cancelState.onCancel = undefined;
      this.releaseImportTransfer(importTransfer);
    }
  }

  validateImportSource(sourceFolderPath: string): {
    libraryId: string;
    displayName: string;
  } {
    // Validate sourceFolderPath is a readable directory (not a symlink).
    let sourceStat;
    try {
      sourceStat = lstatSync(sourceFolderPath);
    } catch (error) {
      throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
    }
    if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }

    // Validate Assets/ exists (real directory, not symlink).
    const assetsPath = path.join(sourceFolderPath, 'Assets');
    if (!realDirectoryExists(assetsPath)) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }

    // Validate .serpent/library.db exists (real file, not symlink).
    const dbPath = path.join(sourceFolderPath, '.serpent', 'library.db');
    if (!realFileExists(dbPath)) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }

    assertTreeContainsNoSymlinks(sourceFolderPath);

    // Open a read-only connection to read the library identity.
    let connection: DatabaseConnection | undefined;
    try {
      connection = openConfiguredDatabase(dbPath);
      const library = connection
        .prepare('SELECT library_id, display_name FROM library ORDER BY library_id LIMIT 2')
        .all() as Array<{ library_id: string; display_name: string }>;
      if (library.length !== 1 || !library[0]?.library_id || !library[0]?.display_name) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
      return {
        libraryId: library[0].library_id,
        displayName: library[0].display_name,
      };
    } finally {
      closeIgnoringFailure(connection);
    }
  }

  closeLibrary(libraryId: string): void {
    const openLibrary = this.openById.get(libraryId);
    if (!openLibrary) throw new LibraryServiceError('LIBRARY_NOT_OPEN');

    // A deliberate close is not a crash recovery boundary. Persist queued,
    // paused, and running AI work as cancelled before the connection closes so
    // reopening the library cannot silently resume uploads the user stopped.
    this.cancelJobs(libraryId);
    this.abortActiveMediaJobs(libraryId);
    this.stopAssetWatcher(libraryId);
    this.stopLinkedWatchers(libraryId);
    for (const [importId, pending] of this.pendingImports) {
      if (pending.libraryId === libraryId) {
        this.pendingImports.delete(importId);
        this.cancelImportExpiry(pending);
        this.updateImportOperation(pending, 'rolled_back', 'LIBRARY_CLOSED');
        this.removeOperation(pending.operationPath);
      }
    }
    openLibrary.connection.close();
    this.openById.delete(libraryId);
    this.openIdByPath.delete(openLibrary.summary.libraryPath);
    this.autoRepairAttemptedByLibrary.delete(libraryId);
    this.autoRepairProbeFailedAtByLibrary.delete(libraryId);
  }

  /**
   * Serpent-9i8: close the open library, then permanently delete its root
   * directory (Assets / .serpent / managed content). Linked-folder *source*
   * trees live outside the library root and are not touched.
   */
  deleteLibraryFromDisk(libraryId: string): {
    libraryId: string;
    displayName: string;
    libraryPath: string;
  } {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const { libraryPath, displayName } = openLibrary.summary;

    for (const directoryName of REQUIRED_DIRECTORIES) {
      if (!realDirectoryExists(path.join(libraryPath, directoryName))) {
        throw new LibraryServiceError('NOT_A_LIBRARY');
      }
    }
    if (
      !realDirectoryExists(path.join(libraryPath, '.serpent')) ||
      !realFileExists(databasePath(libraryPath))
    ) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }

    this.closeLibrary(libraryId);

    try {
      rmSync(libraryPath, { force: true, recursive: true });
    } catch (error) {
      this.diagnose('library.delete-from-disk', error, { libraryPath });
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
        reason: publicReasonFromError(error),
        cause: error,
      });
    }

    if (existsSync(libraryPath)) {
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE', {
        reason: 'IO_ERROR',
      });
    }

    return { libraryId, displayName, libraryPath };
  }

  listLibraries(): InternalLibrarySummary[] {
    return [...this.openById.values()].map(({ summary }) => ({ ...summary }));
  }

  closeAll(): void {
    for (const libraryId of [...this.openById.keys()]) this.closeLibrary(libraryId);
  }
}
