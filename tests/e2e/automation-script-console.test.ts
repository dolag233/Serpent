import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

test('keeps the unbound Console out of the no-library create dialog', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-automation-console-e2e-'));
  const profilePath = path.join(temporaryRoot, 'user-data');
  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: profilePath,
    },
  });

  try {
    const window = await application.firstWindow();
    const welcome = window.getByRole('dialog', { name: '创建本地资源库' });
    await expect(welcome).toBeVisible();
    await expect(welcome.getByRole('button', { name: '自动化脚本' })).toHaveCount(0);
    await expect(window.getByRole('dialog', { name: '自动化脚本' })).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('keeps the background task entry in the opened-library tools menu', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-automation-tools-e2e-'));
  const profilePath = path.join(temporaryRoot, 'user-data');
  const libraryName = '自动化工具菜单验收';
  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_USER_DATA_PATH: profilePath,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText(libraryName, { exact: true }).first()).toBeVisible();

    await window.getByRole('button', { name: '更多工具' }).click();
    await expect(window.getByRole('menuitem', { name: '后台任务' })).toBeVisible();
    await window.getByRole('menuitem', { name: '后台任务' }).click();
    await expect(window.getByRole('dialog', { name: '后台媒体任务' })).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
