import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rm, statfs } from 'node:fs/promises';
import path from 'node:path';

export const SEGMENTED_MEDIA_MAX_BYTES = 500 * 1024 * 1024;
export const SEGMENTED_MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;
const SESSION_PREFIX = 'serpent-ext-segmented-';
const SESSION_IDLE_TTL_MS = 12 * 60 * 60 * 1000;
const TERMINAL_TTL_MS = 24 * 60 * 60 * 1000;

export type SegmentedMediaProtocol = 'hls-ts' | 'hls-fmp4' | 'dash-fmp4';
export type SegmentedMediaPartRole = 'init' | 'media';

export interface SegmentedMediaTrackInput {
  kind: 'video' | 'audio';
  segments: Array<{
    id: string;
    role: SegmentedMediaPartRole;
    durationMs?: number;
    discontinuityBefore?: boolean;
  }>;
}

export interface CreateSegmentedMediaSessionInput {
  requestId: string;
  filename: string;
  sourcePageUrl: string;
  mediaUrl: string;
  protocol: SegmentedMediaProtocol;
  tracks: SegmentedMediaTrackInput[];
  targetFolderId?: string | null;
  targetCollectionId?: string;
  expectedLibraryId?: string;
  focusAppAfterSave?: boolean;
  revealInLibrary?: boolean;
}

export interface FrozenSegmentedMediaTarget {
  libraryId: string;
  targetFolderId?: string;
  targetCollectionId?: string;
  targetWindowId?: number | null;
}

export interface SegmentedMediaCommitInput {
  sessionId: string;
  requestId: string;
  stagingDirectory: string;
  filename: string;
  sourcePageUrl: string;
  mediaUrl: string;
  protocol: SegmentedMediaProtocol;
  tracks: Array<{
    kind: 'video' | 'audio';
    segments: Array<{
      id: string;
      role: SegmentedMediaPartRole;
      byteLength: number;
      sha256: string;
      durationMs?: number;
      discontinuityBefore?: boolean;
    }>;
  }>;
  totalBytes: number;
  target: FrozenSegmentedMediaTarget;
  focusAppAfterSave: boolean;
  revealInLibrary: boolean;
}

export type SegmentedMediaSessionState = 'uploading' | 'committing' | 'complete' | 'failed' | 'cancelled';
export type SegmentedMediaFailureKind = 'source-invalid' | 'import-failed';

export class SegmentedSourceValidationError extends Error {
  readonly code = 'SEGMENTED_SOURCE_VALIDATION';

  constructor(message: string) {
    super(message);
    this.name = 'SegmentedSourceValidationError';
  }
}

export interface SegmentedMediaSessionSnapshot {
  sessionId: string;
  libraryId: string;
  targetFolderId?: string;
  targetCollectionId?: string;
  status: SegmentedMediaSessionState;
  cleanupFailed: boolean;
  duplicate?: true;
  failureKind?: SegmentedMediaFailureKind;
  receivedBytes: number;
  maxAssetBytes: number;
  chunkBytes: number;
  segments: Array<{ id: string; receivedBytes: number; complete: boolean }>;
  reason?: string;
}

interface ManagedPart {
  readonly id: string;
  readonly role: SegmentedMediaPartRole;
  readonly durationMs?: number;
  readonly discontinuityBefore?: boolean;
  readonly filePath: string;
  readonly chunkHashes: Map<number, { length: number; sha256: string; final: boolean }>;
  receivedBytes: number;
  sha256?: string;
  complete: boolean;
  lock: Promise<void>;
}

interface ManagedTrack {
  readonly kind: 'video' | 'audio';
  readonly segments: ManagedPart[];
}

interface ManagedSession {
  readonly id: string;
  readonly requestId: string;
  readonly requestFingerprint: string;
  readonly token: string;
  readonly ownerOrigin: string | undefined;
  readonly directory: string;
  readonly filename: string;
  readonly sourcePageUrl: string;
  readonly mediaUrl: string;
  readonly protocol: SegmentedMediaProtocol;
  readonly tracks: ManagedTrack[];
  readonly target: FrozenSegmentedMediaTarget;
  readonly focusAppAfterSave: boolean;
  readonly revealInLibrary: boolean;
  readonly createdAt: number;
  lastActivityAt: number;
  status: SegmentedMediaSessionState;
  receivedBytes: number;
  cancelRequested: boolean;
  importCommitted: boolean;
  cleanupFailed: boolean;
  duplicate?: true;
  failureKind?: SegmentedMediaFailureKind;
  writeLock: Promise<void>;
  reason?: string;
  commitPromise?: Promise<void>;
}

