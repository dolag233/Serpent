/**
 * 同步编排服务（Serpent-xffq）——SyncEngine 的高层入口。
 *
 * 职责：连接配置 → 能力探测 → 快照/远端 manifest/墓碑收集 → plan →
 * runner 执行 → 写回远端 manifest + 本地缓存。库副作用经 SyncLibraryPort
 * 注入（生产实现为 LibraryService 的同步方法集），驱动经 driver 工厂注入，
 * 因此本层可完全单测。
 */

import {
  SYNC_FORMAT_VERSION_FILE,
  SYNC_MANIFEST_FILE,
  SYNC_TRASH_DIR,
  sanitizeSyncDirectoryName,
  SYNC_FORMAT_VERSION,
} from '../../shared/sync-paths';
import type { DriverCapabilities, RemoteStorageDriver } from './remote-storage';
import { WebDAVDriver } from './webdav-driver';
import {
  createEmptyManifest,
  parseManifest,
  serializeManifest,
  type SyncManifest,
} from './manifest';
import { planSyncActions, type LocalAssetSnapshotEntry } from './sync-plan';
import { runSyncActions, type SyncRunnerContext } from './sync-runner';

export interface SyncRootConfig {
  id: string;
  baseUrl: string;
  username?: string;
  password?: string;
  allowInsecureTls?: boolean;
}

export interface SyncLibraryPort {
  syncSnapshot(libraryId: string): Promise<{
    library: { libraryId: string; displayName: string };
    assets: Array<{
      syncId: string;
      assetId: string;
      relativePath: string;
      contentHash: string;
      size: number;
      modifiedAt: string;
    }>;
  }>;
  applySyncContentUpdate(
    libraryId: string,
    syncId: string,
    relativePath: string,
    body: Buffer,
  ): Promise<{ assetId: string; created: boolean }>;
  applySyncRecycle(libraryId: string, syncId: string): Promise<void>;
  applySyncConflictCopy(
    libraryId: string,
    relativePath: string,
    body: Buffer,
    conflictName: string,
  ): Promise<{ syncId: string; contentHash: string; size: number }>;
  readSyncManifestCache(libraryId: string): Promise<string | null>;
  writeSyncManifestCache(libraryId: string, manifestJson: string): Promise<void>;
  /** 读取本地资产内容（按 syncId）。 */
  readLocalAssetContent(libraryId: string, syncId: string): Promise<Buffer>;
}

export interface SyncPreviewReport {
  capabilities: DriverCapabilities;
  libraryDirectory: string;
  newLocal: number;
  newRemote: number;
  uploads: number;
  downloads: number;
  conflicts: number;
  remoteDeletes: number;
  localRecycles: number;
}

export interface SyncOutcome {
  report: SyncPreviewReport;
  manifest: SyncManifest;
  conflicts: Array<{ syncId: string; conflictCopyPath: string }>;
}

export interface SyncEngineOptions {
  deviceId: string;
  now?(): string;
  onProgress?: (done: number, total: number) => void;
  isCancelled?(): boolean;
}

export class SyncEngine {
  constructor(private readonly library: SyncLibraryPort, private readonly options: SyncEngineOptions) {}

  buildDriver(root: SyncRootConfig): RemoteStorageDriver {
    return new WebDAVDriver({
      baseUrl: root.baseUrl,
      username: root.username,
      password: root.password,
      allowInsecureTls: root.allowInsecureTls ?? false,
    });
  }

  /** 首次同步预览：只计算差异，不执行任何写入。 */
  async previewSync(libraryId: string, root: SyncRootConfig): Promise<SyncPreviewReport> {
    const driver = this.buildDriver(root);
    const capabilities = await driver.probe();
    const snapshot = await this.library.syncSnapshot(libraryId);
    const directoryName = sanitizeSyncDirectoryName(snapshot.library.displayName, snapshot.library.libraryId);
    const { remoteManifest, tombstones } = await this.loadRemoteState(driver, directoryName, snapshot.library.libraryId);
    const localManifest = await this.loadLocalManifest(libraryId, snapshot.library, directoryName);
    const localAssets = this.snapshotToMap(snapshot);
    const actions = planSyncActions({
      localAssets,
      localManifest,
      remoteManifest,
      remoteTombstones: tombstones,
    });
    return this.summarize(snapshot, localManifest, remoteManifest, capabilities, directoryName, actions);
  }

