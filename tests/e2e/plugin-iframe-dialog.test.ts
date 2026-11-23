import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

import type { SerpentLibraryApi } from '../../src/shared/library-api';
import type { SerpentPluginManagerApi } from '../../src/shared/plugin-manager-api';
import {
  chooseStandardOption, electronLaunchEnv, openAppSettingsDialog, openPluginAdvancedInstallDialog,
  openPluginSettingsTab, resolveElectronExecutablePath,
} from './electron-test-helpers';

const pluginId = 'com.serpent.iframe-dialog-probe';

test('shows a plugin dialog and submits after the iframe resizes', async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-iframe-dialog-'));
  const packagePath = path.join(root, 'plugin');
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    mkdirSync(path.join(packagePath, 'entry'), { recursive: true });
    writeFileSync(path.join(packagePath, 'serpent-plugin.json'), JSON.stringify({
      manifestVersion: 1,
      id: pluginId,
      name: 'Iframe Dialog Probe',
      description: 'Exercises a hosted plugin dialog across resize and submit.',
      version: '1.0.0',
      author: 'Serpent',
      license: 'MIT',
      engines: { serpent: '>=0.1.0 <1.0.0', pluginApi: 1 },
      runtime: { mode: 'restricted', entry: 'entry/main.js' },
      permissions: ['ui.dialogs'],
      contributes: {
        commands: [{ id: 'open', title: 'Open probe' }],
        dialogs: [{ id: 'resize', title: 'Resize probe', entry: 'entry/dialog.html', width: 500 }],
      },
    }));
    writeFileSync(path.join(packagePath, 'LICENSE'), 'MIT');
    writeFileSync(path.join(packagePath, 'README.md'), '# Iframe Dialog Probe');
    writeFileSync(path.join(packagePath, 'entry/main.js'), `
      async function setup(serpent) {
        serpent.commands.register('open', async () => {
          const result = await serpent.ui.openDialog({ dialogId: 'resize', payload: { label: 'Visible dialog content' } });
          if (result !== 'submitted') throw new Error('Dialog did not submit');
        });
      }
    `);
    writeFileSync(path.join(packagePath, 'entry/dialog.html'),
      '<!doctype html><meta charset="utf-8"><h1></h1><script src="./dialog.js"></script>');
    writeFileSync(path.join(packagePath, 'entry/dialog.js'), `
      const query = new URLSearchParams(location.search);
      window.addEventListener('message', ({ source, data }) => {
        if (source !== window.parent) return;
        if (data.type === 'plugin-ui.dialog-payload') {
          document.querySelector('h1').textContent = data.payload.label;
          parent.postMessage({ type: 'plugin-ui.dialog-content-size', width: 440, height: 334 }, '*');
        }
        if (data.type === 'plugin-ui.view-unmounted') {
          document.querySelector('h1').textContent = 'Unexpectedly unmounted';
        }
        if (data.type === 'plugin-ui.dialog-request-submit') {
          parent.postMessage({ type: 'plugin-ui.dialog-complete', result: 'submitted' }, '*');
        }
      });
      parent.postMessage({ type: 'plugin-ui.ready', contributionId: 'resize',
        instanceId: query.get('instanceId') ?? decodeURIComponent(location.pathname.split('/')[1]) }, '*');
    `);

    const cwd = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
    app = await electron.launch({
      executablePath: resolveElectronExecutablePath(), cwd, args: [cwd],
      env: electronLaunchEnv({
        SERPENT_E2E: '1',
        SERPENT_E2E_HIDE_WINDOW: '1',
        SERPENT_E2E_USER_DATA_PATH: path.join(root, 'profile'),
        SERPENT_E2E_CREATE_PARENT_PATH: root,
        SERPENT_E2E_PLUGIN_PACKAGE: packagePath,
      }),
    });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '创建资源库' }).click();
    await page.getByRole('textbox', { name: '名称' }).fill('Plugin dialog library');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    const settings = await openAppSettingsDialog(app, page);
    await openPluginSettingsTab(settings);
    const install = await openPluginAdvancedInstallDialog(page, settings);
    await chooseStandardOption(install.getByLabel('安装范围'), 'library');
    await install.getByRole('button', { name: '安装文件夹' }).click();
    await expect(settings.getByText(/Iframe Dialog Probe\s*-\s*v1\.0\.0/)).toBeVisible();
    await settings.locator('label.plugin-settings-enable-toggle').click();
    await page.getByRole('dialog', { name: '确认' }).getByRole('button', { name: '确认', exact: true }).click();
    await expect(settings.getByRole('checkbox', { name: '启用插件' })).toBeChecked();
    await settings.getByRole('button', { name: '关闭' }).click();
    const run = page.evaluate(async (id) => {
      const { library, plugins } = (globalThis as typeof globalThis & {
        serpent: { library: SerpentLibraryApi; plugins: SerpentPluginManagerApi };
      }).serpent;
      const opened = await library.listOpen();
      if (!opened.ok || !opened.value[0]) throw new Error('Expected a library.');
      return plugins.runPluginCommand({
        type: 'plugin-manager.run-command', libraryId: opened.value[0].libraryId, pluginId: id, commandId: 'open',
      });
    }, pluginId);
    const dialog = page.getByRole('dialog', { name: 'Resize probe' });
    const iframe = dialog.locator('iframe');
    await expect(dialog.locator('.plugin-view-host')).toHaveCSS('height', '334px');
    expect((await iframe.boundingBox())?.width).toBeGreaterThan(300);
    await expect(dialog.frameLocator('iframe').getByRole('heading', { name: 'Visible dialog content' })).toBeVisible();
    await dialog.getByRole('button', { name: '开始处理' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(run).resolves.toMatchObject({ ok: true });
  } finally {
    try {
      await app?.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
