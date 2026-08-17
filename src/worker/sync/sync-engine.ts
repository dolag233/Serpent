/**
 * 同步编排服务（Serpent-xffq）——SyncEngine 的高层入口。
 *
 * 职责：连接配置 → 能力探测 → 快照/远端 manifest/墓碑收集 → plan →
 * runner 执行 → 写回远端 manifest + 本地缓存。库副作用经 SyncLibraryPort
 * 注入（生产实现为 LibraryService 的同步方法集），驱动经 driver 工厂注入，
 * 因此本层可完全单测。
 */

import {
  SYNC_MANIFEST_FILE,
  SYNC_TRASH_DIR,
  sanitizeSyncDirectoryName,
  SYNC_FORMAT_VERSION,
} from '../../shared/sync-paths';
import type { DriverCapabilities, RemoteStorageDriver } from './remote-storage';
import { RemoteStorageError } from './remote-storage';
import { WebDAVDriver } from './webdav-driver';
import {
  createEmptyManifest,
  parseManifest,
  serializeManifest,
  type SyncManifest,
} from './manifest';
import { planSyncActions, type LocalAssetSnapshotEntry } from './sync-plan';
import { runSyncActions, withRetry, type SyncRunnerContext } from './sync-runner';

export interface SyncRootConfig {
  id: string;
  baseUrl: string;
  username?: string;
  password?: string;
  allowInsecureTls?: boolean;
  /** 覆盖库名派生的远端目录名（用户可编辑的同步文件夹名称）。 */
  directoryName?: string;
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
  /**
   * 传输进度回调（Serpent-xffq 增量）：done/total 为已处理动作数，
   * bytesDone/bytesTotal 为已传输与总字节（含上传与下载）。供日志
   * 显示进度条与传输速度；数据传输本身无墙钟超时（用户决定）。
   */
  onProgress?(done: number, total: number, bytesDone: number, bytesTotal: number): void;
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
    const directoryName = sanitizeSyncDirectoryName(root.directoryName ?? snapshot.library.displayName, snapshot.library.libraryId);
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
  async syncOnce(libraryId: string, root: SyncRootConfig): Promise<SyncOutcome> {    const driver = this.buildDriver(root);
    const capabilities = await driver.probe();
    if (!capabilities.supportsContentTransfer) {
      throw new RemoteStorageError('WRITE_UNSUPPORTED', '服务器不支持上传文件，无法用于同步。');
    }
    const snapshot = await this.library.syncSnapshot(libraryId);
    const directoryName = sanitizeSyncDirectoryName(root.directoryName ?? snapshot.library.displayName, snapshot.library.libraryId);
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
    // 预计算总字节：upload=本地大小、download=远端大小、conflict=双端之和。
    let bytesTotal = 0;
    for (const action of actions) {
      if (action.type === 'upload') {
        bytesTotal += localAssets.get(action.assetId)?.size ?? 0;
      } else if (action.type === 'download') {
        bytesTotal += action.entry.size ?? 0;
      } else if (action.type === 'conflict') {
        bytesTotal += (action.local.size ?? 0) + (action.remote.size ?? 0);
      }
    }
    let bytesDone = 0;
    const reportBytes = (body: Buffer) => {
      bytesDone += body.length;
      this.options.onProgress?.(done, total, bytesDone, bytesTotal);
    };
    const wrappedContext: SyncRunnerContext = {
      ...context,
      readLocalAsset: async (syncId) => {
        const body = await context.readLocalAsset(syncId);
        done += 1;
        reportBytes(body);
        return body;
      },
      writeLocalAsset: async (syncId, path, body) => {
        await context.writeLocalAsset(syncId, path, body);
        done += 1;
        reportBytes(body);
      },
      recycleLocalAsset: async (syncId) => {
        await context.recycleLocalAsset(syncId);
        done += 1;
        this.options.onProgress?.(done, total, bytesDone, bytesTotal);
      },
      saveLocalConflictCopy: async (syncId, path, body, conflictName) => {
        const meta = await context.saveLocalConflictCopy(syncId, path, body, conflictName);
        done += 1;
        reportBytes(body);
        return meta;
      },
    };

    const result = await runSyncActions(actions, localManifest, wrappedContext);

    // 写回远端 manifest（带版本戳）与本地缓存。
    await withRetry(() => driver.mkdir(directoryName === '' ? '.' : directoryName));
    const manifestPath = `${directoryName === '' ? '' : `${directoryName}/`}${SYNC_MANIFEST_FILE}`;
    await withRetry(() => driver.write(manifestPath, Buffer.from(serializeManifest(result.manifest), 'utf-8')));
    const metaDir = `${directoryName === '' ? '' : `${directoryName}/`}.serpent-sync`;
    await withRetry(() => driver.mkdir(metaDir));
    await withRetry(() => driver.write(`${metaDir}/format-version`, Buffer.from(String(SYNC_FORMAT_VERSION))));
    await this.library.writeSyncManifestCache(libraryId, serializeManifest(result.manifest));

    return {
      report: this.summarize(snapshot, localManifest, remoteManifest, capabilities, directoryName, actions),
      manifest: result.manifest,
      conflicts: result.conflicts.map((conflict) => ({ syncId: conflict.assetId, conflictCopyPath: conflict.conflictCopyPath })),
    };
  }

  /**
   * 轻量云端变化检测（自动同步轮询）：只读远端 manifest 与本地缓存对比，
   * 不扫描本地资产、不计算差异动作。true = 远端有改动（新增/版本推进/
   * 删除/内容变化），需要一次完整同步。远端无 manifest 视为有变化
   * （首次同步需要初始化）。
   */
  async pollRemoteChange(libraryId: string, root: SyncRootConfig): Promise<boolean> {
    const driver = this.buildDriver(root);
    const library = { libraryId, displayName: root.directoryName ?? '' };
    const directoryName = sanitizeSyncDirectoryName(root.directoryName ?? library.displayName, libraryId);
    const prefix = directoryName === '' ? '' : `${directoryName}/`;
    let remoteManifest: SyncManifest;
    try {
      const read = await driver.read(`${prefix}${SYNC_MANIFEST_FILE}`);
      remoteManifest = parseManifest(read.body.toString('utf-8'));
    } catch {
      // 远端无 manifest：首次同步或远端被清空，都需要一次完整同步。
      return true;
    }
    const cached = await this.library.readSyncManifestCache(libraryId);
    if (!cached) return true;
    let localManifest: SyncManifest;
    try {
      localManifest = parseManifest(cached);
    } catch {
      return true;
    }
    // 逐条比较关键字段；不依赖 JSON 键序（entries 是对象，序列化顺序不定）。
    const remoteEntries = remoteManifest.entries;
    const localEntries = localManifest.entries;
    const remoteKeys = Object.keys(remoteEntries);
    const localKeys = Object.keys(localEntries);
    if (remoteKeys.length !== localKeys.length) return true;
    for (const syncId of remoteKeys) {
      const remote = remoteEntries[syncId];
      const local = localEntries[syncId];
      if (!remote || !local) return true;
      if (
        remote.contentHash !== local.contentHash
        || remote.version !== local.version
        || remote.path !== local.path
        || remote.size !== local.size
        || remote.metadataVersion !== local.metadataVersion
      ) {
        return true;
      }
    }
    return false;
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