  /** 完整同步：plan → 执行 → 写回 manifest。 */
  async syncOnce(libraryId: string, root: SyncRootConfig): Promise<SyncOutcome> {
    const driver = this.buildDriver(root);
    const capabilities = await driver.probe();
    if (!capabilities.supportsContentTransfer) {
      throw new Error('该服务器不支持文件上传/下载，无法用于同步。');
    }
    const snapshot = await this.library.syncSnapshot(libraryId);
    const directoryName = sanitizeSyncDirectoryName(snapshot.library.displayName, snapshot.library.libraryId);
    const { remoteManifest, tombstones } = await this.loadRemoteState(driver, directoryName, snapshot.library.libraryId);
    const localManifest = await this.loadLocalManifest(libraryId, snapshot.library, directoryName);
    const localAssets = this.snapshotToMap(snapshot);
    const actions = planSyncActions({
      localAssets,
      localManifest,
      remoteManifest,
      remoteTombstones: tombstones,
    });

    const now = this.options.now?.() ?? new Date().toISOString();
    const context: SyncRunnerContext = {
      driver,
      libraryDirectory: directoryName,
      deviceId: this.options.deviceId,
      now: () => now,
      readLocalAsset: async (syncId) => this.library.readLocalAssetContent(libraryId, syncId),
      writeLocalAsset: async (syncId, relativePath, body) => {
        await this.library.applySyncContentUpdate(libraryId, syncId, relativePath, body);
      },
      recycleLocalAsset: async (syncId) => this.library.applySyncRecycle(libraryId, syncId),
      saveLocalConflictCopy: (syncId, relativePath, body, conflictName) =>
        this.library.applySyncConflictCopy(libraryId, relativePath, body, conflictName),
    };

    const total = actions.length;
    let done = 0;
    const wrappedContext: SyncRunnerContext = {
      ...context,
      readLocalAsset: async (syncId) => {
        const body = await context.readLocalAsset(syncId);
        done += 1;
        this.options.onProgress?.(done, total);
        return body;
      },
      writeLocalAsset: async (syncId, path, body) => {
        await context.writeLocalAsset(syncId, path, body);
        done += 1;
        this.options.onProgress?.(done, total);
      },
      recycleLocalAsset: async (syncId) => {
        await context.recycleLocalAsset(syncId);
        done += 1;
        this.options.onProgress?.(done, total);
      },
      saveLocalConflictCopy: async (syncId, path, body, conflictName) => {
        const meta = await context.saveLocalConflictCopy(syncId, path, body, conflictName);
        done += 1;
        this.options.onProgress?.(done, total);
        return meta;
      },
    };

    const result = await runSyncActions(actions, localManifest, wrappedContext);

    // 写回远端 manifest（带版本戳）与本地缓存。
    await driver.mkdir(directoryName === '' ? '.' : directoryName);
    const manifestPath = `${directoryName === '' ? '' : `${directoryName}/`}${SYNC_MANIFEST_FILE}`;
    await driver.write(manifestPath, Buffer.from(serializeManifest(result.manifest), 'utf-8'));
    await driver.write(`${directoryName === '' ? '' : `${directoryName}/`}${SYNC_FORMAT_VERSION_FILE}`, Buffer.from(String(SYNC_FORMAT_VERSION)));
    await this.library.writeSyncManifestCache(libraryId, serializeManifest(result.manifest));

    return {
      report: this.summarize(snapshot, localManifest, remoteManifest, capabilities, directoryName, actions),
      manifest: result.manifest,
      conflicts: result.conflicts.map((conflict) => ({ syncId: conflict.assetId, conflictCopyPath: conflict.conflictCopyPath })),
    };
  }

  private snapshotToMap(snapshot: Awaited<ReturnType<SyncLibraryPort['syncSnapshot']>>): Map<string, LocalAssetSnapshotEntry> {
    const map = new Map<string, LocalAssetSnapshotEntry>();
    for (const asset of snapshot.assets) {
      map.set(asset.syncId, {
        contentHash: asset.contentHash,
        size: asset.size,
        modifiedAt: asset.modifiedAt,
        path: asset.relativePath,
      });
    }
    return map;
  }

  private async loadRemoteState(
    driver: RemoteStorageDriver,
    directoryName: string,
    libraryId: string,
  ): Promise<{ remoteManifest: SyncManifest; tombstones: Set<string> }> {
    const prefix = directoryName === '' ? '' : `${directoryName}/`;
    const tombstones = new Set<string>();
    let remoteManifest = createEmptyManifest({ libraryId, displayName: '', directoryName });
    try {
      const read = await driver.read(`${prefix}${SYNC_MANIFEST_FILE}`);
      remoteManifest = parseManifest(read.body.toString('utf-8'));
    } catch {
      // 无 manifest：视为首次同步。
    }
    try {
      const entries = await driver.list(`${prefix}${SYNC_TRASH_DIR}/`, '1');
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const match = entry.path.match(/([^/]+)\.json$/);
        if (match) tombstones.add(decodeURIComponent(match[1]!));
      }
    } catch {
      // 无 trash 目录：无墓碑。
    }
    return { remoteManifest, tombstones };
  }

  private async loadLocalManifest(
    libraryId: string,
    library: { libraryId: string; displayName: string },
    directoryName: string,
  ): Promise<SyncManifest> {
    const cached = await this.library.readSyncManifestCache(libraryId);
    if (cached) {
      try {
        return parseManifest(cached);
      } catch {
        // 缓存损坏：重新开始。
      }
    }
    return createEmptyManifest({
      libraryId: library.libraryId,
      displayName: library.displayName,
      directoryName,
    });
  }

  private summarize(
    snapshot: Awaited<ReturnType<SyncLibraryPort['syncSnapshot']>>,
    localManifest: SyncManifest,
    remoteManifest: SyncManifest,
    capabilities: DriverCapabilities,
    directoryName: string,
    actions: ReturnType<typeof planSyncActions>,
  ): SyncPreviewReport {
    let uploads = 0;
    let downloads = 0;
    let conflicts = 0;
    let remoteDeletes = 0;
    let localRecycles = 0;
    for (const action of actions) {
      if (action.type === 'upload') uploads += 1;
      else if (action.type === 'download') downloads += 1;
      else if (action.type === 'conflict') conflicts += 1;
      else if (action.type === 'delete-remote') remoteDeletes += 1;
      else if (action.type === 'delete-local') localRecycles += 1;
    }
    const localKnown = new Set(Object.keys(localManifest.entries));
    const remoteKnown = new Set(Object.keys(remoteManifest.entries));
    return {
      capabilities,
      libraryDirectory: directoryName,
      newLocal: [...snapshot.assets.map((asset) => asset.syncId)].filter((id) => !remoteKnown.has(id)).length,
      newRemote: [...remoteKnown].filter((id) => !localKnown.has(id)).length,
      uploads,
      downloads,
      conflicts,
      remoteDeletes,
      localRecycles,
    };
  }
}
