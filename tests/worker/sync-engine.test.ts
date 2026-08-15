import { describe, expect, it } from 'vitest';

import type {
  DriverCapabilities,
  RemoteEntry,
  RemoteReadResult,
  RemoteStorageDriver,
  RemoteWriteOptions,
  RemoteWriteResult,
} from '../../src/worker/sync/remote-storage';
import { SyncEngine, type SyncLibraryPort, type SyncRootConfig } from '../../src/worker/sync/sync-engine';

class MemoryDriver implements RemoteStorageDriver {
  readonly files = new Map<string, Buffer>();
  private readonly etags = new Map<string, string>();
  private sequence = 0;
  contentTransfer = true;

  async list(path: string): Promise<RemoteEntry[]> {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    return [...this.files.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({ path: key, isDirectory: false, size: this.files.get(key)!.length, etag: this.etags.get(key) }));
  }

  async read(path: string): Promise<RemoteReadResult> {
    const body = this.files.get(path);
    if (!body) throw new Error(`missing ${path}`);
    return { body, etag: this.etags.get(path) };
  }

  async write(path: string, body: Buffer, options: RemoteWriteOptions = {}): Promise<RemoteWriteResult> {
    if (options.ifMatch && this.etags.get(path) && options.ifMatch !== this.etags.get(path)) {
      throw new Error('precondition');
    }
    this.files.set(path, body);
    this.sequence += 1;
    const etag = `"etag-${this.sequence}"`;
    this.etags.set(path, etag);
    return { etag, status: 201 };
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
      supportsContentTransfer: this.contentTransfer,
      supportsDepthInfinity: true,
      supportsEtagIfMatch: true,
      supportsMove: true,
      supportsLock: false,
    };
  }
}

interface FakeAsset {
  syncId: string;
  relativePath: string;
  body: Buffer;
}

class FakeLibrary implements SyncLibraryPort {
  assets = new Map<string, FakeAsset>();
  private cache = new Map<string, string>();
  calls: string[] = [];
  conflictCopies: Array<{ syncId: string; name: string }> = [];

  constructor(private readonly displayName = '参考库') {}

  async syncSnapshot(libraryId: string) {
    const assets = [...this.assets.values()].map((asset) => ({
      syncId: asset.syncId,
      assetId: asset.syncId,
      relativePath: asset.relativePath,
      contentHash: `hash-${Buffer.from(asset.body).toString('hex').slice(0, 8)}`,
      size: asset.body.length,
      modifiedAt: '2026-08-15T10:00:00Z',
    }));
    return { library: { libraryId, displayName: this.displayName }, assets };
  }

  async applySyncContentUpdate(libraryId: string, syncId: string, relativePath: string, body: Buffer) {
    this.calls.push(`update:${syncId}:${relativePath}`);
    const existing = this.assets.get(syncId);
    if (existing) {
      existing.body = body;
      existing.relativePath = relativePath;
      return { assetId: syncId, created: false };
    }
    this.assets.set(syncId, { syncId, relativePath, body });
    return { assetId: syncId, created: true };
  }

  async applySyncRecycle(_libraryId: string, syncId: string) {
    this.calls.push(`recycle:${syncId}`);
    this.assets.delete(syncId);
  }

  async applySyncConflictCopy(_libraryId: string, _relativePath: string, _body: Buffer, conflictName: string) {
    const syncId = `copy-${conflictName}`;
    this.conflictCopies.push({ syncId, name: conflictName });
    return { syncId, contentHash: `hash-copy-${conflictName}`, size: _body.length };
  }

  async readSyncManifestCache(libraryId: string) {
    return this.cache.get(libraryId) ?? null;
  }

  async writeSyncManifestCache(libraryId: string, manifestJson: string) {
    this.cache.set(libraryId, manifestJson);
  }

  async readLocalAssetContent(_libraryId: string, syncId: string) {
    const asset = this.assets.get(syncId);
    if (!asset) throw new Error(`missing local ${syncId}`);
    return asset.body;
  }
}

const root: SyncRootConfig = { id: 'root-1', baseUrl: 'https://mock/' };

