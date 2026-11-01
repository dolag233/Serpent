import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import {
  assetCard,
  importFilesThroughBridge,
  resolveElectronExecutablePath,
  resolveSessionLogPath,
} from './electron-test-helpers';
import { removePathWithSyncRetry } from '../../src/worker/windows-fs-retry';

test.describe.configure({ timeout: 120_000 });

test('restarts an exited Library Worker and restores browsing and search', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-worker-recovery-e2e-'));
  const source = path.join(root, 'example.png');
  writeFileSync(source, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ));
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    application = await electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath: resolveElectronExecutablePath(),
      env: {
        ...process.env,
        SERPENT_E2E: '1',
        SERPENT_E2E_HIDE_WINDOW: '1',
        SERPENT_E2E_USER_DATA_PATH: path.join(root, 'user-data'),
        SERPENT_E2E_CREATE_PARENT_PATH: root,
        SERPENT_E2E_IMPORT_FILES: source,
      },
    });
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill('Worker recovery fixture');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await importFilesThroughBridge(window);
    await expect(assetCard(window, 'example.png')).toBeVisible();
    const beforeCrash = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        serpent: { library: {
          create(input: { displayName: string }): Promise<{ ok: boolean }>;
          listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        } };
      }).serpent.library;
      const created = await api.create({ displayName: 'Second recovery fixture' });
      if (!created.ok) throw new Error('Could not create second fixture library');
      return api.listOpen();
    });
    expect(beforeCrash.ok).toBe(true);
    expect(beforeCrash.value).toHaveLength(2);

    const logPath = resolveSessionLogPath(path.join(root, 'user-data', 'logs'));
    const spawnedPids = (): number[] => readFileSync(logPath, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { scope?: string; context?: { pid?: number } })
      .filter((entry) => entry.scope === 'worker.spawn')
      .map((entry) => entry.context?.pid)
      .filter((pid): pid is number => typeof pid === 'number');
    const firstWorkerPid = spawnedPids()[0];
    expect(firstWorkerPid).toBeGreaterThan(0);
    const processMetrics = await application.evaluate(({ app }) =>
      app.getAppMetrics()
        .filter((metric) => metric.type === 'Utility' && metric.serviceName === 'node.mojom.NodeService')
        .map((metric) => metric.pid));
    expect(processMetrics).toContain(firstWorkerPid);
    process.kill(firstWorkerPid!);
    await expect(window.locator('.workspace-canvas')).toHaveAttribute('inert', '', { timeout: 5_000 });

    await expect.poll(() => spawnedPids().length, { timeout: 30_000 }).toBeGreaterThan(1);
    const secondWorkerPid = spawnedPids().at(-1);
    expect(secondWorkerPid).not.toBe(firstWorkerPid);
    await expect.poll(() => application!.evaluate(({ app }, pid) =>
      app.getAppMetrics().some((metric) => metric.pid === pid), secondWorkerPid),
    ).toBe(true);

    const openLibraries = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        serpent: { library: { listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }> } };
      }).serpent.library;
      return api.listOpen();
    });
    expect(openLibraries.ok).toBe(true);
    expect(openLibraries.value?.map((library) => library.libraryId).sort()).toEqual(
      beforeCrash.value?.map((library) => library.libraryId).sort(),
    );

    const search = window.getByLabel('搜索资源库');
    await search.fill('absent-fixture-query');
    await expect(assetCard(window, 'example.png')).toHaveCount(0);
    await search.fill('example');
    await expect(assetCard(window, 'example.png')).toBeVisible();
    await expect(window.locator('.workspace-canvas')).not.toHaveAttribute('inert', '');
    await expect(window.locator('.workspace-notice')).not.toContainText('未能分类的内部错误');
  } finally {
    if (application && application.process().exitCode === null) await application.close();
    removePathWithSyncRetry(root, { retryLimit: 20, retryDelayMs: 200 });
  }
});
