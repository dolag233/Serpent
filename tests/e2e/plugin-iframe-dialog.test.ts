import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

import type { SerpentLibraryApi } from '../../src/shared/library-api';
import type { SerpentPluginManagerApi } from '../../src/shared/plugin-manager-api';
import {
  assetCard, chooseStandardOption, electronLaunchEnv, importFilesThroughBridge,
  openAppSettingsDialog, openPluginAdvancedInstallDialog,
  openPluginSettingsTab, resolveElectronExecutablePath,
} from './electron-test-helpers';

const pluginId = 'com.serpent.iframe-dialog-probe';

test('hosts iframe and widget dialogs and updates Inspector selection', async () => {
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
      permissions: ['ui.dialogs', 'ui.inspector'],
      contributes: {
        commands: [{ id: 'open', title: 'Open probe' }, { id: 'widget', title: 'Open widget' }],
        dialogs: [{ id: 'resize', title: 'Resize probe', entry: 'entry/dialog.html', width: 500 }],
        views: [{ id: 'selection', title: 'Selection probe', entry: 'entry/selection.html', location: 'inspector' }],
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
        serpent.commands.register('widget', async () => {
          const result = await serpent.ui.openDialog({
            title: 'Multiline probe', submitLabel: 'Save prompt', width: 'wide',
            render: ui => ui.text({ id: 'prompt', label: 'Prompt', value: 'First\\nSecond', multiline: true, rows: 6 }),
          });
          if (result?.prompt !== 'Edited\\nPrompt') throw new Error('Expected multiline value');
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
    writeFileSync(path.join(packagePath, 'entry/selection.html'),
      '<!doctype html><meta charset="utf-8"><output></output><script src="./selection.js"></script>');
    writeFileSync(path.join(packagePath, 'entry/selection.js'), `
      const output = document.querySelector('output');
      window.addEventListener('message', ({ source, data }) => {
        if (source !== window.parent) return;
        if (data.type === 'plugin-ui.view-mounted' || data.type === 'plugin-ui.view-state-changed') {
          output.textContent = JSON.stringify(data.state);
          output.dataset.message = data.type;
        }
      });
      parent.postMessage({ type: 'plugin-ui.ready', contributionId: 'selection',
        instanceId: new URLSearchParams(location.search).get('instanceId')
          ?? decodeURIComponent(location.pathname.split('/')[1]) }, '*');
    `);
    const files = ['first.txt', 'second.txt'].map((name) => {
      const file = path.join(root, name);
      writeFileSync(file, name);
      return file;
    });

    const cwd = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
    app = await electron.launch({
      executablePath: resolveElectronExecutablePath(), cwd, args: [cwd],
      env: electronLaunchEnv({
        SERPENT_E2E: '1',
        SERPENT_E2E_HIDE_WINDOW: '1',
        SERPENT_E2E_USER_DATA_PATH: path.join(root, 'profile'),
        SERPENT_E2E_CREATE_PARENT_PATH: root,
        SERPENT_E2E_PLUGIN_PACKAGE: packagePath,
        SERPENT_E2E_IMPORT_FILES: files.join(path.delimiter),
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
    const runCommand = (commandId: string) => page.evaluate(async ({ id, commandId }) => {
      const { library, plugins } = (globalThis as typeof globalThis & {
        serpent: { library: SerpentLibraryApi; plugins: SerpentPluginManagerApi };
      }).serpent;
      const opened = await library.listOpen();
      if (!opened.ok || !opened.value[0]) throw new Error('Expected a library.');
      return plugins.runPluginCommand({
        type: 'plugin-manager.run-command', libraryId: opened.value[0].libraryId, pluginId: id, commandId,
      });
    }, { id: pluginId, commandId });
    const run = runCommand('open');
    const dialog = page.getByRole('dialog', { name: 'Resize probe' });
    const iframe = dialog.locator('iframe');
    await expect(dialog.locator('.plugin-view-host')).toHaveCSS('height', '334px');
    expect((await iframe.boundingBox())?.width).toBeGreaterThan(300);
    await expect(dialog.frameLocator('iframe').getByRole('heading', { name: 'Visible dialog content' })).toBeVisible();
    await dialog.getByRole('button', { name: '开始处理' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(run).resolves.toMatchObject({ ok: true });

    const widgetRun = runCommand('widget');
    const widget = page.getByRole('dialog', { name: 'Multiline probe' });
    await expect(widget).toHaveAttribute('data-widget-width', 'wide');
    await expect(widget).toHaveCSS('--plugin-widget-dialog-width', '720px');
    const prompt = widget.getByRole('textbox', { name: 'Prompt' });
    await expect(prompt).toHaveAttribute('rows', '6');
    await expect(prompt).toHaveValue('First\nSecond');
    await prompt.fill('Edited\nPrompt');
    await widget.getByRole('button', { name: 'Save prompt' }).click();
    await expect(widgetRun).resolves.toMatchObject({ ok: true });

    await importFilesThroughBridge(page);
    const first = assetCard(page, 'first.txt');
    const second = assetCard(page, 'second.txt');
    await first.click();
    const firstId = await first.getAttribute('data-asset-id');
    const frame = page.locator('iframe.plugin-inspector-view-frame');
    const selection = frame.contentFrame().locator('output');
    await expect(selection).toHaveText(JSON.stringify({ selectedAssetIds: [firstId], primaryAssetId: firstId }));
    await second.click();
    const secondId = await second.getAttribute('data-asset-id');
    await expect(selection).toHaveText(JSON.stringify({ selectedAssetIds: [secondId], primaryAssetId: secondId }));
    await expect(selection).toHaveAttribute('data-message', 'plugin-ui.view-state-changed');
    await first.click({ modifiers: ['Shift'] });
    await expect.poll(async () => {
      const state = JSON.parse(await selection.textContent() ?? '{}');
      return state.selectedAssetIds?.sort();
    }).toEqual([firstId, secondId].sort());

    const longTag = 'lora:'.padEnd(80, 'W');
    await page.evaluate(async ({ name, assetId }) => {
      const { library } = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent;
      const opened = await library.listOpen();
      if (!opened.ok || !opened.value[0] || assetId === null) throw new Error('Expected selected asset.');
      const { libraryId } = opened.value[0];
      const tag = await library.createTag({ libraryId, name });
      if (!tag.ok) throw new Error('Could not create tag.');
      const assigned = await library.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.value.tagId] });
      if (!assigned.ok) throw new Error('Could not assign tag.');
    }, { name: longTag, assetId: secondId });
    await first.click();
    await second.click();
    const tag = page.locator('.inspector-tag-label').filter({ hasText: longTag });
    const tagText = tag.locator('.tag-chip-name');
    await expect(tag).toHaveAttribute('data-hover-tip', longTag);
    await expect(tagText).toHaveCSS('text-overflow', 'ellipsis');
    await expect(tagText).toHaveCSS('white-space', 'nowrap');
    expect(await tagText.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  } finally {
    try {
      await app?.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
