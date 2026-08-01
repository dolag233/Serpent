import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

test('opens an unbound Console from the welcome shell and binds after library.create', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-automation-console-e2e-'));
  const profilePath = path.join(temporaryRoot, 'user-data');
  const libraryName = '自动化脚本无库验收';
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
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_USER_DATA_PATH: profilePath,
    },
  });

  try {
    const window = await application.firstWindow();
    const welcome = window.getByRole('dialog', { name: '创建本地资源库' });
    await expect(welcome).toBeVisible();
    await welcome.getByRole('button', { name: '自动化脚本' }).click();

    const consoleDialog = window.getByRole('dialog', { name: '自动化脚本' });
    await expect(consoleDialog).toBeVisible();
    await expect(consoleDialog).toContainText('当前未绑定资源库');
    await expect(consoleDialog).toContainText('运行 library.create');

    await consoleDialog.locator('#script-sandbox-preview-source').fill(`
      return await serpent.library.create({
        displayName: '${libraryName}',
        selectedParentPath: '${temporaryRoot}',
      });
    `);
    await consoleDialog.getByRole('button', { name: '运行', exact: true }).click();

    await expect(consoleDialog).toContainText('本次执行能力');
    await expect(consoleDialog).toContainText('library.create');
    await expect(consoleDialog.getByText('返回结果', { exact: true })).toBeVisible();
    await expect(consoleDialog.locator('pre').first()).toContainText(`"${libraryName}"`);
    await expect(consoleDialog.locator('pre').first()).not.toContainText(temporaryRoot);
    await expect(consoleDialog).toContainText('当前已绑定资源库');
    await expect(window.getByText(libraryName, { exact: true }).first()).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
