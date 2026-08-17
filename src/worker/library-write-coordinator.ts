import { randomUUID } from 'node:crypto';

/**
 * Cross-process, per-library write coordination.
 *
 * SQLite is deliberately the lease authority rather than a sidecar lock file:
 * an atomic conditional UPDATE gives us a real compare-and-swap, the lease is
 * visible to every desktop/MCP process that opened the library database, and a
 * process crash is recoverable from the persisted expiry timestamp.  A plain
 * lock file cannot safely distinguish a stale owner from a newly acquired lock
 * after concurrent stale-lock cleanup.
 */

export const DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS = 15_000;
export const DEFAULT_LIBRARY_WRITE_LEASE_TIMEOUT_MS = 5_000;
export const DEFAULT_LIBRARY_WRITE_LEASE_RETRY_INTERVAL_MS = 50;

interface RunResult {
  changes: number;
}

interface Statement {
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): RunResult;
}

export interface LibraryWriteLeaseConnection {
  prepare(sql: string): Statement;
  transaction<T>(operation: () => T): () => T;
}

export class LibraryWriteCoordinatorError extends Error {
  readonly code = 'LIBRARY_BUSY' as const;
  readonly retryable = true;

  constructor(message: string, readonly reason: 'timed-out' | 'lost') {
    super(message);
    this.name = 'LibraryWriteCoordinatorError';
  }
}

export interface LibraryWriteLease {
  readonly ownerId: string;
  readonly expiresAtMs: number;
  bumpChangeSequence(): number;
  assertCurrent(): void;
  startHeartbeat(options?: {
    intervalMs?: number;
    leaseDurationMs?: number;
    onLost?: (error: LibraryWriteCoordinatorError) => void;
  }): LibraryWriteLeaseHeartbeat;
  release(): void;
  renew(leaseDurationMs?: number): void;
}

export interface LibraryWriteLeaseHeartbeat {
  readonly error: LibraryWriteCoordinatorError | undefined;
  stop(): void;
}

export interface LibraryChangeSubscription {
  readonly lastSequence: number;
  stop(): void;
}

export interface LibraryJobLease {
  readonly jobId: string;
  readonly ownerId: string;
  readonly fencingToken: number;
  readonly expiresAtMs: number;
  assertCurrent(): void;
  renew(leaseDurationMs?: number): void;
  startHeartbeat(options?: {
    intervalMs?: number;
    leaseDurationMs?: number;
    onLost?: (error: LibraryWriteCoordinatorError) => void;
  }): LibraryWriteLeaseHeartbeat;
  release(): void;
}

export interface AcquireLibraryWriteLeaseOptions {
  leaseDurationMs?: number;
  retryIntervalMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LibraryWriteCoordinatorOptions {
  newOwnerId?: () => string;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * SQLite may report either code when a different connection owns the writer
 * mutex.  Translate both at the service boundary so a normal cross-process
 * race never leaks a driver-specific failure to Desktop, Script, or MCP.
 */
export function isSQLiteWriteContention(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' &&
    (code === 'SQLITE_BUSY' || code.startsWith('SQLITE_BUSY_') || code === 'SQLITE_LOCKED');
}

interface LeaseRow {
  owner_id: string;
  expires_at_ms: number;
}

interface SequenceRow {
  sequence: number;
}

interface JobLeaseRow {
  owner_id: string;
  fencing_token: number;
  expires_at_ms: number;
}

function defaultOwnerId(): string {
  return `${process.pid}-${randomUUID()}`;
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LibraryWriteCoordinatorError('The write lease acquisition was cancelled.', 'timed-out'));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new LibraryWriteCoordinatorError('The write lease acquisition was cancelled.', 'timed-out'));
    }, { once: true });
  });
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * Each acquired handle owns exactly one `(library_id, owner_id)` lease. Handles
 * cannot release, renew, or advance the sequence after expiry or replacement.
 */
class DatabaseLibraryWriteLease implements LibraryWriteLease {
  private released = false;
  private expiresAt: number;

  constructor(
    private readonly coordinator: LibraryWriteCoordinator,
    readonly ownerId: string,
    expiresAtMs: number,
  ) {
    this.expiresAt = expiresAtMs;
  }

