import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

test('runs the default Desktop Console script and rates only its matching assets', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-automation-console-e2e-'));
  const sourceRoot = path.join(temporaryRoot, 'sources');
  const matchingSource = path.join(sourceRoot, 'Ser-reference.png');
  const otherSource = path.join(sourceRoot, 'other-reference.png');
  const savedScript = path.join(temporaryRoot, 'rating.serpent.ts');
  const libraryName = '自动化评分验收';
  mkdirSync(sourceRoot);
  writeFileSync(matchingSource, 'matching asset');
  writeFileSync(otherSource, 'other asset');

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
      SERPENT_E2E_IMPORT_FILES: [matchingSource, otherSource].join(path.delimiter),
      SERPENT_E2E_OPEN_AUTOMATION_SCRIPT: savedScript,
      SERPENT_E2E_SAVE_AUTOMATION_SCRIPT: savedScript,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();

    const matchingCard = window.locator('.asset-card', { hasText: 'Ser-reference.png' });
    await expect(matchingCard).toBeVisible();
    await expect(window.locator('.asset-card', { hasText: 'other-reference.png' })).toBeVisible();
    await expect(window.getByText('导入完成：新增 2 项。', { exact: true })).toBeVisible();
    // Import reveal selects every imported asset on the next content refresh.
    // Wait for that intentional selection before replacing it with the single
    // Inspector target; otherwise the pending reveal would race this click.
    await expect(window.locator('.asset-card[aria-pressed="true"]')).toHaveCount(2);
    await window.keyboard.press('Escape');
    await expect(window.locator('.asset-card[aria-pressed="true"]')).toHaveCount(0);
    await matchingCard.click();
    await expect(matchingCard).toHaveAttribute('aria-pressed', 'true');
    await expect(window.locator('.asset-card[aria-pressed="true"]')).toHaveCount(1);

    await window.getByRole('button', { name: '更多工具' }).click();
    await window.getByRole('menuitem', { name: '自动化脚本' }).click();
    const dialog = window.getByRole('dialog', { name: '自动化脚本' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '保存脚本' }).click();
    await expect(dialog).toContainText('已保存脚本：rating.serpent.ts');
    expect(readFileSync(savedScript, 'utf8')).toContain('serpent.assets.setRating');
    await dialog.getByRole('textbox', { name: '脚本' }).fill('return { changed: true };');
    await dialog.getByRole('button', { name: '打开脚本' }).click();
    await expect(dialog.getByRole('textbox', { name: '脚本' })).toHaveValue(/serpent\.assets\.setRating/);
    await expect(dialog).not.toContainText(temporaryRoot);
    await dialog.getByRole('button', { name: '运行', exact: true }).click();
    await expect(dialog.getByText('返回结果', { exact: true })).toBeVisible();
    await expect(dialog.locator('pre').first()).toContainText('"matched": 1');
    await expect(dialog.locator('pre').first()).toContainText('"updatedCount": 1');
    await dialog.getByRole('button', { name: '查看此次运行日志' }).last().click();
    await expect(dialog).toBeHidden();
    const logDialog = window.getByRole('dialog', { name: '诊断日志' });
    await expect(logDialog).toBeVisible();
    await expect(logDialog).toContainText('automation.execution.completed');
    // The run-log button scopes by the Main-issued log ID. Generic runtime
    // records have only executionId and must not leak into this filtered view.
    await expect(logDialog).not.toContainText('automation.runtime.spawn');
    await logDialog.getByRole('button', { name: '关闭诊断日志' }).click();
    await expect(logDialog).toBeHidden();

    const rating = window.getByRole('group', { name: '评分' });
    await expect(rating.getByRole('button', { name: '4 星' })).toHaveAttribute('data-active', 'true');
    await expect(rating.getByRole('button', { name: '5 星' })).not.toHaveAttribute('data-active', 'true');
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