describe('SyncEngine end-to-end (Serpent-xffq)', () => {
  it('performs a first full upload and persists the manifest', async () => {
    const driver = new MemoryDriver();
    const library = new FakeLibrary();
    library.assets.set('s1', { syncId: 's1', relativePath: 'dir/a.png', body: Buffer.from('aaa') });
    library.assets.set('s2', { syncId: 's2', relativePath: 'b.png', body: Buffer.from('bbb') });
    const engine = new SyncEngine(library, { deviceId: 'dev-a' });
    engine.buildDriver = () => driver;

    const outcome = await engine.syncOnce('lib-1', root);
    expect(outcome.report.uploads).toBe(2);
    expect(driver.files.get('参考库/assets/dir/a.png')?.toString()).toBe('aaa');
    expect(driver.files.get('参考库/manifest.json')).toBeTruthy();
    expect(await library.readSyncManifestCache('lib-1')).toBeTruthy();
    expect(outcome.conflicts).toEqual([]);
  });

  it('downloads remote assets onto a fresh device', async () => {
    const driver = new MemoryDriver();
    driver.files.set('参考库/assets/a.png', Buffer.from('remote-content'));
    driver.files.set('参考库/manifest.json', Buffer.from(JSON.stringify({
      formatVersion: 1,
      libraryId: 'lib-1',
      displayName: '参考库',
      directoryName: '参考库',
      entries: {
        r1: {
          path: 'a.png', contentHash: 'hash-remote', size: 14, version: 1,
          deviceId: 'dev-b', modifiedAt: '2026-08-15T10:00:00Z', metadataVersion: 1,
        },
      },
    })));
    const library = new FakeLibrary();
    const engine = new SyncEngine(library, { deviceId: 'dev-a' });
    engine.buildDriver = () => driver;

    const outcome = await engine.syncOnce('lib-1', root);
    expect(outcome.report.downloads).toBe(1);
    expect(library.assets.get('r1')?.body.toString()).toBe('remote-content');
  });

  it('detects conflicts and stores both copies', async () => {
    const driver = new MemoryDriver();
    // 远端版本与本地不同。
    driver.files.set('参考库/assets/a.png', Buffer.from('remote-version'));
    driver.files.set('参考库/manifest.json', Buffer.from(JSON.stringify({
      formatVersion: 1,
      libraryId: 'lib-1',
      displayName: '参考库',
      directoryName: '参考库',
      entries: {
        s1: {
          path: 'a.png', contentHash: 'hash-remote', size: 10, version: 2,
          deviceId: 'dev-b', modifiedAt: '2026-08-15T12:00:00Z', metadataVersion: 1,
        },
      },
    })));
    const library = new FakeLibrary();
    library.assets.set('s1', { syncId: 's1', relativePath: 'a.png', body: Buffer.from('local-new') });
    // 本地缓存：与本地内容一致（未变），但远端也变了。
    await library.writeSyncManifestCache('lib-1', JSON.stringify({
      formatVersion: 1,
      libraryId: 'lib-1',
      displayName: '参考库',
      directoryName: '参考库',
      entries: {
        s1: {
          path: 'a.png', contentHash: 'hash-1', size: 10, version: 1,
          deviceId: 'dev-a', modifiedAt: '2026-08-15T10:00:00Z', metadataVersion: 1,
        },
      },
    }));
    const engine = new SyncEngine(library, { deviceId: 'dev-a' });
    engine.buildDriver = () => driver;

    const outcome = await engine.syncOnce('lib-1', root);
    expect(outcome.report.conflicts).toBe(1);
    expect(outcome.conflicts).toHaveLength(1);
    expect(library.conflictCopies).toHaveLength(1);
  });

  it('rejects servers without content transfer', async () => {
    const driver = new MemoryDriver();
    driver.contentTransfer = false;
    const library = new FakeLibrary();
    const engine = new SyncEngine(library, { deviceId: 'dev-a' });
    engine.buildDriver = () => driver;
    await expect(engine.syncOnce('lib-1', root)).rejects.toThrow(/无法用于同步/);
  });

  it('propagates local deletion as remote delete + tombstone', async () => {
    const driver = new MemoryDriver();
    driver.files.set('参考库/assets/a.png', Buffer.from('x'));
    driver.files.set('参考库/manifest.json', Buffer.from(JSON.stringify({
      formatVersion: 1,
      libraryId: 'lib-1',
      displayName: '参考库',
      directoryName: '参考库',
      entries: {
        s1: {
          path: 'a.png', contentHash: 'hash-x', size: 1, version: 1,
          deviceId: 'dev-a', modifiedAt: '2026-08-15T10:00:00Z', metadataVersion: 1,
        },
      },
    })));
    const library = new FakeLibrary();
    // 本地缓存里有过 s1（表示上次同步后本地删了）。
    await library.writeSyncManifestCache('lib-1', JSON.stringify({
      formatVersion: 1,
      libraryId: 'lib-1',
      displayName: '参考库',
      directoryName: '参考库',
      entries: {
        s1: {
          path: 'a.png', contentHash: 'hash-x', size: 1, version: 1,
          deviceId: 'dev-a', modifiedAt: '2026-08-15T10:00:00Z', metadataVersion: 1,
        },
      },
    }));
    const engine = new SyncEngine(library, { deviceId: 'dev-a' });
    engine.buildDriver = () => driver;

    const outcome = await engine.syncOnce('lib-1', root);
    expect(outcome.report.remoteDeletes).toBe(1);
    expect(driver.files.has('参考库/assets/a.png')).toBe(false);
    expect(driver.files.has('参考库/trash/s1.json')).toBe(true);
  });

  it('preview does not write anything', async () => {
    const driver = new MemoryDriver();
    const library = new FakeLibrary();
    library.assets.set('s1', { syncId: 's1', relativePath: 'a.png', body: Buffer.from('a') });
    const engine = new SyncEngine(library, { deviceId: 'dev-a' });
    engine.buildDriver = () => driver;

    const report = await engine.previewSync('lib-1', root);
    expect(report.uploads).toBe(1);
    expect(driver.files.size).toBe(0);
  });
});
