import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import sharp from 'sharp';

import { electronLaunchEnv, resolveElectronExecutablePath } from './electron-test-helpers';
import { PLUGIN_LIBRARY_DATA_DIRECTORY } from '../../src/plugins/plugin-package';

test.describe.configure({ timeout: 180_000 });

const FIXTURE_ROOT = path.resolve('tests/fixtures/plugins/unrestricted-settings-probe');
const PLUGIN_ID = 'com.serpent.unrestricted-settings-probe';
const PROBE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWM4kKBwIEGBAUIBACWOBQHzNCW5AAAAAElFTkSuQmCC',
  'base64',
);
const CONTRIBUTION_ID_SUFFIXES = {
  settingsPage: '.settings-page',
  menu: '.menu.asset.probe.write-selection',
  submenu: '.menu.asset.processing',
  submenuItem: '.menu.asset.processing.probe.nested-selection',
} as const;

type ContributionListing = {
  menus: Array<{
    id: string;
    pluginId: string;
    target?: string;
    group?: string;
    parentId?: string;
    before?: string;
    after?: string;
  }>;
  pages: Array<{ id: string; pluginId: string; target?: string; hasUrl: boolean }>;
  error?: 'no-plugin-api';
};

async function listContributions(window: Page, libraryId: string): Promise<ContributionListing> {
  return window.evaluate(async (id) => {
    const api = (window as unknown as {
      serpent?: {
        plugins?: {
          listPluginContributions: (input: {
            libraryId: string;
            target: string;
          }) => Promise<{ contributions: Array<{
            id: string;
            pluginId: string;
            target?: string;
            url?: string;
            group?: string;
            parentId?: string;
            before?: string;
            after?: string;
          }> }>;
        };
      };
    }).serpent?.plugins;
    if (api === undefined) return { error: 'no-plugin-api' as const, menus: [], pages: [] };
    const menus = await api.listPluginContributions({ libraryId: id, target: 'menus.asset' });
    const pages = await api.listPluginContributions({ libraryId: id, target: 'settings.pages' });
    return {
      menus: menus.contributions.map((item) => ({
        id: item.id,
        pluginId: item.pluginId,
        target: item.target,
        group: item.group,
        parentId: item.parentId,
        before: item.before,
        after: item.after,
      })),
      pages: pages.contributions.map((item) => ({
        id: item.id,
        pluginId: item.pluginId,
        target: item.target,
        hasUrl: typeof item.url === 'string' && item.url.startsWith('serpent-plugin:'),
      })),
    };
  }, libraryId);
}

async function readOpenLibraryId(window: Page): Promise<string> {
  const libraryId = await window.evaluate(async () => {
    const api = (window as unknown as {
      serpent?: {
        library?: {
          listOpen: () => Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        };
      };
    }).serpent?.library;
    if (api === undefined) return undefined;
    const open = await api.listOpen();
    return open.ok ? open.value?.[0]?.libraryId : undefined;
  });
  expect(libraryId).toEqual(expect.any(String));
  return libraryId as string;
}

