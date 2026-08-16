import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { SyncEngine } from '../../src/worker/sync/sync-engine';
import { createLibrarySyncPort } from '../../src/worker/sync/library-port';
import { WebDAVDriver } from '../../src/worker/sync/webdav-driver';
import { parseManifest } from '../../src/worker/sync/manifest';
import { SYNC_MANIFEST_FILE, SYNC_ASSETS_DIR, sanitizeSyncDirectoryName } from '../../src/shared/sync-paths';
import { startMockWebDAVServer } from './webdav-fixture-server';

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

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-open-remote-'));
  roots.push(root);
  return root;
}

function importFile(service: LibraryService, libraryId: string, filePath: string): void {
  const prepared = service.prepareOrExecuteImport({
    libraryId,
    sourceKind: 'files',
    sourcePaths: [filePath],
  });
  if ('importId' in prepared) {
    service.resolveImport({
      importId: prepared.importId,
      suspectedDuplicate: 'create-copy',
      nameConflict: 'keep-both',
    });
  }
}

describe('open synced library from a WebDAV server (Serpent-xffq)', () => {
  it('lists remote libraries and pulls one into a fresh local library', async () => {
    const server = await startMockWebDAVServer();

    // 机器 A：上传一个库到服务器。
    const serviceA = new LibraryService();
    const rootA = tempRoot();
    const createdA = serviceA.createLibrary({ displayName: '远端库', selectedParentPath: rootA });
    const libraryId = createdA.libraryId;
    const dirName = sanitizeSyncDirectoryName('远端库', libraryId);
    const fileA = path.join(rootA, 'dir', 'a.txt');
    mkdirSync(path.join(rootA, 'dir'), { recursive: true });
    writeFileSync(fileA, 'remote-content');
    importFile(serviceA, libraryId, fileA);
    const engineA = new SyncEngine(createLibrarySyncPort(serviceA), { deviceId: 'device-a' });
    await engineA.syncOnce(libraryId, { id: 'server', baseUrl: server.baseUrl });

    // 列出远端库：根目录 depth 1 → 带 manifest 的子目录。
    const driver = new WebDAVDriver({ baseUrl: server.baseUrl });
    const entries = await driver.list('', '1');
    const remoteLibs: Array<{ libraryId: string; displayName: string; directoryName: string }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      try {
        const manifest = parseManifest((await driver.read(`${entry.path}/${SYNC_MANIFEST_FILE}`)).body.toString('utf-8'));
        remoteLibs.push({ libraryId: manifest.libraryId, displayName: manifest.displayName, directoryName: manifest.directoryName });
      } catch {
        // 跳过非同步库目录
      }
    }
    expect(remoteLibs).toHaveLength(1);
    expect(remoteLibs[0]!.libraryId).toBe(libraryId);
    expect(remoteLibs[0]!.displayName).toBe('远端库');

    // 机器 B：以远端身份创建本地空库并拉取全部资产。
    const serviceB = new LibraryService();
    const rootB = tempRoot();
    const openedB = serviceB.createLibrary({
      displayName: remoteLibs[0]!.displayName,
      selectedParentPath: rootB,
      libraryId: remoteLibs[0]!.libraryId,
    });
    const manifest = parseManifest((await driver.read(`${dirName}/${SYNC_MANIFEST_FILE}`)).body.toString('utf-8'));
    for (const [syncId, entry] of Object.entries(manifest.entries)) {
      const read = await driver.read(`${dirName}/${SYNC_ASSETS_DIR}/${entry.path}`);
      serviceB.applySyncContentUpdate(openedB.libraryId, syncId, entry.path, read.body);
    }
    serviceB.writeSyncManifestCache(openedB.libraryId, JSON.stringify(manifest));

    const snapshotB = serviceB.syncSnapshot(openedB.libraryId);
    expect(snapshotB.assets).toHaveLength(1);
    // 拉取后 B 的资产相对路径与 A 的同步快照一致。
    expect(snapshotB.assets[0]!.relativePath).toBe(serviceA.syncSnapshot(libraryId).assets[0]!.relativePath);
    expect(snapshotB.assets[0]!.contentHash).toBe(serviceA.syncSnapshot(libraryId).assets[0]!.contentHash);
    // 拉取后 B 能直接参与双向同步（manifest 缓存与远端一致）。
    const engineB = new SyncEngine(createLibrarySyncPort(serviceB), { deviceId: 'device-b' });
    const secondB = await engineB.syncOnce(openedB.libraryId, { id: 'server', baseUrl: server.baseUrl });
    expect(secondB.report.uploads).toBe(0);
    expect(secondB.report.downloads).toBe(0);

    serviceA.closeAll();
    serviceB.closeAll();
    await server.close();
  });
});
