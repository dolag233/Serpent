import { randomUUID, createHash } from 'node:crypto';
import {
  accessSync,
  copyFileSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  watch,
} from 'node:fs';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

import type { AssetSummary, ManagedFolderSummary } from '../shared/asset-types';
import type { PublicErrorCode } from '../shared/protocol/errors';
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

const MIGRATIONS = [
  { version: 1, sql: INITIAL_SCHEMA_SQL, checksum: INITIAL_SCHEMA_CHECKSUM },
  { version: 2, sql: ASSET_SCHEMA_SQL, checksum: ASSET_SCHEMA_CHECKSUM },
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
  sourcePath: string;
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
  | 'crash-after-backup'
  | 'crash-after-place'
  | 'crash-during-prepare-stage'
  | 'recovery-restore'
  | 'rollback-restore';

export interface LibraryServiceOptions {
  debounceMs?: number;
  failAt?: ImportFailurePoint | ImportFailurePoint[];
  importClock?: ImportExpiryClock;
  importTtlMs?: number;
  onAssetsChanged?: (event: AssetsChangedEvent) => void;
  observerFactory?: AssetObserverFactory;
  scheduler?: DebounceScheduler;
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

const DEFAULT_ASSET_OBSERVER_FACTORY: AssetObserverFactory = (assetsPath, onEvent) => {
  const observer = watch(assetsPath, { recursive: true }, () => onEvent());
  observer.on('error', () => {
    // Native watcher errors are advisory; explicit refresh remains available.
  });
  return observer;
};

class SimulatedCrashError extends Error {}

export class LibraryServiceError extends Error {
  constructor(readonly code: PublicErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = 'LibraryServiceError';
  }
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
    error.code === 'ENOENT'
  );
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
    try {
      connection.transaction(() => {
        connection.exec(migration.sql);
        connection
          .prepare(
            'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
          )
          .run(migration.version, migration.checksum, new Date().toISOString());
        connection.pragma(`user_version = ${migration.version}`);
      })();
    } catch (error) {
      throw new LibraryServiceError('LIBRARY_CORRUPT', { cause: error });
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
      const observer = observerFactory(this.assetsPath(openLibrary), () => {
        this.scheduleAssetRefresh(libraryId);
      });
      this.watchByLibraryId.set(libraryId, { observer });
    } catch {
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
        } catch {
          // A watcher-triggered refresh is best effort and must never terminate the Worker.
        }
      }, this.options.debounceMs ?? 250);
    } catch {
      libraryWatch.timer = undefined;
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
      } catch {
        // Continue closing the observer and database.
      }
    }
    try {
      libraryWatch.observer.close();
    } catch {
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
        break;
      }
    }
    return targetPath;
  }

  private assetsPath(openLibrary: OpenLibrary): string {
    return path.join(openLibrary.summary.libraryPath, 'Assets');
  }

  private targetFolder(openLibrary: OpenLibrary, folderId?: string): ManagedFolderRow | undefined {
    if (!folderId) return undefined;
    const folder = openLibrary.connection
      .prepare(
        'SELECT folder_id, parent_folder_id, name, relative_path FROM managed_folders WHERE folder_id = ?',
      )
      .get(folderId) as ManagedFolderRow | undefined;
    if (!folder) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    return folder;
  }

  private enumerateImportSources(input: {
    sourceKind: 'files' | 'folder';
    sourcePaths: string[];
    targetPrefix: string;
  }): { directories: string[]; entries: ImportSourceEntry[] } {
    const directories = new Set<string>();
    const entries: ImportSourceEntry[] = [];
    const addFile = (sourcePath: string, relativePath: string): void => {
      let sourceStat;
      try {
        sourceStat = lstatSync(sourcePath);
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
      }
      let normalized: string;
      try {
        normalized = normalizeRelativeAssetPath(relativePath);
        for (const component of normalized.split('/')) normalizeFolderName(component);
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      entries.push({
        byteSize: sourceStat.size,
        destinationRelativePath: normalized,
        sourcePath,
      });
    };

    const visitDirectory = (directoryPath: string, relativeDirectory: string): void => {
      let directoryStat;
      try {
        directoryStat = lstatSync(directoryPath);
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
      }
      let normalizedDirectory: string;
      try {
        normalizedDirectory = normalizeRelativeAssetPath(relativeDirectory);
        for (const component of normalizedDirectory.split('/')) normalizeFolderName(component);
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      directories.add(normalizedDirectory);
      let children;
      try {
        children = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) =>
          left.name.localeCompare(right.name),
        );
      } catch (error) {
        throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
      }
      for (const child of children) {
        const childSourcePath = path.join(directoryPath, child.name);
        const childRelativePath = path.posix.join(relativeDirectory, child.name);
        if (child.isSymbolicLink()) throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
        if (child.isDirectory()) visitDirectory(childSourcePath, childRelativePath);
        else if (child.isFile()) addFile(childSourcePath, childRelativePath);
        else throw new LibraryServiceError('INVALID_IMPORT_SOURCE');
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
          'SELECT folder_id, parent_folder_id, name, relative_path FROM managed_folders WHERE folder_id = ?',
        )
        .get(input.parentFolderId) as ManagedFolderRow | undefined;
      if (!parent) throw new LibraryServiceError('FOLDER_NOT_FOUND');
    }

    const relativePath = parent ? path.posix.join(parent.relative_path, name) : name;
    const targetPath = this.folderPath(openLibrary, relativePath);
    if (existsSync(targetPath)) throw new LibraryServiceError('FOLDER_ALREADY_EXISTS');

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
             (folder_id, parent_folder_id, name, relative_path, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          folder.folderId,
          folder.parentFolderId,
          folder.name,
          folder.relativePath,
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
        'SELECT folder_id, parent_folder_id, name, relative_path FROM managed_folders ORDER BY relative_path',
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
    const preparingManifest: OperationManifest = {
      version: 1,
      phase: 'staging',
      files: entries.map((entry, index) => ({
        backupName: String(index),
        destinationRelativePath: entry.destinationRelativePath,
        hadDestination: existsSync(this.folderPath(openLibrary, entry.destinationRelativePath)),
        stageName: String(index),
      })),
      directories: directories.map((relativePath) => ({
        existed: existsSync(this.folderPath(openLibrary, relativePath)),
        relativePath,
      })),
    };
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
        copyFileSync(entry.sourcePath, stagedPath);
        const stagedStat = statSync(stagedPath);
        if (stagedStat.size !== entry.byteSize) {
          throw new Error('Import source changed while staging.');
        }
        stagedEntries.push({ ...entry, byteSize: stagedStat.size, sourcePath: stagedPath });
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
      const destinationPath = this.folderPath(openLibrary, entry.destinationRelativePath);

      let existingSize = seenDestinations.get(entry.destinationRelativePath);
      if (existingSize === undefined && existsSync(destinationPath)) {
        let destinationStat;
        try {
          destinationStat = lstatSync(destinationPath);
        } catch (error) {
          throw new LibraryServiceError('INVALID_IMPORT_SOURCE', { cause: error });
        }
        if (!destinationStat.isFile() || destinationStat.isSymbolicLink()) {
          nameConflictCount += 1;
          if (examples.length < 8) {
            examples.push({
              displayName: path.posix.basename(entry.destinationRelativePath),
              kind: 'name-conflict',
            });
          }
          continue;
        }
        existingSize = destinationStat.size;
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
          seenDestinations.set(entry.destinationRelativePath, entry.byteSize);
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
    const occupied = new Map<string, number>();
    const actions: ImportAction[] = [];
    const mergedAssetIds = new Set<string>();
    let skippedCount = 0;

    const diskSize = (relativePath: string): number | undefined => {
      const plannedSize = occupied.get(relativePath);
      if (plannedSize !== undefined) return plannedSize;
      const targetPath = this.folderPath(openLibrary, relativePath);
      if (!existsSync(targetPath)) return undefined;
      const targetStat = lstatSync(targetPath);
      return targetStat.isFile() && !targetStat.isSymbolicLink() ? targetStat.size : -1;
    };
    const copyPath = (relativePath: string): string => {
      const directory = path.posix.dirname(relativePath);
      const fileName = path.posix.basename(relativePath);
      for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
        const candidateName = copyNameForIndex(fileName, index);
        const candidate = directory === '.' ? candidateName : path.posix.join(directory, candidateName);
        if (diskSize(candidate) === undefined) return candidate;
      }
      throw new LibraryServiceError('IMPORT_APPLY_FAILED');
    };

    try {
      for (const entry of pending.entries) {
        const existingSize = diskSize(entry.destinationRelativePath);
        const conflictKind =
          existingSize === undefined
            ? undefined
            : existingSize === entry.byteSize
              ? 'suspected-duplicate'
              : 'name-conflict';
        let destinationRelativePath = entry.destinationRelativePath;
        let isReplacement = false;
        if (conflictKind === 'suspected-duplicate') {
          if (input.suspectedDuplicate === 'skip') {
            skippedCount += 1;
            continue;
          }
          if (input.suspectedDuplicate === 'create-copy') {
            destinationRelativePath = copyPath(destinationRelativePath);
          } else {
            const retainedAsset = openLibrary.connection
              .prepare('SELECT asset_id, current_revision_id FROM assets WHERE relative_file_path = ?')
              .get(destinationRelativePath) as ExistingAssetRow | undefined;
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
            destinationRelativePath = copyPath(destinationRelativePath);
          } else {
            if (existingSize === -1) {
              throw new LibraryServiceError('IMPORT_APPLY_FAILED');
            }
            isReplacement = true;
          }
        }

        const existingAsset = openLibrary.connection
          .prepare(
            'SELECT asset_id, current_revision_id FROM assets WHERE relative_file_path = ?',
          )
          .get(destinationRelativePath) as ExistingAssetRow | undefined;
        occupied.set(destinationRelativePath, entry.byteSize);
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
    const directoryPaths = new Set(pending.directories);
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

      const affectedAssetIds: string[] = [];
      let importedCount = 0;
      let replacedCount = 0;
      openLibrary.connection.transaction(() => {
        const now = new Date().toISOString();
        const folderRows = openLibrary.connection
          .prepare(
            'SELECT folder_id, parent_folder_id, name, relative_path FROM managed_folders ORDER BY relative_path',
          )
          .all() as ManagedFolderRow[];
        const foldersByPath = new Map(folderRows.map((folder) => [folder.relative_path, folder]));
        for (const relativeDirectory of sortedDirectories) {
          if (foldersByPath.has(relativeDirectory)) continue;
          const parentPath = path.posix.dirname(relativeDirectory);
          const folder: ManagedFolderRow = {
            folder_id: randomUUID(),
            parent_folder_id: parentPath === '.' ? null : (foldersByPath.get(parentPath)?.folder_id ?? null),
            name: path.posix.basename(relativeDirectory),
            relative_path: relativeDirectory,
          };
          if (parentPath !== '.' && folder.parent_folder_id === null) {
            throw new Error('Imported folder parent is missing.');
          }
          openLibrary.connection
            .prepare(
              `INSERT INTO managed_folders
                 (folder_id, parent_folder_id, name, relative_path, created_at)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(folder.folder_id, folder.parent_folder_id, folder.name, folder.relative_path, now);
          foldersByPath.set(relativeDirectory, folder);
        }

        actions.forEach((action) => {
          const destinationPath = this.folderPath(openLibrary, action.destinationRelativePath);
          const fileStat = statSync(destinationPath);
          const directory = path.posix.dirname(action.destinationRelativePath);
          const managedFolderId = directory === '.' ? null : (foldersByPath.get(directory)?.folder_id ?? null);
          const assetId = action.existingAsset?.asset_id ?? randomUUID();
          const revisionId = randomUUID();
          if (!action.existingAsset) {
            openLibrary.connection
              .prepare(
                `INSERT INTO assets
                   (asset_id, location_kind, managed_folder_id, relative_file_path,
                    current_revision_id, availability, created_at, updated_at)
                 VALUES (?, 'managed', ?, ?, NULL, 'available', ?, ?)`,
              )
              .run(assetId, managedFolderId, action.destinationRelativePath, now, now);
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
                  SET managed_folder_id = ?, current_revision_id = ?, availability = 'available', updated_at = ?
                WHERE asset_id = ?`,
            )
            .run(managedFolderId, revisionId, now, assetId);
          affectedAssetIds.push(assetId);
        });
        this.failAt('before-db-commit');
        openLibrary.connection
          .prepare("UPDATE file_operations SET status = 'committed', updated_at = ? WHERE operation_id = ?")
          .run(new Date().toISOString(), operationId);
      })();

      this.removeOperation(operationPath);
      const allAssets = this.listAssets({ libraryId: pending.libraryId, recursive: true });
      const affected = new Set([...affectedAssetIds, ...mergedAssetIds]);
      return {
        importedCount,
        skippedCount,
        replacedCount,
        assets: allAssets.filter((asset) => affected.has(asset.assetId)),
      };
    } catch (error) {
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
    const before = this.listAssets({ libraryId, recursive: true });
    let changedCount = 0;
    let missingCount = 0;

    openLibrary.connection.transaction(() => {
      for (const asset of before) {
        const assetPath = this.folderPath(openLibrary, asset.relativeFilePath);
        let fileStat;
        try {
          fileStat = lstatSync(assetPath);
        } catch {
          fileStat = undefined;
        }
        if (!fileStat?.isFile() || fileStat.isSymbolicLink()) {
          if (asset.availability === 'available') {
            openLibrary.connection
              .prepare("UPDATE assets SET availability = 'missing', updated_at = ? WHERE asset_id = ?")
              .run(new Date().toISOString(), asset.assetId);
            changedCount += 1;
            missingCount += 1;
          }
          continue;
        }

        const modifiedAt = fileStat.mtime.toISOString();
        const statChanged = fileStat.size !== asset.byteSize || modifiedAt !== asset.modifiedAt;
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
              asset.assetId,
              asset.currentRevisionId,
              fileStat.size,
              modifiedAt,
              asset.displayName,
              now,
            );
          openLibrary.connection
            .prepare(
              `UPDATE assets
                  SET current_revision_id = ?, availability = 'available', updated_at = ?
                WHERE asset_id = ?`,
            )
            .run(revisionId, now, asset.assetId);
          changedCount += 1;
        } else if (asset.availability === 'missing') {
          openLibrary.connection
            .prepare("UPDATE assets SET availability = 'available', updated_at = ? WHERE asset_id = ?")
            .run(now, asset.assetId);
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
