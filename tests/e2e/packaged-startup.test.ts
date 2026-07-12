import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    await expect(window.getByRole('heading', { name: '从一个本地资源库开始' })).toBeVisible();
    expect(
      await window.evaluate(() => ({
        hasNodeProcess: typeof globalThis.process !== 'undefined',
        hasRequire: typeof globalThis.require !== 'undefined',
      })),
    ).toEqual({ hasNodeProcess: false, hasRequire: false });

    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill(libraryName);
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