  get expiresAtMs(): number {
    return this.expiresAt;
  }

  renew(leaseDurationMs = DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS): void {
    this.assertActive();
    this.expiresAt = this.coordinator.renew(this.ownerId, leaseDurationMs);
  }

  bumpChangeSequence(): number {
    this.assertActive();
    return this.coordinator.bumpChangeSequence(this.ownerId);
  }

  assertCurrent(): void {
    this.assertActive();
    this.coordinator.assertOwner(this.ownerId);
  }

  startHeartbeat(options: {
    intervalMs?: number;
    leaseDurationMs?: number;
    onLost?: (error: LibraryWriteCoordinatorError) => void;
  } = {}): LibraryWriteLeaseHeartbeat {
    this.assertActive();
    const leaseDurationMs = positiveInteger(
      options.leaseDurationMs ?? DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS,
      DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS,
    );
    const intervalMs = positiveInteger(
      options.intervalMs ?? Math.max(1, Math.floor(leaseDurationMs / 3)),
      Math.max(1, Math.floor(leaseDurationMs / 3)),
    );
    let stopped = false;
    let error: LibraryWriteCoordinatorError | undefined;
    const timer = setInterval(() => {
      if (stopped) return;
      try {
        this.renew(leaseDurationMs);
      } catch (caught) {
        error = caught instanceof LibraryWriteCoordinatorError
          ? caught
          : new LibraryWriteCoordinatorError('The write lease heartbeat was lost.', 'lost');
        stopped = true;
        clearInterval(timer);
        options.onLost?.(error);
      }
    }, intervalMs);
    timer.unref?.();
    return {
      get error(): LibraryWriteCoordinatorError | undefined {
        return error;
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
      },
    };
  }

  release(): void {
    if (this.released) return;
    this.coordinator.release(this.ownerId);
    this.released = true;
  }

  private assertActive(): void {
    if (this.released) {
      throw new LibraryWriteCoordinatorError('The write lease is no longer held.', 'lost');
    }
  }
}

class DatabaseLibraryJobLease implements LibraryJobLease {
  private released = false;
  private expiresAt: number;

  constructor(
    private readonly coordinator: LibraryWriteCoordinator,
    readonly jobId: string,
    readonly ownerId: string,
    readonly fencingToken: number,
    expiresAtMs: number,
  ) {
    this.expiresAt = expiresAtMs;
  }

  get expiresAtMs(): number {
    return this.expiresAt;
  }

  renew(leaseDurationMs = DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS): void {
    this.assertActive();
    this.expiresAt = this.coordinator.renewJobLease(
      this.jobId,
      this.ownerId,
      this.fencingToken,
      leaseDurationMs,
    );
  }

  assertCurrent(): void {
    this.assertActive();
    this.coordinator.assertJobOwner(this.jobId, this.ownerId, this.fencingToken);
  }

  startHeartbeat(options: {
    intervalMs?: number;
    leaseDurationMs?: number;
    onLost?: (error: LibraryWriteCoordinatorError) => void;
  } = {}): LibraryWriteLeaseHeartbeat {
    this.assertActive();
    const leaseDurationMs = positiveInteger(
      options.leaseDurationMs ?? DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS,
      DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS,
    );
    const intervalMs = positiveInteger(
      options.intervalMs ?? Math.max(1, Math.floor(leaseDurationMs / 3)),
      Math.max(1, Math.floor(leaseDurationMs / 3)),
    );
    let stopped = false;
    let error: LibraryWriteCoordinatorError | undefined;
    const timer = setInterval(() => {
      if (stopped) return;
      try {
        this.renew(leaseDurationMs);
      } catch (caught) {
        error = caught instanceof LibraryWriteCoordinatorError
          ? caught
          : new LibraryWriteCoordinatorError('The Job lease heartbeat was lost.', 'lost');
        stopped = true;
        clearInterval(timer);
        options.onLost?.(error);
      }
    }, intervalMs);
    timer.unref?.();
    return {
      get error(): LibraryWriteCoordinatorError | undefined {
        return error;
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
      },
    };
  }

  release(): void {
    if (this.released) return;
    this.coordinator.releaseJobLease(this.jobId, this.ownerId, this.fencingToken);
    this.released = true;
  }

