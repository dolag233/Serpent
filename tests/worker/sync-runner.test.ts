import { describe, expect, it } from 'vitest';

import type {
  DriverCapabilities,
  RemoteEntry,
  RemoteReadResult,
  RemoteStorageDriver,
  RemoteWriteOptions,
  RemoteWriteResult,
} from '../../src/worker/sync/remote-storage';
import { createEmptyManifest } from '../../src/worker/sync/manifest';
import { planSyncActions } from '../../src/worker/sync/sync-plan';
import { conflictCopyFileName, runSyncActions, type SyncRunnerContext } from '../../src/worker/sync/sync-runner';

class MemoryDriver implements RemoteStorageDriver {
  readonly files = new Map<string, Buffer>();
  private readonly etags = new Map<string, string>();
  private sequence = 0;

  async list(): Promise<RemoteEntry[]> {
    throw new Error('not used');
  }

  async read(path: string): Promise<RemoteReadResult> {
    const body = this.files.get(path);
    if (!body) throw new Error(`missing ${path}`);
    return { body, etag: this.etags.get(path) };
  }

  async write(path: string, body: Buffer, options: RemoteWriteOptions = {}): Promise<RemoteWriteResult> {
    if (options.ifMatch && this.etags.get(path) && options.ifMatch !== this.etags.get(path)) {
      throw new Error('precondition failed');
    }
    this.files.set(path, body);
    this.sequence += 1;
    const etag = `"etag-${this.sequence}"`;
    this.etags.set(path, etag);
    return { etag, status: this.files.has(path) ? 201 : 204 };
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
    this.etags.delete(path);
  }

  async mkdir(): Promise<void> {}

  async move(): Promise<void> {}

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async probe(): Promise<DriverCapabilities> {
    return {
      auth: 'none',
      supportsContentTransfer: true,
      supportsDepthInfinity: true,
      supportsEtagIfMatch: true,
      supportsMove: true,
      supportsLock: false,
    };
  }
}

function buildContext(driver: MemoryDriver, local: Map<string, Buffer>): {
  context: SyncRunnerContext;
  writtenLocal: Map<string, Buffer>;
  recycled: string[];
  conflictCopies: Array<{ assetId: string; name: string; body: Buffer }>;
} {
  const writtenLocal = new Map<string, Buffer>();
  const recycled: string[] = [];
  const conflictCopies: Array<{ assetId: string; name: string; body: Buffer }> = [];
  const context: SyncRunnerContext = {
    driver,
    libraryDirectory: '参考库',
    deviceId: 'dev-a',
    now: () => '2026-08-15T14:00:00Z',
    readLocalAsset: async (assetId) => local.get(assetId) ?? Buffer.alloc(0),
    writeLocalAsset: async (assetId, _path, body) => {
      writtenLocal.set(assetId, body);
    },
    recycleLocalAsset: async (assetId) => {
      recycled.push(assetId);
    },
    saveLocalConflictCopy: async (assetId, _path, body, name) => {
      conflictCopies.push({ assetId, name, body });
    },
  };
  return { context, writtenLocal, recycled, conflictCopies };
}

