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
  writeFileSync(path.join(directory, 'dist', 'main.js'), 'export async function setup() {}\n');
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

    if (process.platform === 'win32') {
      // Windows 无工具栏设置齿轮（8-09~8-12 菜单重构）——从应用菜单栏打开。
      await window.getByRole('button', { name: '主菜单' }).click();
      await window
        .getByRole('menuitem', { name: '设置', exact: true })
        .click();
    } else {
      await window.getByRole('button', { name: '设置' }).click();
    }
    const dialog = window.getByRole('dialog', { name: '通用设置' });
    await dialog.getByRole('tab', { name: '插件' }).click();
    await expect(dialog.getByText('暂未安装插件。', { exact: true }).first()).toBeVisible();
    const globalAutoUpdate = dialog.getByRole('checkbox', { name: '自动更新' });
    await expect(globalAutoUpdate).toBeVisible();
    await expect(globalAutoUpdate).not.toBeChecked();
    await dialog.getByRole('button', { name: '安装插件' }).click();
    const installDialog = window.getByRole('dialog', { name: '安装插件' });
    await expect(installDialog).toBeVisible();
    await expect(installDialog.getByRole('button', { name: '本地安装' })).toBeVisible();
    await expect(installDialog.getByRole('button', { name: '从 GitHub 安装' })).toBeVisible();
    await installDialog.getByRole('button', { name: '从 GitHub 安装' }).click();
    const githubDialog = window.getByRole('dialog', { name: '从 GitHub 安装' });
    await githubDialog.getByRole('textbox', { name: 'GitHub 仓库或 Release 链接' }).fill('not-a-github-repository');
    await githubDialog.getByRole('button', { name: '开始安装' }).click();
    await expect(githubDialog.getByText('请输入有效的 GitHub HTTPS 仓库地址、owner/repository 或 Release 链接。', { exact: true })).toBeVisible();
    await githubDialog.getByRole('button', { name: '返回' }).click();
    await installDialog.getByLabel('安装范围').selectOption('library');
    await installDialog.getByRole('button', { name: '本地安装' }).click();

    const libraryCard = dialog.locator('.plugin-settings-scope-card').filter({ hasText: '资源库插件' });

    await expect(dialog.getByText(/Palette Tools\s*-\s*v/)).toBeVisible({ timeout: 30_000 });
    await expect(libraryCard.getByRole('checkbox', { name: '自动更新' })).toHaveCount(0);
    await expect(libraryCard.getByRole('button', { name: '打开插件目录' })).toBeVisible();
    await expect(libraryCard.getByRole('button', { name: '信任', exact: true })).toHaveCount(0);
    await expect(libraryCard.getByRole('button', { name: '不信任', exact: true })).toHaveCount(0);

    const enableToggle = libraryCard.getByRole('checkbox', { name: '启用插件' });
    await expect(enableToggle).not.toBeChecked();
    await expect(enableToggle).toBeEnabled();
    const enableRow = libraryCard.locator('label.plugin-settings-enable-toggle');
    const cancelledConsent = window.waitForEvent('dialog').then(async (consent) => {
      expect(consent.message()).toContain('Palette Tools');
      await consent.dismiss();
    });
    await Promise.all([cancelledConsent, enableRow.click({ force: true })]);
    await expect(enableToggle).not.toBeChecked();
    const consentDialog = window.waitForEvent('dialog').then(async (consent) => {
      expect(consent.message()).toContain('Palette Tools');
      expect(consent.message()).toContain('asset.read');
      await consent.accept();
    });
    await Promise.all([consentDialog, enableRow.click({ force: true })]);
    await expect(enableToggle).toBeChecked();
    await enableRow.click({ force: true });
    await expect(enableToggle).not.toBeChecked();
    await enableRow.click({ force: true });
    await expect(enableToggle).toBeChecked();

    const safeModeRow = dialog.locator('.plugin-settings-safe-mode');
    await safeModeRow.click();
    // Restricted (palette) plugins stay resolvable under Safe Mode; toggle stays on.
    await expect(enableToggle).toBeChecked();
    await expect(dialog.getByText('已被安全模式停用（无限制模式）', { exact: true })).toHaveCount(0);
    await safeModeRow.click();
    await expect(enableToggle).toBeChecked();
    await expect(libraryCard.getByRole('button', { name: '重新加载插件' })).toBeVisible();
    await expect(libraryCard.getByRole('button', { name: '卸载' })).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
