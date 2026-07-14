import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test, type Page } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

test('imports a linked folder, reconciles external changes, and relinks after the root is removed', async () => {
  const testInfo = test.info();
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-linked-e2e-'));
  const sourceRoot = path.join(temporaryRoot, 'source');
  const newRoot = path.join(temporaryRoot, 'relocated');
  const libraryName = '链接文件夹验收';
  const libraryPath = path.join(temporaryRoot, libraryName);
  mkdirSync(sourceRoot);
  writeFileSync(path.join(sourceRoot, 'a.png'), Buffer.from('aaa'));
  writeFileSync(path.join(sourceRoot, 'b.png'), Buffer.from('bbbb'));
  writeFileSync(path.join(sourceRoot, 'delete-me.png'), Buffer.from('trash'));
  mkdirSync(path.join(sourceRoot, 'sub'));
  writeFileSync(path.join(sourceRoot, 'sub', 'c.png'), Buffer.from('ccccc'));
  // The relink target exists at launch (env vars are read at process start) but
  // is left empty; it is populated mid-test just before the relink step.
  mkdirSync(newRoot);

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
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_LINKED_SOURCE: sourceRoot,
      SERPENT_E2E_LINKED_NEW_ROOT: newRoot,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByRole('heading', { name: '把第一批素材放进来' })).toBeVisible();

    await window.getByRole('button', { name: '导入链接文件夹' }).click();
    await expect(window.getByRole('button', { name: 'source' })).toBeVisible();

    await window.getByRole('button', { name: 'source' }).click();
    await expect(window.getByText('a.png', { exact: true })).toBeVisible();
    await expect(window.getByText('b.png', { exact: true })).toBeVisible();
    await expect(window.getByText('c.png', { exact: true })).toBeVisible();

    await window.getByRole('button', { name: /a\.png/i }).click();
    await window.getByRole('button', { name: '删除（链接）' }).click();
    await expect(window.getByRole('heading', { name: '删除链接资产' })).toBeVisible();
    const deleteSource = window.getByLabel('同时删除磁盘源文件');
    await expect(deleteSource).not.toBeChecked();
    await deleteSource.check();
    await expect(window.getByRole('button', { name: '移入系统回收站并移除' })).toBeVisible();
    await window.getByRole('dialog').locator('.secondary-button').click();

    await window.getByRole('button', { name: /delete-me\.png/i }).click();
    await window.getByRole('button', { name: '删除（链接）' }).click();
    await window.getByLabel('同时删除磁盘源文件').check();
    await window.getByRole('button', { name: '移入系统回收站并移除' }).click();
    await expect(window.getByText('delete-me.png', { exact: true })).toHaveCount(0);
    expect(existsSync(path.join(sourceRoot, 'delete-me.png'))).toBe(false);

    const before = await listAllAssets(window);
    const aBefore = before.find((asset) => asset.displayName === 'a.png');
    expect(aBefore?.availability).toBe('available');

    // External overwrite of the linked source file (not via Serpent).
    writeFileSync(path.join(sourceRoot, 'a.png'), Buffer.from('aaaaaa'));
    await window.getByRole('button', { name: '刷新磁盘变化' }).click();
    const afterOverwrite = await listAllAssets(window);
    const aAfterOverwrite = afterOverwrite.find((asset) => asset.displayName === 'a.png');
    expect(aAfterOverwrite?.assetId).toBe(aBefore?.assetId);
    expect(aAfterOverwrite?.currentRevisionId).not.toBe(aBefore?.currentRevisionId);
    expect(aAfterOverwrite?.availability).toBe('available');

    // Source root removed: folder flips to offline, all linked assets missing.
    rmSync(sourceRoot, { recursive: true, force: true });
    await window.getByRole('button', { name: '刷新磁盘变化' }).click();
    await expect(window.locator('.missing-banner', { hasText: '文件丢失' }).first()).toBeVisible();
    const afterOffline = await listAllAssets(window);
    expect(afterOffline.every((asset) => asset.availability === 'missing')).toBe(true);

    // Relink to the new root that has a.png (different content) but not b.png/c.png.
    writeFileSync(path.join(newRoot, 'a.png'), Buffer.from('aaa-restored'));
    await window.getByRole('button', { name: 'source' }).click();
    const afterRelink = await listAllAssets(window);
    const aAfterRelink = afterRelink.find((asset) => asset.displayName === 'a.png');
    const bAfterRelink = afterRelink.find((asset) => asset.displayName === 'b.png');
    expect(aAfterRelink?.assetId).toBe(aBefore?.assetId);
    expect(aAfterRelink?.availability).toBe('available');
    expect(aAfterRelink?.currentRevisionId).not.toBe(aAfterOverwrite?.currentRevisionId);
    expect(bAfterRelink?.availability).toBe('missing');

    const screenshot = testInfo.outputPath('linked-relinked.png');
    await window.screenshot({ path: screenshot });
    await testInfo.attach('linked-relinked', { path: screenshot, contentType: 'image/png' });

    // The linked folder's source root now points at newRoot, not the original.
    expect(existsSync(path.join(newRoot, 'a.png'))).toBe(true);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

interface AssetSnapshot {
  assetId: string;
  displayName: string;
  currentRevisionId: string;
  availability: 'available' | 'missing';
}

async function listAllAssets(window: Page): Promise<AssetSnapshot[]> {
  return window.evaluate(async () => {
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
          listAssets(input: {
            libraryId: string;
            recursive: boolean;
          }): Promise<{ ok: boolean; value?: AssetSnapshot[] }>;
        };
      };
    };
    const open = await bridge.serpent.library.listOpen();
    const libraryId = open.value?.[0]?.libraryId;
    if (!open.ok || !libraryId) throw new Error('Expected an open library.');
    const result = await bridge.serpent.library.listAssets({ libraryId, recursive: true });
    if (!result.ok || !result.value) throw new Error('Could not list assets.');
    return result.value;
  });
}

