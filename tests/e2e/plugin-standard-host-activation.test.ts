import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { closeLibraryViaSwitcher, electronLaunchEnv, resolveElectronExecutablePath } from './electron-test-helpers';
import { PLUGIN_LIBRARY_DATA_DIRECTORY } from '../../src/plugins/plugin-package';

test.describe.configure({ timeout: 180_000 });

const FIXTURE_ROOT = path.resolve('tests/fixtures/plugins/standard-host-probe');

test('activates the fixed standard Host probe and writes library storage', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-host-e2e-'));
  const libraryName = '标准Host探测';
  const packageDirectory = path.join(temporaryRoot, 'standard-host-probe');
  cpSync(FIXTURE_ROOT, packageDirectory, { recursive: true });

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: electronLaunchEnv({
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_PLUGIN_PACKAGE: packageDirectory,
    }),
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();

    await window.getByRole('button', { name: '设置' }).click();
    const dialog = window.getByRole('dialog', { name: '通用设置' });
    await dialog.getByRole('tab', { name: '插件' }).click();
    await expect(dialog.getByText('暂未安装插件。', { exact: true }).first()).toBeVisible();
    await dialog.getByRole('button', { name: '安装插件' }).click();
    const installDialog = window.getByRole('dialog', { name: '安装插件' });
    await expect(installDialog).toBeVisible();
    await installDialog.getByLabel('安装范围').selectOption('library');
    await installDialog.getByRole('button', { name: '安装本地插件' }).click();
    await expect(dialog.getByText('Standard Host Probe', { exact: true })).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: '信任', exact: true }).click();
    await expect(dialog.getByText('已启用', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '关闭' }).click();

    const libraryDirectory = path.join(temporaryRoot, libraryName);
    const storagePath = path.join(
      libraryDirectory,
      PLUGIN_LIBRARY_DATA_DIRECTORY,
      'com.serpent.standard-host-probe.json',
    );

    await expect.poll(() => existsSync(storagePath), {
      timeout: 30_000,
      intervals: [250, 500, 1_000],
    }).toBe(true);

    const document = JSON.parse(readFileSync(storagePath, 'utf8')) as {
      values: Record<string, { activated?: boolean; source?: string }>;
    };
    expect(document.values['host-probe']).toEqual({
      activated: true,
      source: 'standard-host-probe',
    });

    await closeLibraryViaSwitcher(window, libraryName);
    await expect(window.getByRole('heading', { name: '创建本地资源库' })).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