  private assertActive(): void {
    if (this.released) {
      throw new LibraryWriteCoordinatorError('The Job lease is no longer held.', 'lost');
    }
  }
}

export class LibraryWriteCoordinator {
  private readonly now: () => number;
  private readonly newOwnerId: () => string;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    private readonly connection: LibraryWriteLeaseConnection,
    private readonly libraryId: string,
    options: LibraryWriteCoordinatorOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.newOwnerId = options.newOwnerId ?? defaultOwnerId;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async acquire(options: AcquireLibraryWriteLeaseOptions = {}): Promise<LibraryWriteLease> {
    const leaseDurationMs = positiveInteger(
      options.leaseDurationMs ?? DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS,
      DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS,
    );
    const timeoutMs = options.timeoutMs !== undefined &&
      Number.isSafeInteger(options.timeoutMs) && options.timeoutMs >= 0
      ? options.timeoutMs
      : DEFAULT_LIBRARY_WRITE_LEASE_TIMEOUT_MS;
    const retryIntervalMs = positiveInteger(
      options.retryIntervalMs ?? DEFAULT_LIBRARY_WRITE_LEASE_RETRY_INTERVAL_MS,
      DEFAULT_LIBRARY_WRITE_LEASE_RETRY_INTERVAL_MS,
    );
    const ownerId = this.newOwnerId();
    const deadline = this.now() + timeoutMs;

    for (;;) {
      if (options.signal?.aborted) {
        throw new LibraryWriteCoordinatorError('The write lease acquisition was cancelled.', 'timed-out');
      }
      const acquiredAt = this.now();
      const expiresAt = acquiredAt + leaseDurationMs;
      if (this.tryAcquire(ownerId, acquiredAt, expiresAt)) {
        return new DatabaseLibraryWriteLease(this, ownerId, expiresAt);
      }
      if (this.now() >= deadline) {
        throw new LibraryWriteCoordinatorError('Another Serpent session is updating this library.', 'timed-out');
      }
      await this.sleep(Math.min(retryIntervalMs, Math.max(1, deadline - this.now())), options.signal);
    }
  }

  async claimJob(
    jobId: string,
    options: AcquireLibraryWriteLeaseOptions = {},
  ): Promise<LibraryJobLease> {
    if (jobId.trim() === '') throw new TypeError('A Job ID is required.');
    const leaseDurationMs = positiveInteger(
      options.leaseDurationMs ?? DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS,
      DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS,
    );
    const timeoutMs = options.timeoutMs !== undefined &&
      Number.isSafeInteger(options.timeoutMs) && options.timeoutMs >= 0
      ? options.timeoutMs
      : DEFAULT_LIBRARY_WRITE_LEASE_TIMEOUT_MS;
    const retryIntervalMs = positiveInteger(
      options.retryIntervalMs ?? DEFAULT_LIBRARY_WRITE_LEASE_RETRY_INTERVAL_MS,
      DEFAULT_LIBRARY_WRITE_LEASE_RETRY_INTERVAL_MS,
    );
    const ownerId = this.newOwnerId();
    const deadline = this.now() + timeoutMs;

    for (;;) {
      if (options.signal?.aborted) {
        throw new LibraryWriteCoordinatorError('The Job lease claim was cancelled.', 'timed-out');
      }
      const acquiredAt = this.now();
      const expiresAt = acquiredAt + leaseDurationMs;
      const fencingToken = this.tryClaimJob(jobId, ownerId, acquiredAt, expiresAt);
      if (fencingToken !== undefined) {
        return new DatabaseLibraryJobLease(this, jobId, ownerId, fencingToken, expiresAt);
      }
      if (this.now() >= deadline) {
        throw new LibraryWriteCoordinatorError('Another worker owns this Job.', 'timed-out');
      }
      await this.sleep(Math.min(retryIntervalMs, Math.max(1, deadline - this.now())), options.signal);
    }
  }

