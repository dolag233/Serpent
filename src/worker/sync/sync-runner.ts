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

import type { RemoteStorageDriver, RemoteStorageError } from './remote-storage';
import { DriverUnsupportedError } from './remote-storage';
import type { SyncManifest, SyncManifestEntry } from './manifest';
import { SYNC_ASSETS_DIR, SYNC_METADATA_DIR, SYNC_TRASH_DIR } from '../../shared/sync-paths';
import type { SyncAction } from './sync-plan';
import {
  metadataContentHash,
  parseSyncAssetMetadata,
  serializeSyncAssetMetadata,
  type SyncAssetMetadata,
} from './sync-metadata';

/** 可重试错误的自动重试：3 次，指数退避（1s/2s/4s）。 */
const SYNC_RETRY_ATTEMPTS = 3;
const SYNC_RETRY_BASE_MS = 1_000;

function isRetryable(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'retryable' in error
    && (error as RemoteStorageError).retryable === true
  );
}

export async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= SYNC_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === SYNC_RETRY_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_BASE_MS * 2 ** attempt));
    }
  }
  throw lastError;
}

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
  /** 远端单侧改路径：本地按新相对路径搬文件，不重新下载内容。 */
  relocateLocalAsset(assetId: string, relativePath: string): Promise<void>;
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
  readLocalMetadata?(syncId: string): Promise<SyncAssetMetadata>;
  applyRemoteMetadata?(syncId: string, metadata: SyncAssetMetadata): Promise<void>;
  /** 每个动作成功或失败后回调一次，供进度按动作数推进。 */
  onActionComplete?(): void;
}

