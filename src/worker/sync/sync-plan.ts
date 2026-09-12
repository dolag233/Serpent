/**
 * 同步动作规划（Serpent-xffq）——SyncEngine 的纯逻辑核心。
 *
 * 输入三份事实：本地资产快照、本地 manifest 缓存、远端 manifest（+墓碑集合），
 * 输出文件级动作列表。规则对应规格 §6.3 决策表：
 * - 不同资产互不干扰（条目级并发）
 * - 同资产单侧内容变更 → upload/download
 * - 同资产单侧路径变更（hash 不变）→ 远端 MOVE / 本地 relocate（GitHub #31 / Serpent-038ecf）
 * - 同资产双侧变更且哈希不同 → 冲突（LWW 定正式版，败者存冲突副本）
 * - 本地删除 → 远端删除 + 墓碑上传；远端墓碑 → 本地进回收站
 * 该模块不触碰 SQLite 与网络，保证可完全单测。
 */

import type { SyncManifest, SyncManifestEntry } from './manifest';
import {
  metadataContentHash,
  type SyncAssetMetadata,
} from './sync-metadata';

export interface LocalAssetSnapshotEntry {
  /** 文件内容 sha256。 */
  contentHash: string;
  size: number;
  modifiedAt: string;
  /** 库内 portable 相对路径。 */
  path: string;
  /** 人标签/描述/评分/收藏与可选 AI 层；缺省表示本轮不规划元数据动作。 */
  metadata?: SyncAssetMetadata;
}

export type SyncAction =
  | {
      type: 'upload';
      assetId: string;
      entry: SyncManifestEntry;
      /** 内容变更前远端仍占用的旧路径；与 entry.path 不同时先 MOVE 再 PUT。 */
      previousPath?: string;
    }
  | { type: 'download'; assetId: string; entry: SyncManifestEntry }
  | {
      type: 'conflict';
      assetId: string;
      local: SyncManifestEntry;
      remote: SyncManifestEntry;
      /** LWW 裁决后成为正式版本的一方。 */
      winner: 'local' | 'remote';
    }
  | {
      type: 'move-remote';
      assetId: string;
      /** 远端当前路径（库内 portable 相对路径，不含 assets/ 前缀）。 */
      fromPath: string;
      entry: SyncManifestEntry;
    }
  | { type: 'relocate-local'; assetId: string; entry: SyncManifestEntry }
  | { type: 'delete-remote'; assetId: string }
  | { type: 'tombstone-upload'; assetId: string }
  | { type: 'delete-local'; assetId: string }
  | {
      type: 'upload-metadata';
      assetId: string;
      entry: SyncManifestEntry;
      metadata: SyncAssetMetadata;
    }
  | { type: 'download-metadata'; assetId: string; entry: SyncManifestEntry };

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

function planPathOnlyAction(input: {
  assetId: string;
  localAsset: LocalAssetSnapshotEntry;
  localEntry: SyncManifestEntry;
  remoteEntry: SyncManifestEntry;
  localPathChanged: boolean;
  remotePathChanged: boolean;
}): SyncAction | undefined {
  const { assetId, localAsset, localEntry, remoteEntry, localPathChanged, remotePathChanged } = input;
  if (!localPathChanged && !remotePathChanged) return undefined;
  if (localPathChanged && !remotePathChanged) {
    return {
      type: 'move-remote',
      assetId,
      fromPath: remoteEntry.path,
      entry: {
        ...localEntry,
        path: localAsset.path,
        version: remoteEntry.version + 1,
        modifiedAt: localAsset.modifiedAt,
      },
    };
  }
  if (!localPathChanged && remotePathChanged) {
    return { type: 'relocate-local', assetId, entry: remoteEntry };
  }
  if (localAsset.path === remoteEntry.path) {
    return {
      type: 'move-remote',
      assetId,
      fromPath: remoteEntry.path,
      entry: {
        ...localEntry,
        path: localAsset.path,
        version: remoteEntry.version,
        modifiedAt: localAsset.modifiedAt,
      },
    };
  }
  const localWins = localAsset.modifiedAt >= remoteEntry.modifiedAt;
  if (localWins) {
    return {
      type: 'move-remote',
      assetId,
      fromPath: remoteEntry.path,
      entry: {
        ...localEntry,
        path: localAsset.path,
        version: remoteEntry.version + 1,
        modifiedAt: localAsset.modifiedAt,
      },
    };
  }
  return { type: 'relocate-local', assetId, entry: remoteEntry };
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
            path: localAsset.path,
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
      const localHashChanged = localAsset.contentHash !== localEntry.contentHash;
      const remoteHashChanged = remoteEntry.contentHash !== localEntry.contentHash;
      const localPathChanged = localAsset.path !== localEntry.path;
      const remotePathChanged = remoteEntry.path !== localEntry.path;
      if (localHashChanged && !remoteHashChanged) {
        const previousPath = remoteEntry.path !== localAsset.path ? remoteEntry.path : undefined;
        actions.push({
          type: 'upload',
          assetId,
          ...(previousPath === undefined ? {} : { previousPath }),
          entry: {
            ...localEntry,
            path: localAsset.path,
            contentHash: localAsset.contentHash,
            size: localAsset.size,
            version: remoteEntry.version + 1,
            modifiedAt: localAsset.modifiedAt,
          },
        });
      } else if (!localHashChanged && remoteHashChanged) {
        actions.push({ type: 'download', assetId, entry: remoteEntry });
      } else if (localHashChanged && remoteHashChanged && localAsset.contentHash !== remoteEntry.contentHash) {
        const localAsEntry: SyncManifestEntry = {
          ...localEntry,
          path: localAsset.path,
          contentHash: localAsset.contentHash,
          size: localAsset.size,
          modifiedAt: localAsset.modifiedAt,
        };
        actions.push({
          type: 'conflict',
          assetId,
          local: localAsEntry,
          remote: remoteEntry,
          winner: conflictWinner(localAsEntry, remoteEntry),
        });
      } else {
        const pathAction = planPathOnlyAction({
          assetId,
          localAsset,
          localEntry,
          remoteEntry,
          localPathChanged,
          remotePathChanged,
        });
        if (pathAction) actions.push(pathAction);
      }
      continue;
    }

    // 远端有、本地无且本地从未同步过（新设备全量下载场景）。
    if (!localAsset && !localEntry && remoteEntry && !remoteTombstone) {
      actions.push({ type: 'download', assetId, entry: remoteEntry });
    }
  }
  occupyConflictingRemotePaths(actions, localAssets, remoteManifest);
  planMetadataActions(actions, input);
  return actions;
}

