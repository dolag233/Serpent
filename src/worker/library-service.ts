import { randomUUID, createHash } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
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

import BetterSqlite3 from 'better-sqlite3';

import type { AssetMetadataResult, AssetSummary, CollectionSummary, LinkedFolderSummary, ManagedFolderSummary, TagSummary } from '../shared/asset-types';

// sharp is an optional N-API dependency (no rebuild needed for Electron).
// The Worker loads it lazily so it can still start if sharp is missing.
interface SharpModule {
  (input: string): SharpInstance;
}
interface SharpInstance {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  resize(options: {
    width?: number;
    height?: number;
    fit?: 'inside' | 'cover' | 'fill' | 'outside';
    withoutEnlargement?: boolean;
  }): SharpInstance;
  webp(options: { quality?: number }): SharpInstance;
  toFile(output: string): Promise<unknown>;
}

let sharpModule: SharpModule | undefined;
function requireSharp(): SharpModule {
  if (!sharpModule) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sharpModule = require('sharp') as SharpModule;
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
import type { PublicErrorCode } from '../shared/protocol/errors';
import { publicReasonFromError, type PublicErrorReason } from '../shared/protocol/errors';
import type {
  NameConflictDecision,
  SuspectedDuplicateDecision,
} from '../shared/protocol/requests';
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

interface RunResult {
  changes: number;
}

interface Statement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): RunResult;
}

interface DatabaseConnection {
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

const CONTENT_TYPE_WHITELIST = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'image/tiff', 'image/bmp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime',
  'video/x-msvideo', 'video/x-ms-wmv',
]);

function extensionForContentType(contentType: string): string | undefined {
  const lower = contentType.toLowerCase();
  if (lower === 'image/png') return '.png';
  if (lower === 'image/jpeg') return '.jpg';
  if (lower === 'image/gif') return '.gif';
  if (lower === 'image/webp') return '.webp';
  if (lower === 'image/tiff') return '.tiff';
  if (lower === 'image/bmp') return '.bmp';
  if (lower === 'image/svg+xml') return '.svg';
  if (lower === 'video/mp4') return '.mp4';
  if (lower === 'video/webm') return '.webm';
  if (lower === 'video/quicktime') return '.mov';
  if (lower === 'video/x-msvideo') return '.avi';
  if (lower === 'video/x-ms-wmv') return '.wmv';
  return undefined;
}

function cleanFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\x00-\x1f<>:"/\\|?*\x7f]+/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 255) || 'download';
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

// Default ignore rules for linked-folder enumeration. Hardcoded for MVP; the
// graphical rule editor is a later slice. Names match case-insensitively so a
// repository checked out on macOS (case-insensitive APFS) and Windows
// (case-insensitive NTFS) ignores the same entries.
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.svn',
  '.hg',
  '__pycache__',
]);
const DEFAULT_IGNORED_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

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
  modified_at: string;
  relative_file_path: string;
  label: string | null;
  rating: number;
  favorite: number;
}

interface ImportSourceEntry {
  byteSize: number;
  destinationRelativePath: string;
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
  | 'before-db-commit'
  | 'committed-cleanup'
  | 'committed-result-list'
  | 'crash-after-backup'
  | 'crash-after-place'
  | 'crash-during-prepare-stage'
  | 'recovery-restore'
  | 'rollback-restore';

export interface LibraryServiceOptions {
  afterSourceSnapshotCopy?: (sourcePath: string) => void;
  assetLstat?: (assetPath: string) => Stats;
  beforeSourceSnapshotOpen?: (sourcePath: string) => void;
  debounceMs?: number;
  destinationLstat?: (destinationPath: string) => Stats;
  failAt?: ImportFailurePoint | ImportFailurePoint[];
  importClock?: ImportExpiryClock;
  importTtlMs?: number;
  onAssetsChanged?: (event: AssetsChangedEvent) => void;
  onDiagnostic?: (diagnostic: LibraryServiceDiagnostic) => void;
  onProgress?: (event: ExportProgressEvent | ImportProgressEvent) => void;
  observerFactory?: AssetObserverFactory;
  scheduler?: DebounceScheduler;
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

class SimulatedCrashError extends Error {}

export class LibraryServiceError extends Error {
  constructor(
    readonly code: PublicErrorCode,
    options?: { cause?: unknown; reason?: PublicErrorReason },
  ) {
    super(code, options);
    this.name = 'LibraryServiceError';
    this.reason = options?.reason ?? publicReasonFromError(options?.cause);
  }

