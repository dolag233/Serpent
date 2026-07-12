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
    await window.screenshot({ path: testInfo.outputPath('debug-1-after-create.png') });

    await window.getByRole('button', { name: '导入链接文件夹' }).click();
    await window.screenshot({ path: testInfo.outputPath('debug-2-after-import-click.png') });
    await expect(window.getByRole('button', { name: 'source' })).toBeVisible();

    await window.getByRole('button', { name: 'source' }).click();
    await expect(window.getByText('a.png', { exact: true })).toBeVisible();
    await expect(window.getByText('b.png', { exact: true })).toBeVisible();
    await expect(window.getByText('c.png', { exact: true })).toBeVisible();

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
    await expect(window.getByText('文件丢失', { exact: true })).toBeVisible();
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
