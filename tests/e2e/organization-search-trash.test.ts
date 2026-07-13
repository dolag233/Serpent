import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test('organizes, finds, trashes, and restores an imported asset through the UI', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-organization-e2e-'));
  const sourcePath = path.join(temporaryRoot, 'hero.png');
  const libraryName = '组织搜索验收';
  const libraryPath = path.join(temporaryRoot, libraryName);
  writeFileSync(sourcePath, Buffer.from('hero-image-content'));

  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_IMPORT_FILES: sourcePath,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    const assetCard = window.getByRole('button', { name: /hero\.png/i });
    await expect(assetCard).toBeVisible();

    await window.getByRole('button', { name: '添加标签' }).click();
    await window.getByPlaceholder('输入标签名称，回车创建').fill('角色');
    await window.getByPlaceholder('输入标签名称，回车创建').press('Enter');
    await expect(window.getByRole('button', { name: /角色/ })).toBeVisible();

    await window.getByRole('button', { name: '添加合集' }).click();
    await window.getByPlaceholder('输入合集名称，回车创建').fill('精选');
    await window.getByPlaceholder('输入合集名称，回车创建').press('Enter');
    await expect(window.getByRole('button', { name: /精选/ })).toBeVisible();

    await assetCard.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加标签：角色' }).click();
    await expect(window.locator('.toast')).toContainText('标签已添加');
    await window.getByRole('button', { name: /角色/ }).click();
    await expect(window.getByRole('button', { name: /hero\.png/i })).toBeVisible();

    await window.getByRole('button', { name: /所有资产/ }).click();
    await window.getByRole('button', { name: /hero\.png/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '加入合集：精选' }).click();
    await expect(window.locator('.toast')).toContainText('资产已加入合集');
    await window.getByRole('button', { name: /精选/ }).click();
    await expect(window.getByRole('button', { name: /hero\.png/i })).toBeVisible();

    await window.getByRole('button', { name: /hero\.png/i }).click();
    const labelInput = window.getByLabel('标签 (Label)');
    await expect(labelInput).toBeVisible();
    await labelInput.fill('英雄资产');
    await labelInput.press('Enter');
    await expect(window.getByText(/版本 1/)).toBeVisible();
    await window.getByRole('button', { name: '4 星' }).click();
    await expect(window.getByText(/版本 2/)).toBeVisible();
    await window.getByRole('button', { name: '标记喜欢' }).click();
    await expect(window.getByText(/版本 3/)).toBeVisible();

    await window.getByLabel('搜索资源库').fill('英雄资产');
    await window.getByText('仅喜欢', { exact: true }).click();
    await window.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(window.locator('.toast')).toContainText('找到 1 项');
    await expect(window.getByRole('button', { name: /hero\.png/i })).toBeVisible();

    await window.getByLabel('智能合集标题').fill('英雄精选');
    await window.getByRole('button', { name: '保存', exact: true }).click();
    await expect(window.getByRole('button', { name: '英雄精选', exact: true })).toBeVisible();
    await window.getByRole('button', { name: '英雄精选', exact: true }).click();
    await expect(window.getByRole('button', { name: /hero\.png/i })).toBeVisible();

    await window.getByRole('button', { name: /所有资产/ }).click();
    await window.getByRole('button', { name: /hero\.png/i }).click();
    await window.getByRole('button', { name: '删除', exact: true }).click();
    await expect(window.locator('.toast')).toContainText('已移入回收站');
    await window.getByRole('button', { name: '回收站', exact: true }).click();
    await window.getByRole('button', { name: /hero\.png/i }).click();
    await window.getByRole('button', { name: '恢复到原位置' }).click();
    await expect(window.locator('.toast')).toContainText('已恢复至原位置');
    await window.getByRole('button', { name: /所有资产/ }).click();
    await expect(window.getByRole('button', { name: /hero\.png/i })).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
