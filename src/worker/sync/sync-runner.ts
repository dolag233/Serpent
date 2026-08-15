/**
 * 同步动作执行器（Serpent-xffq）。
 *
 * 将 planSyncActions 的产物执行到 RemoteStorageDriver 上，并通过
 * RunnerContext 与应用层交换文件内容（读本地资产/写入下载内容/回收站/
 * 冲突副本）。本模块不触碰 SQLite；所有库副作用经 context 回调。
 *
 * 冲突处理（规格 §6.3）：LWW 决定正式版本，败者内容在双端各保存一份
 * 冲突副本（`name (conflict-YYYYMMDD-HHMM).ext`），并随结果返回供 UI 通知。
 */

import path from 'node:path';

import type { RemoteStorageDriver } from './remote-storage';
import type { SyncManifest, SyncManifestEntry } from './manifest';
import { SYNC_ASSETS_DIR, SYNC_TRASH_DIR } from '../../shared/sync-paths';
import type { SyncAction } from './sync-plan';

export interface SyncRunnerContext {
  driver: RemoteStorageDriver;
  /** 安全化后的库目录名（远端根下的子目录）。 */
  libraryDirectory: string;
  deviceId: string;
  now(): string;
  /** 读本地资产当前内容。 */
  readLocalAsset(assetId: string): Promise<Buffer>;
  /** 把远端内容写入本地资产（新资产或更新）。 */
  writeLocalAsset(assetId: string, relativePath: string, body: Buffer): Promise<void>;
  /** 远端墓碑传播：本地资产进回收站。 */
  recycleLocalAsset(assetId: string): Promise<void>;
  /**
   * 保存冲突副本到本地库（导入为独立资产），返回该副本的新 syncId 与
   * 内容指纹；runner 会把它登记进 manifest（path = conflictName），
   * 使双端下一次同步一致。
   */
  saveLocalConflictCopy(
    assetId: string,
    relativePath: string,
    body: Buffer,
    conflictName: string,
  ): Promise<{ syncId: string; contentHash: string; size: number }>;
}

export interface SyncRunResult {
  manifest: SyncManifest;
  /** 冲突列表（供 UI 通知），每项带双端保存的冲突副本路径。 */
  conflicts: Array<{ assetId: string; conflictCopyPath: string }>;
  uploaded: number;
  downloaded: number;
  deletedRemote: number;
  recycledLocal: number;
  tombstones: number;
}

/** `name.ext` → `name (conflict-YYYYMMDD-HHMM).ext`。 */
export function conflictCopyFileName(originalPath: string, now: string): string {
  const dir = path.posix.dirname(originalPath);
  const base = path.posix.basename(originalPath);
  const dot = base.lastIndexOf('.');
  const stamp = now.replace(/\D/g, '').slice(0, 12);
  const conflictBase = dot > 0
    ? `${base.slice(0, dot)} (conflict-${stamp})${base.slice(dot)}`
    : `${base} (conflict-${stamp})`;
  return dir === '.' ? conflictBase : `${dir}/${conflictBase}`;
}

function assetsPathOf(libraryDirectory: string, entryPath: string): string {
  return `${libraryDirectory}/${SYNC_ASSETS_DIR}/${entryPath}`;
}

