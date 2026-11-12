import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createExtensionServer,
  type ExtensionServer,
  type ExtensionServerOptions,
} from '../../src/main/extension-server';
import {
  SEGMENTED_MEDIA_CHUNK_BYTES,
  SEGMENTED_MEDIA_MAX_BYTES,
  SegmentedMediaTransferManager,
  SegmentedSourceValidationError,
  type CreateSegmentedMediaSessionInput,
  type FrozenSegmentedMediaTarget,
  type SegmentedMediaCommitInput,
  type SegmentedMediaTransferTestPolicy,
  type SegmentedMediaTransferHooks,
} from '../../src/main/segmented-media-transfer';

const allowedOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const otherExtensionOrigin = 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const tempPrefix = 'serpent-segmented-media-unit-';
const tempDirectories: string[] = [];
const managers: SegmentedMediaTransferManager[] = [];
const servers: ExtensionServer[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()));
  await Promise.all(servers.splice(0).map(closeExtensionServer));
  for (const directory of tempDirectories.splice(0)) {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith(tempPrefix));
    await rm(resolved, { recursive: true, force: true });
  }
});

async function makeTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), tempPrefix));
  tempDirectories.push(directory);
  return directory;
}

function validSessionInput(
  overrides: Partial<CreateSegmentedMediaSessionInput> = {},
): CreateSegmentedMediaSessionInput {
  return {
    requestId: randomUUID(),
    filename: 'clip.mp4',
    sourcePageUrl: 'https://example.com/post/42',
    mediaUrl: 'https://cdn.example.com/master.m3u8?token=temporary-secret',
    protocol: 'hls-ts',
    tracks: [{
      kind: 'video',
      segments: [{ id: 'video-0', role: 'media', durationMs: 1_000 }],
    }],
    ...overrides,
  };
}

async function makeManager(options: {
  hooks?: Partial<SegmentedMediaTransferHooks>;
  target?: FrozenSegmentedMediaTarget;
  policy?: SegmentedMediaTransferTestPolicy;
} = {}): Promise<{
  manager: SegmentedMediaTransferManager;
  stagingRoot: string;
  committed: SegmentedMediaCommitInput[];
}> {
  const root = await makeTempDirectory();
  const stagingRoot = path.join(root, 'staging');
  const committed: SegmentedMediaCommitInput[] = [];
  const hooks: SegmentedMediaTransferHooks = {
    resolveTarget: async () => ({
      libraryId: 'library-at-session-start',
      targetFolderId: 'folder-at-session-start',
      ...options.target,
    }),
    commit: async (input) => { committed.push(input); },
    ...options.hooks,
  };
  const manager = new SegmentedMediaTransferManager(stagingRoot, hooks, Date.now, options.policy);
  managers.push(manager);
  await manager.initialize();
  return { manager, stagingRoot, committed };
}