async function expectContributionsAndSettingsIframe(window: Page, libraryId: string): Promise<void> {
  const listed = await listContributions(window, libraryId);
  const contributionId = (suffix: string): RegExp => new RegExp(
    `^${PLUGIN_ID.replaceAll('.', '\\.')}(?:\\.[0-9a-f-]+)?${suffix.replaceAll('.', '\\.')}$`,
  );
  expect(listed).toMatchObject({
    menus: expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringMatching(contributionId(CONTRIBUTION_ID_SUFFIXES.menu)),
        pluginId: PLUGIN_ID,
        group: 'probe',
      }),
      expect.objectContaining({
        id: expect.stringMatching(contributionId(CONTRIBUTION_ID_SUFFIXES.submenu)),
        pluginId: PLUGIN_ID,
        group: 'probe',
      }),
      expect.objectContaining({
        id: expect.stringMatching(contributionId(CONTRIBUTION_ID_SUFFIXES.submenuItem)),
        pluginId: PLUGIN_ID,
        parentId: expect.stringMatching(contributionId(CONTRIBUTION_ID_SUFFIXES.submenu)),
        before: 'asset.rename',
      }),
    ]),
    pages: [expect.objectContaining({
      id: expect.stringMatching(contributionId(CONTRIBUTION_ID_SUFFIXES.settingsPage)),
      pluginId: PLUGIN_ID,
      hasUrl: true,
    })],
  });

  await window.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = window.getByRole('dialog', { name: '通用设置' });
  await dialog.getByRole('tab', { name: '插件' }).click();
  await dialog.locator('.app-settings-nav-plugin-settings-toggle').click();
  await dialog.locator('.app-settings-nav-plugin-settings-item').filter({
    hasText: 'Unrestricted Settings Probe',
  }).click();
  const hostSettings = dialog.locator('.plugin-host-settings-fields');
  const enabledSetting = hostSettings.getByRole('switch', { name: 'Probe enabled' });
  await expect(enabledSetting).toBeVisible();
  if (!(await enabledSetting.isChecked())) {
    await hostSettings.locator('label').filter({ hasText: 'Probe enabled' }).click({ force: true });
  }
  await expect(enabledSetting).toBeChecked();
  const quality = hostSettings.getByRole('combobox', { name: 'Probe quality' });
  await quality.selectOption('high');
  await expect(quality).toHaveValue('high');
  await expect(hostSettings.locator('[data-hover-tip="Choose the probe processing quality."]')).toBeVisible();
  await hostSettings.locator('[data-hover-tip="Choose the probe processing quality."]').hover();
  await expect(window.locator('.hover-tip')).toHaveText('Choose the probe processing quality.');
  await expect(dialog.getByText('该插件暂无设置页。')).toHaveCount(0);
  await expect(dialog.locator('iframe.plugin-settings-page-frame')).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: '关闭' }).click();
}