  /**
   * Single-shot Job claim for synchronous apply paths (import applying).
   * Does not wait or retry; callers that need timeout polling use `claimJob`.
   */
  claimJobOnce(
    jobId: string,
    options: { leaseDurationMs?: number } = {},
  ): LibraryJobLease {
    if (jobId.trim() === '') throw new TypeError('A Job ID is required.');
    const leaseDurationMs = positiveInteger(
      options.leaseDurationMs ?? DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS,
      DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS,
    );
    const ownerId = this.newOwnerId();
    const acquiredAt = this.now();
    const expiresAt = acquiredAt + leaseDurationMs;
    const fencingToken = this.tryClaimJob(jobId, ownerId, acquiredAt, expiresAt);
    if (fencingToken === undefined) {
      throw new LibraryWriteCoordinatorError('Another worker owns this Job.', 'timed-out');
    }
    return new DatabaseLibraryJobLease(this, jobId, ownerId, fencingToken, expiresAt);
  }

  /** True when another process still holds a non-expired Job lease for `jobId`. */
  hasLiveJobLease(jobId: string): boolean {
    if (jobId.trim() === '') throw new TypeError('A Job ID is required.');
    const row = this.connection.prepare(
      `SELECT 1 AS present
         FROM library_job_leases
        WHERE library_id = ? AND job_id = ? AND expires_at_ms > ?`,
    ).get(this.libraryId, jobId, this.now()) as { present: number } | undefined;
    return row !== undefined;
  }

  currentChangeSequence(): number {
    const row = this.connection.prepare(
      'SELECT sequence FROM library_change_sequence WHERE library_id = ?',
    ).get(this.libraryId) as SequenceRow | undefined;
    if (!row || !Number.isSafeInteger(row.sequence) || row.sequence < 0) {
      throw new Error('The library change sequence is missing or invalid.');
    }
    return row.sequence;
  }

  subscribeToChangeSequence(options: {
    intervalMs?: number;
    onChange: (sequence: number) => void;
  }): LibraryChangeSubscription {
    const intervalMs = positiveInteger(options.intervalMs ?? 250, 250);
    let lastSequence = this.currentChangeSequence();
    let stopped = false;
    const timer = setInterval(() => {
      if (stopped) return;
      let sequence: number;
      try {
        sequence = this.currentChangeSequence();
      } catch {
        // A test or crash-recovery path may close the SQLite connection before
        // the owner has a chance to stop its polling subscription.
        stopped = true;
        clearInterval(timer);
        return;
      }
      if (sequence === lastSequence) return;
      lastSequence = sequence;
      options.onChange(sequence);
    }, intervalMs);
    timer.unref?.();
    return {
      get lastSequence(): number {
        return lastSequence;
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
      },
    };
  }

  renew(ownerId: string, leaseDurationMs = DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS): number {
    const duration = positiveInteger(leaseDurationMs, DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS);
    const now = this.now();
    const expiresAt = now + duration;
    const changed = this.connection.prepare(
      `UPDATE library_write_leases
          SET expires_at_ms = ?
        WHERE library_id = ? AND owner_id = ? AND expires_at_ms > ?`,
    ).run(expiresAt, this.libraryId, ownerId, now).changes;
    if (changed !== 1) throw new LibraryWriteCoordinatorError('The write lease was replaced or expired.', 'lost');
    return expiresAt;
  }

  renewJobLease(
    jobId: string,
    ownerId: string,
    fencingToken: number,
    leaseDurationMs = DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS,
  ): number {
    const duration = positiveInteger(leaseDurationMs, DEFAULT_LIBRARY_WRITE_LEASE_DURATION_MS);
    const now = this.now();
    const expiresAt = now + duration;
    const changed = this.connection.prepare(
      `UPDATE library_job_leases
          SET expires_at_ms = ?
        WHERE library_id = ? AND job_id = ? AND owner_id = ?
          AND fencing_token = ? AND expires_at_ms > ?`,
    ).run(expiresAt, this.libraryId, jobId, ownerId, fencingToken, now).changes;
    if (changed !== 1) throw new LibraryWriteCoordinatorError('The Job lease was replaced or expired.', 'lost');
    return expiresAt;
  }

  bumpChangeSequence(ownerId: string): number {
    return this.connection.transaction(() => {
      this.assertOwner(ownerId);
      const changed = this.connection.prepare(
        `UPDATE library_change_sequence
            SET sequence = sequence + 1
          WHERE library_id = ?`,
      ).run(this.libraryId).changes;
      if (changed !== 1) throw new Error('The library change sequence is missing.');
      return this.currentChangeSequence();
    })();
  }

