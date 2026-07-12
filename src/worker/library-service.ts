import { randomUUID, createHash } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
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
  writeSync,
  type BigIntStats,
  type Stats,
} from 'node:fs';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

import type { AssetSummary, LinkedFolderSummary, ManagedFolderSummary } from '../shared/asset-types';
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
const REGENERABLE_DIRECTORIES = ['previews', 'revisions', 'trash'] as const;

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

const MIGRATIONS = [
  { version: 1, sql: INITIAL_SCHEMA_SQL, checksum: INITIAL_SCHEMA_CHECKSUM },
  { version: 2, sql: ASSET_SCHEMA_SQL, checksum: ASSET_SCHEMA_CHECKSUM },
  {
    version: 3,
    sql: PORTABLE_PATH_SCHEMA_BEFORE_BACKFILL_SQL,
    checksum: PORTABLE_PATH_SCHEMA_CHECKSUM,
  },
  { version: 4, sql: LINKED_FOLDERS_SCHEMA_SQL, checksum: LINKED_FOLDERS_SCHEMA_CHECKSUM },
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
    const rebuildsAssetsTable = migration.version === 4;
    if (rebuildsAssetsTable) connection.pragma('foreign_keys = OFF');
    try {
      connection.transaction(() => {
        connection.exec(migration.sql);
        if (migration.version === 3) {
          backfillPortablePathIdentities(connection);
          connection.exec(PORTABLE_PATH_SCHEMA_AFTER_BACKFILL_SQL);
        }
        connection
          .prepare(
            'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
          )
          .run(migration.version, migration.checksum, new Date().toISOString());
        connection.pragma(`user_version = ${migration.version}`);
      })();
    } catch (error) {
      if (rebuildsAssetsTable) {
        try {
          connection.pragma('foreign_keys = ON');
        } catch {
          // The primary migration failure remains more useful than a re-enable failure.
        }
      }
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
    }
    if (rebuildsAssetsTable) {
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
                a.current_revision_id, a.availability, r.byte_size, r.modified_at
           FROM assets a
           JOIN revisions r ON r.revision_id = a.current_revision_id
          ORDER BY a.relative_file_path`,
      )
      .all() as AssetSummaryRow[];

    return rows
      .filter((row) => {
        if (!folder) return input.recursive || row.managed_folder_id === null;
        if (!input.recursive) return row.managed_folder_id === folder.folder_id;
        return (
          row.relative_file_path.startsWith(`${folder.relative_path}/`) ||
          row.managed_folder_id === folder.folder_id
        );
      })
      .map((row) => ({
        assetId: row.asset_id,
        managedFolderId: row.managed_folder_id,
        relativeFilePath: row.relative_file_path,
        displayName: path.posix.basename(row.relative_file_path),
        currentRevisionId: row.current_revision_id,
        byteSize: row.byte_size,
        modifiedAt: row.modified_at,
        availability: row.availability,
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
          changedCount += 1;
        } else if (asset.availability === 'missing') {
          openLibrary.connection
            .prepare("UPDATE assets SET availability = 'available', updated_at = ? WHERE asset_id = ?")
            .run(now, asset.asset_id);
          changedCount += 1;
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
      this.recoverFileOperations(openLibrary);
      this.openById.set(summary.libraryId, openLibrary);
      this.openIdByPath.set(canonicalPath, summary.libraryId);
      this.startAssetWatcher(openLibrary);
      return summary;
    } catch (error) {
      closeIgnoringFailure(connection);
      throw serviceError(error, 'LIBRARY_CORRUPT');
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
