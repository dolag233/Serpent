import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

test('runs a planned batch file rename through the Desktop Console without exposing a path to the script', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-automation-file-e2e-'));
  const sourceRoot = path.join(temporaryRoot, 'sources');
  const source = path.join(sourceRoot, 'Ser-reference.png');
  const libraryName = '自动化文件计划验收';
  mkdirSync(sourceRoot);
  writeFileSync(source, 'matching asset');

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_AUTOMATION_CONFIRM: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: path.join(temporaryRoot, libraryName),
      SERPENT_E2E_IMPORT_FILES: source,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    await expect(window.locator('.asset-card', { hasText: 'Ser-reference.png' })).toBeVisible();
    await expect(window.getByText('导入完成：新增 1 项。', { exact: true })).toBeVisible();

    await window.getByRole('button', { name: '更多工具' }).click();
    await window.getByRole('menuitem', { name: '自动化脚本' }).click();
    const dialog = window.getByRole('dialog', { name: '自动化脚本' });
    await expect(dialog).toBeVisible();
    await dialog.locator('#script-sandbox-preview-source').fill(`
      const page = await serpent.assets.search({ query: 'name:Ser-reference', limit: 200, offset: 0 });
      const result = await serpent.assets.renameFiles(
        page.items.map((asset) => ({ assetId: asset.id, newBaseName: 'Ser-renamed' })),
      );
      return result;
    `);
    await dialog.getByRole('button', { name: '运行', exact: true }).click();
    await expect(dialog.getByText('返回结果', { exact: true })).toBeVisible();
    await expect(dialog.locator('pre').first()).toContainText('"renamedCount": 1');
    // Neither the result area nor the trusted script object receives an
    // absolute source path; file existence is instead proven by the updated
    // asset card after Main/Worker completes the plan-bound rename.
    await expect(dialog.locator('pre').first()).not.toContainText(temporaryRoot);
    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(window.locator('.asset-card', { hasText: 'Ser-renamed.png' })).toBeVisible();
    await expect(window.locator('.asset-card', { hasText: 'Ser-reference.png' })).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
