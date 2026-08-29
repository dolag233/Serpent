import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  type Stats,
} from 'node:fs';
import {
  lstat as lstatAsync,
  mkdir as mkdirAsync,
  rename as renameAsync,
  readFile as readFileAsync,
  rm as rmAsync,
  stat as statAsync,
  writeFile as writeFileAsync,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * A deliberately small structural surface keeps this module independent from
 * better-sqlite3 and from LibraryService's private database types. The
 * Worker supplies the real open/validation functions at the boundary.
 */
export interface NetworkMetadataCacheStatement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): { changes: number };
}

export interface NetworkMetadataCacheDatabase {
  backup(
    filename: string,
    options?: {
      progress?: (progress: { remainingPages: number; totalPages: number }) => number | void;
    },
  ): Promise<{ remainingPages: number; totalPages: number }>;
  close(): void;
  exec(sql: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(sql: string): NetworkMetadataCacheStatement;
  transaction<T>(operation: () => T): NetworkMetadataCacheTransaction<T>;
}

export interface NetworkMetadataCacheTransaction<T> {
  (): T;
  immediate(): T;
}

export interface NetworkMetadataSourceFingerprint {
  size: number;
  mtimeMs: number;
}

export interface NetworkMetadataCacheManifest {
  formatVersion: 1;
  cacheKey: string;
  libraryId: string;
  schemaVersion: number;
  sourceChangeSequence: number;
  sourceFingerprint: NetworkMetadataSourceFingerprint;
  snapshotFile: string;
  snapshotSha256: string;
  createdAt: string;
  byteSize: number;
}

export interface LoadedNetworkMetadataSnapshot {
  connection: NetworkMetadataCacheDatabase;
  manifest: NetworkMetadataCacheManifest;
  snapshotPath: string;
  /** False when the caller supplied a newer file fingerprint; rows may be stale. */
  fingerprintMatches: boolean;
}

export interface CreateNetworkMetadataSnapshotInput {
  cacheKey: string;
  libraryId: string;
  schemaVersion: number;
  sourceChangeSequence: number;
  sourceFingerprint: NetworkMetadataSourceFingerprint;
  sourceConnection: NetworkMetadataCacheDatabase;
  signal?: AbortSignal;
  openReadonly: (snapshotPath: string) => NetworkMetadataCacheDatabase;
  validate: (connection: NetworkMetadataCacheDatabase) => void;
  onProgress?: (progress: { remainingPages: number; totalPages: number }) => void;
  /** Gate publication after backup validation, before changing the manifest pointer. */
  beforePublish?: () => boolean | Promise<boolean>;
  /** Final publication check; a false result restores the previous manifest pointer. */
  afterPublish?: () => boolean | Promise<boolean>;
}

export interface LoadNetworkMetadataSnapshotInput {
  cacheKey: string;
  libraryId: string;
  schemaVersion: number;
  sourceChangeSequence?: number;
  sourceFingerprint?: NetworkMetadataSourceFingerprint;
  openReadonly: (snapshotPath: string) => NetworkMetadataCacheDatabase;
  validate: (connection: NetworkMetadataCacheDatabase) => void;
}

export interface LoadLatestNetworkMetadataSnapshotInput {
  cacheKey: string;
  openReadonly: (snapshotPath: string) => NetworkMetadataCacheDatabase;
  validate: (
    connection: NetworkMetadataCacheDatabase,
    manifest: NetworkMetadataCacheManifest,
  ) => void;
}

export interface NetworkMetadataCacheOptions {
  /** Maximum total snapshot bytes for this user's disposable cache. */
  maxBytes?: number;
}

export interface NetworkReadThroughConnection extends NetworkMetadataCacheDatabase {
  /** The writable source that owns the SQLite handle and close lifecycle. */
  readonly primaryConnection: NetworkMetadataCacheDatabase;
  /** Replace the read-only snapshot after a verified background refresh. */
  replaceReadConnection(connection: NetworkMetadataCacheDatabase): void;
  /** Stop serving the snapshot after a local or remote change is observed. */
  invalidateReadConnection(): void;
  /** Whether ordinary SELECT statements currently use the local snapshot. */
  readonly readCacheActive: boolean;
}

export interface NetworkReadThroughConnectionOptions {
  /** Used by the coordinator/write-only adapter to force primary reads. */
  allowSnapshotReads?: boolean;
  /** When present, only SELECTs whose FROM/JOIN tables are in this catalog allowlist may use the snapshot. */
  allowedSnapshotTables?: readonly string[];
  /** Tables whose volatile state must never be served by the catalog snapshot. */
  disallowedSnapshotTables?: readonly string[];
  /** Invalidates a separate read adapter after a write-only SQL operation. */
  onPrimaryMutation?: () => void;
}

export type NetworkMetadataCacheEvent =
  | {
      type: 'hit' | 'miss' | 'stale' | 'invalidated' | 'refresh-started' | 'refreshed' | 'refresh-skipped' | 'error' | 'offline';
      libraryId: string;
      sourceChangeSequence?: number;
      durationMs?: number;
      reason?: string;
    };

export class NetworkMetadataSnapshotRejectedError extends Error {
  readonly code = 'NETWORK_METADATA_SNAPSHOT_REJECTED' as const;

