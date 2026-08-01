import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { electronLaunchEnv, resolveElectronExecutablePath } from './electron-test-helpers';
import { PLUGIN_LIBRARY_DATA_DIRECTORY } from '../../src/plugins/plugin-package';

test.describe.configure({ timeout: 180_000 });

const FIXTURE_ROOT = path.resolve('tests/fixtures/plugins/unrestricted-settings-probe');
const PLUGIN_ID = 'com.serpent.unrestricted-settings-probe';
const SETTINGS_PAGE_ID = `${PLUGIN_ID}.settings-page`;
const MENU_ID = `${PLUGIN_ID}.menu.asset.probe.write-selection`;

type ContributionListing = {
  menus: Array<{ id: string; pluginId: string; target?: string }>;
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
          }) => Promise<{ contributions: Array<{ id: string; pluginId: string; target?: string; url?: string }> }>;
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
  expect(listed).toMatchObject({
    menus: [expect.objectContaining({
      id: MENU_ID,
      pluginId: PLUGIN_ID,
    })],
    pages: [expect.objectContaining({
      id: SETTINGS_PAGE_ID,
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
  await expect(dialog.getByText('该插件暂无设置页。')).toHaveCount(0);
  await expect(dialog.locator('iframe.plugin-settings-page-frame')).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: '关闭' }).click();
}

test('lists menus.asset and settings.pages after enable, and after recent-library restart restore', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-unrestricted-settings-e2e-'));
  const libraryName = '无限制设置探测';
  const userDataPath = path.join(temporaryRoot, 'user-data');
  const packageDirectory = path.join(temporaryRoot, 'unrestricted-settings-probe');
  cpSync(FIXTURE_ROOT, packageDirectory, { recursive: true });

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
    await installDialog.getByRole('button', { name: '安装本地插件' }).click();
    await expect(dialog.getByText(/Unrestricted Settings Probe\s*-\s*v/)).toBeVisible({ timeout: 30_000 });

    const card = dialog.locator('.plugin-settings-scope-card').filter({
      hasText: '全局插件',
    }).locator('.plugin-settings-package').filter({
      hasText: 'Unrestricted Settings Probe',
    });
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
