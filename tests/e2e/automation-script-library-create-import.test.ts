import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

test('creates a library, then inspects, imports, and restores it through Desktop Console', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-automation-create-import-e2e-'));
  const sourceRoot = path.join(temporaryRoot, 'sources');
  const source = path.join(sourceRoot, 'automation-import.txt');
  const profilePath = path.join(temporaryRoot, 'user-data');
  const libraryName = '自动化建库导入验收';
  mkdirSync(sourceRoot);
  writeFileSync(source, 'automation import fixture');

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = () => electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_AUTOMATION_CONFIRM: '1',
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_RESTORE_RECENT: '1',
      SERPENT_E2E_USER_DATA_PATH: profilePath,
    },
  });

  let application = await launch();
  try {
    let window = await application.firstWindow();
    await expect(window.getByRole('heading', { name: '创建本地资源库' })).toBeVisible();

    // The current Desktop Console is only rendered over an opened library.
    // Create the empty library through the normal UI, then exercise the
    // plan-gated import through the Console.
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByText(libraryName, { exact: true }).first()).toBeVisible();

    await window.getByRole('button', { name: '更多工具' }).click();
    await window.getByRole('menuitem', { name: '自动化脚本' }).click();
    const dialog = window.getByRole('dialog', { name: '自动化脚本' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('当前已绑定资源库');

    await dialog.locator('#script-sandbox-preview-source').fill(`
      const inspected = await serpent.library.inspect();
      const imported = await serpent.files.import({
        sourceKind: 'files',
        sourcePaths: ['${source}'],
      });
      return { inspected, imported };
    `);
    await dialog.getByRole('button', { name: '运行', exact: true }).click();
    await expect(dialog.getByText('返回结果', { exact: true })).toBeVisible();
    const result = dialog.locator('pre').first();
    await expect(result).toContainText(`"${libraryName}"`);
    await expect(result).toContainText('"displayName"');
    await expect(result).not.toContainText(temporaryRoot);

    const importedCard = window.locator('.asset-card', { hasText: 'automation-import.txt' });
    await expect(importedCard).toBeVisible();
    await expect(window.getByText(libraryName, { exact: true }).first()).toBeVisible();
    await dialog.getByRole('button', { name: '关闭' }).click();

    await application.close();
    application = await launch();
    window = await application.firstWindow();
    await expect(window.getByText(libraryName, { exact: true }).first()).toBeVisible();
    await expect(window.locator('.asset-card', { hasText: 'automation-import.txt' })).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('cancels a planned import before retrying it successfully', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-automation-plan-cancel-e2e-'));
  const sourceRoot = path.join(temporaryRoot, 'sources');
  const source = path.join(sourceRoot, 'cancelled-import.txt');
  const profilePath = path.join(temporaryRoot, 'user-data');
  const libraryName = '自动化计划取消验收';
  mkdirSync(sourceRoot);
  writeFileSync(source, 'cancelled import fixture');

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
      SERPENT_E2E_AUTOMATION_CANCEL_ONCE: '1',
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_USER_DATA_PATH: profilePath,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '更多工具' }).click();
    await window.getByRole('menuitem', { name: '自动化脚本' }).click();
    const dialog = window.getByRole('dialog', { name: '自动化脚本' });
    const sourceCode = `
      return await serpent.files.import({
        sourceKind: 'files',
        sourcePaths: ['${source}'],
      });
    `;

    await dialog.locator('#script-sandbox-preview-source').fill(sourceCode);
    await dialog.getByRole('button', { name: '运行', exact: true }).click();
    await expect(dialog.locator('.script-sandbox-preview-result[data-state="failed"]')).toBeVisible();
    await expect(window.locator('.asset-card', { hasText: 'cancelled-import.txt' })).toHaveCount(0);

    await dialog.getByRole('button', { name: '运行', exact: true }).click();
    await expect(dialog.getByText('返回结果', { exact: true })).toBeVisible();
    await expect(dialog.locator('pre').first()).toContainText('"importedCount": 1');
    await expect(window.locator('.asset-card', { hasText: 'cancelled-import.txt' })).toBeVisible();
    await expect(dialog.locator('pre').first()).not.toContainText(temporaryRoot);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
