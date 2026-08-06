import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import {
  resolveElectronExecutablePath,
  electronLaunchEnv,
} from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

/**
 * Import conflict vs content duplicate are two DIFFERENT flows (Serpent-7gvd):
 * - same-name files → "同名冲突" dialog with THREE options
 *   (自动重命名 / 覆盖 / 跳过);
 * - same-content files → "内容重复" dialog with TWO options
 *   (跳过 / 仍然导入).
 *
 * Flow: the first UI import carries both conflict classes in one batch:
 * two same-basename files with different bytes and a same-content pair. The
 * renderer must show the name-conflict phase first, then the content-duplicate
 * phase after the name decision.
 */
test('name conflicts and content duplicates surface separate dialogs with the right options', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-conflict-flows-e2e-'));
  const libraryName = '冲突流程验收';
  const source = path.join(temporaryRoot, 'source');
  const sameNameDirectory = path.join(source, 'nested');
  mkdirSync(source, { recursive: true });
  mkdirSync(sameNameDirectory, { recursive: true });
  const nameConflictFile = path.join(source, '同名.png');
  const sameNameFile = path.join(sameNameDirectory, '同名.png');
  const duplicateOne = path.join(source, 'original.png');
  const duplicateTwo = path.join(source, 'copy.png');
  writeFileSync(nameConflictFile, 'first-content');
  writeFileSync(sameNameFile, 'second-content');
  writeFileSync(duplicateOne, 'duplicate-bytes');
  writeFileSync(duplicateTwo, 'duplicate-bytes');

  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: electronLaunchEnv({
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: [
        nameConflictFile,
        sameNameFile,
        duplicateOne,
        duplicateTwo,
      ].join(path.delimiter),
    }),
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByRole('button', { name: /当前资源库/ })).toBeVisible();

    // Use the visible import action so App receives the pending conflict plan
    // and opens the same dialogs as a real user journey.
    await window.getByRole('button', { name: '导入文件', exact: true }).click();

    // --- Same-name conflict is presented first and offers three options ---
    const nameDialog = window.getByRole('dialog', { name: '同名冲突' });
    try {
      await expect(nameDialog).toBeVisible({ timeout: 30_000 });
    } catch (error) {
      const cards = await window.locator('.asset-card').count();
      const dialogs = await window.locator('[role="dialog"]').count();
      const body = await window.locator('body').innerText();
      console.log('CONFLICT-DIAG', JSON.stringify({ cards, dialogs, body: body.slice(0, 500) }));
      throw error;
    }
    const nameSelect = nameDialog.locator('#name-conflict-decision');
    expect(await nameSelect.locator('option').allTextContents()).toEqual([
      '自动重命名',
      '覆盖',
      '跳过',
    ]);
    await nameSelect.selectOption({ label: '跳过' });
    await nameDialog.getByRole('button', { name: '跳过并继续' }).click();
    await expect(nameDialog).toBeHidden({ timeout: 15_000 });

    // --- Content duplicate is a separate second phase with two options ---
    const duplicateDialog = window.getByRole('dialog', { name: '内容重复' });
    await expect(duplicateDialog).toBeVisible({ timeout: 15_000 });
    const duplicateSelect = duplicateDialog.locator('#content-duplicate-decision');
    expect(await duplicateSelect.locator('option').allTextContents()).toEqual([
      '跳过',
      '仍然导入',
    ]);
    await duplicateSelect.selectOption({ label: '跳过' });
    await duplicateDialog.getByRole('button', { name: '跳过并继续' }).click();
    await expect(duplicateDialog).toBeHidden({ timeout: 15_000 });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