function completedDuplicateDisposition(
  session: Pick<ManagedSession, 'status' | 'duplicate'>,
): { duplicate?: true } {
  return session.status === 'complete' && session.duplicate ? { duplicate: true } : {};
}

export interface SegmentedMediaTransferHooks {
  resolveTarget(input: CreateSegmentedMediaSessionInput): Promise<FrozenSegmentedMediaTarget | undefined>;
  commit(input: SegmentedMediaCommitInput): Promise<void | { duplicate?: true }>;
  cancelCommit?(sessionId: string, target: FrozenSegmentedMediaTarget): Promise<void>;
}

export interface SegmentedMediaTransferTestPolicy {
  maxAssetBytes?: number;
  chunkBytes?: number;
  removePath?: typeof rm;
}

export type SegmentedMediaSessionCreateResult =
  | { ok: true; sessionId: string; token: string; chunkBytes: number; maxAssetBytes: number }
  | { ok: false; status: number; reason: string };

export type SegmentedMediaOperationResult =
  | { ok: true; duplicate?: true }
  | { ok: false; status: number; reason: string };

export class SegmentedMediaTransferManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly sessionsByRequestId = new Map<string, ManagedSession>();
  private readonly createLocks = new Map<string, Promise<void>>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;
  readonly maxAssetBytes: number;
  readonly chunkBytes: number;
  private readonly removePath: typeof rm;
  private rootDirectory: string | undefined;
  private disposed = false;

  constructor(
    private readonly stagingRoot: string,
    private readonly hooks: SegmentedMediaTransferHooks,
    private readonly now: () => number = Date.now,
    policy: SegmentedMediaTransferTestPolicy = {},
  ) {
    this.maxAssetBytes = policy.maxAssetBytes ?? SEGMENTED_MEDIA_MAX_BYTES;
    this.chunkBytes = policy.chunkBytes ?? SEGMENTED_MEDIA_CHUNK_BYTES;
    this.removePath = policy.removePath ?? rm;
    this.cleanupTimer = setInterval(() => void this.pruneExpired(), 5 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  async initialize(): Promise<void> {
    const root = path.resolve(this.stagingRoot);
    await mkdir(root, { recursive: true });
    this.rootDirectory = await realpath(root);
    for (const entry of await readdir(this.rootDirectory, { withFileTypes: true })) {
      if (!entry.name.startsWith(SESSION_PREFIX)) continue;
      const target = path.join(this.rootDirectory, entry.name);
      try {
        const info = await lstat(target);
        if (info.isSymbolicLink()) await this.removePath(target, { force: true });
        else await this.removePath(target, { recursive: true, force: true });
      } catch {
        // Startup recovery only touches this feature's own managed prefix.
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    clearInterval(this.cleanupTimer);
    for (const session of this.sessions.values()) {
      if (session.status === 'uploading') {
        session.cancelRequested = true;
        await Promise.all(session.tracks.flatMap((track) => track.segments).map((part) =>
          this.withPartLock(part, async () => undefined),
        ));
      } else if (session.status === 'committing') {
        if (!session.importCommitted) {
          session.cancelRequested = true;
          try { await this.hooks.cancelCommit?.(session.id, session.target); } catch { /* Continue shutdown cleanup. */ }
        }
        try { await session.commitPromise; } catch { /* The commit completion path records its failure. */ }
      }
      if (session.status !== 'complete' || session.cleanupFailed) {
        try {
          await this.removePath(session.directory, { recursive: true, force: true });
          session.cleanupFailed = false;
          if (session.importCommitted) session.reason = undefined;
          if (session.status === 'uploading') session.status = 'cancelled';
        } catch (error) {
          session.cleanupFailed = true;
          if (!session.importCommitted) session.status = 'failed';
          session.reason = `transfer cleanup failed: ${safeFailureReason(error)}`;
        }
      }
    }
  }

  async create(
    input: CreateSegmentedMediaSessionInput,
    ownerOrigin: string | undefined,
  ): Promise<SegmentedMediaSessionCreateResult> {
    const previous = this.createLocks.get(input.requestId);
    let release!: () => void;
    const lock = new Promise<void>((resolve) => { release = resolve; });
    this.createLocks.set(input.requestId, lock);
    await previous;
    try {
      return await this.createExclusive(input, ownerOrigin);
    } finally {
      release();
      if (this.createLocks.get(input.requestId) === lock) this.createLocks.delete(input.requestId);
    }
  }

  private async createExclusive(
    input: CreateSegmentedMediaSessionInput,
    ownerOrigin: string | undefined,
  ): Promise<SegmentedMediaSessionCreateResult> {
    if (this.disposed || !this.rootDirectory) {
      return { ok: false, status: 503, reason: 'segmented transfer unavailable' };
    }
    const validation = validateCreateInput(input);
    if (validation) return { ok: false, status: 400, reason: validation };
    const fingerprint = JSON.stringify(input);
    const existing = this.sessionsByRequestId.get(input.requestId);
    if (existing) {
      if (existing.ownerOrigin !== ownerOrigin || existing.requestFingerprint !== fingerprint) {
        return { ok: false, status: 409, reason: 'request id is already in use' };
      }
      if (existing.status === 'failed' || existing.status === 'cancelled') {
        return { ok: false, status: 409, reason: 'request already ended' };
      }
      existing.lastActivityAt = this.now();
      return {
        ok: true,
        sessionId: existing.id,
        token: existing.token,
        chunkBytes: this.chunkBytes,
        maxAssetBytes: this.maxAssetBytes,
      };
    }

    let target: FrozenSegmentedMediaTarget | undefined;
    try {
      target = await this.hooks.resolveTarget(input);
    } catch {
      return { ok: false, status: 503, reason: 'unable to resolve save destination' };
    }
    if (!target) return { ok: false, status: 503, reason: 'no active library' };
    if (input.expectedLibraryId !== undefined && target.libraryId !== input.expectedLibraryId) {
      return { ok: false, status: 409, reason: 'the original library is no longer active' };
    }

    const freeBytes = await availableBytes(this.rootDirectory);
    // Keep headroom for the merged output while the source parts still exist.
    if (freeBytes !== undefined && freeBytes < 128 * 1024 * 1024) {
      return { ok: false, status: 507, reason: 'insufficient temporary disk space' };
    }

    const id = randomUUID();
    const directory = path.join(this.rootDirectory, `${SESSION_PREFIX}${id}`);
    try {
      await mkdir(directory, { recursive: false, mode: 0o700 });
      const expectedParent = this.rootDirectory;
      const actualParent = await realpath(path.dirname(directory));
      if (!sameCanonicalPath(actualParent, expectedParent)) throw new Error('invalid staging root');
    } catch {
      await this.removePath(directory, { recursive: true, force: true }).catch(() => undefined);
      return { ok: false, status: 507, reason: 'unable to allocate transfer storage' };
    }

    const session: ManagedSession = {
      id,
      requestId: input.requestId,
      requestFingerprint: fingerprint,
      token: randomBytes(32).toString('base64url'),
      ownerOrigin,
      directory,
      filename: safeFilename(input.filename),
      sourcePageUrl: sanitizeStoredUrl(input.sourcePageUrl),
      mediaUrl: sanitizeStoredUrl(input.mediaUrl),
      protocol: input.protocol,
      tracks: input.tracks.map((track) => ({
        kind: track.kind,
        segments: track.segments.map((part) => ({
          id: part.id,
          role: part.role,
          ...(part.durationMs === undefined ? {} : { durationMs: part.durationMs }),
          ...(part.discontinuityBefore === undefined ? {} : { discontinuityBefore: part.discontinuityBefore }),
          filePath: path.join(directory, `${part.id}.${input.protocol === 'hls-ts' ? 'ts' : 'm4s'}`),
          chunkHashes: new Map(),
          receivedBytes: 0,
          complete: false,
          lock: Promise.resolve(),
        })),
      })),
      target: { ...target },
      focusAppAfterSave: input.focusAppAfterSave ?? true,
      revealInLibrary: input.revealInLibrary ?? true,
      createdAt: this.now(),
      lastActivityAt: this.now(),
      status: 'uploading',
      receivedBytes: 0,
      cancelRequested: false,
      importCommitted: false,
      cleanupFailed: false,
      writeLock: Promise.resolve(),
    };
    this.sessions.set(id, session);
    this.sessionsByRequestId.set(input.requestId, session);
    return {
      ok: true,
      sessionId: id,
      token: session.token,
      chunkBytes: this.chunkBytes,
      maxAssetBytes: this.maxAssetBytes,
    };
  }

  authorize(sessionId: string, token: string | undefined, origin: string | undefined): boolean {
    const session = this.sessions.get(sessionId);
    return Boolean(
      session
      && token
      && timingSafeTokenEqual(session.token, token)
      && session.ownerOrigin === origin,
    );
  }

  snapshot(sessionId: string, token: string | undefined, origin: string | undefined):
    | SegmentedMediaSessionSnapshot
    | undefined {
    if (!this.authorize(sessionId, token, origin)) return undefined;
    const session = this.sessions.get(sessionId)!;
    session.lastActivityAt = this.now();
    return this.toSnapshot(session);
  }

  async uploadChunk(input: {
    sessionId: string;
    token: string | undefined;
    origin: string | undefined;
    segmentId: string;
    offset: number;
    final: boolean;
    bytes: Uint8Array;
  }): Promise<SegmentedMediaOperationResult> {
    const session = this.authorizedSession(input.sessionId, input.token, input.origin);
    if (!session) return { ok: false, status: 404, reason: 'session not found' };
    if (session.status !== 'uploading' || session.cancelRequested) return { ok: false, status: 409, reason: 'session is not accepting segments' };
    if (!Number.isSafeInteger(input.offset) || input.offset < 0) {
      return { ok: false, status: 400, reason: 'invalid segment offset' };
    }
    if (input.bytes.byteLength > this.chunkBytes || input.bytes.byteLength === 0) {
      return { ok: false, status: 413, reason: 'invalid segment chunk size' };
    }
    const part = findPart(session, input.segmentId);
    if (!part) return { ok: false, status: 404, reason: 'segment not found' };

    return this.withSessionWriteLock(session, () => this.withPartLock(part, async () => {
      if (session.status !== 'uploading' || session.cancelRequested) return { ok: false, status: 409, reason: 'session is not accepting segments' };
      const chunkHash = sha256(input.bytes);
      const priorChunk = part.chunkHashes.get(input.offset);
      if (priorChunk) {
        return priorChunk.length === input.bytes.byteLength
          && priorChunk.sha256 === chunkHash
          && priorChunk.final === input.final
          ? { ok: true }
          : { ok: false, status: 409, reason: 'segment retry does not match stored bytes' };
      }
      if (part.complete || input.offset !== part.receivedBytes) {
        return { ok: false, status: 409, reason: 'unexpected segment offset' };
      }
      if (session.receivedBytes + input.bytes.byteLength > this.maxAssetBytes) {
        return { ok: false, status: 413, reason: `asset exceeds ${formatBytes(this.maxAssetBytes)} limit` };
      }
      if (input.final && part.receivedBytes + input.bytes.byteLength === 0) {
        return { ok: false, status: 400, reason: 'empty segment' };
      }

      const freeBytes = await availableBytes(session.directory);
      const projectedAssetBytes = Math.min(this.maxAssetBytes, session.receivedBytes + input.bytes.byteLength);
      const projectedOutputBytes = Math.min(this.maxAssetBytes, projectedAssetBytes + 32 * 1024 * 1024);
      const requiredFreeBytes = input.bytes.byteLength + projectedOutputBytes + 32 * 1024 * 1024;
      if (freeBytes !== undefined && freeBytes < requiredFreeBytes) {
        return { ok: false, status: 507, reason: 'insufficient temporary disk space' };
      }
      let handle;
      try {
        handle = await open(part.filePath, part.receivedBytes === 0 ? 'wx' : 'r+');
      } catch {
        if (part.receivedBytes !== 0) return { ok: false, status: 500, reason: 'segment storage unavailable' };
        try {
          handle = await open(part.filePath, 'r+');
        } catch {
          return { ok: false, status: 500, reason: 'segment storage unavailable' };
        }
      }
      try {
        const existing = await handle.stat();
        if (!existing.isFile() || existing.size !== part.receivedBytes) {
          return { ok: false, status: 409, reason: 'segment storage state is invalid' };
        }
        let written = 0;
        while (written < input.bytes.byteLength) {
          const result = await handle.write(
            input.bytes,
            written,
            input.bytes.byteLength - written,
            input.offset + written,
          );
          if (result.bytesWritten <= 0) throw new Error('short write');
          written += result.bytesWritten;
        }
        await handle.sync();
      } catch {
        await handle.truncate(input.offset).catch(() => undefined);
        return { ok: false, status: 507, reason: 'unable to write segment data' };
      } finally {
        await handle.close().catch(() => undefined);
      }
      part.receivedBytes += input.bytes.byteLength;
      session.receivedBytes += input.bytes.byteLength;
      session.lastActivityAt = this.now();
      part.chunkHashes.set(input.offset, {
        length: input.bytes.byteLength,
        sha256: chunkHash,
        final: input.final,
      });
      if (input.final) {
        part.sha256 = await hashFile(part.filePath);
        part.complete = true;
      }
      return { ok: true };
    }));
  }

  async commit(
    sessionId: string,
    token: string | undefined,
    origin: string | undefined,
  ): Promise<SegmentedMediaOperationResult> {
    const session = this.authorizedSession(sessionId, token, origin);
    if (!session) return { ok: false, status: 404, reason: 'session not found' };
    if (session.importCommitted || session.status === 'committing') return { ok: true };
    if (session.status !== 'uploading' || session.cancelRequested) return { ok: false, status: 409, reason: 'session already ended' };
    const incomplete = session.tracks.flatMap((track) => track.segments).some((part) => !part.complete);
    if (incomplete) return { ok: false, status: 409, reason: 'one or more segments are incomplete' };

    session.status = 'committing';
    session.lastActivityAt = this.now();
    const commitInput: SegmentedMediaCommitInput = {
      sessionId: session.id,
      requestId: session.requestId,
      stagingDirectory: session.directory,
      filename: session.filename,
      sourcePageUrl: session.sourcePageUrl,
      mediaUrl: session.mediaUrl,
      protocol: session.protocol,
      tracks: session.tracks.map((track) => ({
        kind: track.kind,
        segments: track.segments.map((part) => ({
          id: part.id,
          role: part.role,
          byteLength: part.receivedBytes,
          sha256: part.sha256!,
          ...(part.durationMs === undefined ? {} : { durationMs: part.durationMs }),
          ...(part.discontinuityBefore === undefined ? {} : { discontinuityBefore: part.discontinuityBefore }),
        })),
      })),
      totalBytes: session.receivedBytes,
      target: session.target,
      focusAppAfterSave: session.focusAppAfterSave,
      revealInLibrary: session.revealInLibrary,
    };
    session.commitPromise = this.hooks.commit(commitInput).then(
      async (disposition) => {
        session.importCommitted = true;
        if (disposition?.duplicate) session.duplicate = true;
        session.failureKind = undefined;
        session.reason = undefined;
        try {
          await this.removePath(session.directory, { recursive: true, force: true });
          session.cleanupFailed = false;
          session.status = 'complete';
          session.reason = undefined;
        } catch (error) {
          session.cleanupFailed = true;
          session.status = 'complete';
          session.reason = `transfer cleanup failed: ${safeFailureReason(error)}`;
        }
      },
      async (error: unknown) => {
        let cleanupFailure: unknown;
        try {
          await this.removePath(session.directory, { recursive: true, force: true });
          session.cleanupFailed = false;
        } catch (cleanupError) {
          cleanupFailure = cleanupError;
          session.cleanupFailed = true;
        }
        if (session.cancelRequested && cleanupFailure === undefined) {
          session.status = 'cancelled';
          session.failureKind = undefined;
          session.reason = undefined;
        } else {
          session.status = 'failed';
          session.failureKind = error instanceof SegmentedSourceValidationError
            ? 'source-invalid'
            : 'import-failed';
          session.reason = cleanupFailure === undefined
            ? safeFailureReason(error)
            : `transfer cleanup failed: ${safeFailureReason(cleanupFailure)}`;
        }
      },
    );
    // Avoid an unhandled rejection if the HTTP client disconnects while commit runs.
    void session.commitPromise.catch(() => undefined);
    return { ok: true };
  }

  async cancel(
    sessionId: string,
    token: string | undefined,
    origin: string | undefined,
  ): Promise<SegmentedMediaOperationResult> {
    const session = this.authorizedSession(sessionId, token, origin);
    if (!session) return { ok: false, status: 404, reason: 'session not found' };
    if (session.importCommitted) {
      if (!session.cleanupFailed) return { ok: false, status: 409, reason: 'session already completed' };
      try {
        await this.removePath(session.directory, { recursive: true, force: true });
        session.cleanupFailed = false;
        session.reason = undefined;
        return { ok: true, ...completedDuplicateDisposition(session) };
      } catch (error) {
        session.reason = `transfer cleanup failed: ${safeFailureReason(error)}`;
        return { ok: false, status: 507, reason: session.reason };
      }
    }
    if (session.status === 'complete') return { ok: false, status: 409, reason: 'session already completed' };
    if (session.status === 'cancelled') return { ok: true };
    if (session.status === 'failed') {
      if (!session.cleanupFailed) return { ok: true };
      try {
        await this.removePath(session.directory, { recursive: true, force: true });
        session.cleanupFailed = false;
        session.reason = 'transfer failed; temporary files have been cleaned';
        return { ok: true };
      } catch (error) {
        session.reason = `transfer cleanup failed: ${safeFailureReason(error)}`;
        return { ok: false, status: 507, reason: session.reason };
      }
    }
    session.cancelRequested = true;
    session.lastActivityAt = this.now();
    if (session.commitPromise) {
      try {
        await this.hooks.cancelCommit?.(session.id, session.target);
      } catch {
        // The commit completion callback owns terminal state and directory cleanup.
      }
      await session.commitPromise;
    } else {
      await Promise.all(session.tracks.flatMap((track) => track.segments).map((part) =>
        this.withPartLock(part, async () => undefined),
      ));
      try {
        await this.removePath(session.directory, { recursive: true, force: true });
        session.cleanupFailed = false;
        session.status = 'cancelled';
      } catch (error) {
        session.cleanupFailed = true;
        session.status = 'failed';
        session.reason = `transfer cleanup failed: ${safeFailureReason(error)}`;
      }
    }
    return { ok: true, ...completedDuplicateDisposition(session) };
  }

  private authorizedSession(
    sessionId: string,
    token: string | undefined,
    origin: string | undefined,
  ): ManagedSession | undefined {
    if (!this.authorize(sessionId, token, origin)) return undefined;
    const session = this.sessions.get(sessionId);
    if (session) session.lastActivityAt = this.now();
    return session;
  }

  private toSnapshot(session: ManagedSession): SegmentedMediaSessionSnapshot {
    return {
      sessionId: session.id,
      libraryId: session.target.libraryId,
      ...(session.target.targetFolderId === undefined ? {} : { targetFolderId: session.target.targetFolderId }),
      ...(session.target.targetCollectionId === undefined ? {} : { targetCollectionId: session.target.targetCollectionId }),
      status: session.status,
      cleanupFailed: session.cleanupFailed,
      ...(session.duplicate ? { duplicate: true as const } : {}),
      ...(session.failureKind ? { failureKind: session.failureKind } : {}),
      receivedBytes: session.receivedBytes,
      maxAssetBytes: this.maxAssetBytes,
      chunkBytes: this.chunkBytes,
      segments: session.tracks.flatMap((track) => track.segments.map((part) => ({
        id: part.id,
        receivedBytes: part.receivedBytes,
        complete: part.complete,
      }))),
      ...(session.reason ? { reason: session.reason } : {}),
    };
  }

  private async withPartLock<T>(part: ManagedPart, work: () => Promise<T>): Promise<T> {
    const previous = part.lock;
    let release!: () => void;
    part.lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async withSessionWriteLock<T>(session: ManagedSession, work: () => Promise<T>): Promise<T> {
    const previous = session.writeLock;
    let release!: () => void;
    session.writeLock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await work(); }
    finally { release(); }
  }

  private async pruneExpired(): Promise<void> {
    if (this.disposed) return;
    const now = this.now();
    for (const session of this.sessions.values()) {
      if (session.status === 'committing') continue;
      const ttl = session.status === 'uploading' ? SESSION_IDLE_TTL_MS : TERMINAL_TTL_MS;
      if (now - session.lastActivityAt < ttl) continue;
      if (session.status === 'uploading') {
        session.cancelRequested = true;
        await Promise.all(session.tracks.flatMap((track) => track.segments).map((part) =>
          this.withPartLock(part, async () => undefined),
        ));
      }
      try {
        await this.removePath(session.directory, { recursive: true, force: true });
        session.cleanupFailed = false;
        if (session.status === 'uploading') session.status = 'cancelled';
      } catch (error) {
        session.cleanupFailed = true;
        if (!session.importCommitted) session.status = 'failed';
        session.reason = `transfer cleanup failed: ${safeFailureReason(error)}`;
        session.lastActivityAt = now;
        continue;
      }
      this.sessions.delete(session.id);
      if (this.sessionsByRequestId.get(session.requestId) === session) {
        this.sessionsByRequestId.delete(session.requestId);
      }
    }
  }
}

function validateCreateInput(input: CreateSegmentedMediaSessionInput): string | undefined {
  if (!isUuid(input.requestId)) return 'invalid request id';
  if (input.protocol !== 'hls-ts' && input.protocol !== 'hls-fmp4' && input.protocol !== 'dash-fmp4') return 'unsupported media protocol';
  if (!isHttpUrl(input.sourcePageUrl) || !isHttpUrl(input.mediaUrl)) return 'invalid media URL';
  if (input.tracks.length < 1 || input.tracks.length > 2) return 'invalid track count';
  if (input.tracks.filter((track) => track.kind === 'video').length !== 1) return 'exactly one video track is required';
  if (input.tracks.filter((track) => track.kind === 'audio').length > 1) return 'only one audio track is supported';
  const ids = new Set<string>();
  let totalParts = 0;
  let videoDuration = 0;
  for (const track of input.tracks) {
    if (!Array.isArray(track.segments) || track.segments.length === 0) return 'empty media track';
    totalParts += track.segments.length;
    for (const part of track.segments) {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(part.id) || ids.has(part.id)) return 'invalid segment id';
      ids.add(part.id);
      if (part.role !== 'init' && part.role !== 'media') return 'invalid segment role';
      if (part.role === 'media') {
        if (!Number.isFinite(part.durationMs) || part.durationMs! <= 0 || part.durationMs! > 24 * 60 * 60 * 1000) {
          return 'invalid segment duration';
        }
        if (track.kind === 'video') videoDuration += part.durationMs!;
      } else if (part.durationMs !== undefined) {
        return 'initialization segments cannot declare a duration';
      }
    }
  }
  if (totalParts > 20_000) return 'too many media segments';
  if (videoDuration <= 0 || videoDuration > 24 * 60 * 60 * 1000) return 'invalid video duration';
  for (const track of input.tracks) {
    const initIndices = track.segments.flatMap((part, index) => part.role === 'init' ? [index] : []);
    if (input.protocol === 'hls-ts' && initIndices.length > 0) {
      return 'initialization segment is invalid for transport stream media';
    }
    if (input.protocol !== 'hls-ts' && (initIndices.length !== 1 || initIndices[0] !== 0)) {
      return 'fragmented MP4 tracks require one first initialization segment';
    }
  }
  const filename = safeFilename(input.filename);
  if (!filename || filename.length > 240) return 'invalid filename';
  return undefined;
}

function findPart(session: ManagedSession, id: string): ManagedPart | undefined {
  for (const track of session.tracks) {
    const part = track.segments.find((candidate) => candidate.id === id);
    if (part) return part;
  }
  return undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

const INVALID_FILENAME_CHARACTERS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

function safeFilename(input: string): string {
  const base = Array.from(path.basename(input), (character) => {
    const codePoint = character.codePointAt(0);
    return INVALID_FILENAME_CHARACTERS.has(character) || (codePoint !== undefined && codePoint < 0x20)
      ? '_'
      : character;
  }).join('').trim();
  return base.slice(0, 240) || 'video.mp4';
}

function sanitizeStoredUrl(input: string): string {
  const url = new URL(input);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function safeFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return 'segmented import failed';
  return error.message.replace(/[\r\n\t]/g, ' ').slice(0, 240) || 'segmented import failed';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function formatBytes(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MiB`;
  if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
  return `${bytes} bytes`;
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

async function availableBytes(directory: string): Promise<number | undefined> {
  try {
    const info = await statfs(directory);
    const free = Number(info.bavail) * Number(info.bsize);
    return Number.isFinite(free) && free >= 0 ? free : undefined;
  } catch {
    return undefined;
  }
}

function sameCanonicalPath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left).replace(/\\/gu, '/');
  const normalizedRight = path.resolve(right).replace(/\\/gu, '/');
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function timingSafeTokenEqual(expected: string, supplied: string): boolean {
  if (expected.length !== supplied.length) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return timingSafeEqual(left, right);
}
