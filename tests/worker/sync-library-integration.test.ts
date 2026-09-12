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
    expect(snapshot.assets[0]!.metadata).toMatchObject({ tags: [], description: null, rating: 0, favorite: false });

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

  it('imports a nested remote-only asset into managed folders', () => {
    const service = new LibraryService();
    const { libraryId } = createLibraryWithAsset(service, '嵌套下载库');
    const result = service.applySyncContentUpdate(
      libraryId,
      'remote-nested-1',
      '2D/props/alpha.txt',
      Buffer.from('nested-bytes'),
    );
    expect(result.created).toBe(true);
    const nested = service.listAssets({ libraryId, recursive: true })
      .find((asset) => asset.relativeFilePath === '2D/props/alpha.txt');
    expect(nested).toBeTruthy();
    expect(existsSync(service.resolveAssetPath(libraryId, nested!.assetId))).toBe(true);
    const snapshot = service.syncSnapshot(libraryId);
    expect(snapshot.assets.some((asset) =>
      asset.syncId === 'remote-nested-1' && asset.relativePath === '2D/props/alpha.txt'
    )).toBe(true);
    service.closeAll();
  });

  it('emits source=sync so the UI can refresh nested folders without another auto-sync (Serpent-7043e1)', () => {
    const events: Array<{ source?: string; changedCount: number }> = [];
    const service = new LibraryService({
      onAssetsChanged: (event) => events.push(event),
    });
    const { libraryId, assetId } = createLibraryWithAsset(service, '回放刷新库');
    events.length = 0;

    service.applySyncContentUpdate(
      libraryId,
      'remote-nested-refresh',
      'K/L/alpha.txt',
      Buffer.from('nested-refresh'),
    );
    expect(events.some((event) => event.source === 'sync' && event.changedCount >= 1)).toBe(true);
    expect(events.some((event) => event.source === 'client')).toBe(false);
    expect(service.listManagedFolders(libraryId).map((folder) => folder.relativePath).sort()).toEqual(['K', 'K/L']);

    events.length = 0;
    const syncId = service.syncSnapshot(libraryId).assets.find((entry) => entry.assetId === assetId)!.syncId;
    service.applySyncRelocate(libraryId, syncId, 'K/L/source.txt');
    expect(events.some((event) => event.source === 'sync' && event.changedCount >= 1)).toBe(true);
    expect(events.some((event) => event.source === 'client')).toBe(false);
    expect(service.listAssets({ libraryId, recursive: true }).map((asset) => asset.relativeFilePath).sort()).toEqual([
      'K/L/alpha.txt',
      'K/L/source.txt',
    ]);
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
      .find((asset) => asset.relativeFilePath === 'dir/source (conflict-202608151400).txt');
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

  it('relocates a managed asset into a new folder without rewriting content (Serpent-038ecf)', () => {
    const service = new LibraryService();
    const { libraryId, assetId } = createLibraryWithAsset(service, '搬路径库');
    const snapshot = service.syncSnapshot(libraryId);
    const syncId = snapshot.assets[0]!.syncId;
    const beforePath = service.resolveAssetPath(libraryId, assetId);
    expect(existsSync(beforePath)).toBe(true);

    service.applySyncRelocate(libraryId, syncId, '2D/source.txt');
    const after = service.listAssets({ libraryId, recursive: true })[0]!;
    expect(after.relativeFilePath).toBe('2D/source.txt');
    const afterPath = service.resolveAssetPath(libraryId, assetId);
    expect(existsSync(afterPath)).toBe(true);
    expect(existsSync(beforePath)).toBe(false);
    service.closeAll();
  });

  it('prunes empty source folders after relocating a nested directory to the root (Serpent-546f1a)', () => {
    const service = new LibraryService();
    const { libraryId, libraryPath, assetId } = createLibraryWithAsset(service, '空目录残留库');
    const syncId = service.syncSnapshot(libraryId).assets[0]!.syncId;
    service.applySyncRelocate(libraryId, syncId, 'K/L/source.txt');
    expect(service.listManagedFolders(libraryId).map((folder) => folder.relativePath).sort()).toEqual(['K', 'K/L']);

    service.applySyncRelocate(libraryId, syncId, 'L/source.txt');
    expect(service.listAssets({ libraryId, recursive: true })[0]!.relativeFilePath).toBe('L/source.txt');
    expect(service.listManagedFolders(libraryId).map((folder) => folder.relativePath)).toEqual(['L']);
    expect(existsSync(path.join(libraryPath, 'Assets', 'K'))).toBe(false);
    expect(existsSync(service.resolveAssetPath(libraryId, assetId))).toBe(true);
    service.closeAll();
  });

  it('keeps a source folder that still has another asset after sync relocate', () => {
    const service = new LibraryService();
    const { libraryId, assetPath } = createLibraryWithAsset(service, '保留目录库');
    const firstSyncId = service.syncSnapshot(libraryId).assets[0]!.syncId;
    service.applySyncRelocate(libraryId, firstSyncId, 'K/L/source.txt');
    const folderL = service.listManagedFolders(libraryId).find((folder) => folder.relativePath === 'K/L')!;
    const extra = path.join(path.dirname(assetPath), 'keep.txt');
    writeFileSync(extra, 'keep-me');
    service.prepareOrExecuteImport({
      libraryId,
      targetFolderId: folderL.folderId,
      sourceKind: 'files',
      sourcePaths: [extra],
    });

    service.applySyncRelocate(libraryId, firstSyncId, 'M/source.txt');
    expect(service.listAssets({ libraryId, recursive: true }).map((asset) => asset.relativeFilePath).sort()).toEqual([
      'K/L/keep.txt',
      'M/source.txt',
    ]);
    expect(service.listManagedFolders(libraryId).map((folder) => folder.relativePath).sort()).toEqual(['K', 'K/L', 'M']);
    service.closeAll();
  });

  it('prunes a renamed folder and keeps a folder after a same-directory rename', () => {
    const service = new LibraryService();
    const { libraryId } = createLibraryWithAsset(service, '改名路径库');
    const syncId = service.syncSnapshot(libraryId).assets[0]!.syncId;
    service.applySyncRelocate(libraryId, syncId, 'K/source.txt');
    service.applySyncRelocate(libraryId, syncId, 'K2/source.txt');
    expect(service.listManagedFolders(libraryId).map((folder) => folder.relativePath)).toEqual(['K2']);

    service.applySyncRelocate(libraryId, syncId, 'K2/renamed.txt');
    expect(service.listAssets({ libraryId, recursive: true })[0]!.relativeFilePath).toBe('K2/renamed.txt');
    expect(service.listManagedFolders(libraryId).map((folder) => folder.relativePath)).toEqual(['K2']);
    service.closeAll();
  });

  it('round-trips human tags and description through sync metadata helpers', () => {
    const service = new LibraryService();
    const { libraryId, assetId } = createLibraryWithAsset(service, '元数据库');
    const tag = service.createTag({ libraryId, name: '角色' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    const current = service.getAssetMetadata({ libraryId, assetId });
    service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: current.entityVersion,
      description: '主角设定',
      rating: 4,
      favorite: true,
    });
    const snapshot = service.syncSnapshot(libraryId);
    expect(snapshot.assets[0]!.metadata).toMatchObject({
      tags: ['角色'],
      description: '主角设定',
      rating: 4,
      favorite: true,
    });
    const syncId = snapshot.assets[0]!.syncId;
    service.applySyncAssetMetadata(libraryId, syncId, {
      tags: ['场景'],
      description: '室内',
      rating: 2,
      favorite: false,
    });
    const updated = service.getAssetMetadata({ libraryId, assetId });
    expect(updated.description).toBe('室内');
    expect(updated.rating).toBe(2);
    expect(updated.favorite).toBe(false);
    expect(updated.tags.some((item) => item.name === '场景' && item.source === 'user')).toBe(true);
    expect(updated.tags.some((item) => item.name === '角色' && item.source === 'user')).toBe(false);
    service.closeAll();
  });

  it('round-trips AI tags, description and rating without writing human fields', () => {
    const service = new LibraryService();
    const { libraryId, assetId } = createLibraryWithAsset(service, 'AI元数据库');
    service.writeAiAnalysisResult({
      libraryId,
      assetId,
      tags: ['风景', '夜景'],
      description: '城市夜景',
      rating: 5,
      modelId: 'gpt-4o',
      modelVersion: '2024-05-13',
      enabledFields: { description: true, tags: true, rating: true },
    });
    const snapshot = service.syncSnapshot(libraryId);
    expect(snapshot.assets[0]!.metadata).toMatchObject({
      tags: [],
      description: null,
      rating: 0,
      favorite: false,
      ai: {
        tags: ['夜景', '风景'],
        description: '城市夜景',
        rating: 5,
        modelId: 'gpt-4o',
        modelVersion: '2024-05-13',
      },
    });
    const syncId = snapshot.assets[0]!.syncId;
    service.applySyncAssetMetadata(libraryId, syncId, {
      tags: [],
      description: null,
      rating: 0,
      favorite: false,
      ai: {
        tags: ['室内'],
        description: '工作室',
        rating: 3,
        modelId: 'sync',
        modelVersion: '1',
      },
    });
    const human = service.getAssetMetadata({ libraryId, assetId });
    expect(human.description === '工作室').toBe(false);
    expect(human.rating).toBe(0);
    expect(human.tags.some((item) => item.name === '室内' && item.source === 'ai')).toBe(true);
    expect(human.tags.some((item) => item.source === 'user')).toBe(false);
    expect(service.listAiTagNames(libraryId, assetId)).toEqual(['室内']);
    const ai = service.getAiContent(libraryId, assetId);
    expect(ai.some((row) => row.fieldName === 'description' && row.value === '工作室')).toBe(true);
    expect(ai.some((row) => row.fieldName === 'rating' && row.value === '3')).toBe(true);

    service.writeAiAnalysisResult({
      libraryId,
      assetId,
      tags: ['保留AI'],
      description: '本机AI',
      rating: 4,
      modelId: 'local',
      modelVersion: '9',
      enabledFields: { description: true, tags: true, rating: true },
    });
    service.applySyncAssetMetadata(libraryId, syncId, {
      tags: ['人手'],
      description: '人手简介',
      rating: 1,
      favorite: false,
    });
    const afterOldSidecar = service.getAssetMetadata({ libraryId, assetId });
    expect(afterOldSidecar.tags.some((item) => item.name === '人手' && item.source === 'user')).toBe(true);
    expect(service.listAiTagNames(libraryId, assetId)).toEqual(['保留AI']);
    expect(service.getAiContent(libraryId, assetId).some((row) => row.value === '本机AI')).toBe(true);
    service.closeAll();
  });

  it('lists pending card status from revision size, not assets.byte_size', () => {
    const service = new LibraryService();
    const { libraryId, assetId } = createLibraryWithAsset(service, '卡片状态');
    expect(service.listSyncCardStatuses(libraryId, [assetId])).toEqual([
      { assetId, status: 'pending' },
    ]);
    service.closeAll();
  });
});
