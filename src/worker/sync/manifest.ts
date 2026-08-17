/**
 * 同步交换格式 manifest（Serpent-xffq）。
 *
 * 远端库目录内的版本清单：以 assetId 为键记录每个同步单元的版本。
 * 内容哈希/版本号是冲突裁决的权威；ETag 用于条件写（CAS），
 * modifiedAt 只作辅助信号。合并遵循条目级"取新者"策略。
 */

import { SYNC_FORMAT_VERSION } from '../../shared/sync-paths';

export interface SyncManifestEntry {
  /** 资产在库内的 portable 相对路径（assets/ 之下）。 */
  path: string;
  /** 文件内容 sha256（十六进制）。 */
  contentHash: string;
  size: number;
  /** 该条目的单调递增写入计数；越大越新。 */
  version: number;
  /** 最近写入设备。 */
  deviceId: string;
  modifiedAt: string;
  /** 远端服务端返回的 ETag（可缺省；用于 If-Match 条件写）。 */
  etag?: string;
  /** 元数据条目版本（标签/评分/描述），独立于文件内容。 */
  metadataVersion: number;
}

export interface SyncManifest {
  formatVersion: number;
  libraryId: string;
  /** 原始库显示名（目录名安全化不影响显示）。 */
  displayName: string;
  /** 安全化后的远端目录名。 */
  directoryName: string;
  entries: Record<string, SyncManifestEntry>;
}

export function createEmptyManifest(input: {
  libraryId: string;
  displayName: string;
  directoryName: string;
}): SyncManifest {
  return {
    formatVersion: SYNC_FORMAT_VERSION,
    libraryId: input.libraryId,
    displayName: input.displayName,
    directoryName: input.directoryName,
    entries: {},
  };
}

export function parseManifest(raw: string): SyncManifest {
  const parsed = JSON.parse(raw) as SyncManifest;
  if (!parsed || typeof parsed !== 'object' || parsed.formatVersion !== SYNC_FORMAT_VERSION) {
    throw new Error(`Unsupported sync manifest format: ${String((parsed as { formatVersion?: unknown } | null)?.formatVersion)}`);
  }
  if (typeof parsed.libraryId !== 'string' || typeof parsed.entries !== 'object' || parsed.entries === null) {
    throw new Error('Malformed sync manifest.');
  }
  return parsed;
}

export function serializeManifest(manifest: SyncManifest): string {
  return JSON.stringify(manifest);
}

/** 条目新旧裁决：version → modifiedAt → hash（一致视为同版本）。 */
export function isNewerEntry(candidate: SyncManifestEntry, current: SyncManifestEntry): boolean {
  if (candidate.version !== current.version) return candidate.version > current.version;
  if (candidate.modifiedAt !== current.modifiedAt) return candidate.modifiedAt > current.modifiedAt;
  return candidate.contentHash > current.contentHash;
}

/**
 * 合并两份 manifest（本地缓存 ↔ 远端）：
 * - 各条目独立取新者（文件级并发写互不干扰）
 * - 双方条目内容哈希相同视为一致，不产生冲突
 * 返回合并结果与冲突条目（同 assetId 两侧都新且哈希不同）。
 */
export function mergeManifests(
  local: SyncManifest,
  remote: SyncManifest,
): { merged: SyncManifest; conflicts: Array<{ assetId: string; local: SyncManifestEntry; remote: SyncManifestEntry }> } {
  const merged = createEmptyManifest({
    libraryId: remote.libraryId,
    displayName: remote.displayName,
    directoryName: remote.directoryName,
  });
  const conflicts: Array<{ assetId: string; local: SyncManifestEntry; remote: SyncManifestEntry }> = [];
  const localOnly = new Set(Object.keys(local.entries));
  const remoteOnly = new Set(Object.keys(remote.entries));

  for (const [assetId, remoteEntry] of Object.entries(remote.entries)) {
    const localEntry = local.entries[assetId];
    localOnly.delete(assetId);
    remoteOnly.delete(assetId);
    if (!localEntry) {
      merged.entries[assetId] = remoteEntry;
      continue;
    }
    if (localEntry.contentHash === remoteEntry.contentHash && localEntry.version === remoteEntry.version) {
      merged.entries[assetId] = remoteEntry;
      continue;
    }
    // 同 assetId 两侧都有写入：内容一致取新者；不一致且双方版本都推进 → 冲突。
    if (localEntry.contentHash !== remoteEntry.contentHash) {
      conflicts.push({ assetId, local: localEntry, remote: remoteEntry });
      merged.entries[assetId] = isNewerEntry(remoteEntry, localEntry) ? remoteEntry : localEntry;
      continue;
    }
    merged.entries[assetId] = isNewerEntry(remoteEntry, localEntry) ? remoteEntry : localEntry;
  }
  for (const assetId of localOnly) {
    merged.entries[assetId] = local.entries[assetId]!;
  }
  return { merged, conflicts };
}
