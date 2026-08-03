import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';
import { DEFAULT_AUTOMATION_RATING_SCRIPT } from '../../src/renderer/script-sandbox-preview-default';

test.describe.configure({ timeout: 120_000 });

test('reopens a saved script from the recent scripts list', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-automation-recent-e2e-'));
  const sourceRoot = path.join(temporaryRoot, 'sources');
  const matchingSource = path.join(sourceRoot, 'Ser-reference.png');
  const savedScript = path.join(temporaryRoot, 'rating.serpent.ts');
  const libraryName = '自动化最近脚本验收';
  mkdirSync(sourceRoot);
  writeFileSync(matchingSource, 'matching asset');

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
      SERPENT_E2E_IMPORT_FILES: matchingSource,
      SERPENT_E2E_SAVE_AUTOMATION_SCRIPT: savedScript,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    await expect(window.getByText('导入完成：新增 1 项。', { exact: true })).toBeVisible();

    await window.getByRole('button', { name: '更多工具' }).click();
    await window.getByRole('menuitem', { name: '自动化脚本' }).click();
    const dialog = window.getByRole('dialog', { name: '自动化脚本' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: '脚本' }).fill(DEFAULT_AUTOMATION_RATING_SCRIPT);
    await dialog.getByRole('button', { name: '保存脚本' }).click();
    await expect(dialog).toContainText('已保存脚本：rating.serpent.ts');
    await expect(dialog.getByRole('button', { name: 'rating.serpent.ts' })).toBeVisible();
    expect(readFileSync(savedScript, 'utf8')).toContain('serpent.assets.setRating');

    await dialog.getByRole('textbox', { name: '脚本' }).fill('return { changed: true };');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toBeHidden();

    await window.getByRole('button', { name: '更多工具' }).click();
    await window.getByRole('menuitem', { name: '自动化脚本' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'rating.serpent.ts' }).click();
    await expect(dialog.getByRole('textbox', { name: '脚本' })).toHaveValue(/serpent\.assets\.setRating/);
    await expect(dialog).toContainText('已保存脚本：rating.serpent.ts');
    await expect(dialog).not.toContainText(temporaryRoot);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