  constructor(readonly reason: 'remote-changed-during-backup' | 'snapshot-over-budget') {
    super(`Network metadata snapshot rejected: ${reason}.`);
    this.name = 'NetworkMetadataSnapshotRejectedError';
  }
}

const CACHE_FORMAT_VERSION = 1 as const;
const MANIFEST_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_CACHE_BYTES = 512 * 1024 * 1024;
const CACHE_PUBLICATION_LOCK_NAME = '.publication.lock';
const CACHE_LOCK_STALE_MS = 30_000;
const CACHE_LOCK_WAIT_MS = 10_000;
const CACHE_LOCK_RETRY_MS = 25;

function configuredCacheDirectory(): string {
  const configured = process.env.SERPENT_LIBRARY_METADATA_CACHE_PATH;
  if (configured) return path.resolve(configured);

  // E2E runs intentionally redirect the whole application profile. Keeping
  // the fallback below makes direct Worker/service tests deterministic while
  // production Main passes app.getPath('userData') explicitly.
  const e2eUserData = process.env.SERPENT_E2E_USER_DATA_PATH;
  if (e2eUserData) return path.join(path.resolve(e2eUserData), 'library-metadata-cache');

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Serpent', 'library-metadata-cache');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
      'Serpent',
      'library-metadata-cache',
    );
  }
  return path.join(
    process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'),
    'Serpent',
    'library-metadata-cache',
  );
}

export interface AcceptNetworkMetadataSnapshotInput {
  snapshot: LoadedNetworkMetadataSnapshot;
  /** Return true only after ownership of the snapshot connection is transferred. */
  accept: (snapshot: LoadedNetworkMetadataSnapshot) => boolean | Promise<boolean>;
}

export function defaultNetworkMetadataCacheDirectory(): string {
  return configuredCacheDirectory();
}

/** Hash the canonical library path so cache filenames never disclose it. */
export function networkMetadataCacheKey(canonicalLibraryPath: string): string {
  return createHash('sha256').update(canonicalLibraryPath, 'utf8').digest('hex');
}

export function networkMetadataSourceFingerprint(
  databasePath: string,
  stat: (filePath: string) => Stats = statSync,
): NetworkMetadataSourceFingerprint | undefined {
  try {
    const entry = stat(databasePath);
    if (!entry.isFile() || !Number.isSafeInteger(entry.size) || entry.size < 0) return undefined;
    if (!Number.isFinite(entry.mtimeMs) || entry.mtimeMs < 0) return undefined;
    return { size: entry.size, mtimeMs: entry.mtimeMs };
  } catch {
    return undefined;
  }
}

export function networkMetadataSourceFingerprintEqual(
  left: NetworkMetadataSourceFingerprint | undefined,
  right: NetworkMetadataSourceFingerprint | undefined,
): boolean {
  return left !== undefined
    && right !== undefined
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

function isSafeIdentifier(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function isSafeManifest(value: unknown): value is NetworkMetadataCacheManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const manifest = value as Partial<NetworkMetadataCacheManifest>;
  const fingerprint = manifest.sourceFingerprint;
  const cacheKey = manifest.cacheKey;
  const libraryId = manifest.libraryId;
  const schemaVersion = manifest.schemaVersion;
  const sourceChangeSequence = manifest.sourceChangeSequence;
  const byteSize = manifest.byteSize;
  const snapshotSha256 = manifest.snapshotSha256;
  if (
    fingerprint === undefined
    || typeof cacheKey !== 'string'
    || typeof libraryId !== 'string'
    || typeof schemaVersion !== 'number'
    || typeof sourceChangeSequence !== 'number'
    || typeof byteSize !== 'number'
    || typeof snapshotSha256 !== 'string'
  ) return false;
  return manifest.formatVersion === CACHE_FORMAT_VERSION
    && isSafeIdentifier(cacheKey)
    && libraryId.length > 0
    && Number.isSafeInteger(schemaVersion)
    && schemaVersion > 0
    && Number.isSafeInteger(sourceChangeSequence)
    && sourceChangeSequence >= 0
    && typeof fingerprint === 'object'
    && fingerprint !== null
    && Number.isSafeInteger(fingerprint.size)
    && fingerprint.size >= 0
    && Number.isFinite(fingerprint.mtimeMs)
    && fingerprint.mtimeMs >= 0
    && typeof manifest.snapshotFile === 'string'
    && new RegExp(`^${cacheKey}(?:-[0-9a-f-]{36})?\\.db$`, 'u').test(manifest.snapshotFile)
    && /^[a-f0-9]{64}$/u.test(snapshotSha256)
    && typeof manifest.createdAt === 'string'
    && Number.isSafeInteger(byteSize)
    && byteSize >= 0;
}

function manifestPath(cacheDirectory: string, cacheKey: string): string {
  return path.join(cacheDirectory, `${cacheKey}.json`);
}

function snapshotPath(cacheDirectory: string, cacheKey: string): string {
  return path.join(cacheDirectory, `${cacheKey}.db`);
}

function manifestSnapshotPath(
  cacheDirectory: string,
  manifest: NetworkMetadataCacheManifest,
): string {
  return path.join(cacheDirectory, manifest.snapshotFile);
}

/** Hash in bounded chunks so validating a large snapshot never copies it into RSS. */
function sha256File(filePath: string): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, 'r');
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
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* best effort */ }
    }
  }
}

function isRealDirectory(directoryPath: string): boolean {
  try {
    const entry = lstatSync(directoryPath);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
}

function ensureCacheDirectory(cacheDirectory: string): boolean {
  try {
    if (existsSync(cacheDirectory)) return isRealDirectory(cacheDirectory);
    mkdirSync(cacheDirectory, { recursive: true });
    return isRealDirectory(cacheDirectory);
  } catch {
    return false;
  }
}

function closeQuietly(connection: NetworkMetadataCacheDatabase | undefined): void {
  try { connection?.close(); } catch { /* cache cleanup is best effort */ }
}

async function replaceFile(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await renameAsync(sourcePath, destinationPath);
  } catch {
    await rmAsync(destinationPath, { force: true });
    await renameAsync(sourcePath, destinationPath);
  }
}

