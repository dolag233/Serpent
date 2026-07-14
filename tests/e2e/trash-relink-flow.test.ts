import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test('cancels a batch relink preview and later applies a fresh preview', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-relink-e2e-'));
  const libraryName = '批量找回验收';
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourcePath = path.join(temporaryRoot, 'missing.txt');
  const replacementRoot = path.join(temporaryRoot, 'replacement-root');
  writeFileSync(sourcePath, 'original');
  mkdirSync(replacementRoot);
  writeFileSync(path.join(replacementRoot, 'missing.txt'), 'replacement');

  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: sourcePath,
      SERPENT_E2E_RELINK_ROOT: replacementRoot,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    await expect(window.getByRole('button', { name: /missing\.txt/i })).toBeVisible();

    const managedPath = path.join(libraryPath, 'Assets', 'missing.txt');
    rmSync(managedPath);
    await window.getByRole('button', { name: '刷新磁盘变化' }).click();
    await expect(window.getByRole('button', { name: '批量重新定位' })).toBeVisible();

    await window.getByRole('button', { name: '批量重新定位' }).click();
    const firstPreview = window.getByRole('dialog', { name: '批量重新定位预览' });
    await expect(firstPreview).toContainText('新位置匹配');
    await expect(firstPreview).toContainText('1');
    await firstPreview.getByRole('button', { name: '取消', exact: true }).last().click();
    await expect(firstPreview).toHaveCount(0);
    expect(existsSync(managedPath)).toBe(false);

    await window.getByRole('button', { name: '批量重新定位' }).click();
    const freshPreview = window.getByRole('dialog', { name: '批量重新定位预览' });
    await freshPreview.getByRole('button', { name: '应用批量重新定位' }).click();
    await expect(window.locator('.toast')).toContainText('恢复 1 项');
    expect(readFileSync(managedPath, 'utf8')).toBe('replacement');
    await window.getByRole('button', { name: '刷新磁盘变化' }).click();
    await expect(window.getByRole('button', { name: '批量重新定位' })).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
