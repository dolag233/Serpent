import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { electronLaunchEnv, openAppSettingsDialog, openPluginAdvancedInstallDialog, openPluginSettingsTab, resolveElectronExecutablePath, waitForLibraryLoadingToFinish } from './electron-test-helpers';

// The official plugin is maintained in its own repository. Supply an unpacked
// package explicitly; never install into the developer's real userData/library.
test('renamer first input and repeated parameter changes retain state', async () => {
  test.setTimeout(180_000);
  const source = process.env.SERPENT_E2E_RENAMER_PACKAGE;
  test.skip(!source, 'Set SERPENT_E2E_RENAMER_PACKAGE to an unpacked official Renamer package.');
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-renamer-interaction-'));
  const packageDirectory = path.join(temporaryRoot, 'package');
  for (const entry of ['serpent-plugin.json', 'README.md', 'LICENSE', 'entry', 'src']) {
    cpSync(path.join(source!, entry), path.join(packageDirectory, entry), { recursive: true });
  }
  const imports = Array.from({ length: 150 }, (_, index) => {
    const file = path.join(temporaryRoot, `sample-${index}.txt`);
    writeFileSync(file, `Unique test asset ${index}`);
    return file;
  });
  const appDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const app = await electron.launch({
    args: [appDirectory], cwd: appDirectory, executablePath: resolveElectronExecutablePath(),
    env: electronLaunchEnv({ SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: imports.join(path.delimiter),
      SERPENT_E2E_PLUGIN_PACKAGE: packageDirectory,
    }),
  });
  try {
    const page = await app.firstWindow();
    page.on('console', (message) => {
      if (message.text().includes('PLUGIN_COMMAND_TIMEOUT')) console.info('Renamer command timed out');
    });
    await page.getByRole('button', { name: '创建资源库', exact: true }).click();
    await page.getByRole('textbox', { name: '名称', exact: true }).fill('Renamer Test');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByRole('heading', { name: '导入资产以开始整理' })).toBeVisible();
    await waitForLibraryLoadingToFinish(page);
    const settings = await openAppSettingsDialog(app, page);
    await openPluginSettingsTab(settings);
    const install = await openPluginAdvancedInstallDialog(page, settings);
    await install.getByLabel('安装范围').selectOption('library');
    await install.getByRole('button', { name: '安装文件夹' }).click();
    await expect(settings.getByRole('checkbox', { name: '启用插件' })).toBeEnabled({ timeout: 30_000 });
    page.once('dialog', (dialog) => {
      if (process.env.SERPENT_E2E_NATIVE_CONFIRM !== '1') void dialog.accept();
    });
    await settings.locator('label.plugin-settings-enable-toggle').click();
    await expect(settings.getByRole('checkbox', { name: '启用插件' })).toBeChecked();
    await settings.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '导入文件', exact: true }).first().click();
    await expect(page.locator('.asset-card').first()).toBeVisible({ timeout: 30_000 });
    await page.locator('.asset-card').first().click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.locator('.asset-card').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: '批量重命名', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '批量重命名', exact: true });
    await expect(dialog).toBeVisible();
    console.info('initial focus', await page.evaluate(() => ({
      focused: document.hasFocus(), active: document.activeElement?.tagName,
    })));
    await dialog.getByLabel('添加前缀', { exact: true }).click();
    await page.keyboard.type('test-');
    await expect(dialog.getByLabel('添加前缀', { exact: true })).toHaveValue('test-');
    for (let index = 0; index < 3; index += 1) {
      const started = Date.now();
      await dialog.getByRole('tab', { name: '自动编号', exact: true }).click();
      const toggle = dialog.getByRole('switch', { name: '自动编号', exact: true });
      if (index === 0) await toggle.click();
      await expect(toggle).toBeChecked();
      await dialog.getByLabel('编号格式', { exact: true }).click();
      await page.getByRole('option', { name: '0001、0002、0003', exact: true }).click();
      await expect(toggle).toBeChecked();
      await expect(dialog.getByLabel('固定位数', { exact: true })).toBeVisible();
      console.info('parameter round-trip ms', Date.now() - started);
      await dialog.getByRole('tab', { name: '前缀和后缀', exact: true }).click();
      await expect(dialog.getByLabel('添加前缀', { exact: true })).toHaveValue('test-');
    }
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  } finally {
    await app.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