interface NetworkMetadataCacheLockRecord {
  pid: number;
  token: string;
  createdAt: number;
}

function isNetworkMetadataCacheLockRecord(value: unknown): value is NetworkMetadataCacheLockRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Partial<NetworkMetadataCacheLockRecord>;
  const pid = record.pid;
  const token = record.token;
  const createdAt = record.createdAt;
  return typeof pid === 'number'
    && Number.isSafeInteger(pid)
    && pid > 0
    && typeof token === 'string'
    && token.length > 0
    && typeof createdAt === 'number'
    && Number.isFinite(createdAt)
    && createdAt > 0;
}

function networkMetadataCacheLockPath(cacheDirectory: string): string {
  return path.join(cacheDirectory, CACHE_PUBLICATION_LOCK_NAME);
}

function networkMetadataCacheLockOwnerPath(lockPath: string): string {
  return path.join(lockPath, 'owner.json');
}

async function networkMetadataCacheLockCanBeReclaimed(lockPath: string): Promise<boolean> {
  let lockStat: Stats;
  try {
    lockStat = await lstatAsync(lockPath);
  } catch {
    return false;
  }
  if (!lockStat.isDirectory() || lockStat.isSymbolicLink()) return false;

  let owner: NetworkMetadataCacheLockRecord | undefined;
  try {
    const parsed: unknown = JSON.parse(
      await readFileAsync(networkMetadataCacheLockOwnerPath(lockPath), 'utf8'),
    );
    if (isNetworkMetadataCacheLockRecord(parsed)) owner = parsed;
  } catch {
    // A process can be terminated after creating the lock directory but
    // before writing its owner record. The directory age below bounds how
    // long that half-created lock can block future cache maintenance.
  }

  const createdAt = owner?.createdAt ?? lockStat.mtimeMs;
  if (!Number.isFinite(createdAt) || Date.now() - createdAt < CACHE_LOCK_STALE_MS) return false;
  if (owner === undefined) return true;

  // Do not reclaim a lock held by a live process. EPERM is deliberately
  // treated as live/unknown rather than risking a concurrent publication.
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

async function acquireNetworkMetadataCachePublicationLock(
  cacheDirectory: string,
): Promise<() => Promise<void>> {
  const lockPath = networkMetadataCacheLockPath(cacheDirectory);
  const deadline = Date.now() + CACHE_LOCK_WAIT_MS;

  for (;;) {
    let created = false;
    const token = randomUUID();
    try {
      // mkdir is an exclusive, cross-process operation on the local cache
      // directory. A directory lock also gives stale-lock recovery a private
      // owner file without ever exposing a partially-written JSON lock file.
      await mkdirAsync(lockPath);
      created = true;
      await writeFileAsync(
        networkMetadataCacheLockOwnerPath(lockPath),
        `${JSON.stringify({ pid: process.pid, token, createdAt: Date.now() })}\n`,
        { encoding: 'utf8', mode: 0o600, flag: 'wx' },
      );
      let released = false;
      return async (): Promise<void> => {
        if (released) return;
        released = true;
        try {
          const parsed: unknown = JSON.parse(
            await readFileAsync(networkMetadataCacheLockOwnerPath(lockPath), 'utf8'),
          );
          if (!isNetworkMetadataCacheLockRecord(parsed) || parsed.token !== token) return;
          await rmAsync(lockPath, { recursive: true, force: true });
        } catch {
          // Cache locking is a consistency guard, not user data. A later
          // attempt can reclaim this lock once its owner process is gone.
        }
      };
    } catch (error) {
      if (created) {
        // If this process was paused after mkdir and another process reclaimed
        // the stale directory, never remove the replacement lock. The wx
        // owner write plus token check makes cleanup conditional on ownership.
        try {
          const parsed: unknown = JSON.parse(
            await readFileAsync(networkMetadataCacheLockOwnerPath(lockPath), 'utf8'),
          );
          if (isNetworkMetadataCacheLockRecord(parsed) && parsed.token === token) {
            await rmAsync(lockPath, { recursive: true, force: true });
          }
        } catch { /* best effort */ }
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      if (await networkMetadataCacheLockCanBeReclaimed(lockPath)) {
        // Rename first so two waiters cannot both remove the same stale lock
        // and then enter the publication critical section together.
        const stalePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
        try {
          await renameAsync(lockPath, stalePath);
          await rmAsync(stalePath, { recursive: true, force: true });
        } catch {
          // Another process won the stale-lock race; retry acquisition below.
        }
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error('Network metadata cache publication lock is busy.', { cause: error });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, CACHE_LOCK_RETRY_MS));
    }
  }
}

function readManifest(manifestFile: string): NetworkMetadataCacheManifest | undefined {
  try {
    const entry = lstatSync(manifestFile);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MANIFEST_MAX_BYTES) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(manifestFile, 'utf8'));
    return isSafeManifest(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * User-scoped cache of consistent SQLite read snapshots for network libraries.
 * The cache is disposable: a missing, corrupt, stale or half-written entry is
 * simply ignored and the remote writable database remains authoritative.
 */
export class NetworkMetadataCache {
  readonly #directory: string;
  readonly #maxBytes: number;

  constructor(
    directory = configuredCacheDirectory(),
    options: NetworkMetadataCacheOptions = {},
  ) {
    this.#directory = path.resolve(directory);
    const maxBytes = options.maxBytes;
    this.#maxBytes = typeof maxBytes === 'number' && Number.isSafeInteger(maxBytes) && maxBytes > 0
      ? maxBytes
      : DEFAULT_MAX_CACHE_BYTES;
  }

  get directory(): string {
    return this.#directory;
  }

  load(input: LoadNetworkMetadataSnapshotInput): LoadedNetworkMetadataSnapshot | undefined {
    if (!isSafeIdentifier(input.cacheKey) || !ensureCacheDirectory(this.#directory)) return undefined;
    const manifestFile = manifestPath(this.#directory, input.cacheKey);
    const manifest = readManifest(manifestFile);
    // A caller may omit the source cursor when it needs the newest disposable
    // snapshot during a temporary remote outage. When supplied, the durable
    // SQLite cursor is the semantic match; a fingerprint mismatch is reported
    // to the caller so it can refresh in the background without blanking the
    // last usable local view.
    if (
      !manifest
      || manifest.cacheKey !== input.cacheKey
      || manifest.libraryId !== input.libraryId
      || manifest.schemaVersion !== input.schemaVersion
      || (input.sourceChangeSequence !== undefined
        && manifest.sourceChangeSequence !== input.sourceChangeSequence)
    ) return undefined;
    const snapshotFile = manifestSnapshotPath(this.#directory, manifest);
    let snapshotStat: Stats;
    try {
      snapshotStat = lstatSync(snapshotFile);
    } catch {
      return undefined;
    }
    if (
      !snapshotStat.isFile()
      || snapshotStat.isSymbolicLink()
      || snapshotStat.size !== manifest.byteSize
      || sha256File(snapshotFile) !== manifest.snapshotSha256
    ) return undefined;

    let connection: NetworkMetadataCacheDatabase | undefined;
    try {
      connection = input.openReadonly(snapshotFile);
      input.validate(connection);
      const quickCheck = connection.pragma('quick_check(1)', { simple: true });
      if (quickCheck !== 'ok') throw new Error('Network metadata snapshot failed quick_check.');
      return {
        connection,
        manifest,
        snapshotPath: snapshotFile,
        fingerprintMatches: input.sourceFingerprint === undefined
          || networkMetadataSourceFingerprintEqual(manifest.sourceFingerprint, input.sourceFingerprint),
      };
    } catch {
      closeQuietly(connection);
      return undefined;
    }
  }

  /**
   * Load the newest verified disposable snapshot when the source database is
   * temporarily unreachable. The manifest identity is authoritative for this
   * degraded path; callers must still validate the snapshot identity/schema
   * before exposing it.
   */
  loadLatest(
    input: LoadLatestNetworkMetadataSnapshotInput,
  ): LoadedNetworkMetadataSnapshot | undefined {
    if (!isSafeIdentifier(input.cacheKey) || !ensureCacheDirectory(this.#directory)) return undefined;
    const manifest = readManifest(manifestPath(this.#directory, input.cacheKey));
    if (!manifest || manifest.cacheKey !== input.cacheKey) return undefined;
    const snapshotFile = manifestSnapshotPath(this.#directory, manifest);
    let snapshotStat: Stats;
    try {
      snapshotStat = lstatSync(snapshotFile);
    } catch {
      return undefined;
    }
    if (
      !snapshotStat.isFile()
      || snapshotStat.isSymbolicLink()
      || snapshotStat.size !== manifest.byteSize
      || sha256File(snapshotFile) !== manifest.snapshotSha256
    ) return undefined;

    let connection: NetworkMetadataCacheDatabase | undefined;
    try {
      connection = input.openReadonly(snapshotFile);
      input.validate(connection, manifest);
      const quickCheck = connection.pragma('quick_check(1)', { simple: true });
      if (quickCheck !== 'ok') throw new Error('Network metadata snapshot failed quick_check.');
      return {
        connection,
        manifest,
        snapshotPath: snapshotFile,
        fingerprintMatches: false,
      };
    } catch {
      closeQuietly(connection);
      return undefined;
    }
  }

  async createSnapshot(input: CreateNetworkMetadataSnapshotInput): Promise<LoadedNetworkMetadataSnapshot> {
    if (!isSafeIdentifier(input.cacheKey)) throw new Error('Invalid network metadata cache key.');
    await mkdirAsync(this.#directory, { recursive: true });
    if (!isRealDirectory(this.#directory)) {
      throw new Error('Network metadata cache directory is not a real directory.');
    }

    // Snapshot generations are immutable. The manifest is the single pointer
    // that changes, so a crash can leave an orphan generation but cannot pair
    // a new database with an old manifest.
    const generationFile = `${input.cacheKey}-${randomUUID()}.db`;
    const finalSnapshotPath = path.join(this.#directory, generationFile);
    const finalManifestPath = manifestPath(this.#directory, input.cacheKey);
    const suffix = `${process.pid}-${randomUUID()}`;
    const temporarySnapshotPath = path.join(this.#directory, `.${input.cacheKey}.${suffix}.db.tmp`);
    const temporaryManifestPath = path.join(this.#directory, `.${input.cacheKey}.${suffix}.json.tmp`);
    let connection: NetworkMetadataCacheDatabase | undefined;
    try {
      await input.sourceConnection.backup(temporarySnapshotPath, {
        progress: (progress) => {
          if (input.signal?.aborted) throw new Error('Network metadata snapshot was cancelled.');
          input.onProgress?.(progress);
          // Keep each native backup slice bounded. A larger return value can
          // make a remote 20k library monopolize the Worker between yields.
          return 64;
        },
      });
      if (input.signal?.aborted) throw new Error('Network metadata snapshot was cancelled.');

      connection = input.openReadonly(temporarySnapshotPath);
      input.validate(connection);
      const quickCheck = connection.pragma('quick_check(1)', { simple: true });
      if (quickCheck !== 'ok') throw new Error('Network metadata snapshot failed quick_check.');
      closeQuietly(connection);
      connection = undefined;

      const snapshotStat = await statAsync(temporarySnapshotPath);
      if (snapshotStat.size > this.#maxBytes) {
        throw new NetworkMetadataSnapshotRejectedError('snapshot-over-budget');
      }
      const snapshotSha256 = sha256File(temporarySnapshotPath);
      if (!snapshotSha256) throw new Error('Network metadata snapshot hash failed.');
      const manifest: NetworkMetadataCacheManifest = {
        formatVersion: CACHE_FORMAT_VERSION,
        cacheKey: input.cacheKey,
        libraryId: input.libraryId,
        schemaVersion: input.schemaVersion,
        sourceChangeSequence: input.sourceChangeSequence,
        sourceFingerprint: input.sourceFingerprint,
        snapshotFile: generationFile,
        snapshotSha256,
        createdAt: new Date().toISOString(),
        byteSize: snapshotStat.size,
      };
      await writeFileAsync(
        temporaryManifestPath,
        `${JSON.stringify(manifest)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      // Backup and hashing stay outside the lock so a large network library
      // does not serialize unrelated cache keys. Publication, the final
      // source-state gate, rollback and the subsequent prune all share this
      // directory-wide lock; this is stronger than a per-key lock because
      // prune enforces one byte budget across every key in the directory.
      const releaseLock = await acquireNetworkMetadataCachePublicationLock(this.#directory);
      try {
        const previousManifest = readManifest(finalManifestPath);
        const previousManifestText = previousManifest === undefined
          ? undefined
          : `${JSON.stringify(previousManifest)}\n`;
        let generationPublished = false;
        let manifestPublished = false;
        try {
          if (input.beforePublish && !(await input.beforePublish())) {
            throw new NetworkMetadataSnapshotRejectedError('remote-changed-during-backup');
          }
          await replaceFile(temporarySnapshotPath, finalSnapshotPath);
          generationPublished = true;
          await replaceFile(temporaryManifestPath, finalManifestPath);
          manifestPublished = true;
          if (input.afterPublish && !(await input.afterPublish())) {
            throw new NetworkMetadataSnapshotRejectedError('remote-changed-during-backup');
          }

          const loaded = this.load({
            cacheKey: input.cacheKey,
            libraryId: input.libraryId,
            schemaVersion: input.schemaVersion,
            sourceChangeSequence: input.sourceChangeSequence,
            sourceFingerprint: input.sourceFingerprint,
            openReadonly: input.openReadonly,
            validate: input.validate,
          });
          if (!loaded) throw new Error('Network metadata snapshot could not be reopened.');
          return loaded;
        } catch (error) {
          closeQuietly(connection);
          if (generationPublished && (manifestPublished || !existsSync(finalManifestPath))) {
            // The lock makes this a compare-and-restore operation: no other
            // cache writer or prune pass can replace the pointer between the
            // ownership check and the restoration.
            const currentManifest = readManifest(finalManifestPath);
            if (currentManifest?.snapshotFile === generationFile || !existsSync(finalManifestPath)) {
              try {
                if (previousManifestText === undefined) {
                  await rmAsync(finalManifestPath, { force: true });
                } else {
                  const restoreManifestPath = path.join(
                    this.#directory,
                    `.${input.cacheKey}.${suffix}.restore.json.tmp`,
                  );
                  try {
                    await writeFileAsync(
                      restoreManifestPath,
                      previousManifestText,
                      { encoding: 'utf8', mode: 0o600 },
                    );
                    await replaceFile(restoreManifestPath, finalManifestPath);
                  } finally {
                    try { rmSync(restoreManifestPath, { force: true }); } catch { /* best effort */ }
                  }
                }
              } catch { /* best-effort rollback; the cache remains disposable */ }
            }
          }
          if (generationPublished) {
            try { rmSync(finalSnapshotPath, { force: true }); } catch { /* best effort */ }
          }
          throw error;
        }
      } finally {
        await releaseLock();
      }
    } finally {
      closeQuietly(connection);
      try { rmSync(temporarySnapshotPath, { force: true }); } catch { /* best effort */ }
      try { rmSync(temporaryManifestPath, { force: true }); } catch { /* best effort */ }
    }
  }

  /**
   * Transfer a freshly loaded snapshot into the active service connection.
   * The manifest pointer is checked again under the publication lock because
   * another process may have published a newer generation after createSnapshot
   * released its build lock. A false result closes the supplied connection and
   * lets the caller retry against the newest source state.
   */
  async acceptSnapshot(input: AcceptNetworkMetadataSnapshotInput): Promise<boolean> {
    const snapshot = input.snapshot;
    if (!isSafeIdentifier(snapshot.manifest.cacheKey)) {
      closeQuietly(snapshot.connection);
      return false;
    }

    let releaseLock: (() => Promise<void>) | undefined;
    try {
      releaseLock = await acquireNetworkMetadataCachePublicationLock(this.#directory);
    } catch {
      closeQuietly(snapshot.connection);
      return false;
    }

    let ownershipTransferred = false;
    try {
      const expectedSnapshotPath = manifestSnapshotPath(this.#directory, snapshot.manifest);
      if (path.resolve(snapshot.snapshotPath) !== path.resolve(expectedSnapshotPath)) return false;

      const currentManifest = readManifest(
        manifestPath(this.#directory, snapshot.manifest.cacheKey),
      );
      if (
        !currentManifest
        || currentManifest.cacheKey !== snapshot.manifest.cacheKey
        || currentManifest.libraryId !== snapshot.manifest.libraryId
        || currentManifest.schemaVersion !== snapshot.manifest.schemaVersion
        || currentManifest.sourceChangeSequence !== snapshot.manifest.sourceChangeSequence
        || currentManifest.snapshotFile !== snapshot.manifest.snapshotFile
        || currentManifest.snapshotSha256 !== snapshot.manifest.snapshotSha256
        || currentManifest.byteSize !== snapshot.manifest.byteSize
        || currentManifest.createdAt !== snapshot.manifest.createdAt
      ) return false;

      let snapshotStat: Stats;
      try {
        snapshotStat = lstatSync(expectedSnapshotPath);
      } catch {
        return false;
      }
      if (
        !snapshotStat.isFile()
        || snapshotStat.isSymbolicLink()
        || snapshotStat.size !== snapshot.manifest.byteSize
      ) return false;

      if (!(await input.accept(snapshot))) return false;
      ownershipTransferred = true;
      // Prune under the same lock as acceptance so a global budget pass cannot
      // delete a generation between connection takeover and cleanup.
      this.pruneUnlocked(snapshot.manifest.cacheKey);
      return true;
    } finally {
      if (!ownershipTransferred) closeQuietly(snapshot.connection);
      await releaseLock();
    }
  }

  /** Best-effort LRU-style cleanup of this user's derived cache. */
  async prune(excludeCacheKey?: string): Promise<void> {
    if (!ensureCacheDirectory(this.#directory)) return;
    let releaseLock: (() => Promise<void>) | undefined;
    try {
      releaseLock = await acquireNetworkMetadataCachePublicationLock(this.#directory);
    } catch {
      // Pruning is disposable maintenance. A concurrent publisher or another
      // process that holds the lock may perform the next cleanup pass.
      return;
    }
    try {
      this.pruneUnlocked(excludeCacheKey);
    } finally {
      await releaseLock();
    }
  }

  private pruneUnlocked(excludeCacheKey?: string): void {
    type Candidate = {
      cacheKey: string;
      modifiedAt: number;
      byteSize: number;
      snapshotPath: string;
    };
    const candidates: Candidate[] = [];
    const oversizedProtectedCandidates: Candidate[] = [];
    const referencedSnapshots = new Set<string>();
    let totalBytes = 0;
    let entries: string[];
    try {
      entries = readdirSync(this.#directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const cacheKey = entry.slice(0, -'.json'.length);
      if (!isSafeIdentifier(cacheKey)) continue;
      const manifest = readManifest(path.join(this.#directory, entry));
      if (!manifest) continue;
      const snapshot = manifestSnapshotPath(this.#directory, manifest);
      let snapshotStat: Stats;
      try {
        snapshotStat = lstatSync(snapshot);
      } catch {
        continue;
      }
      if (!snapshotStat.isFile() || snapshotStat.isSymbolicLink()) continue;
      referencedSnapshots.add(snapshot);
      let modifiedAt: number;
      try {
        modifiedAt = lstatSync(path.join(this.#directory, entry)).mtimeMs;
      } catch {
        continue;
      }
      const byteSize = Math.max(0, snapshotStat.size);
      totalBytes += byteSize;
      const candidate = { cacheKey, modifiedAt, byteSize, snapshotPath: snapshot };
      if (cacheKey === excludeCacheKey) {
        if (byteSize > this.#maxBytes) oversizedProtectedCandidates.push(candidate);
      } else {
        candidates.push(candidate);
      }
    }
    if (totalBytes > this.#maxBytes) {
      candidates.sort((left, right) => left.modifiedAt - right.modifiedAt);
      for (const candidate of candidates) {
        if (totalBytes <= this.#maxBytes) break;
        try {
          rmSync(candidate.snapshotPath, { force: true });
          rmSync(manifestPath(this.#directory, candidate.cacheKey), { force: true });
          totalBytes -= candidate.byteSize;
        } catch {
          // A second Serpent process or Windows handle may still own this entry.
          // It remains eligible for the next prune pass.
        }
      }
      // A legacy or externally-created cache entry may itself exceed the
      // budget. Once all other keys are gone, discard that protected entry so
      // the cache never claims a permanent over-budget state. A live reader
      // can continue on POSIX; Windows will retry after its handle closes.
      for (const candidate of oversizedProtectedCandidates) {
        if (totalBytes <= this.#maxBytes) break;
        try {
          rmSync(candidate.snapshotPath, { force: true });
          rmSync(manifestPath(this.#directory, candidate.cacheKey), { force: true });
          totalBytes -= candidate.byteSize;
        } catch {
          // A second process may still own the file; retry on a later pass.
        }
      }
    }
    // A crash between publishing a generation and publishing its manifest can
    // leave an unreferenced file. It is disposable; remove it after the
    // referenced entries have been accounted for. Windows handle failures are
    // intentionally retried by a later prune pass.
    for (const entry of entries) {
      if (!entry.endsWith('.db')) continue;
      const candidatePath = path.join(this.#directory, entry);
      if (referencedSnapshots.has(candidatePath)) continue;
      try { rmSync(candidatePath, { force: true }); } catch { /* best effort */ }
    }
  }

  /** Test/maintenance helper; only touches this user-scoped derived cache. */
  clear(cacheKey: string): void {
    if (!isSafeIdentifier(cacheKey)) return;
    const manifest = readManifest(manifestPath(this.#directory, cacheKey));
    if (manifest) {
      try { rmSync(manifestSnapshotPath(this.#directory, manifest), { force: true }); } catch { /* best effort */ }
    }
    // Also clean the pre-generation filename used by early development builds.
    try { rmSync(snapshotPath(this.#directory, cacheKey), { force: true }); } catch { /* best effort */ }
    try { rmSync(manifestPath(this.#directory, cacheKey), { force: true }); } catch { /* best effort */ }
  }
}

function stripLeadingSqlComments(sql: string): string {
  let remaining = sql.trimStart();
  for (;;) {
    if (remaining.startsWith('--')) {
      const newline = remaining.indexOf('\n');
      remaining = newline < 0 ? '' : remaining.slice(newline + 1).trimStart();
      continue;
    }
    if (remaining.startsWith('/*')) {
      const end = remaining.indexOf('*/', 2);
      remaining = end < 0 ? '' : remaining.slice(end + 2).trimStart();
      continue;
    }
    return remaining;
  }
}

/**
 * Route ordinary SELECTs to the local snapshot while keeping every other SQL
 * operation on the remote primary. A WITH query is admitted only after a
 * small lexical scan proves its top-level statement is SELECT/EXPLAIN;
 * data-changing CTEs therefore remain on the primary.
 */
function isSnapshotReadSql(sql: string): boolean {
  const normalized = stripLeadingSqlComments(sql);
  if (/^(?:SELECT|EXPLAIN)\b/iu.test(normalized)) return true;
  if (!/^WITH\b/iu.test(normalized)) return false;

  let depth = 0;
  let quote: "'" | '"' | '`' | '[' | undefined;
  let token = '';
  const flushToken = (): string | undefined => {
    if (token.length === 0) return undefined;
    const value = token.toUpperCase();
    token = '';
    return value;
  };
  const acceptTopLevelToken = (value: string | undefined): boolean | undefined => {
    if (value === undefined || depth !== 0) return undefined;
    if (value === 'SELECT' || value === 'EXPLAIN') return true;
    if (value === 'INSERT' || value === 'UPDATE' || value === 'DELETE' || value === 'REPLACE') return false;
    return undefined;
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    const next = normalized[index + 1];
    if (quote !== undefined) {
      if (quote === '[' && character === ']') quote = undefined;
      else if (quote !== '[' && character === quote) {
        if (next === quote) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`' || character === '[') {
      flushToken();
      quote = character;
      continue;
    }
    if (character === '-' && next === '-') {
      flushToken();
      const newline = normalized.indexOf('\n', index + 2);
      index = newline < 0 ? normalized.length : newline;
      continue;
    }
    if (character === '/' && next === '*') {
      flushToken();
      const end = normalized.indexOf('*/', index + 2);
      index = end < 0 ? normalized.length : end + 1;
      continue;
    }
    if (character === '(') {
      flushToken();
      depth += 1;
      continue;
    }
    if (character === ')') {
      flushToken();
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      token += character;
      continue;
    }
    const tokenValue = flushToken();
    if (tokenValue === 'INSERT' || tokenValue === 'UPDATE' || tokenValue === 'DELETE' || tokenValue === 'REPLACE') {
      return false;
    }
    const verdict = acceptTopLevelToken(tokenValue);
    if (verdict !== undefined) return verdict;
  }
  const tokenValue = flushToken();
  if (tokenValue === 'INSERT' || tokenValue === 'UPDATE' || tokenValue === 'DELETE' || tokenValue === 'REPLACE') {
    return false;
  }
  return acceptTopLevelToken(tokenValue) === true;
}

function sqlTableTokens(sql: string): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    const next = sql[index + 1];
    if (character === '-' && next === '-') {
      const newline = sql.indexOf('\n', index + 2);
      index = newline < 0 ? sql.length : newline;
      continue;
    }
    if (character === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      index = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (character === "'") {
      for (index += 1; index < sql.length; index += 1) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 1;
        } else if (sql[index] === "'") {
          break;
        }
      }
      continue;
    }
    if (character === '"' || character === '`' || character === '[') {
      const closing = character === '[' ? ']' : character;
      const start = index + 1;
      let end = start;
      while (end < sql.length && sql[end] !== closing) end += 1;
      if (end > start) tokens.push(sql.slice(start, end).toLowerCase());
      index = end;
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_$]/u.test(sql[end]!)) end += 1;
      tokens.push(sql.slice(index, end).toLowerCase());
      index = end - 1;
      continue;
    }
    if (character === '.' || character === '(' || character === ')' || character === ',') {
      tokens.push(character);
    }
  }
  return tokens;
}

function referencesOnlyAllowedSnapshotTables(
  sql: string,
  allowedTables: ReadonlySet<string>,
): boolean {
  const tokens = sqlTableTokens(sql);
  const tokenDepths: number[] = [];
  let depth = 0;
  for (const token of tokens) {
    tokenDepths.push(depth);
    if (token === '(') depth += 1;
    else if (token === ')') depth = Math.max(0, depth - 1);
  }
  const cteNames = new Set<string>();
  if (tokens[0] === 'with') {
    let withDepth = 0;
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token === '(') {
        withDepth += 1;
        continue;
      }
      if (token === ')') {
        withDepth = Math.max(0, withDepth - 1);
        continue;
      }
      if (withDepth === 0 && token === 'select') break;
      if (
        withDepth === 0
        && token !== 'recursive'
        && token !== ','
      ) {
        if (tokens[index + 1] === 'as') {
          cteNames.add(token);
        } else if (tokens[index + 1] === '(') {
          let columnDepth = 1;
          let columnEnd = index + 2;
          while (columnEnd < tokens.length && columnDepth > 0) {
            if (tokens[columnEnd] === '(') columnDepth += 1;
            if (tokens[columnEnd] === ')') columnDepth -= 1;
            columnEnd += 1;
          }
          if (columnDepth === 0 && tokens[columnEnd] === 'as') cteNames.add(token);
        }
      }
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token !== 'from' && token !== 'join') continue;
    let tableIndex = index + 1;
    if (tokens[tableIndex] === 'lateral') tableIndex += 1;
    // A derived table may contain another FROM/JOIN tree. Reject it here and
    // keep the query on the primary rather than attempting an incomplete SQL
    // parser and accidentally serving an unknown table from a stale snapshot.
    if (tokens[tableIndex] === '(') return false;
    let table = tokens[tableIndex];
    if (tokens[tableIndex + 1] === '.' && tokens[tableIndex + 2] !== undefined) {
      // Only the main database is snapshotted. An attached/temp schema can
      // legally reuse a catalog table name but is outside this cache's proof.
      if (table !== 'main') return false;
      table = tokens[tableIndex + 2];
    }
    if (table === undefined || (!allowedTables.has(table) && !cteNames.has(table))) return false;

    // Comma-separated FROM items are valid SQL but are easy to under-parse
    // around aliases and nested expressions. A conservative primary fallback
    // is preferable to letting an unlisted/future table ride the snapshot.
    const fromDepth = tokenDepths[index] ?? 0;
    const clauseTerminators = new Set([
      'join', 'where', 'group', 'order', 'having', 'limit', 'offset',
      'union', 'intersect', 'except', 'window', 'returning', 'on', 'using',
    ]);
    for (let cursor = tableIndex + 1; cursor < tokens.length; cursor += 1) {
      if (tokenDepths[cursor] !== fromDepth) continue;
      const nextToken = tokens[cursor]!;
      if (nextToken === ',') return false;
      if (clauseTerminators.has(nextToken)) break;
    }
  }
  return true;
}

/**
 * A compatibility adapter lets the existing service keep one connection
 * surface while making the read/write split explicit at SQL admission:
 * SELECT/EXPLAIN may use a read-only local snapshot; writes, PRAGMAs,
 * transactions and all ambiguous statements use the remote truth source.
 */
export function createNetworkReadThroughConnection(
  primary: NetworkMetadataCacheDatabase,
  initialReadConnection?: NetworkMetadataCacheDatabase,
  options: NetworkReadThroughConnectionOptions = {},
): NetworkReadThroughConnection {
  let readConnection = initialReadConnection;
  let forcePrimaryDepth = 0;
  let closed = false;
  const allowSnapshotReads = options.allowSnapshotReads !== false;
  const allowedSnapshotTables = options.allowedSnapshotTables === undefined
    ? undefined
    : new Set(options.allowedSnapshotTables.map((table) => table.toLowerCase()));
  const disallowedSnapshotTableTokens = (options.disallowedSnapshotTables ?? [])
    .map((table) => table.toLowerCase());

  const invalidate = (): void => {
    const previous = readConnection;
    readConnection = undefined;
    if (previous && previous !== primary) closeQuietly(previous);
  };

  const connection: NetworkReadThroughConnection = {
    primaryConnection: primary,
    get readCacheActive(): boolean {
      return readConnection !== undefined && !closed;
    },
    replaceReadConnection(next: NetworkMetadataCacheDatabase): void {
      if (closed) {
        closeQuietly(next);
        return;
      }
      const previous = readConnection;
      readConnection = next;
      if (previous && previous !== primary && previous !== next) closeQuietly(previous);
    },
    invalidateReadConnection: invalidate,
    backup: (filename, options) => primary.backup(filename, options),
    close: (): void => {
      if (closed) return;
      closed = true;
      const snapshot = readConnection;
      readConnection = undefined;
      if (snapshot && snapshot !== primary) closeQuietly(snapshot);
      primary.close();
    },
    exec: (sql): void => {
      invalidate();
      options.onPrimaryMutation?.();
      primary.exec(sql);
    },
    pragma: (source, options) => primary.pragma(source, options),
    prepare: (sql): NetworkMetadataCacheStatement => {
      const snapshotEligible = isSnapshotReadSql(sql)
        && (allowedSnapshotTables === undefined || referencesOnlyAllowedSnapshotTables(sql, allowedSnapshotTables))
        && !disallowedSnapshotTableTokens.some((table) => sql.toLowerCase().includes(table));
      let primaryStatement: NetworkMetadataCacheStatement | undefined;
      let snapshotStatement: NetworkMetadataCacheStatement | undefined;
      let snapshotStatementConnection: NetworkMetadataCacheDatabase | undefined;
      const primaryPrepared = (): NetworkMetadataCacheStatement => {
        primaryStatement ??= primary.prepare(sql);
        return primaryStatement;
      };
      const selected = (): NetworkMetadataCacheStatement => {
        if (
          allowSnapshotReads
          && snapshotEligible
          && forcePrimaryDepth === 0
          && readConnection !== undefined
        ) {
          if (snapshotStatementConnection !== readConnection) {
            snapshotStatement = readConnection.prepare(sql);
            snapshotStatementConnection = readConnection;
          }
          return snapshotStatement!;
        }
        return primaryPrepared();
      };
      return {
        all: (...parameters) => selected().all(...parameters),
        get: (...parameters) => selected().get(...parameters),
        run: (...parameters) => {
          // A SELECT.run is not a useful better-sqlite3 operation, but if a
          // caller reaches it, preserve the primary truth-source semantics.
          invalidate();
          options.onPrimaryMutation?.();
          return primaryPrepared().run(...parameters);
        },
      };
    },
    transaction: <T>(operation: () => T): NetworkMetadataCacheTransaction<T> => {
      const run = (immediate: boolean): T => {
        invalidate();
        options.onPrimaryMutation?.();
        forcePrimaryDepth += 1;
        try {
          const transaction = primary.transaction(operation);
          return immediate ? transaction.immediate() : transaction();
        } finally {
          forcePrimaryDepth -= 1;
        }
      };
      const transaction = (() => run(false)) as NetworkMetadataCacheTransaction<T>;
      transaction.immediate = () => run(true);
      return transaction;
    },
  };

  return connection;
}
