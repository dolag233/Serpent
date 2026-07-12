import { randomUUID, createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

import type { PublicErrorCode } from '../shared/protocol/errors';
import type { InternalLibrarySummary } from '../shared/protocol/responses';
import {
  LibraryInputError,
  normalizeAbsolutePath,
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

const SUPPORTED_SCHEMA_VERSION = 1;
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

function directoryExists(directoryPath: string): boolean {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function databasePath(libraryPath: string): string {
  return path.join(libraryPath, '.serpent', 'library.db');
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

function migrateFreshDatabase(connection: DatabaseConnection): void {
  if (schemaVersion(connection) !== 0) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }

  connection.transaction(() => {
    connection.exec(INITIAL_SCHEMA_SQL);
    connection
      .prepare(
        'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
      )
      .run(1, INITIAL_SCHEMA_CHECKSUM, new Date().toISOString());
    connection.pragma('user_version = 1');
  })();
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

  const migrations = connection
    .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
    .all() as MigrationRow[];
  if (
    migrations.length !== 1 ||
    migrations[0]?.version !== 1 ||
    migrations[0].checksum !== INITIAL_SCHEMA_CHECKSUM
  ) {
    throw new LibraryServiceError('LIBRARY_CORRUPT');
  }

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
      connection = new Database(databasePath(partialPath));
      migrateFreshDatabase(connection);
      connection
        .prepare('INSERT INTO library (library_id, display_name, created_at) VALUES (?, ?, ?)')
        .run(randomUUID(), displayName, new Date().toISOString());
      verifyDatabase(connection);
      connection.close();
      connection = undefined;

      const verificationConnection = new Database(databasePath(partialPath));
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
      if (!directoryExists(path.join(canonicalPath, directoryName))) {
        throw new LibraryServiceError('NOT_A_LIBRARY');
      }
    }
    const serpentPath = path.join(canonicalPath, '.serpent');
    if (!directoryExists(serpentPath) || !fileExists(databasePath(canonicalPath))) {
      throw new LibraryServiceError('NOT_A_LIBRARY');
    }

    let connection: DatabaseConnection | undefined;
    try {
      connection = new Database(databasePath(canonicalPath));
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
      this.openById.set(summary.libraryId, { connection, summary });
      this.openIdByPath.set(canonicalPath, summary.libraryId);
      return summary;
    } catch (error) {
      closeIgnoringFailure(connection);
      throw serviceError(error, 'LIBRARY_CORRUPT');
    }
  }

  closeLibrary(libraryId: string): void {
    const openLibrary = this.openById.get(libraryId);
    if (!openLibrary) throw new LibraryServiceError('LIBRARY_NOT_OPEN');

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
