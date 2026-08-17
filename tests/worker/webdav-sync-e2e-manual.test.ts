/**
 * 手动双设备同步端到端（Serpent-xffq）。
 *
 * 运行（URL 不写进本文件）：
 *   $env:SERPENT_WEBDAV_PROBE_URL='https://<host>/Share/Serpent/'; `
 *   $env:SERPENT_WEBDAV_PROBE_USER='dev'; $env:SERPENT_WEBDAV_PROBE_PASS='...'; `
 *   node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts `
 *     tests/worker/webdav-sync-e2e-manual.test.ts
 *
 * 流程：设备 A 建库导入 → 全量上传；设备 B 建空库 → 全量下载；
 * 设备 B 改一个文件再同步 → 设备 A 同步收到更新。结束后清理远端目录。
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

const probeUrl = process.env.SERPENT_WEBDAV_PROBE_URL;
const roots: string[] = [];

function rootConfig(): SyncRootConfig {
  return {
    id: 'manual-e2e',
    baseUrl: probeUrl!,
    username: process.env.SERPENT_WEBDAV_PROBE_USER,
    password: process.env.SERPENT_WEBDAV_PROBE_PASS,
    allowInsecureTls: true,
  };
}

describe.skipIf(!probeUrl)('manual two-device WebDAV sync end-to-end', () => {
  it('round-trips a library between two devices and cleans up', async () => {
    const service = new LibraryService();
    const libraryName = `同步测试-${Date.now()}`;

    // ── 设备 A：建库 + 导入两个文件 → 全量上传 ──
    const rootA = mkdtempSync(path.join(tmpdir(), 'serpent-sync-devA-'));
    roots.push(rootA);
    const libraryA = service.createLibrary({ displayName: libraryName, selectedParentPath: rootA });
    writeFileSync(path.join(rootA, 'alpha.txt'), 'alpha-content');
    writeFileSync(path.join(rootA, 'beta.txt'), 'beta-content');
    const prepared = service.prepareOrExecuteImport({
      libraryId: libraryA.libraryId,
      sourceKind: 'files',
      sourcePaths: [path.join(rootA, 'alpha.txt'), path.join(rootA, 'beta.txt')],
    });
    if ('importId' in prepared) {
      service.resolveImport({ importId: prepared.importId, suspectedDuplicate: 'create-copy', nameConflict: 'keep-both' });
    }
    const engineA = new SyncEngine(createLibrarySyncPort(service), { deviceId: 'device-A' });
    const first = await engineA.syncOnce(libraryA.libraryId, rootConfig());
    console.log('[sync-e2e] device A first upload:', JSON.stringify(first.report));
    expect(first.report.uploads).toBe(2);
    service.closeAll();

    // ── 设备 B：新库 → 全量下载 ──
    const serviceB = new LibraryService();
    const rootB = mkdtempSync(path.join(tmpdir(), 'serpent-sync-devB-'));
    roots.push(rootB);
    const libraryB = serviceB.createLibrary({ displayName: libraryName, selectedParentPath: rootB });
    const engineB = new SyncEngine(createLibrarySyncPort(serviceB), { deviceId: 'device-B' });
    const second = await engineB.syncOnce(libraryB.libraryId, rootConfig());
    console.log('[sync-e2e] device B download:', JSON.stringify(second.report));
    expect(second.report.downloads).toBe(2);
    const downloaded = serviceB.listAssets({ libraryId: libraryB.libraryId, recursive: true });
    expect(downloaded).toHaveLength(2);
    expect(downloaded.map((asset) => asset.relativeFilePath).sort()).toEqual(['alpha.txt', 'beta.txt']);

    // ── 设备 B 修改 alpha → 同步上传；设备 A 再同步收到更新 ──
    const alphaOnB = serviceB.resolveAssetPath(libraryB.libraryId, downloaded.find((asset) => asset.relativeFilePath === 'alpha.txt')!.assetId);
    writeFileSync(alphaOnB, 'alpha-content-updated-by-B');
    const third = await engineB.syncOnce(libraryB.libraryId, rootConfig());
    console.log('[sync-e2e] device B push update:', JSON.stringify(third.report));
    expect(third.report.uploads).toBe(1);
    serviceB.closeAll();

    const serviceA2 = new LibraryService();
    const reopened = serviceA2.openLibrary(path.join(rootA, libraryName));
    const engineA2 = new SyncEngine(createLibrarySyncPort(serviceA2), { deviceId: 'device-A' });
    const fourth = await engineA2.syncOnce(reopened.libraryId, rootConfig());
    console.log('[sync-e2e] device A pull update:', JSON.stringify(fourth.report));
    expect(fourth.report.downloads).toBe(1);
    const alphaOnA = serviceA2.resolveAssetPath(
      reopened.libraryId,
      serviceA2.listAssets({ libraryId: reopened.libraryId, recursive: true }).find((asset) => asset.relativeFilePath === 'alpha.txt')!.assetId,
    );
    expect(readFileSync(alphaOnA, 'utf-8')).toBe('alpha-content-updated-by-B');
    serviceA2.closeAll();

    // ── 清理远端库目录 ──
    const { sanitizeSyncDirectoryName } = await import('../../src/shared/sync-paths');
    const directory = sanitizeSyncDirectoryName(libraryName, reopened.libraryId);
    const driver = new WebDAVDriver({ baseUrl: probeUrl!, username: process.env.SERPENT_WEBDAV_PROBE_USER, password: process.env.SERPENT_WEBDAV_PROBE_PASS, allowInsecureTls: true });
    await driver.delete(`${directory}/manifest.json`).catch(() => undefined);
    await driver.delete(`${directory}/.serpent-sync/format-version`).catch(() => undefined);
    for (const file of ['alpha.txt', 'beta.txt']) {
      await driver.delete(`${directory}/assets/${file}`).catch(() => undefined);
    }
    await driver.delete(`${directory}/assets/`).catch(() => undefined);
    await driver.delete(`${directory}/trash/`).catch(() => undefined);
    await driver.delete(`${directory}/.serpent-sync/`).catch(() => undefined);
    await driver.delete(`${directory}/`).catch(() => undefined);
    console.log('[sync-e2e] remote cleanup done');
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