export async function runSyncActions(
  actions: readonly SyncAction[],
  manifest: SyncManifest,
  context: SyncRunnerContext,
): Promise<SyncRunResult> {
  const result: SyncRunResult = {
    manifest,
    conflicts: [],
    uploaded: 0,
    downloaded: 0,
    deletedRemote: 0,
    recycledLocal: 0,
    tombstones: 0,
  };
  const { driver } = context;
  const now = context.now();
  const { libraryDirectory } = context;
  const assetPath = (entryPath: string) => assetsPathOf(libraryDirectory, entryPath);

  for (const action of actions) {
    switch (action.type) {
      case 'upload': {
        const body = await context.readLocalAsset(action.assetId);
        const remotePath = assetPath(action.entry.path);
        const written = await driver.write(remotePath, body, { ifMatch: action.entry.etag });
        const entry: SyncManifestEntry = { ...action.entry, etag: written.etag, deviceId: context.deviceId, modifiedAt: now };
        manifest.entries[action.assetId] = entry;
        result.uploaded += 1;
        break;
      }
      case 'download': {
        const remotePath = assetPath(action.entry.path);
        const read = await driver.read(remotePath);
        await context.writeLocalAsset(action.assetId, action.entry.path, read.body);
        manifest.entries[action.assetId] = { ...action.entry, etag: read.etag ?? action.entry.etag };
        result.downloaded += 1;
        break;
      }
      case 'conflict': {
        const conflictName = conflictCopyFileName(action.remote.path, now);
        if (action.winner === 'local') {
          // 正式版 = 本地内容上传；败者（远端内容）双端存冲突副本。
          const localBody = await context.readLocalAsset(action.assetId);
          const remoteBody = await driver.read(assetPath(action.remote.path)).then((read) => read.body);
          const written = await driver.write(assetPath(action.remote.path), localBody, { ifMatch: action.remote.etag });
          manifest.entries[action.assetId] = {
            ...action.remote,
            contentHash: action.local.contentHash,
            size: action.local.size,
            version: action.remote.version + 1,
            deviceId: context.deviceId,
            modifiedAt: now,
            etag: written.etag,
          };
          await driver.write(assetPath(conflictName), remoteBody);
          const copyMeta = await context.saveLocalConflictCopy(action.assetId, action.remote.path, remoteBody, conflictName);
          manifest.entries[copyMeta.syncId] = {
            path: conflictName,
            contentHash: copyMeta.contentHash,
            size: copyMeta.size,
            version: 1,
            deviceId: context.deviceId,
            modifiedAt: now,
            metadataVersion: 1,
          };
          result.uploaded += 2;
        } else {
          // 正式版 = 远端内容落本地；败者（本地内容）双端存冲突副本。
          const remoteBody = await driver.read(assetPath(action.remote.path)).then((read) => read.body);
          const localBody = await context.readLocalAsset(action.assetId);
          await context.writeLocalAsset(action.assetId, action.remote.path, remoteBody);
          manifest.entries[action.assetId] = { ...action.remote };
          await driver.write(assetPath(conflictName), localBody);
          const copyMeta = await context.saveLocalConflictCopy(action.assetId, action.remote.path, localBody, conflictName);
          manifest.entries[copyMeta.syncId] = {
            path: conflictName,
            contentHash: copyMeta.contentHash,
            size: copyMeta.size,
            version: 1,
            deviceId: context.deviceId,
            modifiedAt: now,
            metadataVersion: 1,
          };
          result.downloaded += 1;
          result.uploaded += 1;
        }
        result.conflicts.push({ assetId: action.assetId, conflictCopyPath: conflictName });
        break;
      }
      case 'delete-remote': {
        const entry = manifest.entries[action.assetId];
        if (entry) {
          await driver.delete(assetPath(entry.path));
          result.deletedRemote += 1;
        }
        break;
      }
      case 'tombstone-upload': {
        const entry = manifest.entries[action.assetId];
        const tombstone = JSON.stringify({
          assetId: action.assetId,
          path: entry?.path ?? '',
          deviceId: context.deviceId,
          deletedAt: now,
        });
        await driver.write(`${libraryDirectory}/${SYNC_TRASH_DIR}/${action.assetId}.json`, Buffer.from(tombstone, 'utf-8'));
        delete manifest.entries[action.assetId];
        result.tombstones += 1;
        break;
      }
      case 'delete-local': {
        await context.recycleLocalAsset(action.assetId);
        delete manifest.entries[action.assetId];
        result.recycledLocal += 1;
        break;
      }
    }
  }
  return result;
}