  release(ownerId: string): void {
    this.connection.prepare(
      'DELETE FROM library_write_leases WHERE library_id = ? AND owner_id = ?',
    ).run(this.libraryId, ownerId);
  }

  releaseJobLease(jobId: string, ownerId: string, fencingToken: number): void {
    this.connection.prepare(
      `DELETE FROM library_job_leases
        WHERE library_id = ? AND job_id = ? AND owner_id = ? AND fencing_token = ?`,
    ).run(this.libraryId, jobId, ownerId, fencingToken);
  }

  private tryAcquire(ownerId: string, acquiredAt: number, expiresAt: number): boolean {
    try {
      return this.connection.transaction(() => {
        const changed = this.connection.prepare(
          `INSERT INTO library_write_leases
             (library_id, owner_id, acquired_at_ms, expires_at_ms)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(library_id) DO UPDATE SET
             owner_id = excluded.owner_id,
             acquired_at_ms = excluded.acquired_at_ms,
             expires_at_ms = excluded.expires_at_ms
           WHERE library_write_leases.expires_at_ms <= excluded.acquired_at_ms`,
        ).run(this.libraryId, ownerId, acquiredAt, expiresAt).changes;
        return changed === 1;
      })();
    } catch (error) {
      // A concurrent `BEGIN IMMEDIATE` operation holds SQLite's real writer
      // lock. Treat it like an occupied lease so callers get the stable public
      // retry path rather than a driver-specific SQLITE_BUSY detail.
      if (isSQLiteWriteContention(error)) {
        return false;
      }
      throw error;
    }
  }

  private tryClaimJob(
    jobId: string,
    ownerId: string,
    acquiredAt: number,
    expiresAt: number,
  ): number | undefined {
    try {
      return this.connection.transaction(() => {
        const current = this.connection.prepare(
          `SELECT fencing_token FROM library_job_leases
            WHERE library_id = ? AND job_id = ?`,
        ).get(this.libraryId, jobId) as { fencing_token: number } | undefined;
        const nextToken = (current?.fencing_token ?? 0) + 1;
        const changed = this.connection.prepare(
          `INSERT INTO library_job_leases
             (library_id, job_id, owner_id, fencing_token, acquired_at_ms, expires_at_ms)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(library_id, job_id) DO UPDATE SET
             owner_id = excluded.owner_id,
             fencing_token = excluded.fencing_token,
             acquired_at_ms = excluded.acquired_at_ms,
             expires_at_ms = excluded.expires_at_ms
           WHERE library_job_leases.expires_at_ms <= excluded.acquired_at_ms`,
        ).run(
          this.libraryId,
          jobId,
          ownerId,
          nextToken,
          acquiredAt,
          expiresAt,
        ).changes;
        return changed === 1 ? nextToken : undefined;
      })();
    } catch (error) {
      if (isSQLiteWriteContention(error)) return undefined;
      throw error;
    }
  }

  assertOwner(ownerId: string): void {
    const row = this.connection.prepare(
      `SELECT owner_id, expires_at_ms
         FROM library_write_leases
        WHERE library_id = ?`,
    ).get(this.libraryId) as LeaseRow | undefined;
    if (!row || row.owner_id !== ownerId || row.expires_at_ms <= this.now()) {
      throw new LibraryWriteCoordinatorError('The write lease was replaced or expired.', 'lost');
    }
  }

  assertJobOwner(jobId: string, ownerId: string, fencingToken: number): void {
    const row = this.connection.prepare(
      `SELECT owner_id, fencing_token, expires_at_ms
         FROM library_job_leases
        WHERE library_id = ? AND job_id = ?`,
    ).get(this.libraryId, jobId) as JobLeaseRow | undefined;
    if (
      !row
      || row.owner_id !== ownerId
      || row.fencing_token !== fencingToken
      || row.expires_at_ms <= this.now()
    ) {
      throw new LibraryWriteCoordinatorError('The Job lease was replaced or expired.', 'lost');
    }
  }
}
