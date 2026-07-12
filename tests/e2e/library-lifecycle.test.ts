import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

test('creates, closes, and reopens a library through the sandboxed UI', async () => {
  const testInfo = test.info();
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-electron-test-'));
  const libraryName = '视觉参考';
  const libraryPath = path.join(temporaryRoot, libraryName);
  const executablePath = process.env.SERPENT_E2E_ELECTRON_EXECUTABLE;
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    ...(executablePath ? { executablePath } : {}),
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
    },
  });

  try {
    const window = await application.firstWindow();
    await expect(window.getByRole('heading', { name: '从一个本地资源库开始' })).toBeVisible();

    const rendererCapabilities = await window.evaluate(() => ({
      hasNodeProcess: typeof globalThis.process !== 'undefined',
      hasRequire: typeof globalThis.require !== 'undefined',
    }));
    expect(rendererCapabilities).toEqual({ hasNodeProcess: false, hasRequire: false });

    const lifecycleEvents = window.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const bridge = globalThis as typeof globalThis & {
            serpent: {
              library: {
                onLifecycle(listener: (event: { type: string }) => void): () => void;
              };
            };
          };
          const eventTypes: string[] = [];
          const unsubscribe = bridge.serpent.library.onLifecycle((event) => {
            eventTypes.push(event.type);
            if (event.type === 'library.closed') {
              unsubscribe();
              resolve(eventTypes);
            }
          });
        }),
    );

    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText(libraryName, { exact: true }).first()).toBeVisible();

    await window.getByRole('button', { name: '关闭资源库' }).click();
    await expect(window.getByRole('heading', { name: '从一个本地资源库开始' })).toBeVisible();
    expect(await lifecycleEvents).toEqual([
      'library.opening',
      'library.opened',
      'library.closed',
    ]);
    await window.getByRole('button', { name: '打开资源库' }).click();
    await expect(window.getByText(libraryName, { exact: true }).first()).toBeVisible();
    const screenshotPath = testInfo.outputPath('library-ready.png');
    await window.screenshot({ path: screenshotPath });
    await testInfo.attach('library-ready', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('releases an open library on quit and reopens it after restart', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-restart-test-'));
  const libraryName = '重启恢复';
  const libraryPath = path.join(temporaryRoot, libraryName);
  const executablePath = process.env.SERPENT_E2E_ELECTRON_EXECUTABLE;
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = () =>
    electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      ...(executablePath ? { executablePath } : {}),
      env: {
        ...process.env,
        SERPENT_E2E: '1',
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      },
    });

  let application = await launch();
  try {
    let window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText(libraryName, { exact: true }).first()).toBeVisible();
    await application.close();

    application = await launch();
    window = await application.firstWindow();
    await window.getByRole('button', { name: '打开资源库' }).click();
    await expect(window.getByText(libraryName, { exact: true }).first()).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