describe('runSyncActions end-to-end (Serpent-xffq)', () => {
  it('uploads a new asset, writes manifest entries and stores remote content', async () => {
    const driver = new MemoryDriver();
    const manifest = createEmptyManifest({ libraryId: 'lib-1', displayName: '参考库', directoryName: '参考库' });
    const local = new Map([['a1', Buffer.from('local-content')]]);
    const { context } = buildContext(driver, local);

    const actions = planSyncActions({
      localAssets: new Map([['a1', { contentHash: 'hash-local', size: 13, modifiedAt: '2026-08-15T10:00:00Z' }]]),
      localManifest: manifest,
      remoteManifest: createEmptyManifest({ libraryId: 'lib-1', displayName: '参考库', directoryName: '参考库' }),
      remoteTombstones: new Set(),
    });
    // 应用层填充 upload entry 的实际路径。
    const uploadAction = actions[0]!;
    if (uploadAction.type !== 'upload') throw new Error('expected an upload action');
    const result = await runSyncActions(
      [{ ...uploadAction, entry: { ...uploadAction.entry, path: 'dir/file.bin' } }],
      manifest,
      context,
    );

    expect(result.uploaded).toBe(1);
    expect(driver.files.get('assets/dir/file.bin')?.toString()).toBe('local-content');
    expect(result.manifest.entries.a1).toMatchObject({
      path: 'dir/file.bin',
      contentHash: 'hash-local',
      deviceId: 'dev-a',
    });
    expect(result.manifest.entries.a1!.etag).toMatch(/^"etag-/);
  });

  it('downloads a remote asset into the local library', async () => {
    const driver = new MemoryDriver();
    driver.files.set('assets/dir/file.bin', Buffer.from('remote-content'));
    const remoteManifest = createEmptyManifest({ libraryId: 'lib-1', displayName: '参考库', directoryName: '参考库' });
    remoteManifest.entries.a1 = {
      path: 'dir/file.bin', contentHash: 'hash-remote', size: 14, version: 1,
      deviceId: 'dev-b', modifiedAt: '2026-08-15T10:00:00Z', metadataVersion: 1,
    };
    const manifest = createEmptyManifest({ libraryId: 'lib-1', displayName: '参考库', directoryName: '参考库' });
    const { context, writtenLocal } = buildContext(driver, new Map());

    const actions = planSyncActions({
      localAssets: new Map(),
      localManifest: manifest,
      remoteManifest,
      remoteTombstones: new Set(),
    });
    const result = await runSyncActions(actions, manifest, context);

    expect(result.downloaded).toBe(1);
    expect(writtenLocal.get('a1')?.toString()).toBe('remote-content');
    expect(result.manifest.entries.a1).toBeTruthy();
  });

  it('resolves a conflict with winner=remote: downloads winner, stores both conflict copies', async () => {
    const driver = new MemoryDriver();
    driver.files.set('assets/dir/file.bin', Buffer.from('remote-winner'));
    const remoteManifest = createEmptyManifest({ libraryId: 'lib-1', displayName: '参考库', directoryName: '参考库' });
    remoteManifest.entries.a1 = {
      path: 'dir/file.bin', contentHash: 'hash-remote', size: 13, version: 5,
      deviceId: 'dev-b', modifiedAt: '2026-08-15T12:00:00Z', metadataVersion: 1,
    };
    const localManifest = createEmptyManifest({ libraryId: 'lib-1', displayName: '参考库', directoryName: '参考库' });
    localManifest.entries.a1 = {
      path: 'dir/file.bin', contentHash: 'hash-1', size: 10, version: 1,
      deviceId: 'dev-a', modifiedAt: '2026-08-15T10:00:00Z', metadataVersion: 1,
    };
    const local = new Map([['a1', Buffer.from('local-loser')]]);
    const { context, writtenLocal, conflictCopies } = buildContext(driver, local);

    const actions = planSyncActions({
      localAssets: new Map([['a1', { contentHash: 'hash-local', size: 12, modifiedAt: '2026-08-15T11:00:00Z' }]]),
      localManifest,
      remoteManifest,
      remoteTombstones: new Set(),
    });
    const result = await runSyncActions(actions, localManifest, context);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.conflictCopyPath).toContain('conflict-202608151400');
    // 正式版 = 远端内容写入本地。
    expect(writtenLocal.get('a1')?.toString()).toBe('remote-winner');
    // 败者本地内容保存冲突副本（本地 + 远端）。
    expect(conflictCopies[0]!.body.toString()).toBe('local-loser');
    const conflictRemote = driver.files.get(`assets/${result.conflicts[0]!.conflictCopyPath}`);
    expect(conflictRemote?.toString()).toBe('local-loser');
  });

  it('propagates local deletion as remote delete + tombstone', async () => {
    const driver = new MemoryDriver();
    driver.files.set('assets/dir/file.bin', Buffer.from('remote'));
    const remoteManifest = createEmptyManifest({ libraryId: 'lib-1', displayName: '参考库', directoryName: '参考库' });
    remoteManifest.entries.a1 = {
      path: 'dir/file.bin', contentHash: 'hash-1', size: 6, version: 1,
      deviceId: 'dev-b', modifiedAt: '2026-08-15T10:00:00Z', metadataVersion: 1,
    };
    const localManifest = createEmptyManifest({ libraryId: 'lib-1', displayName: '参考库', directoryName: '参考库' });
    localManifest.entries.a1 = { ...remoteManifest.entries.a1! };

    const { context } = buildContext(driver, new Map());
    const actions = planSyncActions({
      localAssets: new Map(),
      localManifest,
      remoteManifest,
      remoteTombstones: new Set(),
    });
    const result = await runSyncActions(actions, localManifest, context);

    expect(result.deletedRemote).toBe(1);
    expect(result.tombstones).toBe(1);
    expect(driver.files.has('assets/dir/file.bin')).toBe(false);
    expect(driver.files.has('trash/a1.json')).toBe(true);
    expect(result.manifest.entries.a1).toBeUndefined();
  });

  it('recycles a local asset when a remote tombstone exists', async () => {
    const driver = new MemoryDriver();
    const remoteManifest = createEmptyManifest({ libraryId: 'lib-1', displayName: '参考库', directoryName: '参考库' });
    const localManifest = createEmptyManifest({ libraryId: 'lib-1', displayName: '参考库', directoryName: '参考库' });
    localManifest.entries.a1 = {
      path: 'dir/file.bin', contentHash: 'hash-1', size: 6, version: 1,
      deviceId: 'dev-a', modifiedAt: '2026-08-15T10:00:00Z', metadataVersion: 1,
    };
    const local = new Map([['a1', Buffer.from('x')]]);
    const { context, recycled } = buildContext(driver, local);

    const actions = planSyncActions({
      localAssets: new Map([['a1', { contentHash: 'hash-1', size: 6, modifiedAt: '2026-08-15T10:00:00Z' }]]),
      localManifest,
      remoteManifest,
      remoteTombstones: new Set(['a1']),
    });
    const result = await runSyncActions(actions, localManifest, context);

    expect(result.recycledLocal).toBe(1);
    expect(recycled).toEqual(['a1']);
  });
});

describe('conflictCopyFileName', () => {
  it('inserts the conflict stamp before the extension', () => {
    expect(conflictCopyFileName('dir/name.ext', '2026-08-15T14:00:00Z')).toBe('dir/name (conflict-202608151400).ext');
    expect(conflictCopyFileName('noext', '2026-08-15T14:00:00Z')).toBe('noext (conflict-202608151400)');
  });
});