  readonly reason?: PublicErrorReason;
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

function copyDirRecursive(
  sourcePath: string,
  destPath: string,
  cancelState: { cancelled: boolean },
): void {
  mkdirSync(destPath, { recursive: true });
  let children;
  try {
    children = readdirSync(sourcePath, { withFileTypes: true });
  } catch (error) {
    throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
  }
  for (const child of children) {
    if (cancelState.cancelled) return;
    const childSource = path.join(sourcePath, child.name);
    const childDest = path.join(destPath, child.name);
    if (child.isSymbolicLink()) continue; // Never follow symlinks.
    if (child.isDirectory()) {
      copyDirRecursive(childSource, childDest, cancelState);
    } else if (child.isFile()) {
      copyFileSync(childSource, childDest);
    }
  }
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
    const rebuildsTable = migration.version === 4 || migration.version === 6 || migration.version === 7;
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
    if (rebuildsTable) {
      const foreignKeyViolations = connection.pragma('foreign_key_check');
      connection.pragma('foreign_keys = ON');
      if (Array.isArray(foreignKeyViolations) && foreignKeyViolations.length > 0) {
        throw new LibraryServiceError('LIBRARY_CORRUPT');
      }
    }
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
  private readonly activeExports = new Map<string, { cancelled: boolean }>();
  private readonly activeImports = new Map<string, { cancelled: boolean }>();

  constructor(private readonly options: LibraryServiceOptions = {}) {}

  private diagnose(scope: string, error: unknown, context?: Record<string, unknown>): void {
    try {
      this.options.onDiagnostic?.({ scope, error, context });
    } catch {
      // Diagnostics are strictly best effort and must never replace the primary failure.
    }
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
    if (
      !UUID.test(path.basename(operationPath)) ||
      relation !== path.basename(operationPath) ||
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

  private parseOperationManifest(serialized: string): OperationManifest {
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch (error) {
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
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
    return value as OperationManifest;
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
      if (row.status === 'committed' || row.status === 'rolled_back') {
        this.removeOperation(operationPath);
        continue;
      }
      if (row.status === 'failed' && row.error_code !== 'IMPORT_APPLY_FAILED') {
        this.removeOperation(operationPath);
        continue;
      }
      this.assertSafeOperationPath(operationPath);
      const manifest = this.parseOperationManifest(row.manifest_json);
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
        const orphanPath = path.join(operationsPath, child);
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
        if (isMissingPathError(error)) break;
        throw new LibraryServiceError('INVALID_LIBRARY_PATH', { cause: error });
      }
    }
    return targetPath;
  }

  private linkedRootIsGone(absoluteRootPath: string): boolean {
    try {
      const entry = lstatSync(absoluteRootPath);
      return entry.isSymbolicLink() || !entry.isDirectory();
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
        if (isMissingPathError(error)) break;
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

  listManagedFolders(libraryId: string): ManagedFolderSummary[] {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const rows = openLibrary.connection
      .prepare(
        'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders ORDER BY relative_path',
      )
      .all() as ManagedFolderRow[];
    return rows.map((row) => ({
      folderId: row.folder_id,
      parentFolderId: row.parent_folder_id,
      name: row.name,
      relativePath: row.relative_path,
    }));
  }

  listLinkedFolders(libraryId: string): LinkedFolderSummary[] {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const rows = openLibrary.connection
      .prepare(
        'SELECT folder_id, display_name, status FROM linked_folders WHERE library_id = ? ORDER BY display_name',
      )
      .all(libraryId) as Array<{
        folder_id: string;
        display_name: string;
        status: 'available' | 'offline';
      }>;
    return rows.map((row) => {
      const countRow = openLibrary.connection
        .prepare('SELECT COUNT(*) AS count FROM assets WHERE linked_folder_id = ?')
        .get(row.folder_id) as { count: number };
      return {
        folderId: row.folder_id,
        displayName: row.display_name,
        status: row.status,
        assetCount: countRow.count,
      };
    });
  }

  listAssets(input: {
    libraryId: string;
    folderId?: string;
    recursive: boolean;
  }): AssetSummary[] {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const folder = this.targetFolder(openLibrary, input.folderId);
    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.managed_folder_id, a.relative_file_path,
                a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                m.label, COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
                a.deleted_at, a.trashed_from_relative_path,
                ra.status AS thumbnail_status,
                ra.artifact_id AS thumbnail_artifact_id,
                ra.width AS artifact_width, ra.height AS artifact_height
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
           LEFT JOIN revision_artifacts ra
             ON ra.revision_id = a.current_revision_id
            AND ra.kind = 'thumbnail'
            AND ra.invalidated_at IS NULL
          ORDER BY a.relative_file_path`,
      )
      .all() as Array<AssetSummaryRow & {
        deleted_at: string | null;
        trashed_from_relative_path: string | null;
        thumbnail_status: 'ready' | 'pending' | 'generating' | 'failed' | null;
        thumbnail_artifact_id: string | null;
        artifact_width: number | null;
        artifact_height: number | null;
      }>;

    return rows
      .filter((row) => {
        if (!folder) return input.recursive || row.managed_folder_id === null;
        if (!input.recursive) return row.managed_folder_id === folder.folder_id;
        return (
          row.relative_file_path.startsWith(`${folder.relative_path}/`) ||
          row.managed_folder_id === folder.folder_id
        );
      })
      .map((row) => this.assetSummaryFromRow({
        ...row,
        thumbnail_status: row.thumbnail_status === 'ready' ? 'ready'
          : row.thumbnail_status === 'failed' ? 'failed'
          : row.thumbnail_status === 'pending' || row.thumbnail_status === 'generating' ? 'pending'
          : null,
        thumbnail_artifact_id: row.thumbnail_status === 'ready' ? row.thumbnail_artifact_id : null,
        media_type: LibraryService.detectMediaType(row.relative_file_path) === 'image' ? 'image'
          : LibraryService.detectMediaType(row.relative_file_path) === 'video' ? 'video'
          : 'other',
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

    const entries = this.enumerateLinkedSources(canonicalRoot);
    const folderId = randomUUID();
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

    return {
      folderId,
      displayName: normalizedName,
      status: 'available',
      assetCount: entries.length,
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
          fileStat = lstatSync(assetPath, { bigint: true });
        } catch (error) {
          if (!isMissingPathError(error)) {
            throw new LibraryServiceError('IMPORT_APPLY_FAILED', { cause: error });
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

    const countRow = openLibrary.connection
      .prepare('SELECT COUNT(*) AS count FROM assets WHERE linked_folder_id = ?')
      .get(input.folderId) as { count: number };
    return {
      folderId: input.folderId,
      displayName: folder.display_name,
      status: 'available',
      assetCount: countRow.count,
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
                (SELECT COUNT(*) FROM human_asset_tags h WHERE h.tag_id = t.tag_id) AS asset_count
           FROM tags t
          WHERE t.library_id = ?
          ORDER BY t.name`,
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

    try {
      openLibrary.connection
        .prepare('UPDATE tags SET name = ? WHERE tag_id = ?')
        .run(trimmed, input.tagId);
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
      .prepare('SELECT COUNT(*) AS count FROM human_asset_tags WHERE tag_id = ?')
      .get(input.tagId) as { count: number };
    return { tagId: input.tagId, name: trimmed, assetCount: countRow.count };
  }

  deleteTag(input: { libraryId: string; tagId: string }): string {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const existing = openLibrary.connection
      .prepare('SELECT tag_id FROM tags WHERE tag_id = ? AND library_id = ?')
      .get(input.tagId, openLibrary.summary.libraryId);
    if (!existing) throw new LibraryServiceError('FOLDER_NOT_FOUND');

    openLibrary.connection
      .prepare('DELETE FROM tags WHERE tag_id = ?')
      .run(input.tagId);
    return input.tagId;
  }

  assignTags(input: {
    libraryId: string;
    assetIds: string[];
    tagIds: string[];
  }): { assignedCount: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    const assetRows = openLibrary.connection
      .prepare(
        `SELECT asset_id FROM assets WHERE asset_id IN (${input.assetIds.map(() => '?').join(',')})`,
      )
      .all(...input.assetIds) as Array<{ asset_id: string }>;
    if (assetRows.length !== input.assetIds.length) throw new LibraryServiceError('FOLDER_NOT_FOUND');

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
      for (const assetId of input.assetIds) {
        for (const tagId of input.tagIds) {
          const result = insertStmt.run(assetId, tagId);
          assignedCount += result.changes;
        }
      }
    })();
    for (const assetId of input.assetIds) {
      this.syncAssetSearchContent(openLibrary.connection, assetId);
    }
    return { assignedCount };
  }

  removeTags(input: {
    libraryId: string;
    assetIds: string[];
    tagIds: string[];
  }): { removedCount: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const result = openLibrary.connection
      .prepare(
        `DELETE FROM human_asset_tags
           WHERE asset_id IN (${input.assetIds.map(() => '?').join(',')})
             AND tag_id IN (${input.tagIds.map(() => '?').join(',')})`,
      )
      .run(...input.assetIds, ...input.tagIds);
    for (const assetId of input.assetIds) {
      if (result.changes > 0) this.syncAssetSearchContent(openLibrary.connection, assetId);
    }
    return { removedCount: result.changes };
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
    description?: string;
    coverAssetId?: string;
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
        `SELECT DISTINCT a.asset_id, a.managed_folder_id, a.relative_file_path,
                a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                m.label, COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
                a.deleted_at, a.trashed_from_relative_path
           FROM collection_assets ca
           JOIN assets a ON a.asset_id = ca.asset_id
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
          WHERE ca.collection_id IN (${placeholders})
          ORDER BY ca.position, a.relative_file_path`,
      )
      .all(...collectionIds) as Array<{
        asset_id: string;
        availability: 'available' | 'missing';
        byte_size: number;
        current_revision_id: string;
        managed_folder_id: string | null;
        modified_at: string;
        relative_file_path: string;
        label: string | null;
        rating: number;
        favorite: number;
        deleted_at: string | null;
        trashed_from_relative_path: string | null;
      }>;
    return rows.map((row) => this.assetSummaryFromRow(row));
  }

  // ── Asset Metadata ──────────────────────────────────────────────────

  getAssetMetadata(input: { libraryId: string; assetId: string }): AssetMetadataResult {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    const assetRow = openLibrary.connection
      .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
      .get(input.assetId) as { asset_id: string } | undefined;
    if (!assetRow) throw new LibraryServiceError('ASSET_NOT_FOUND');

    const row = openLibrary.connection
      .prepare(
        `SELECT asset_id, label, description, rating, favorite, palette,
                source_page_url, entity_version, updated_at
           FROM asset_metadata
          WHERE asset_id = ?`,
      )
      .get(input.assetId) as {
        asset_id: string;
        label: string | null;
        description: string | null;
        rating: number;
        favorite: number;
        palette: string | null;
        source_page_url: string | null;
        entity_version: number;
        updated_at: string;
      } | undefined;

    if (!row) {
      return {
        assetId: input.assetId,
        label: null,
        description: null,
        rating: 0,
        favorite: false,
        palette: null,
        sourcePageUrl: null,
        entityVersion: 0,
        updatedAt: new Date(0).toISOString(),
      };
    }

    return {
      assetId: row.asset_id,
      label: row.label,
      description: row.description,
      rating: row.rating,
      favorite: row.favorite !== 0,
      palette: row.palette,
      sourcePageUrl: row.source_page_url,
      entityVersion: row.entity_version,
      updatedAt: row.updated_at,
    };
  }

  setAssetMetadata(input: {
    libraryId: string;
    assetId: string;
    expectedVersion: number;
    label?: string;
    description?: string;
    rating?: number;
    favorite?: boolean;
    palette?: string[];
    sourcePageUrl?: string;
  }): AssetMetadataResult {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

    // Validate the asset exists.
    const assetRow = openLibrary.connection
      .prepare('SELECT asset_id FROM assets WHERE asset_id = ?')
      .get(input.assetId) as { asset_id: string } | undefined;
    if (!assetRow) throw new LibraryServiceError('ASSET_NOT_FOUND');

    // Validate rating.
    if (input.rating !== undefined && (input.rating < 0 || input.rating > 5)) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    // Validate palette.
    if (input.palette !== undefined && input.palette.length > 20) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    // Validate description length.
    if (input.description !== undefined && input.description.length > 10000) {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    const now = new Date().toISOString();

    // Read current state.
    const existing = openLibrary.connection
      .prepare(
        'SELECT entity_version, rating, favorite, label, description, palette, source_page_url FROM asset_metadata WHERE asset_id = ?',
      )
      .get(input.assetId) as {
        entity_version: number;
        rating: number;
        favorite: number;
        label: string | null;
        description: string | null;
        palette: string | null;
        source_page_url: string | null;
      } | undefined;

    if (existing) {
      // Row exists: optimistic lock update.
      const newLabel =
        input.label !== undefined ? (input.label.trim() === '' ? null : input.label.trim()) : existing.label;
      const newDescription =
        input.description !== undefined
          ? (input.description.trim() === '' ? null : input.description.trim())
          : existing.description;
      const newRating = input.rating ?? existing.rating;
      const newFavorite = input.favorite !== undefined ? (input.favorite ? 1 : 0) : existing.favorite;
      const newPalette =
        input.palette !== undefined ? JSON.stringify(input.palette) : existing.palette;
      const newSourcePageUrl =
        input.sourcePageUrl !== undefined
          ? (input.sourcePageUrl.trim() === '' ? null : input.sourcePageUrl.trim())
          : existing.source_page_url;

      const result = openLibrary.connection
        .prepare(
          `UPDATE asset_metadata
              SET label = ?, description = ?, rating = ?, favorite = ?,
                  palette = ?, source_page_url = ?,
                  entity_version = entity_version + 1, updated_at = ?
            WHERE asset_id = ? AND entity_version = ?`,
        )
        .run(
          newLabel,
          newDescription,
          newRating,
          newFavorite,
          newPalette,
          newSourcePageUrl,
          now,
          input.assetId,
          input.expectedVersion,
        );

      if (result.changes === 0) {
        // Version mismatch: return conflict with current version.
        const current = openLibrary.connection
          .prepare('SELECT entity_version FROM asset_metadata WHERE asset_id = ?')
          .get(input.assetId) as { entity_version: number };
        const err = new LibraryServiceError('VERSION_CONFLICT');
        (err as unknown as Record<string, unknown>).currentEntityVersion = current.entity_version;
        throw err;
      }

      // Fetch back the updated row.
      const updated = openLibrary.connection
        .prepare(
          `SELECT asset_id, label, description, rating, favorite, palette,
                  source_page_url, entity_version, updated_at
             FROM asset_metadata WHERE asset_id = ?`,
        )
        .get(input.assetId) as {
          asset_id: string;
          label: string | null;
          description: string | null;
          rating: number;
          favorite: number;
          palette: string | null;
          source_page_url: string | null;
          entity_version: number;
          updated_at: string;
        };

      this.syncAssetSearchContent(openLibrary.connection, input.assetId);

      return {
        assetId: updated.asset_id,
        label: updated.label,
        description: updated.description,
        rating: updated.rating,
        favorite: updated.favorite !== 0,
        palette: updated.palette,
        sourcePageUrl: updated.source_page_url,
        entityVersion: updated.entity_version,
        updatedAt: updated.updated_at,
      };
    }

    // No existing row: INSERT. expectedVersion must be 0 for a fresh row.
    if (input.expectedVersion !== 0) {
      const err = new LibraryServiceError('VERSION_CONFLICT');
      (err as unknown as Record<string, unknown>).currentEntityVersion = 0;
      throw err;
    }

    const newLabel =
      input.label !== undefined ? (input.label.trim() === '' ? null : input.label.trim()) : null;
    const newDescription =
      input.description !== undefined
        ? (input.description.trim() === '' ? null : input.description.trim())
        : null;
    const newRating = input.rating ?? 0;
    const newFavorite = input.favorite !== undefined && input.favorite ? 1 : 0;
    const newPalette = input.palette !== undefined ? JSON.stringify(input.palette) : null;
    const newSourcePageUrl =
      input.sourcePageUrl !== undefined
        ? (input.sourcePageUrl.trim() === '' ? null : input.sourcePageUrl.trim())
        : null;
    const newEntityVersion = 1;

    openLibrary.connection
      .prepare(
        `INSERT INTO asset_metadata
           (asset_id, label, description, rating, favorite, palette,
            source_page_url, entity_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.assetId,
        newLabel,
        newDescription,
        newRating,
        newFavorite,
        newPalette,
        newSourcePageUrl,
        newEntityVersion,
        now,
      );
    this.syncAssetSearchContent(openLibrary.connection, input.assetId);

    return {
      assetId: input.assetId,
      label: newLabel,
      description: newDescription,
      rating: newRating,
      favorite: newFavorite !== 0,
      palette: newPalette,
      sourcePageUrl: newSourcePageUrl,
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
           (asset_id, label, description, rating, favorite, palette,
            source_page_url, entity_version, updated_at)
         SELECT asset_id, NULL, NULL, 0, 0, NULL, NULL, 1, ?
           FROM assets a
          WHERE NOT EXISTS (
            SELECT 1 FROM asset_metadata m WHERE m.asset_id = a.asset_id
          )`,
      )
      .run(now);

    return { backfilledCount: result.changes };
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
                m.label, m.description, m.source_page_url
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
          WHERE a.asset_id = ?`,
      )
      .get(assetId) as {
        relative_file_path: string;
        availability: string;
        byte_size: number;
        label: string | null;
        description: string | null;
        source_page_url: string | null;
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
           (asset_id, label, filename, tags, description, source_url, folder_path, metadata_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET
           label = excluded.label,
           filename = excluded.filename,
           tags = excluded.tags,
           description = excluded.description,
           source_url = excluded.source_url,
           folder_path = excluded.folder_path,
           metadata_text = excluded.metadata_text`,
      )
      .run(
        assetId,
        tokenizeForFts(asset.label ?? ''),
        tokenizeForFts(buildFileName(asset.relative_file_path)),
        tokenizeForFts(tagRow?.tags ?? ''),
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
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.wmv': 'video/x-ms-wmv',
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
   * Atomically write AI-generated content for an asset.
   * For tags: find-or-create by NOCASE name, then INSERT OR IGNORE into ai_asset_tags.
   * For label/description: DELETE old row(s) + INSERT new row in ai_content
   *   (one row per (asset_id, field_name)).
   * After writing, sync the asset's FTS search content.
   */
  writeAiAnalysisResult(input: {
    libraryId: string;
    assetId: string;
    label?: string;
    description?: string;
    tags?: string[];
    structuredMetadata?: Record<string, unknown>;
    modelId: string;
    modelVersion: string;
    enabledFields: {
      label: boolean;
      description: boolean;
      tags: boolean;
      structuredMetadata: boolean;
    };
  }): { tagsWritten: string[]; fieldsWritten: string[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const now = new Date().toISOString();
    const tagsWritten: string[] = [];
    const fieldsWritten: string[] = [];

    const revisionRow = openLibrary.connection
      .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
      .get(input.assetId) as { current_revision_id: string | null } | undefined;
    const revisionId = revisionRow?.current_revision_id ?? null;

    openLibrary.connection.transaction(() => {
      // Tags: find-or-create, then INSERT OR IGNORE into ai_asset_tags.
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

      // Label / description / structured_metadata: DELETE old row(s) + INSERT.
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
        deleteOld.run(input.assetId, fieldName);
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

      if (input.enabledFields.label && input.label !== undefined && input.label.trim().length > 0) {
        writeField('label', input.label.trim());
      }

      if (
        input.enabledFields.description &&
        input.description !== undefined &&
        input.description.trim().length > 0
      ) {
        writeField('description', input.description.trim());
      }

      if (
        input.enabledFields.structuredMetadata &&
        input.structuredMetadata !== undefined &&
        Object.keys(input.structuredMetadata).length > 0
      ) {
        writeField('structured_metadata', JSON.stringify(input.structuredMetadata));
      }
    })();

    this.syncAssetSearchContent(openLibrary.connection, input.assetId);

    return { tagsWritten, fieldsWritten };
  }

  /** Retrieve current AI content for an asset. */
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
   * Return the .serpent/artifacts directory for an open library.
   */
  private artifactsDir(openLibrary: OpenLibrary): string {
    return path.join(openLibrary.summary.libraryPath, '.serpent', 'artifacts');
  }

  /**
   * Detect media type from a file extension.
   * Returns 'image' for PNG/JPEG/GIF/TIFF/WebP/BMP, 'video' for MP4/MOV/AVI/WMV/WebM,
   * and 'other' for everything else (including EXR/TGA which would need OIIO).
   */
  static detectMediaType(filenameOrMime: string): 'image' | 'video' | 'other' {
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
    return 'other';
  }

  /** Generate a WebP thumbnail for an image asset using sharp. */
  async generateThumbnail(input: {
    libraryId: string;
    assetId: string;
  }): Promise<{ artifactId: string }> {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const assetPath = this.resolveAssetPath(input.libraryId, input.assetId);

    // Detect media type
    const mediaType = LibraryService.detectMediaType(assetPath);
    if (mediaType === 'video') {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION', {
        reason: 'FFMPEG_REQUIRED',
      });
    }
    if (mediaType === 'other') {
      const ext = path.extname(assetPath).toLowerCase();
      if (ext === '.exr' || ext === '.tga') {
        throw new LibraryServiceError('INVALID_IMPORT_DECISION', {
          reason: 'OIIO_REQUIRED',
        });
      }
      throw new LibraryServiceError('INVALID_IMPORT_DECISION', {
        reason: 'UNSUPPORTED_FORMAT',
      });
    }

    // Get the current revision for this asset
    const assetRow = openLibrary.connection
      .prepare('SELECT current_revision_id FROM assets WHERE asset_id = ?')
      .get(input.assetId) as { current_revision_id: string | null } | undefined;
    if (!assetRow?.current_revision_id) throw new LibraryServiceError('ASSET_NOT_FOUND');
    const revisionId = assetRow.current_revision_id;

    const artifactId = randomUUID();
    const artifactsDir = this.artifactsDir(openLibrary);
    mkdirSync(artifactsDir, { recursive: true });
    const artifactRelPath = `${artifactId}.webp`;
    const artifactAbsPath = path.join(artifactsDir, artifactRelPath);

    const s = requireSharp();
    try {
      const pipeline = s(assetPath);
      const metadata = await pipeline.metadata();
      const inputWidth = metadata.width ?? 0;
      const inputHeight = metadata.height ?? 0;

      await pipeline
        .resize({
          width: 512,
          height: 512,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toFile(artifactAbsPath);

      const outputStat = statSync(artifactAbsPath);
      let outputWidth = inputWidth;
      let outputHeight = inputHeight;
      if (inputWidth > 512 || inputHeight > 512) {
        const ratio = Math.min(512 / inputWidth, 512 / inputHeight);
        outputWidth = Math.round(inputWidth * ratio);
        outputHeight = Math.round(inputHeight * ratio);
      }

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
          `sharp@${SHARP_VERSION}`,
          new Date().toISOString(),
        );

      // Emit thumbnail-ready notification
      this.options.onAssetsChanged?.({
        type: 'asset.changed',
        libraryId: input.libraryId,
        changedCount: 1,
        missingCount: 0,
      });

      return { artifactId };
    } catch (error) {
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

  /** Get the absolute filesystem path for an artifact. */
  getArtifactAbsolutePath(libraryId: string, artifactId: string): string {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const row = openLibrary.connection
      .prepare(
        `SELECT artifact_id, file_path
           FROM revision_artifacts
          WHERE artifact_id = ?`,
      )
      .get(artifactId) as { artifact_id: string; file_path: string } | undefined;
    if (!row) throw new LibraryServiceError('ASSET_NOT_FOUND');

    const artifactsDir = this.artifactsDir(openLibrary);
    const targetPath = path.resolve(artifactsDir, ...row.file_path.split('/'));
    const relation = path.relative(artifactsDir, targetPath);
    if (
      relation === '' ||
      relation.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relation)
    ) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }
    return targetPath;
  }

  /** Enqueue thumbnail jobs for all assets whose current revision lacks a ready thumbnail. */
  enqueueThumbnailJobs(libraryId: string): number {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.current_revision_id
           FROM assets a
          WHERE a.deleted_at IS NULL
            AND a.current_revision_id IS NOT NULL
            AND a.availability = 'available'
            AND NOT EXISTS (
              SELECT 1 FROM revision_artifacts ra
              WHERE ra.revision_id = a.current_revision_id
                AND ra.kind = 'thumbnail'
                AND ra.status = 'ready'
                AND ra.invalidated_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM jobs j
              WHERE j.asset_id = a.asset_id
                AND j.kind = 'generate_thumbnail'
                AND j.status IN ('queued', 'running')
            )
          ORDER BY a.relative_file_path`,
      )
      .all() as Array<{ asset_id: string; current_revision_id: string }>;

    const now = new Date().toISOString();
    let enqueued = 0;
    const insert = openLibrary.connection.prepare(
      `INSERT OR IGNORE INTO jobs
         (job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
          attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', 0, 0.0, 0, ?, ?)`,
    );

    for (const row of rows) {
      insert.run(
        randomUUID(), libraryId, row.asset_id, row.current_revision_id, now, now,
      );
      enqueued += 1;
    }

    return enqueued;
  }

  /**
   * Process queued thumbnail jobs one at a time. Returns the number of jobs
   * processed (success + failure). Pause/resume/cancel/retry are deferred to
   * a future slice; currently this is a simple drain.
   */
  async processThumbnailQueue(libraryId: string): Promise<number> {
    const openLibrary = this.requireOpenLibrary(libraryId);
    const queued = openLibrary.connection
      .prepare(
        `SELECT job_id, asset_id, revision_id, attempt_count
           FROM jobs
          WHERE library_id = ?
            AND kind = 'generate_thumbnail'
            AND status = 'queued'
          ORDER BY priority DESC, created_at
          LIMIT 20`,
      )
      .all(libraryId) as Array<{
        job_id: string;
        asset_id: string;
        revision_id: string;
        attempt_count: number;
      }>;

    let processed = 0;
    for (const job of queued) {
      const now = new Date().toISOString();
      openLibrary.connection
        .prepare(
          "UPDATE jobs SET status = 'running', attempt_count = ?, updated_at = ? WHERE job_id = ?",
        )
        .run(job.attempt_count + 1, now, job.job_id);

      try {
        await this.generateThumbnail({ libraryId, assetId: job.asset_id });
        openLibrary.connection
          .prepare("UPDATE jobs SET status = 'succeeded', progress = 1.0, updated_at = ? WHERE job_id = ?")
          .run(new Date().toISOString(), job.job_id);
      } catch (error) {
        openLibrary.connection
          .prepare(
            `UPDATE jobs
                SET status = 'failed', error_code = ?, error_detail = ?, updated_at = ?
              WHERE job_id = ?`,
          )
          .run(
            'THUMBNAIL_GENERATION_FAILED',
            error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            new Date().toISOString(),
            job.job_id,
          );
        this.diagnose('thumbnail-queue', error, { libraryId, assetId: job.asset_id });
      }
      processed += 1;
    }

    return processed;
  }

  /** Return the thumbnail status for a list of assets (used to extend AssetSummary). */
  private thumbnailStatusMap(
    libraryId: string,
    assetIds: string[],
  ): Map<string, 'ready' | 'pending' | 'failed' | null> {
    const openLibrary = this.requireOpenLibrary(libraryId);
    if (assetIds.length === 0) return new Map();

    const placeholders = assetIds.map(() => '?').join(',');
    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id,
                (SELECT ra.status FROM revision_artifacts ra
                  WHERE ra.revision_id = a.current_revision_id
                    AND ra.kind = 'thumbnail'
                    AND ra.invalidated_at IS NULL
                  LIMIT 1) AS thumbnail_status
           FROM assets a
          WHERE a.asset_id IN (${placeholders})`,
      )
      .all(...assetIds) as Array<{
        asset_id: string;
        thumbnail_status: 'ready' | 'pending' | 'generating' | 'failed' | null;
      }>;

    const map = new Map<string, 'ready' | 'pending' | 'failed' | null>();
    for (const row of rows) {
      if (row.thumbnail_status === 'ready') map.set(row.asset_id, 'ready');
      else if (row.thumbnail_status === 'failed') map.set(row.asset_id, 'failed');
      else if (row.thumbnail_status === 'generating' || row.thumbnail_status === 'pending') {
        map.set(row.asset_id, 'pending');
      } else map.set(row.asset_id, null);
    }
    return map;
  }

  // ── Search ──────────────────────────────────────────────────────────

  private buildFilterWhere(
    filters: Array<{
      field: 'availability' | 'favorite' | 'format' | 'rating' | 'source_url' | 'tag';
      values: string[];
      exclude: boolean;
    }>,
  ): { sql: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    for (const filter of filters) {
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
          const likes = filter.values.map(() => `LOWER(a.relative_file_path) LIKE ?`);
          const clause = filter.exclude
            ? `NOT (${likes.join(' OR ')})`
            : `(${likes.join(' OR ')})`;
          conditions.push(clause);
          for (const v of filter.values) {
            params.push(`%.${v.toLowerCase()}`);
          }
          break;
        }
        case 'tag': {
          const phs = filter.values.map(() => '?').join(',');
          const clause = filter.exclude
            ? `a.asset_id NOT IN (SELECT hat.asset_id FROM human_asset_tags hat JOIN tags t ON t.tag_id = hat.tag_id WHERE t.name = ? COLLATE NOCASE)`
            : `a.asset_id IN (SELECT hat.asset_id FROM human_asset_tags hat JOIN tags t ON t.tag_id = hat.tag_id WHERE t.name IN (${phs}) COLLATE NOCASE)`;
          // For exclude with multiple values, build separate clauses
          if (filter.exclude && filter.values.length > 1) {
            const notClauses = filter.values.map(() =>
              `a.asset_id NOT IN (SELECT hat.asset_id FROM human_asset_tags hat JOIN tags t ON t.tag_id = hat.tag_id WHERE t.name = ? COLLATE NOCASE)`,
            );
            conditions.push(`(${notClauses.join(' AND ')})`);
          } else if (filter.exclude) {
            conditions.push(`(${clause})`);
            params.push(filter.values[0]!);
          } else {
            conditions.push(`(${clause})`);
            params.push(...filter.values);
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
    filters?: Array<{
      field: 'availability' | 'favorite' | 'format' | 'rating' | 'source_url' | 'tag';
      values: string[];
      exclude: boolean;
    }> | null;
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
    const fts5Query = hasQuery ? buildFts5Query(input.query!.clauses) : null;
    const { sql: filterWhere, params: filterParams } = this.buildFilterWhere(
      input.filters ?? [],
    );

    // Build ORDER BY clause.
    let orderBy: string;
    if (hasQuery) {
      // When searching, order by BM25 relevance with per-column weights
      // (label 12, filename 10, tags 8, description 5, source_url 3,
      // folder_path 2, metadata_text 1) per ADR-0009. The FTS5 `rank` hidden
      // column uses default weights (all 1.0); explicit bm25() is required to
      // apply the weighted ranking. This sacrifices the rank-column snippet
      // lazy-evaluation optimization (restorable later via a custom rank fn).
      orderBy = `bm25(asset_search, 12.0, 10.0, 8.0, 5.0, 3.0, 2.0, 1.0) ASC`;
    } else if (input.sort) {
      const sortField = input.sort.field;
      const dir = input.sort.order === 'desc' ? 'DESC' : 'ASC';
      switch (sortField) {
        case 'name':
          orderBy = `a.relative_file_path ${dir}`;
          break;
        case 'modified_at':
          orderBy = `r.modified_at ${dir}`;
          break;
        case 'created_at':
          orderBy = `a.created_at ${dir}`;
          break;
        case 'byte_size':
          orderBy = `r.byte_size ${dir}`;
          break;
        case 'duration':
          // duration not extracted in this slice; fall back to name.
          orderBy = `a.relative_file_path ${dir}`;
          break;
        case 'rating':
          orderBy = `COALESCE(m.rating, 0) ${dir}`;
          break;
        default:
          orderBy = `a.relative_file_path ASC`;
      }
    } else {
      orderBy = `a.relative_file_path ASC`;
    }

    // Build the base FROM + JOIN clauses.
    const baseFrom = hasQuery
      ? `FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
           JOIN asset_search_index sc ON a.asset_id = sc.asset_id
           JOIN asset_search s ON sc.rowid = s.rowid`
      : `FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
           LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id`;

    // WHERE clause.
    const whereParts: string[] = [];
    const allParams: unknown[] = [];

    if (hasQuery) {
      whereParts.push(
        `asset_search MATCH ? AND rank MATCH 'bm25(12.0, 10.0, 8.0, 5.0, 3.0, 2.0, 1.0)'`,
      );
      allParams.push(fts5Query);
    }

    if (filterWhere.length > 0) {
      whereParts.push(filterWhere);
      allParams.push(...filterParams);
    }

    const whereClause =
      whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    // Columns for data query.
    const dataColumns = hasQuery
      ? `a.asset_id, a.managed_folder_id, a.relative_file_path, a.current_revision_id,
         a.availability, r.byte_size, r.modified_at,
         m.label, COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
         a.deleted_at, a.trashed_from_relative_path,
         snippet(asset_search, 0, '<b>', '</b>', '...', 32) AS snippet_text`
      : `a.asset_id, a.managed_folder_id, a.relative_file_path, a.current_revision_id,
         a.availability, r.byte_size, r.modified_at,
         m.label, COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
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
      .all(...allParams, limit, offset) as Array<{
        asset_id: string;
        managed_folder_id: string | null;
        relative_file_path: string;
        current_revision_id: string;
        availability: 'available' | 'missing';
        byte_size: number;
        modified_at: string;
        label: string | null;
        rating: number;
        favorite: number;
        deleted_at?: string | null;
        trashed_from_relative_path?: string | null;
        snippet_text?: string;
      }>;

    const items: AssetSummary[] = rows.map((row) => this.assetSummaryFromRow(row));

    const snippets: Array<{ assetId: string; text: string }> | undefined =
      hasQuery
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
  }): { collectionId: string; name: string; queryDefinition: string; position: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const trimmed = input.name.trim();
    if (trimmed.length === 0) throw new LibraryServiceError('INVALID_FOLDER_NAME');

    // Validate queryDefinitionJson is parseable JSON.
    try {
      JSON.parse(input.queryDefinitionJson);
    } catch {
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

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
    };
  }

  listSmartCollections(libraryId: string): Array<{
    collectionId: string;
    name: string;
    queryDefinition: string;
    position: number;
  }> {
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
    return rows.map((row) => ({
      collectionId: row.collection_id,
      name: row.name,
      queryDefinition: row.query_definition_json,
      position: row.position,
    }));
  }

  updateSmartCollection(input: {
    libraryId: string;
    collectionId: string;
    name?: string;
    queryDefinitionJson?: string;
    position?: number;
  }): { collectionId: string; name: string; queryDefinition: string; position: number } {
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

    // Validate queryDefinitionJson if provided.
    if (input.queryDefinitionJson !== undefined) {
      try {
        JSON.parse(input.queryDefinitionJson);
      } catch {
        throw new LibraryServiceError('INVALID_IMPORT_DECISION');
      }
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

    return {
      collectionId: input.collectionId,
      name: newName,
      queryDefinition: newQueryDefinitionJson,
      position: newPosition,
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

    let definition: {
      search?: { clauses: SearchClause[] };
      filters?: Array<{
        field: 'availability' | 'favorite' | 'format' | 'rating' | 'source_url' | 'tag';
        values: string[];
        exclude: boolean;
      }>;
      sort?: { field: string; order: 'asc' | 'desc' };
    };
    try {
      definition = JSON.parse(sc.query_definition_json);
    } catch {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }

    return this.searchAssets({
      libraryId: input.libraryId,
      query: definition.search ?? null,
      filters: definition.filters ?? null,
      sort: definition.sort ?? null,
      limit: 50,
      offset: 0,
    });
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

  private assetSummaryFromRow(
    row: {
      asset_id: string;
      managed_folder_id: string | null;
      relative_file_path: string;
      current_revision_id: string;
      availability: 'available' | 'missing';
      byte_size: number;
      modified_at: string;
      label: string | null;
      rating: number;
      favorite: number;
      deleted_at?: string | null;
      trashed_from_relative_path?: string | null;
      thumbnail_status?: 'ready' | 'pending' | 'failed' | null;
      thumbnail_artifact_id?: string | null;
      media_type?: 'image' | 'video' | 'other' | null;
      artifact_width?: number | null;
      artifact_height?: number | null;
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
      managedFolderId: row.managed_folder_id,
      relativeFilePath: row.relative_file_path,
      displayName: path.posix.basename(row.relative_file_path),
      currentRevisionId: row.current_revision_id,
      byteSize: row.byte_size,
      modifiedAt: row.modified_at,
      availability: row.availability,
      label: row.label,
      rating: row.rating,
      favorite: row.favorite !== 0,
      deletedAt: row.deleted_at ?? null,
      trashedFromPath: row.trashed_from_relative_path ?? null,
      remainingDays,
      thumbnailStatus: row.thumbnail_status ?? null,
      thumbnailArtifactId: row.thumbnail_artifact_id ?? null,
      mediaType: row.media_type ?? 'other',
      width: row.artifact_width ?? null,
      height: row.artifact_height ?? null,
    };
  }

  trashAssets(input: {
    libraryId: string;
    assetIds: string[];
  }): { trashedCount: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const assetIds = input.assetIds;

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
    targetFolderId?: string;
  }): { restoredCount: number; assets: AssetSummary[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const assetIds = input.assetIds;

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

    // Resolve target folder
    let targetFolder: ManagedFolderRow | undefined;
    if (input.targetFolderId) {
      targetFolder = this.targetFolder(openLibrary, input.targetFolderId);
    }

    const restoredAssets: AssetSummary[] = [];
    type RestoredEntry = {
      assetId: string;
      trashFilePath: string;
      originalFilePath: string;
      destinationRelativePath: string;
      managedFolderId: string | null;
    };
    const restoredEntries: RestoredEntry[] = [];

    try {
      // Phase 1: resolve destinations and move files

      for (const row of rows) {
        const filename = path.posix.basename(row.trashed_from_relative_path);
        const trashDir = this.trashPath(openLibrary, row.asset_id, '');
        const trashFilePath = path.join(trashDir, filename);
        if (!existsSync(trashFilePath)) {
          throw new LibraryServiceError('ASSET_NOT_FOUND');
        }

        // Determine target folder path
        let targetFolderPath = '';
        let resolvedFolderId: string | null = null;
        if (targetFolder) {
          targetFolderPath = targetFolder.relative_path;
          resolvedFolderId = targetFolder.folder_id;
        } else if (row.trashed_from_folder_id) {
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
        const activeConflict = openLibrary.connection
          .prepare(
            `SELECT asset_id FROM assets WHERE path_identity = ? AND deleted_at IS NULL AND asset_id != ?`,
          )
          .get(destIdentity, row.asset_id) as { asset_id: string } | undefined;

        if (activeConflict || this.portableDiskDestination(openLibrary, destRelativePath) !== undefined) {
          // Default keep-both with numbered suffix
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
                `SELECT asset_id FROM assets WHERE path_identity = ? AND deleted_at IS NULL AND asset_id != ?`,
              )
              .get(candidateIdentity, row.asset_id);
            if (!candidateConflict && this.portableDiskDestination(openLibrary, destRelativePath) === undefined) {
              break;
            }
          }
        }

        const destPath = this.folderPath(openLibrary, destRelativePath);
        mkdirSync(path.dirname(destPath), { recursive: true });
        renameSync(trashFilePath, destPath);
        restoredEntries.push({
          assetId: row.asset_id,
          trashFilePath,
          originalFilePath: destPath,
          destinationRelativePath: destRelativePath,
          managedFolderId: resolvedFolderId,
        });
      }

      // Phase 2: DB transaction
      const now = new Date().toISOString();
      openLibrary.connection.transaction(() => {
        for (const entry of restoredEntries) {
          const pathIdentity = portablePathIdentity(entry.destinationRelativePath);
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
              entry.destinationRelativePath,
              entry.managedFolderId,
              pathIdentity,
              now,
              entry.assetId,
            );
          this.syncAssetSearchContent(openLibrary.connection, entry.assetId);
        }
      })();

      // Return restored asset summaries
      for (const entry of restoredEntries) {
        const assetRow = openLibrary.connection
          .prepare(
            `SELECT a.asset_id, a.managed_folder_id, a.relative_file_path,
                    a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                    m.label, COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
                    a.deleted_at, a.trashed_from_relative_path
               FROM assets a
               JOIN revisions r ON r.revision_id = a.current_revision_id
               LEFT JOIN asset_metadata m ON m.asset_id = a.asset_id
              WHERE a.asset_id = ?`,
          )
          .get(entry.assetId) as AssetSummaryRow & {
            deleted_at: string | null;
            trashed_from_relative_path: string | null;
          } | undefined;
        if (assetRow) {
          restoredAssets.push(this.assetSummaryFromRow(assetRow));
        }
      }

      return { restoredCount: restoredEntries.length, assets: restoredAssets };
    } catch (error) {
      // Rollback filesystem moves
      for (const entry of [...restoredEntries].reverse()) {
        try {
          if (existsSync(entry.originalFilePath)) {
            mkdirSync(path.dirname(entry.trashFilePath), { recursive: true });
            renameSync(entry.originalFilePath, entry.trashFilePath);
          }
        } catch {
          // Best-effort rollback
        }
      }
      throw serviceError(error, 'LIBRARY_NOT_WRITABLE');
    }
  }

  deleteAssetsPermanent(input: {
    libraryId: string;
    assetIds: string[];
  }): { deletedCount: number; skippedCount: number; skippedReasons: string[] } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const assetIds = input.assetIds;

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

    if (rows.length === 0 && assetIds.length > 0) {
      // Check if assets exist but not trashed
      for (const id of assetIds) {
        const exists = openLibrary.connection
          .prepare('SELECT asset_id, deleted_at FROM assets WHERE asset_id = ?')
          .get(id);
        if (!exists) throw new LibraryServiceError('ASSET_NOT_FOUND');
      }
      // All exist but none are trashed
      throw new LibraryServiceError('INVALID_IMPORT_DECISION');
    }

    let deletedCount = 0;
    const skippedReasons: string[] = [];
    const deletedAssetIds: string[] = [];

    for (const row of rows) {
      // Remove trash directory
      const trashDir = path.join(openLibrary.summary.libraryPath, '.serpent', 'trash', row.asset_id);
      let skipReason: string | undefined;
      try {
        rmSync(trashDir, { force: true, recursive: true });
      } catch (error) {
        if (isMissingPathError(error)) {
          // Already gone, proceed with DB delete
        } else {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
            skipReason = `${row.asset_id}: ${code}`;
          } else {
            throw error;
          }
        }
      }

      if (skipReason) {
        skippedReasons.push(skipReason);
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

    return {
      deletedCount,
      skippedCount: rows.length - deletedCount,
      skippedReasons,
    };
  }

  purgeExpiredTrash(libraryId: string): { purgedCount: number } {
    const openLibrary = this.requireOpenLibrary(libraryId);

    const expiryDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rows = openLibrary.connection
      .prepare(
        `SELECT asset_id FROM assets WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
      )
      .all(expiryDate) as Array<{ asset_id: string }>;

    if (rows.length === 0) return { purgedCount: 0 };

    const assetIds = rows.map((r) => r.asset_id);
    let purgedCount = 0;

    for (const assetId of assetIds) {
      const result = this.deleteAssetsPermanent({ libraryId, assetIds: [assetId] });
      if (result.deletedCount === 1) purgedCount += 1;
    }

    return { purgedCount };
  }

  listTrash(libraryId: string): AssetSummary[] {
    const openLibrary = this.requireOpenLibrary(libraryId);

    const rows = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.managed_folder_id, a.relative_file_path,
                a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                m.label, COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
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

    return rows.map((row) => this.assetSummaryFromRow(row));
  }

  deleteLinkedAssets(input: {
    libraryId: string;
    assetIds: string[];
    deleteSourceFile: boolean;
  }): { deletedCount: number } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);

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

    if (input.deleteSourceFile) {
      // MVP: system trash is not supported in Worker (no Electron shell APIs).
      // The `trash` npm package is not in package.json to keep deps minimal.
      // Main process should move files to system trash before calling this.
      // For now, throw NOT_SUPPORTED to signal the caller.
      throw new LibraryServiceError('LIBRARY_NOT_WRITABLE');
    }

    openLibrary.connection.transaction(() => {
      for (const row of rows) {
        openLibrary.connection
          .prepare('DELETE FROM assets WHERE asset_id = ?')
          .run(row.asset_id);
      }
    })();

    return { deletedCount: rows.length };
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

    const fileStat = statSync(newPath);
    const now = new Date().toISOString();
    const originalFilename = path.posix.basename(assetRow.relative_file_path);

    // For linked assets, verify the file is within the linked root
    if (assetRow.location_kind === 'linked' && assetRow.linked_folder_id) {
      const linkedFolder = openLibrary.connection
        .prepare('SELECT absolute_root_path FROM linked_folders WHERE folder_id = ?')
        .get(assetRow.linked_folder_id) as { absolute_root_path: string } | undefined;
      if (linkedFolder) {
        try {
          const canonicalRoot = realpathSync(linkedFolder.absolute_root_path);
          const canonicalNew = realpathSync(newPath);
          const relation = path.relative(canonicalRoot, canonicalNew);
          if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
            throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
              reason: 'NAME_NOT_SUPPORTED',
            });
          }
        } catch (error) {
          if (error instanceof LibraryServiceError) throw error;
          // If realpath fails, the file is likely not within the root
        }
      }
    }

    openLibrary.connection.transaction(() => {
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
              SET current_revision_id = ?, availability = 'available', updated_at = ?
            WHERE asset_id = ?`,
        )
        .run(revisionId, now, input.assetId);

      this.syncAssetSearchContent(openLibrary.connection, input.assetId);
    })();

    // Fetch the updated asset
    const updated = openLibrary.connection
      .prepare(
        `SELECT a.asset_id, a.managed_folder_id, a.relative_file_path,
                a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                m.label, COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
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

    const rows = openLibrary.connection
      .prepare(
        `SELECT asset_id, relative_file_path
           FROM assets
          WHERE availability = 'missing' AND deleted_at IS NULL
          ORDER BY relative_file_path`,
      )
      .all() as Array<{
        asset_id: string;
        relative_file_path: string;
      }>;

    let matchedCount = 0;
    let unmatchedCount = 0;
    const examples: Array<{ relativeFilePath: string; matched: boolean }> = [];

    for (const row of rows) {
      const segments = row.relative_file_path.split('/');
      // Try last N components as the candidate path under newRoot
      let matched = false;
      for (let n = Math.min(segments.length, 5); n >= 1; n -= 1) {
        const candidateSegments = segments.slice(-n);
        const candidatePath = path.join(newRoot, ...candidateSegments);
        try {
          const entry = lstatSync(candidatePath);
          if (entry.isFile() && !entry.isSymbolicLink()) {
            matched = true;
            break;
          }
        } catch {
          // Continue trying shorter prefixes
        }
      }

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

    const rows = openLibrary.connection
      .prepare(
        `SELECT asset_id, location_kind, linked_folder_id, managed_folder_id,
                relative_file_path, current_revision_id
           FROM assets
          WHERE availability = 'missing' AND deleted_at IS NULL
          ORDER BY relative_file_path`,
      )
      .all() as Array<{
        asset_id: string;
        location_kind: 'managed' | 'linked';
        linked_folder_id: string | null;
        managed_folder_id: string | null;
        relative_file_path: string;
        current_revision_id: string | null;
      }>;

    const now = new Date().toISOString();
    const operationId = randomUUID();
    let restoredCount = 0;
    const restoredAssets: AssetSummary[] = [];

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
        const segments = asset.relative_file_path.split('/');
        let matchedPath: string | undefined;
        for (let n = Math.min(segments.length, 5); n >= 1; n -= 1) {
          const candidateSegments = segments.slice(-n);
          const candidatePath = path.join(newRoot, ...candidateSegments);
          try {
            const entry = lstatSync(candidatePath);
            if (entry.isFile() && !entry.isSymbolicLink()) {
              matchedPath = candidatePath;
              break;
            }
          } catch {
            // Continue
          }
        }

        if (!matchedPath) continue;

        // For linked assets, verify within linked root
        if (asset.location_kind === 'linked' && asset.linked_folder_id) {
          const linkedFolder = openLibrary.connection
            .prepare('SELECT absolute_root_path FROM linked_folders WHERE folder_id = ?')
            .get(asset.linked_folder_id) as { absolute_root_path: string } | undefined;
          if (linkedFolder) {
            try {
              const canonicalRoot = realpathSync(linkedFolder.absolute_root_path);
              const canonicalNew = realpathSync(matchedPath);
              const relation = path.relative(canonicalRoot, canonicalNew);
              if (relation === '' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
                continue;
              }
            } catch {
              continue;
            }
          }
        }

        const fileStat = statSync(matchedPath);
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

        if (!input.keepMetadata) {
          // Clear human metadata
          openLibrary.connection
            .prepare(
              `UPDATE asset_metadata
                  SET label = NULL, description = NULL, rating = 0, favorite = 0,
                      palette = NULL, source_page_url = NULL,
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
        }

        this.syncAssetSearchContent(openLibrary.connection, asset.asset_id);
        restoredCount += 1;
      }
    })();

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
            `SELECT a.asset_id, a.managed_folder_id, a.relative_file_path,
                    a.current_revision_id, a.availability, r.byte_size, r.modified_at,
                    m.label, COALESCE(m.rating, 0) AS rating, COALESCE(m.favorite, 0) AS favorite,
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

  private enumerateLinkedSources(rootPath: string): Array<{
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
        // Symlinks are neither followed nor registered; this prevents a linked
        // root from pulling in bytes outside itself via a hostile link.
        if (child.isSymbolicLink()) continue;
        const childRelative =
          relativeDirectory === ''
            ? child.name
            : path.posix.join(relativeDirectory, child.name);
        if (child.isDirectory()) {
          if (DEFAULT_IGNORED_DIRECTORIES.has(child.name.toLowerCase())) continue;
          visit(path.join(directoryPath, child.name), childRelative);
          continue;
        }
        if (!child.isFile()) continue;
        if (DEFAULT_IGNORED_FILES.has(child.name.toLowerCase())) continue;
        const childPath = path.join(directoryPath, child.name);
        let stat: BigIntStats;
        try {
          stat = lstatSync(childPath, { bigint: true });
        } catch (error) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
        }
        if (stat.isSymbolicLink() || !stat.isFile()) continue;
        let normalized: string;
        try {
          normalized = normalizeRelativeAssetPath(childRelative);
        } catch (error) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
        }
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

  prepareImport(input: {
    libraryId: string;
    targetFolderId?: string;
    sourceKind: 'files' | 'folder';
    sourcePaths: string[];
  }): ImportConflictPlan {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
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
    let suspectedDuplicateCount = 0;
    let nameConflictCount = 0;
    const examples: ImportConflictPlan['examples'] = [];

    try {
      for (const entry of stagedEntries) {
        const identity = portablePathIdentity(entry.destinationRelativePath);
        let existingSize = seenDestinations.get(identity);
        if (existingSize === undefined) {
          const destination = this.portableDiskDestination(
            openLibrary,
            entry.destinationRelativePath,
          );
          existingSize = destination?.size;
        }
        if (existingSize === -1) {
          nameConflictCount += 1;
          if (examples.length < 8) {
            examples.push({
              displayName: path.posix.basename(entry.destinationRelativePath),
              kind: 'name-conflict',
            });
          }
          continue;
        }

        if (existingSize !== undefined) {
          const kind =
            existingSize === entry.byteSize ? 'suspected-duplicate' : 'name-conflict';
          if (kind === 'suspected-duplicate') suspectedDuplicateCount += 1;
          else nameConflictCount += 1;
          if (examples.length < 8) {
            examples.push({
              displayName: path.posix.basename(entry.destinationRelativePath),
              kind,
            });
          }
        } else {
          seenDestinations.set(identity, entry.byteSize);
        }
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
      for (const entry of pending.entries) {
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
        const conflictKind =
          existingSize === undefined
            ? undefined
            : existingSize === entry.byteSize
              ? 'suspected-duplicate'
              : 'name-conflict';
        let destinationRelativePath =
          existingDestination?.actualRelativePath ?? requestedDestination;
        let isReplacement = false;
        if (conflictKind === 'suspected-duplicate') {
          if (input.suspectedDuplicate === 'skip') {
            skippedCount += 1;
            continue;
          }
          if (input.suspectedDuplicate === 'create-copy') {
            destinationRelativePath = copyPath(requestedDestination);
          } else {
            const retainedAsset = openLibrary.connection
              .prepare('SELECT asset_id, current_revision_id FROM assets WHERE path_identity = ?')
              .get(portablePathIdentity(destinationRelativePath)) as ExistingAssetRow | undefined;
            if (retainedAsset) mergedAssetIds.add(retainedAsset.asset_id);
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

      openLibrary.connection.transaction(() => {
        const now = new Date().toISOString();
        const folderRows = openLibrary.connection
          .prepare(
            'SELECT folder_id, parent_folder_id, name, relative_path, path_identity FROM managed_folders ORDER BY relative_path',
          )
          .all() as ManagedFolderRow[];
        const foldersByPath = new Map(folderRows.map((folder) => [folder.path_identity, folder]));
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

        actions.forEach((action) => {
          const destinationPath = this.folderPath(openLibrary, action.destinationRelativePath);
          const fileStat = statSync(destinationPath);
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
              fileStat.size,
              fileStat.mtime.toISOString(),
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
          affectedAssetIds.push(assetId);
          this.syncAssetSearchContent(openLibrary.connection, assetId);
        });
        this.failAt('before-db-commit');
        openLibrary.connection
          .prepare("UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?")
          .run(new Date().toISOString(), operationId);
      })();
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
      }

      for (const asset of before) {
        const assetPath =
          asset.location_kind === 'linked'
            ? this.linkedAssetPath(openLibrary, asset.linked_folder_id, asset.relative_file_path)
            : this.folderPath(openLibrary, asset.relative_file_path);
        let fileStat;
        try {
          fileStat = (this.options.assetLstat ?? lstatSync)(assetPath);
        } catch (error) {
          if (isMissingPathError(error)) {
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

        const modifiedAt = fileStat.mtime.toISOString();
        const statChanged = fileStat.size !== asset.byte_size || modifiedAt !== asset.modified_at;
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
              fileStat.size,
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
          // Enqueue a new thumbnail job
          openLibrary.connection
            .prepare(
              `INSERT OR IGNORE INTO jobs
                 (job_id, library_id, asset_id, revision_id, kind, status, priority,
                  progress, attempt_count, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'generate_thumbnail', 'queued', 0, 0.0, 0, ?, ?)`,
            )
            .run(randomUUID(), libraryId, asset.asset_id, revisionId, now, now);
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
      // Purge expired trash on open (best-effort, single busy file does not abort)
      try {
        this.purgeExpiredTrash(summary.libraryId);
      } catch (error) {
        this.diagnose('trash.purge-on-open', error, { libraryId: summary.libraryId });
      }
      this.startAssetWatcher(openLibrary);
      return summary;
    } catch (error) {
      closeIgnoringFailure(connection);
      throw serviceError(error, 'LIBRARY_CORRUPT');
    }
  }

  async saveAssetFromUrl(input: {
    libraryId: string;
    targetFolderId?: string;
    sourcePageUrl: string;
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
    try {
      mkdirSync(operationPath, { recursive: true });
      mkdirSync(stagePath);
      mkdirSync(backupPath);

      // Download the media URL.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('Download timed out.')), DOWNLOAD_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(input.mediaUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Serpent/1.0' },
        });
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR' });
        }
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { reason: 'IO_ERROR', cause: error });
      }
      clearTimeout(timer);

      // Validate HTTP status.
      if (!response.ok) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'IO_ERROR',
          cause: new Error(`HTTP ${response.status}`),
        });
      }

      // Validate Content-Type.
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      if (contentType && !CONTENT_TYPE_WHITELIST.has(contentType)) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
          reason: 'UNSUPPORTED_FILE_ENTRY',
          cause: new Error(`Unsupported Content-Type: ${contentType}`),
        });
      }

      // Determine filename.
      let filename: string;
      const contentDisposition = response.headers.get('content-disposition');
      if (contentDisposition) {
        const cdFilename = parseContentDispositionFilename(contentDisposition);
        if (cdFilename) {
          filename = cleanFilename(cdFilename);
        } else {
          filename = filenameFromUrl(input.mediaUrl, contentType);
        }
      } else {
        filename = filenameFromUrl(input.mediaUrl, contentType);
      }

      // Ensure filename has a reasonable extension that matches content-type.
      const fileExt = path.posix.extname(filename).toLowerCase();
      if (fileExt === '' || fileExt === '.') {
        const ctExt = extensionForContentType(contentType);
        if (ctExt) filename = `${filename}${ctExt}`;
      }

      // Stream download with size limit.
      const stageFilePath = path.join(stagePath, 'stage-file');
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_DOWNLOAD_BYTES) {
            reader.cancel();
            throw new LibraryServiceError('INVALID_IMPORT_SOURCE', {
              reason: 'UNSUPPORTED_FILE_ENTRY',
              cause: new Error('File exceeds 500 MB limit.'),
            });
          }
          chunks.push(value);
        }
      } finally {
        try { reader.cancel(); } catch { /* Already released. */ }
      }

      const allBytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      writeFileSync(stageFilePath, allBytes);
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

      // Set source_page_url metadata on the imported asset.
      const importedAsset = completion.assets[0];
      if (importedAsset) {
        try {
          this.setAssetMetadata({
            libraryId: input.libraryId,
            assetId: importedAsset.assetId,
            expectedVersion: 0,
            sourcePageUrl: input.sourcePageUrl,
          });
        } catch (error) {
          this.diagnose('extension-save.metadata', error, {
            libraryId: input.libraryId,
            assetId: importedAsset.assetId,
            sourcePageUrl: input.sourcePageUrl,
          });
          // Metadata failure is non-fatal; the asset is already imported.
        }
      }

      return { asset: importedAsset ?? completion.assets[0]! };
    } catch (error) {
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
      this.removeOperation(operationPath);
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

  exportLibraryToFolder(input: {
    libraryId: string;
    destinationPath: string;
    includeLinkedContent: boolean;
  }): {
    exportId: string;
    fileCount: number;
    totalBytes: number;
    excludedPreviewCount: number;
    includedLinkedContent: boolean;
    durationMs: number;
  } {
    const openLibrary = this.requireOpenLibrary(input.libraryId);
    const exportId = randomUUID();

    // Reject destination inside the library.
    let canonicalDest: string;
    let canonicalLib: string;
    try {
      canonicalDest = realpathSync(input.destinationPath);
    } catch {
      canonicalDest = input.destinationPath;
    }
    try {
      canonicalLib = realpathSync(openLibrary.summary.libraryPath);
    } catch {
      throw new LibraryServiceError('LIBRARY_CORRUPT');
    }
    const rel = path.relative(canonicalLib, canonicalDest);
    if (rel === '' || (!rel.startsWith('..') && rel.length > 0)) {
      throw new LibraryServiceError('INVALID_LIBRARY_PATH');
    }

    const cancelState = { cancelled: false };
    this.activeExports.set(exportId, cancelState);
    const startedAt = Date.now();

    try {
      // Ensure destination directory exists.
      mkdirSync(canonicalDest, { recursive: true });

      const libPath = openLibrary.summary.libraryPath;

      // Phase 1: snapshot-db
      this.emitProgress({
        type: 'export.progress', exportId,
        libraryId: input.libraryId,
        phase: 'snapshot-db', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });

      const tempDbPath = path.join(canonicalDest, `.serpent-export-${exportId}.db`);
      try {
        // Use SQLite VACUUM INTO for a consistent synchronous snapshot.
        // This writes a standalone database file without blocking the live library's reads/writes.
        openLibrary.connection.exec(`VACUUM INTO '${tempDbPath.replace(/'/g, "''")}'`);
      } catch (error) {
        try { rmSync(tempDbPath, { force: true }); } catch { /* best effort */ }
        throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
      }

      // Verify the backup.
      const verifyConn = openConfiguredDatabase(tempDbPath);
      try {
        verifyConn.pragma('quick_check(1)');
      } finally {
        verifyConn.close();
      }

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

      const walkDir = (dirPath: string, relPrefix: string): void => {
        if (cancelState.cancelled) return;
        let children;
        try {
          children = readdirSync(dirPath, { withFileTypes: true });
        } catch {
          return; // Skip unreadable entries.
        }
        for (const child of children) {
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
            walkDir(childPath, childRel);
          } else if (child.isFile()) {
            // Exclude AI temp files.
            const lowerName = child.name.toLowerCase();
            if (lowerName.endsWith('.tmp') || lowerName.startsWith('.') && (
              lowerName.includes('temp') || lowerName.includes('cache') ||
              lowerName.startsWith('.ds_store') || lowerName === 'thumbs.db'
            )) {
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
      walkDir(path.join(libPath, 'Assets'), 'Assets');

      // Walk .serpent/revisions/.
      const revisionsDir = path.join(libPath, '.serpent', 'revisions');
      if (directoryExists(revisionsDir)) {
        walkDir(revisionsDir, '.serpent/revisions');
      }

      // Walk .serpent/trash/.
      const trashDir = path.join(libPath, '.serpent', 'trash');
      if (directoryExists(trashDir)) {
        walkDir(trashDir, '.serpent/trash');
      }

      // Include .serpent/library.db (snapshot).
      const snapStat = statSync(tempDbPath);
      entries.push({
        sourcePath: tempDbPath,
        relativePath: '.serpent/library.db',
        byteSize: snapStat.size,
      });

      // Optionally include linked folder source content.
      let includedLinkedContent = false;
      let linkedContentDir: string | null = null;
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
          linkedContentDir = path.join(canonicalDest, '_linked');
          mkdirSync(linkedContentDir, { recursive: true });
          includedLinkedContent = true;
          for (const lf of linkedFolders) {
            if (cancelState.cancelled) break;
            if (!directoryExists(lf.absolute_root_path)) continue;
            const linkedDest = path.join(linkedContentDir, lf.display_name);
            try {
              copyDirRecursive(lf.absolute_root_path, linkedDest, cancelState);
            } catch (error) {
              this.diagnose('export.copy-linked', error, { folderId: lf.folder_id });
              // Linked content copy failure is non-fatal.
            }
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
        // Clean up linked content dir if we created it.
        if (linkedContentDir) {
          try { rmSync(linkedContentDir, { force: true, recursive: true }); } catch { /* best effort */ }
        }
        // Clean up the destination.
        try { rmSync(canonicalDest, { force: true, recursive: true }); } catch { /* best effort */ }
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
    } finally {
      this.activeExports.delete(exportId);
    }
  }

  cancelExport(exportId: string): void {
    const state = this.activeExports.get(exportId);
    if (!state) throw new LibraryServiceError('IMPORT_NOT_FOUND');
    state.cancelled = true;
  }

  importLibraryFromFolder(input: {
    sourceFolderPath: string;
    copyToParentPath?: string;
  }): {
    importId: string;
    libraryId: string;
    displayName: string;
    libraryPath: string;
  } {
    const importId = randomUUID();
    const cancelState = { cancelled: false };
    this.activeImports.set(importId, cancelState);

    try {
      // Phase 1: validate source.
      this.emitProgress({
        type: 'import.progress', importId,
        phase: 'validate', filesProcessed: 0, totalFiles: 0,
        bytesProcessed: 0, totalBytes: 0,
      });

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

      // Reject symlink escapes in the directory tree (quick scan of root-level children).
      try {
        for (const child of readdirSync(input.sourceFolderPath, { withFileTypes: true })) {
          if (child.isSymbolicLink()) {
            throw new LibraryServiceError('NOT_A_LIBRARY');
          }
          const childPath = path.join(input.sourceFolderPath, child.name);
          // Verify realpath resolves within the source.
          let realPath: string;
          try {
            realPath = realpathSync(childPath);
          } catch {
            continue; // Missing entries are fine.
          }
          const rel = path.relative(input.sourceFolderPath, realPath);
          if (rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new LibraryServiceError('NOT_A_LIBRARY');
          }
        }
      } catch (error) {
        if (error instanceof LibraryServiceError) throw error;
        throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
      }

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

        if (cancelState.cancelled) {
          this.emitProgress({ type: 'import.progress', importId, phase: 'cancelled', filesProcessed: 0, totalFiles: 0, bytesProcessed: 0, totalBytes: 0 });
          throw new LibraryServiceError('CANCELLED');
        }

        try {
          copyDirRecursive(input.sourceFolderPath, libraryPath, cancelState);
        } catch (error) {
          // Clean up incomplete copy.
          try { rmSync(libraryPath, { force: true, recursive: true }); } catch { /* best effort */ }
          if (error instanceof LibraryServiceError && error.code === 'CANCELLED') {
            this.emitProgress({ type: 'import.progress', importId, phase: 'cancelled', filesProcessed: 0, totalFiles: 0, bytesProcessed: 0, totalBytes: 0 });
          }
          throw error;
        }

        if (cancelState.cancelled) {
          try { rmSync(libraryPath, { force: true, recursive: true }); } catch { /* best effort */ }
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

      return {
        importId,
        libraryId: summary.libraryId,
        displayName: summary.displayName,
        libraryPath: summary.libraryPath,
      };
    } catch (error) {
      if (error instanceof LibraryServiceError) throw error;
      throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
    } finally {
      this.activeImports.delete(importId);
    }
  }

  cancelImport(importId: string): void {
    const state = this.activeImports.get(importId);
    if (!state) throw new LibraryServiceError('IMPORT_NOT_FOUND');
    state.cancelled = true;
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

    // Reject symlink escapes in the directory tree.
    try {
      for (const child of readdirSync(sourceFolderPath, { withFileTypes: true })) {
        if (child.isSymbolicLink()) {
          throw new LibraryServiceError('NOT_A_LIBRARY');
        }
        const childPath = path.join(sourceFolderPath, child.name);
        let realPath: string;
        try {
          realPath = realpathSync(childPath);
        } catch {
          continue;
        }
        const rel = path.relative(sourceFolderPath, realPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new LibraryServiceError('NOT_A_LIBRARY');
        }
      }
    } catch (error) {
      if (error instanceof LibraryServiceError) throw error;
      throw new LibraryServiceError('NOT_A_LIBRARY', { cause: error });
    }

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

    this.stopAssetWatcher(libraryId);
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
  }

  listLibraries(): InternalLibrarySummary[] {
    return [...this.openById.values()].map(({ summary }) => ({ ...summary }));
  }

  closeAll(): void {
    for (const libraryId of [...this.openById.keys()]) this.closeLibrary(libraryId);
  }
}