async function makeServer(options: {
  segmentedMediaTransferManager?: SegmentedMediaTransferManager;
} = {}): Promise<{ extensionServer: ExtensionServer; origin: string }> {
  const root = await makeTempDirectory();
  const serverOptions: ExtensionServerOptions = {
    // Port 0 asks the OS for an isolated free port; the returned server.address
    // is authoritative because the helper reports the requested start value.
    port: 0,
    uploadStagingRoot: path.join(root, 'uploads'),
    onSaveIntent: () => ({ accepted: true }),
    onSaveUpload: () => ({ accepted: true }),
    onListFolders: () => ({
      ok: true,
      folders: [],
      recentBrowsedFolderIds: [],
      libraryDisplayName: 'Fixture library',
    }),
    onListCollections: () => ({
      ok: true,
      collections: [],
      libraryDisplayName: 'Fixture library',
    }),
    ...options,
  };
  const extensionServer = await createExtensionServer(serverOptions);
  servers.push(extensionServer);
  const address = extensionServer.server.address();
  assert.ok(address && typeof address === 'object' && 'port' in address);
  return {
    extensionServer,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function closeExtensionServer(extensionServer: ExtensionServer): Promise<void> {
  if (!extensionServer.server.listening) return;
  await new Promise<void>((resolve, reject) => {
    extensionServer.server.close((error) => error ? reject(error) : resolve());
  });
}

async function createSession(
  manager: SegmentedMediaTransferManager,
  input = validSessionInput(),
) {
  const result = await manager.create(input, allowedOrigin);
  if (result.ok) return result;
  throw new Error(result.reason);
}

async function waitForStatus(
  manager: SegmentedMediaTransferManager,
  sessionId: string,
  token: string,
  expected: 'uploading' | 'committing' | 'complete' | 'failed' | 'cancelled',
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const snapshot = manager.snapshot(sessionId, token, allowedOrigin);
    if (snapshot?.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(manager.snapshot(sessionId, token, allowedOrigin)?.status, expected);
}

async function managedSessionDirectories(stagingRoot: string): Promise<string[]> {
  try {
    return (await readdir(stagingRoot)).filter((entry) => entry.startsWith('serpent-ext-segmented-'));
  } catch {
    return [];
  }
}

describe('SegmentedMediaTransferManager', () => {
  it('rejects deferred session creation when the frozen library is no longer active', async () => {
    const { manager, stagingRoot } = await makeManager({
      target: { libraryId: 'library-current', targetFolderId: 'folder-current' },
    });
    const result = await manager.create(validSessionInput({ expectedLibraryId: 'library-original' }), allowedOrigin);
    expect(result).toEqual({
      ok: false,
      status: 409,
      reason: 'the original library is no longer active',
    });
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(0);
  });

  it('binds session access to the exact extension origin and bearer token', async () => {
    const { manager, stagingRoot } = await makeManager();
    const session = await createSession(manager);

    expect(manager.snapshot(session.sessionId, session.token, allowedOrigin)?.status).toBe('uploading');
    expect(manager.snapshot(session.sessionId, session.token, otherExtensionOrigin)).toBeUndefined();
    expect(manager.snapshot(session.sessionId, 'wrong-token', allowedOrigin)).toBeUndefined();
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(1);

    expect(await manager.cancel(session.sessionId, session.token, allowedOrigin)).toEqual({ ok: true });
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(0);
  });

  it('rejects oversized or out-of-order chunks and counts exact idempotent retries once', async () => {
    const { manager, stagingRoot } = await makeManager();
    const session = await createSession(manager);
    const oversized = Buffer.alloc(SEGMENTED_MEDIA_CHUNK_BYTES + 1);

    expect(await manager.uploadChunk({
      sessionId: session.sessionId,
      token: session.token,
      origin: allowedOrigin,
      segmentId: 'video-0',
      offset: 0,
      final: true,
      bytes: oversized,
    })).toEqual({ ok: false, status: 413, reason: 'invalid segment chunk size' });
    expect(manager.snapshot(session.sessionId, session.token, allowedOrigin)?.receivedBytes).toBe(0);

    const first = Buffer.from('first');
    const accepted = {
      sessionId: session.sessionId,
      token: session.token,
      origin: allowedOrigin,
      segmentId: 'video-0',
      offset: 0,
      final: false,
      bytes: first,
    };
    expect(await manager.uploadChunk(accepted)).toEqual({ ok: true });
    expect(await manager.uploadChunk(accepted)).toEqual({ ok: true });
    expect(manager.snapshot(session.sessionId, session.token, allowedOrigin)?.receivedBytes).toBe(first.byteLength);
    expect(await manager.uploadChunk({ ...accepted, bytes: Buffer.from('other') })).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await manager.uploadChunk({ ...accepted, offset: first.byteLength + 1 })).toMatchObject({
      ok: false,
      status: 409,
    });

    const last = Buffer.from('last');
    expect(await manager.uploadChunk({
      ...accepted,
      offset: first.byteLength,
      final: true,
      bytes: last,
    })).toEqual({ ok: true });
    expect(manager.snapshot(session.sessionId, session.token, allowedOrigin)?.receivedBytes)
      .toBe(first.byteLength + last.byteLength);
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(1);
  });

  it('enforces the asset cap across all chunks and segments', async () => {
    const { manager } = await makeManager({
      policy: { maxAssetBytes: 8, chunkBytes: 4 },
    });
    const session = await createSession(manager, validSessionInput({
      tracks: [{
        kind: 'video',
        segments: [
          { id: 'video-0', role: 'media', durationMs: 500 },
          { id: 'video-1', role: 'media', durationMs: 500 },
        ],
      }],
    }));

    expect(await manager.uploadChunk({
      sessionId: session.sessionId,
      token: session.token,
      origin: allowedOrigin,
      segmentId: 'video-0',
      offset: 0,
      final: true,
      bytes: Buffer.alloc(4, 1),
    })).toEqual({ ok: true });
    expect(await manager.uploadChunk({
      sessionId: session.sessionId,
      token: session.token,
      origin: allowedOrigin,
      segmentId: 'video-1',
      offset: 0,
      final: false,
      bytes: Buffer.alloc(4, 2),
    })).toEqual({ ok: true });
    expect(await manager.uploadChunk({
      sessionId: session.sessionId,
      token: session.token,
      origin: allowedOrigin,
      segmentId: 'video-1',
      offset: 4,
      final: true,
      bytes: Buffer.from([3]),
    })).toEqual({ ok: false, status: 413, reason: 'asset exceeds 8 bytes limit' });
    expect(manager.snapshot(session.sessionId, session.token, allowedOrigin)).toMatchObject({
      receivedBytes: 8,
      segments: [
        { id: 'video-0', receivedBytes: 4, complete: true },
        { id: 'video-1', receivedBytes: 4, complete: false },
      ],
    });
  });

  it('reserves the asset cap atomically across concurrent segment uploads', async () => {
    const { manager } = await makeManager({
      policy: { maxAssetBytes: 8, chunkBytes: 8 },
    });
    const session = await createSession(manager, validSessionInput({
      tracks: [{
        kind: 'video',
        segments: [
          { id: 'video-0', role: 'media', durationMs: 500 },
          { id: 'video-1', role: 'media', durationMs: 500 },
        ],
      }],
    }));
    const results = await Promise.all(['video-0', 'video-1'].map((segmentId) => manager.uploadChunk({
      sessionId: session.sessionId,
      token: session.token,
      origin: allowedOrigin,
      segmentId,
      offset: 0,
      final: true,
      bytes: Buffer.alloc(5, 7),
    })));

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(manager.snapshot(session.sessionId, session.token, allowedOrigin)?.receivedBytes).toBe(5);
  });

  it('freezes the destination, strips signed query values, and imports once on commit', async () => {
    const committed: SegmentedMediaCommitInput[] = [];
    let currentTarget: FrozenSegmentedMediaTarget = {
      libraryId: 'library-before-switch',
      targetFolderId: 'folder-before-switch',
    };
    const { manager, stagingRoot } = await makeManager({
      target: currentTarget,
      hooks: {
        resolveTarget: async () => ({ ...currentTarget }),
        commit: async (input) => { committed.push(input); },
      },
    });
    const input = validSessionInput();
    const session = await createSession(manager, input);
    expect(manager.snapshot(session.sessionId, session.token, allowedOrigin)).toMatchObject({
      libraryId: 'library-before-switch',
      targetFolderId: 'folder-before-switch',
    });
    currentTarget = {
      libraryId: 'library-after-switch',
      targetFolderId: 'folder-after-switch',
    };
    const bytes = Buffer.from('segment bytes');
    expect(await manager.uploadChunk({
      sessionId: session.sessionId,
      token: session.token,
      origin: allowedOrigin,
      segmentId: 'video-0',
      offset: 0,
      final: true,
      bytes,
    })).toEqual({ ok: true });

    expect(await manager.commit(session.sessionId, session.token, allowedOrigin)).toEqual({ ok: true });
    await waitForStatus(manager, session.sessionId, session.token, 'complete');
    expect(await manager.commit(session.sessionId, session.token, allowedOrigin)).toEqual({ ok: true });
    expect(committed).toHaveLength(1);
    expect(committed[0]?.target).toEqual({
      libraryId: 'library-before-switch',
      targetFolderId: 'folder-before-switch',
    });
    expect(committed[0]?.mediaUrl).toBe('https://cdn.example.com/master.m3u8');
    expect(committed[0]?.totalBytes).toBe(bytes.byteLength);
    expect(committed[0]?.tracks[0]?.segments[0]?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(0);
    expect(SEGMENTED_MEDIA_MAX_BYTES).toBe(500 * 1024 * 1024);
  });

  it('exposes a skipped duplicate in the completed session snapshot', async () => {
    const { manager } = await makeManager({
      hooks: { commit: async () => ({ duplicate: true }) },
    });
    const { origin } = await makeServer({ segmentedMediaTransferManager: manager });
    const session = await createSession(manager);
    expect(await manager.uploadChunk({
      sessionId: session.sessionId,
      token: session.token,
      origin: allowedOrigin,
      segmentId: 'video-0',
      offset: 0,
      final: true,
      bytes: Buffer.from('duplicate video segment'),
    })).toEqual({ ok: true });

    expect(await manager.commit(session.sessionId, session.token, allowedOrigin)).toEqual({ ok: true });
    await waitForStatus(manager, session.sessionId, session.token, 'complete');
    const response = await fetch(`${origin}/media-transfer/sessions/${session.sessionId}`, {
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${session.token}`,
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'complete', duplicate: true });
  });

  it('keeps a committed import complete when cleanup fails and retries cleanup without reimporting', async () => {
    let failNextRemoval = true;
    let commitCalls = 0;
    const { manager, stagingRoot } = await makeManager({
      hooks: { commit: async () => { commitCalls += 1; return { duplicate: true }; } },
      policy: {
        removePath: async (target, options) => {
          if (failNextRemoval) {
            failNextRemoval = false;
            throw new Error('simulated cleanup failure');
          }
          return rm(target, options);
        },
      },
    });
    const { origin } = await makeServer({ segmentedMediaTransferManager: manager });
    const session = await createSession(manager);
    expect(await manager.uploadChunk({
      sessionId: session.sessionId,
      token: session.token,
      origin: allowedOrigin,
      segmentId: 'video-0',
      offset: 0,
      final: true,
      bytes: Buffer.from('complete segment'),
    })).toEqual({ ok: true });

    expect(await manager.commit(session.sessionId, session.token, allowedOrigin)).toEqual({ ok: true });
    await waitForStatus(manager, session.sessionId, session.token, 'complete');
    expect(commitCalls).toBe(1);
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(1);

    const authHeaders = {
      Origin: allowedOrigin,
      Authorization: `Bearer ${session.token}`,
    };
    const getSnapshot = async () => {
      const response = await fetch(`${origin}/media-transfer/sessions/${session.sessionId}`, {
        headers: authHeaders,
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<Record<string, unknown>>;
    };
    expect(await getSnapshot()).toMatchObject({
      status: 'complete',
      cleanupFailed: true,
      duplicate: true,
      reason: 'transfer cleanup failed: simulated cleanup failure',
    });

    const repeatedCommit = await fetch(`${origin}/media-transfer/sessions/${session.sessionId}/commit`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(repeatedCommit.status).toBe(202);
    expect(commitCalls).toBe(1);

    const cleanupRetry = await fetch(`${origin}/media-transfer/sessions/${session.sessionId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(cleanupRetry.status).toBe(200);
    expect(await cleanupRetry.json()).toEqual({
      status: 'ok',
      duplicate: true,
      state: 'complete',
      cleanupFailed: false,
    });
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(0);
    expect(await getSnapshot()).toMatchObject({
      status: 'complete',
      cleanupFailed: false,
    });
    expect(await getSnapshot()).not.toHaveProperty('reason');
    expect(commitCalls).toBe(1);
  });

  it('removes managed files after cancellation and commit failure', async () => {
    const failingHooks: Partial<SegmentedMediaTransferHooks> = {
      commit: async () => { throw new Error('merge failed\nunsafe detail'); },
    };
    const { manager, stagingRoot } = await makeManager({ hooks: failingHooks });
    const cancelled = await createSession(manager);
    const first = Buffer.from('partial');
    expect(await manager.uploadChunk({
      sessionId: cancelled.sessionId,
      token: cancelled.token,
      origin: allowedOrigin,
      segmentId: 'video-0',
      offset: 0,
      final: false,
      bytes: first,
    })).toEqual({ ok: true });
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(1);
    expect(await manager.cancel(cancelled.sessionId, cancelled.token, allowedOrigin)).toEqual({ ok: true });
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(0);

    const failed = await createSession(manager);
    expect(await manager.uploadChunk({
      sessionId: failed.sessionId,
      token: failed.token,
      origin: allowedOrigin,
      segmentId: 'video-0',
      offset: 0,
      final: true,
      bytes: Buffer.from('complete segment'),
    })).toEqual({ ok: true });
    expect(await manager.commit(failed.sessionId, failed.token, allowedOrigin)).toEqual({ ok: true });
    await waitForStatus(manager, failed.sessionId, failed.token, 'failed');
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(0);
    expect(manager.snapshot(failed.sessionId, failed.token, allowedOrigin)?.reason)
      .toBe('merge failed unsafe detail');
    expect(manager.snapshot(failed.sessionId, failed.token, allowedOrigin)?.failureKind).toBe('import-failed');
  });

  it('preserves typed source validation failure through cleanup retry', async () => {
    let failNextRemoval = true;
    const { manager, stagingRoot } = await makeManager({
      hooks: {
        commit: async () => { throw new SegmentedSourceValidationError('source validation failed'); },
      },
      policy: {
        removePath: async (target, options) => {
          if (failNextRemoval) {
            failNextRemoval = false;
            throw new Error('simulated cleanup failure');
          }
          return rm(target, options);
        },
      },
    });
    const { origin } = await makeServer({ segmentedMediaTransferManager: manager });
    const session = await createSession(manager);
    expect(await manager.uploadChunk({
      sessionId: session.sessionId,
      token: session.token,
      origin: allowedOrigin,
      segmentId: 'video-0',
      offset: 0,
      final: true,
      bytes: Buffer.from('invalid source'),
    })).toEqual({ ok: true });

    expect(await manager.commit(session.sessionId, session.token, allowedOrigin)).toEqual({ ok: true });
    await waitForStatus(manager, session.sessionId, session.token, 'failed');
    const authHeaders = {
      Origin: allowedOrigin,
      Authorization: `Bearer ${session.token}`,
    };
    const getSnapshot = async () => {
      const response = await fetch(`${origin}/media-transfer/sessions/${session.sessionId}`, {
        headers: authHeaders,
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<Record<string, unknown>>;
    };
    expect(await getSnapshot()).toMatchObject({
      status: 'failed',
      cleanupFailed: true,
      failureKind: 'source-invalid',
    });
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(1);

    const cleanupRetry = await fetch(`${origin}/media-transfer/sessions/${session.sessionId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(cleanupRetry.status).toBe(200);
    expect(await cleanupRetry.json()).toEqual({
      status: 'ok', state: 'failed', cleanupFailed: false, failureKind: 'source-invalid',
    });
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(0);
    expect(await getSnapshot()).toMatchObject({
      status: 'failed',
      cleanupFailed: false,
      failureKind: 'source-invalid',
    });
  });

  it('retries cancellation cleanup after the first removal fails', async () => {
    let failNextRemoval = true;
    const { manager, stagingRoot } = await makeManager({
      policy: {
        removePath: async (target, options) => {
          if (failNextRemoval) {
            failNextRemoval = false;
            throw new Error('simulated cleanup failure');
          }
          return rm(target, options);
        },
      },
    });
    const session = await createSession(manager);
    expect(await manager.uploadChunk({
      sessionId: session.sessionId,
      token: session.token,
      origin: allowedOrigin,
      segmentId: 'video-0',
      offset: 0,
      final: false,
      bytes: Buffer.from('partial'),
    })).toEqual({ ok: true });

    expect(await manager.cancel(session.sessionId, session.token, allowedOrigin)).toEqual({ ok: true });
    expect(manager.snapshot(session.sessionId, session.token, allowedOrigin)).toMatchObject({
      status: 'failed',
      reason: 'transfer cleanup failed: simulated cleanup failure',
    });
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(1);

    expect(await manager.cancel(session.sessionId, session.token, allowedOrigin)).toEqual({ ok: true });
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(0);
    expect(manager.snapshot(session.sessionId, session.token, allowedOrigin)?.status).toBe('failed');
  });

  it('recovers only orphan directories owned by this feature at startup', async () => {
    const root = await makeTempDirectory();
    const stagingRoot = path.join(root, 'staging');
    const orphan = path.join(stagingRoot, 'serpent-ext-segmented-old-session');
    const unrelated = path.join(stagingRoot, 'other-feature-temp');
    await mkdir(orphan, { recursive: true });
    await mkdir(unrelated, { recursive: true });
    await mkdir(path.join(orphan, 'nested'), { recursive: true });

    const manager = new SegmentedMediaTransferManager(stagingRoot, {
      resolveTarget: async () => undefined,
      commit: async () => undefined,
    });
    managers.push(manager);
    await manager.initialize();

    await expect(stat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(stagingRoot)).sort()).toEqual(['other-feature-temp']);
  });
});

describe('segmented extension HTTP endpoints', () => {
  it('reports null capability to an older desktop without a transfer manager', async () => {
    const { extensionServer, origin } = await makeServer();
    const response = await fetch(`${origin}/capabilities`, {
      headers: { Origin: allowedOrigin },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(await response.json()).toMatchObject({
      status: 'ok',
      segmentedMediaUpload: null,
    });
    expect(extensionServer.server.listening).toBe(true);
  });

  it('rejects web origins and binds HTTP sessions to the creating origin and token', async () => {
    const { manager, stagingRoot } = await makeManager();
    const { extensionServer, origin } = await makeServer({ segmentedMediaTransferManager: manager });
    const invalidOriginResponse = await fetch(`${origin}/capabilities`, {
      headers: { Origin: 'https://untrusted.example' },
    });
    expect(invalidOriginResponse.status).toBe(403);

    const createdResponse = await fetch(`${origin}/media-transfer/sessions`, {
      method: 'POST',
      headers: {
        Origin: allowedOrigin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validSessionInput()),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as {
      sessionId: string;
      token: string;
      chunkBytes: number;
      maxAssetBytes: number;
    };
    expect(created.chunkBytes).toBe(SEGMENTED_MEDIA_CHUNK_BYTES);
    expect(created.maxAssetBytes).toBe(SEGMENTED_MEDIA_MAX_BYTES);

    const wrongOrigin = await fetch(`${origin}/media-transfer/sessions/${created.sessionId}`, {
      headers: {
        Origin: otherExtensionOrigin,
        Authorization: `Bearer ${created.token}`,
      },
    });
    expect(wrongOrigin.status).toBe(404);
    const wrongToken = await fetch(`${origin}/media-transfer/sessions/${created.sessionId}`, {
      headers: {
        Origin: allowedOrigin,
        Authorization: 'Bearer wrong-token',
      },
    });
    expect(wrongToken.status).toBe(404);

    const correctToken = await fetch(`${origin}/media-transfer/sessions/${created.sessionId}`, {
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${created.token}`,
      },
    });
    expect(correctToken.status).toBe(200);
    expect(await correctToken.json()).toMatchObject({ status: 'uploading' });

    const cancelled = await fetch(`${origin}/media-transfer/sessions/${created.sessionId}`, {
      method: 'DELETE',
      headers: {
        Origin: allowedOrigin,
        Authorization: `Bearer ${created.token}`,
      },
    });
    expect(cancelled.status).toBe(200);
    expect(await managedSessionDirectories(stagingRoot)).toHaveLength(0);
    expect(extensionServer.server.listening).toBe(true);
  });
});