test('restores a linked library after a full app restart', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-linked-restart-'));
  const profilePath = path.join(temporaryRoot, 'profile');
  const libraryName = '链接重启恢复';
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourceRoot = path.join(temporaryRoot, 'source');
  mkdirSync(profilePath);
  mkdirSync(sourceRoot);
  writeFileSync(path.join(sourceRoot, 'a.png'), Buffer.from('aaa'));
  writeFileSync(path.join(sourceRoot, 'b.png'), Buffer.from('bbbb'));
  mkdirSync(path.join(sourceRoot, 'sub'));
  writeFileSync(path.join(sourceRoot, 'sub', 'c.png'), Buffer.from('ccccc'));

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = () =>
    electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath,
      env: {
        ...process.env,
        SERPENT_E2E: '1',
        SERPENT_E2E_RESTORE_RECENT: '1',
        SERPENT_E2E_USER_DATA_PATH: profilePath,
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
        SERPENT_E2E_LINKED_SOURCE: sourceRoot,
      },
    });

  let application = await launch();
  let assetIds: string[];

  try {
    let window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByRole('heading', { name: '把第一批素材放进来' })).toBeVisible();

    // Link the folder.
    await window.getByRole('button', { name: '导入链接文件夹' }).click();
    await expect(window.getByRole('button', { name: 'source' })).toBeVisible();
    await window.getByRole('button', { name: 'source' }).click();

    // All three assets should be visible.
    await expect(window.getByText('a.png', { exact: true })).toBeVisible();
    await expect(window.getByText('b.png', { exact: true })).toBeVisible();
    await expect(window.getByText('c.png', { exact: true })).toBeVisible();

    // Remember asset IDs for the restart comparison.
    const beforeRestart = await listAllAssets(window);
    assetIds = beforeRestart.map((asset) => asset.assetId);
    expect(assetIds).toHaveLength(3);
    expect(beforeRestart.every((asset) => asset.availability === 'available')).toBe(true);

    // Close the app.
    await application.close();

    // Restart the app — the library should auto-open because of SERPENT_E2E_RESTORE_RECENT.
    application = await launch();
    window = await application.firstWindow();

    // Wait for the library to be restored and the linked folder to be visible.
    await expect(window.getByRole('button', { name: 'source' })).toBeVisible({ timeout: 15_000 });
    await window.getByRole('button', { name: 'source' }).click();

    await expect(window.getByText('a.png', { exact: true })).toBeVisible();
    await expect(window.getByText('b.png', { exact: true })).toBeVisible();
    await expect(window.getByText('c.png', { exact: true })).toBeVisible();

    const afterRestart = await listAllAssets(window);
    expect(afterRestart).toHaveLength(3);
    expect(afterRestart.every((asset) => asset.availability === 'available')).toBe(true);
    // Asset IDs must be stable across restart.
    expect(afterRestart.map((asset) => asset.assetId).sort()).toEqual(assetIds.sort());

    const testInfo = test.info();
    const screenshot = testInfo.outputPath('linked-restart-restored.png');
    await window.screenshot({ path: screenshot });
    await testInfo.attach('linked-restart-restored', { path: screenshot, contentType: 'image/png' });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('applies default ignore rules — .git and node_modules are not registered as linked assets', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-linked-filters-'));
  const sourceRoot = path.join(temporaryRoot, 'source');
  const libraryName = '默认过滤规则';
  const libraryPath = path.join(temporaryRoot, libraryName);

  // Real assets.
  mkdirSync(sourceRoot);
  writeFileSync(path.join(sourceRoot, 'hero.png'), Buffer.from('hero'));
  writeFileSync(path.join(sourceRoot, 'notes.txt'), Buffer.from('notes'));

  // .git directory (should be ignored).
  mkdirSync(path.join(sourceRoot, '.git'));
  writeFileSync(path.join(sourceRoot, '.git', 'config'), Buffer.from('[core]'));
  writeFileSync(path.join(sourceRoot, '.git', 'HEAD'), Buffer.from('ref: refs/heads/main'));
  mkdirSync(path.join(sourceRoot, '.git', 'objects'));
  writeFileSync(path.join(sourceRoot, '.git', 'objects', 'abc123'), Buffer.from('x'));

  // node_modules directory (should be ignored).
  mkdirSync(path.join(sourceRoot, 'node_modules'));
  writeFileSync(path.join(sourceRoot, 'node_modules', 'pkg.json'), Buffer.from('{}'));
  mkdirSync(path.join(sourceRoot, 'node_modules', 'pkg'));
  writeFileSync(path.join(sourceRoot, 'node_modules', 'pkg', 'index.js'), Buffer.from('//'));

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
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_LINKED_SOURCE: sourceRoot,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByRole('heading', { name: '把第一批素材放进来' })).toBeVisible();

    await window.getByRole('button', { name: '导入链接文件夹' }).click();
    await expect(window.getByRole('button', { name: 'source' })).toBeVisible();
    await window.getByRole('button', { name: 'source' }).click();

    // Only the real assets should be visible.
    await expect(window.getByText('hero.png', { exact: true })).toBeVisible();
    await expect(window.getByText('notes.txt', { exact: true })).toBeVisible();

    // .git and node_modules contents must NOT appear as assets.
    await expect(window.getByText('config', { exact: true })).toHaveCount(0);
    await expect(window.getByText('HEAD', { exact: true })).toHaveCount(0);
    await expect(window.getByText('abc123', { exact: true })).toHaveCount(0);
    await expect(window.getByText('pkg.json', { exact: true })).toHaveCount(0);
    await expect(window.getByText('index.js', { exact: true })).toHaveCount(0);

    const assets = await listAllAssets(window);
    const relativePaths = assets.map((asset) => asset.displayName).sort();
    expect(relativePaths).toEqual(['hero.png', 'notes.txt']);
    expect(assets.every((asset) => asset.availability === 'available')).toBe(true);

    const testInfo = test.info();
    const screenshot = testInfo.outputPath('linked-filter-rules.png');
    await window.screenshot({ path: screenshot });
    await testInfo.attach('linked-filter-rules', { path: screenshot, contentType: 'image/png' });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