test('lists menus.asset and settings.pages after enable, and after recent-library restart restore', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-unrestricted-settings-e2e-'));
  const libraryName = '无限制设置探测';
  const userDataPath = path.join(temporaryRoot, 'user-data');
  const packageDirectory = path.join(temporaryRoot, 'unrestricted-settings-probe');
  const sourceDirectory = path.join(temporaryRoot, 'sources');
  const sourcePath = path.join(sourceDirectory, 'probe.png');
  const secondSourcePath = path.join(sourceDirectory, 'probe-two.png');
  cpSync(FIXTURE_ROOT, packageDirectory, { recursive: true });
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(sourcePath, PROBE_PNG);
  await sharp({
    create: {
      width: 3,
      height: 2,
      channels: 4,
      background: { r: 72, g: 150, b: 230, alpha: 1 },
    },
  }).png().toFile(secondSourcePath);

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();

  const launch = async (): Promise<ElectronApplication> => electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: electronLaunchEnv({
      SERPENT_E2E: '1',
      SERPENT_E2E_RESTORE_RECENT: '1',
      SERPENT_E2E_USER_DATA_PATH: userDataPath,
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: [sourcePath, secondSourcePath].join(path.delimiter),
      SERPENT_E2E_PLUGIN_PACKAGE: packageDirectory,
    }),
  });

  let application = await launch();

  try {
    let window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();

    await window.getByRole('button', { name: '设置', exact: true }).click();
    const dialog = window.getByRole('dialog', { name: '通用设置' });
    await dialog.getByRole('tab', { name: '插件' }).click();
    await expect(dialog.getByText('暂未安装插件。', { exact: true }).first()).toBeVisible();
    await dialog.getByRole('button', { name: '安装插件' }).click();
    const installDialog = window.getByRole('dialog', { name: '安装插件' });
    await expect(installDialog).toBeVisible();
    await installDialog.getByLabel('安装范围').selectOption('user');
    await installDialog.getByRole('button', { name: '本地安装' }).click();
    await expect(dialog.getByText(/Unrestricted Settings Probe\s*-\s*v/)).toBeVisible({ timeout: 30_000 });

    const card = dialog.locator('.plugin-settings-scope-card').filter({
      hasText: '全局插件',
    }).locator('.plugin-settings-package').filter({
      hasText: 'Unrestricted Settings Probe',
    });
    await dialog.locator('.app-settings-nav-plugin-settings-toggle').click();
    await expect(dialog.locator('.app-settings-nav-plugin-settings-item').filter({
      hasText: 'Unrestricted Settings Probe',
    })).toBeVisible();
    const enableToggle = card.getByRole('checkbox', { name: '启用插件' });
    await expect(enableToggle).not.toBeChecked();
    await card.locator('.plugin-settings-enable-toggle').click();
    await expect(enableToggle).toBeChecked();

    const libraryDirectory = path.join(temporaryRoot, libraryName);
    const storagePath = path.join(
      libraryDirectory,
      PLUGIN_LIBRARY_DATA_DIRECTORY,
      `${PLUGIN_ID}.json`,
    );
    await expect.poll(() => existsSync(storagePath), {
      timeout: 30_000,
      intervals: [250, 500, 1_000],
    }).toBe(true);

    const libraryId = await readOpenLibraryId(window);

    await dialog.getByRole('button', { name: '关闭' }).click();
    await expectContributionsAndSettingsIframe(window, libraryId);

    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    const probeCard = window.locator('.asset-card[title="probe.png"]');
    const secondProbeCard = window.locator('.asset-card[title="probe-two.png"]');
    await expect(probeCard).toBeVisible({ timeout: 30_000 });
    await expect(secondProbeCard).toBeVisible({ timeout: 30_000 });
    await expect(window.locator('.asset-card')).toHaveCount(2);
    await probeCard.click();
    await expect(window.locator('.asset-card.is-selected')).toHaveCount(1);
    await probeCard.click({ button: 'right' });
    await expect(window.getByRole('menuitem', { name: 'Write unrestricted selection' })).toBeVisible();
    const pngMenuItem = window.getByRole('menuitemcheckbox', { name: 'Write PNG selection' });
    await expect(pngMenuItem).toBeVisible();
    await expect(pngMenuItem).toHaveAttribute('aria-checked', 'true');
    // The only child is false for a single selection; the parent must not
    // remain as an empty submenu after the child is filtered out.
    await expect(window.getByRole('menuitem', { name: 'Probe processing' })).toHaveCount(0);
    await window.keyboard.press('Escape');

    const selectionModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await secondProbeCard.click({ modifiers: [selectionModifier] });
    await expect(window.locator('.asset-card.is-selected')).toHaveCount(2);
    await secondProbeCard.click({ button: 'right' });
    const processingMenu = window.getByRole('menuitem', { name: 'Probe processing' });
    await expect(processingMenu).toBeVisible();
    await processingMenu.hover();
    await expect(window.getByRole('menuitem', { name: 'Write nested selection' })).toBeVisible();
    const disabledPngMenuItem = window.getByRole('menuitemcheckbox', { name: 'Write PNG selection' });
    await expect(disabledPngMenuItem).toHaveAttribute('aria-disabled', 'true');
    await expect(disabledPngMenuItem).toHaveAttribute('aria-checked', 'false');
    await window.keyboard.press('Escape');

    const storage = JSON.parse(readFileSync(storagePath, 'utf8')) as {
      values: Record<string, { activated?: boolean; source?: string }>;
    };
    expect(storage.values['host-probe']).toEqual({
      activated: true,
      source: 'unrestricted-settings-probe',
    });

    // Leave the library open so recent-library.json is restored on next launch.
    await application.close();

    application = await launch();
    window = await application.firstWindow();
    await expect(window.getByRole('button', { name: `当前资源库 ${libraryName}` })).toBeVisible({
      timeout: 30_000,
    });
    await expectContributionsAndSettingsIframe(window, libraryId);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
