import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

test('the packaged application starts and completes a real Worker import', async () => {
  const executablePath = process.env.SERPENT_E2E_PACKAGED_EXECUTABLE;
  if (!executablePath) {
    throw new Error('Set SERPENT_E2E_PACKAGED_EXECUTABLE after packaging.');
  }

  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-packaged-test-'));
  const libraryName = 'Packaged Worker';
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourcePath = path.join(temporaryRoot, 'packaged-worker.txt');
  writeFileSync(sourcePath, 'packaged Worker round trip');

  const application = await electron.launch({
    executablePath,
    args: [],
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
    },
  });

  try {
    await application.evaluate(
      ({ dialog }, paths) => {
        dialog.showOpenDialog = async (...args: unknown[]) => {
          const options = args.at(-1) as { title?: string };
          const selectedPath = options.title === 'Create Library'
            ? paths.temporaryRoot
            : paths.sourcePath;
          return { canceled: false, filePaths: [selectedPath] };
        };
      },
      { sourcePath, temporaryRoot },
    );

    const window = await application.firstWindow();
    await expect(window.getByRole('heading', { name: '创建本地资源库' })).toBeVisible();
    expect(
      await window.evaluate(() => ({
        hasNodeProcess: typeof globalThis.process !== 'undefined',
        hasRequire: typeof globalThis.require !== 'undefined',
      })),
    ).toEqual({ hasNodeProcess: false, hasRequire: false });

    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText(libraryName, { exact: true }).first()).toBeVisible();

    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    await expect(window.getByText('packaged-worker.txt', { exact: true })).toBeVisible();
    expect(existsSync(path.join(libraryPath, 'Assets', 'packaged-worker.txt'))).toBe(true);

    const screenshotPath = test.info().outputPath('packaged-worker-import.png');
    await window.screenshot({ path: screenshotPath });
    await test.info().attach('packaged-worker-import', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('the packaged application FTS5 search finds and filters imported assets', async () => {
  const executablePath = process.env.SERPENT_E2E_PACKAGED_EXECUTABLE;
  if (!executablePath) {
    throw new Error('Set SERPENT_E2E_PACKAGED_EXECUTABLE after packaging.');
  }

  const VALID_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-packaged-search-'));
  const libraryName = 'Packaged Search';
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourcePath = path.join(temporaryRoot, 'search-smoke-test.png');
  writeFileSync(sourcePath, VALID_PNG);

  const application = await electron.launch({
    executablePath,
    args: [],
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
    },
  });

  try {
    await application.evaluate(
      ({ dialog }, paths) => {
        dialog.showOpenDialog = async (...args: unknown[]) => {
          const options = args.at(-1) as { title?: string };
          const selectedPath = options.title === 'Create Library'
            ? paths.temporaryRoot
            : paths.sourcePath;
          return { canceled: false, filePaths: [selectedPath] };
        };
      },
      { sourcePath, temporaryRoot },
    );

    const window = await application.firstWindow();
    await expect(window.getByRole('heading', { name: '创建本地资源库' })).toBeVisible();

    // Create library
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText(libraryName, { exact: true }).first()).toBeVisible();

    // Import a real valid PNG so the asset is searchable via FTS5
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    await expect(window.getByText('search-smoke-test.png', { exact: true })).toBeVisible();
    expect(existsSync(path.join(libraryPath, 'Assets', 'search-smoke-test.png'))).toBe(true);

    // FTS5 keyword search: matching keyword finds the asset
    await window.getByLabel('搜索资源库').fill('smoke');
    await expect(
      window.getByRole('button', { name: /search-smoke-test\.png/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Non-matching keyword filters the asset out
    await window.getByLabel('搜索资源库').fill('NONEXISTENT_XYZ123');
    await expect(
      window.getByRole('button', { name: /search-smoke-test\.png/i }),
    ).toHaveCount(0, { timeout: 10_000 });

    const screenshotPath = test.info().outputPath('packaged-search-smoke.png');
    await window.screenshot({ path: screenshotPath });
    await test.info().attach('packaged-search-smoke', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('the packaged Windows close button hides the window and keeps the tray process alive', async () => {
  test.skip(process.platform !== 'win32', 'This lifecycle rule is Windows-specific.');
  const executablePath = process.env.SERPENT_E2E_PACKAGED_EXECUTABLE;
  if (!executablePath) {
    throw new Error('Set SERPENT_E2E_PACKAGED_EXECUTABLE after packaging.');
  }

  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-packaged-close-'));
  const application = await electron.launch({
    executablePath,
    args: [],
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
    },
  });
  const childProcess = application.process();

  try {
    const window = await application.firstWindow();
    // Dispatch the renderer handler so a fresh profile's startup backdrop
    // cannot obscure the caption button hit target in automated QA.
    await window.locator('.windows-caption-button-close').dispatchEvent('click');
    await expect
      .poll(() =>
        application.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false,
        ),
      )
      .toBe(false);
    expect(childProcess.exitCode).toBeNull();
  } finally {
    if (childProcess.exitCode === null) {
      await application.evaluate(({ app }) => app.quit());
      await once(childProcess, 'exit');
    }
    await rm(temporaryRoot, { force: true, recursive: true, maxRetries: 20, retryDelay: 250 });
  }
});
