import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { assetCard, resolveElectronExecutablePath } from './electron-test-helpers';

test('moves a managed asset to a real folder and exposes one visible undo', async () => {
  test.setTimeout(120_000);
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-managed-move-e2e-'));
  const sourcePath = path.join(temporaryRoot, 'move-me.png');
  const libraryName = '托管移动验收';
  const libraryPath = path.join(temporaryRoot, libraryName);
  writeFileSync(sourcePath, 'move-me');

  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: sourcePath,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '添加文件夹' }).click();
    await window.getByLabel('新文件夹名称').fill('Target');
    await window.keyboard.press('Enter');
    // 创建后自动进入新文件夹——回根再导入，让资产落在 Assets 根（测试
    // 断言 move-me.png 在根目录），且 Target 的计数保持 0。
    await window.getByRole('button', { name: /所有资产/ }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();

    const asset = assetCard(window, 'move-me.png');
    await expect(asset).toBeVisible();
    await asset.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '移动到文件夹…' }).click();
    await window.getByLabel('目标文件夹').selectOption({ label: 'Target (0)' });
    await window.getByRole('button', { name: '确认移动' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('已移动 1 项资产');
    await expect(window.getByRole('button', { name: '撤销' })).toBeVisible();
    expect(existsSync(path.join(libraryPath, 'Assets', 'Target', 'move-me.png'))).toBe(true);
    expect(existsSync(path.join(libraryPath, 'Assets', 'move-me.png'))).toBe(false);

    await window.getByRole('button', { name: '撤销' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('已撤回上一步操作（1 项）。');
    await expect(assetCard(window, 'move-me.png')).toBeVisible();
    expect(existsSync(path.join(libraryPath, 'Assets', 'move-me.png'))).toBe(true);
    expect(existsSync(path.join(libraryPath, 'Assets', 'Target', 'move-me.png'))).toBe(false);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
