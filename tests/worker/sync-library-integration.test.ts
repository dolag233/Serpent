import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

function createLibraryWithAsset(service: LibraryService, name: string): {
  libraryId: string;
  libraryPath: string;
  assetPath: string;
  assetId: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-sync-lib-'));
  roots.push(root);
  const created = service.createLibrary({ displayName: name, selectedParentPath: root });
  const assetPath = path.join(root, 'source.txt');
  writeFileSync(assetPath, 'hello-sync-integration');
  const prepared = service.prepareOrExecuteImport({
    libraryId: created.libraryId,
    sourceKind: 'files',
    sourcePaths: [assetPath],
  });
  if ('importId' in prepared) {
    service.resolveImport({
      importId: prepared.importId,
      suspectedDuplicate: 'create-copy',
      nameConflict: 'keep-both',
    });
  }
  const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
  return {
    libraryId: created.libraryId,
    libraryPath: created.libraryPath,
    assetPath,
    assetId: assets[0]!.assetId,
  };
}

describe('library sync integration (Serpent-xffq)', () => {
  it('builds a snapshot with stable syncIds and content hashes', () => {
    const service = new LibraryService();
    const { libraryId, assetId } = createLibraryWithAsset(service, '同步库');
    const snapshot = service.syncSnapshot(libraryId);
    expect(snapshot.library.displayName).toBe('同步库');
    expect(snapshot.assets).toHaveLength(1);
    expect(snapshot.assets[0]!.assetId).toBe(assetId);
    expect(snapshot.assets[0]!.syncId).toMatch(/^[0-9a-f-]{36}$/);
    expect(snapshot.assets[0]!.relativePath).toBe('source.txt');
    expect(snapshot.assets[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);

    // 第二次快照必须复用同一 syncId（稳定身份）。
    const second = service.syncSnapshot(libraryId);
    expect(second.assets[0]!.syncId).toBe(snapshot.assets[0]!.syncId);
    service.closeAll();
  });

  it('applies a content update to an existing synced asset as a new revision', () => {
    const service = new LibraryService();
    const { libraryId, assetId } = createLibraryWithAsset(service, '更新库');
    const syncId = service.syncSnapshot(libraryId).assets[0]!.syncId;
    const revisionBefore = service.listAssets({ libraryId, recursive: true })[0]!.currentRevisionId;

    const result = service.applySyncContentUpdate(libraryId, syncId, 'source.txt', Buffer.from('remote-version-content'));
    expect(result.assetId).toBe(assetId);
    expect(result.created).toBe(false);
    const asset = service.listAssets({ libraryId, recursive: true })[0]!;
    expect(asset.currentRevisionId).not.toBe(revisionBefore);
    expect(asset.byteSize).toBe('remote-version-content'.length);
    service.closeAll();
  });

  it('imports a remote-only asset and binds its syncId', () => {
    const service = new LibraryService();
    const { libraryId } = createLibraryWithAsset(service, '下载库');
    const result = service.applySyncContentUpdate(libraryId, 'remote-sync-1', 'downloaded.png', Buffer.from('downloaded-bytes'));
    expect(result.created).toBe(true);
    const bySyncId = service.listAssets({ libraryId, recursive: true }).filter((asset) => asset.relativeFilePath === 'downloaded.png');
    expect(bySyncId).toHaveLength(1);
    const snapshot = service.syncSnapshot(libraryId);
    expect(snapshot.assets.some((asset) => asset.syncId === 'remote-sync-1' && asset.relativePath === 'downloaded.png')).toBe(true);
    service.closeAll();
  });

  it('recycles a local asset when a remote tombstone propagates', () => {
    const service = new LibraryService();
    const { libraryId, assetId } = createLibraryWithAsset(service, '墓碑库');
    const syncId = service.syncSnapshot(libraryId).assets[0]!.syncId;
    service.applySyncRecycle(libraryId, syncId);
    // 回收站语义：trash 后资产可从 listTrash 恢复，且不再进入同步快照。
    const trashed = service.listTrash(libraryId);
    expect(trashed.some((asset) => asset.assetId === assetId)).toBe(true);
    const snapshot = service.syncSnapshot(libraryId);
    expect(snapshot.assets.some((asset) => asset.syncId === syncId)).toBe(false);
    service.closeAll();
  });

  it('imports a conflict copy with a fresh syncId', () => {
    const service = new LibraryService();
    const { libraryId } = createLibraryWithAsset(service, '冲突库');
    const meta = service.applySyncConflictCopy(
      libraryId,
      'dir/source.txt',
      Buffer.from('loser-content'),
      'dir/source (conflict-202608151400).txt',
    );
    expect(meta.syncId).toMatch(/^[0-9a-f-]{36}$/);
    expect(meta.size).toBe('loser-content'.length);
    const conflictAsset = service.listAssets({ libraryId, recursive: true })
      .find((asset) => asset.relativeFilePath.endsWith('source (conflict-202608151400).txt'));
    expect(conflictAsset).toBeTruthy();
    expect(existsSync(service.resolveAssetPath(libraryId, conflictAsset!.assetId))).toBe(true);
    service.closeAll();
  });

  it('round-trips the manifest cache', () => {
    const service = new LibraryService();
    const { libraryId } = createLibraryWithAsset(service, '缓存库');
    expect(service.readSyncManifestCache(libraryId)).toBeNull();
    service.writeSyncManifestCache(libraryId, '{"formatVersion":1}');
    expect(service.readSyncManifestCache(libraryId)).toBe('{"formatVersion":1}');
    service.closeAll();
  });
});