export interface SyncRunResult {
  manifest: SyncManifest;
  /** 冲突列表（供 UI 通知），每项带双端保存的冲突副本路径。 */
  conflicts: Array<{ assetId: string; conflictCopyPath: string }>;
  uploaded: number;
  downloaded: number;
  movedRemote: number;
  relocatedLocal: number;
  deletedRemote: number;
  recycledLocal: number;
  tombstones: number;
  /** 单资产失败次数；整次会话仍写回已成功条目。 */
  failed: number;
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

/** 上传前确保远端父目录存在（多数服务端不允许 PUT 隐式建目录）。 */
async function ensureRemoteDir(driver: RemoteStorageDriver, remotePath: string): Promise<void> {
  const dir = path.posix.dirname(remotePath);
  if (dir && dir !== '.') await withRetry(() => driver.mkdir(dir));
}

/** 远端 MOVE；服务端不支持时退化为复制 + 删除。from === to 为 no-op。 */
async function moveRemoteFile(driver: RemoteStorageDriver, from: string, to: string): Promise<void> {
  if (from === to) return;
  await ensureRemoteDir(driver, to);
  try {
    await withRetry(() => driver.move(from, to));
    return;
  } catch (error) {
    if (!(error instanceof DriverUnsupportedError)) throw error;
  }
  const read = await withRetry(() => driver.read(from));
  await withRetry(() => driver.write(to, read.body));
  await withRetry(() => driver.delete(from));
}

export async function runSyncActions(
  actions: readonly SyncAction[],
  manifest: SyncManifest,
  context: SyncRunnerContext,
): Promise<SyncRunResult> {
  const result: SyncRunResult = {
    manifest: {
      ...manifest,
      entries: { ...manifest.entries },
    },
    conflicts: [],
    uploaded: 0,
    downloaded: 0,
    movedRemote: 0,
    relocatedLocal: 0,
    deletedRemote: 0,
    recycledLocal: 0,
    tombstones: 0,
    failed: 0,
  };
  const working = result.manifest;
  const { driver } = context;
  const now = context.now();
  const { libraryDirectory } = context;
  const assetPath = (entryPath: string) => assetsPathOf(libraryDirectory, entryPath);
  const metadataPath = (syncId: string) => `${libraryDirectory}/${SYNC_METADATA_DIR}/${syncId}.json`;

  for (const action of actions) {
    try {
      await executeSyncAction(action, working, result, {
        driver,
        context,
        now,
        libraryDirectory,
        assetPath,
        metadataPath,
      });
    } catch {
      result.failed += 1;
    } finally {
      context.onActionComplete?.();
    }
  }
  return result;
}

async function deleteRemoteIfPresent(driver: RemoteStorageDriver, remotePath: string): Promise<void> {
  try {
    await withRetry(() => driver.delete(remotePath));
  } catch (error) {
    if (await driver.exists(remotePath)) throw error;
  }
}

async function executeSyncAction(
  action: SyncAction,
  manifest: SyncManifest,
  result: SyncRunResult,
  scope: {
    driver: RemoteStorageDriver;
    context: SyncRunnerContext;
    now: string;
    libraryDirectory: string;
    assetPath: (entryPath: string) => string;
    metadataPath: (syncId: string) => string;
  },
): Promise<void> {
  const { driver, context, now, libraryDirectory, assetPath, metadataPath } = scope;
  switch (action.type) {
    case 'upload': {
      const body = await context.readLocalAsset(action.assetId);
      const remotePath = assetPath(action.entry.path);
      if (action.previousPath && action.previousPath !== action.entry.path) {
        try {
          await moveRemoteFile(driver, assetPath(action.previousPath), remotePath);
        } catch {
          // 旧路径可能已不在远端（仅内容变更或上次未同步移动），继续 PUT 新路径。
        }
      }
      await ensureRemoteDir(driver, remotePath);
      const written = await withRetry(() => driver.write(remotePath, body, {
        ...(action.entry.etag === undefined ? {} : { ifMatch: action.entry.etag }),
      }));
      const entry: SyncManifestEntry = { ...action.entry, etag: written.etag, deviceId: context.deviceId, modifiedAt: now };
      manifest.entries[action.assetId] = entry;
      result.uploaded += 1;
      break;
    }
    case 'download': {
      const remotePath = assetPath(action.entry.path);
      await ensureRemoteDir(driver, remotePath);
      const read = await withRetry(() => driver.read(remotePath));
      await context.writeLocalAsset(action.assetId, action.entry.path, read.body);
      let metadataHash = action.entry.metadataHash;
      let metadataVersion = action.entry.metadataVersion;
      if (context.applyRemoteMetadata) {
        try {
          const sidecar = await driver.read(metadataPath(action.assetId));
          const metadata = parseSyncAssetMetadata(sidecar.body.toString('utf-8'));
          await context.applyRemoteMetadata(action.assetId, metadata);
          metadataHash = metadataContentHash(metadata);
          metadataVersion = Math.max(1, action.entry.metadataVersion);
        } catch {
          // 无 sidecar：只落媒体。
        }
      }
      manifest.entries[action.assetId] = {
        ...action.entry,
        etag: read.etag ?? action.entry.etag,
        ...(metadataHash === undefined ? {} : { metadataHash }),
        metadataVersion,
      };
      result.downloaded += 1;
      break;
    }
    case 'conflict': {
      const conflictName = conflictCopyFileName(action.remote.path, now);
      if (action.winner === 'local') {
        const localBody = await context.readLocalAsset(action.assetId);
        const remoteBody = await withRetry(() => driver.read(assetPath(action.remote.path))).then((read) => read.body);
        const remotePath = assetPath(action.remote.path);
        await ensureRemoteDir(driver, remotePath);
        const written = await withRetry(() => driver.write(remotePath, localBody, {
          ...(action.remote.etag === undefined ? {} : { ifMatch: action.remote.etag }),
        }));
        manifest.entries[action.assetId] = {
          ...action.remote,
          contentHash: action.local.contentHash,
          size: action.local.size,
          version: action.remote.version + 1,
          deviceId: context.deviceId,
          modifiedAt: now,
          etag: written.etag,
        };
        await ensureRemoteDir(driver, assetPath(conflictName));
        await withRetry(() => driver.write(assetPath(conflictName), remoteBody));
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
        const remoteBody = await withRetry(() => driver.read(assetPath(action.remote.path))).then((read) => read.body);
        const localBody = await context.readLocalAsset(action.assetId);
        await context.writeLocalAsset(action.assetId, action.remote.path, remoteBody);
        manifest.entries[action.assetId] = { ...action.remote };
        await ensureRemoteDir(driver, assetPath(conflictName));
        await withRetry(() => driver.write(assetPath(conflictName), localBody));
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
    case 'move-remote': {
      const fromPath = assetPath(action.fromPath);
      const toPath = assetPath(action.entry.path);
      await moveRemoteFile(driver, fromPath, toPath);
      manifest.entries[action.assetId] = {
        ...action.entry,
        deviceId: context.deviceId,
        modifiedAt: now,
      };
      result.movedRemote += 1;
      break;
    }
    case 'relocate-local': {
      await context.relocateLocalAsset(action.assetId, action.entry.path);
      manifest.entries[action.assetId] = { ...action.entry };
      result.relocatedLocal += 1;
      break;
    }
    case 'delete-remote': {
      const entry = manifest.entries[action.assetId];
      if (entry) {
        await deleteRemoteIfPresent(driver, assetPath(entry.path));
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
      await ensureRemoteDir(driver, `${libraryDirectory}/${SYNC_TRASH_DIR}/placeholder.json`);
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
    case 'upload-metadata': {
      const metadata = action.metadata ?? await context.readLocalMetadata?.(action.assetId);
      if (!metadata) break;
      const remotePath = metadataPath(action.assetId);
      await ensureRemoteDir(driver, remotePath);
      await withRetry(() => driver.write(remotePath, Buffer.from(serializeSyncAssetMetadata(metadata), 'utf-8')));
      const previous = manifest.entries[action.assetId];
      manifest.entries[action.assetId] = {
        ...(previous ?? action.entry),
        ...action.entry,
        deviceId: context.deviceId,
        modifiedAt: now,
      };
      break;
    }
    case 'download-metadata': {
      if (!context.applyRemoteMetadata) break;
      const read = await withRetry(() => driver.read(metadataPath(action.assetId)));
      await context.applyRemoteMetadata(action.assetId, parseSyncAssetMetadata(read.body.toString('utf-8')));
      manifest.entries[action.assetId] = { ...action.entry };
      break;
    }
  }
}