/**
 * 本地新资产要 PUT 的路径仍被远端另一个 syncId 占用时，先墓碑占用方，
 * 避免再导入同一路径时 If-Match/409 整库 CONFLICT（GitHub #38）。
 */
function occupyConflictingRemotePaths(
  actions: SyncAction[],
  localAssets: Map<string, LocalAssetSnapshotEntry>,
  remoteManifest: SyncManifest,
): void {
  const planned = new Set(
    actions
      .filter((action) => action.type === 'delete-remote' || action.type === 'tombstone-upload')
      .map((action) => action.assetId),
  );
  const remoteByPath = new Map<string, string>();
  for (const [syncId, entry] of Object.entries(remoteManifest.entries)) {
    remoteByPath.set(entry.path, syncId);
  }
  const occupiers = new Set<string>();
  for (const action of [...actions]) {
    if (action.type !== 'upload') continue;
    const occupier = remoteByPath.get(action.entry.path);
    if (!occupier || occupier === action.assetId || localAssets.has(occupier) || planned.has(occupier)) {
      continue;
    }
    actions.unshift({ type: 'tombstone-upload', assetId: occupier });
    actions.unshift({ type: 'delete-remote', assetId: occupier });
    planned.add(occupier);
    occupiers.add(occupier);
  }
  if (occupiers.size === 0) return;
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index]!;
    if (!occupiers.has(action.assetId)) continue;
    if (action.type === 'download' || action.type === 'relocate-local' || action.type === 'delete-local') {
      actions.splice(index, 1);
    }
  }
}

function planMetadataActions(actions: SyncAction[], input: PlanSyncInput): void {
  const { localAssets, localManifest, remoteManifest } = input;
  for (const [assetId, localAsset] of localAssets) {
    if (!localAsset.metadata) continue;
    const localHash = metadataContentHash(localAsset.metadata);
    const localEntry = localManifest.entries[assetId];
    const remoteEntry = remoteManifest.entries[assetId];
    const lastHash = localEntry?.metadataHash ?? remoteEntry?.metadataHash;
    const localChanged = lastHash !== localHash;
    const remoteVersion = remoteEntry?.metadataVersion ?? 0;
    const localVersion = localEntry?.metadataVersion ?? 0;
    if (localChanged && remoteEntry && remoteVersion > localVersion && remoteEntry.metadataHash !== localHash) {
      actions.push({ type: 'download-metadata', assetId, entry: remoteEntry });
      continue;
    }
    if (localChanged) {
      const nextVersion = Math.max(remoteVersion, localVersion) + (localEntry || remoteEntry ? 1 : 0);
      const base = remoteEntry ?? localEntry;
      actions.push({
        type: 'upload-metadata',
        assetId,
        metadata: localAsset.metadata,
        entry: {
          path: localAsset.path,
          contentHash: localAsset.contentHash,
          size: localAsset.size,
          version: base?.version ?? 1,
          deviceId: base?.deviceId ?? '',
          modifiedAt: localAsset.modifiedAt,
          metadataVersion: Math.max(1, nextVersion),
          metadataHash: localHash,
          ...(base?.etag === undefined ? {} : { etag: base.etag }),
        },
      });
      continue;
    }
    if (remoteEntry && remoteVersion > localVersion) {
      actions.push({ type: 'download-metadata', assetId, entry: remoteEntry });
    }
  }
}
