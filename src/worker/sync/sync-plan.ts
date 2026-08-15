/**
 * 同步动作规划（Serpent-xffq）——SyncEngine 的纯逻辑核心。
 *
 * 输入三份事实：本地资产快照、本地 manifest 缓存、远端 manifest（+墓碑集合），
 * 输出文件级动作列表。规则对应规格 §6.3 决策表：
 * - 不同资产互不干扰（条目级并发）
 * - 同资产单侧变更 → upload/download
 * - 同资产双侧变更且哈希不同 → 冲突（LWW 定正式版，败者存冲突副本）
 * - 本地删除 → 远端删除 + 墓碑上传；远端墓碑 → 本地进回收站
 * 该模块不触碰 SQLite 与网络，保证可完全单测。
 */

import type { SyncManifest, SyncManifestEntry } from './manifest';

export interface LocalAssetSnapshotEntry {
  /** 文件内容 sha256。 */
  contentHash: string;
  size: number;
  modifiedAt: string;
}

export type SyncAction =
  | { type: 'upload'; assetId: string; entry: SyncManifestEntry }
  | { type: 'download'; assetId: string; entry: SyncManifestEntry }
  | {
      type: 'conflict';
      assetId: string;
      local: SyncManifestEntry;
      remote: SyncManifestEntry;
      /** LWW 裁决后成为正式版本的一方。 */
      winner: 'local' | 'remote';
    }
  | { type: 'delete-remote'; assetId: string }
  | { type: 'tombstone-upload'; assetId: string }
  | { type: 'delete-local'; assetId: string };

export interface PlanSyncInput {
  /** 本地资产当前快照（路径 → 指纹）。 */
  localAssets: Map<string, LocalAssetSnapshotEntry>;
  /** 本地 manifest 缓存（上次同步点）。 */
  localManifest: SyncManifest;
  /** 远端 manifest（已拉取解析）。 */
  remoteManifest: SyncManifest;
  /** 远端墓碑集合（trash/ 下的 assetId）。 */
  remoteTombstones: Set<string>;
}

function conflictWinner(local: SyncManifestEntry, remote: SyncManifestEntry): 'local' | 'remote' {
  if (remote.version !== local.version) return remote.version > local.version ? 'remote' : 'local';
  return remote.modifiedAt > local.modifiedAt ? 'remote' : 'local';
}

export function planSyncActions(input: PlanSyncInput): SyncAction[] {
  const { localAssets, localManifest, remoteManifest, remoteTombstones } = input;
  const actions: SyncAction[] = [];
  const assetIds = new Set([
    ...localAssets.keys(),
    ...Object.keys(localManifest.entries),
    ...Object.keys(remoteManifest.entries),
    ...remoteTombstones,
  ]);

  for (const assetId of assetIds) {
    const localAsset = localAssets.get(assetId);
    const localEntry = localManifest.entries[assetId];
    const remoteEntry = remoteManifest.entries[assetId];
    const remoteTombstone = remoteTombstones.has(assetId);

    // 远端墓碑：远端用户删除 → 本地进回收站（删除动作由应用层执行）。
    if (localAsset && remoteTombstone) {
      actions.push({ type: 'delete-local', assetId });
      continue;
    }

    // 本地删除：本地已无该资产但上次同步点存在。
    if (!localAsset && localEntry) {
      if (remoteEntry && !remoteTombstone) {
        actions.push({ type: 'delete-remote', assetId });
      }
      actions.push({ type: 'tombstone-upload', assetId });
      continue;
    }

    // 本地新资产（上次同步点不存在）。
    if (localAsset && !localEntry) {
      if (!remoteEntry) {
        actions.push({
          type: 'upload',
          assetId,
          entry: {
            path: localManifest.entries[assetId]?.path ?? '', // 应用层填充实际路径
            contentHash: localAsset.contentHash,
            size: localAsset.size,
            version: 1,
            deviceId: '',
            modifiedAt: localAsset.modifiedAt,
            metadataVersion: 1,
          },
        });
      } else if (remoteEntry.contentHash !== localAsset.contentHash) {
        // 新导入资产与远端已有同名不同内容：LWW 裁决。
        const localAsEntry: SyncManifestEntry = {
          path: remoteEntry.path,
          contentHash: localAsset.contentHash,
          size: localAsset.size,
          version: remoteEntry.version + 1,
          deviceId: '',
          modifiedAt: localAsset.modifiedAt,
          metadataVersion: remoteEntry.metadataVersion,
        };
        actions.push({
          type: 'conflict',
          assetId,
          local: localAsEntry,
          remote: remoteEntry,
          winner: conflictWinner(localAsEntry, remoteEntry),
        });
      }
      // 哈希一致：无需动作。
      continue;
    }

    // 双侧已知条目。
    if (localAsset && localEntry && remoteEntry) {
      const localChanged = localAsset.contentHash !== localEntry.contentHash;
      const remoteChanged = remoteEntry.contentHash !== localEntry.contentHash;
      if (localChanged && !remoteChanged) {
        actions.push({
          type: 'upload',
          assetId,
          entry: {
            ...localEntry,
            contentHash: localAsset.contentHash,
            size: localAsset.size,
            version: remoteEntry.version + 1,
            modifiedAt: localAsset.modifiedAt,
          },
        });
      } else if (!localChanged && remoteChanged) {
        actions.push({ type: 'download', assetId, entry: remoteEntry });
      } else if (localChanged && remoteChanged && localAsset.contentHash !== remoteEntry.contentHash) {
        actions.push({
          type: 'conflict',
          assetId,
          local: { ...localEntry, contentHash: localAsset.contentHash, size: localAsset.size, modifiedAt: localAsset.modifiedAt },
          remote: remoteEntry,
          winner: conflictWinner(
            { ...localEntry, contentHash: localAsset.contentHash, size: localAsset.size, modifiedAt: localAsset.modifiedAt },
            remoteEntry,
          ),
        });
      }
      // 双侧哈希一致（或都未变）：无需动作。
      continue;
    }

    // 远端有、本地无且本地从未同步过（新设备全量下载场景）。
    if (!localAsset && !localEntry && remoteEntry && !remoteTombstone) {
      actions.push({ type: 'download', assetId, entry: remoteEntry });
    }
  }
  return actions;
}
