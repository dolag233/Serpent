/**
 * 真实 WebDAV 验收（本机已配置的同步服务器）。
 *
 * 只创建 `serpent-e2e-<timestamp>` 临时远端目录，测完删除该目录。
 * 禁止写入或删除用户已有同步文件夹。
 *
 * 凭据从环境变量读取，不写进本文件：
 *   SERPENT_WEBDAV_PROBE_URL / USER / PASS
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { SyncEngine } from '../../src/worker/sync/sync-engine';
import { createLibrarySyncPort } from '../../src/worker/sync/library-port';
import type { SyncRootConfig } from '../../src/worker/sync/sync-engine';
import { WebDAVDriver } from '../../src/worker/sync/webdav-driver';
import { parseManifest } from '../../src/worker/sync/manifest';
import {
  SYNC_ASSETS_DIR,
  SYNC_MANIFEST_FILE,
  SYNC_METADATA_DIR,
  SYNC_TRASH_DIR,
  sanitizeSyncDirectoryName,
} from '../../src/shared/sync-paths';

const probeUrl = process.env.SERPENT_WEBDAV_PROBE_URL;
const TEMP_REMOTE_PREFIX = 'serpent-e2e-';
const roots: string[] = [];

function rootConfig(directoryName: string): SyncRootConfig {
  return {
    id: 'manual-e2e',
    baseUrl: probeUrl!,
    username: process.env.SERPENT_WEBDAV_PROBE_USER,
    password: process.env.SERPENT_WEBDAV_PROBE_PASS,
    allowInsecureTls: true,
    directoryName,
  };
}

function driver(): WebDAVDriver {
  return new WebDAVDriver({
    baseUrl: probeUrl!,
    username: process.env.SERPENT_WEBDAV_PROBE_USER,
    password: process.env.SERPENT_WEBDAV_PROBE_PASS,
    allowInsecureTls: true,
  });
}

function assertSafeRemoteDirectory(directoryName: string): void {
  if (!directoryName.startsWith(TEMP_REMOTE_PREFIX) || directoryName.startsWith('同步测试')) {
    throw new Error(`refusing to touch remote directory: ${directoryName}`);
  }
}

async function removeRemoteTree(remote: WebDAVDriver, directoryName: string): Promise<void> {
  assertSafeRemoteDirectory(directoryName);
  let entries: Array<{ path: string; isDirectory: boolean }> = [];
  try {
    entries = await remote.list(directoryName, 'infinity');
  } catch {
    try {
      entries = await remote.list(`${directoryName}/`, '1');
    } catch {
      entries = [];
    }
  }
  const files = entries
    .filter((entry) => !entry.isDirectory)
    .sort((left, right) => right.path.length - left.path.length);
  const dirs = entries
    .filter((entry) => entry.isDirectory)
    .sort((left, right) => right.path.length - left.path.length);
  for (const file of files) {
    await remote.delete(file.path).catch(() => undefined);
  }
  for (const dir of dirs) {
    await remote.delete(dir.path.endsWith('/') ? dir.path : `${dir.path}/`).catch(() => undefined);
  }
  await remote.delete(`${directoryName}/manifest.json`).catch(() => undefined);
  await remote.delete(`${directoryName}/${SYNC_METADATA_DIR}/`).catch(() => undefined);
  await remote.delete(`${directoryName}/metadata/`).catch(() => undefined);
  await remote.delete(`${directoryName}/${SYNC_ASSETS_DIR}/`).catch(() => undefined);
  await remote.delete(`${directoryName}/${SYNC_TRASH_DIR}/`).catch(() => undefined);
  await remote.delete(`${directoryName}/.serpent-sync/`).catch(() => undefined);
  await remote.delete(`${directoryName}/`).catch(() => undefined);
}

function importFiles(service: LibraryService, libraryId: string, filePaths: string[]): void {
  const prepared = service.prepareOrExecuteImport({
    libraryId,
    sourceKind: 'files',
    sourcePaths: filePaths,
  });
  if ('importId' in prepared) {
    service.resolveImport({
      importId: prepared.importId,
      suspectedDuplicate: 'create-copy',
      nameConflict: 'keep-both',
    });
  }
}

describe.skipIf(!probeUrl)('real WebDAV acceptance (temporary remote library only)', () => {
  it('covers identity, metadata, folder move, and trash without touching existing libraries', async () => {
    const remote = driver();
    const capabilities = await remote.probe();
    expect(capabilities.supportsContentTransfer).toBe(true);

    const libraryName = `${TEMP_REMOTE_PREFIX}${Date.now()}`;
    const changeEvents: Array<{ source?: string; changedCount: number }> = [];
    const serviceA = new LibraryService({
      onAssetsChanged: (event) => changeEvents.push(event),
    });
    const rootA = mkdtempSync(path.join(tmpdir(), 'serpent-sync-devA-'));
    roots.push(rootA);
    const libraryA = serviceA.createLibrary({ displayName: libraryName, selectedParentPath: rootA });
    const directoryName = sanitizeSyncDirectoryName(libraryName, libraryA.libraryId);
    assertSafeRemoteDirectory(directoryName);
    const config = rootConfig(directoryName);

    try {
      writeFileSync(path.join(rootA, 'alpha.txt'), 'alpha-content');
      writeFileSync(path.join(rootA, 'beta.txt'), 'beta-content');
      importFiles(serviceA, libraryA.libraryId, [
        path.join(rootA, 'alpha.txt'),
        path.join(rootA, 'beta.txt'),
      ]);
      const alphaAsset = serviceA.listAssets({ libraryId: libraryA.libraryId, recursive: true })
        .find((asset) => asset.relativeFilePath === 'alpha.txt')!;
      const tag = serviceA.createTag({ libraryId: libraryA.libraryId, name: '角色' });
      serviceA.assignTags({ libraryId: libraryA.libraryId, assetIds: [alphaAsset.assetId], tagIds: [tag.tagId] });
      const currentMeta = serviceA.getAssetMetadata({ libraryId: libraryA.libraryId, assetId: alphaAsset.assetId });
      serviceA.setAssetMetadata({
        libraryId: libraryA.libraryId,
        assetId: alphaAsset.assetId,
        expectedVersion: currentMeta.entityVersion,
        description: '主角设定',
      });
      serviceA.writeAiAnalysisResult({
        libraryId: libraryA.libraryId,
        assetId: alphaAsset.assetId,
        tags: ['风景'],
        description: '城市夜景',
        rating: 5,
        modelId: 'gpt-4o',
        modelVersion: '2024-05-13',
        enabledFields: { description: true, tags: true, rating: true },
      });

      const engineA = new SyncEngine(createLibrarySyncPort(serviceA), { deviceId: 'device-A' });
      const first = await engineA.syncOnce(libraryA.libraryId, config);
      expect(first.report.uploads).toBe(2);
      const remoteAfterA = parseManifest(
        (await remote.read(`${directoryName}/${SYNC_MANIFEST_FILE}`)).body.toString('utf-8'),
      );
      expect(remoteAfterA.libraryId).toBe(libraryA.libraryId);
      expect(await remote.exists(`${directoryName}/${SYNC_ASSETS_DIR}/alpha.txt`)).toBe(true);

      const folder = serviceA.createManagedFolder({ libraryId: libraryA.libraryId, name: '2D' });
      changeEvents.length = 0;
      serviceA.moveAssets({
        libraryId: libraryA.libraryId,
        assetIds: [alphaAsset.assetId],
        targetFolderId: folder.folderId,
      });
      expect(changeEvents.some((event) => event.source === 'client' && event.changedCount >= 1)).toBe(true);
      const afterMove = await engineA.syncOnce(libraryA.libraryId, config);
      expect(afterMove.report.uploads).toBeGreaterThanOrEqual(1);
      expect(await remote.exists(`${directoryName}/${SYNC_ASSETS_DIR}/2D/alpha.txt`)).toBe(true);
      expect(await remote.exists(`${directoryName}/${SYNC_ASSETS_DIR}/alpha.txt`)).toBe(false);

      const serviceB = new LibraryService();
      const rootB = mkdtempSync(path.join(tmpdir(), 'serpent-sync-devB-'));
      roots.push(rootB);
      const libraryB = serviceB.createLibrary({
        displayName: `${libraryName}-b`,
        selectedParentPath: rootB,
      });
      const engineB = new SyncEngine(createLibrarySyncPort(serviceB), { deviceId: 'device-B' });
      const second = await engineB.syncOnce(libraryB.libraryId, config);
      expect(second.report.downloads).toBeGreaterThanOrEqual(2);
      const downloaded = serviceB.listAssets({ libraryId: libraryB.libraryId, recursive: true });
      expect(downloaded.map((asset) => asset.relativeFilePath).sort()).toEqual(['2D/alpha.txt', 'beta.txt']);
      const alphaOnB = downloaded.find((asset) => asset.relativeFilePath.endsWith('alpha.txt'))!;
      const metaB = serviceB.getAssetMetadata({ libraryId: libraryB.libraryId, assetId: alphaOnB.assetId });
      expect(metaB.description).toBe('主角设定');
      expect(metaB.tags.some((item) => item.name === '角色')).toBe(true);
      expect(metaB.tags.some((item) => item.name === '风景' && item.source === 'ai')).toBe(true);
      expect(serviceB.listAiTagNames(libraryB.libraryId, alphaOnB.assetId)).toEqual(['风景']);
      const aiB = serviceB.getAiContent(libraryB.libraryId, alphaOnB.assetId);
      expect(aiB.some((row) => row.fieldName === 'description' && row.value === '城市夜景')).toBe(true);
      expect(aiB.some((row) => row.fieldName === 'rating' && row.value === '5')).toBe(true);
      const remoteAfterB = parseManifest(
        (await remote.read(`${directoryName}/${SYNC_MANIFEST_FILE}`)).body.toString('utf-8'),
      );
      expect(remoteAfterB.libraryId).toBe(libraryA.libraryId);

      const betaOnB = downloaded.find((asset) => asset.relativeFilePath === 'beta.txt')!;
      writeFileSync(serviceB.resolveAssetPath(libraryB.libraryId, betaOnB.assetId), 'beta-updated-by-B');
      const third = await engineB.syncOnce(libraryB.libraryId, config);
      expect(third.report.uploads).toBeGreaterThanOrEqual(1);
      serviceB.closeAll();

      const pull = await engineA.syncOnce(libraryA.libraryId, config);
      expect(pull.report.downloads).toBeGreaterThanOrEqual(1);
      const betaOnA = serviceA.listAssets({ libraryId: libraryA.libraryId, recursive: true })
        .find((asset) => asset.relativeFilePath === 'beta.txt')!;
      expect(readFileSync(serviceA.resolveAssetPath(libraryA.libraryId, betaOnA.assetId), 'utf-8')).toBe('beta-updated-by-B');

      serviceA.trashAssets({ libraryId: libraryA.libraryId, assetIds: [betaOnA.assetId] });
      const afterTrash = await engineA.syncOnce(libraryA.libraryId, config);
      expect(afterTrash.report.remoteDeletes).toBeGreaterThanOrEqual(1);
      expect(await remote.exists(`${directoryName}/${SYNC_ASSETS_DIR}/beta.txt`)).toBe(false);
      const tombstones = await remote.list(`${directoryName}/${SYNC_TRASH_DIR}/`, '1').catch(() => []);
      expect(tombstones.some((entry) => !entry.isDirectory && entry.path.endsWith('.json'))).toBe(true);
      serviceA.closeAll();
    } finally {
      try {
        serviceA.closeAll();
      } catch {
        // already closed
      }
      await removeRemoteTree(remote, directoryName);
    }
  }, 600_000);
});

afterAll(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});
