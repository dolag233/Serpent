import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath, electronLaunchEnv } from './electron-test-helpers';
import manifestFixture from '../fixtures/plugin-manifests/palette-tools.serpent-plugin.json';

test.describe.configure({ timeout: 120_000 });

function writeCompatiblePlugin(directory: string): void {
  const manifest = {
    ...manifestFixture,
    engines: { serpent: '>=0.1.0 <1.0.0', pluginApi: 1 },
  };
  mkdirSync(path.join(directory, 'dist', 'ui'), { recursive: true });
  writeFileSync(path.join(directory, 'serpent-plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(directory, 'dist', 'main.js'), 'export const plugin = true;\n');
  writeFileSync(path.join(directory, 'dist', 'ui', 'index.html'), '<main>plugin</main>\n');
  writeFileSync(path.join(directory, 'README.md'), '# Palette Tools\n');
  writeFileSync(path.join(directory, 'LICENSE'), 'MIT\n');
}

test('installs a library plugin through the settings bridge, then trusts and Safe-Mode toggles it', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-management-e2e-'));
  const libraryName = '插件管理验收';
  const packageDirectory = path.join(temporaryRoot, 'palette-tools');
  writeCompatiblePlugin(packageDirectory);
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
    await expect(dialog.getByText('暂未安装插件。', { exact: true })).toBeVisible();
    await dialog.getByRole('radio', { name: '此资源库' }).click();
    await expect(dialog.getByText('暂未安装插件。', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '选择本地插件…' }).click();

    await expect(dialog.getByText('Palette Tools', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText('等待在此设备上信任', { exact: true })).toBeVisible();
    await expect(dialog.getByText('本地文件夹', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '信任', exact: true }).click();
    await expect(dialog.getByText('已启用', { exact: true })).toBeVisible();

    const safeModeRow = dialog.locator('.plugin-settings-safe-mode');
    await safeModeRow.click();
    await expect(dialog.getByText('已被安全模式停用', { exact: true })).toBeVisible();
    await safeModeRow.click();
    await expect(dialog.getByText('已启用', { exact: true })).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
